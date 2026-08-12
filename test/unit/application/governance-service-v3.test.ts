import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GovernanceServiceV3 } from '../../../src/application/governance/governance-service-v3.js';
import type { GitEvidenceVerifierV3, RecomputedGitEvidenceV3 } from '../../../src/infrastructure/governance/git-evidence-verifier-v3.js';
import { GovernanceStoreV3 } from '../../../src/infrastructure/governance/governance-store-v3.js';

let root: string;
let stateRoot: string;
let store: GovernanceStoreV3;
let service: GovernanceServiceV3;
let evidenceByCommit: Map<string,RecomputedGitEvidenceV3>;
let checkBindingId: string;
const now = '2026-08-11T10:00:00.000Z';
const hash = 'a'.repeat(64);
const candidateCommit = 'b'.repeat(40);
const integratedCommit = 'c'.repeat(40);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-service-'));
  stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-service-key-'));
  const key=path.join(stateRoot,'controller.key');await fs.writeFile(key,Buffer.alloc(32,3),{mode:0o600});
  checkBindingId = 'checker';
  store = new GovernanceStoreV3(root,key,{checkExecutor:{execute:async()=>({command:'npm test',exit_code:0,output:Buffer.from('passed'),executed_by_binding_id:checkBindingId,started_at:now,completed_at:now})}});
  evidenceByCommit=new Map([[candidateCommit,{base_commit:'a'.repeat(40),commit:candidateCommit,diff_hash:hash,changed_paths:['src/api/x.ts']}],[integratedCommit,{base_commit:'a'.repeat(40),commit:integratedCommit,diff_hash:hash,changed_paths:['src/api/x.ts']}]])
  service = new GovernanceServiceV3(store,{recompute:async(base_commit:string,commit:string)=>{const value=evidenceByCommit.get(commit);if(!value||value.base_commit!==base_commit)throw new Error('missing Git evidence');return value},assertAncestor:async()=>{},assertPathComposition:async()=>{}} as GitEvidenceVerifierV3);
});
afterEach(async () => Promise.all([fs.rm(root, { recursive: true, force: true }),fs.rm(stateRoot,{recursive:true,force:true})]));

async function setup() {
  const snapshot = await store.put({
    schema_version: 3,
    kind: 'binding_snapshot',
    governance_id: 'gov',
    record_id: 'bindings',
    bindings: [
      { binding_id: 'planner', role: 'planner', principal_id: 'p', adapter: 'codex', model: 'gpt' },
      { binding_id: 'worker', role: 'candidate', principal_id: 'w', adapter: 'claude', model: 'opus' },
      { binding_id: 'checker', role: 'checker', principal_id: 'c', adapter: 'shell', model: '' },
      { binding_id: 'reviewer1', role: 'reviewer', principal_id: 'r1', adapter: 'codex', model: 'gpt' },
      { binding_id: 'reviewer2', role: 'reviewer', principal_id: 'r2', adapter: 'opencode', model: 'local/qwen' },
      { binding_id: 'selfreview', role: 'reviewer', principal_id: 'w', adapter: 'claude', model: 'opus' },
      { binding_id: 'integrator', role: 'integrator', principal_id: 'orch', adapter: 'orchestrator', model: '' },
    ],
    created_at: now,
  });
  const snapshotRef = { kind: 'binding_snapshot' as const, record_id: 'bindings', record_hash: snapshot.record_hash };
  const plan = await service.savePlan({
    schema_version: 3,
    kind: 'decomposition_plan',
    governance_id: 'gov',
    record_id: 'plan',
    binding_snapshot: snapshotRef,
    objective: 'build',
    base_commit: 'a'.repeat(40),
    target_branch: 'main',
    units: [{ unit_id: 'api', objective: 'api', depends_on: [], owned_path_prefixes: ['src/api'], acceptance_criteria: ['ok'], required_check_ids: ['test'] }],
    integration_check_ids: ['test'],
    created_by_binding_id: 'planner',
    created_at: now,
  });
  const candidateCheck = await service.runCheck({
    governance_id: 'gov',
    record_id: 'candidate-check',
    binding_snapshot: snapshotRef,
    subject: { kind: 'candidate', id: 'cand', commit: candidateCommit },
    check_id: 'test',
  });
  const candidate = await service.saveCandidate({
    schema_version: 3,
    kind: 'candidate_evidence',
    governance_id: 'gov',
    record_id: 'candidate',
    plan: { kind: 'decomposition_plan', record_id: 'plan', record_hash: plan.record_hash },
    binding_snapshot: snapshotRef,
    unit_id: 'api',
    candidate_id: 'cand',
    produced_by_binding_id: 'worker',
    base_commit: 'a'.repeat(40),
    commit: candidateCommit,
    diff_hash: hash,
    changed_paths: ['src/api/x.ts'],
    check_bindings: [{ kind: 'check_binding', record_id: 'candidate-check', record_hash: candidateCheck.record_hash }],
    summary: 'done',
    created_at: now,
  });
  return { snapshot, snapshotRef, plan, candidate };
}

describe('GovernanceServiceV3', () => {
  it('rejects overlapping scopes for parallel units', async () => {
    const { snapshotRef } = await setup();
    await expect(service.savePlan({ schema_version: 3, kind: 'decomposition_plan', governance_id: 'gov', record_id: 'overlap', binding_snapshot: snapshotRef, objective: 'bad', base_commit: 'a'.repeat(40), target_branch: 'main', units: [
      { unit_id: 'a', objective: 'a', depends_on: [], owned_path_prefixes: ['src'], acceptance_criteria: [], required_check_ids: [] },
      { unit_id: 'b', objective: 'b', depends_on: [], owned_path_prefixes: ['src/b'], acceptance_criteria: [], required_check_ids: [] },
    ], integration_check_ids: [], created_by_binding_id: 'planner', created_at: now })).rejects.toThrow('overlap');
  });

  it('stores candidates only with exact scope and passing bound checks', async () => {
    const { candidate } = await setup();
    expect(candidate.record.unit_id).toBe('api');
  });

  it('rejects check results from an executor that is not bound as a checker', async () => {
    const { snapshotRef } = await setup();
    checkBindingId = 'worker';
    await expect(service.runCheck({ governance_id: 'gov', record_id: 'forged-check', binding_snapshot: snapshotRef, subject: { kind: 'candidate', id: 'cand', commit: candidateCommit }, check_id: 'test' })).rejects.toThrow('bound as a checker');
  });

  it('rejects fake candidate Git evidence',async()=>{await setup();evidenceByCommit.set(candidateCommit,{base_commit:'a'.repeat(40),commit:candidateCommit,diff_hash:'f'.repeat(64),changed_paths:['src/api/forged.ts']});await expect(service.saveCandidate({...(await store.read('gov','candidate_evidence','candidate'))!.record as typeof import('../../../src/domain/governance/contracts-v3.js').CandidateEvidenceV3,record_id:'forged'})).rejects.toThrow('Git evidence')});

  it('rejects self-review and integrates only after independent quorum and exact checks', async () => {
    const { snapshotRef, plan, candidate } = await setup();
    const candidateRef = { kind: 'candidate_evidence' as const, record_id: 'candidate', record_hash: candidate.record_hash };
    await expect(service.saveReviewVote({ schema_version: 3, kind: 'review_vote', governance_id: 'gov', record_id: 'self-vote', binding_snapshot: snapshotRef, subject: candidateRef, reviewer_binding_id: 'selfreview', decision: 'approve', reason: 'self', cast_at: now })).rejects.toThrow('own principal');

    const policy = await store.put({ schema_version: 3, kind: 'quorum_policy', governance_id: 'gov', record_id: 'policy', binding_snapshot: snapshotRef, applies_to: 'candidate_evidence', eligible_reviewer_binding_ids: ['reviewer1', 'reviewer2'], minimum_approvals: 2, maximum_rejections: 0, require_distinct_principals: true, human_approval_required: false, created_by_binding_id: 'planner', created_at: now });
    const vote1 = await service.saveReviewVote({ schema_version: 3, kind: 'review_vote', governance_id: 'gov', record_id: 'vote1', binding_snapshot: snapshotRef, subject: candidateRef, reviewer_binding_id: 'reviewer1', decision: 'approve', reason: 'ok', cast_at: now });
    const vote2 = await service.saveReviewVote({ schema_version: 3, kind: 'review_vote', governance_id: 'gov', record_id: 'vote2', binding_snapshot: snapshotRef, subject: candidateRef, reviewer_binding_id: 'reviewer2', decision: 'approve', reason: 'ok', cast_at: now });
    const quorum = await service.evaluateQuorum({ governance_id: 'gov', record_id: 'quorum', policy: { kind: 'quorum_policy', record_id: 'policy', record_hash: policy.record_hash }, subject: candidateRef, votes: [
      { kind: 'review_vote', record_id: 'vote1', record_hash: vote1.record_hash },
      { kind: 'review_vote', record_id: 'vote2', record_hash: vote2.record_hash },
    ], evaluated_at: now });
    expect(quorum.record.satisfied).toBe(true);

    const integrationCheck = await service.runCheck({ governance_id: 'gov', record_id: 'integration-check', binding_snapshot: snapshotRef, subject: { kind: 'integration', id: 'integration', commit: integratedCommit }, check_id: 'test' });
    const integration = await service.saveIntegration({ schema_version: 3, kind: 'integration_receipt', governance_id: 'gov', record_id: 'integration', plan: { kind: 'decomposition_plan', record_id: 'plan', record_hash: plan.record_hash }, binding_snapshot: snapshotRef, integrated_by_binding_id: 'integrator', target_branch: 'main', base_commit: 'a'.repeat(40), candidates: [{ evidence: candidateRef, quorum_result: { kind: 'quorum_result', record_id: 'quorum', record_hash: quorum.record_hash } }], integrated_commit: integratedCommit, diff_hash: hash, check_bindings: [{ kind: 'check_binding', record_id: 'integration-check', record_hash: integrationCheck.record_hash }], integrated_at: now });
    expect(integration.record.integrated_commit).toBe(integratedCommit);
  });

  it('rejects missing and duplicate decomposition units',async()=>{const {snapshotRef,plan,candidate}=await setup();const candidateRef={kind:'candidate_evidence' as const,record_id:'candidate',record_hash:candidate.record_hash};const receipt={schema_version:3 as const,kind:'integration_receipt' as const,governance_id:'gov',record_id:'bad-integration',plan:{kind:'decomposition_plan' as const,record_id:'plan',record_hash:plan.record_hash},binding_snapshot:snapshotRef,integrated_by_binding_id:'integrator',target_branch:'main',base_commit:'a'.repeat(40),candidates:[],integrated_commit:integratedCommit,diff_hash:hash,check_bindings:[],integrated_at:now};await expect(service.saveIntegration(receipt)).rejects.toThrow('exactly one');await expect(service.saveIntegration({...receipt,candidates:[{evidence:candidateRef,quorum_result:{kind:'quorum_result',record_id:'missing',record_hash:hash}},{evidence:{...candidateRef,record_id:'other'},quorum_result:{kind:'quorum_result',record_id:'other',record_hash:hash}}]})).rejects.toThrow()});
});
