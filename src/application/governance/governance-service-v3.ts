import type { BindingSnapshotV3, CandidateEvidenceV3, CheckBindingV3, DecompositionPlanV3, GovernanceRefV3, HumanApprovalV3, IntegrationReceiptV3, QuorumPolicyV3, QuorumResultV3, ReviewSubjectRefV3, ReviewVoteV3, StoredGovernanceRecordV3 } from '../../domain/governance/contracts-v3.js';
import { GovernanceStoreV3, hashGovernanceRecordV3 } from '../../infrastructure/governance/governance-store-v3.js';
import type { GitEvidenceVerifierV3 } from '../../infrastructure/governance/git-evidence-verifier-v3.js';

export class GovernanceServiceV3 {
  constructor(private readonly store: GovernanceStoreV3, private readonly git: GitEvidenceVerifierV3) {}

  async savePlan(plan: DecompositionPlanV3): Promise<StoredGovernanceRecordV3<DecompositionPlanV3>> {
    const snapshot = await this.required(plan.governance_id, plan.binding_snapshot);
    const bindings = (snapshot.record as BindingSnapshotV3).bindings;
    const planner = bindings.find((binding) => binding.binding_id === plan.created_by_binding_id);
    if (!planner || planner.role !== 'planner') throw new Error('Decomposition plan creator is not the bound planner');
    assertNoParallelScopeOverlap(plan);
    return this.store.put(plan);
  }

  async saveCandidate(candidate: CandidateEvidenceV3): Promise<StoredGovernanceRecordV3<CandidateEvidenceV3>> {
    const [planStored, snapshotStored] = await Promise.all([
      this.required(candidate.governance_id, candidate.plan),
      this.required(candidate.governance_id, candidate.binding_snapshot),
    ]);
    const plan = planStored.record as DecompositionPlanV3;
    const snapshot = snapshotStored.record as BindingSnapshotV3;
    if (candidate.plan.record_hash !== hashGovernanceRecordV3(plan) || candidate.binding_snapshot.record_hash !== hashGovernanceRecordV3(snapshot)) throw new Error('Candidate references stale governance inputs');
    if (!sameRef(candidate.binding_snapshot, plan.binding_snapshot)) throw new Error('Candidate binding snapshot does not match its plan');
    const unit = plan.units.find((item) => item.unit_id === candidate.unit_id);
    if (!unit || candidate.base_commit !== plan.base_commit) throw new Error('Candidate does not match its decomposition unit');
    const producer = snapshot.bindings.find((binding) => binding.binding_id === candidate.produced_by_binding_id);
    if (!producer || producer.role !== 'candidate') throw new Error('Candidate producer is not a candidate binding');
    const outside = candidate.changed_paths.filter((file) => !unit.owned_path_prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)));
    if (outside.length) throw new Error(`Candidate changed paths outside owned scope: ${outside.join(', ')}`);
    const actual = await this.git.recompute(candidate.base_commit, candidate.commit);
    if (candidate.diff_hash !== actual.diff_hash || !sameOrdered(candidate.changed_paths, actual.changed_paths)) throw new Error('Candidate Git evidence does not match repository state');
    const checks = await Promise.all(candidate.check_bindings.map(async (reference) => (await this.required(candidate.governance_id, reference)).record as CheckBindingV3));
    const checkIds = checks.map((check) => check.check_id);
    if (!sameSet(checkIds, unit.required_check_ids)) throw new Error('Candidate checks do not exactly cover required check IDs');
    for (const check of checks) {
      if (!sameRef(check.binding_snapshot, candidate.binding_snapshot) || !isTrustedCheck(check, snapshot) || check.status !== 'passed' || check.subject.kind !== 'candidate' || check.subject.id !== candidate.candidate_id || check.subject.commit !== candidate.commit) throw new Error('Candidate check is failed, untrusted, or bound to different evidence');
    }
    return this.store.put(candidate);
  }

  async saveReviewVote(vote: ReviewVoteV3): Promise<StoredGovernanceRecordV3<ReviewVoteV3>> {
    const [snapshotStored, subjectStored] = await Promise.all([
      this.required(vote.governance_id, vote.binding_snapshot),
      this.required(vote.governance_id, vote.subject),
    ]);
    const snapshot = snapshotStored.record as BindingSnapshotV3;
    const subject = subjectStored.record as CandidateEvidenceV3 | IntegrationReceiptV3;
    if (!sameRef(vote.binding_snapshot, subject.binding_snapshot)) throw new Error('Review vote binding snapshot does not match its subject');
    const reviewer = snapshot.bindings.find((binding) => binding.binding_id === vote.reviewer_binding_id);
    if (!reviewer || reviewer.role !== 'reviewer') throw new Error('Review vote is not from a reviewer binding');
    const authorId = subject.kind === 'candidate_evidence' ? subject.produced_by_binding_id : subject.integrated_by_binding_id;
    const author = snapshot.bindings.find((binding) => binding.binding_id === authorId);
    if (!author || author.principal_id === reviewer.principal_id) throw new Error('Reviewer cannot review its own principal evidence');
    return this.store.put(vote);
  }

  async evaluateQuorum(input: { governance_id: string; record_id: string; policy: GovernanceRefV3<'quorum_policy'>; subject: ReviewSubjectRefV3; votes: GovernanceRefV3<'review_vote'>[]; human_approval?: GovernanceRefV3<'human_approval'> | null; evaluated_at: string }): Promise<StoredGovernanceRecordV3<QuorumResultV3>> {
    const [policyStored, subjectStored, ...voteStored] = await Promise.all([
      this.required(input.governance_id, input.policy),
      this.required(input.governance_id, input.subject),
      ...input.votes.map((vote) => this.required(input.governance_id, vote)),
    ]);
    const policy = policyStored.record as QuorumPolicyV3;
    if (policy.applies_to !== subjectStored.record.kind) throw new Error('Quorum policy does not apply to subject kind');
    const snapshot = (await this.required(input.governance_id, policy.binding_snapshot)).record as BindingSnapshotV3;
    if (!sameRef(policy.binding_snapshot, (subjectStored.record as CandidateEvidenceV3 | IntegrationReceiptV3).binding_snapshot)) throw new Error('Quorum policy binding snapshot does not match its subject');
    const votes = voteStored.map((stored) => stored.record as ReviewVoteV3);
    const reviewers = new Set<string>(); const principals = new Set<string>();
    for (const vote of votes) {
      if (!sameRef(vote.binding_snapshot, policy.binding_snapshot) || !sameRef(vote.subject, input.subject) || !policy.eligible_reviewer_binding_ids.includes(vote.reviewer_binding_id) || reviewers.has(vote.reviewer_binding_id)) throw new Error('Quorum contains duplicate, ineligible, or mismatched vote');
      reviewers.add(vote.reviewer_binding_id);
      const binding = snapshot.bindings.find((item) => item.binding_id === vote.reviewer_binding_id);
      if (!binding) throw new Error('Quorum reviewer binding is missing');
      if (policy.require_distinct_principals && principals.has(binding.principal_id)) throw new Error('Quorum reviewers must use distinct principals');
      principals.add(binding.principal_id);
    }
    let human: StoredGovernanceRecordV3 | null = null;
    if (input.human_approval) {
      human = await this.required(input.governance_id, input.human_approval);
      if (!sameRef((human.record as HumanApprovalV3).subject, input.subject)) throw new Error('Human approval targets different evidence');
    }
    const approvals = votes.filter((vote) => vote.decision === 'approve').length;
    const rejections = votes.length - approvals;
    const satisfied = approvals >= policy.minimum_approvals && rejections <= policy.maximum_rejections && (!policy.human_approval_required || human !== null);
    return this.store.put({ schema_version: 3, kind: 'quorum_result', governance_id: input.governance_id, record_id: input.record_id, policy: input.policy, subject: input.subject, votes: input.votes, human_approval: input.human_approval ?? null, approvals, rejections, satisfied, evaluated_at: input.evaluated_at });
  }

  async saveIntegration(receipt: IntegrationReceiptV3): Promise<StoredGovernanceRecordV3<IntegrationReceiptV3>> {
    const [planStored, snapshotStored] = await Promise.all([this.required(receipt.governance_id, receipt.plan), this.required(receipt.governance_id, receipt.binding_snapshot)]);
    const plan = planStored.record as DecompositionPlanV3; const snapshot = snapshotStored.record as BindingSnapshotV3;
    if (receipt.target_branch !== plan.target_branch || receipt.base_commit !== plan.base_commit) throw new Error('Integration does not match decomposition target');
    if (!sameRef(receipt.binding_snapshot, plan.binding_snapshot)) throw new Error('Integration binding snapshot does not match its plan');
    const integrator = snapshot.bindings.find((binding) => binding.binding_id === receipt.integrated_by_binding_id);
    if (!integrator || integrator.role !== 'integrator') throw new Error('Integration actor is not the bound integrator');
    if (receipt.candidates.length !== plan.units.length) throw new Error('Integration must contain exactly one candidate per decomposition unit');
    const units = new Set<string>();
    const approvedPaths = new Set<string>();
    for (const item of receipt.candidates) {
      const [candidateStored, quorumStored] = await Promise.all([this.required(receipt.governance_id, item.evidence), this.required(receipt.governance_id, item.quorum_result)]);
      const candidate = candidateStored.record as CandidateEvidenceV3; const quorum = quorumStored.record as QuorumResultV3;
      if (!quorum.satisfied || !sameRef(quorum.subject, item.evidence) || !sameRef(candidate.plan, receipt.plan) || !sameRef(candidate.binding_snapshot, receipt.binding_snapshot)) throw new Error('Integration candidate lacks matching plan, snapshot, and satisfied quorum');
      if (units.has(candidate.unit_id) || !plan.units.some((unit) => unit.unit_id === candidate.unit_id)) throw new Error('Integration has duplicate or unknown decomposition units');
      units.add(candidate.unit_id);
      for (const value of candidate.changed_paths) { if (approvedPaths.has(value)) throw new Error(`Integration candidates overlap changed path: ${value}`); approvedPaths.add(value); }
      const actualCandidate = await this.git.recompute(candidate.base_commit, candidate.commit);
      if (actualCandidate.diff_hash !== candidate.diff_hash || !sameOrdered(actualCandidate.changed_paths, candidate.changed_paths)) throw new Error('Integration candidate Git evidence is stale');
      await this.git.assertAncestor(candidate.commit, receipt.integrated_commit);
      await this.git.assertPathComposition(candidate.commit, receipt.integrated_commit, candidate.changed_paths);
    }
    const actual = await this.git.recompute(receipt.base_commit, receipt.integrated_commit);
    if (actual.diff_hash !== receipt.diff_hash) throw new Error('Integration Git evidence does not match repository state');
    const extra = actual.changed_paths.filter((value) => !approvedPaths.has(value));
    if (extra.length) throw new Error(`Integration contains unapproved changed paths: ${extra.join(', ')}`);
    const checks = await Promise.all(receipt.check_bindings.map(async (reference) => (await this.required(receipt.governance_id, reference)).record as CheckBindingV3));
    if (!sameSet(checks.map((check) => check.check_id), plan.integration_check_ids) || checks.some((check) => !sameRef(check.binding_snapshot, receipt.binding_snapshot) || !isTrustedCheck(check, snapshot) || check.status !== 'passed' || check.subject.kind !== 'integration' || check.subject.id !== receipt.record_id || check.subject.commit !== receipt.integrated_commit)) throw new Error('Integration checks are incomplete, failed, untrusted, or stale');
    return this.store.put(receipt);
  }

  private async required(governanceId: string, reference: GovernanceRefV3): Promise<StoredGovernanceRecordV3> {
    const stored = await this.store.read(governanceId, reference.kind, reference.record_id);
    if (!stored || stored.record_hash !== reference.record_hash) throw new Error(`Missing or stale governance reference: ${reference.kind}/${reference.record_id}`);
    return stored;
  }
}

export function assertNoParallelScopeOverlap(plan: DecompositionPlanV3): void {
  const depends = new Map(plan.units.map((unit) => [unit.unit_id, new Set(unit.depends_on)]));
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>(); const stack = [...(depends.get(from) ?? [])];
    while (stack.length) { const next=stack.pop()!; if(next===target)return true;if(seen.has(next))continue;seen.add(next);stack.push(...(depends.get(next)??[])); }
    return false;
  };
  for (let i=0;i<plan.units.length;i++) for(let j=i+1;j<plan.units.length;j++) {
    const left=plan.units[i]!, right=plan.units[j]!;
    if (reaches(left.unit_id,right.unit_id)||reaches(right.unit_id,left.unit_id)) continue;
    const overlap=left.owned_path_prefixes.some((a)=>right.owned_path_prefixes.some((b)=>a===b||a.startsWith(`${b}/`)||b.startsWith(`${a}/`)));
    if(overlap) throw new Error(`Parallel decomposition scopes overlap: ${left.unit_id} and ${right.unit_id}`);
  }
}
function sameSet(left:string[],right:string[]){return left.length===right.length&&new Set(left).size===left.length&&left.every((item)=>right.includes(item));}
function sameRef(left:GovernanceRefV3,right:GovernanceRefV3){return left.kind===right.kind&&left.record_id===right.record_id&&left.record_hash===right.record_hash;}
function sameOrdered(left:string[],right:string[]){return left.length===right.length&&left.every((item,index)=>item===right[index]);}
function isTrustedCheck(check:CheckBindingV3,snapshot:BindingSnapshotV3){return check.provenance.command_source==='trusted'&&check.provenance.execution_environment==='sandboxed'&&snapshot.bindings.some((binding)=>binding.binding_id===check.executed_by_binding_id&&binding.role==='checker');}
