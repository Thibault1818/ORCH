import { isTerminalWorkflowPhase, ARTIFACT_FILES, hashCanonical, artifactReference } from './chunk-D46P56MG.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { nanoid } from 'nanoid';

// src/domain/workflow/contracts.ts
var WORKFLOW_SCHEMA_VERSION = 1;
function validateCodexBrief(value) {
  const o = exact(value, ["job_id", "objective", "constraints", "allowed_file_scope", "required_checks"], "Codex brief");
  return { job_id: id(o.job_id), objective: nonEmpty(o.objective, "objective"), constraints: strings(o.constraints, "constraints"), allowed_file_scope: strings(o.allowed_file_scope, "allowed_file_scope"), required_checks: strings(o.required_checks, "required_checks") };
}
function validateFablePlan(value) {
  const o = exact(value, ["job_id", "revision", "assumptions", "acceptance_criteria", "implementation_steps", "risks", "questions_requiring_human"], "Fable plan");
  return { job_id: id(o.job_id), revision: revision(o.revision), assumptions: strings(o.assumptions, "assumptions"), acceptance_criteria: strings(o.acceptance_criteria, "acceptance_criteria"), implementation_steps: strings(o.implementation_steps, "implementation_steps"), risks: strings(o.risks, "risks"), questions_requiring_human: strings(o.questions_requiring_human, "questions_requiring_human") };
}
function validateCodexPlanReview(value) {
  const o = exact(value, ["job_id", "revision", "verdict", "summary", "required_changes", "requires_re_review", "risk_level", "reason", "acceptance_criteria"], "Codex plan review");
  const verdict = enumeration(o.verdict, ["GO", "APPLY_AND_GO", "REVISE", "STOP"], "verdict");
  const requiredChanges = strings(o.required_changes, "required_changes");
  const requiresReReview = bool(o.requires_re_review, "requires_re_review");
  if (verdict === "APPLY_AND_GO" && requiredChanges.length === 0) throw new Error("APPLY_AND_GO requires required_changes");
  if (verdict === "GO" && requiredChanges.length > 0) throw new Error("GO cannot include required_changes");
  if (verdict === "GO" && requiresReReview) throw new Error("GO cannot require re-review");
  return { job_id: id(o.job_id), revision: revision(o.revision), verdict, summary: nonEmpty(o.summary, "summary"), required_changes: requiredChanges, requires_re_review: requiresReReview, risk_level: enumeration(o.risk_level, ["low", "medium", "high"], "risk_level"), reason: nonEmpty(o.reason, "reason"), acceptance_criteria: strings(o.acceptance_criteria, "acceptance_criteria") };
}
function validateOpusResult(value) {
  const o = exact(value, ["job_id", "status", "files_changed", "commands_run", "tests_reported", "deviations", "unresolved", "summary"], "Opus result");
  return { job_id: id(o.job_id), status: enumeration(o.status, ["completed", "partial", "failed"], "status"), files_changed: strings(o.files_changed, "files_changed"), commands_run: strings(o.commands_run, "commands_run"), tests_reported: strings(o.tests_reported, "tests_reported"), deviations: strings(o.deviations, "deviations"), unresolved: strings(o.unresolved, "unresolved"), summary: nonEmpty(o.summary, "summary") };
}
function validateFableComplianceReview(value) {
  const o = exact(value, ["job_id", "approved_plan_hash", "verdict", "plan_deviations", "missing_requirements", "recommended_repairs"], "Fable compliance review");
  return { job_id: id(o.job_id), approved_plan_hash: hash(o.approved_plan_hash), verdict: enumeration(o.verdict, ["ALIGNED", "GAPS_FOUND", "UNCERTAIN"], "verdict"), plan_deviations: strings(o.plan_deviations, "plan_deviations"), missing_requirements: strings(o.missing_requirements, "missing_requirements"), recommended_repairs: strings(o.recommended_repairs, "recommended_repairs") };
}
function validateCodexTechnicalReview(value) {
  const o = exact(value, ["job_id", "reviewed_commit", "checks_passed", "evidence", "required_fixes", "concise_reason"], "Codex technical review");
  return { job_id: id(o.job_id), reviewed_commit: commit(o.reviewed_commit), checks_passed: bool(o.checks_passed, "checks_passed"), evidence: strings(o.evidence, "evidence"), required_fixes: strings(o.required_fixes, "required_fixes"), concise_reason: nonEmpty(o.concise_reason, "concise_reason") };
}
function validateCodexSynthesis(value) {
  const o = exact(value, ["job_id", "reviewed_commit", "verdict", "merge_allowed", "evidence", "summary", "required_changes", "requires_re_review", "risk_level", "reason"], "Codex synthesis");
  const verdict = enumeration(o.verdict, ["GO", "REVISE", "STOP"], "verdict");
  const mergeAllowed = bool(o.merge_allowed, "merge_allowed");
  const requiredChanges = strings(o.required_changes, "required_changes");
  if (mergeAllowed && verdict !== "GO") throw new Error("merge_allowed requires GO");
  if (verdict === "GO" && requiredChanges.length > 0) throw new Error("GO cannot include required_changes");
  const requiresReReview = bool(o.requires_re_review, "requires_re_review");
  if (mergeAllowed && requiresReReview) throw new Error("merge_allowed cannot require re-review");
  return { job_id: id(o.job_id), reviewed_commit: commit(o.reviewed_commit), verdict, merge_allowed: mergeAllowed, evidence: strings(o.evidence, "evidence"), summary: nonEmpty(o.summary, "summary"), required_changes: requiredChanges, requires_re_review: requiresReReview, risk_level: enumeration(o.risk_level, ["low", "medium", "high"], "risk_level"), reason: nonEmpty(o.reason, "reason") };
}
function validateCheckResults(value) {
  const o = exact(value, ["job_id", "commit", "passed", "checks"], "Check results");
  const checks = array(o.checks, "checks").map((item, index) => {
    const c = exact(item, ["command", "passed", "output"], `checks[${index}]`);
    return { command: nonEmpty(c.command, "command"), passed: bool(c.passed, "passed"), output: text(c.output, "output") };
  });
  const passed = bool(o.passed, "passed");
  if (passed !== checks.every((check) => check.passed)) throw new Error("Check aggregate does not match individual results");
  return { job_id: id(o.job_id), commit: commit(o.commit), passed, checks };
}
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value;
  for (const key of keys) if (!(key in object)) throw new Error(`${label} is missing ${key}`);
  const allowed = new Set(keys);
  for (const key of Object.keys(object)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  return object;
}
function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function text(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function nonEmpty(value, label) {
  const result = text(value, label);
  if (!result.trim()) throw new Error(`${label} must not be empty`);
  return result;
}
function strings(value, label) {
  return array(value, label).map((v, i) => text(v, `${label}[${i}]`));
}
function bool(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("revision must be a positive integer");
  return value;
}
function id(value) {
  const result = nonEmpty(value, "job_id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) throw new Error("Invalid job_id");
  return result;
}
function hash(value) {
  const result = text(value, "hash");
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error("Invalid hash");
  return result;
}
function commit(value) {
  const result = text(value, "commit");
  if (!/^[a-f0-9]{7,64}$/.test(result)) throw new Error("Invalid commit");
  return result;
}
function enumeration(value, values, label) {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${label} has an invalid value`);
  return value;
}

// src/application/workflow/engine.ts
var DEFAULT_WORKFLOW_CONFIG = {
  fable_pre_opus_cap: 2,
  fable_post_opus_per_iteration_cap: 1,
  fable_total_cap: 5,
  max_input_bytes: 128e3,
  max_output_bytes: 64e3,
  passport_max_bytes: 64e3,
  post_review: "always",
  risk_triggers: ["authentication", "security", "secret", "migration", "deletion", "billing", "infrastructure", "deployment", "concurrency", "compliance"],
  profiles: {
    fable: { model: "fable", effort: "low", max_turns: 1, timeout_ms: 3e5, permission_mode: "read_only" },
    opus: { model: "opus", effort: "high", max_turns: 50, timeout_ms: 18e5, permission_mode: "worktree" },
    codex: { model: "codex", effort: "medium", max_turns: 1, timeout_ms: 6e5, permission_mode: "read_only" }
  }
};
var WorkflowEngine = class {
  constructor(store, ports) {
    this.store = store;
    this.ports = ports;
  }
  store;
  ports;
  async start(input) {
    if (!input.objective.trim()) throw new Error("Workflow objective must not be empty");
    const id2 = input.job_id ?? `wf_${nanoid(12)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const config = { ...DEFAULT_WORKFLOW_CONFIG, ...input.config, profiles: { ...DEFAULT_WORKFLOW_CONFIG.profiles, ...input.config?.profiles } };
    if (config.fable_pre_opus_cap < 1 || config.fable_pre_opus_cap > 3) throw new Error("Fable pre-Opus cap must be between 1 and 3");
    if (config.fable_post_opus_per_iteration_cap < 0 || config.fable_total_cap < config.fable_pre_opus_cap) throw new Error("Invalid Fable call caps");
    const job = { schema_version: 1, job_id: id2, phase: "codex_brief", resume_phase: null, revision: 1, artifact_revision: 0, latest_artifact_hash: null, fable_pre_opus_calls: 0, fable_post_opus_calls: 0, fable_post_opus_iteration_calls: 0, fable_total_calls: 0, fix_cycles: 0, opus_iteration: 1, branch: null, worktree: null, current_commit: null, approved_plan_hash: null, last_verdict: null, blocker: null, next_action: "Codex creates the implementation brief", current_operation: null, created_at: now, updated_at: now };
    const requiredChecks = (input.required_checks ?? []).map((command) => command.trim()).filter(Boolean);
    const passport = { schema_version: 1, passport_revision: 1, job_id: id2, current_revision: 1, objective: input.objective, current_phase: "codex_brief", approved_plan_hash: null, acceptance_criteria: [], mandatory_amendments: [], decisions: [], allowed_file_scope: input.allowed_file_scope ?? [], required_checks: requiredChecks, current_blockers: [], next_action: job.next_action, artifacts: [], active_worktree: null, current_commit: null, session_references: { codex: null, fable: null, opus: null }, session_modes: { codex: "none", fable: "none", opus: "none" }, rotation_history: [], config };
    const sessions = { schema_version: 1, job_id: id2, codex_thread_id: null, fable_session_id: null, opus_session_id: null, opus_plan_hash: null, modes: { codex: "none", fable: "none", opus: "none" }, rotation_history: [], usage: { codex: usage(), fable: usage(), opus: usage() }, updated_at: now };
    await this.store.createJob(job, passport, sessions);
    await this.event(id2, "workflow_started", { objective: input.objective });
    return id2;
  }
  async run(jobId) {
    while (true) {
      const job = await this.requiredJob(jobId);
      if (isTerminalWorkflowPhase(job.phase) || job.phase === "paused" || job.phase === "blocked") return job;
      try {
        if (job.current_operation) {
          if (job.phase === "merge_ready") {
            await this.step(job);
            continue;
          }
          await this.block(job, `Interrupted ${job.current_operation.phase} operation ${job.current_operation.invocation_id}; manual review is required before retry`);
          continue;
        }
        const operation = { phase: job.phase, invocation_id: `inv_${nanoid(12)}`, started_at: (/* @__PURE__ */ new Date()).toISOString() };
        if (!await this.store.reserveOperation(job.job_id, job.phase, operation)) return this.requiredJob(job.job_id);
        await this.step({ ...job, current_operation: operation });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.event(jobId, "workflow_failed", { reason });
        return this.store.transition(jobId, "failed", { blocker: reason, next_action: "Inspect workflow logs and artifacts" });
      }
    }
  }
  async pause(jobId) {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase) || job.phase === "paused") throw new Error(`Cannot pause workflow in ${job.phase}`);
    return this.transition(job, "paused", { resume_phase: job.phase, next_action: "Resume workflow" });
  }
  async resume(jobId, approveStop = false) {
    const job = await this.requiredJob(jobId);
    if (job.phase !== "paused" && job.phase !== "blocked") throw new Error(`Cannot resume workflow in ${job.phase}`);
    if (!job.resume_phase) throw new Error("Workflow has no recoverable phase");
    if (job.blocker?.startsWith("STOP:") && !approveStop) throw new Error("STOP requires explicit --approve-stop confirmation");
    const resumed = await this.transition(job, job.resume_phase, { blocker: null, resume_phase: null, current_operation: null });
    await this.event(jobId, "workflow_resumed", { phase: resumed.phase });
    return this.run(jobId);
  }
  async cancel(jobId) {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase)) throw new Error(`Cannot cancel workflow in ${job.phase}`);
    return this.transition(job, "cancelled", { next_action: "No further action" });
  }
  async step(job) {
    switch (job.phase) {
      case "codex_brief":
        return this.codexBrief(job);
      case "fable_plan":
        return this.fablePlan(job);
      case "codex_plan_review":
        return this.codexPlanReview(job);
      case "fable_final_prompt":
        return this.finalPrompt(job);
      case "opus_execution":
        return this.opusExecution(job);
      case "codex_technical_review":
        return this.technicalReview(job);
      case "fable_compliance_review":
        return this.complianceReview(job);
      case "codex_synthesis":
        return this.synthesis(job);
      case "merge_ready":
        return this.merge(job);
      default:
        throw new Error(`No workflow action for phase ${job.phase}`);
    }
  }
  async codexBrief(job) {
    const { passport, sessions } = await this.context(job.job_id);
    const result = await this.ports.codex.brief(passport, sessions.codex_thread_id);
    const brief = validateCodexBrief(result.value);
    this.assertJob(job, brief.job_id);
    await this.recordRole(job.job_id, "codex", result);
    const stored = await this.artifact(job, "codex_brief", "codex", brief, validateCodexBrief);
    await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_brief);
    await this.transition(await this.requiredJob(job.job_id), "fable_plan", { next_action: "Fable creates plan revision 1" });
  }
  async fablePlan(job) {
    const passportBefore = await this.requiredPassport(job.job_id);
    if (!await this.reserveFable(job, "pre")) return this.block(job, "Fable call cap reached before an approvable plan");
    const { passport } = await this.context(job.job_id);
    const brief = await this.payload(job, "codex_brief", 1);
    const previous = job.revision > 1 ? await this.optionalPayload(job, "fable_plan", job.revision - 1) : null;
    const options = await this.fableOptions(passport);
    const result = await this.fableCall(job.job_id, options, () => this.ports.fable.plan(passport, brief, previous, passport.mandatory_amendments, options));
    this.assertFableOutput(passportBefore, result.value);
    const plan = validateFablePlan(result.value);
    this.assertJob(job, plan.job_id);
    if (plan.revision !== job.revision) throw new Error("Stale Fable plan revision");
    await this.recordRole(job.job_id, "fable", result);
    const fresh = await this.requiredJob(job.job_id);
    const stored = await this.artifact(fresh, "fable_plan", "fable", plan, validateFablePlan);
    await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.fable_plan.replace("%REV%", String(job.revision).padStart(3, "0")));
    await this.updatePassport(job.job_id, { acceptance_criteria: plan.acceptance_criteria, current_revision: job.revision });
    await this.transition(await this.requiredJob(job.job_id), "codex_plan_review", { next_action: `Codex reviews plan revision ${job.revision}` });
  }
  async codexPlanReview(job) {
    const { passport, sessions } = await this.context(job.job_id);
    const plan = await this.payload(job, "fable_plan");
    const result = await this.ports.codex.reviewPlan(passport, plan, sessions.codex_thread_id);
    const review = validateCodexPlanReview(result.value);
    this.assertJob(job, review.job_id);
    if (review.revision !== job.revision) throw new Error("Stale Codex plan review revision");
    await this.recordRole(job.job_id, "codex", result);
    const stored = await this.artifact(job, "codex_plan_review", "codex", review, validateCodexPlanReview);
    await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_plan_review.replace("%REV%", String(job.revision).padStart(3, "0")));
    await this.decision(job.job_id, review.verdict, review.reason);
    const fresh = await this.requiredJob(job.job_id);
    if (review.verdict === "STOP") return this.block(fresh, `STOP: ${review.reason}`);
    if (review.verdict === "REVISE" || review.requires_re_review) {
      await this.updatePassport(job.job_id, { mandatory_amendments: review.required_changes });
      await this.transition(fresh, "fable_plan", { revision: job.revision + 1, last_verdict: review.verdict, next_action: `Fable creates plan revision ${job.revision + 1}` });
      return;
    }
    const approvedHash = hashCanonical(plan);
    await this.updatePassport(job.job_id, { approved_plan_hash: approvedHash, acceptance_criteria: review.acceptance_criteria, mandatory_amendments: review.required_changes });
    await this.transition(fresh, "fable_final_prompt", { approved_plan_hash: approvedHash, last_verdict: review.verdict, next_action: "Compile final Opus prompt" });
  }
  async finalPrompt(job) {
    const { passport, sessions } = await this.context(job.job_id);
    const plan = await this.payload(job, "fable_plan");
    let result;
    let role;
    const fablePhase = job.fix_cycles > 0 ? "correction" : "pre";
    if ((job.fix_cycles > 0 || job.fable_pre_opus_calls < passport.config.fable_pre_opus_cap) && await this.reserveFable(job, fablePhase)) {
      const options = await this.fableOptions(passport);
      result = await this.fableCall(job.job_id, options, () => this.ports.fable.finalPrompt(passport, plan, passport.mandatory_amendments, options));
      this.assertFableOutput(passport, result.value);
      role = "fable";
    } else {
      result = await this.ports.codex.compileFinalPrompt(passport, plan, sessions.codex_thread_id);
      role = "codex";
      await this.event(job.job_id, "fable_cap_fallback", { role: "codex" });
    }
    if (typeof result.value !== "string" || !result.value.trim()) throw new Error("Final prompt must be non-empty");
    await this.recordRole(job.job_id, role, result);
    const fresh = await this.requiredJob(job.job_id);
    const stored = await this.store.writeTextArtifact({ job_id: job.job_id, name: "fable_final_prompt", phase: "fable_final_prompt", revision: fresh.artifact_revision + 1, producing_role: role, parent_artifact_hash: fresh.latest_artifact_hash, payload: result.value });
    await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.fable_final_prompt);
    let prepared = { branch: fresh.branch, worktree: fresh.worktree };
    if (!prepared.branch || !prepared.worktree) prepared = await this.ports.git.prepare(job.job_id);
    await this.transition(await this.requiredJob(job.job_id), "opus_execution", { branch: prepared.branch, worktree: prepared.worktree, next_action: "Opus implements in dedicated worktree" });
    await this.updatePassport(job.job_id, { active_worktree: prepared.worktree });
  }
  async opusExecution(job) {
    if (!job.worktree || !job.branch) throw new Error("Opus worktree is missing");
    const { passport, sessions } = await this.context(job.job_id);
    const prompt = await this.textPayload(job, "fable_final_prompt");
    const mode = sessions.opus_session_id && sessions.opus_plan_hash === job.approved_plan_hash ? "passport_handoff" : "new";
    const result = await this.ports.opus.execute(passport, prompt, job.worktree, mode === "passport_handoff" ? sessions.opus_session_id : null, mode);
    const opus = validateOpusResult(result.value);
    this.assertJob(job, opus.job_id);
    await this.recordRole(job.job_id, "opus", result);
    const stored = await this.artifact(job, "opus_report", "opus", opus, validateOpusResult);
    await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.opus_report);
    if (opus.status !== "completed" || opus.unresolved.length > 0) throw new Error(`Opus execution is not complete: ${opus.summary}`);
    const evidence = await this.ports.git.inspect(job.branch, job.worktree);
    this.assertAllowedScope(passport, evidence.files_changed);
    const fresh = await this.requiredJob(job.job_id);
    const diffStored = await this.store.writeTextArtifact({ job_id: job.job_id, name: "opus_diff", phase: "opus_execution", revision: fresh.artifact_revision + 1, producing_role: "orchestrator", parent_artifact_hash: fresh.latest_artifact_hash, payload: evidence.diff || "(empty diff)" });
    await this.addArtifact(job.job_id, diffStored, ARTIFACT_FILES.opus_diff);
    await this.transition(await this.requiredJob(job.job_id), "codex_technical_review", { current_commit: evidence.commit, next_action: "Run checks and Codex technical review" });
    await this.updatePassport(job.job_id, { current_commit: evidence.commit });
  }
  async technicalReview(job) {
    if (!job.branch || !job.worktree) throw new Error("Worktree evidence is missing");
    const { passport } = await this.context(job.job_id);
    const evidence = await this.ports.git.inspect(job.branch, job.worktree);
    const checks = validateCheckResults(await this.ports.git.runChecks(job.worktree, evidence.commit, passport.required_checks));
    this.assertJob(job, checks.job_id);
    if (checks.commit !== evidence.commit) throw new Error("Check results are stale");
    let fresh = await this.requiredJob(job.job_id);
    const checkStored = await this.artifact(fresh, "test_results", "orchestrator", checks, validateCheckResults);
    await this.addArtifact(job.job_id, checkStored, ARTIFACT_FILES.test_results);
    const review = { job_id: job.job_id, reviewed_commit: evidence.commit, checks_passed: checks.passed, evidence: [evidence.diff_hash, ...checks.checks.map((check) => check.command)], required_fixes: checks.passed ? [] : ["Resolve failed verification checks"], concise_reason: "Deterministic evidence package prepared for final Codex review" };
    fresh = await this.requiredJob(job.job_id);
    const stored = await this.artifact(fresh, "codex_technical_review", "orchestrator", review, validateCodexTechnicalReview);
    await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_technical_review);
    const needsFable = passport.config.post_review === "always" || passport.config.post_review === "risk_based" && this.isRisky(passport, evidence);
    await this.transition(await this.requiredJob(job.job_id), needsFable ? "fable_compliance_review" : "codex_synthesis", { current_commit: evidence.commit, next_action: needsFable ? "Fable checks plan compliance" : "Codex synthesizes evidence" });
  }
  async complianceReview(job) {
    const { passport } = await this.context(job.job_id);
    if (!job.branch || !job.worktree) throw new Error("Worktree evidence is missing");
    if (!await this.reserveFable(job, "post")) return this.block(job, "Fable post-Opus or whole-workflow call cap reached");
    const plan = await this.payload(job, "fable_plan");
    const opus = await this.payload(job, "opus_report");
    const checks = await this.payload(job, "test_results");
    const evidence = await this.ports.git.inspect(job.branch, job.worktree);
    if (evidence.commit !== checks.commit) throw new Error("Compliance evidence is stale");
    const options = await this.fableOptions(passport);
    const result = await this.fableCall(job.job_id, options, () => this.ports.fable.compliance(passport, plan, opus, evidence, checks, options));
    this.assertFableOutput(passport, result.value);
    const review = validateFableComplianceReview(result.value);
    this.assertJob(job, review.job_id);
    if (review.approved_plan_hash !== job.approved_plan_hash) throw new Error("Fable compliance review used stale plan");
    await this.recordRole(job.job_id, "fable", result);
    const fresh = await this.requiredJob(job.job_id);
    const stored = await this.artifact(fresh, "fable_compliance_review", "fable", review, validateFableComplianceReview);
    await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.fable_compliance_review);
    await this.transition(await this.requiredJob(job.job_id), "codex_synthesis", { next_action: "Codex synthesizes both reviews" });
  }
  async synthesis(job) {
    const { passport, sessions } = await this.context(job.job_id);
    if (!job.branch || !job.worktree) throw new Error("Worktree evidence is missing");
    const evidence = await this.ports.git.inspect(job.branch, job.worktree);
    const technical = await this.payload(job, "codex_technical_review");
    const checks = await this.payload(job, "test_results");
    const compliance = await this.optionalPayload(job, "fable_compliance_review");
    const result = await this.ports.codex.synthesize(passport, evidence, technical, compliance, checks, sessions.codex_thread_id);
    const synthesis = validateCodexSynthesis(result.value);
    this.assertJob(job, synthesis.job_id);
    if (synthesis.reviewed_commit !== technical.reviewed_commit || synthesis.reviewed_commit !== checks.commit || synthesis.reviewed_commit !== evidence.commit) throw new Error("Synthesis reviewed_commit is stale");
    await this.recordRole(job.job_id, "codex", result);
    const fresh = await this.requiredJob(job.job_id);
    const stored = await this.artifact(fresh, "codex_synthesis", "codex", synthesis, validateCodexSynthesis);
    await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_synthesis);
    await this.decision(job.job_id, synthesis.verdict, synthesis.reason);
    const current = await this.requiredJob(job.job_id);
    if (synthesis.verdict === "STOP") return this.block(current, `STOP: ${synthesis.reason}`);
    if (synthesis.verdict === "REVISE") {
      if (job.fix_cycles >= 3) return this.block(current, "Bounded correction cycle cap reached");
      await this.updatePassport(job.job_id, { mandatory_amendments: synthesis.required_changes });
      await this.transition(current, "fable_final_prompt", { fix_cycles: job.fix_cycles + 1, opus_iteration: job.opus_iteration + 1, fable_post_opus_iteration_calls: 0, last_verdict: "REVISE", next_action: "Fable creates compact correction instructions" });
      return;
    }
    if (synthesis.requires_re_review) return this.block(current, "Codex GO requires another review and cannot merge");
    if (!synthesis.merge_allowed || !checks.passed || checks.checks.length === 0 || !technical.checks_passed || passport.required_checks.length === 0) return this.block(current, "Meaningful project verification is required before merge");
    await this.transition(current, "merge_ready", { last_verdict: "GO", current_commit: synthesis.reviewed_commit, next_action: "Verify immutable approval and merge" });
  }
  async merge(job) {
    if (!job.branch || !job.worktree || !job.current_commit) throw new Error("Merge metadata is missing");
    const synthesis = await this.payload(job, "codex_synthesis");
    const checks = await this.payload(job, "test_results");
    const reviewedDiff = await this.textPayload(job, "opus_diff");
    const actual = await this.ports.git.currentCommit(job.branch);
    const approvalValid = synthesis.verdict === "GO" && synthesis.merge_allowed && !synthesis.requires_re_review && checks.passed && checks.checks.length > 0 && synthesis.reviewed_commit === checks.commit && actual === synthesis.reviewed_commit;
    if (approvalValid && await this.ports.git.isMerged(job.branch, actual)) {
      await this.transition(job, "done", { next_action: "Workflow complete" });
      await this.event(job.job_id, "merge_reconciled", { commit: actual });
      return;
    }
    const evidence = await this.ports.git.inspect(job.branch, job.worktree);
    const rechecked = validateCheckResults(await this.ports.git.runChecks(job.worktree, evidence.commit, (await this.requiredPassport(job.job_id)).required_checks));
    if (synthesis.verdict !== "GO" || !synthesis.merge_allowed || !checks.passed || !rechecked.passed || rechecked.checks.length === 0 || synthesis.reviewed_commit !== checks.commit || rechecked.commit !== checks.commit || actual !== synthesis.reviewed_commit || evidence.commit !== synthesis.reviewed_commit || evidence.diff_hash !== hashCanonical(reviewedDiff)) throw new Error("Merge approval is stale or incomplete");
    const merged = await this.ports.git.merge(job.branch);
    if (!merged.success) throw new Error(`Merge failed closed: ${merged.detail}`);
    await this.transition(job, "done", { next_action: "Workflow complete" });
    await this.event(job.job_id, "workflow_done", { commit: actual, diff_hash: evidence.diff_hash });
  }
  async artifact(job, name, role, value, validate) {
    const fresh = await this.requiredJob(job.job_id);
    return this.store.writeArtifact({ job_id: job.job_id, name, phase: fresh.phase, revision: fresh.artifact_revision + 1, producing_role: role, parent_artifact_hash: fresh.latest_artifact_hash, payload: value, validate });
  }
  async payload(job, name, revision2 = job.revision) {
    const result = await this.store.readArtifact(job.job_id, name, revision2);
    if (!result) throw new Error(`Required artifact missing: ${name}`);
    return result.payload;
  }
  async optionalPayload(job, name, revision2 = job.revision) {
    return (await this.store.readArtifact(job.job_id, name, revision2))?.payload ?? null;
  }
  async textPayload(job, name) {
    const result = await this.store.readTextArtifact(job.job_id, name, job.revision);
    if (!result) throw new Error(`Required text artifact missing: ${name}`);
    return result.payload;
  }
  async transition(job, phase, patch = {}) {
    const updated = await this.store.transition(job.job_id, phase, { ...patch, current_operation: null });
    await this.updatePassport(job.job_id, { current_phase: phase, current_revision: updated.revision, next_action: updated.next_action, current_blockers: updated.blocker ? [updated.blocker] : [] });
    await this.event(job.job_id, "phase_changed", { from: job.phase, to: phase });
    return updated;
  }
  async block(job, reason) {
    await this.transition(job, "blocked", { blocker: reason, resume_phase: job.phase, next_action: "Provide human input, then resume" });
    await this.event(job.job_id, "workflow_blocked", { reason });
  }
  async addArtifact(jobId, stored, filename) {
    const passport = await this.requiredPassport(jobId);
    await this.updatePassport(jobId, { artifacts: [...passport.artifacts, artifactReference(filename, stored)] });
  }
  async decision(jobId, verdict, reason) {
    const passport = await this.requiredPassport(jobId);
    await this.updatePassport(jobId, { decisions: [...passport.decisions, { verdict, reason, timestamp: (/* @__PURE__ */ new Date()).toISOString() }] });
  }
  async updatePassport(jobId, patch) {
    const passport = await this.requiredPassport(jobId);
    const updated = { ...passport, ...patch, passport_revision: passport.passport_revision + 1, schema_version: 1, job_id: passport.job_id };
    if (Buffer.byteLength(JSON.stringify(updated)) > updated.config.passport_max_bytes) throw new Error("Workflow passport exceeded configured maximum");
    await this.store.writePassport(updated);
  }
  async rotateSession(jobId, role, reason) {
    const sessions = await this.requiredSessions(jobId);
    const key = role === "codex" ? "codex_thread_id" : role === "fable" ? "fable_session_id" : "opus_session_id";
    const previous = sessions[key];
    const rotation = { role, previous_id: previous, next_id: null, reason: reason.trim() || "manual rotation", timestamp: (/* @__PURE__ */ new Date()).toISOString() };
    const updated = { ...sessions, [key]: null, ...role === "opus" ? { opus_plan_hash: null } : {}, modes: { ...sessions.modes, [role]: "none" }, rotation_history: [...sessions.rotation_history, rotation], updated_at: rotation.timestamp };
    await this.store.writeSessions(updated);
    await this.updatePassport(jobId, { session_references: { codex: updated.codex_thread_id, fable: updated.fable_session_id, opus: updated.opus_session_id }, session_modes: updated.modes, rotation_history: updated.rotation_history });
    await this.event(jobId, "session_rotated", rotation);
  }
  async recordRole(jobId, role, result) {
    const sessions = await this.requiredSessions(jobId);
    const u = sessions.usage[role];
    const inputChars = result.usage?.input_chars ?? 0;
    const outputChars = result.usage?.output_chars ?? Buffer.byteLength(typeof result.value === "string" ? result.value : JSON.stringify(result.value));
    const nextUsage = { calls: u.calls + 1, input_chars: u.input_chars + inputChars, output_chars: u.output_chars + outputChars, input_tokens: u.input_tokens + (result.usage?.input_tokens ?? 0), output_tokens: u.output_tokens + (result.usage?.output_tokens ?? 0), estimated_tokens: u.estimated_tokens + Math.ceil((inputChars + outputChars) / 4), cache_read: u.cache_read + (result.usage?.cache_read ?? 0), cache_write: u.cache_write + (result.usage?.cache_write ?? 0), duration_ms: u.duration_ms + (result.usage?.duration_ms ?? 0), failed_calls: u.failed_calls, resumes: u.resumes + (result.resumed ? 1 : 0), compactions: u.compactions + (result.usage?.compactions ?? 0) };
    const job = await this.requiredJob(jobId);
    const mode = result.session_mode ?? (result.resumed ? "native_resume" : result.resume_failed ? "passport_handoff" : result.session_id ? "new" : "none");
    const updated = { ...sessions, codex_thread_id: role === "codex" ? result.session_id ?? sessions.codex_thread_id : sessions.codex_thread_id, fable_session_id: role === "fable" ? result.session_id ?? sessions.fable_session_id : sessions.fable_session_id, opus_session_id: role === "opus" ? result.session_id ?? sessions.opus_session_id : sessions.opus_session_id, opus_plan_hash: role === "opus" ? job.approved_plan_hash : sessions.opus_plan_hash, modes: { ...sessions.modes, [role]: mode }, usage: { ...sessions.usage, [role]: nextUsage }, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
    await this.store.writeSessions(updated);
    await this.updatePassport(jobId, { session_references: { codex: updated.codex_thread_id, fable: updated.fable_session_id, opus: updated.opus_session_id }, session_modes: updated.modes });
    if (result.resume_failed) await this.event(jobId, "session_resume_fallback", { role });
  }
  async fableOptions(passport) {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "orch-fable-empty-"));
    return { workspace, model: passport.config.profiles.fable.model, max_turns: 1, effort: "low", timeout_ms: passport.config.profiles.fable.timeout_ms, max_input_bytes: passport.config.max_input_bytes, max_output_bytes: passport.config.max_output_bytes };
  }
  async fableCall(jobId, options, call) {
    try {
      return await call();
    } catch (error) {
      const sessions = await this.requiredSessions(jobId);
      const u = sessions.usage.fable;
      await this.store.writeSessions({ ...sessions, usage: { ...sessions.usage, fable: { ...u, calls: u.calls + 1, failed_calls: u.failed_calls + 1 } }, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
      throw error;
    } finally {
      await fs.rm(options.workspace, { recursive: true, force: true });
    }
  }
  async reserveFable(job, phase) {
    const passport = await this.requiredPassport(job.job_id);
    const current = await this.requiredJob(job.job_id);
    if (current.fable_total_calls >= passport.config.fable_total_cap) return false;
    if (phase === "pre" && current.fable_pre_opus_calls >= passport.config.fable_pre_opus_cap) return false;
    if (phase === "post" && current.fable_post_opus_iteration_calls >= passport.config.fable_post_opus_per_iteration_cap) return false;
    await this.store.patchJob(job.job_id, { fable_total_calls: current.fable_total_calls + 1, fable_pre_opus_calls: current.fable_pre_opus_calls + (phase === "pre" ? 1 : 0), fable_post_opus_calls: current.fable_post_opus_calls + (phase === "post" ? 1 : 0), fable_post_opus_iteration_calls: current.fable_post_opus_iteration_calls + (phase === "post" ? 1 : 0) });
    return true;
  }
  assertFableOutput(passport, value) {
    if (Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value)) > passport.config.max_output_bytes) throw new Error("Fable output exceeded configured maximum");
  }
  assertAllowedScope(passport, files) {
    if (passport.allowed_file_scope.length === 0) return;
    const outside = files.filter((file) => !passport.allowed_file_scope.some((allowed) => file === allowed || file.startsWith(`${allowed.replace(/\/$/, "")}/`)));
    if (outside.length) throw new Error(`Opus changed files outside approved scope: ${outside.join(", ")}`);
  }
  isRisky(passport, evidence) {
    const text2 = `${passport.objective} ${evidence.risk_signals.join(" ")}`.toLowerCase();
    return passport.config.risk_triggers.some((trigger) => text2.includes(trigger.toLowerCase())) || evidence.files_changed.length >= 20;
  }
  assertJob(job, received) {
    if (received !== job.job_id) throw new Error(`Artifact job_id mismatch: ${received}`);
  }
  async context(jobId) {
    return { passport: await this.requiredPassport(jobId), sessions: await this.requiredSessions(jobId) };
  }
  async requiredJob(id2) {
    const value = await this.store.readJob(id2);
    if (!value) throw new Error(`Workflow job not found: ${id2}`);
    return value;
  }
  async requiredPassport(id2) {
    const value = await this.store.readPassport(id2);
    if (!value) throw new Error(`Workflow passport not found: ${id2}`);
    return value;
  }
  async requiredSessions(id2) {
    const value = await this.store.readSessions(id2);
    if (!value) throw new Error(`Workflow sessions not found: ${id2}`);
    return value;
  }
  async event(id2, type, data) {
    await this.store.appendEvent({ schema_version: 1, job_id: id2, type, timestamp: (/* @__PURE__ */ new Date()).toISOString(), data });
  }
};
function usage() {
  return { calls: 0, input_chars: 0, output_chars: 0, input_tokens: 0, output_tokens: 0, estimated_tokens: 0, cache_read: 0, cache_write: 0, duration_ms: 0, failed_calls: 0, resumes: 0, compactions: 0 };
}

export { DEFAULT_WORKFLOW_CONFIG, WORKFLOW_SCHEMA_VERSION, WorkflowEngine, validateCheckResults, validateCodexBrief, validateCodexPlanReview, validateCodexSynthesis, validateCodexTechnicalReview, validateFableComplianceReview, validateFablePlan, validateOpusResult };
//# sourceMappingURL=chunk-OQVYDZTZ.js.map
//# sourceMappingURL=chunk-OQVYDZTZ.js.map