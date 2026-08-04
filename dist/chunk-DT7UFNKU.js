import { isTerminalWorkflowPhase, hashCanonical, artifactReference, ARTIFACT_FILES } from './chunk-VBS3B32E.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { nanoid } from 'nanoid';

// src/domain/workflow/contracts.ts
var WORKFLOW_SCHEMA_VERSION = 2;
function validateCodexDecision(value, stage) {
  const o = exact(value, ["schema_version", "job_id", "action", "summary", "implementation_brief", "required_changes", "risk_level", "fable_query", "reviewed_commit"], "Codex decision");
  if (o.schema_version !== 2) throw new Error("Unsupported Codex decision schema version");
  const action = enumeration(o.action, ["DISPATCH_OPUS", "ACCEPT", "CORRECT_OPUS", "CONSULT_FABLE", "PAUSE", "STOP"], "action");
  const allowed = stage === "pre_opus" ? ["DISPATCH_OPUS", "CONSULT_FABLE", "PAUSE", "STOP"] : stage === "post_opus" ? ["ACCEPT", "CORRECT_OPUS", "CONSULT_FABLE", "PAUSE", "STOP"] : stage === "after_fable_pre" ? ["DISPATCH_OPUS", "PAUSE", "STOP"] : ["ACCEPT", "CORRECT_OPUS", "PAUSE", "STOP"];
  if (!allowed.includes(action)) throw new Error(`Codex action ${action} is invalid during ${stage}`);
  const implementationBrief = o.implementation_brief === null ? null : nonEmpty(o.implementation_brief, "implementation_brief");
  const requiredChanges = strings(o.required_changes, "required_changes");
  const fableQuery = o.fable_query === null ? null : validateFableQuery(o.fable_query);
  const reviewedCommit = o.reviewed_commit === null ? null : commit(o.reviewed_commit);
  if (action === "DISPATCH_OPUS" && !implementationBrief) throw new Error("DISPATCH_OPUS requires implementation_brief");
  if (action !== "DISPATCH_OPUS" && implementationBrief !== null) throw new Error(`${action} cannot include implementation_brief`);
  if (action === "CORRECT_OPUS" && requiredChanges.length === 0) throw new Error("CORRECT_OPUS requires required_changes");
  if (action !== "CORRECT_OPUS" && requiredChanges.length > 0) throw new Error(`${action} cannot include required_changes`);
  if (action === "CONSULT_FABLE" && !fableQuery) throw new Error("CONSULT_FABLE requires fable_query");
  if (action !== "CONSULT_FABLE" && fableQuery !== null) throw new Error(`${action} requires fable_query null`);
  if (action === "CONSULT_FABLE" && o.risk_level !== "low") throw new Error("CONSULT_FABLE requires low risk");
  if (fableQuery && (stage === "pre_opus" || stage === "after_fable_pre") && fableQuery.fallback_if_skipped.action === "CORRECT_OPUS") throw new Error("Pre-Opus consultation cannot use CORRECT_OPUS fallback");
  if (fableQuery && (stage === "post_opus" || stage === "after_fable_post") && fableQuery.fallback_if_skipped.action === "DISPATCH_OPUS") throw new Error("Post-Opus consultation cannot use DISPATCH_OPUS fallback");
  if ((stage === "post_opus" || stage === "after_fable_post") && reviewedCommit === null) throw new Error("Post-Opus decision requires reviewed_commit");
  if ((stage === "pre_opus" || stage === "after_fable_pre") && reviewedCommit !== null) throw new Error("Pre-Opus decision cannot include reviewed_commit");
  return { schema_version: 2, job_id: id(o.job_id), action, summary: nonEmpty(o.summary, "summary"), implementation_brief: implementationBrief, required_changes: requiredChanges, risk_level: enumeration(o.risk_level, ["low", "medium", "high"], "risk_level"), fable_query: fableQuery, reviewed_commit: reviewedCommit };
}
function validateFableQuery(value) {
  const o = exact(value, ["purpose", "question", "verification_method", "fallback_if_skipped"], "Fable query");
  const fallback = exact(o.fallback_if_skipped, ["action", "instructions"], "Fable fallback");
  return {
    purpose: enumeration(o.purpose, ["COMPARE_BOUNDED_OPTIONS", "GENERATE_NONCRITICAL_ALTERNATIVES", "CHALLENGE_REVERSIBLE_PLAN"], "purpose"),
    question: nonEmpty(o.question, "question"),
    verification_method: nonEmpty(o.verification_method, "verification_method"),
    fallback_if_skipped: { action: enumeration(fallback.action, ["DISPATCH_OPUS", "CORRECT_OPUS", "PAUSE"], "fallback action"), instructions: nonEmpty(fallback.instructions, "fallback instructions") }
  };
}
function validateFableAdvice(value) {
  const o = exact(value, ["schema_version", "consultation_id", "answer", "alternatives", "uncertainties"], "Fable advice");
  if (o.schema_version !== 1) throw new Error("Unsupported Fable advice schema version");
  return { schema_version: 1, consultation_id: id(o.consultation_id), answer: nonEmpty(o.answer, "answer"), alternatives: strings(o.alternatives, "alternatives"), uncertainties: strings(o.uncertainties, "uncertainties") };
}
function validateOpusResult(value) {
  const o = exact(value, ["job_id", "status", "files_changed", "commands_run", "tests_reported", "deviations", "unresolved", "summary"], "Opus result");
  return { job_id: id(o.job_id), status: enumeration(o.status, ["completed", "partial", "failed"], "status"), files_changed: strings(o.files_changed, "files_changed"), commands_run: strings(o.commands_run, "commands_run"), tests_reported: strings(o.tests_reported, "tests_reported"), deviations: strings(o.deviations, "deviations"), unresolved: strings(o.unresolved, "unresolved"), summary: nonEmpty(o.summary, "summary") };
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
function id(value) {
  const result = nonEmpty(value, "id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) throw new Error("Invalid id");
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
  fable_total_cap: 1,
  max_input_bytes: 128e3,
  max_output_bytes: 64e3,
  passport_max_bytes: 64e3,
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
    const rawConfig = input.config;
    const obsolete = ["fable_pre_opus_cap", "fable_post_opus_per_iteration_cap", "post_review", "risk_triggers"].filter((key) => rawConfig && key in rawConfig);
    if (obsolete.length) throw new Error(`Obsolete workflow configuration is incompatible with direct workflow v2: ${obsolete.join(", ")}`);
    const mode = input.mode ?? "adaptive";
    const id2 = input.job_id ?? `wf_${nanoid(12)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const config = { fable_total_cap: mode === "direct" ? 0 : input.config?.fable_total_cap ?? 1, max_input_bytes: input.config?.max_input_bytes ?? DEFAULT_WORKFLOW_CONFIG.max_input_bytes, max_output_bytes: input.config?.max_output_bytes ?? DEFAULT_WORKFLOW_CONFIG.max_output_bytes, passport_max_bytes: input.config?.passport_max_bytes ?? DEFAULT_WORKFLOW_CONFIG.passport_max_bytes, profiles: { fable: { ...DEFAULT_WORKFLOW_CONFIG.profiles.fable, ...input.config?.profiles?.fable }, opus: { ...DEFAULT_WORKFLOW_CONFIG.profiles.opus, ...input.config?.profiles?.opus }, codex: { ...DEFAULT_WORKFLOW_CONFIG.profiles.codex, ...input.config?.profiles?.codex } } };
    if (config.fable_total_cap !== 0 && config.fable_total_cap !== 1) throw new Error("Fable whole-workflow cap must be zero or one");
    if (config.profiles.fable.effort !== "low" || config.profiles.fable.max_turns !== 1 || config.profiles.fable.permission_mode !== "read_only") throw new Error("Fable must use low effort, one turn, and read-only isolation");
    if (config.profiles.codex.permission_mode !== "read_only") throw new Error("Codex review must remain read-only");
    if (config.profiles.opus.permission_mode !== "worktree") throw new Error("Opus must use worktree permissions");
    const [codex, opus] = await Promise.all([this.ports.codex.available(), this.ports.opus.available()]);
    const unavailable = [codex, opus].filter((item) => !item.available).map((item) => item.detail);
    if (unavailable.length) throw new Error(`Workflow capabilities blocked: ${unavailable.join("; ")}`);
    const job = { schema_version: 2, job_id: id2, mode, phase: "codex_pre_opus", resume_phase: null, revision: 1, artifact_revision: 0, latest_artifact_hash: null, opus_iteration: 1, fix_cycles: 0, fable_calls: 0, consultation_status: "unused", consultation_origin: null, branch: null, worktree: null, target_branch: null, base_commit: null, current_commit: null, reviewed_diff_hash: null, accepted_brief_hash: null, last_action: null, blocker: null, next_action: "Codex decides whether to dispatch Opus", current_operation: null, created_at: now, updated_at: now };
    const requiredChecks = (input.required_checks ?? []).map((command) => command.trim()).filter(Boolean);
    const passport = { schema_version: 2, passport_revision: 1, job_id: id2, mode, current_revision: 1, objective: input.objective, current_phase: "codex_pre_opus", accepted_brief_hash: null, latest_implementation_brief: null, hard_constraints: [], acceptance_criteria: [], decisions: [], allowed_file_scope: input.allowed_file_scope ?? [], required_checks: requiredChecks, current_blockers: [], next_action: job.next_action, artifacts: [], active_worktree: null, target_branch: null, base_commit: null, current_commit: null, session_references: { codex: null, opus: null }, session_modes: { codex: "none", opus: "none" }, rotation_history: [], config };
    if (Buffer.byteLength(JSON.stringify(passport)) > config.passport_max_bytes) throw new Error("Initial workflow passport exceeded configured maximum");
    const sessions = { schema_version: 2, job_id: id2, codex_thread_id: null, opus_session_id: null, opus_brief_hash: null, modes: { codex: "none", opus: "none" }, rotation_history: [], recorded_invocations: [], usage: { codex: usage(), fable: usage(), opus: usage() }, updated_at: now };
    await this.store.createJob(job, passport, sessions);
    await this.event(id2, "workflow_started", { objective: input.objective, mode });
    return id2;
  }
  async run(jobId) {
    while (true) {
      const job = await this.advance(jobId);
      if (isTerminalWorkflowPhase(job.phase) || job.phase === "paused" || job.phase === "blocked") return job;
    }
  }
  async advance(jobId) {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase) || job.phase === "paused" || job.phase === "blocked") return job;
    try {
      if (job.current_operation) {
        const receipt = await this.store.readInvocationReceipt(job.job_id, job.current_operation.invocation_id);
        if (job.phase === "merge_ready" || receipt) {
          await this.step(job);
          return this.requiredJob(jobId);
        }
        if (job.phase === "fable_consultation" && (job.consultation_status === "attempt_started" || job.consultation_status === "fallback_executed")) {
          await this.executeConsultationFallback(job, job.consultation_status === "attempt_started" ? "ambiguous_interruption" : "resume_persisted_fallback");
          return this.requiredJob(jobId);
        }
        await this.block(job, `INTERRUPTED: ${job.current_operation.phase} operation ${job.current_operation.invocation_id} has no durable result; explicit retry approval is required`);
        return this.requiredJob(jobId);
      }
      const operation = { phase: job.phase, invocation_id: `inv_${nanoid(12)}`, started_at: (/* @__PURE__ */ new Date()).toISOString(), retry_count: 0 };
      if (!await this.store.reserveOperation(job.job_id, job.phase, operation)) return this.requiredJob(job.job_id);
      await this.step({ ...job, current_operation: operation });
      return this.requiredJob(jobId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.event(jobId, "workflow_failed", { reason });
      return this.store.transition(jobId, "failed", { blocker: reason, next_action: "Inspect workflow logs and artifacts" });
    }
  }
  async pause(jobId) {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase) || job.phase === "paused") throw new Error(`Cannot pause workflow in ${job.phase}`);
    return this.transition(job, "paused", { resume_phase: job.phase, next_action: "Resume workflow" });
  }
  async resume(jobId, options = {}) {
    const job = await this.requiredJob(jobId);
    if (job.phase !== "paused" && job.phase !== "blocked") throw new Error(`Cannot resume workflow in ${job.phase}`);
    if (!job.resume_phase) throw new Error("Workflow has no recoverable phase");
    const reason = options.reason?.trim();
    if (!reason) throw new Error("Resume requires --reason");
    if (job.blocker?.startsWith("LEGACY_SCHEMA:")) throw new Error("Legacy schema workflow cannot be resumed; start a new workflow");
    if (job.blocker?.startsWith("INTERRUPTED:") && (!options.retry_invocation || !reason)) throw new Error("Interrupted invocation requires --retry-invocation and --reason");
    const resumed = await this.transition(job, job.resume_phase, { blocker: null, resume_phase: null, current_operation: null });
    await this.event(jobId, "workflow_resumed", { phase: resumed.phase, reason });
    return this.run(jobId);
  }
  async cancel(jobId) {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase)) throw new Error(`Cannot cancel workflow in ${job.phase}`);
    return this.transition(job, "cancelled", { next_action: "No further action" });
  }
  async step(job) {
    switch (job.phase) {
      case "codex_pre_opus":
        return this.codexDecision(job, "pre_opus");
      case "fable_consultation":
        return this.fableConsultation(job);
      case "codex_after_fable":
        return this.codexDecision(job, job.consultation_origin === "pre_opus" ? "after_fable_pre" : "after_fable_post");
      case "opus_execution":
        return this.opusExecution(job);
      case "codex_post_opus":
        return this.codexDecision(job, "post_opus");
      case "verification":
        return this.verification(job);
      case "merge_ready":
        return this.merge(job);
      default:
        throw new Error(`No workflow action for phase ${job.phase}`);
    }
  }
  async codexDecision(job, stage) {
    const { passport, sessions } = await this.context(job.job_id);
    const evidence = await this.reviewEvidence(job, stage);
    const result = await this.invoke(job, "codex", { stage, evidence }, () => this.ports.codex.decide(passport, stage, evidence, sessions.codex_thread_id));
    const decision = validateCodexDecision(result.value, stage);
    this.assertJob(job, decision.job_id);
    if (decision.reviewed_commit && decision.reviewed_commit !== evidence.evidence?.commit) throw new Error("Codex decision reviewed stale commit");
    await this.recordDecision(job, decision);
    const stored = await this.artifact(job, "codex_decision", "codex", decision, (value) => validateCodexDecision(value, stage));
    await this.addArtifact(job.job_id, stored);
    if (decision.action === "STOP") return this.transition(job, "cancelled", { last_action: "STOP", next_action: "Workflow stopped without merge" }).then(() => void 0);
    if (decision.action === "PAUSE") return this.transition(job, "paused", { resume_phase: job.phase, last_action: "PAUSE", next_action: decision.summary }).then(() => void 0);
    if (decision.action === "CONSULT_FABLE") return this.routeConsultation(job, decision, stage === "pre_opus" || stage === "after_fable_pre" ? "pre_opus" : "post_opus");
    if (decision.action === "DISPATCH_OPUS") return this.dispatchOpus(job, decision.implementation_brief);
    if (decision.action === "CORRECT_OPUS") return this.dispatchOpus(job, decision.required_changes.join("\n"), true);
    if (decision.action === "ACCEPT") {
      if (!evidence.evidence || !evidence.checks || !evidence.opus) throw new Error("ACCEPT requires real Opus evidence");
      return this.transition(job, "verification", { last_action: "ACCEPT", current_commit: decision.reviewed_commit, next_action: "Revalidate exact evidence before merge" }).then(() => void 0);
    }
  }
  async routeConsultation(job, decision, origin) {
    const query = decision.fable_query;
    const denial = await this.consultationDenial(job, decision, query);
    const request = await this.artifact(job, "fable_request", "codex", query, (value) => validateCodexDecision({ ...decision, fable_query: value }, origin === "pre_opus" ? "pre_opus" : "post_opus").fable_query);
    await this.addArtifact(job.job_id, request);
    await this.store.patchJob(job.job_id, { consultation_status: denial ? "skipped" : "requested", consultation_origin: origin });
    if (denial) {
      await this.event(job.job_id, "fable_consultation_skipped", { reason: denial, origin });
      return this.executeConsultationFallback(await this.requiredJob(job.job_id), denial, query);
    }
    await this.transition(await this.requiredJob(job.job_id), "fable_consultation", { consultation_status: "requested", consultation_origin: origin, last_action: "CONSULT_FABLE", next_action: "Run one bounded stateless Fable consultation" });
  }
  async fableConsultation(job) {
    if (job.consultation_status === "attempt_started" || job.consultation_status === "fallback_executed") return this.executeConsultationFallback(job, job.consultation_status === "attempt_started" ? "ambiguous_interruption" : "resume_persisted_fallback");
    const query = await this.payload(job, "fable_request");
    const consultationId = `consult_${job.job_id}_${job.revision}`;
    const existing = await this.store.readInvocationReceipt(job.job_id, this.invocation(job));
    if (!existing) await this.store.patchJob(job.job_id, { consultation_status: "attempt_started", fable_calls: job.fable_calls + 1 });
    const options = await this.fableOptions(await this.requiredPassport(job.job_id));
    try {
      const result = await this.fableCall(job, options, { consultation_id: consultationId, query }, () => this.ports.fable.consult(job.job_id, consultationId, query, options));
      const advice = validateFableAdvice(result.value);
      if (advice.consultation_id !== consultationId) throw new Error("Fable advice consultation_id mismatch");
      const stored = await this.artifact(await this.requiredJob(job.job_id), "fable_advice", "fable", advice, validateFableAdvice);
      await this.addArtifact(job.job_id, stored);
      await this.store.patchJob(job.job_id, { consultation_status: "result_persisted" });
      await this.transition(await this.requiredJob(job.job_id), "codex_after_fable", { consultation_status: "result_persisted", next_action: "Codex verifies optional Fable advice" });
    } catch (error) {
      await this.event(job.job_id, "fable_consultation_failed", { reason: error instanceof Error ? error.message : String(error) });
      await this.executeConsultationFallback(await this.requiredJob(job.job_id), "fable_failed", query);
    }
  }
  async executeConsultationFallback(job, reason, provided) {
    const query = provided ?? await this.payload(job, "fable_request");
    const fallback = query.fallback_if_skipped;
    const routing = { reason, action: fallback.action, instructions: fallback.instructions, origin: job.consultation_origin };
    const stored = await this.artifact(job, "routing_decision", "orchestrator", routing, (value) => value);
    await this.addArtifact(job.job_id, stored);
    await this.store.patchJob(job.job_id, { consultation_status: "fallback_executed" });
    if (fallback.action === "PAUSE") {
      await this.transition(await this.requiredJob(job.job_id), "paused", { resume_phase: job.consultation_origin === "pre_opus" ? "codex_pre_opus" : "codex_post_opus", consultation_status: "fallback_executed", next_action: fallback.instructions });
      return;
    }
    await this.dispatchOpus(await this.requiredJob(job.job_id), fallback.instructions, fallback.action === "CORRECT_OPUS");
  }
  async dispatchOpus(job, instruction, correction = false) {
    if (!instruction.trim()) throw new Error("Opus instruction must not be empty");
    const fresh = await this.requiredJob(job.job_id);
    const stored = await this.store.writeTextArtifact({ job_id: job.job_id, name: "opus_instruction", phase: fresh.phase, revision: fresh.artifact_revision + 1, invocation_id: this.invocation(job), producing_role: "codex", parent_artifact_hash: fresh.latest_artifact_hash, payload: instruction });
    await this.addArtifact(job.job_id, stored);
    const briefHash = hashCanonical(instruction);
    let prepared = { branch: fresh.branch, worktree: fresh.worktree, target_branch: fresh.target_branch, base_commit: fresh.base_commit };
    if (!prepared.branch || !prepared.worktree || !prepared.target_branch || !prepared.base_commit) prepared = await this.ports.git.prepare(job.job_id);
    const reference = artifactReference(ARTIFACT_FILES.opus_instruction, stored);
    await this.updatePassport(job.job_id, { accepted_brief_hash: briefHash, latest_implementation_brief: reference, active_worktree: prepared.worktree, target_branch: prepared.target_branch, base_commit: prepared.base_commit });
    await this.transition(await this.requiredJob(job.job_id), "opus_execution", { accepted_brief_hash: briefHash, branch: prepared.branch, worktree: prepared.worktree, target_branch: prepared.target_branch, base_commit: prepared.base_commit, opus_iteration: correction ? job.opus_iteration + 1 : job.opus_iteration, fix_cycles: correction ? job.fix_cycles + 1 : job.fix_cycles, last_action: correction ? "CORRECT_OPUS" : "DISPATCH_OPUS", current_commit: null, reviewed_diff_hash: null, next_action: "Opus implements Codex instructions in the dedicated worktree" });
  }
  async opusExecution(job) {
    if (!job.worktree || !job.branch || !job.accepted_brief_hash) throw new Error("Opus dispatch metadata is missing");
    const { passport, sessions } = await this.context(job.job_id);
    const prompt = await this.textPayload(job, "opus_instruction");
    const mode = sessions.opus_session_id && sessions.opus_brief_hash !== job.accepted_brief_hash ? "native_resume" : "new";
    const result = await this.invoke(job, "opus", { brief_hash: job.accepted_brief_hash }, () => this.ports.opus.execute(passport, prompt, job.worktree, mode === "native_resume" ? sessions.opus_session_id : null, mode));
    const opus = validateOpusResult(result.value);
    this.assertJob(job, opus.job_id);
    const stored = await this.artifact(job, "opus_report", "opus", opus, validateOpusResult);
    await this.addArtifact(job.job_id, stored);
    if (opus.status !== "completed" || opus.unresolved.length > 0) throw new Error(`Opus execution is not complete: ${opus.summary}`);
    const evidence = await this.ports.git.inspect(job.branch, job.worktree);
    this.assertAllowedScope(passport, evidence.files_changed);
    const fresh = await this.requiredJob(job.job_id);
    const diffStored = await this.store.writeTextArtifact({ job_id: job.job_id, name: "opus_diff", phase: "opus_execution", revision: fresh.artifact_revision + 1, invocation_id: this.invocation(job), producing_role: "orchestrator", parent_artifact_hash: fresh.latest_artifact_hash, payload: evidence.diff || "(empty diff)" });
    await this.addArtifact(job.job_id, diffStored);
    const checks = validateCheckResults(await this.ports.git.runChecks(job.worktree, evidence.commit, passport.required_checks));
    const checkStored = await this.artifact(await this.requiredJob(job.job_id), "test_results", "orchestrator", checks, validateCheckResults);
    await this.addArtifact(job.job_id, checkStored);
    await this.updatePassport(job.job_id, { current_commit: evidence.commit });
    await this.transition(await this.requiredJob(job.job_id), "codex_post_opus", { current_commit: evidence.commit, reviewed_diff_hash: evidence.diff_hash, next_action: "Codex reviews actual Opus diff, commit, and checks" });
  }
  async verification(job) {
    if (!job.branch || !job.worktree || !job.current_commit || !job.reviewed_diff_hash) throw new Error("Verification evidence is missing");
    const passport = await this.requiredPassport(job.job_id);
    const evidence = await this.ports.git.inspect(job.branch, job.worktree);
    const prior = await this.payload(job, "test_results");
    const checks = validateCheckResults(await this.ports.git.runChecks(job.worktree, evidence.commit, passport.required_checks));
    if (!prior.passed || !checks.passed || checks.checks.length === 0 || !hasMeaningfulChecks(checks.checks.map((check) => check.command)) || evidence.commit !== job.current_commit || evidence.diff_hash !== job.reviewed_diff_hash || prior.commit !== evidence.commit) return this.block(job, "Meaningful exact-revision verification is required before merge");
    const stored = await this.artifact(job, "test_results", "orchestrator", checks, validateCheckResults);
    await this.addArtifact(job.job_id, stored);
    await this.transition(await this.requiredJob(job.job_id), "merge_ready", { next_action: "Merge only the revalidated reviewed revision" });
  }
  async merge(job) {
    if (!job.branch || !job.worktree || !job.target_branch || !job.base_commit || !job.current_commit || !job.reviewed_diff_hash) throw new Error("Merge metadata is missing");
    const actual = await this.ports.git.currentCommit(job.branch);
    if (actual !== job.current_commit) throw new Error("Merge approval is stale or incomplete");
    if (await this.ports.git.isMerged(job.branch, job.current_commit, job.target_branch, job.base_commit)) {
      await this.transition(job, "done", { next_action: "Workflow complete" });
      await this.event(job.job_id, "merge_reconciled", { commit: job.current_commit });
      return;
    }
    const evidence = await this.ports.git.inspect(job.branch, job.worktree);
    const passport = await this.requiredPassport(job.job_id);
    const checks = validateCheckResults(await this.ports.git.runChecks(job.worktree, evidence.commit, passport.required_checks));
    const rechecked = await this.ports.git.inspect(job.branch, job.worktree);
    if (!checks.passed || !hasMeaningfulChecks(checks.checks.map((check) => check.command)) || evidence.commit !== job.current_commit || rechecked.commit !== job.current_commit || evidence.diff_hash !== job.reviewed_diff_hash || rechecked.diff_hash !== job.reviewed_diff_hash) throw new Error("Merge approval is stale or incomplete");
    const merged = await this.ports.git.merge(job.branch, job.current_commit, job.target_branch, job.base_commit);
    if (!merged.success) throw new Error(`Merge failed closed: ${merged.detail}`);
    await this.transition(job, "done", { next_action: "Workflow complete" });
    await this.event(job.job_id, "workflow_done", { commit: job.current_commit, diff_hash: evidence.diff_hash });
  }
  async reviewEvidence(job, stage) {
    const fableAdvice = stage.startsWith("after_fable") ? await this.optionalPayload(job, "fable_advice") : null;
    if (stage === "pre_opus" || stage === "after_fable_pre") return { evidence: null, checks: null, opus: null, fable_advice: fableAdvice };
    if (!job.branch || !job.worktree) throw new Error("Post-Opus worktree evidence is missing");
    return { evidence: await this.ports.git.inspect(job.branch, job.worktree), checks: await this.payload(job, "test_results"), opus: await this.payload(job, "opus_report"), fable_advice: fableAdvice };
  }
  async consultationDenial(job, decision, query) {
    if (job.mode !== "adaptive") return "direct_mode";
    const config = (await this.requiredPassport(job.job_id)).config;
    if (config.fable_total_cap === 0 || job.fable_calls >= config.fable_total_cap || job.consultation_status !== "unused") return "workflow_cap_or_duplicate";
    if (decision.risk_level !== "low") return "risk_not_low";
    if (Buffer.byteLength(JSON.stringify(query)) > config.max_input_bytes) return "input_oversized";
    const available = await this.ports.fable.available();
    if (!available.available) return "fable_unavailable";
    return null;
  }
  async artifact(job, name, role, value, validate) {
    const fresh = await this.requiredJob(job.job_id);
    return this.store.writeArtifact({ job_id: job.job_id, name, phase: fresh.phase, revision: fresh.artifact_revision + 1, invocation_id: this.invocation(job), producing_role: role, parent_artifact_hash: fresh.latest_artifact_hash, payload: value, validate });
  }
  async payload(job, name) {
    const result = await this.store.readArtifact(job.job_id, name);
    if (!result) throw new Error(`Required artifact missing: ${name}`);
    return result.payload;
  }
  async optionalPayload(job, name) {
    return (await this.store.readArtifact(job.job_id, name))?.payload ?? null;
  }
  async textPayload(job, name) {
    const result = await this.store.readTextArtifact(job.job_id, name);
    if (!result) throw new Error(`Required text artifact missing: ${name}`);
    return result.payload;
  }
  async transition(job, phase, patch = {}) {
    return this.store.commitTransition(job.job_id, phase, { ...patch, current_operation: null }, {});
  }
  async block(job, reason) {
    await this.transition(job, "blocked", { blocker: reason, resume_phase: job.phase, next_action: "Provide human input, then resume" });
    await this.event(job.job_id, "workflow_blocked", { reason });
  }
  async addArtifact(jobId, stored) {
    const passport = await this.requiredPassport(jobId);
    const reference = artifactReference(stored.metadata.filename, stored);
    if (passport.artifacts.some((item) => item.filename === reference.filename && item.hash === reference.hash)) return;
    await this.updatePassport(jobId, { artifacts: [...passport.artifacts, reference] });
  }
  async recordDecision(job, decision) {
    const passport = await this.requiredPassport(job.job_id);
    const invocationId = this.invocation(job);
    if (passport.decisions.some((item) => item.invocation_id === invocationId)) return;
    await this.updatePassport(job.job_id, { decisions: [...passport.decisions, { invocation_id: invocationId, action: decision.action, summary: decision.summary, provenance: "codex", timestamp: (/* @__PURE__ */ new Date()).toISOString() }] });
  }
  async updatePassport(jobId, patch) {
    const passport = await this.requiredPassport(jobId);
    const updated = { ...passport, ...patch, passport_revision: passport.passport_revision + 1, schema_version: 2, job_id: passport.job_id };
    if (Buffer.byteLength(JSON.stringify(updated)) > updated.config.passport_max_bytes) throw new Error("Workflow passport exceeded configured maximum");
    await this.store.writePassport(updated);
  }
  async rotateSession(jobId, role, reason) {
    const sessions = await this.requiredSessions(jobId);
    const key = role === "codex" ? "codex_thread_id" : "opus_session_id";
    const previous = sessions[key];
    const rotation = { role, previous_id: previous, next_id: null, reason: reason.trim() || "manual rotation", timestamp: (/* @__PURE__ */ new Date()).toISOString() };
    const updated = { ...sessions, [key]: null, ...role === "opus" ? { opus_brief_hash: null } : {}, modes: { ...sessions.modes, [role]: "none" }, rotation_history: [...sessions.rotation_history, rotation], updated_at: rotation.timestamp };
    await this.store.writeSessions(updated);
    await this.updatePassport(jobId, { session_references: { codex: updated.codex_thread_id, opus: updated.opus_session_id }, session_modes: updated.modes, rotation_history: updated.rotation_history });
    await this.event(jobId, "session_rotated", rotation);
  }
  async recordRole(job, role, result) {
    const sessions = await this.requiredSessions(job.job_id);
    const invocationId = this.invocation(job);
    if (sessions.recorded_invocations.includes(invocationId)) return;
    const u = sessions.usage[role];
    const inputChars = result.usage?.input_chars ?? 0;
    const outputChars = result.usage?.output_chars ?? Buffer.byteLength(typeof result.value === "string" ? result.value : JSON.stringify(result.value));
    const nextUsage = { calls: u.calls + 1, input_chars: u.input_chars + inputChars, output_chars: u.output_chars + outputChars, input_tokens: u.input_tokens + (result.usage?.input_tokens ?? 0), output_tokens: u.output_tokens + (result.usage?.output_tokens ?? 0), estimated_tokens: u.estimated_tokens + Math.ceil((inputChars + outputChars) / 4), cache_read: u.cache_read + (result.usage?.cache_read ?? 0), cache_write: u.cache_write + (result.usage?.cache_write ?? 0), duration_ms: u.duration_ms + (result.usage?.duration_ms ?? 0), failed_calls: u.failed_calls, resumes: u.resumes + (result.resumed ? 1 : 0), compactions: u.compactions + (result.usage?.compactions ?? 0) };
    const mode = result.session_mode ?? (result.resumed ? "native_resume" : result.resume_failed ? "passport_handoff" : result.session_id ? "new" : "none");
    const previous = role === "codex" ? sessions.codex_thread_id : role === "opus" ? sessions.opus_session_id : null;
    const next = result.session_id ?? previous;
    const rotation = role !== "fable" && result.resume_failed ? { role, previous_id: previous, next_id: next, reason: "native continuation unavailable or invalid; passport handoff used", timestamp: (/* @__PURE__ */ new Date()).toISOString() } : null;
    const updated = { ...sessions, codex_thread_id: role === "codex" ? next : sessions.codex_thread_id, opus_session_id: role === "opus" ? next : sessions.opus_session_id, opus_brief_hash: role === "opus" ? (await this.requiredJob(job.job_id)).accepted_brief_hash : sessions.opus_brief_hash, modes: role === "fable" ? sessions.modes : { ...sessions.modes, [role]: mode }, rotation_history: rotation ? [...sessions.rotation_history, rotation] : sessions.rotation_history, recorded_invocations: [...sessions.recorded_invocations, invocationId], usage: { ...sessions.usage, [role]: nextUsage }, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
    await this.store.writeSessions(updated);
    await this.updatePassport(job.job_id, { session_references: { codex: updated.codex_thread_id, opus: updated.opus_session_id }, session_modes: updated.modes, rotation_history: updated.rotation_history });
  }
  async fableOptions(passport) {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "orch-fable-empty-"));
    return { workspace, model: passport.config.profiles.fable.model, max_turns: 1, effort: "low", timeout_ms: passport.config.profiles.fable.timeout_ms, max_input_bytes: passport.config.max_input_bytes, max_output_bytes: passport.config.max_output_bytes };
  }
  async fableCall(job, options, request, call) {
    try {
      return await this.invoke(job, "fable", request, call);
    } finally {
      await fs.rm(options.workspace, { recursive: true, force: true });
    }
  }
  async invoke(job, role, request, call) {
    const invocationId = this.invocation(job);
    const requestHash = hashCanonical(request);
    const prior = await this.store.readInvocationReceipt(job.job_id, invocationId);
    if (prior) {
      if (prior.role !== role || prior.phase !== job.phase || prior.request_hash !== requestHash) throw new Error("Invocation receipt does not match workflow operation");
      const result = prior.result;
      await this.recordRole(job, role, result);
      return result;
    }
    const started = Date.now();
    try {
      const result = await call();
      result.usage = { ...result.usage, duration_ms: result.usage?.duration_ms ?? Date.now() - started };
      const receipt = { schema_version: 2, job_id: job.job_id, invocation_id: invocationId, phase: job.phase, role, request_hash: requestHash, workflow_revision: job.revision, timestamp: (/* @__PURE__ */ new Date()).toISOString(), result };
      await this.store.writeInvocationReceipt(receipt);
      await this.recordRole(job, role, result);
      return result;
    } catch (error) {
      await this.recordFailedRoleCall(job, role, Date.now() - started);
      throw error;
    }
  }
  async recordFailedRoleCall(job, role, durationMs) {
    const sessions = await this.requiredSessions(job.job_id);
    const invocationId = this.invocation(job);
    if (sessions.recorded_invocations.includes(invocationId)) return;
    const current = sessions.usage[role];
    await this.store.writeSessions({ ...sessions, recorded_invocations: [...sessions.recorded_invocations, invocationId], usage: { ...sessions.usage, [role]: { ...current, calls: current.calls + 1, duration_ms: current.duration_ms + durationMs, failed_calls: current.failed_calls + 1 } }, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
  }
  invocation(job) {
    if (!job.current_operation || job.current_operation.phase !== job.phase) throw new Error(`Workflow phase ${job.phase} has no reserved invocation`);
    return job.current_operation.invocation_id;
  }
  assertAllowedScope(passport, files) {
    if (passport.allowed_file_scope.length === 0) return;
    const outside = files.filter((file) => !passport.allowed_file_scope.some((allowed) => file === allowed || file.startsWith(`${allowed.replace(/\/$/, "")}/`)));
    if (outside.length) throw new Error(`Opus changed files outside approved scope: ${outside.join(", ")}`);
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
    await this.store.appendEvent({ schema_version: 2, job_id: id2, type, timestamp: (/* @__PURE__ */ new Date()).toISOString(), data });
  }
};
function usage() {
  return { calls: 0, input_chars: 0, output_chars: 0, input_tokens: 0, output_tokens: 0, estimated_tokens: 0, cache_read: 0, cache_write: 0, duration_ms: 0, failed_calls: 0, resumes: 0, compactions: 0 };
}
function hasMeaningfulChecks(commands) {
  return commands.some((command) => /^(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:test|typecheck|lint|check|build)|exec\s+(?:vitest|jest|eslint|tsc))\b|^(?:npx\s+)?(?:vitest|jest|eslint|tsc)\b|^(?:pytest|python(?:3)?\s+-m\s+(?:pytest|unittest|compileall)|go\s+test|cargo\s+(?:test|check|clippy)|dotnet\s+(?:test|build)|mvn\s+test|gradle\s+test|make\s+(?:test|check|lint|build))\b/i.test(command.trim().replace(/\s+/g, " ")));
}

export { DEFAULT_WORKFLOW_CONFIG, WORKFLOW_SCHEMA_VERSION, WorkflowEngine, validateCheckResults, validateCodexDecision, validateFableAdvice, validateFableQuery, validateOpusResult };
//# sourceMappingURL=chunk-DT7UFNKU.js.map
//# sourceMappingURL=chunk-DT7UFNKU.js.map