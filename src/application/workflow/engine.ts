import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  validateCheckResults, validateCodexBrief, validateCodexPlanReview, validateCodexSynthesis,
  validateCodexTechnicalReview, validateFableComplianceReview, validateFablePlan, validateOpusResult,
  type CheckResults, type CodexBrief, type CodexPlanReview, type CodexTechnicalReview,
  type FableComplianceReview, type FablePlan, type OpusResult,
} from '../../domain/workflow/contracts.js';
import type { AgentUsage, WorkflowConfig, WorkflowJobV1, WorkflowPassportV1, WorkflowSessionsV1 } from '../../domain/workflow/state.js';
import { isTerminalWorkflowPhase, type WorkflowPhase } from '../../domain/workflow/transitions.js';
import { ARTIFACT_FILES, WorkflowArtifactStore, artifactReference, hashCanonical, type ArtifactName, type StoredArtifact } from '../../infrastructure/workflow/artifact-store.js';
import type { FableCallOptions, GitEvidence, RoleResult, WorkflowRolePorts } from './ports.js';

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  fable_pre_opus_cap: 2, fable_post_opus_per_iteration_cap: 1, fable_total_cap: 5,
  max_input_bytes: 128_000, max_output_bytes: 64_000, passport_max_bytes: 64_000,
  post_review: 'always', risk_triggers: ['authentication', 'security', 'secret', 'migration', 'deletion', 'billing', 'infrastructure', 'deployment', 'concurrency', 'compliance'],
  profiles: {
    fable: { model: 'fable', effort: 'low', max_turns: 1, timeout_ms: 300_000, permission_mode: 'read_only' },
    opus: { model: 'opus', effort: 'high', max_turns: 50, timeout_ms: 1_800_000, permission_mode: 'worktree' },
    codex: { model: 'codex', effort: 'medium', max_turns: 1, timeout_ms: 600_000, permission_mode: 'read_only' },
  },
};
export interface StartWorkflowInput { objective: string; allowed_file_scope?: string[]; required_checks?: string[]; config?: Partial<WorkflowConfig>; job_id?: string; }

export class WorkflowEngine {
  constructor(private readonly store: WorkflowArtifactStore, private readonly ports: WorkflowRolePorts) {}

  async start(input: StartWorkflowInput): Promise<string> {
    if (!input.objective.trim()) throw new Error('Workflow objective must not be empty');
    const id = input.job_id ?? `wf_${nanoid(12)}`; const now = new Date().toISOString();
    const config = { ...DEFAULT_WORKFLOW_CONFIG, ...input.config, profiles: { ...DEFAULT_WORKFLOW_CONFIG.profiles, ...input.config?.profiles } };
    if (config.fable_pre_opus_cap < 1 || config.fable_pre_opus_cap > 3) throw new Error('Fable pre-Opus cap must be between 1 and 3');
    if (config.fable_post_opus_per_iteration_cap < 0 || config.fable_total_cap < config.fable_pre_opus_cap) throw new Error('Invalid Fable call caps');
    const job: WorkflowJobV1 = { schema_version: 1, job_id: id, phase: 'codex_brief', resume_phase: null, revision: 1, artifact_revision: 0, latest_artifact_hash: null, fable_pre_opus_calls: 0, fable_post_opus_calls: 0, fable_post_opus_iteration_calls: 0, fable_total_calls: 0, fix_cycles: 0, opus_iteration: 1, branch: null, worktree: null, current_commit: null, approved_plan_hash: null, last_verdict: null, blocker: null, next_action: 'Codex creates the implementation brief', current_operation: null, created_at: now, updated_at: now };
    const requiredChecks = (input.required_checks ?? []).map((command) => command.trim()).filter(Boolean);
    const passport: WorkflowPassportV1 = { schema_version: 1, passport_revision: 1, job_id: id, current_revision: 1, objective: input.objective, current_phase: 'codex_brief', approved_plan_hash: null, acceptance_criteria: [], mandatory_amendments: [], decisions: [], allowed_file_scope: input.allowed_file_scope ?? [], required_checks: requiredChecks, current_blockers: [], next_action: job.next_action, artifacts: [], active_worktree: null, current_commit: null, session_references: { codex: null, fable: null, opus: null }, session_modes: { codex: 'none', fable: 'none', opus: 'none' }, rotation_history: [], config };
    const sessions: WorkflowSessionsV1 = { schema_version: 1, job_id: id, codex_thread_id: null, fable_session_id: null, opus_session_id: null, opus_plan_hash: null, modes: { codex: 'none', fable: 'none', opus: 'none' }, rotation_history: [], usage: { codex: usage(), fable: usage(), opus: usage() }, updated_at: now };
    await this.store.createJob(job, passport, sessions); await this.event(id, 'workflow_started', { objective: input.objective }); return id;
  }

  async run(jobId: string): Promise<WorkflowJobV1> {
    while (true) {
      const job = await this.requiredJob(jobId);
      if (isTerminalWorkflowPhase(job.phase) || job.phase === 'paused' || job.phase === 'blocked') return job;
      try {
        if (job.current_operation) { if (job.phase === 'merge_ready') { await this.step(job); continue; } await this.block(job, `Interrupted ${job.current_operation.phase} operation ${job.current_operation.invocation_id}; manual review is required before retry`); continue; }
        const operation = { phase: job.phase, invocation_id: `inv_${nanoid(12)}`, started_at: new Date().toISOString() };
        if (!await this.store.reserveOperation(job.job_id, job.phase, operation)) return this.requiredJob(job.job_id);
        await this.step({ ...job, current_operation: operation });
      }
      catch (error) { const reason = error instanceof Error ? error.message : String(error); await this.event(jobId, 'workflow_failed', { reason }); return this.store.transition(jobId, 'failed', { blocker: reason, next_action: 'Inspect workflow logs and artifacts' }); }
    }
  }

  async pause(jobId: string): Promise<WorkflowJobV1> { const job = await this.requiredJob(jobId); if (isTerminalWorkflowPhase(job.phase) || job.phase === 'paused') throw new Error(`Cannot pause workflow in ${job.phase}`); return this.transition(job, 'paused', { resume_phase: job.phase, next_action: 'Resume workflow' }); }
  async resume(jobId: string, approveStop = false): Promise<WorkflowJobV1> { const job = await this.requiredJob(jobId); if (job.phase !== 'paused' && job.phase !== 'blocked') throw new Error(`Cannot resume workflow in ${job.phase}`); if (!job.resume_phase) throw new Error('Workflow has no recoverable phase'); if (job.blocker?.startsWith('STOP:') && !approveStop) throw new Error('STOP requires explicit --approve-stop confirmation'); const resumed = await this.transition(job, job.resume_phase, { blocker: null, resume_phase: null, current_operation: null }); await this.event(jobId, 'workflow_resumed', { phase: resumed.phase }); return this.run(jobId); }
  async cancel(jobId: string): Promise<WorkflowJobV1> { const job = await this.requiredJob(jobId); if (isTerminalWorkflowPhase(job.phase)) throw new Error(`Cannot cancel workflow in ${job.phase}`); return this.transition(job, 'cancelled', { next_action: 'No further action' }); }

  private async step(job: WorkflowJobV1): Promise<void> {
    switch (job.phase) {
      case 'codex_brief': return this.codexBrief(job);
      case 'fable_plan': return this.fablePlan(job);
      case 'codex_plan_review': return this.codexPlanReview(job);
      case 'fable_final_prompt': return this.finalPrompt(job);
      case 'opus_execution': return this.opusExecution(job);
      case 'codex_technical_review': return this.technicalReview(job);
      case 'fable_compliance_review': return this.complianceReview(job);
      case 'codex_synthesis': return this.synthesis(job);
      case 'merge_ready': return this.merge(job);
      default: throw new Error(`No workflow action for phase ${job.phase}`);
    }
  }

  private async codexBrief(job: WorkflowJobV1): Promise<void> {
    const { passport, sessions } = await this.context(job.job_id); const result = await this.ports.codex.brief(passport, sessions.codex_thread_id); const brief = validateCodexBrief(result.value); this.assertJob(job, brief.job_id);
    await this.recordRole(job.job_id, 'codex', result); const stored = await this.artifact(job, 'codex_brief', 'codex', brief, validateCodexBrief); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_brief);
    await this.transition(await this.requiredJob(job.job_id), 'fable_plan', { next_action: 'Fable creates plan revision 1' });
  }

  private async fablePlan(job: WorkflowJobV1): Promise<void> {
    const passportBefore = await this.requiredPassport(job.job_id); if (!await this.reserveFable(job, 'pre')) return this.block(job, 'Fable call cap reached before an approvable plan');
    const { passport } = await this.context(job.job_id); const brief = await this.payload<CodexBrief>(job, 'codex_brief', 1); const previous = job.revision > 1 ? await this.optionalPayload<FablePlan>(job, 'fable_plan', job.revision - 1) : null;
    const options = await this.fableOptions(passport); const result = await this.fableCall(job.job_id, options, () => this.ports.fable.plan(passport, brief, previous, passport.mandatory_amendments, options)); this.assertFableOutput(passportBefore, result.value); const plan = validateFablePlan(result.value); this.assertJob(job, plan.job_id); if (plan.revision !== job.revision) throw new Error('Stale Fable plan revision');
    await this.recordRole(job.job_id, 'fable', result); const fresh = await this.requiredJob(job.job_id); const stored = await this.artifact(fresh, 'fable_plan', 'fable', plan, validateFablePlan); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.fable_plan.replace('%REV%', String(job.revision).padStart(3, '0')));
    await this.updatePassport(job.job_id, { acceptance_criteria: plan.acceptance_criteria, current_revision: job.revision }); await this.transition(await this.requiredJob(job.job_id), 'codex_plan_review', { next_action: `Codex reviews plan revision ${job.revision}` });
  }

  private async codexPlanReview(job: WorkflowJobV1): Promise<void> {
    const { passport, sessions } = await this.context(job.job_id); const plan = await this.payload<FablePlan>(job, 'fable_plan'); const result = await this.ports.codex.reviewPlan(passport, plan, sessions.codex_thread_id); const review = validateCodexPlanReview(result.value); this.assertJob(job, review.job_id); if (review.revision !== job.revision) throw new Error('Stale Codex plan review revision');
    await this.recordRole(job.job_id, 'codex', result); const stored = await this.artifact(job, 'codex_plan_review', 'codex', review, validateCodexPlanReview); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_plan_review.replace('%REV%', String(job.revision).padStart(3, '0'))); await this.decision(job.job_id, review.verdict, review.reason);
    const fresh = await this.requiredJob(job.job_id);
    if (review.verdict === 'STOP') return this.block(fresh, `STOP: ${review.reason}`);
    if (review.verdict === 'REVISE' || review.requires_re_review) { await this.updatePassport(job.job_id, { mandatory_amendments: review.required_changes }); await this.transition(fresh, 'fable_plan', { revision: job.revision + 1, last_verdict: review.verdict, next_action: `Fable creates plan revision ${job.revision + 1}` }); return; }
    const approvedHash = hashCanonical(plan); await this.updatePassport(job.job_id, { approved_plan_hash: approvedHash, acceptance_criteria: review.acceptance_criteria, mandatory_amendments: review.required_changes }); await this.transition(fresh, 'fable_final_prompt', { approved_plan_hash: approvedHash, last_verdict: review.verdict, next_action: 'Compile final Opus prompt' });
  }

  private async finalPrompt(job: WorkflowJobV1): Promise<void> {
    const { passport, sessions } = await this.context(job.job_id); const plan = await this.payload<FablePlan>(job, 'fable_plan'); let result: RoleResult<string>; let role: 'fable' | 'codex';
    const fablePhase = job.fix_cycles > 0 ? 'correction' : 'pre';
    if ((job.fix_cycles > 0 || job.fable_pre_opus_calls < passport.config.fable_pre_opus_cap) && await this.reserveFable(job, fablePhase)) { const options = await this.fableOptions(passport); result = await this.fableCall(job.job_id, options, () => this.ports.fable.finalPrompt(passport, plan, passport.mandatory_amendments, options)); this.assertFableOutput(passport, result.value); role = 'fable'; }
    else { result = await this.ports.codex.compileFinalPrompt(passport, plan, sessions.codex_thread_id); role = 'codex'; await this.event(job.job_id, 'fable_cap_fallback', { role: 'codex' }); }
    if (typeof result.value !== 'string' || !result.value.trim()) throw new Error('Final prompt must be non-empty'); await this.recordRole(job.job_id, role, result);
    const fresh = await this.requiredJob(job.job_id); const stored = await this.store.writeTextArtifact({ job_id: job.job_id, name: 'fable_final_prompt', phase: 'fable_final_prompt', revision: fresh.artifact_revision + 1, producing_role: role, parent_artifact_hash: fresh.latest_artifact_hash, payload: result.value }); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.fable_final_prompt);
    let prepared = { branch: fresh.branch, worktree: fresh.worktree }; if (!prepared.branch || !prepared.worktree) prepared = await this.ports.git.prepare(job.job_id);
    await this.transition(await this.requiredJob(job.job_id), 'opus_execution', { branch: prepared.branch, worktree: prepared.worktree, next_action: 'Opus implements in dedicated worktree' });
    await this.updatePassport(job.job_id, { active_worktree: prepared.worktree });
  }

  private async opusExecution(job: WorkflowJobV1): Promise<void> {
    if (!job.worktree || !job.branch) throw new Error('Opus worktree is missing'); const { passport, sessions } = await this.context(job.job_id); const prompt = await this.textPayload(job, 'fable_final_prompt'); const mode = sessions.opus_session_id && sessions.opus_plan_hash === job.approved_plan_hash ? 'passport_handoff' : 'new';
    const result = await this.ports.opus.execute(passport, prompt, job.worktree, mode === 'passport_handoff' ? sessions.opus_session_id : null, mode); const opus = validateOpusResult(result.value); this.assertJob(job, opus.job_id); await this.recordRole(job.job_id, 'opus', result);
    const stored = await this.artifact(job, 'opus_report', 'opus', opus, validateOpusResult); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.opus_report); if (opus.status !== 'completed' || opus.unresolved.length > 0) throw new Error(`Opus execution is not complete: ${opus.summary}`);
    const evidence = await this.ports.git.inspect(job.branch, job.worktree); this.assertAllowedScope(passport, evidence.files_changed); const fresh = await this.requiredJob(job.job_id); const diffStored = await this.store.writeTextArtifact({ job_id: job.job_id, name: 'opus_diff', phase: 'opus_execution', revision: fresh.artifact_revision + 1, producing_role: 'orchestrator', parent_artifact_hash: fresh.latest_artifact_hash, payload: evidence.diff || '(empty diff)' }); await this.addArtifact(job.job_id, diffStored, ARTIFACT_FILES.opus_diff);
    await this.transition(await this.requiredJob(job.job_id), 'codex_technical_review', { current_commit: evidence.commit, next_action: 'Run checks and Codex technical review' }); await this.updatePassport(job.job_id, { current_commit: evidence.commit });
  }

  private async technicalReview(job: WorkflowJobV1): Promise<void> {
    if (!job.branch || !job.worktree) throw new Error('Worktree evidence is missing'); const { passport } = await this.context(job.job_id); const evidence = await this.ports.git.inspect(job.branch, job.worktree); const checks = validateCheckResults(await this.ports.git.runChecks(job.worktree, evidence.commit, passport.required_checks)); this.assertJob(job, checks.job_id); if (checks.commit !== evidence.commit) throw new Error('Check results are stale');
    let fresh = await this.requiredJob(job.job_id); const checkStored = await this.artifact(fresh, 'test_results', 'orchestrator', checks, validateCheckResults); await this.addArtifact(job.job_id, checkStored, ARTIFACT_FILES.test_results);
    const review: CodexTechnicalReview = { job_id: job.job_id, reviewed_commit: evidence.commit, checks_passed: checks.passed, evidence: [evidence.diff_hash, ...checks.checks.map((check) => check.command)], required_fixes: checks.passed ? [] : ['Resolve failed verification checks'], concise_reason: 'Deterministic evidence package prepared for final Codex review' }; fresh = await this.requiredJob(job.job_id); const stored = await this.artifact(fresh, 'codex_technical_review', 'orchestrator', review, validateCodexTechnicalReview); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_technical_review);
    const needsFable = passport.config.post_review === 'always' || (passport.config.post_review === 'risk_based' && this.isRisky(passport, evidence)); await this.transition(await this.requiredJob(job.job_id), needsFable ? 'fable_compliance_review' : 'codex_synthesis', { current_commit: evidence.commit, next_action: needsFable ? 'Fable checks plan compliance' : 'Codex synthesizes evidence' });
  }

  private async complianceReview(job: WorkflowJobV1): Promise<void> {
    const { passport } = await this.context(job.job_id); if (!job.branch || !job.worktree) throw new Error('Worktree evidence is missing'); if (!await this.reserveFable(job, 'post')) return this.block(job, 'Fable post-Opus or whole-workflow call cap reached'); const plan = await this.payload<FablePlan>(job, 'fable_plan'); const opus = await this.payload<OpusResult>(job, 'opus_report'); const checks = await this.payload<CheckResults>(job, 'test_results'); const evidence = await this.ports.git.inspect(job.branch, job.worktree); if (evidence.commit !== checks.commit) throw new Error('Compliance evidence is stale');
    const options = await this.fableOptions(passport); const result = await this.fableCall(job.job_id, options, () => this.ports.fable.compliance(passport, plan, opus, evidence, checks, options)); this.assertFableOutput(passport, result.value); const review = validateFableComplianceReview(result.value); this.assertJob(job, review.job_id); if (review.approved_plan_hash !== job.approved_plan_hash) throw new Error('Fable compliance review used stale plan'); await this.recordRole(job.job_id, 'fable', result); const fresh = await this.requiredJob(job.job_id); const stored = await this.artifact(fresh, 'fable_compliance_review', 'fable', review, validateFableComplianceReview); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.fable_compliance_review); await this.transition(await this.requiredJob(job.job_id), 'codex_synthesis', { next_action: 'Codex synthesizes both reviews' });
  }

  private async synthesis(job: WorkflowJobV1): Promise<void> {
    const { passport, sessions } = await this.context(job.job_id); if (!job.branch || !job.worktree) throw new Error('Worktree evidence is missing'); const evidence = await this.ports.git.inspect(job.branch, job.worktree); const technical = await this.payload<CodexTechnicalReview>(job, 'codex_technical_review'); const checks = await this.payload<CheckResults>(job, 'test_results'); const compliance = await this.optionalPayload<FableComplianceReview>(job, 'fable_compliance_review'); const result = await this.ports.codex.synthesize(passport, evidence, technical, compliance, checks, sessions.codex_thread_id); const synthesis = validateCodexSynthesis(result.value); this.assertJob(job, synthesis.job_id); if (synthesis.reviewed_commit !== technical.reviewed_commit || synthesis.reviewed_commit !== checks.commit || synthesis.reviewed_commit !== evidence.commit) throw new Error('Synthesis reviewed_commit is stale'); await this.recordRole(job.job_id, 'codex', result); const fresh = await this.requiredJob(job.job_id); const stored = await this.artifact(fresh, 'codex_synthesis', 'codex', synthesis, validateCodexSynthesis); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_synthesis); await this.decision(job.job_id, synthesis.verdict, synthesis.reason); const current = await this.requiredJob(job.job_id);
    if (synthesis.verdict === 'STOP') return this.block(current, `STOP: ${synthesis.reason}`);
    if (synthesis.verdict === 'REVISE') { if (job.fix_cycles >= 3) return this.block(current, 'Bounded correction cycle cap reached'); await this.updatePassport(job.job_id, { mandatory_amendments: synthesis.required_changes }); await this.transition(current, 'fable_final_prompt', { fix_cycles: job.fix_cycles + 1, opus_iteration: job.opus_iteration + 1, fable_post_opus_iteration_calls: 0, last_verdict: 'REVISE', next_action: 'Fable creates compact correction instructions' }); return; }
    if (synthesis.requires_re_review) return this.block(current, 'Codex GO requires another review and cannot merge'); if (!synthesis.merge_allowed || !checks.passed || checks.checks.length === 0 || !technical.checks_passed || passport.required_checks.length === 0) return this.block(current, 'Meaningful project verification is required before merge'); await this.transition(current, 'merge_ready', { last_verdict: 'GO', current_commit: synthesis.reviewed_commit, next_action: 'Verify immutable approval and merge' });
  }

  private async merge(job: WorkflowJobV1): Promise<void> {
    if (!job.branch || !job.worktree || !job.current_commit) throw new Error('Merge metadata is missing'); const synthesis = await this.payload<import('../../domain/workflow/contracts.js').CodexSynthesis>(job, 'codex_synthesis'); const checks = await this.payload<CheckResults>(job, 'test_results'); const reviewedDiff = await this.textPayload(job, 'opus_diff'); const actual = await this.ports.git.currentCommit(job.branch); const approvalValid = synthesis.verdict === 'GO' && synthesis.merge_allowed && !synthesis.requires_re_review && checks.passed && checks.checks.length > 0 && synthesis.reviewed_commit === checks.commit && actual === synthesis.reviewed_commit; if (approvalValid && await this.ports.git.isMerged(job.branch, actual)) { await this.transition(job, 'done', { next_action: 'Workflow complete' }); await this.event(job.job_id, 'merge_reconciled', { commit: actual }); return; } const evidence = await this.ports.git.inspect(job.branch, job.worktree);
    const rechecked = validateCheckResults(await this.ports.git.runChecks(job.worktree, evidence.commit, (await this.requiredPassport(job.job_id)).required_checks));
    if (synthesis.verdict !== 'GO' || !synthesis.merge_allowed || !checks.passed || !rechecked.passed || rechecked.checks.length === 0 || synthesis.reviewed_commit !== checks.commit || rechecked.commit !== checks.commit || actual !== synthesis.reviewed_commit || evidence.commit !== synthesis.reviewed_commit || evidence.diff_hash !== hashCanonical(reviewedDiff)) throw new Error('Merge approval is stale or incomplete'); const merged = await this.ports.git.merge(job.branch); if (!merged.success) throw new Error(`Merge failed closed: ${merged.detail}`); await this.transition(job, 'done', { next_action: 'Workflow complete' }); await this.event(job.job_id, 'workflow_done', { commit: actual, diff_hash: evidence.diff_hash });
  }

  private async artifact<T>(job: WorkflowJobV1, name: ArtifactName, role: 'codex' | 'fable' | 'opus' | 'orchestrator', value: unknown, validate: (v: unknown) => T): Promise<StoredArtifact<T>> { const fresh = await this.requiredJob(job.job_id); return this.store.writeArtifact({ job_id: job.job_id, name, phase: fresh.phase, revision: fresh.artifact_revision + 1, producing_role: role, parent_artifact_hash: fresh.latest_artifact_hash, payload: value, validate }); }
  private async payload<T>(job: WorkflowJobV1, name: ArtifactName, revision = job.revision): Promise<T> { const result = await this.store.readArtifact<T>(job.job_id, name, revision); if (!result) throw new Error(`Required artifact missing: ${name}`); return result.payload; }
  private async optionalPayload<T>(job: WorkflowJobV1, name: ArtifactName, revision = job.revision): Promise<T | null> { return (await this.store.readArtifact<T>(job.job_id, name, revision))?.payload ?? null; }
  private async textPayload(job: WorkflowJobV1, name: ArtifactName): Promise<string> { const result = await this.store.readTextArtifact(job.job_id, name, job.revision); if (!result) throw new Error(`Required text artifact missing: ${name}`); return result.payload; }
  private async transition(job: WorkflowJobV1, phase: WorkflowPhase, patch: Partial<WorkflowJobV1> = {}): Promise<WorkflowJobV1> { const updated = await this.store.transition(job.job_id, phase, { ...patch, current_operation: null }); await this.updatePassport(job.job_id, { current_phase: phase, current_revision: updated.revision, next_action: updated.next_action, current_blockers: updated.blocker ? [updated.blocker] : [] }); await this.event(job.job_id, 'phase_changed', { from: job.phase, to: phase }); return updated; }
  private async block(job: WorkflowJobV1, reason: string): Promise<void> { await this.transition(job, 'blocked', { blocker: reason, resume_phase: job.phase, next_action: 'Provide human input, then resume' }); await this.event(job.job_id, 'workflow_blocked', { reason }); }
  private async addArtifact(jobId: string, stored: StoredArtifact<unknown>, filename: string): Promise<void> { const passport = await this.requiredPassport(jobId); await this.updatePassport(jobId, { artifacts: [...passport.artifacts, artifactReference(filename, stored)] }); }
  private async decision(jobId: string, verdict: string, reason: string): Promise<void> { const passport = await this.requiredPassport(jobId); await this.updatePassport(jobId, { decisions: [...passport.decisions, { verdict, reason, timestamp: new Date().toISOString() }] }); }
  private async updatePassport(jobId: string, patch: Partial<WorkflowPassportV1>): Promise<void> { const passport = await this.requiredPassport(jobId); const updated = { ...passport, ...patch, passport_revision: passport.passport_revision + 1, schema_version: 1 as const, job_id: passport.job_id }; if (Buffer.byteLength(JSON.stringify(updated)) > updated.config.passport_max_bytes) throw new Error('Workflow passport exceeded configured maximum'); await this.store.writePassport(updated); }
  async rotateSession(jobId: string, role: 'codex' | 'fable' | 'opus', reason: string): Promise<void> { const sessions = await this.requiredSessions(jobId); const key = role === 'codex' ? 'codex_thread_id' : role === 'fable' ? 'fable_session_id' : 'opus_session_id'; const previous = sessions[key]; const rotation = { role, previous_id: previous, next_id: null, reason: reason.trim() || 'manual rotation', timestamp: new Date().toISOString() }; const updated = { ...sessions, [key]: null, ...(role === 'opus' ? { opus_plan_hash: null } : {}), modes: { ...sessions.modes, [role]: 'none' as const }, rotation_history: [...sessions.rotation_history, rotation], updated_at: rotation.timestamp }; await this.store.writeSessions(updated); await this.updatePassport(jobId, { session_references: { codex: updated.codex_thread_id, fable: updated.fable_session_id, opus: updated.opus_session_id }, session_modes: updated.modes, rotation_history: updated.rotation_history }); await this.event(jobId, 'session_rotated', rotation); }
  private async recordRole<T>(jobId: string, role: 'codex' | 'fable' | 'opus', result: RoleResult<T>): Promise<void> { const sessions = await this.requiredSessions(jobId); const u = sessions.usage[role]; const inputChars = result.usage?.input_chars ?? 0; const outputChars = result.usage?.output_chars ?? Buffer.byteLength(typeof result.value === 'string' ? result.value : JSON.stringify(result.value)); const nextUsage: AgentUsage = { calls: u.calls + 1, input_chars: u.input_chars + inputChars, output_chars: u.output_chars + outputChars, input_tokens: u.input_tokens + (result.usage?.input_tokens ?? 0), output_tokens: u.output_tokens + (result.usage?.output_tokens ?? 0), estimated_tokens: u.estimated_tokens + Math.ceil((inputChars + outputChars) / 4), cache_read: u.cache_read + (result.usage?.cache_read ?? 0), cache_write: u.cache_write + (result.usage?.cache_write ?? 0), duration_ms: u.duration_ms + (result.usage?.duration_ms ?? 0), failed_calls: u.failed_calls, resumes: u.resumes + (result.resumed ? 1 : 0), compactions: u.compactions + (result.usage?.compactions ?? 0) }; const job = await this.requiredJob(jobId); const mode = result.session_mode ?? (result.resumed ? 'native_resume' : result.resume_failed ? 'passport_handoff' : result.session_id ? 'new' : 'none'); const updated: WorkflowSessionsV1 = { ...sessions, codex_thread_id: role === 'codex' ? result.session_id ?? sessions.codex_thread_id : sessions.codex_thread_id, fable_session_id: role === 'fable' ? result.session_id ?? sessions.fable_session_id : sessions.fable_session_id, opus_session_id: role === 'opus' ? result.session_id ?? sessions.opus_session_id : sessions.opus_session_id, opus_plan_hash: role === 'opus' ? job.approved_plan_hash : sessions.opus_plan_hash, modes: { ...sessions.modes, [role]: mode }, usage: { ...sessions.usage, [role]: nextUsage }, updated_at: new Date().toISOString() }; await this.store.writeSessions(updated); await this.updatePassport(jobId, { session_references: { codex: updated.codex_thread_id, fable: updated.fable_session_id, opus: updated.opus_session_id }, session_modes: updated.modes }); if (result.resume_failed) await this.event(jobId, 'session_resume_fallback', { role }); }
  private async fableOptions(passport: WorkflowPassportV1): Promise<FableCallOptions> { const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-fable-empty-')); return { workspace, model: passport.config.profiles.fable.model, max_turns: 1, effort: 'low', timeout_ms: passport.config.profiles.fable.timeout_ms, max_input_bytes: passport.config.max_input_bytes, max_output_bytes: passport.config.max_output_bytes }; }
  private async fableCall<T>(jobId: string, options: FableCallOptions, call: () => Promise<T>): Promise<T> { try { return await call(); } catch (error) { const sessions = await this.requiredSessions(jobId); const u = sessions.usage.fable; await this.store.writeSessions({ ...sessions, usage: { ...sessions.usage, fable: { ...u, calls: u.calls + 1, failed_calls: u.failed_calls + 1 } }, updated_at: new Date().toISOString() }); throw error; } finally { await fs.rm(options.workspace, { recursive: true, force: true }); } }
  private async reserveFable(job: WorkflowJobV1, phase: 'pre' | 'post' | 'correction'): Promise<boolean> { const passport = await this.requiredPassport(job.job_id); const current = await this.requiredJob(job.job_id); if (current.fable_total_calls >= passport.config.fable_total_cap) return false; if (phase === 'pre' && current.fable_pre_opus_calls >= passport.config.fable_pre_opus_cap) return false; if (phase === 'post' && current.fable_post_opus_iteration_calls >= passport.config.fable_post_opus_per_iteration_cap) return false; await this.store.patchJob(job.job_id, { fable_total_calls: current.fable_total_calls + 1, fable_pre_opus_calls: current.fable_pre_opus_calls + (phase === 'pre' ? 1 : 0), fable_post_opus_calls: current.fable_post_opus_calls + (phase === 'post' ? 1 : 0), fable_post_opus_iteration_calls: current.fable_post_opus_iteration_calls + (phase === 'post' ? 1 : 0) }); return true; }
  private assertFableOutput(passport: WorkflowPassportV1, value: unknown): void { if (Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value)) > passport.config.max_output_bytes) throw new Error('Fable output exceeded configured maximum'); }
  private assertAllowedScope(passport: WorkflowPassportV1, files: string[]): void { if (passport.allowed_file_scope.length === 0) return; const outside = files.filter((file) => !passport.allowed_file_scope.some((allowed) => file === allowed || file.startsWith(`${allowed.replace(/\/$/, '')}/`))); if (outside.length) throw new Error(`Opus changed files outside approved scope: ${outside.join(', ')}`); }
  private isRisky(passport: WorkflowPassportV1, evidence: GitEvidence): boolean { const text = `${passport.objective} ${evidence.risk_signals.join(' ')}`.toLowerCase(); return passport.config.risk_triggers.some((trigger) => text.includes(trigger.toLowerCase())) || evidence.files_changed.length >= 20; }
  private assertJob(job: WorkflowJobV1, received: string): void { if (received !== job.job_id) throw new Error(`Artifact job_id mismatch: ${received}`); }
  private async context(jobId: string): Promise<{ passport: WorkflowPassportV1; sessions: WorkflowSessionsV1 }> { return { passport: await this.requiredPassport(jobId), sessions: await this.requiredSessions(jobId) }; }
  private async requiredJob(id: string): Promise<WorkflowJobV1> { const value = await this.store.readJob(id); if (!value) throw new Error(`Workflow job not found: ${id}`); return value; }
  private async requiredPassport(id: string): Promise<WorkflowPassportV1> { const value = await this.store.readPassport(id); if (!value) throw new Error(`Workflow passport not found: ${id}`); return value; }
  private async requiredSessions(id: string): Promise<WorkflowSessionsV1> { const value = await this.store.readSessions(id); if (!value) throw new Error(`Workflow sessions not found: ${id}`); return value; }
  private async event(id: string, type: string, data: unknown): Promise<void> { await this.store.appendEvent({ schema_version: 1, job_id: id, type, timestamp: new Date().toISOString(), data }); }
}

function usage(): AgentUsage { return { calls: 0, input_chars: 0, output_chars: 0, input_tokens: 0, output_tokens: 0, estimated_tokens: 0, cache_read: 0, cache_write: 0, duration_ms: 0, failed_calls: 0, resumes: 0, compactions: 0 }; }
