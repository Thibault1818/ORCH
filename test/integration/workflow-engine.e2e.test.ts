import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkflowEngine } from '../../src/application/workflow/engine.js';
import type { CodexRolePort, FableCallOptions, FableRolePort, GitEvidence, OpusRolePort, WorkflowGitPort } from '../../src/application/workflow/ports.js';
import type { CheckResults, CodexBrief, CodexPlanReview, CodexSynthesis, CodexTechnicalReview, FableComplianceReview, FablePlan, OpusResult } from '../../src/domain/workflow/contracts.js';
import type { WorkflowPassportV1 } from '../../src/domain/workflow/state.js';
import { WorkflowArtifactStore, hashCanonical } from '../../src/infrastructure/workflow/artifact-store.js';
import { clearEnsuredDirs, closeAllAppendHandles } from '../../src/infrastructure/storage/fs-utils.js';

let root: string; let store: WorkflowArtifactStore; let fakes: Fakes; let engine: WorkflowEngine;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-e2e-')); store = new WorkflowArtifactStore(root); fakes = new Fakes(root); engine = makeEngine(store, fakes); });
afterEach(async () => { closeAllAppendHandles(); clearEnsuredDirs(); await fs.rm(root, { recursive: true, force: true }); });

describe('Codex-Fable-Opus workflow E2E', () => {
  it('runs the complete happy path through both reviews and strict merge', async () => {
    const id = await engine.start({ objective: 'security workflow', required_checks: ['test'] }); const result = await engine.run(id);
    expect(result.phase, result.blocker ?? undefined).toBe('done'); expect(fakes.merges).toBe(1); expect(fakes.mergeBeforeDoneApproval).toBe(false); expect(result.fable_pre_opus_calls).toBe(2); expect(result.fable_post_opus_calls).toBe(1);
    const passport = await store.readPassport(id); expect(passport?.artifacts).toHaveLength(10); expect(passport?.artifacts.every((a) => /-r\d{3}-a\d{6}/.test(a.filename))).toBe(true);
    expect(fakes.fableOptions.every((o) => o.max_turns === 1 && o.effort === 'low' && !o.workspace.startsWith(root))).toBe(true);
  });

  it('applies APPLY_AND_GO without another Codex plan review', async () => {
    fakes.planVerdicts = ['APPLY_AND_GO']; const id = await engine.start({ objective: 'small docs', required_checks: ['test'], config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('done'); expect(fakes.codexPlanReviews).toBe(1); expect(fakes.finalAmendments).toEqual(['bounded patch']);
  });

  it('forces re-review when APPLY_AND_GO changes are material', async () => {
    fakes.materialPatch = true; fakes.planVerdicts = ['APPLY_AND_GO', 'GO']; const id = await engine.start({ objective: 'x', required_checks: ['test'] }); const result = await engine.run(id); expect(result.phase).toBe('done'); expect(fakes.codexPlanReviews).toBe(2); expect(fakes.merges).toBe(1);
  });

  it('bounds REVISE and uses Codex final-prompt fallback at the cap', async () => {
    fakes.planVerdicts = ['REVISE', 'GO']; const id = await engine.start({ objective: 'x', required_checks: ['test'], config: { post_review: 'never' } }); const result = await engine.run(id); expect(result.phase).toBe('done'); expect(result.fable_pre_opus_calls).toBe(2); expect(fakes.codexPromptFallbacks).toBe(1);
  });

  it('does not retry a failed Fable call', async () => {
    fakes.failFable = true; const id = await engine.start({ objective: 'x', required_checks: ['test'] }); expect((await engine.run(id)).phase).toBe('failed'); expect(fakes.fablePlanCalls).toBe(1);
    expect((await store.readJob(id))?.fable_total_calls).toBe(1); expect((await store.readSessions(id))?.usage.fable).toMatchObject({ calls: 1, failed_calls: 1 });
  });

  it('pauses an interrupted reserved operation without another model call', async () => {
    const id = await engine.start({ objective: 'x', required_checks: ['test'] }); await store.patchJob(id, { current_operation: { phase: 'codex_brief', invocation_id: 'inv_interrupted', started_at: new Date().toISOString() } });
    const result = await engine.run(id); expect(result.phase).toBe('blocked'); expect(result.blocker).toContain('inv_interrupted'); expect((await store.readSessions(id))?.usage.codex.calls).toBe(0);
  });

  it('stops at the whole-workflow Fable cap', async () => {
    fakes.planVerdicts = ['REVISE']; const id = await engine.start({ objective: 'x', required_checks: ['test'], config: { fable_pre_opus_cap: 1, fable_total_cap: 1 } }); const result = await engine.run(id); expect(result.phase).toBe('blocked'); expect(result.fable_total_calls).toBe(1); expect(fakes.fablePlanCalls).toBe(1);
  });

  it.each([['always', false, 1], ['never', true, 0], ['risk_based', false, 0], ['risk_based', true, 1]] as const)('honors %s post-review with risk=%s', async (mode, risky, expected) => {
    fakes.risky = risky; const id = await engine.start({ objective: 'plain change', required_checks: ['test'], config: { post_review: mode } }); expect((await engine.run(id)).phase).toBe('done'); expect(fakes.complianceCalls).toBe(expected);
  });

  it('uses a passport handoff for a correction', async () => {
    fakes.synthesisVerdicts = ['REVISE', 'GO']; const id = await engine.start({ objective: 'x', required_checks: ['test'], config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('done'); expect(fakes.opusModes).toEqual(['new', 'passport_handoff']); expect(fakes.opusSessionInputs).toEqual([null, 'opus-session-1']);
  });

  it('allows one Fable review per Opus iteration during correction', async () => {
    fakes.synthesisVerdicts = ['REVISE', 'GO']; const id = await engine.start({ objective: 'security correction', required_checks: ['test'], config: { post_review: 'always' } }); const result = await engine.run(id); expect(result.phase).toBe('done'); expect(result.fable_post_opus_iteration_calls).toBe(1); expect(fakes.complianceCalls).toBe(2); expect(result.fable_total_calls).toBe(5);
  });

  it('pauses safely on STOP', async () => {
    fakes.synthesisVerdicts = ['STOP']; const id = await engine.start({ objective: 'x', required_checks: ['test'], config: { post_review: 'never' } }); const result = await engine.run(id); expect(result.phase).toBe('blocked'); expect(result.blocker).toContain('STOP:');
  });

  it('recovers persisted phase and sessions in a new engine', async () => {
    const id = await engine.start({ objective: 'x', required_checks: ['test'], config: { post_review: 'never' } }); await engine.pause(id); const restarted = makeEngine(new WorkflowArtifactStore(root), fakes); expect((await restarted.resume(id)).phase).toBe('done'); expect((await store.readSessions(id))?.codex_thread_id).toBe('codex-thread');
  });

  it('waits at the join barrier until the selected compliance review exists', async () => {
    const id = await engine.start({ objective: 'security', required_checks: ['test'], config: { post_review: 'always' } }); expect((await engine.run(id)).phase).toBe('done'); expect(fakes.synthesisSawCompliance).toBe(true); expect(fakes.sequence.indexOf('compliance')).toBeLessThan(fakes.sequence.indexOf('synthesis'));
  });

  it('never merges before DONE or when checks fail', async () => {
    fakes.checksPass = false; const id = await engine.start({ objective: 'x', required_checks: ['test'], config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('blocked'); expect(fakes.merges).toBe(0);
  });

  it('invalidates approval if the branch commit changes', async () => {
    fakes.staleAtMerge = true; const id = await engine.start({ objective: 'x', required_checks: ['test'], config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('failed'); expect(fakes.merges).toBe(0);
  });

  it('invalidates approval if the reviewed diff changes', async () => {
    fakes.staleDiffAtMerge = true; const id = await engine.start({ objective: 'x', required_checks: ['test'], config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('failed'); expect(fakes.merges).toBe(0);
  });

  it('fails closed on merge failure', async () => {
    fakes.mergeFails = true; const id = await engine.start({ objective: 'x', required_checks: ['test'], config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('failed'); expect(fakes.merges).toBe(1);
  });
});

class Fakes implements CodexRolePort, FableRolePort, OpusRolePort, WorkflowGitPort {
  planVerdicts: CodexPlanReview['verdict'][] = ['GO']; synthesisVerdicts: CodexSynthesis['verdict'][] = ['GO']; materialPatch = false; failFable = false; risky = true; checksPass = true; staleAtMerge = false; staleDiffAtMerge = false; mergeFails = false;
  revision = 1; commitIndex = 1; current = 'abcdef1'; codexPlanReviews = 0; codexPromptFallbacks = 0; fablePlanCalls = 0; complianceCalls = 0; opusCalls = 0; merges = 0; mergeBeforeDoneApproval = false; synthesisSawCompliance = false;
  fableOptions: FableCallOptions[] = []; finalAmendments: string[] = []; opusModes: string[] = []; opusSessionInputs: Array<string | null> = []; sequence: string[] = [];
  constructor(private root: string) {}
  async available() { return { available: true, detail: 'fake' }; }
  async brief(p: WorkflowPassportV1): Promise<{ value: CodexBrief; session_id: string }> { return { value: { job_id: p.job_id, objective: p.objective, constraints: [], allowed_file_scope: p.allowed_file_scope, required_checks: p.required_checks }, session_id: 'codex-thread' }; }
  async plan(p: WorkflowPassportV1, _b: CodexBrief, _previous: FablePlan | null, _changes: string[], options: FableCallOptions) { this.fablePlanCalls++; this.fableOptions.push(options); if (this.failFable) throw new Error('fable failed once'); return { value: plan(p) }; }
  async reviewPlan(p: WorkflowPassportV1, value: FablePlan) { this.codexPlanReviews++; const verdict = this.planVerdicts.shift() ?? 'GO'; const requiresReReview = this.materialPatch; this.materialPatch = false; return { value: { job_id: p.job_id, revision: value.revision, verdict, summary: verdict, required_changes: verdict === 'APPLY_AND_GO' ? ['bounded patch'] : verdict === 'REVISE' ? ['replan'] : [], requires_re_review: requiresReReview, risk_level: requiresReReview ? 'high' : 'low', reason: verdict, acceptance_criteria: value.acceptance_criteria } as CodexPlanReview, session_id: 'codex-thread', resumed: true }; }
  async finalPrompt(_p: WorkflowPassportV1, _plan: FablePlan, amendments: string[], options: FableCallOptions) { this.finalAmendments = amendments; this.fableOptions.push(options); return { value: 'Implement approved plan' }; }
  async compileFinalPrompt() { this.codexPromptFallbacks++; return { value: 'Codex fallback prompt', session_id: 'codex-thread' }; }
  async prepare(id: string) { const worktree = path.join(this.root, 'worktree', id); await fs.mkdir(worktree, { recursive: true }); return { branch: `branch/${id}`, worktree }; }
  async execute(p: WorkflowPassportV1, _prompt: string, _workspace: string, session: string | null, mode: 'new' | 'native_resume' | 'passport_handoff') { this.opusCalls++; this.opusModes.push(mode); this.opusSessionInputs.push(session); this.current = `abcdef${++this.commitIndex}`; return { value: { job_id: p.job_id, status: 'completed', files_changed: ['src/x.ts'], commands_run: ['test'], tests_reported: ['pass'], deviations: [], unresolved: [], summary: 'done' } as OpusResult, session_id: mode === 'new' ? `opus-session-${this.opusCalls}` : session ?? undefined, session_mode: mode }; }
  async inspect(branch: string, worktree: string): Promise<GitEvidence> { const changed = this.staleDiffAtMerge && this.sequence.at(-1) === 'synthesis'; return { branch, worktree, commit: this.current, diff: changed ? 'changed diff' : 'full diff', diff_hash: changed ? 'b'.repeat(64) : hashCanonical('full diff'), files_changed: ['src/x.ts'], insertions: 2, deletions: 1, risk_signals: this.risky ? ['security'] : [] }; }
  async runChecks(worktree: string, commit: string): Promise<CheckResults> { return { job_id: path.basename(worktree), commit, passed: this.checksPass, checks: [{ command: 'test', passed: this.checksPass, output: 'complete output' }] }; }
  async technicalReview(p: WorkflowPassportV1, evidence: GitEvidence, checks: CheckResults) { this.sequence.push('technical'); return { value: { job_id: p.job_id, reviewed_commit: evidence.commit, checks_passed: checks.passed, evidence: ['diff'], required_fixes: [], concise_reason: 'reviewed' } as CodexTechnicalReview, session_id: 'codex-thread', resumed: true }; }
  async compliance(p: WorkflowPassportV1, _plan: FablePlan, _opus: OpusResult, _evidence: GitEvidence, _checks: CheckResults, options: FableCallOptions) { this.complianceCalls++; this.sequence.push('compliance'); this.fableOptions.push(options); return { value: { job_id: p.job_id, approved_plan_hash: p.approved_plan_hash!, verdict: 'ALIGNED', plan_deviations: [], missing_requirements: [], recommended_repairs: [] } as FableComplianceReview }; }
  async synthesize(p: WorkflowPassportV1, _evidence: GitEvidence, technical: CodexTechnicalReview, compliance: FableComplianceReview | null, checks: CheckResults) { this.sequence.push('synthesis'); this.synthesisSawCompliance = compliance !== null; const verdict = this.synthesisVerdicts.shift() ?? 'GO'; const go = verdict === 'GO'; return { value: { job_id: p.job_id, reviewed_commit: technical.reviewed_commit, verdict, merge_allowed: go && checks.passed, evidence: [], summary: verdict, required_changes: verdict === 'REVISE' ? ['repair'] : [], requires_re_review: verdict === 'REVISE', risk_level: verdict === 'STOP' ? 'high' : 'low', reason: verdict } as CodexSynthesis, session_id: 'codex-thread', resumed: true }; }
  async currentCommit() { return this.staleAtMerge ? 'fffffff' : this.current; }
  async isMerged() { return false; }
  async merge() { this.merges++; this.mergeBeforeDoneApproval = this.sequence.at(-1) !== 'synthesis'; return this.mergeFails ? { success: false, detail: 'conflict' } : { success: true, detail: 'merged' }; }
}

function plan(p: WorkflowPassportV1): FablePlan { return { job_id: p.job_id, revision: p.current_revision, assumptions: [], acceptance_criteria: ['works'], implementation_steps: ['implement'], risks: [], questions_requiring_human: [] }; }
function makeEngine(workflowStore: WorkflowArtifactStore, fake: Fakes): WorkflowEngine { return new WorkflowEngine(workflowStore, { codex: fake, fable: fake, opus: fake, git: fake }); }
