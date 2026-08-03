import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkflowArtifactStore } from '../../../src/infrastructure/workflow/artifact-store.js';
import type { WorkflowJobV1, WorkflowPassportV1, WorkflowSessionsV1 } from '../../../src/domain/workflow/state.js';
import { clearEnsuredDirs, closeAllAppendHandles } from '../../../src/infrastructure/storage/fs-utils.js';
import { validateCodexBrief } from '../../../src/domain/workflow/contracts.js';

let root: string; let store: WorkflowArtifactStore;
const now = '2026-08-03T10:00:00.000Z';
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-store-')); store = new WorkflowArtifactStore(root); await create(); });
afterEach(async () => { closeAllAppendHandles(); clearEnsuredDirs(); await fs.rm(root, { recursive: true, force: true }); });

async function create() {
  const job = { schema_version: 1, job_id: 'wf_safe', phase: 'codex_brief', resume_phase: null, revision: 1, artifact_revision: 0, latest_artifact_hash: null, fable_pre_opus_calls: 0, fable_post_opus_calls: 0, fable_post_opus_iteration_calls: 0, fable_total_calls: 0, fix_cycles: 0, opus_iteration: 1, branch: null, worktree: null, target_branch: null, base_commit: null, current_commit: null, approved_plan_hash: null, reviewed_diff_hash: null, last_verdict: null, blocker: null, next_action: 'brief', current_operation: null, created_at: now, updated_at: now } as WorkflowJobV1;
  const profiles = { fable: { model: 'fable', effort: 'low', max_turns: 1, timeout_ms: 1000, permission_mode: 'read_only' }, opus: { model: 'opus', effort: 'high', max_turns: 50, timeout_ms: 1000, permission_mode: 'worktree' }, codex: { model: 'codex', effort: 'medium', max_turns: 1, timeout_ms: 1000, permission_mode: 'read_only' } } as const;
  const passport = { schema_version: 1, passport_revision: 1, job_id: 'wf_safe', current_revision: 1, objective: 'build', current_phase: 'codex_brief', approved_plan_hash: null, latest_accepted_plan: null, hard_constraints: [], acceptance_criteria: [], mandatory_amendments: [], decisions: [], allowed_file_scope: [], required_checks: [], current_blockers: [], next_action: 'brief', artifacts: [], active_worktree: null, target_branch: null, base_commit: null, current_commit: null, session_references: { codex: null, fable: null, opus: null }, session_modes: { codex: 'none', fable: 'none', opus: 'none' }, rotation_history: [], config: { fable_pre_opus_cap: 2, fable_post_opus_per_iteration_cap: 1, fable_total_cap: 5, max_input_bytes: 1000, max_output_bytes: 1000, passport_max_bytes: 64_000, post_review: 'always', profiles } } as WorkflowPassportV1;
  const empty = { calls: 0, input_chars: 0, output_chars: 0, input_tokens: 0, output_tokens: 0, estimated_tokens: 0, cache_read: 0, cache_write: 0, duration_ms: 0, failed_calls: 0, resumes: 0, compactions: 0 };
  const sessions: WorkflowSessionsV1 = { schema_version: 1, job_id: 'wf_safe', codex_thread_id: null, fable_session_id: null, opus_session_id: null, opus_plan_hash: null, modes: { codex: 'none', fable: 'none', opus: 'none' }, rotation_history: [], recorded_invocations: [], usage: { codex: { ...empty }, fable: { ...empty }, opus: { ...empty } }, updated_at: now };
  await store.createJob(job, passport, sessions);
}

describe('WorkflowArtifactStore', () => {
  it('uses exact names, complete canonical content, hashes, and secure modes', async () => {
    const huge = 'x'.repeat(30_000); const stored = await store.writeArtifact({ job_id: 'wf_safe', name: 'codex_brief', phase: 'codex_brief', revision: 1, invocation_id: 'inv_1', producing_role: 'codex', parent_artifact_hash: null, payload: { job_id: 'wf_safe', objective: huge, constraints: [], allowed_file_scope: [], required_checks: [] }, validate: validateCodexBrief, timestamp: now });
    const file = path.join(root, '.orchestry', 'workflows', 'wf_safe', 'artifacts', stored.metadata.filename); const contents = await fs.readFile(file, 'utf8');
    expect(contents).toContain(huge); expect(stored.metadata.artifact_hash).toMatch(/^[a-f0-9]{64}$/); expect((await fs.stat(file)).mode & 0o777).toBe(0o600); expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  });

  it('rejects stale revisions, hashes, phase skips, and traversal', async () => {
    const first = await store.writeArtifact({ job_id: 'wf_safe', name: 'codex_brief', phase: 'codex_brief', revision: 1, invocation_id: 'inv_1', producing_role: 'codex', parent_artifact_hash: null, payload: { job_id: 'wf_safe', objective: 'x', constraints: [], allowed_file_scope: [], required_checks: [] }, validate: validateCodexBrief });
    await expect(store.writeArtifact({ job_id: 'wf_safe', name: 'codex_brief', phase: 'codex_brief', revision: 1, invocation_id: 'inv_2', producing_role: 'codex', parent_artifact_hash: first.metadata.artifact_hash, payload: first.payload, validate: validateCodexBrief })).rejects.toThrow('Stale artifact revision');
    await expect(store.transition('wf_safe', 'done')).rejects.toThrow('Invalid workflow phase transition');
    await expect(store.readJob('../escape')).rejects.toThrow('Invalid workflow job id');
  });

  it('redacts secrets and omits environment-shaped fields', async () => {
    await store.appendEvent({ schema_version: 1, job_id: 'wf_safe', type: 'note', timestamp: now, data: { message: 'token=supersecretvalue', env: { HOME: '/tmp' }, password: 'bad' } });
    expect((await store.readEvents('wf_safe'))[0]?.data).toEqual({ message: 'token=[REDACTED]' });
  });

  it('rejects malformed nested passport state before persistence', async () => {
    const passport = await store.readPassport('wf_safe'); expect(passport).not.toBeNull();
    await expect(store.writePassport({ ...passport!, passport_revision: 2, artifacts: [{ filename: '../escape', hash: 'a'.repeat(64), phase: 'codex_brief', revision: 1, iteration: 1, role: 'codex' }] })).rejects.toThrow('filename is invalid');
  });

  it('migrates earlier schema-v1 state conservatively', async () => {
    const workflowRoot = path.join(root, '.orchestry', 'workflows', 'wf_safe'); const job = JSON.parse(await fs.readFile(path.join(workflowRoot, 'job.json'), 'utf8')); delete job.target_branch; delete job.base_commit; delete job.reviewed_diff_hash; job.current_operation = { phase: 'codex_brief', invocation_id: 'inv_old', started_at: now }; await fs.writeFile(path.join(workflowRoot, 'job.json'), JSON.stringify(job));
    const passport = JSON.parse(await fs.readFile(path.join(workflowRoot, 'passport.json'), 'utf8')); delete passport.latest_accepted_plan; delete passport.hard_constraints; delete passport.target_branch; delete passport.base_commit; passport.config.post_review = 'risk_based'; passport.config.risk_triggers = ['security']; passport.decisions = [{ verdict: 'GO', reason: 'legacy', timestamp: now }]; await fs.writeFile(path.join(workflowRoot, 'passport.json'), JSON.stringify(passport));
    const sessions = JSON.parse(await fs.readFile(path.join(workflowRoot, 'sessions.json'), 'utf8')); delete sessions.recorded_invocations; await fs.writeFile(path.join(workflowRoot, 'sessions.json'), JSON.stringify(sessions));
    expect(await store.readJob('wf_safe')).toMatchObject({ target_branch: null, base_commit: null, reviewed_diff_hash: null, current_operation: { retry_count: 0 } }); expect(await store.readPassport('wf_safe')).toMatchObject({ latest_accepted_plan: null, hard_constraints: [], target_branch: null, base_commit: null, config: { post_review: 'always' }, decisions: [{ invocation_id: 'legacy_decision_1' }] }); expect((await store.readSessions('wf_safe'))?.recorded_invocations).toEqual([]);
  });
});
