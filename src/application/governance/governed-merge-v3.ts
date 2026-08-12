import type { BindingSnapshotV3, CandidateEvidenceV3, CheckBindingV3, DecompositionPlanV3, HumanApprovalV3, IntegrationReceiptV3, QuorumPolicyV3, QuorumResultV3, ReviewVoteV3, StoredGovernanceRecordV3 } from '../../domain/governance/contracts-v3.js';
import { GovernanceStoreV3 } from '../../infrastructure/governance/governance-store-v3.js';
import { resolveExecutable, type ICommandRunner } from '../../infrastructure/process/command-runner.js';
import { HardenedGit } from '../../infrastructure/git/hardened-git.js';
import type { GitEvidenceVerifierV3, ProjectOperationLockV3 } from '../../infrastructure/governance/git-evidence-verifier-v3.js';

export class GovernedMergeV3 {
  private readonly gitRunner: Promise<HardenedGit>;
  constructor(
    private readonly projectRoot: string,
    private readonly store: GovernanceStoreV3,
    runner: ICommandRunner,
    private readonly evidence: GitEvidenceVerifierV3,
    private readonly quiescence: { runQuiescent<T>(owner: string, action: () => Promise<T>): Promise<T> },
    private readonly operationLock: ProjectOperationLockV3,
  ) {
    this.gitRunner = (async () => new HardenedGit(runner, await resolveExecutable('git')))();
  }

  async approve(input: { governance_id: string; record_id: string; integration_record_id: string; integration_record_hash: string; reason: string }): Promise<StoredGovernanceRecordV3<HumanApprovalV3>> {
    const lease = await this.operationLock.acquire(input.governance_id);
    try {
      return await this.quiescence.runQuiescent(input.governance_id, async () => {
        await lease.assertOwned();
        const integration = await this.store.read(input.governance_id, 'integration_receipt', input.integration_record_id);
        if (!integration || integration.record_hash !== input.integration_record_hash) throw new Error('Human approval references stale integration evidence');
        return this.store.approve({ governance_id: input.governance_id, record_id: input.record_id, subject: { kind: 'integration_receipt', record_id: input.integration_record_id, record_hash: input.integration_record_hash }, reason: input.reason });
      });
    } finally { await lease.release(); }
  }

  async merge(input: { governance_id: string; integration_record_id: string; approval_record_id: string }): Promise<{ merged: true; commit: string }> {
    const lease = await this.operationLock.acquire(input.governance_id);
    try {
    return await this.quiescence.runQuiescent(input.governance_id, async () => {
    await lease.assertOwned();
    const [integrationStored, approvalStored] = await Promise.all([
      this.store.read(input.governance_id, 'integration_receipt', input.integration_record_id),
      this.store.read(input.governance_id, 'human_approval', input.approval_record_id),
    ]);
    if (!integrationStored || !approvalStored) throw new Error('Integration and human approval are required');
    const integration = integrationStored.record as IntegrationReceiptV3;
    const approval = approvalStored.record as HumanApprovalV3;
    if (approval.subject.kind !== 'integration_receipt' || approval.subject.record_id !== integration.record_id || approval.subject.record_hash !== integrationStored.record_hash) throw new Error('Human approval targets different integration evidence');
    const planStored = await this.store.read(input.governance_id, 'decomposition_plan', integration.plan.record_id);
    if (!planStored || planStored.record_hash !== integration.plan.record_hash) throw new Error('Integration plan evidence is stale');
    const plan = planStored.record as DecompositionPlanV3;
    if (integration.base_commit !== plan.base_commit || integration.target_branch !== plan.target_branch) throw new Error('Integration does not match its governed plan');
    if (!sameRef(integration.binding_snapshot, plan.binding_snapshot) || integration.candidates.length !== plan.units.length) throw new Error('Integration does not contain exactly one candidate per governed unit and snapshot');
    const snapshotStored = await this.store.read(input.governance_id, 'binding_snapshot', integration.binding_snapshot.record_id);
    if (!snapshotStored || snapshotStored.record_hash !== integration.binding_snapshot.record_hash) throw new Error('Integration binding snapshot is stale');
    const snapshot = snapshotStored.record as BindingSnapshotV3;
    const units = new Set<string>();
    const approvedPaths = new Set<string>();
    for (const item of integration.candidates) {
      const [candidateStored, quorumStored] = await Promise.all([
        this.store.read(input.governance_id, 'candidate_evidence', item.evidence.record_id),
        this.store.read(input.governance_id, 'quorum_result', item.quorum_result.record_id),
      ]);
      if (!candidateStored || candidateStored.record_hash !== item.evidence.record_hash || !quorumStored || quorumStored.record_hash !== item.quorum_result.record_hash) throw new Error('Integration candidate evidence is stale');
      const candidate = candidateStored.record as CandidateEvidenceV3;
      const quorum = quorumStored.record as QuorumResultV3;
      if (!sameRef(candidate.plan, integration.plan) || !sameRef(candidate.binding_snapshot, integration.binding_snapshot) || units.has(candidate.unit_id) || !plan.units.some((unit) => unit.unit_id === candidate.unit_id)) throw new Error('Integration candidate plan, snapshot, or decomposition unit is invalid');
      units.add(candidate.unit_id);
      for (const value of candidate.changed_paths) { if (approvedPaths.has(value)) throw new Error(`Integration candidates overlap changed path: ${value}`); approvedPaths.add(value); }
      if (quorum.subject.kind !== 'candidate_evidence' || quorum.subject.record_id !== candidate.record_id || quorum.subject.record_hash !== candidateStored.record_hash) throw new Error('Integration candidate quorum targets different evidence');
      await this.revalidateQuorum(input.governance_id, candidate, candidateStored.record_hash, quorum);
      const candidateActual = await this.evidence.recompute(candidate.base_commit, candidate.commit);
      if (candidateActual.diff_hash !== candidate.diff_hash || !sameOrdered(candidateActual.changed_paths, candidate.changed_paths)) throw new Error('Integration candidate Git evidence is stale');
      await this.evidence.assertAncestor(candidate.commit, integration.integrated_commit);
      await this.evidence.assertPathComposition(candidate.commit, integration.integrated_commit, candidate.changed_paths);
    }
    const checks = await Promise.all(integration.check_bindings.map(async (reference) => {
      const stored = await this.store.read(input.governance_id, 'check_binding', reference.record_id);
      if (!stored || stored.record_hash !== reference.record_hash) throw new Error('Integration check evidence is stale');
      return stored.record as CheckBindingV3;
    }));
    if (!sameSet(checks.map((check) => check.check_id), plan.integration_check_ids) || checks.some((check) => !sameRef(check.binding_snapshot, integration.binding_snapshot) || !isTrustedCheck(check, snapshot) || check.status !== 'passed' || check.subject.kind !== 'integration' || check.subject.id !== integration.record_id || check.subject.commit !== integration.integrated_commit)) throw new Error('Integration checks are incomplete, failed, untrusted, or stale');
    const ref = `refs/heads/${integration.target_branch}`;
    const before = await this.git(['rev-parse', '--verify', ref]);
    if (before.trim() !== integration.base_commit) throw new Error('Target branch changed after governance plan was created');
    const candidate = await this.git(['rev-parse', '--verify', '--end-of-options', `${integration.integrated_commit}^{commit}`]);
    if (candidate.trim() !== integration.integrated_commit) throw new Error('Integrated commit is unavailable');
    const actual = await this.evidence.recompute(integration.base_commit, integration.integrated_commit);
    const extra = actual.changed_paths.filter((value) => !approvedPaths.has(value));
    if (actual.diff_hash !== integration.diff_hash || extra.length) throw new Error('Final integration Git evidence contains a mismatch or unapproved changed paths');
    await lease.assertOwned();
    await this.git(['update-ref', '-m', `ORCH governance ${input.governance_id}`, ref, integration.integrated_commit, integration.base_commit]);
    const after = await this.git(['rev-parse', '--verify', ref]);
    if (after.trim() !== integration.integrated_commit) throw new Error('Guarded target update did not persist');
    return { merged: true, commit: integration.integrated_commit };
    });
    } finally { await lease.release(); }
  }

  private async git(args: string[]): Promise<string> {
    return (await this.gitRunner).run(this.projectRoot, args);
  }

  private async revalidateQuorum(governanceId: string, candidate: CandidateEvidenceV3, candidateHash: string, quorum: QuorumResultV3): Promise<void> {
    const policyStored = await this.store.read(governanceId, 'quorum_policy', quorum.policy.record_id);
    if (!policyStored || policyStored.record_hash !== quorum.policy.record_hash) throw new Error('Quorum policy evidence is stale');
    const policy = policyStored.record as QuorumPolicyV3;
    if (policy.applies_to !== 'candidate_evidence') throw new Error('Quorum policy does not apply to candidate evidence');
    if (!sameRef(policy.binding_snapshot, candidate.binding_snapshot)) throw new Error('Quorum policy binding snapshot does not match candidate evidence');
    const snapshotStored = await this.store.read(governanceId, 'binding_snapshot', policy.binding_snapshot.record_id);
    if (!snapshotStored || snapshotStored.record_hash !== policy.binding_snapshot.record_hash) throw new Error('Quorum binding snapshot is stale');
    const snapshot = snapshotStored.record as BindingSnapshotV3;
    const author = snapshot.bindings.find((binding) => binding.binding_id === candidate.produced_by_binding_id);
    if (!author || author.role !== 'candidate') throw new Error('Candidate author binding is missing or invalid');
    const reviewers = new Set<string>(); const principals = new Set<string>(); let approvals = 0; let rejections = 0;
    for (const reference of quorum.votes) {
      const voteStored = await this.store.read(governanceId, 'review_vote', reference.record_id);
      if (!voteStored || voteStored.record_hash !== reference.record_hash) throw new Error('Quorum vote evidence is stale');
      const vote = voteStored.record as ReviewVoteV3;
      if (!sameRef(vote.binding_snapshot, policy.binding_snapshot) || vote.subject.kind !== 'candidate_evidence' || vote.subject.record_id !== candidate.record_id || vote.subject.record_hash !== candidateHash || !policy.eligible_reviewer_binding_ids.includes(vote.reviewer_binding_id) || reviewers.has(vote.reviewer_binding_id)) throw new Error('Quorum contains duplicate, ineligible, or mismatched vote');
      const reviewer = snapshot.bindings.find((binding) => binding.binding_id === vote.reviewer_binding_id);
      if (!reviewer || reviewer.role !== 'reviewer' || reviewer.principal_id === author.principal_id) throw new Error('Quorum contains self-review or invalid reviewer');
      if (policy.require_distinct_principals && principals.has(reviewer.principal_id)) throw new Error('Quorum reviewers do not use distinct principals');
      reviewers.add(reviewer.binding_id); principals.add(reviewer.principal_id);
      if (vote.decision === 'approve') approvals++; else rejections++;
    }
    let hasHumanApproval = false;
    if (quorum.human_approval) {
      const stored = await this.store.read(governanceId, 'human_approval', quorum.human_approval.record_id);
      if (!stored || stored.record_hash !== quorum.human_approval.record_hash) throw new Error('Quorum human approval is stale');
      const human = stored.record as HumanApprovalV3;
      hasHumanApproval = human.subject.kind === 'candidate_evidence' && human.subject.record_id === candidate.record_id && human.subject.record_hash === candidateHash;
    }
    const satisfied = approvals >= policy.minimum_approvals && rejections <= policy.maximum_rejections && (!policy.human_approval_required || hasHumanApproval);
    if (!satisfied || !quorum.satisfied || quorum.approvals !== approvals || quorum.rejections !== rejections) throw new Error('Integration candidate quorum is not satisfied');
  }
}
function sameSet(left: string[], right: string[]): boolean { return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item)); }
function sameRef(left:{kind:string;record_id:string;record_hash:string},right:{kind:string;record_id:string;record_hash:string}){return left.kind===right.kind&&left.record_id===right.record_id&&left.record_hash===right.record_hash;}
function sameOrdered(left:string[],right:string[]){return left.length===right.length&&left.every((value,index)=>value===right[index]);}
function isTrustedCheck(check:CheckBindingV3,snapshot:BindingSnapshotV3){return check.provenance.command_source==='trusted'&&check.provenance.execution_environment==='sandboxed'&&snapshot.bindings.some((binding)=>binding.binding_id===check.executed_by_binding_id&&binding.role==='checker');}
