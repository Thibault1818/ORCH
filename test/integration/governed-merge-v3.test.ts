import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GovernedMergeV3 } from '../../src/application/governance/governed-merge-v3.js';
import { GovernanceServiceV3 } from '../../src/application/governance/governance-service-v3.js';
import { FileProjectOperationLockV3, GitEvidenceVerifierV3 } from '../../src/infrastructure/governance/git-evidence-verifier-v3.js';
import { GovernanceStoreV3 } from '../../src/infrastructure/governance/governance-store-v3.js';
import { CommandRunner } from '../../src/infrastructure/process/command-runner.js';
import { ProcessManager } from '../../src/infrastructure/process/process-manager.js';

const exec = promisify(execFile);
const now = '2026-08-11T10:00:00.000Z';
const hash = 'a'.repeat(64);
let root: string;
let stateRoot: string;
let store: GovernanceStoreV3;
let service: GovernanceServiceV3;
let merge: GovernedMergeV3;
let evidence: GitEvidenceVerifierV3;
let runner: CommandRunner;
let processes: ProcessManager;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-merge-'));
  await exec('git', ['init', '-b', 'main'], { cwd: root });
  await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
  await fs.writeFile(path.join(root, 'file.txt'), 'base\n');
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-merge-key-'));
  const key=path.join(stateRoot,'controller.key');await fs.writeFile(key,Buffer.alloc(32,5),{mode:0o600});
  processes=new ProcessManager(path.join(stateRoot,'processes.json'));
  runner=new CommandRunner(processes);
  store = new GovernanceStoreV3(root,key,{checkExecutor:{execute:async()=>({command:'npm test',exit_code:0,output:Buffer.from('passed'),executed_by_binding_id:'checker',started_at:now,completed_at:now})},humanIdentity:{authenticate:async()=> 'human'},now:()=>now});
  evidence = new GitEvidenceVerifierV3(root,runner);
  service = new GovernanceServiceV3(store,evidence);
  merge = new GovernedMergeV3(root,store,runner,evidence,processes,new FileProjectOperationLockV3(root));
});
afterEach(async () => Promise.all([fs.rm(root, { recursive: true, force: true }),fs.rm(stateRoot,{recursive:true,force:true})]));

describe('GovernedMergeV3', () => {
  it('moves the exact target ref only after matching quorum, checks, and human approval', async () => {
    const base = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await exec('git', ['checkout', '-b', 'integration'], { cwd: root });
    await fs.writeFile(path.join(root, 'file.txt'), 'integrated\n');
    await exec('git', ['commit', '-am', 'integrated'], { cwd: root });
    const integrated = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await exec('git', ['checkout', 'main'], { cwd: root });
    const actual=await evidence.recompute(base,integrated);

    const snapshot = await store.put({ schema_version: 3, kind: 'binding_snapshot', governance_id: 'gov', record_id: 'bindings', bindings: [
      { binding_id: 'planner', role: 'planner', principal_id: 'p', adapter: 'codex', model: 'gpt' },
      { binding_id: 'worker', role: 'candidate', principal_id: 'w', adapter: 'claude', model: 'opus' },
      { binding_id: 'reviewer', role: 'reviewer', principal_id: 'r', adapter: 'codex', model: 'gpt' },
      { binding_id: 'checker', role: 'checker', principal_id: 'c', adapter: 'shell', model: '' },
      { binding_id: 'integrator', role: 'integrator', principal_id: 'orch', adapter: 'orchestrator', model: '' },
    ], created_at: now });
    const snapshotRef = { kind: 'binding_snapshot' as const, record_id: 'bindings', record_hash: snapshot.record_hash };
    const plan = await service.savePlan({ schema_version: 3, kind: 'decomposition_plan', governance_id: 'gov', record_id: 'plan', binding_snapshot: snapshotRef, objective: 'build', base_commit: base, target_branch: 'main', units: [{ unit_id: 'unit', objective: 'change', depends_on: [], owned_path_prefixes: ['file.txt'], acceptance_criteria: ['changed'], required_check_ids: [] }], integration_check_ids: ['test'], created_by_binding_id: 'planner', created_at: now });
    const candidate = await service.saveCandidate({ schema_version: 3, kind: 'candidate_evidence', governance_id: 'gov', record_id: 'candidate', plan: { kind: 'decomposition_plan', record_id: 'plan', record_hash: plan.record_hash }, binding_snapshot: snapshotRef, unit_id: 'unit', candidate_id: 'candidate', produced_by_binding_id: 'worker', base_commit: base, commit: integrated, diff_hash: actual.diff_hash, changed_paths: actual.changed_paths, check_bindings: [], summary: 'changed', created_at: now });
    const candidateRef = { kind: 'candidate_evidence' as const, record_id: 'candidate', record_hash: candidate.record_hash };
    const policy = await store.put({ schema_version: 3, kind: 'quorum_policy', governance_id: 'gov', record_id: 'policy', binding_snapshot: snapshotRef, applies_to: 'candidate_evidence', eligible_reviewer_binding_ids: ['reviewer'], minimum_approvals: 1, maximum_rejections: 0, require_distinct_principals: true, human_approval_required: false, created_by_binding_id: 'planner', created_at: now });
    const vote = await service.saveReviewVote({ schema_version: 3, kind: 'review_vote', governance_id: 'gov', record_id: 'vote', binding_snapshot: snapshotRef, subject: candidateRef, reviewer_binding_id: 'reviewer', decision: 'approve', reason: 'reviewed', cast_at: now });
    const quorum = await service.evaluateQuorum({ governance_id: 'gov', record_id: 'quorum', policy: { kind: 'quorum_policy', record_id: 'policy', record_hash: policy.record_hash }, subject: candidateRef, votes: [{ kind: 'review_vote', record_id: 'vote', record_hash: vote.record_hash }], evaluated_at: now });
    const check = await service.runCheck({ governance_id: 'gov', record_id: 'check', binding_snapshot: snapshotRef, subject: { kind: 'integration', id: 'integration', commit: integrated }, check_id: 'test' });
    const integration = await service.saveIntegration({ schema_version: 3, kind: 'integration_receipt', governance_id: 'gov', record_id: 'integration', plan: { kind: 'decomposition_plan', record_id: 'plan', record_hash: plan.record_hash }, binding_snapshot: snapshotRef, integrated_by_binding_id: 'integrator', target_branch: 'main', base_commit: base, candidates: [{ evidence: candidateRef, quorum_result: { kind: 'quorum_result', record_id: 'quorum', record_hash: quorum.record_hash } }], integrated_commit: integrated, diff_hash: actual.diff_hash, check_bindings: [{ kind: 'check_binding', record_id: 'check', record_hash: check.record_hash }], integrated_at: now });
    const approval = await merge.approve({ governance_id: 'gov', record_id: 'approval', integration_record_id: 'integration', integration_record_hash: integration.record_hash, reason: 'reviewed exact integration' });
    expect(approval.record.approved_by).toBe('human');

    expect((await merge.merge({ governance_id: 'gov', integration_record_id: 'integration', approval_record_id: approval.record.record_id })).commit).toBe(integrated);
    expect((await exec('git', ['rev-parse', 'main'], { cwd: root })).stdout.trim()).toBe(integrated);
  });

  it('fails closed when the target branch moves after approval', async () => {
    const base = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await exec('git', ['checkout', '-b', 'integration'], { cwd: root });
    await fs.writeFile(path.join(root, 'file.txt'), 'integrated\n');
    await exec('git', ['commit', '-am', 'integrated'], { cwd: root });
    const integrated = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await exec('git', ['checkout', 'main'], { cwd: root });
    const actual=await evidence.recompute(base,integrated);
    const snapshot = await store.put({ schema_version: 3, kind: 'binding_snapshot', governance_id: 'drift', record_id: 'bindings', bindings: [{ binding_id: 'planner', role: 'planner', principal_id: 'p', adapter: 'codex', model: 'gpt' }, { binding_id: 'worker', role: 'candidate', principal_id: 'w', adapter: 'claude', model: 'opus' }, { binding_id: 'reviewer', role: 'reviewer', principal_id: 'r', adapter: 'codex', model: 'gpt' }, { binding_id: 'integrator', role: 'integrator', principal_id: 'orch', adapter: 'orchestrator', model: '' }], created_at: now });
    const snapshotRef = { kind: 'binding_snapshot' as const, record_id: 'bindings', record_hash: snapshot.record_hash };
    const plan = await service.savePlan({ schema_version: 3, kind: 'decomposition_plan', governance_id: 'drift', record_id: 'plan', binding_snapshot: snapshotRef, objective: 'build', base_commit: base, target_branch: 'main', units: [{ unit_id: 'unit', objective: 'change', depends_on: [], owned_path_prefixes: ['file.txt'], acceptance_criteria: [], required_check_ids: [] }], integration_check_ids: [], created_by_binding_id: 'planner', created_at: now });
    const candidate = await service.saveCandidate({ schema_version: 3, kind: 'candidate_evidence', governance_id: 'drift', record_id: 'candidate', plan: { kind: 'decomposition_plan', record_id: 'plan', record_hash: plan.record_hash }, binding_snapshot: snapshotRef, unit_id: 'unit', candidate_id: 'candidate', produced_by_binding_id: 'worker', base_commit: base, commit: integrated, diff_hash: actual.diff_hash, changed_paths: actual.changed_paths, check_bindings: [], summary: 'done', created_at: now });
    const candidateRef = { kind: 'candidate_evidence' as const, record_id: 'candidate', record_hash: candidate.record_hash };
    const policy = await store.put({ schema_version: 3, kind: 'quorum_policy', governance_id: 'drift', record_id: 'policy', binding_snapshot: snapshotRef, applies_to: 'candidate_evidence', eligible_reviewer_binding_ids: ['reviewer'], minimum_approvals: 1, maximum_rejections: 0, require_distinct_principals: true, human_approval_required: false, created_by_binding_id: 'planner', created_at: now });
    const vote = await service.saveReviewVote({ schema_version: 3, kind: 'review_vote', governance_id: 'drift', record_id: 'vote', binding_snapshot: snapshotRef, subject: candidateRef, reviewer_binding_id: 'reviewer', decision: 'approve', reason: 'ok', cast_at: now });
    const quorum = await service.evaluateQuorum({ governance_id: 'drift', record_id: 'quorum', policy: { kind: 'quorum_policy', record_id: 'policy', record_hash: policy.record_hash }, subject: candidateRef, votes: [{ kind: 'review_vote', record_id: 'vote', record_hash: vote.record_hash }], evaluated_at: now });
    const integration = await service.saveIntegration({ schema_version: 3, kind: 'integration_receipt', governance_id: 'drift', record_id: 'integration', plan: { kind: 'decomposition_plan', record_id: 'plan', record_hash: plan.record_hash }, binding_snapshot: snapshotRef, integrated_by_binding_id: 'integrator', target_branch: 'main', base_commit: base, candidates: [{ evidence: candidateRef, quorum_result: { kind: 'quorum_result', record_id: 'quorum', record_hash: quorum.record_hash } }], integrated_commit: integrated, diff_hash: actual.diff_hash, check_bindings: [], integrated_at: now });
    const approval = await merge.approve({ governance_id: 'drift', record_id: 'approval', integration_record_id: 'integration', integration_record_hash: integration.record_hash, reason: 'reviewed' });
    await fs.writeFile(path.join(root, 'other.txt'), 'drift\n');
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'drift'], { cwd: root });
    await expect(merge.merge({ governance_id: 'drift', integration_record_id: 'integration', approval_record_id: approval.record.record_id })).rejects.toThrow('Target branch changed');
  });

  it('rejects candidate omission, duplicate units, and extra integration changes',async()=>{
    const missing=await prepareCase('missing',{secondUnit:true});
    await expect(service.saveIntegration(missing.receipt)).rejects.toThrow('exactly one candidate');
    const original=(await store.read('missing','candidate_evidence','candidate'))!.record;
    if(original.kind!=='candidate_evidence')throw new Error('candidate fixture missing');
    const duplicate=await service.saveCandidate({...original,record_id:'candidate-duplicate',candidate_id:'candidate-duplicate'});
    const duplicateRef={kind:'candidate_evidence' as const,record_id:'candidate-duplicate',record_hash:duplicate.record_hash};
    const duplicateVote=await service.saveReviewVote({schema_version:3,kind:'review_vote',governance_id:'missing',record_id:'vote-duplicate',binding_snapshot:original.binding_snapshot,subject:duplicateRef,reviewer_binding_id:'reviewer',decision:'approve',reason:'ok',cast_at:now});
    const policy=(await store.read('missing','quorum_policy','policy'))!;
    const duplicateQuorum=await service.evaluateQuorum({governance_id:'missing',record_id:'quorum-duplicate',policy:{kind:'quorum_policy',record_id:'policy',record_hash:policy.record_hash},subject:duplicateRef,votes:[{kind:'review_vote',record_id:'vote-duplicate',record_hash:duplicateVote.record_hash}],evaluated_at:now});
    await expect(service.saveIntegration({...missing.receipt,candidates:[...missing.receipt.candidates,{evidence:duplicateRef,quorum_result:{kind:'quorum_result',record_id:'quorum-duplicate',record_hash:duplicateQuorum.record_hash}}]})).rejects.toThrow('duplicate');
    const extra=await prepareCase('extra',{extraIntegrationPath:true});
    await expect(service.saveIntegration(extra.receipt)).rejects.toThrow('unapproved changed paths');
  });

  it('rejects base drift immediately before update-ref',async()=>{
    const prepared=await prepareCase('race');
    const integration=await service.saveIntegration(prepared.receipt);
    const approval=await merge.approve({governance_id:'race',record_id:'approval',integration_record_id:'integration',integration_record_hash:integration.record_hash,reason:'reviewed'});
    let drift='';
    let recomputations=0;
    const racingEvidence={recompute:async(base:string,commit:string)=>{const value=await evidence.recompute(base,commit);if(++recomputations===2){await fs.writeFile(path.join(root,'drift.txt'),'drift\n');await exec('git',['add','.'],{cwd:root});await exec('git',['commit','-m','drift'],{cwd:root});drift=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim()}return value},assertAncestor:(a:string,b:string)=>evidence.assertAncestor(a,b),assertPathComposition:(a:string,b:string,p:readonly string[])=>evidence.assertPathComposition(a,b,p)} as GitEvidenceVerifierV3;
    const racingMerge=new GovernedMergeV3(root,store,runner,racingEvidence,processes,new FileProjectOperationLockV3(root));
    await expect(racingMerge.merge({governance_id:'race',integration_record_id:'integration',approval_record_id:approval.record.record_id})).rejects.toThrow();
    expect((await exec('git',['rev-parse','main'],{cwd:root})).stdout.trim()).toBe(drift);
  });

  it('allows only one concurrent governed merge',async()=>{
    const prepared=await prepareCase('concurrent');
    const integration=await service.saveIntegration(prepared.receipt);
    const approval=await merge.approve({governance_id:'concurrent',record_id:'approval',integration_record_hash:integration.record_hash,integration_record_id:'integration',reason:'reviewed'});
    const input={governance_id:'concurrent',integration_record_id:'integration',approval_record_id:approval.record.record_id};
    const results=await Promise.allSettled([merge.merge(input),merge.merge(input)]);
    expect(results.filter((value)=>value.status==='fulfilled')).toHaveLength(1);
    expect(results.filter((value)=>value.status==='rejected')).toHaveLength(1);
  });

  it('blocks approval while the governance owner has a live process',async()=>{
    const prepared=await prepareCase('active');
    const integration=await service.saveIntegration(prepared.receipt);
    const handle=processes.spawn(process.execPath,['-e','setInterval(() => {}, 1000)'],{owner:'active',env:{}});
    try {
      await expect(merge.approve({governance_id:'active',record_id:'approval',integration_record_id:'integration',integration_record_hash:integration.record_hash,reason:'reviewed'})).rejects.toThrow('Timed out');
      expect(await store.read('active','human_approval','approval')).toBeNull();
    } finally { await processes.killWithGrace(handle.pid,20); }
  },15_000);
});

async function prepareCase(governanceId:string,options:{secondUnit?:boolean;extraIntegrationPath?:boolean}={}){
  const base=(await exec('git',['rev-parse','main'],{cwd:root})).stdout.trim();
  await exec('git',['checkout','-b',`candidate-${governanceId}`],{cwd:root});await fs.writeFile(path.join(root,'file.txt'),'candidate\n');await exec('git',['commit','-am','candidate'],{cwd:root});const candidateCommit=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
  if(options.extraIntegrationPath){await fs.writeFile(path.join(root,'extra.txt'),'extra\n');await exec('git',['add','.'],{cwd:root});await exec('git',['commit','-m','extra integration change'],{cwd:root});}
  const integratedCommit=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();await exec('git',['checkout','main'],{cwd:root});
  const snapshot=await store.put({schema_version:3,kind:'binding_snapshot',governance_id:governanceId,record_id:'bindings',bindings:[{binding_id:'planner',role:'planner',principal_id:'p',adapter:'codex',model:'gpt'},{binding_id:'worker',role:'candidate',principal_id:'w',adapter:'claude',model:'opus'},{binding_id:'reviewer',role:'reviewer',principal_id:'r',adapter:'codex',model:'gpt'},{binding_id:'integrator',role:'integrator',principal_id:'orch',adapter:'orchestrator',model:''}],created_at:now});
  const snapshotRef={kind:'binding_snapshot' as const,record_id:'bindings',record_hash:snapshot.record_hash};
  const units=[{unit_id:'unit',objective:'change',depends_on:[],owned_path_prefixes:['file.txt'],acceptance_criteria:[],required_check_ids:[]}];if(options.secondUnit)units.push({unit_id:'second',objective:'second',depends_on:[],owned_path_prefixes:['other.txt'],acceptance_criteria:[],required_check_ids:[]});
  const plan=await service.savePlan({schema_version:3,kind:'decomposition_plan',governance_id:governanceId,record_id:'plan',binding_snapshot:snapshotRef,objective:'build',base_commit:base,target_branch:'main',units,integration_check_ids:[],created_by_binding_id:'planner',created_at:now});
  const actualCandidate=await evidence.recompute(base,candidateCommit);const candidate=await service.saveCandidate({schema_version:3,kind:'candidate_evidence',governance_id:governanceId,record_id:'candidate',plan:{kind:'decomposition_plan',record_id:'plan',record_hash:plan.record_hash},binding_snapshot:snapshotRef,unit_id:'unit',candidate_id:'candidate',produced_by_binding_id:'worker',base_commit:base,commit:candidateCommit,diff_hash:actualCandidate.diff_hash,changed_paths:actualCandidate.changed_paths,check_bindings:[],summary:'done',created_at:now});
  const candidateRef={kind:'candidate_evidence' as const,record_id:'candidate',record_hash:candidate.record_hash};const policy=await store.put({schema_version:3,kind:'quorum_policy',governance_id:governanceId,record_id:'policy',binding_snapshot:snapshotRef,applies_to:'candidate_evidence',eligible_reviewer_binding_ids:['reviewer'],minimum_approvals:1,maximum_rejections:0,require_distinct_principals:true,human_approval_required:false,created_by_binding_id:'planner',created_at:now});const vote=await service.saveReviewVote({schema_version:3,kind:'review_vote',governance_id:governanceId,record_id:'vote',binding_snapshot:snapshotRef,subject:candidateRef,reviewer_binding_id:'reviewer',decision:'approve',reason:'ok',cast_at:now});const quorum=await service.evaluateQuorum({governance_id:governanceId,record_id:'quorum',policy:{kind:'quorum_policy',record_id:'policy',record_hash:policy.record_hash},subject:candidateRef,votes:[{kind:'review_vote',record_id:'vote',record_hash:vote.record_hash}],evaluated_at:now});
  const actualIntegration=await evidence.recompute(base,integratedCommit);return{receipt:{schema_version:3 as const,kind:'integration_receipt' as const,governance_id:governanceId,record_id:'integration',plan:{kind:'decomposition_plan' as const,record_id:'plan',record_hash:plan.record_hash},binding_snapshot:snapshotRef,integrated_by_binding_id:'integrator',target_branch:'main',base_commit:base,candidates:[{evidence:candidateRef,quorum_result:{kind:'quorum_result' as const,record_id:'quorum',record_hash:quorum.record_hash}}],integrated_commit:integratedCommit,diff_hash:actualIntegration.diff_hash,check_bindings:[],integrated_at:now}};
}
