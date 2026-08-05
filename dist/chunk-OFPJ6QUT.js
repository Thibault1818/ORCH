import { validateDeterministicCheckCommands } from './chunk-D6YHC656.js';
import { validateRosterSnapshot, createRosterSnapshot, hashRosterSnapshot, isTerminalWorkflowPhase, hashCanonical, artifactReference, ARTIFACT_FILES, validateRosterAgent, hashRosterAgent, hashPersisted } from './chunk-3R3KVGGX.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { nanoid } from 'nanoid';

// src/domain/workflow/contracts.ts
var WORKFLOW_SCHEMA_VERSION = 2;
function validateCodexDecision(value, stage) {
  const o = exact(value, ["schema_version", "job_id", "action", "summary", "implementation_brief", "required_changes", "risk_level", "fable_query", "reviewed_commit", "fable_advice_disposition", "fable_error", "fable_iteration_effect"], "Codex decision");
  if (o.schema_version !== 2) throw new Error("Unsupported Codex decision schema version");
  const action = enumeration(o.action, ["DISPATCH_OPUS", "ACCEPT", "CORRECT_OPUS", "CONSULT_FABLE", "PAUSE", "STOP"], "action");
  const allowed = stage === "pre_opus" ? ["DISPATCH_OPUS", "CONSULT_FABLE", "PAUSE", "STOP"] : stage === "post_opus" ? ["ACCEPT", "CORRECT_OPUS", "CONSULT_FABLE", "PAUSE", "STOP"] : stage === "after_fable_pre" ? ["DISPATCH_OPUS", "PAUSE", "STOP"] : ["ACCEPT", "CORRECT_OPUS", "PAUSE", "STOP"];
  if (!allowed.includes(action)) throw new Error(`Codex action ${action} is invalid during ${stage}`);
  const implementationBrief = o.implementation_brief === null ? null : nonEmpty(o.implementation_brief, "implementation_brief");
  const requiredChanges = strings(o.required_changes, "required_changes");
  const fableQuery = o.fable_query === null ? null : validateFableQuery(o.fable_query);
  const reviewedCommit = o.reviewed_commit === null ? null : commit(o.reviewed_commit);
  const disposition = o.fable_advice_disposition === null ? null : enumeration(o.fable_advice_disposition, ["accepted", "rejected"], "fable_advice_disposition");
  const fableError = o.fable_error === null ? null : nonEmpty(o.fable_error, "fable_error");
  const iterationEffect = o.fable_iteration_effect === null ? null : enumeration(o.fable_iteration_effect, ["avoided", "added", "unchanged"], "fable_iteration_effect");
  const afterFable = stage === "after_fable_pre" || stage === "after_fable_post";
  if (action === "DISPATCH_OPUS" && !implementationBrief) throw new Error("DISPATCH_OPUS requires implementation_brief");
  if (action !== "DISPATCH_OPUS" && implementationBrief !== null) throw new Error(`${action} cannot include implementation_brief`);
  if (action === "CORRECT_OPUS" && requiredChanges.length === 0) throw new Error("CORRECT_OPUS requires required_changes");
  if (action !== "CORRECT_OPUS" && requiredChanges.length > 0) throw new Error(`${action} cannot include required_changes`);
  if (action === "CONSULT_FABLE" && !fableQuery) throw new Error("CONSULT_FABLE requires fable_query");
  if (action !== "CONSULT_FABLE" && fableQuery !== null) throw new Error(`${action} requires fable_query null`);
  if (fableQuery && (stage === "pre_opus" || stage === "after_fable_pre") && fableQuery.fallback_if_skipped.action === "CORRECT_OPUS") throw new Error("Pre-Opus consultation cannot use CORRECT_OPUS fallback");
  if (fableQuery && (stage === "post_opus" || stage === "after_fable_post") && fableQuery.fallback_if_skipped.action === "DISPATCH_OPUS") throw new Error("Post-Opus consultation cannot use DISPATCH_OPUS fallback");
  if ((stage === "post_opus" || stage === "after_fable_post") && reviewedCommit === null) throw new Error("Post-Opus decision requires reviewed_commit");
  if ((stage === "pre_opus" || stage === "after_fable_pre") && reviewedCommit !== null) throw new Error("Pre-Opus decision cannot include reviewed_commit");
  if (afterFable && (disposition === null || iterationEffect === null)) throw new Error("After-Fable decision must record advice disposition and iteration effect");
  if (!afterFable && (disposition !== null || fableError !== null || iterationEffect !== null)) throw new Error("Non-Fable decision cannot record Fable outcome");
  return { schema_version: 2, job_id: id(o.job_id), action, summary: nonEmpty(o.summary, "summary"), implementation_brief: implementationBrief, required_changes: requiredChanges, risk_level: enumeration(o.risk_level, ["low", "medium", "high"], "risk_level"), fable_query: fableQuery, reviewed_commit: reviewedCommit, fable_advice_disposition: disposition, fable_error: fableError, fable_iteration_effect: iterationEffect };
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
function validateFableFallbackRecord(value) {
  const o = exact(value, ["schema_version", "reason", "action", "instructions", "origin"], "Fable fallback record");
  if (o.schema_version !== 1) throw new Error("Unsupported Fable fallback record schema version");
  return { schema_version: 1, reason: enumeration(o.reason, ["direct_mode", "workflow_cap_or_duplicate", "risk_not_low", "input_oversized", "fable_unavailable", "fable_failed", "malformed_request", "ambiguous_interruption", "resume_persisted_fallback"], "reason"), action: enumeration(o.action, ["DISPATCH_OPUS", "CORRECT_OPUS", "PAUSE"], "fallback action"), instructions: nonEmpty(o.instructions, "fallback instructions"), origin: enumeration(o.origin, ["pre_opus", "post_opus"], "origin") };
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

// src/application/workflow/ports.ts
var LegacyWorkflowRoleResolver = class {
  constructor(ports) {
    this.ports = ports;
  }
  ports;
  async availability(binding, role) {
    const supported = role === "supervisor" || role === "reviewer" ? binding.adapter === "codex" : role === "implementer" ? binding.adapter === "claude" : binding.adapter === "claude" || binding.adapter === "fable";
    if (!supported)
      return {
        available: false,
        detail: `Unsupported ${role} binding: ${binding.adapter}`
      };
    return role === "supervisor" || role === "reviewer" ? this.ports.codex.available() : role === "implementer" ? this.ports.opus.available() : this.ports.fable.available();
  }
  decide(_binding, passport, stage, evidence, threadId, observer) {
    return this.ports.codex.decide(
      passport,
      stage,
      evidence,
      threadId,
      observer
    );
  }
  execute(_binding, passport, prompt, workspace, sessionId, mode, observer) {
    return this.ports.opus.execute(
      passport,
      prompt,
      workspace,
      sessionId,
      mode,
      observer
    );
  }
  consult(_binding, jobId, consultationId, query, options, observer) {
    return this.ports.fable.consult(
      jobId,
      consultationId,
      query,
      options,
      observer
    );
  }
};

// src/application/workflow/engine.ts
var DEFAULT_WORKFLOW_CONFIG = {
  fable_total_cap: 0,
  max_input_bytes: 128e3,
  max_output_bytes: 64e3,
  passport_max_bytes: 64e3,
  profiles: {
    fable: {
      model: "",
      effort: "low",
      max_turns: 1,
      timeout_ms: 3e5,
      permission_mode: "read_only"
    },
    opus: {
      model: "opus",
      effort: "high",
      max_turns: 50,
      timeout_ms: 18e5,
      permission_mode: "worktree"
    },
    codex: {
      model: "",
      effort: "medium",
      max_turns: 1,
      timeout_ms: 6e5,
      permission_mode: "read_only"
    }
  }
};
var WorkflowEngine = class {
  constructor(store, ports) {
    this.store = store;
    this.roles = "roles" in ports ? ports.roles : new LegacyWorkflowRoleResolver(ports);
    this.git = ports.git;
  }
  store;
  roles;
  git;
  async start(input) {
    if (!input.objective.trim())
      throw new Error("Workflow objective must not be empty");
    const requiredChecks = validateDeterministicCheckCommands(
      input.required_checks ?? []
    );
    if (requiredChecks.length === 0)
      throw new Error(
        "Workflow requires at least one meaningful deterministic check"
      );
    const trustedChecks = await this.git.validateChecks(requiredChecks);
    const rawConfig = input.config;
    const obsolete = [
      "fable_pre_opus_cap",
      "fable_post_opus_per_iteration_cap",
      "post_review",
      "risk_triggers"
    ].filter((key) => rawConfig && key in rawConfig);
    if (obsolete.length)
      throw new Error(
        `Obsolete workflow configuration is incompatible with direct workflow v2: ${obsolete.join(", ")}`
      );
    const mode = input.mode ?? "adaptive";
    const id2 = input.job_id ?? `wf_${nanoid(12)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const requestedCap = mode === "direct" ? 0 : input.config?.fable_total_cap ?? 0;
    const baseProfiles = {
      fable: {
        ...DEFAULT_WORKFLOW_CONFIG.profiles.fable,
        ...input.config?.profiles?.fable
      },
      opus: {
        ...DEFAULT_WORKFLOW_CONFIG.profiles.opus,
        ...input.config?.profiles?.opus
      },
      codex: {
        ...DEFAULT_WORKFLOW_CONFIG.profiles.codex,
        ...input.config?.profiles?.codex
      }
    };
    const roster = input.roster ? validateRosterSnapshot(input.roster, mode) : createRosterSnapshot(
      {
        supervisor: rosterAgent("codex", "codex", baseProfiles.codex),
        implementer: rosterAgent("claude", "opus", baseProfiles.opus),
        adviser: requestedCap === 1 ? rosterAgent("fable", "fable", baseProfiles.fable) : null
      },
      mode
    );
    this.assertRuntimeRoster(roster, mode);
    if (!input.allow_unverified_model) {
      for (const binding of rosterBindings(roster)) {
        if (binding.profile.model && !(binding.adapter === "claude" && binding.profile.model === "opus"))
          throw new Error(
            `Unverified workflow model/profile requires explicit opt-in: ${binding.adapter}:${binding.profile.model}`
          );
      }
    }
    const config = {
      fable_total_cap: requestedCap,
      max_input_bytes: input.config?.max_input_bytes ?? DEFAULT_WORKFLOW_CONFIG.max_input_bytes,
      max_output_bytes: input.config?.max_output_bytes ?? DEFAULT_WORKFLOW_CONFIG.max_output_bytes,
      passport_max_bytes: input.config?.passport_max_bytes ?? DEFAULT_WORKFLOW_CONFIG.passport_max_bytes,
      profiles: {
        fable: profileFromRoster(roster.adviser, baseProfiles.fable),
        opus: profileFromRoster(roster.implementer, baseProfiles.opus),
        codex: profileFromRoster(roster.supervisor, baseProfiles.codex)
      }
    };
    if (Boolean(roster.adviser) !== (config.fable_total_cap === 1))
      throw new Error(
        "Adviser binding and adviser call cap must be configured together"
      );
    if (config.fable_total_cap !== 0 && config.fable_total_cap !== 1)
      throw new Error("Fable whole-workflow cap must be zero or one");
    if (config.profiles.fable.effort !== "low" || config.profiles.fable.max_turns !== 1 || config.profiles.fable.permission_mode !== "read_only")
      throw new Error(
        "Fable must use low effort, one turn, and read-only isolation"
      );
    if (config.profiles.codex.permission_mode !== "read_only")
      throw new Error("Codex review must remain read-only");
    if (config.profiles.opus.permission_mode !== "worktree")
      throw new Error("Opus must use worktree permissions");
    const reviewer = reviewerBinding(roster);
    const capabilities = await Promise.all([
      this.roles.availability(roster.supervisor, "supervisor"),
      this.roles.availability(roster.implementer, "implementer"),
      this.roles.availability(reviewer, "reviewer"),
      ...roster.adviser ? [this.roles.availability(roster.adviser, "adviser")] : []
    ]);
    const unavailable = capabilities.filter((item) => !item.available).map((item) => item.detail);
    if (unavailable.length)
      throw new Error(
        `Workflow capabilities blocked: ${unavailable.join("; ")}`
      );
    const job = {
      schema_version: 2,
      job_id: id2,
      mode,
      phase: "codex_pre_opus",
      resume_phase: null,
      revision: 1,
      artifact_revision: 0,
      latest_artifact_hash: null,
      opus_iteration: 1,
      fix_cycles: 0,
      fable_calls: 0,
      consultation_status: "unused",
      consultation_origin: null,
      branch: null,
      worktree: null,
      target_branch: null,
      base_commit: null,
      current_commit: null,
      reviewed_diff_hash: null,
      accepted_brief_hash: null,
      last_action: null,
      blocker: null,
      next_action: "Codex decides whether to dispatch Opus",
      current_operation: null,
      created_at: now,
      updated_at: now
    };
    const rosterHash = hashRosterSnapshot(roster);
    const passport = {
      schema_version: 2,
      passport_revision: 1,
      job_id: id2,
      mode,
      current_revision: 1,
      objective: input.objective,
      current_phase: "codex_pre_opus",
      accepted_brief_hash: null,
      latest_implementation_brief: null,
      hard_constraints: [],
      acceptance_criteria: [],
      decisions: [],
      allowed_file_scope: input.allowed_file_scope ?? [],
      required_checks: trustedChecks,
      current_blockers: [],
      next_action: job.next_action,
      artifacts: [],
      active_worktree: null,
      target_branch: null,
      base_commit: null,
      current_commit: null,
      session_references: { codex: null, opus: null },
      session_modes: { codex: "none", opus: "none" },
      rotation_history: [],
      config,
      roster,
      roster_hash: rosterHash,
      active_roster: roster,
      active_roster_hash: rosterHash,
      roster_revision: 1,
      binding_rotation_history: []
    };
    if (Buffer.byteLength(JSON.stringify(passport)) > config.passport_max_bytes)
      throw new Error("Initial workflow passport exceeded configured maximum");
    const sessions = {
      schema_version: 2,
      sessions_revision: 1,
      job_id: id2,
      codex_thread_id: null,
      opus_session_id: null,
      opus_brief_hash: null,
      modes: { codex: "none", opus: "none" },
      rotation_history: [],
      recorded_invocations: [],
      usage: { codex: usage(), fable: usage(), opus: usage() },
      updated_at: now
    };
    await this.store.createJob(job, passport, sessions);
    await this.event(id2, "workflow_started", { mode });
    return id2;
  }
  async run(jobId) {
    while (true) {
      const job = await this.advance(jobId);
      if (isTerminalWorkflowPhase(job.phase) || job.phase === "paused" || job.phase === "blocked")
        return job;
    }
  }
  async advance(jobId) {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase) || job.phase === "paused" || job.phase === "blocked")
      return job;
    try {
      if (job.current_operation) {
        const receipt = await this.store.readInvocationReceipt(
          job.job_id,
          job.current_operation.invocation_id
        );
        const checks = await this.store.readEffectReceipt(
          job.job_id,
          job.current_operation.invocation_id,
          "checks"
        );
        const merge = await this.store.readEffectReceipt(
          job.job_id,
          job.current_operation.invocation_id,
          "merge"
        );
        if (job.phase === "merge_ready" || receipt || checks || merge) {
          await this.step(job);
          return this.requiredJob(jobId);
        }
        if (job.phase === "fable_consultation" && (job.consultation_status === "attempt_started" || job.consultation_status === "fallback_executed")) {
          await this.executeConsultationFallback(
            job,
            job.consultation_status === "attempt_started" ? "ambiguous_interruption" : "resume_persisted_fallback"
          );
          return this.requiredJob(jobId);
        }
        await this.ensureInterruptedAttempt(job);
        await this.block(
          job,
          `INTERRUPTED: ${job.current_operation.phase} operation ${job.current_operation.invocation_id} has no durable result; explicit retry approval is required`
        );
        return this.requiredJob(jobId);
      }
      const operation = {
        phase: job.phase,
        invocation_id: `inv_${nanoid(12)}`,
        started_at: (/* @__PURE__ */ new Date()).toISOString(),
        retry_count: 0
      };
      if (!await this.store.reserveOperation(job.job_id, job.phase, operation))
        return this.requiredJob(job.job_id);
      await this.step({ ...job, current_operation: operation });
      return this.requiredJob(jobId);
    } catch (error) {
      const rawReason = error instanceof Error ? error.message : String(error);
      if (rawReason.startsWith("AMBIGUOUS_EFFECT:")) {
        await this.block(await this.requiredJob(jobId), rawReason);
        return this.requiredJob(jobId);
      }
      const reason = safeErrorMessage(error);
      await this.event(jobId, "workflow_failed", {
        category: errorCategory(error),
        reason
      });
      return this.store.transition(jobId, "failed", {
        blocker: reason,
        next_action: "Inspect workflow logs and artifacts"
      });
    }
  }
  async pause(jobId) {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase) || job.phase === "paused")
      throw new Error(`Cannot pause workflow in ${job.phase}`);
    return this.transition(job, "paused", {
      resume_phase: job.phase,
      next_action: "Resume workflow"
    });
  }
  async resume(jobId, options = {}) {
    const job = await this.requiredJob(jobId);
    const reason = options.reason?.trim();
    if (!reason) throw new Error("Resume requires --reason");
    if (isTerminalWorkflowPhase(job.phase))
      throw new Error(`Cannot resume workflow in ${job.phase}`);
    if (job.phase !== "paused" && job.phase !== "blocked") {
      await this.event(jobId, "workflow_resumed", {
        phase: job.phase,
        reason,
        mode: "active_reconciliation"
      });
      return this.run(jobId);
    }
    if (!job.resume_phase) throw new Error("Workflow has no recoverable phase");
    if (job.blocker?.startsWith("LEGACY_SCHEMA:"))
      throw new Error(
        "Legacy schema workflow cannot be resumed; start a new workflow"
      );
    if (job.blocker?.startsWith("AMBIGUOUS_EFFECT:"))
      throw new Error(
        "Ambiguous external effect cannot be retried safely; inspect the receipt and start a new workflow"
      );
    if (job.blocker?.startsWith("INTERRUPTED:") && (!options.retry_invocation || !reason))
      throw new Error(
        "Interrupted invocation requires --retry-invocation and --reason"
      );
    const resumed = await this.transition(job, job.resume_phase, {
      blocker: null,
      resume_phase: null,
      current_operation: null
    });
    await this.event(jobId, "workflow_resumed", {
      phase: resumed.phase,
      reason
    });
    return this.run(jobId);
  }
  async cancel(jobId) {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase))
      throw new Error(`Cannot cancel workflow in ${job.phase}`);
    return this.transition(job, "cancelled", {
      next_action: "No further action"
    });
  }
  async step(job) {
    switch (job.phase) {
      case "codex_pre_opus":
        return this.codexDecision(job, "pre_opus");
      case "fable_consultation":
        return this.fableConsultation(job);
      case "codex_after_fable":
        return this.codexDecision(
          job,
          job.consultation_origin === "pre_opus" ? "after_fable_pre" : "after_fable_post"
        );
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
    await this.ensureTrustedChecks(job.job_id);
    const { passport, sessions } = await this.context(job.job_id);
    const evidence = await this.reviewEvidence(job, stage);
    const semanticRole = decisionRole(stage);
    const binding = roleBinding(passport.active_roster, semanticRole);
    const sameAsSupervisor = semanticRole === "supervisor" || sameBinding(binding, passport.active_roster.supervisor);
    let result;
    try {
      result = await this.invoke(
        job,
        semanticRole,
        "codex",
        binding,
        { stage, evidence },
        (observer) => this.roles.decide(
          binding,
          passport,
          stage,
          evidence,
          sameAsSupervisor ? sessions.codex_thread_id : null,
          observer
        ),
        (value) => {
          try {
            const decision2 = validateCodexDecision(value, stage);
            this.assertJob(job, decision2.job_id);
            if (decision2.reviewed_commit && decision2.reviewed_commit !== evidence.evidence?.commit)
              throw new Error("Codex decision reviewed stale commit");
            return decision2;
          } catch (error) {
            throw resultValidationError(error, value);
          }
        }
      );
    } catch (error) {
      const value = validationResult(error);
      if (value !== void 0 && await this.fallbackMalformedConsultation(job, value, stage, error))
        return;
      throw error;
    }
    const decision = result.value;
    await this.recordDecision(job, decision);
    const stored = await this.artifact(
      job,
      "codex_decision",
      "codex",
      decision,
      (value) => validateCodexDecision(value, stage)
    );
    await this.addArtifact(job.job_id, stored);
    if (decision.action === "STOP")
      return this.transition(job, "cancelled", {
        last_action: "STOP",
        next_action: "Workflow stopped without merge"
      }).then(() => void 0);
    if (decision.action === "PAUSE")
      return this.transition(job, "paused", {
        resume_phase: job.phase,
        last_action: "PAUSE",
        next_action: decision.summary
      }).then(() => void 0);
    if (decision.action === "CONSULT_FABLE")
      return this.routeConsultation(
        job,
        decision,
        stage === "pre_opus" || stage === "after_fable_pre" ? "pre_opus" : "post_opus"
      );
    if (decision.action === "DISPATCH_OPUS")
      return this.dispatchOpus(job, decision.implementation_brief);
    if (decision.action === "CORRECT_OPUS")
      return this.dispatchOpus(job, decision.required_changes.join("\n"), true);
    if (decision.action === "ACCEPT") {
      if (!evidence.evidence || !evidence.checks || !evidence.opus)
        throw new Error("ACCEPT requires real Opus evidence");
      return this.transition(job, "verification", {
        last_action: "ACCEPT",
        current_commit: decision.reviewed_commit,
        next_action: "Revalidate exact evidence before merge"
      }).then(() => void 0);
    }
  }
  async routeConsultation(job, decision, origin) {
    const query = decision.fable_query;
    const denial = await this.consultationDenial(job, decision, query);
    const request = await this.artifact(
      job,
      "fable_request",
      "codex",
      query,
      (value) => validateCodexDecision(
        { ...decision, fable_query: value },
        origin === "pre_opus" ? "pre_opus" : "post_opus"
      ).fable_query
    );
    await this.addArtifact(job.job_id, request);
    await this.store.patchJob(job.job_id, {
      consultation_status: denial ? "skipped" : "requested",
      consultation_origin: origin
    });
    if (denial) {
      await this.event(job.job_id, "fable_consultation_skipped", {
        reason: denial,
        origin
      });
      return this.executeConsultationFallback(
        await this.requiredJob(job.job_id),
        denial,
        query
      );
    }
    await this.transition(
      await this.requiredJob(job.job_id),
      "fable_consultation",
      {
        consultation_status: "requested",
        consultation_origin: origin,
        last_action: "CONSULT_FABLE",
        next_action: "Run one bounded stateless Fable consultation"
      }
    );
  }
  async fallbackMalformedConsultation(job, value, stage, error) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const raw = value;
    if (raw.action !== "CONSULT_FABLE" || raw.job_id !== job.job_id)
      return false;
    let query;
    try {
      query = validateFableQuery(raw.fable_query);
    } catch {
      return false;
    }
    const origin = stage === "pre_opus" || stage === "after_fable_pre" ? "pre_opus" : "post_opus";
    if (origin === "pre_opus" && query.fallback_if_skipped.action === "CORRECT_OPUS" || origin === "post_opus" && query.fallback_if_skipped.action === "DISPATCH_OPUS")
      return false;
    const request = await this.artifact(
      job,
      "fable_request",
      "codex",
      query,
      validateFableQuery
    );
    await this.addArtifact(job.job_id, request);
    await this.store.patchJob(job.job_id, {
      consultation_status: "skipped",
      consultation_origin: origin
    });
    await this.event(job.job_id, "fable_consultation_skipped", {
      reason: "malformed_request",
      detail: error instanceof Error ? error.message : String(error),
      origin
    });
    await this.executeConsultationFallback(
      await this.requiredJob(job.job_id),
      "malformed_request",
      query
    );
    return true;
  }
  async fableConsultation(job) {
    await this.ensureTrustedChecks(job.job_id);
    const query = await this.payload(job, "fable_request");
    const consultationId = `consult_${job.job_id}_${job.revision}`;
    const existing = await this.store.readInvocationReceipt(
      job.job_id,
      this.invocation(job)
    );
    if (!existing && (job.consultation_status === "attempt_started" || job.consultation_status === "fallback_executed"))
      return this.executeConsultationFallback(
        job,
        job.consultation_status === "attempt_started" ? "ambiguous_interruption" : "resume_persisted_fallback"
      );
    if (!existing)
      await this.store.patchJob(job.job_id, {
        consultation_status: "attempt_started",
        fable_calls: job.fable_calls + 1
      });
    const options = await this.fableOptions(
      await this.requiredPassport(job.job_id)
    );
    try {
      const passport = await this.requiredPassport(job.job_id);
      const binding = roleBinding(passport.active_roster, "adviser");
      const result = await this.fableCall(
        job,
        binding,
        options,
        { consultation_id: consultationId, query },
        (observer) => this.roles.consult(
          binding,
          job.job_id,
          consultationId,
          query,
          options,
          observer
        ),
        (value) => {
          const advice2 = validateFableAdvice(value);
          if (advice2.consultation_id !== consultationId)
            throw new Error("Fable advice consultation_id mismatch");
          return advice2;
        }
      );
      const advice = result.value;
      const stored = await this.artifact(
        await this.requiredJob(job.job_id),
        "fable_advice",
        "fable",
        advice,
        validateFableAdvice
      );
      await this.addArtifact(job.job_id, stored);
      await this.store.patchJob(job.job_id, {
        consultation_status: "result_persisted"
      });
      await this.transition(
        await this.requiredJob(job.job_id),
        "codex_after_fable",
        {
          consultation_status: "result_persisted",
          next_action: "Codex verifies optional Fable advice"
        }
      );
    } catch (error) {
      await this.event(job.job_id, "fable_consultation_failed", {
        category: errorCategory(error),
        reason: safeErrorMessage(error)
      });
      await this.executeConsultationFallback(
        await this.requiredJob(job.job_id),
        "fable_failed",
        query
      );
    }
  }
  async executeConsultationFallback(job, reason, provided) {
    const query = provided ?? await this.payload(job, "fable_request");
    const fallback = query.fallback_if_skipped;
    if (!job.consultation_origin)
      throw new Error("Consultation origin is missing");
    const routing = validateFableFallbackRecord({
      schema_version: 1,
      reason,
      action: fallback.action,
      instructions: fallback.instructions,
      origin: job.consultation_origin
    });
    const stored = await this.artifact(
      job,
      "routing_decision",
      "orchestrator",
      routing,
      validateFableFallbackRecord
    );
    await this.addArtifact(job.job_id, stored);
    const persisted = validateFableFallbackRecord(stored.payload);
    await this.store.patchJob(job.job_id, {
      consultation_status: "fallback_executed"
    });
    if (persisted.action === "PAUSE") {
      await this.transition(await this.requiredJob(job.job_id), "paused", {
        resume_phase: persisted.origin === "pre_opus" ? "codex_pre_opus" : "codex_post_opus",
        consultation_status: "fallback_executed",
        next_action: persisted.instructions
      });
      return;
    }
    await this.dispatchOpus(
      await this.requiredJob(job.job_id),
      persisted.instructions,
      persisted.action === "CORRECT_OPUS"
    );
  }
  async dispatchOpus(job, instruction, correction = false) {
    if (!instruction.trim())
      throw new Error("Opus instruction must not be empty");
    const fresh = await this.requiredJob(job.job_id);
    const stored = await this.store.writeTextArtifact({
      job_id: job.job_id,
      name: "opus_instruction",
      phase: fresh.phase,
      revision: fresh.artifact_revision + 1,
      invocation_id: this.invocation(job),
      producing_role: "codex",
      parent_artifact_hash: fresh.latest_artifact_hash,
      payload: instruction
    });
    await this.addArtifact(job.job_id, stored);
    const briefHash = hashCanonical(instruction);
    let prepared = {
      branch: fresh.branch,
      worktree: fresh.worktree,
      target_branch: fresh.target_branch,
      base_commit: fresh.base_commit
    };
    if (!prepared.branch || !prepared.worktree || !prepared.target_branch || !prepared.base_commit)
      prepared = await this.git.prepare(job.job_id);
    const reference = artifactReference(
      ARTIFACT_FILES.opus_instruction,
      stored
    );
    await this.updatePassport(job.job_id, {
      accepted_brief_hash: briefHash,
      latest_implementation_brief: reference,
      active_worktree: prepared.worktree,
      target_branch: prepared.target_branch,
      base_commit: prepared.base_commit
    });
    await this.transition(
      await this.requiredJob(job.job_id),
      "opus_execution",
      {
        accepted_brief_hash: briefHash,
        branch: prepared.branch,
        worktree: prepared.worktree,
        target_branch: prepared.target_branch,
        base_commit: prepared.base_commit,
        opus_iteration: correction ? job.opus_iteration + 1 : job.opus_iteration,
        fix_cycles: correction ? job.fix_cycles + 1 : job.fix_cycles,
        last_action: correction ? "CORRECT_OPUS" : "DISPATCH_OPUS",
        current_commit: null,
        reviewed_diff_hash: null,
        next_action: "Opus implements Codex instructions in the dedicated worktree"
      }
    );
  }
  async opusExecution(job) {
    await this.ensureTrustedChecks(job.job_id);
    if (!job.worktree || !job.branch || !job.accepted_brief_hash)
      throw new Error("Opus dispatch metadata is missing");
    const { passport, sessions } = await this.context(job.job_id);
    const prompt = await this.textPayload(job, "opus_instruction");
    const mode = sessions.opus_session_id && sessions.opus_brief_hash !== job.accepted_brief_hash ? "native_resume" : "new";
    const binding = roleBinding(passport.active_roster, "implementer");
    const result = await this.invoke(
      job,
      "implementer",
      "opus",
      binding,
      { brief_hash: job.accepted_brief_hash },
      (observer) => this.roles.execute(
        binding,
        passport,
        prompt,
        job.worktree,
        mode === "native_resume" ? sessions.opus_session_id : null,
        mode,
        observer
      ),
      (value) => {
        const opus2 = validateOpusResult(value);
        this.assertJob(job, opus2.job_id);
        if (opus2.status !== "completed" || opus2.unresolved.length > 0)
          throw new Error(`Opus execution is not complete: ${opus2.summary}`);
        return opus2;
      }
    );
    const opus = result.value;
    const stored = await this.artifact(
      job,
      "opus_report",
      "opus",
      opus,
      validateOpusResult
    );
    await this.addArtifact(job.job_id, stored);
    const evidence = await this.git.inspect(job.branch, job.worktree);
    this.assertAllowedScope(passport, evidence.files_changed);
    const fresh = await this.requiredJob(job.job_id);
    const diffStored = await this.store.writeTextArtifact({
      job_id: job.job_id,
      name: "opus_diff",
      phase: "opus_execution",
      revision: fresh.artifact_revision + 1,
      invocation_id: this.invocation(job),
      producing_role: "orchestrator",
      parent_artifact_hash: fresh.latest_artifact_hash,
      payload: evidence.diff || "(empty diff)"
    });
    await this.addArtifact(job.job_id, diffStored);
    const checks = await this.runChecksOnce(
      job,
      job.worktree,
      evidence.commit,
      passport.required_checks
    );
    const checkStored = await this.artifact(
      await this.requiredJob(job.job_id),
      "test_results",
      "orchestrator",
      checks,
      validateCheckResults
    );
    await this.addArtifact(job.job_id, checkStored);
    await this.updatePassport(job.job_id, { current_commit: evidence.commit });
    await this.transition(
      await this.requiredJob(job.job_id),
      "codex_post_opus",
      {
        current_commit: evidence.commit,
        reviewed_diff_hash: evidence.diff_hash,
        next_action: "Codex reviews actual Opus diff, commit, and checks"
      }
    );
  }
  async verification(job) {
    if (!job.branch || !job.worktree || !job.current_commit || !job.reviewed_diff_hash)
      throw new Error("Verification evidence is missing");
    const passport = await this.requiredPassport(job.job_id);
    const evidence = await this.git.inspect(job.branch, job.worktree);
    const prior = await this.payload(job, "test_results");
    const checks = await this.runChecksOnce(
      job,
      job.worktree,
      evidence.commit,
      passport.required_checks
    );
    if (!prior.passed || !checks.passed || checks.checks.length === 0 || !hasMeaningfulChecks(checks.checks.map((check) => check.command)) || evidence.commit !== job.current_commit || evidence.diff_hash !== job.reviewed_diff_hash || prior.commit !== evidence.commit)
      return this.block(
        job,
        "Meaningful exact-revision verification is required before merge"
      );
    const stored = await this.artifact(
      job,
      "test_results",
      "orchestrator",
      checks,
      validateCheckResults
    );
    await this.addArtifact(job.job_id, stored);
    await this.transition(await this.requiredJob(job.job_id), "merge_ready", {
      next_action: "Merge only the revalidated reviewed revision"
    });
  }
  async merge(job) {
    if (!job.branch || !job.worktree || !job.target_branch || !job.base_commit || !job.current_commit || !job.reviewed_diff_hash)
      throw new Error("Merge metadata is missing");
    const actual = await this.git.currentCommit(job.branch);
    if (actual !== job.current_commit)
      throw new Error("Merge approval is stale or incomplete");
    if (await this.git.isMerged(
      job.branch,
      job.current_commit,
      job.target_branch,
      job.base_commit
    )) {
      await this.transition(job, "done", { next_action: "Workflow complete" });
      await this.event(job.job_id, "merge_reconciled", {
        commit: job.current_commit
      });
      return;
    }
    const evidence = await this.git.inspect(job.branch, job.worktree);
    const passport = await this.requiredPassport(job.job_id);
    const checks = await this.runChecksOnce(
      job,
      job.worktree,
      evidence.commit,
      passport.required_checks
    );
    const rechecked = await this.git.inspect(job.branch, job.worktree);
    if (!checks.passed || !hasMeaningfulChecks(checks.checks.map((check) => check.command)) || evidence.commit !== job.current_commit || rechecked.commit !== job.current_commit || evidence.diff_hash !== job.reviewed_diff_hash || rechecked.diff_hash !== job.reviewed_diff_hash)
      throw new Error("Merge approval is stale or incomplete");
    const merged = await this.mergeOnce(
      job,
      job.branch,
      job.current_commit,
      job.target_branch,
      job.base_commit
    );
    if (!merged.success)
      throw new Error(`Merge failed closed: ${merged.detail}`);
    await this.transition(job, "done", { next_action: "Workflow complete" });
    await this.event(job.job_id, "workflow_done", {
      commit: job.current_commit,
      diff_hash: evidence.diff_hash
    });
  }
  async reviewEvidence(job, stage) {
    const fableAdvice = stage.startsWith("after_fable") ? await this.optionalPayload(job, "fable_advice") : null;
    if (stage === "pre_opus" || stage === "after_fable_pre")
      return {
        evidence: null,
        checks: null,
        opus: null,
        fable_advice: fableAdvice
      };
    if (!job.branch || !job.worktree)
      throw new Error("Post-Opus worktree evidence is missing");
    return {
      evidence: await this.git.inspect(job.branch, job.worktree),
      checks: await this.payload(job, "test_results"),
      opus: await this.payload(job, "opus_report"),
      fable_advice: fableAdvice
    };
  }
  async consultationDenial(job, decision, query) {
    if (job.mode !== "adaptive") return "direct_mode";
    const passport = await this.requiredPassport(job.job_id);
    const config = passport.config;
    if (config.fable_total_cap === 0 || job.fable_calls >= config.fable_total_cap || job.consultation_status !== "unused")
      return "workflow_cap_or_duplicate";
    if (decision.risk_level !== "low") return "risk_not_low";
    if (Buffer.byteLength(JSON.stringify(query)) > config.max_input_bytes)
      return "input_oversized";
    const binding = roleBinding(passport.active_roster, "adviser");
    const available = await this.roles.availability(binding, "adviser");
    if (!available.available) return "fable_unavailable";
    return null;
  }
  async artifact(job, name, role, value, validate) {
    const fresh = await this.requiredJob(job.job_id);
    return this.store.writeArtifact({
      job_id: job.job_id,
      name,
      phase: fresh.phase,
      revision: fresh.artifact_revision + 1,
      invocation_id: this.invocation(job),
      producing_role: role,
      parent_artifact_hash: fresh.latest_artifact_hash,
      payload: value,
      validate
    });
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
    return this.store.commitTransition(
      job.job_id,
      phase,
      { ...patch, current_operation: null },
      {}
    );
  }
  async block(job, reason) {
    await this.transition(job, "blocked", {
      blocker: reason,
      resume_phase: job.phase,
      next_action: "Provide human input, then resume"
    });
    await this.event(job.job_id, "workflow_blocked", { reason });
  }
  async addArtifact(jobId, stored) {
    const passport = await this.requiredPassport(jobId);
    const reference = artifactReference(stored.metadata.filename, stored);
    if (passport.artifacts.some(
      (item) => item.filename === reference.filename && item.hash === reference.hash
    ))
      return;
    await this.updatePassport(jobId, {
      artifacts: [...passport.artifacts, reference]
    });
  }
  async recordDecision(job, decision) {
    const passport = await this.requiredPassport(job.job_id);
    const invocationId = this.invocation(job);
    if (passport.decisions.some((item) => item.invocation_id === invocationId))
      return;
    await this.updatePassport(job.job_id, {
      decisions: [
        ...passport.decisions,
        {
          invocation_id: invocationId,
          action: decision.action,
          summary: decision.summary,
          provenance: "codex",
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          fable_advice_disposition: decision.fable_advice_disposition,
          fable_error: decision.fable_error,
          fable_iteration_effect: decision.fable_iteration_effect
        }
      ]
    });
  }
  async updatePassport(jobId, patch) {
    const passport = await this.requiredPassport(jobId);
    const updated = {
      ...passport,
      ...patch,
      passport_revision: passport.passport_revision + 1,
      schema_version: 2,
      job_id: passport.job_id
    };
    if (Buffer.byteLength(JSON.stringify(updated)) > updated.config.passport_max_bytes)
      throw new Error("Workflow passport exceeded configured maximum");
    await this.store.writePassport(updated);
  }
  async rotateSession(jobId, role, reason) {
    const sessions = await this.requiredSessions(jobId);
    const passport = await this.requiredPassport(jobId);
    const key = role === "codex" ? "codex_thread_id" : "opus_session_id";
    const previous = sessions[key];
    const rotation = {
      role,
      previous_id: previous,
      next_id: null,
      reason: reason.trim() || "manual rotation",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    const updated = {
      ...sessions,
      sessions_revision: sessions.sessions_revision + 1,
      [key]: null,
      ...role === "opus" ? { opus_brief_hash: null } : {},
      modes: { ...sessions.modes, [role]: "none" },
      rotation_history: [...sessions.rotation_history, rotation],
      updated_at: rotation.timestamp
    };
    const updatedPassport = {
      ...passport,
      passport_revision: passport.passport_revision + 1,
      session_references: {
        codex: updated.codex_thread_id,
        opus: updated.opus_session_id
      },
      session_modes: updated.modes,
      rotation_history: updated.rotation_history
    };
    await this.store.commitSessionsAndPassport(updated, updatedPassport);
    await this.event(jobId, "session_rotated", rotation);
  }
  async rotateBinding(jobId, role, binding, reason, allowUnverifiedModel = false) {
    const auditReason = reason.trim();
    if (!auditReason)
      throw new Error("Binding rotation requires a nonempty reason");
    const job = await this.requiredJob(jobId);
    if (job.phase !== "paused" && job.phase !== "blocked")
      throw new Error(`Cannot rotate bindings while workflow is ${job.phase}`);
    if (job.current_operation)
      throw new Error(
        "Cannot rotate bindings while a workflow operation is reserved"
      );
    if (job.blocker?.startsWith("LEGACY_SCHEMA:"))
      throw new Error("Legacy schema workflow bindings cannot be rotated");
    if (!job.resume_phase || job.resume_phase === "verification" || job.resume_phase === "merge_ready" || isTerminalWorkflowPhase(job.resume_phase))
      throw new Error(
        `Cannot rotate bindings at ${job.resume_phase ?? job.phase}`
      );
    const passport = await this.requiredPassport(jobId);
    const sessions = await this.requiredSessions(jobId);
    const nextBinding = validateRosterAgent(binding);
    if (role === "adviser" && (nextBinding.profile.effort !== "low" || nextBinding.profile.max_turns !== 1))
      throw new Error("Adviser binding must use low effort and one turn");
    const active = passport.active_roster;
    const previous = role === "reviewer" ? reviewerBinding(active) : role === "adviser" ? active.adviser : active[role];
    if (!previous)
      throw new Error(`Cannot rotate an unauthorized ${role} binding`);
    if (sameBinding(previous, nextBinding))
      throw new Error("Binding rotation must change the binding");
    const nextRoster = validateRosterSnapshot(
      { ...active, [role]: nextBinding },
      passport.mode
    );
    const probes = [this.roles.availability(nextBinding, role)];
    if (role === "supervisor" && "same_as" in active.reviewer)
      probes.push(this.roles.availability(nextBinding, "reviewer"));
    const unavailable = (await Promise.all(probes)).filter((item) => !item.available).map((item) => item.detail);
    if (unavailable.length)
      throw new Error(
        `Workflow capabilities blocked: ${unavailable.join("; ")}`
      );
    if (nextBinding.profile.model && !(nextBinding.adapter === "claude" && nextBinding.profile.model === "opus") && !allowUnverifiedModel)
      throw new Error(
        `Unverified workflow model/profile requires explicit opt-in: ${nextBinding.adapter}:${nextBinding.profile.model}`
      );
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const revision = passport.roster_revision + 1;
    const history = {
      role,
      previous_binding_hash: previous ? hashRosterAgent(previous) : null,
      new_binding_hash: hashRosterAgent(nextBinding),
      previous_binding: previous,
      new_binding: nextBinding,
      reason: auditReason,
      timestamp,
      revision
    };
    const sessionRole = role === "supervisor" ? "codex" : role === "implementer" ? "opus" : null;
    const sessionKey = sessionRole === "codex" ? "codex_thread_id" : "opus_session_id";
    const previousId = sessionRole ? sessions[sessionKey] : null;
    const sessionRotation = sessionRole ? {
      role: sessionRole,
      previous_id: previousId,
      next_id: null,
      reason: `binding rotation: ${auditReason}`,
      timestamp
    } : null;
    const updatedSessions = {
      ...sessions,
      sessions_revision: sessions.sessions_revision + 1,
      ...sessionRole ? { [sessionKey]: null } : {},
      ...role === "implementer" ? { opus_brief_hash: null } : {},
      modes: sessionRole ? { ...sessions.modes, [sessionRole]: "none" } : sessions.modes,
      rotation_history: sessionRotation ? [...sessions.rotation_history, sessionRotation] : sessions.rotation_history,
      updated_at: timestamp
    };
    const profileKey = role === "supervisor" ? "codex" : role === "implementer" ? "opus" : role === "adviser" ? "fable" : null;
    const config = profileKey ? {
      ...passport.config,
      fable_total_cap: role === "adviser" ? 1 : passport.config.fable_total_cap,
      profiles: {
        ...passport.config.profiles,
        [profileKey]: {
          ...passport.config.profiles[profileKey],
          model: nextBinding.profile.model,
          effort: nextBinding.profile.effort,
          max_turns: nextBinding.profile.max_turns,
          timeout_ms: nextBinding.profile.timeout_ms
        }
      }
    } : passport.config;
    const updatedPassport = {
      ...passport,
      passport_revision: passport.passport_revision + 1,
      active_roster: nextRoster,
      active_roster_hash: hashRosterSnapshot(nextRoster),
      roster_revision: revision,
      binding_rotation_history: [
        ...passport.binding_rotation_history,
        history
      ],
      config,
      session_references: {
        codex: updatedSessions.codex_thread_id,
        opus: updatedSessions.opus_session_id
      },
      session_modes: updatedSessions.modes,
      rotation_history: updatedSessions.rotation_history
    };
    await this.store.commitBindingRotation(updatedSessions, updatedPassport);
    await this.event(jobId, "binding_rotated", history);
  }
  async recordRole(job, role, result) {
    const sessions = await this.requiredSessions(job.job_id);
    const invocationId = this.invocation(job);
    if (sessions.recorded_invocations.includes(invocationId)) {
      await this.syncPassportSessions(job.job_id, sessions);
      return;
    }
    const u = sessions.usage[role];
    const inputChars = result.usage?.input_chars ?? 0;
    const outputChars = result.usage?.output_chars ?? Buffer.byteLength(
      typeof result.value === "string" ? result.value : JSON.stringify(result.value)
    );
    const nextUsage = {
      calls: u.calls + 1,
      input_chars: u.input_chars + inputChars,
      output_chars: u.output_chars + outputChars,
      input_tokens: u.input_tokens + (result.usage?.input_tokens ?? 0),
      output_tokens: u.output_tokens + (result.usage?.output_tokens ?? 0),
      estimated_tokens: u.estimated_tokens + Math.ceil((inputChars + outputChars) / 4),
      cache_read: u.cache_read + (result.usage?.cache_read ?? 0),
      cache_write: u.cache_write + (result.usage?.cache_write ?? 0),
      duration_ms: u.duration_ms + (result.usage?.duration_ms ?? 0),
      failed_calls: u.failed_calls,
      resumes: u.resumes + (result.resumed ? 1 : 0),
      compactions: u.compactions + (result.usage?.compactions ?? 0)
    };
    const mode = result.session_mode ?? (result.resumed ? "native_resume" : result.resume_failed ? "passport_handoff" : result.session_id ? "new" : "none");
    const previous = role === "codex" ? sessions.codex_thread_id : role === "opus" ? sessions.opus_session_id : null;
    const next = result.session_id ?? previous;
    const rotation = role !== "fable" && result.resume_failed ? {
      role,
      previous_id: previous,
      next_id: next,
      reason: "native continuation unavailable or invalid; passport handoff used",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    } : null;
    const updated = {
      ...sessions,
      sessions_revision: sessions.sessions_revision + 1,
      codex_thread_id: role === "codex" ? next : sessions.codex_thread_id,
      opus_session_id: role === "opus" ? next : sessions.opus_session_id,
      opus_brief_hash: role === "opus" ? (await this.requiredJob(job.job_id)).accepted_brief_hash : sessions.opus_brief_hash,
      modes: role === "fable" ? sessions.modes : { ...sessions.modes, [role]: mode },
      rotation_history: rotation ? [...sessions.rotation_history, rotation] : sessions.rotation_history,
      recorded_invocations: [...sessions.recorded_invocations, invocationId],
      usage: { ...sessions.usage, [role]: nextUsage },
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    const passport = await this.requiredPassport(job.job_id);
    const updatedPassport = {
      ...passport,
      passport_revision: passport.passport_revision + 1,
      session_references: {
        codex: updated.codex_thread_id,
        opus: updated.opus_session_id
      },
      session_modes: updated.modes,
      rotation_history: updated.rotation_history
    };
    await this.store.commitSessionsAndPassport(updated, updatedPassport);
  }
  async syncPassportSessions(jobId, sessions) {
    const passport = await this.requiredPassport(jobId);
    const references = {
      codex: sessions.codex_thread_id,
      opus: sessions.opus_session_id
    };
    if (JSON.stringify(passport.session_references) === JSON.stringify(references) && JSON.stringify(passport.session_modes) === JSON.stringify(sessions.modes) && JSON.stringify(passport.rotation_history) === JSON.stringify(sessions.rotation_history))
      return;
    await this.updatePassport(jobId, {
      session_references: references,
      session_modes: sessions.modes,
      rotation_history: sessions.rotation_history
    });
  }
  async fableOptions(passport) {
    const workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), "orch-fable-empty-")
    );
    return {
      workspace,
      model: passport.config.profiles.fable.model,
      max_turns: 1,
      effort: "low",
      timeout_ms: passport.config.profiles.fable.timeout_ms,
      max_input_bytes: passport.config.max_input_bytes,
      max_output_bytes: passport.config.max_output_bytes
    };
  }
  async fableCall(job, binding, options, request, call, validate) {
    try {
      return await this.invoke(
        job,
        "adviser",
        "fable",
        binding,
        request,
        call,
        validate
      );
    } finally {
      await fs.rm(options.workspace, { recursive: true, force: true });
    }
  }
  async invoke(job, semanticRole, usageRole, binding, request, call, validate = (value) => value) {
    const invocationId = this.invocation(job);
    const requestHash = hashPersisted(request);
    const passport = await this.requiredPassport(job.job_id);
    const bindingHash = hashCanonical(binding);
    const recordsSession = semanticRole !== "reviewer" || sameBinding(binding, passport.active_roster.supervisor);
    const prior = await this.store.readInvocationReceipt(
      job.job_id,
      invocationId
    );
    if (prior) {
      if (prior.role !== usageRole || prior.phase !== job.phase || prior.request_hash !== requestHash || prior.workflow_revision !== job.revision || prior.semantic_role !== void 0 && prior.semantic_role !== semanticRole || prior.roster_hash !== void 0 && prior.roster_hash !== passport.active_roster_hash || (prior.roster_revision ?? 1) !== passport.roster_revision || prior.binding_hash !== void 0 && prior.binding_hash !== bindingHash || prior.role_adapter !== void 0 && prior.role_adapter !== binding.adapter)
        throw new Error("Invocation receipt does not match workflow operation");
      const result = prior.result;
      try {
        result.value = validate(result.value);
      } catch (error) {
        throw attachUsage(error, result.usage);
      }
      if (!(await this.store.readLlmAttempts(job.job_id)).some(
        (attempt) => attempt.invocation_id === invocationId
      )) {
        const base = attemptBase(
          job,
          semanticRole,
          usageRole,
          binding,
          passport,
          1,
          prior.timestamp
        );
        await this.store.writeLlmAttempt(startedAttempt(base));
        await this.store.writeLlmAttempt(
          terminalAttempt(base, "succeeded", result.usage)
        );
      }
      await this.recordRole(
        job,
        usageRole,
        recordsSession ? result : withoutSession(result)
      );
      return result;
    }
    const started = Date.now();
    let index = 0;
    const open = /* @__PURE__ */ new Map();
    const completed = /* @__PURE__ */ new Map();
    const observer = async (event) => {
      if (event.status === "started") {
        const base2 = attemptBase(
          job,
          semanticRole,
          usageRole,
          binding,
          passport,
          ++index
        );
        open.set(event.attempt_key, base2);
        await this.store.writeLlmAttempt(startedAttempt(base2));
        return;
      }
      const base = open.get(event.attempt_key);
      if (!base)
        throw new Error(
          "Adapter attempt observer emitted a terminal event without a start"
        );
      if (event.status === "succeeded") {
        completed.set(event.attempt_key, event);
        return;
      }
      await this.store.writeLlmAttempt(
        terminalAttempt(base, "failed", event.usage, event.error)
      );
      open.delete(event.attempt_key);
    };
    try {
      const result = await call(observer);
      try {
        result.value = validate(result.value);
      } catch (error) {
        throw attachUsage(error, result.usage);
      }
      result.usage = {
        ...result.usage,
        duration_ms: result.usage?.duration_ms ?? Date.now() - started
      };
      if (index === 0) {
        const base = attemptBase(
          job,
          semanticRole,
          usageRole,
          binding,
          passport,
          1
        );
        await this.store.writeLlmAttempt(startedAttempt(base));
        await this.store.writeLlmAttempt(
          terminalAttempt(base, "succeeded", result.usage)
        );
      } else if (open.size === 1) {
        const [key, base] = [...open.entries()][0];
        const event = completed.get(key);
        await this.store.writeLlmAttempt(
          terminalAttempt(base, "succeeded", event?.usage ?? result.usage)
        );
        open.delete(key);
        completed.delete(key);
      }
      const receipt = {
        schema_version: 2,
        job_id: job.job_id,
        invocation_id: invocationId,
        phase: job.phase,
        role: usageRole,
        semantic_role: semanticRole,
        roster_hash: passport.active_roster_hash,
        roster_revision: passport.roster_revision,
        binding_hash: bindingHash,
        role_adapter: binding.adapter,
        request_hash: requestHash,
        request,
        result_hash: hashPersisted(result),
        workflow_revision: job.revision,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        result
      };
      await this.store.writeInvocationReceipt(receipt);
      await this.recordRole(
        job,
        usageRole,
        recordsSession ? result : withoutSession(result)
      );
      return result;
    } catch (error) {
      if (!await this.store.readInvocationReceipt(job.job_id, invocationId)) {
        if (index === 0) {
          const base = attemptBase(
            job,
            semanticRole,
            usageRole,
            binding,
            passport,
            1
          );
          await this.store.writeLlmAttempt(startedAttempt(base));
          await this.store.writeLlmAttempt(
            terminalAttempt(base, "failed", usageFromError(error), error)
          );
        } else if (open.size === 1) {
          const [key, base] = [...open.entries()][0];
          await this.store.writeLlmAttempt(
            terminalAttempt(base, "failed", usageFromError(error), error)
          );
          open.delete(key);
        }
        await this.recordFailedRoleCall(job, usageRole, Date.now() - started);
      }
      throw error;
    }
  }
  async runChecksOnce(job, worktree, commit2, commands) {
    const trusted = await this.git.validateChecks(
      validateDeterministicCheckCommands(commands),
      worktree
    );
    return this.effect(
      job,
      "checks",
      { worktree, commit: commit2, commands: trusted },
      validateCheckResults,
      () => this.git.runChecks(worktree, commit2, trusted)
    );
  }
  async ensureTrustedChecks(jobId) {
    const passport = await this.requiredPassport(jobId);
    await this.git.validateChecks(
      validateDeterministicCheckCommands(passport.required_checks),
      passport.active_worktree ?? void 0
    );
  }
  async mergeOnce(job, branch, commit2, targetBranch, baseCommit) {
    return this.effect(
      job,
      "merge",
      { branch, commit: commit2, targetBranch, baseCommit },
      validateMergeResult,
      () => this.git.merge(branch, commit2, targetBranch, baseCommit)
    );
  }
  async effect(job, kind, request, validate, call) {
    const invocationId = this.invocation(job);
    const requestHash = hashPersisted(request);
    const prior = await this.store.readEffectReceipt(
      job.job_id,
      invocationId,
      kind
    );
    if (prior) {
      if (prior.request_hash !== requestHash || prior.workflow_revision !== job.revision || prior.phase !== job.phase)
        throw new Error(
          "Workflow effect receipt does not match current operation"
        );
      if (prior.status === "started")
        throw new Error(
          `AMBIGUOUS_EFFECT: ${kind} may have run for ${invocationId}; automatic retry is prohibited`
        );
      return validate(prior.result);
    }
    const started = {
      schema_version: 2,
      job_id: job.job_id,
      invocation_id: invocationId,
      phase: job.phase,
      kind,
      request_hash: requestHash,
      request,
      result_hash: null,
      workflow_revision: job.revision,
      status: "started",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      result: null
    };
    await this.store.writeEffectReceipt(started);
    const result = validate(await call());
    await this.store.writeEffectReceipt({
      ...started,
      status: "completed",
      result_hash: hashPersisted(result),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      result
    });
    return result;
  }
  async recordFailedRoleCall(job, role, durationMs) {
    const sessions = await this.requiredSessions(job.job_id);
    const invocationId = this.invocation(job);
    if (sessions.recorded_invocations.includes(invocationId)) return;
    const current = sessions.usage[role];
    await this.store.writeSessions({
      ...sessions,
      sessions_revision: sessions.sessions_revision + 1,
      recorded_invocations: [...sessions.recorded_invocations, invocationId],
      usage: {
        ...sessions.usage,
        [role]: {
          ...current,
          calls: current.calls + 1,
          duration_ms: current.duration_ms + durationMs,
          failed_calls: current.failed_calls + 1
        }
      },
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  async ensureInterruptedAttempt(job) {
    const invocationId = this.invocation(job);
    const attempts = await this.store.readLlmAttempts(job.job_id);
    if (attempts.some((attempt) => attempt.invocation_id === invocationId))
      return;
    const passport = await this.requiredPassport(job.job_id);
    const semanticRole = semanticRoleForPhase(
      job.phase,
      job.consultation_origin
    );
    if (!semanticRole) return;
    const binding = roleBinding(passport.active_roster, semanticRole);
    const providerRole = semanticRole === "implementer" ? "opus" : semanticRole === "adviser" ? "fable" : "codex";
    await this.store.writeLlmAttempt({
      schema_version: 1,
      job_id: job.job_id,
      attempt_id: `${invocationId}_1`,
      invocation_id: invocationId,
      phase: job.phase,
      semantic_role: semanticRole,
      provider_role: providerRole,
      adapter: binding.adapter,
      binding_hash: hashCanonical(binding),
      roster_revision: passport.roster_revision,
      status: "started",
      usage_status: "unknown",
      usage: null,
      error_category: null,
      error_message: null,
      started_at: job.current_operation.started_at,
      completed_at: null
    });
  }
  invocation(job) {
    if (!job.current_operation || job.current_operation.phase !== job.phase)
      throw new Error(`Workflow phase ${job.phase} has no reserved invocation`);
    return job.current_operation.invocation_id;
  }
  assertAllowedScope(passport, files) {
    if (passport.allowed_file_scope.length === 0) return;
    const outside = files.filter(
      (file) => !passport.allowed_file_scope.some(
        (allowed) => file === allowed || file.startsWith(`${allowed.replace(/\/$/, "")}/`)
      )
    );
    if (outside.length)
      throw new Error(
        `Opus changed files outside approved scope: ${outside.join(", ")}`
      );
  }
  assertJob(job, received) {
    if (received !== job.job_id)
      throw new Error(`Artifact job_id mismatch: ${received}`);
  }
  async context(jobId) {
    return {
      passport: await this.requiredPassport(jobId),
      sessions: await this.requiredSessions(jobId)
    };
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
    await this.store.appendEvent({
      schema_version: 2,
      job_id: id2,
      type,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      data
    });
  }
  assertRuntimeRoster(roster, mode) {
    if (mode === "direct" && roster.adviser)
      throw new Error("Direct workflow roster cannot include an adviser");
  }
};
function usage() {
  return {
    calls: 0,
    input_chars: 0,
    output_chars: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_tokens: 0,
    cache_read: 0,
    cache_write: 0,
    duration_ms: 0,
    failed_calls: 0,
    resumes: 0,
    compactions: 0
  };
}
function attemptBase(job, semanticRole, providerRole, binding, passport, index, startedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const invocationId = job.current_operation.invocation_id;
  return {
    schema_version: 1,
    job_id: job.job_id,
    attempt_id: `${invocationId}_${index}`,
    invocation_id: invocationId,
    phase: job.phase,
    semantic_role: semanticRole,
    provider_role: providerRole,
    adapter: binding.adapter,
    binding_hash: hashCanonical(binding),
    roster_revision: passport.roster_revision,
    started_at: startedAt
  };
}
function startedAttempt(base) {
  return {
    ...base,
    status: "started",
    usage_status: "unknown",
    usage: null,
    error_category: null,
    error_message: null,
    completed_at: null
  };
}
function terminalAttempt(base, status, value, error) {
  const duration = value?.duration_ms ?? Math.max(0, Date.now() - Date.parse(base.started_at));
  const hasTokens = value?.input_tokens !== void 0 && value?.output_tokens !== void 0;
  const hasChars = value?.input_chars !== void 0 || value?.output_chars !== void 0;
  const usageStatus = hasTokens ? "known" : hasChars ? "estimated" : "unknown";
  return {
    ...base,
    status,
    usage_status: usageStatus,
    usage: value ? { ...value, duration_ms: duration } : { duration_ms: duration },
    error_category: status === "failed" ? errorCategory(error) : null,
    error_message: status === "failed" ? safeErrorMessage(error) : null,
    completed_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function usageFromError(error) {
  if (!error || typeof error !== "object") return void 0;
  const usage2 = error.usage;
  if (!usage2 || typeof usage2 !== "object" || Array.isArray(usage2))
    return void 0;
  const result = {};
  for (const key of [
    "input_chars",
    "output_chars",
    "input_tokens",
    "output_tokens",
    "cache_read",
    "cache_write",
    "duration_ms",
    "compactions"
  ]) {
    const value = usage2[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      result[key] = value;
  }
  return result;
}
function errorCategory(error) {
  const message = error instanceof Error ? error.message : "";
  if (/Unsafe|meaningful deterministic check|invalid during|mismatch|stale|requires|cannot include|outside approved scope/i.test(
    message
  ))
    return "validation_error";
  if (/timed out/i.test(message)) return "timeout";
  if (/exited\s+\d+/i.test(message)) return "process_exit";
  if (/output exceeded/i.test(message)) return "output_limit";
  if (/malformed|no (?:agent message|result)/i.test(message))
    return "invalid_response";
  return "adapter_error";
}
function safeErrorMessage(error) {
  const category = errorCategory(error);
  if (category === "validation_error")
    return error instanceof Error ? sanitizeValidationMessage(error.message) : "Workflow validation failed";
  return category === "timeout" ? "Adapter call timed out" : category === "process_exit" ? "Adapter process exited unsuccessfully" : category === "output_limit" ? "Adapter output exceeded the configured limit" : category === "invalid_response" ? "Adapter returned an invalid response" : "Adapter call failed";
}
function sanitizeValidationMessage(message) {
  return message.replace(/[\r\n\t]+/g, " ").replace(/(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 512);
}
function resultValidationError(error, value) {
  const result = error instanceof Error ? error : new Error(String(error));
  result.validation_result = value;
  return result;
}
function attachUsage(error, usage2) {
  const result = error instanceof Error ? error : new Error(String(error));
  result.usage = usage2;
  return result;
}
function validationResult(error) {
  return error && typeof error === "object" && "validation_result" in error ? error.validation_result : void 0;
}
function rosterAgent(adapter, name, profile) {
  return {
    adapter,
    profile: {
      name,
      model: profile.model,
      effort: profile.effort,
      max_turns: profile.max_turns,
      timeout_ms: profile.timeout_ms
    }
  };
}
function profileFromRoster(binding, fallback) {
  return binding ? {
    model: binding.profile.model,
    effort: binding.profile.effort,
    max_turns: binding.profile.max_turns,
    timeout_ms: binding.profile.timeout_ms,
    permission_mode: fallback.permission_mode
  } : fallback;
}
function reviewerBinding(roster) {
  return "same_as" in roster.reviewer ? roster.supervisor : roster.reviewer;
}
function rosterBindings(roster) {
  return [
    roster.supervisor,
    roster.implementer,
    ...roster.adviser ? [roster.adviser] : [],
    ..."same_as" in roster.reviewer ? [] : [roster.reviewer]
  ];
}
function roleBinding(roster, role) {
  if (role === "supervisor") return roster.supervisor;
  if (role === "implementer") return roster.implementer;
  if (role === "reviewer") return reviewerBinding(roster);
  if (roster.adviser) return roster.adviser;
  throw new Error("No persisted adviser binding exists");
}
function decisionRole(stage) {
  return stage === "post_opus" || stage === "after_fable_post" ? "reviewer" : "supervisor";
}
function semanticRoleForPhase(phase, origin) {
  if (phase === "opus_execution") return "implementer";
  if (phase === "fable_consultation") return "adviser";
  if (phase === "codex_post_opus" || phase === "codex_after_fable" && origin === "post_opus")
    return "reviewer";
  if (phase === "codex_pre_opus" || phase === "codex_after_fable")
    return "supervisor";
  return null;
}
function sameBinding(left, right) {
  return hashCanonical(left) === hashCanonical(right);
}
function withoutSession(result) {
  return {
    ...result,
    session_id: void 0,
    session_mode: "none",
    resumed: false,
    resume_failed: false
  };
}
function hasMeaningfulChecks(commands) {
  try {
    return validateDeterministicCheckCommands(commands).length > 0;
  } catch {
    return false;
  }
}
function validateMergeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Merge result must be an object");
  const result = value;
  if (Object.keys(result).some((key) => key !== "success" && key !== "detail") || typeof result.success !== "boolean" || typeof result.detail !== "string")
    throw new Error("Merge result is malformed");
  return { success: result.success, detail: result.detail };
}

export { DEFAULT_WORKFLOW_CONFIG, LegacyWorkflowRoleResolver, WORKFLOW_SCHEMA_VERSION, WorkflowEngine, hasMeaningfulChecks, validateCheckResults, validateCodexDecision, validateFableAdvice, validateFableFallbackRecord, validateFableQuery, validateOpusResult };
//# sourceMappingURL=chunk-OFPJ6QUT.js.map
//# sourceMappingURL=chunk-OFPJ6QUT.js.map