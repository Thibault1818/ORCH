import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  validateCheckResults,
  validateCodexDecision,
  validateFableAdvice,
  validateFableFallbackRecord,
  validateFableQuery,
  validateOpusResult,
  type CheckResults,
  type CodexDecisionStage,
  type CodexDecisionV2,
  type FableAdviceV1,
  type FableFallbackReason,
  type FableQueryV1,
  type OpusResult,
} from "../../domain/workflow/contracts.js";
import type {
  AgentUsage,
  ConsultationOrigin,
  SessionRotation,
  WorkflowConfig,
  WorkflowConfigOverrides,
  WorkflowEffectReceiptV2,
  WorkflowInvocationReceiptV2,
  WorkflowJobV2,
  WorkflowLlmAttemptV1,
  WorkflowMode,
  WorkflowPassportV2,
  WorkflowSessionsV2,
} from "../../domain/workflow/state.js";
import {
  createRosterSnapshot,
  hashRosterAgent,
  hashRosterSnapshot,
  validateRosterAgent,
  validateRosterSnapshot,
  type RosterAgent,
  type SemanticRole,
  type WorkflowRosterSnapshot,
} from "../../domain/workflow/roster.js";
import {
  isTerminalWorkflowPhase,
  type WorkflowPhase,
} from "../../domain/workflow/transitions.js";
import {
  ARTIFACT_FILES,
  WorkflowArtifactStore,
  artifactReference,
  hashCanonical,
  hashPersisted,
  type ArtifactName,
  type StoredArtifact,
} from "../../infrastructure/workflow/artifact-store.js";
import {
  LegacyWorkflowRoleResolver,
  type FableCallOptions,
  type GitEvidence,
  type RoleAttemptEvent,
  type RoleResult,
  type WorkflowRolePorts,
  type WorkflowRoleResolver,
  type WorkflowRuntimePorts,
} from "./ports.js";
import { validateDeterministicCheckCommands } from "./check-discovery.js";

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  fable_total_cap: 0,
  max_input_bytes: 128_000,
  max_output_bytes: 64_000,
  passport_max_bytes: 64_000,
  profiles: {
    fable: {
      model: "",
      effort: "low",
      max_turns: 1,
      timeout_ms: 300_000,
      permission_mode: "read_only",
    },
    opus: {
      model: "opus",
      effort: "high",
      max_turns: 50,
      timeout_ms: 1_800_000,
      permission_mode: "worktree",
    },
    codex: {
      model: "",
      effort: "medium",
      max_turns: 1,
      timeout_ms: 600_000,
      permission_mode: "read_only",
    },
  },
};
export interface StartWorkflowInput {
  objective: string;
  mode?: WorkflowMode;
  allowed_file_scope?: string[];
  required_checks?: string[];
  config?: WorkflowConfigOverrides;
  roster?: WorkflowRosterSnapshot;
  job_id?: string;
  allow_unverified_model?: boolean;
}

export class WorkflowEngine {
  private readonly roles: WorkflowRoleResolver;
  private readonly git: WorkflowRuntimePorts["git"];

  constructor(
    private readonly store: WorkflowArtifactStore,
    ports: WorkflowRuntimePorts | WorkflowRolePorts,
  ) {
    this.roles =
      "roles" in ports ? ports.roles : new LegacyWorkflowRoleResolver(ports);
    this.git = ports.git;
  }

  async start(input: StartWorkflowInput): Promise<string> {
    if (!input.objective.trim())
      throw new Error("Workflow objective must not be empty");
    const requiredChecks = validateDeterministicCheckCommands(
      input.required_checks ?? [],
    );
    if (requiredChecks.length === 0)
      throw new Error(
        "Workflow requires at least one meaningful deterministic check",
      );
    const trustedChecks = await this.git.validateChecks(requiredChecks);
    const rawConfig = input.config as Record<string, unknown> | undefined;
    const obsolete = [
      "fable_pre_opus_cap",
      "fable_post_opus_per_iteration_cap",
      "post_review",
      "risk_triggers",
    ].filter((key) => rawConfig && key in rawConfig);
    if (obsolete.length)
      throw new Error(
        `Obsolete workflow configuration is incompatible with direct workflow v2: ${obsolete.join(", ")}`,
      );
    const mode = input.mode ?? "adaptive";
    const id = input.job_id ?? `wf_${nanoid(12)}`;
    const now = new Date().toISOString();
    const requestedCap =
      mode === "direct" ? 0 : (input.config?.fable_total_cap ?? 0);
    const baseProfiles = {
      fable: {
        ...DEFAULT_WORKFLOW_CONFIG.profiles.fable,
        ...input.config?.profiles?.fable,
      },
      opus: {
        ...DEFAULT_WORKFLOW_CONFIG.profiles.opus,
        ...input.config?.profiles?.opus,
      },
      codex: {
        ...DEFAULT_WORKFLOW_CONFIG.profiles.codex,
        ...input.config?.profiles?.codex,
      },
    };
    const roster = input.roster
      ? validateRosterSnapshot(input.roster, mode)
      : createRosterSnapshot(
          {
            supervisor: rosterAgent("codex", "codex", baseProfiles.codex),
            implementer: rosterAgent("claude", "opus", baseProfiles.opus),
            adviser:
              requestedCap === 1
                ? rosterAgent("fable", "fable", baseProfiles.fable)
                : null,
          },
          mode,
        );
    this.assertRuntimeRoster(roster, mode);
    if (!input.allow_unverified_model) {
      for (const binding of rosterBindings(roster)) {
        if (
          binding.profile.model &&
          !(binding.adapter === "claude" && binding.profile.model === "opus")
        )
          throw new Error(
            `Unverified workflow model/profile requires explicit opt-in: ${binding.adapter}:${binding.profile.model}`,
          );
      }
    }
    const config: WorkflowConfig = {
      fable_total_cap: requestedCap,
      max_input_bytes:
        input.config?.max_input_bytes ??
        DEFAULT_WORKFLOW_CONFIG.max_input_bytes,
      max_output_bytes:
        input.config?.max_output_bytes ??
        DEFAULT_WORKFLOW_CONFIG.max_output_bytes,
      passport_max_bytes:
        input.config?.passport_max_bytes ??
        DEFAULT_WORKFLOW_CONFIG.passport_max_bytes,
      profiles: {
        fable: profileFromRoster(roster.adviser, baseProfiles.fable),
        opus: profileFromRoster(roster.implementer, baseProfiles.opus),
        codex: profileFromRoster(roster.supervisor, baseProfiles.codex),
      },
    };
    if (Boolean(roster.adviser) !== (config.fable_total_cap === 1))
      throw new Error(
        "Adviser binding and adviser call cap must be configured together",
      );
    if (config.fable_total_cap !== 0 && config.fable_total_cap !== 1)
      throw new Error("Fable whole-workflow cap must be zero or one");
    if (
      config.profiles.fable.effort !== "low" ||
      config.profiles.fable.max_turns !== 1 ||
      config.profiles.fable.permission_mode !== "read_only"
    )
      throw new Error(
        "Fable must use low effort, one turn, and read-only isolation",
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
      ...(roster.adviser
        ? [this.roles.availability(roster.adviser, "adviser")]
        : []),
    ]);
    const unavailable = capabilities
      .filter((item) => !item.available)
      .map((item) => item.detail);
    if (unavailable.length)
      throw new Error(
        `Workflow capabilities blocked: ${unavailable.join("; ")}`,
      );
    const job: WorkflowJobV2 = {
      schema_version: 2,
      job_id: id,
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
      updated_at: now,
    };
    const rosterHash = hashRosterSnapshot(roster);
    const passport: WorkflowPassportV2 = {
      schema_version: 2,
      passport_revision: 1,
      job_id: id,
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
      binding_rotation_history: [],
    };
    if (Buffer.byteLength(JSON.stringify(passport)) > config.passport_max_bytes)
      throw new Error("Initial workflow passport exceeded configured maximum");
    const sessions: WorkflowSessionsV2 = {
      schema_version: 2,
      sessions_revision: 1,
      job_id: id,
      codex_thread_id: null,
      opus_session_id: null,
      opus_brief_hash: null,
      modes: { codex: "none", opus: "none" },
      rotation_history: [],
      recorded_invocations: [],
      usage: { codex: usage(), fable: usage(), opus: usage() },
      updated_at: now,
    };
    await this.store.createJob(job, passport, sessions);
    await this.event(id, "workflow_started", { mode });
    return id;
  }

  async run(jobId: string): Promise<WorkflowJobV2> {
    while (true) {
      const job = await this.advance(jobId);
      if (
        isTerminalWorkflowPhase(job.phase) ||
        job.phase === "paused" ||
        job.phase === "blocked"
      )
        return job;
    }
  }
  async advance(jobId: string): Promise<WorkflowJobV2> {
    const job = await this.requiredJob(jobId);
    if (
      isTerminalWorkflowPhase(job.phase) ||
      job.phase === "paused" ||
      job.phase === "blocked"
    )
      return job;
    try {
      if (job.current_operation) {
        const receipt = await this.store.readInvocationReceipt(
          job.job_id,
          job.current_operation.invocation_id,
        );
        const checks = await this.store.readEffectReceipt(
          job.job_id,
          job.current_operation.invocation_id,
          "checks",
        );
        const merge = await this.store.readEffectReceipt(
          job.job_id,
          job.current_operation.invocation_id,
          "merge",
        );
        if (job.phase === "merge_ready" || receipt || checks || merge) {
          await this.step(job);
          return this.requiredJob(jobId);
        }
        if (
          job.phase === "fable_consultation" &&
          (job.consultation_status === "attempt_started" ||
            job.consultation_status === "fallback_executed")
        ) {
          await this.executeConsultationFallback(
            job,
            job.consultation_status === "attempt_started"
              ? "ambiguous_interruption"
              : "resume_persisted_fallback",
          );
          return this.requiredJob(jobId);
        }
        await this.ensureInterruptedAttempt(job);
        await this.block(
          job,
          `INTERRUPTED: ${job.current_operation.phase} operation ${job.current_operation.invocation_id} has no durable result; explicit retry approval is required`,
        );
        return this.requiredJob(jobId);
      }
      const operation = {
        phase: job.phase,
        invocation_id: `inv_${nanoid(12)}`,
        started_at: new Date().toISOString(),
        retry_count: 0,
      };
      if (
        !(await this.store.reserveOperation(job.job_id, job.phase, operation))
      )
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
        reason,
      });
      return this.store.transition(jobId, "failed", {
        blocker: reason,
        next_action: "Inspect workflow logs and artifacts",
      });
    }
  }

  async pause(jobId: string): Promise<WorkflowJobV2> {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase) || job.phase === "paused")
      throw new Error(`Cannot pause workflow in ${job.phase}`);
    return this.transition(job, "paused", {
      resume_phase: job.phase,
      next_action: "Resume workflow",
    });
  }
  async resume(
    jobId: string,
    options: { retry_invocation?: boolean; reason?: string } = {},
  ): Promise<WorkflowJobV2> {
    const job = await this.requiredJob(jobId);
    const reason = options.reason?.trim();
    if (!reason) throw new Error("Resume requires --reason");
    if (isTerminalWorkflowPhase(job.phase))
      throw new Error(`Cannot resume workflow in ${job.phase}`);
    if (job.phase !== "paused" && job.phase !== "blocked") {
      await this.event(jobId, "workflow_resumed", {
        phase: job.phase,
        reason,
        mode: "active_reconciliation",
      });
      return this.run(jobId);
    }
    if (!job.resume_phase) throw new Error("Workflow has no recoverable phase");
    if (job.blocker?.startsWith("LEGACY_SCHEMA:"))
      throw new Error(
        "Legacy schema workflow cannot be resumed; start a new workflow",
      );
    if (job.blocker?.startsWith("AMBIGUOUS_EFFECT:"))
      throw new Error(
        "Ambiguous external effect cannot be retried safely; inspect the receipt and start a new workflow",
      );
    if (
      job.blocker?.startsWith("INTERRUPTED:") &&
      (!options.retry_invocation || !reason)
    )
      throw new Error(
        "Interrupted invocation requires --retry-invocation and --reason",
      );
    const resumed = await this.transition(job, job.resume_phase, {
      blocker: null,
      resume_phase: null,
      current_operation: null,
    });
    await this.event(jobId, "workflow_resumed", {
      phase: resumed.phase,
      reason,
    });
    return this.run(jobId);
  }
  async cancel(jobId: string): Promise<WorkflowJobV2> {
    const job = await this.requiredJob(jobId);
    if (isTerminalWorkflowPhase(job.phase))
      throw new Error(`Cannot cancel workflow in ${job.phase}`);
    return this.transition(job, "cancelled", {
      next_action: "No further action",
    });
  }

  private async step(job: WorkflowJobV2): Promise<void> {
    switch (job.phase) {
      case "codex_pre_opus":
        return this.codexDecision(job, "pre_opus");
      case "fable_consultation":
        return this.fableConsultation(job);
      case "codex_after_fable":
        return this.codexDecision(
          job,
          job.consultation_origin === "pre_opus"
            ? "after_fable_pre"
            : "after_fable_post",
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

  private async codexDecision(
    job: WorkflowJobV2,
    stage: CodexDecisionStage,
  ): Promise<void> {
    await this.ensureTrustedChecks(job.job_id);
    const { passport, sessions } = await this.context(job.job_id);
    const evidence = await this.reviewEvidence(job, stage);
    const semanticRole = decisionRole(stage);
    const binding = roleBinding(passport.active_roster!, semanticRole);
    const sameAsSupervisor =
      semanticRole === "supervisor" ||
      sameBinding(binding, passport.active_roster!.supervisor);
    let result: RoleResult<CodexDecisionV2>;
    try {
      result = await this.invoke(
        job,
        semanticRole,
        "codex",
        binding,
        { stage, evidence },
        (observer) =>
          this.roles.decide(
            binding,
            passport,
            stage,
            evidence,
            sameAsSupervisor ? sessions.codex_thread_id : null,
            observer,
          ),
        (value) => {
          try {
            const decision = validateCodexDecision(value, stage);
            this.assertJob(job, decision.job_id);
            if (
              decision.reviewed_commit &&
              decision.reviewed_commit !== evidence.evidence?.commit
            )
              throw new Error("Codex decision reviewed stale commit");
            return decision;
          } catch (error) {
            throw resultValidationError(error, value);
          }
        },
      );
    } catch (error) {
      const value = validationResult(error);
      if (
        value !== undefined &&
        (await this.fallbackMalformedConsultation(job, value, stage, error))
      )
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
      (value) => validateCodexDecision(value, stage),
    );
    await this.addArtifact(job.job_id, stored);
    if (decision.action === "STOP")
      return this.transition(job, "cancelled", {
        last_action: "STOP",
        next_action: "Workflow stopped without merge",
      }).then(() => undefined);
    if (decision.action === "PAUSE")
      return this.transition(job, "paused", {
        resume_phase: job.phase,
        last_action: "PAUSE",
        next_action: decision.summary,
      }).then(() => undefined);
    if (decision.action === "CONSULT_FABLE")
      return this.routeConsultation(
        job,
        decision,
        stage === "pre_opus" || stage === "after_fable_pre"
          ? "pre_opus"
          : "post_opus",
      );
    if (decision.action === "DISPATCH_OPUS")
      return this.dispatchOpus(job, decision.implementation_brief!);
    if (decision.action === "CORRECT_OPUS")
      return this.dispatchOpus(job, decision.required_changes.join("\n"), true);
    if (decision.action === "ACCEPT") {
      if (!evidence.evidence || !evidence.checks || !evidence.opus)
        throw new Error("ACCEPT requires real Opus evidence");
      return this.transition(job, "verification", {
        last_action: "ACCEPT",
        current_commit: decision.reviewed_commit,
        next_action: "Revalidate exact evidence before merge",
      }).then(() => undefined);
    }
  }

  private async routeConsultation(
    job: WorkflowJobV2,
    decision: CodexDecisionV2,
    origin: ConsultationOrigin,
  ): Promise<void> {
    const query = decision.fable_query!;
    const denial = await this.consultationDenial(job, decision, query);
    const request = await this.artifact(
      job,
      "fable_request",
      "codex",
      query,
      (value) =>
        validateCodexDecision(
          { ...decision, fable_query: value },
          origin === "pre_opus" ? "pre_opus" : "post_opus",
        ).fable_query!,
    );
    await this.addArtifact(job.job_id, request);
    await this.store.patchJob(job.job_id, {
      consultation_status: denial ? "skipped" : "requested",
      consultation_origin: origin,
    });
    if (denial) {
      await this.event(job.job_id, "fable_consultation_skipped", {
        reason: denial,
        origin,
      });
      return this.executeConsultationFallback(
        await this.requiredJob(job.job_id),
        denial,
        query,
      );
    }
    await this.transition(
      await this.requiredJob(job.job_id),
      "fable_consultation",
      {
        consultation_status: "requested",
        consultation_origin: origin,
        last_action: "CONSULT_FABLE",
        next_action: "Run one bounded stateless Fable consultation",
      },
    );
  }

  private async fallbackMalformedConsultation(
    job: WorkflowJobV2,
    value: unknown,
    stage: CodexDecisionStage,
    error: unknown,
  ): Promise<boolean> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const raw = value as Record<string, unknown>;
    if (raw.action !== "CONSULT_FABLE" || raw.job_id !== job.job_id)
      return false;
    let query: FableQueryV1;
    try {
      query = validateFableQuery(raw.fable_query);
    } catch {
      return false;
    }
    const origin: ConsultationOrigin =
      stage === "pre_opus" || stage === "after_fable_pre"
        ? "pre_opus"
        : "post_opus";
    if (
      (origin === "pre_opus" &&
        query.fallback_if_skipped.action === "CORRECT_OPUS") ||
      (origin === "post_opus" &&
        query.fallback_if_skipped.action === "DISPATCH_OPUS")
    )
      return false;
    const request = await this.artifact(
      job,
      "fable_request",
      "codex",
      query,
      validateFableQuery,
    );
    await this.addArtifact(job.job_id, request);
    await this.store.patchJob(job.job_id, {
      consultation_status: "skipped",
      consultation_origin: origin,
    });
    await this.event(job.job_id, "fable_consultation_skipped", {
      reason: "malformed_request",
      detail: error instanceof Error ? error.message : String(error),
      origin,
    });
    await this.executeConsultationFallback(
      await this.requiredJob(job.job_id),
      "malformed_request",
      query,
    );
    return true;
  }

  private async fableConsultation(job: WorkflowJobV2): Promise<void> {
    await this.ensureTrustedChecks(job.job_id);
    const query = await this.payload<FableQueryV1>(job, "fable_request");
    const consultationId = `consult_${job.job_id}_${job.revision}`;
    const existing = await this.store.readInvocationReceipt(
      job.job_id,
      this.invocation(job),
    );
    if (
      !existing &&
      (job.consultation_status === "attempt_started" ||
        job.consultation_status === "fallback_executed")
    )
      return this.executeConsultationFallback(
        job,
        job.consultation_status === "attempt_started"
          ? "ambiguous_interruption"
          : "resume_persisted_fallback",
      );
    if (!existing)
      await this.store.patchJob(job.job_id, {
        consultation_status: "attempt_started",
        fable_calls: job.fable_calls + 1,
      });
    const options = await this.fableOptions(
      await this.requiredPassport(job.job_id),
    );
    try {
      const passport = await this.requiredPassport(job.job_id);
      const binding = roleBinding(passport.active_roster!, "adviser");
      const result = await this.fableCall(
        job,
        binding,
        options,
        { consultation_id: consultationId, query },
        (observer) =>
          this.roles.consult(
            binding,
            job.job_id,
            consultationId,
            query,
            options,
            observer,
          ),
        (value) => {
          const advice = validateFableAdvice(value);
          if (advice.consultation_id !== consultationId)
            throw new Error("Fable advice consultation_id mismatch");
          return advice;
        },
      );
      const advice = result.value;
      const stored = await this.artifact(
        await this.requiredJob(job.job_id),
        "fable_advice",
        "fable",
        advice,
        validateFableAdvice,
      );
      await this.addArtifact(job.job_id, stored);
      await this.store.patchJob(job.job_id, {
        consultation_status: "result_persisted",
      });
      await this.transition(
        await this.requiredJob(job.job_id),
        "codex_after_fable",
        {
          consultation_status: "result_persisted",
          next_action: "Codex verifies optional Fable advice",
        },
      );
    } catch (error) {
      await this.event(job.job_id, "fable_consultation_failed", {
        category: errorCategory(error),
        reason: safeErrorMessage(error),
      });
      await this.executeConsultationFallback(
        await this.requiredJob(job.job_id),
        "fable_failed",
        query,
      );
    }
  }

  private async executeConsultationFallback(
    job: WorkflowJobV2,
    reason: FableFallbackReason,
    provided?: FableQueryV1,
  ): Promise<void> {
    const query =
      provided ?? (await this.payload<FableQueryV1>(job, "fable_request"));
    const fallback = query.fallback_if_skipped;
    if (!job.consultation_origin)
      throw new Error("Consultation origin is missing");
    const routing = validateFableFallbackRecord({
      schema_version: 1,
      reason,
      action: fallback.action,
      instructions: fallback.instructions,
      origin: job.consultation_origin,
    });
    const stored = await this.artifact(
      job,
      "routing_decision",
      "orchestrator",
      routing,
      validateFableFallbackRecord,
    );
    await this.addArtifact(job.job_id, stored);
    const persisted = validateFableFallbackRecord(stored.payload);
    await this.store.patchJob(job.job_id, {
      consultation_status: "fallback_executed",
    });
    if (persisted.action === "PAUSE") {
      await this.transition(await this.requiredJob(job.job_id), "paused", {
        resume_phase:
          persisted.origin === "pre_opus"
            ? "codex_pre_opus"
            : "codex_post_opus",
        consultation_status: "fallback_executed",
        next_action: persisted.instructions,
      });
      return;
    }
    await this.dispatchOpus(
      await this.requiredJob(job.job_id),
      persisted.instructions,
      persisted.action === "CORRECT_OPUS",
    );
  }

  private async dispatchOpus(
    job: WorkflowJobV2,
    instruction: string,
    correction = false,
  ): Promise<void> {
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
      payload: instruction,
    });
    await this.addArtifact(job.job_id, stored);
    const briefHash = hashCanonical(instruction);
    let prepared = {
      branch: fresh.branch,
      worktree: fresh.worktree,
      target_branch: fresh.target_branch,
      base_commit: fresh.base_commit,
    };
    if (
      !prepared.branch ||
      !prepared.worktree ||
      !prepared.target_branch ||
      !prepared.base_commit
    )
      prepared = await this.git.prepare(job.job_id);
    const reference = artifactReference(
      ARTIFACT_FILES.opus_instruction,
      stored,
    );
    await this.updatePassport(job.job_id, {
      accepted_brief_hash: briefHash,
      latest_implementation_brief: reference,
      active_worktree: prepared.worktree,
      target_branch: prepared.target_branch,
      base_commit: prepared.base_commit,
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
        opus_iteration: correction
          ? job.opus_iteration + 1
          : job.opus_iteration,
        fix_cycles: correction ? job.fix_cycles + 1 : job.fix_cycles,
        last_action: correction ? "CORRECT_OPUS" : "DISPATCH_OPUS",
        current_commit: null,
        reviewed_diff_hash: null,
        next_action:
          "Opus implements Codex instructions in the dedicated worktree",
      },
    );
  }

  private async opusExecution(job: WorkflowJobV2): Promise<void> {
    await this.ensureTrustedChecks(job.job_id);
    if (!job.worktree || !job.branch || !job.accepted_brief_hash)
      throw new Error("Opus dispatch metadata is missing");
    const { passport, sessions } = await this.context(job.job_id);
    const prompt = await this.textPayload(job, "opus_instruction");
    const mode =
      sessions.opus_session_id &&
      sessions.opus_brief_hash !== job.accepted_brief_hash
        ? "native_resume"
        : "new";
    const binding = roleBinding(passport.active_roster!, "implementer");
    const result = await this.invoke(
      job,
      "implementer",
      "opus",
      binding,
      { brief_hash: job.accepted_brief_hash },
      (observer) =>
        this.roles.execute(
          binding,
          passport,
          prompt,
          job.worktree!,
          mode === "native_resume" ? sessions.opus_session_id : null,
          mode,
          observer,
        ),
      (value) => {
        const opus = validateOpusResult(value);
        this.assertJob(job, opus.job_id);
        if (opus.status !== "completed" || opus.unresolved.length > 0)
          throw new Error(`Opus execution is not complete: ${opus.summary}`);
        return opus;
      },
    );
    const opus = result.value;
    const stored = await this.artifact(
      job,
      "opus_report",
      "opus",
      opus,
      validateOpusResult,
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
      payload: evidence.diff || "(empty diff)",
    });
    await this.addArtifact(job.job_id, diffStored);
    const checks = await this.runChecksOnce(
      job,
      job.worktree,
      evidence.commit,
      passport.required_checks,
    );
    const checkStored = await this.artifact(
      await this.requiredJob(job.job_id),
      "test_results",
      "orchestrator",
      checks,
      validateCheckResults,
    );
    await this.addArtifact(job.job_id, checkStored);
    await this.updatePassport(job.job_id, { current_commit: evidence.commit });
    await this.transition(
      await this.requiredJob(job.job_id),
      "codex_post_opus",
      {
        current_commit: evidence.commit,
        reviewed_diff_hash: evidence.diff_hash,
        next_action: "Codex reviews actual Opus diff, commit, and checks",
      },
    );
  }

  private async verification(job: WorkflowJobV2): Promise<void> {
    if (
      !job.branch ||
      !job.worktree ||
      !job.current_commit ||
      !job.reviewed_diff_hash
    )
      throw new Error("Verification evidence is missing");
    const passport = await this.requiredPassport(job.job_id);
    const evidence = await this.git.inspect(job.branch, job.worktree);
    const prior = await this.payload<CheckResults>(job, "test_results");
    const checks = await this.runChecksOnce(
      job,
      job.worktree,
      evidence.commit,
      passport.required_checks,
    );
    if (
      !prior.passed ||
      !checks.passed ||
      checks.checks.length === 0 ||
      !hasMeaningfulChecks(checks.checks.map((check) => check.command)) ||
      evidence.commit !== job.current_commit ||
      evidence.diff_hash !== job.reviewed_diff_hash ||
      prior.commit !== evidence.commit
    )
      return this.block(
        job,
        "Meaningful exact-revision verification is required before merge",
      );
    const stored = await this.artifact(
      job,
      "test_results",
      "orchestrator",
      checks,
      validateCheckResults,
    );
    await this.addArtifact(job.job_id, stored);
    await this.transition(await this.requiredJob(job.job_id), "merge_ready", {
      next_action: "Merge only the revalidated reviewed revision",
    });
  }

  private async merge(job: WorkflowJobV2): Promise<void> {
    if (
      !job.branch ||
      !job.worktree ||
      !job.target_branch ||
      !job.base_commit ||
      !job.current_commit ||
      !job.reviewed_diff_hash
    )
      throw new Error("Merge metadata is missing");
    const actual = await this.git.currentCommit(job.branch);
    if (actual !== job.current_commit)
      throw new Error("Merge approval is stale or incomplete");
    if (
      await this.git.isMerged(
        job.branch,
        job.current_commit,
        job.target_branch,
        job.base_commit,
      )
    ) {
      await this.transition(job, "done", { next_action: "Workflow complete" });
      await this.event(job.job_id, "merge_reconciled", {
        commit: job.current_commit,
      });
      return;
    }
    const evidence = await this.git.inspect(job.branch, job.worktree);
    const passport = await this.requiredPassport(job.job_id);
    const checks = await this.runChecksOnce(
      job,
      job.worktree,
      evidence.commit,
      passport.required_checks,
    );
    const rechecked = await this.git.inspect(job.branch, job.worktree);
    if (
      !checks.passed ||
      !hasMeaningfulChecks(checks.checks.map((check) => check.command)) ||
      evidence.commit !== job.current_commit ||
      rechecked.commit !== job.current_commit ||
      evidence.diff_hash !== job.reviewed_diff_hash ||
      rechecked.diff_hash !== job.reviewed_diff_hash
    )
      throw new Error("Merge approval is stale or incomplete");
    const merged = await this.mergeOnce(
      job,
      job.branch,
      job.current_commit,
      job.target_branch,
      job.base_commit,
    );
    if (!merged.success)
      throw new Error(`Merge failed closed: ${merged.detail}`);
    await this.transition(job, "done", { next_action: "Workflow complete" });
    await this.event(job.job_id, "workflow_done", {
      commit: job.current_commit,
      diff_hash: evidence.diff_hash,
    });
  }

  private async reviewEvidence(job: WorkflowJobV2, stage: CodexDecisionStage) {
    const fableAdvice = stage.startsWith("after_fable")
      ? await this.optionalPayload<FableAdviceV1>(job, "fable_advice")
      : null;
    if (stage === "pre_opus" || stage === "after_fable_pre")
      return {
        evidence: null,
        checks: null,
        opus: null,
        fable_advice: fableAdvice,
      };
    if (!job.branch || !job.worktree)
      throw new Error("Post-Opus worktree evidence is missing");
    return {
      evidence: await this.git.inspect(job.branch, job.worktree),
      checks: await this.payload<CheckResults>(job, "test_results"),
      opus: await this.payload<OpusResult>(job, "opus_report"),
      fable_advice: fableAdvice,
    };
  }
  private async consultationDenial(
    job: WorkflowJobV2,
    decision: CodexDecisionV2,
    query: FableQueryV1,
  ): Promise<FableFallbackReason | null> {
    if (job.mode !== "adaptive") return "direct_mode";
    const passport = await this.requiredPassport(job.job_id);
    const config = passport.config;
    if (
      config.fable_total_cap === 0 ||
      job.fable_calls >= config.fable_total_cap ||
      job.consultation_status !== "unused"
    )
      return "workflow_cap_or_duplicate";
    if (decision.risk_level !== "low") return "risk_not_low";
    if (Buffer.byteLength(JSON.stringify(query)) > config.max_input_bytes)
      return "input_oversized";
    const binding = roleBinding(passport.active_roster!, "adviser");
    const available = await this.roles.availability(binding, "adviser");
    if (!available.available) return "fable_unavailable";
    return null;
  }
  private async artifact<T>(
    job: WorkflowJobV2,
    name: ArtifactName,
    role: "codex" | "fable" | "opus" | "orchestrator",
    value: unknown,
    validate: (v: unknown) => T,
  ): Promise<StoredArtifact<T>> {
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
      validate,
    });
  }
  private async payload<T>(job: WorkflowJobV2, name: ArtifactName): Promise<T> {
    const result = await this.store.readArtifact<T>(job.job_id, name);
    if (!result) throw new Error(`Required artifact missing: ${name}`);
    return result.payload;
  }
  private async optionalPayload<T>(
    job: WorkflowJobV2,
    name: ArtifactName,
  ): Promise<T | null> {
    return (
      (await this.store.readArtifact<T>(job.job_id, name))?.payload ?? null
    );
  }
  private async textPayload(
    job: WorkflowJobV2,
    name: ArtifactName,
  ): Promise<string> {
    const result = await this.store.readTextArtifact(job.job_id, name);
    if (!result) throw new Error(`Required text artifact missing: ${name}`);
    return result.payload;
  }
  private async transition(
    job: WorkflowJobV2,
    phase: WorkflowPhase,
    patch: Partial<WorkflowJobV2> = {},
  ): Promise<WorkflowJobV2> {
    return this.store.commitTransition(
      job.job_id,
      phase,
      { ...patch, current_operation: null },
      {},
    );
  }
  private async block(job: WorkflowJobV2, reason: string): Promise<void> {
    await this.transition(job, "blocked", {
      blocker: reason,
      resume_phase: job.phase,
      next_action: "Provide human input, then resume",
    });
    await this.event(job.job_id, "workflow_blocked", { reason });
  }
  private async addArtifact(
    jobId: string,
    stored: StoredArtifact<unknown>,
  ): Promise<void> {
    const passport = await this.requiredPassport(jobId);
    const reference = artifactReference(stored.metadata.filename, stored);
    if (
      passport.artifacts.some(
        (item) =>
          item.filename === reference.filename && item.hash === reference.hash,
      )
    )
      return;
    await this.updatePassport(jobId, {
      artifacts: [...passport.artifacts, reference],
    });
  }
  private async recordDecision(
    job: WorkflowJobV2,
    decision: CodexDecisionV2,
  ): Promise<void> {
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
          timestamp: new Date().toISOString(),
          fable_advice_disposition: decision.fable_advice_disposition,
          fable_error: decision.fable_error,
          fable_iteration_effect: decision.fable_iteration_effect,
        },
      ],
    });
  }
  private async updatePassport(
    jobId: string,
    patch: Partial<WorkflowPassportV2>,
  ): Promise<void> {
    const passport = await this.requiredPassport(jobId);
    const updated = {
      ...passport,
      ...patch,
      passport_revision: passport.passport_revision + 1,
      schema_version: 2 as const,
      job_id: passport.job_id,
    };
    if (
      Buffer.byteLength(JSON.stringify(updated)) >
      updated.config.passport_max_bytes
    )
      throw new Error("Workflow passport exceeded configured maximum");
    await this.store.writePassport(updated);
  }
  async rotateSession(
    jobId: string,
    role: "codex" | "opus",
    reason: string,
  ): Promise<void> {
    const sessions = await this.requiredSessions(jobId);
    const passport = await this.requiredPassport(jobId);
    const key = role === "codex" ? "codex_thread_id" : "opus_session_id";
    const previous = sessions[key];
    const rotation = {
      role,
      previous_id: previous,
      next_id: null,
      reason: reason.trim() || "manual rotation",
      timestamp: new Date().toISOString(),
    };
    const updated: WorkflowSessionsV2 = {
      ...sessions,
      sessions_revision: sessions.sessions_revision + 1,
      [key]: null,
      ...(role === "opus" ? { opus_brief_hash: null } : {}),
      modes: { ...sessions.modes, [role]: "none" as const },
      rotation_history: [...sessions.rotation_history, rotation],
      updated_at: rotation.timestamp,
    };
    const updatedPassport = {
      ...passport,
      passport_revision: passport.passport_revision + 1,
      session_references: {
        codex: updated.codex_thread_id,
        opus: updated.opus_session_id,
      },
      session_modes: updated.modes,
      rotation_history: updated.rotation_history,
    };
    await this.store.commitSessionsAndPassport(updated, updatedPassport);
    await this.event(jobId, "session_rotated", rotation);
  }
  async rotateBinding(
    jobId: string,
    role: SemanticRole,
    binding: RosterAgent,
    reason: string,
    allowUnverifiedModel = false,
  ): Promise<void> {
    const auditReason = reason.trim();
    if (!auditReason)
      throw new Error("Binding rotation requires a nonempty reason");
    const job = await this.requiredJob(jobId);
    if (job.phase !== "paused" && job.phase !== "blocked")
      throw new Error(`Cannot rotate bindings while workflow is ${job.phase}`);
    if (job.current_operation)
      throw new Error(
        "Cannot rotate bindings while a workflow operation is reserved",
      );
    if (job.blocker?.startsWith("LEGACY_SCHEMA:"))
      throw new Error("Legacy schema workflow bindings cannot be rotated");
    if (
      !job.resume_phase ||
      job.resume_phase === "verification" ||
      job.resume_phase === "merge_ready" ||
      isTerminalWorkflowPhase(job.resume_phase)
    )
      throw new Error(
        `Cannot rotate bindings at ${job.resume_phase ?? job.phase}`,
      );
    const passport = await this.requiredPassport(jobId);
    const sessions = await this.requiredSessions(jobId);
    const nextBinding = validateRosterAgent(binding);
    if (
      role === "adviser" &&
      (nextBinding.profile.effort !== "low" ||
        nextBinding.profile.max_turns !== 1)
    )
      throw new Error("Adviser binding must use low effort and one turn");
    const active = passport.active_roster!;
    const previous =
      role === "reviewer"
        ? reviewerBinding(active)
        : role === "adviser"
          ? active.adviser
          : active[role];
    if (!previous)
      throw new Error(`Cannot rotate an unauthorized ${role} binding`);
    if (sameBinding(previous, nextBinding))
      throw new Error("Binding rotation must change the binding");
    const nextRoster = validateRosterSnapshot(
      { ...active, [role]: nextBinding },
      passport.mode,
    );
    const probes = [this.roles.availability(nextBinding, role)];
    if (role === "supervisor" && "same_as" in active.reviewer)
      probes.push(this.roles.availability(nextBinding, "reviewer"));
    const unavailable = (await Promise.all(probes))
      .filter((item) => !item.available)
      .map((item) => item.detail);
    if (unavailable.length)
      throw new Error(
        `Workflow capabilities blocked: ${unavailable.join("; ")}`,
      );
    if (
      nextBinding.profile.model &&
      !(
        nextBinding.adapter === "claude" && nextBinding.profile.model === "opus"
      ) &&
      !allowUnverifiedModel
    )
      throw new Error(
        `Unverified workflow model/profile requires explicit opt-in: ${nextBinding.adapter}:${nextBinding.profile.model}`,
      );
    const timestamp = new Date().toISOString();
    const revision = passport.roster_revision! + 1;
    const history = {
      role,
      previous_binding_hash: previous ? hashRosterAgent(previous) : null,
      new_binding_hash: hashRosterAgent(nextBinding),
      previous_binding: previous,
      new_binding: nextBinding,
      reason: auditReason,
      timestamp,
      revision,
    };
    const sessionRole =
      role === "supervisor" ? "codex" : role === "implementer" ? "opus" : null;
    const sessionKey =
      sessionRole === "codex" ? "codex_thread_id" : "opus_session_id";
    const previousId = sessionRole ? sessions[sessionKey] : null;
    const sessionRotation: SessionRotation | null = sessionRole
      ? {
          role: sessionRole,
          previous_id: previousId,
          next_id: null,
          reason: `binding rotation: ${auditReason}`,
          timestamp,
        }
      : null;
    const updatedSessions: WorkflowSessionsV2 = {
      ...sessions,
      sessions_revision: sessions.sessions_revision + 1,
      ...(sessionRole ? { [sessionKey]: null } : {}),
      ...(role === "implementer" ? { opus_brief_hash: null } : {}),
      modes: sessionRole
        ? { ...sessions.modes, [sessionRole]: "none" }
        : sessions.modes,
      rotation_history: sessionRotation
        ? [...sessions.rotation_history, sessionRotation]
        : sessions.rotation_history,
      updated_at: timestamp,
    };
    const profileKey =
      role === "supervisor"
        ? "codex"
        : role === "implementer"
          ? "opus"
          : role === "adviser"
            ? "fable"
            : null;
    const config = profileKey
      ? {
          ...passport.config,
          fable_total_cap:
            role === "adviser" ? (1 as const) : passport.config.fable_total_cap,
          profiles: {
            ...passport.config.profiles,
            [profileKey]: {
              ...passport.config.profiles[profileKey],
              model: nextBinding.profile.model,
              effort: nextBinding.profile.effort,
              max_turns: nextBinding.profile.max_turns,
              timeout_ms: nextBinding.profile.timeout_ms,
            },
          },
        }
      : passport.config;
    const updatedPassport: WorkflowPassportV2 = {
      ...passport,
      passport_revision: passport.passport_revision + 1,
      active_roster: nextRoster,
      active_roster_hash: hashRosterSnapshot(nextRoster),
      roster_revision: revision,
      binding_rotation_history: [
        ...passport.binding_rotation_history!,
        history,
      ],
      config,
      session_references: {
        codex: updatedSessions.codex_thread_id,
        opus: updatedSessions.opus_session_id,
      },
      session_modes: updatedSessions.modes,
      rotation_history: updatedSessions.rotation_history,
    };
    await this.store.commitBindingRotation(updatedSessions, updatedPassport);
    await this.event(jobId, "binding_rotated", history);
  }
  private async recordRole<T>(
    job: WorkflowJobV2,
    role: "codex" | "fable" | "opus",
    result: RoleResult<T>,
  ): Promise<void> {
    const sessions = await this.requiredSessions(job.job_id);
    const invocationId = this.invocation(job);
    if (sessions.recorded_invocations.includes(invocationId)) {
      await this.syncPassportSessions(job.job_id, sessions);
      return;
    }
    const u = sessions.usage[role];
    const inputChars = result.usage?.input_chars ?? 0;
    const outputChars =
      result.usage?.output_chars ??
      Buffer.byteLength(
        typeof result.value === "string"
          ? result.value
          : JSON.stringify(result.value),
      );
    const nextUsage: AgentUsage = {
      calls: u.calls + 1,
      input_chars: u.input_chars + inputChars,
      output_chars: u.output_chars + outputChars,
      input_tokens: u.input_tokens + (result.usage?.input_tokens ?? 0),
      output_tokens: u.output_tokens + (result.usage?.output_tokens ?? 0),
      estimated_tokens:
        u.estimated_tokens + Math.ceil((inputChars + outputChars) / 4),
      cache_read: u.cache_read + (result.usage?.cache_read ?? 0),
      cache_write: u.cache_write + (result.usage?.cache_write ?? 0),
      duration_ms: u.duration_ms + (result.usage?.duration_ms ?? 0),
      failed_calls: u.failed_calls,
      resumes: u.resumes + (result.resumed ? 1 : 0),
      compactions: u.compactions + (result.usage?.compactions ?? 0),
    };
    const mode =
      result.session_mode ??
      (result.resumed
        ? "native_resume"
        : result.resume_failed
          ? "passport_handoff"
          : result.session_id
            ? "new"
            : "none");
    const previous =
      role === "codex"
        ? sessions.codex_thread_id
        : role === "opus"
          ? sessions.opus_session_id
          : null;
    const next = result.session_id ?? previous;
    const rotation =
      role !== "fable" && result.resume_failed
        ? {
            role,
            previous_id: previous,
            next_id: next,
            reason:
              "native continuation unavailable or invalid; passport handoff used",
            timestamp: new Date().toISOString(),
          }
        : null;
    const updated: WorkflowSessionsV2 = {
      ...sessions,
      sessions_revision: sessions.sessions_revision + 1,
      codex_thread_id: role === "codex" ? next : sessions.codex_thread_id,
      opus_session_id: role === "opus" ? next : sessions.opus_session_id,
      opus_brief_hash:
        role === "opus"
          ? (await this.requiredJob(job.job_id)).accepted_brief_hash
          : sessions.opus_brief_hash,
      modes:
        role === "fable" ? sessions.modes : { ...sessions.modes, [role]: mode },
      rotation_history: rotation
        ? [...sessions.rotation_history, rotation]
        : sessions.rotation_history,
      recorded_invocations: [...sessions.recorded_invocations, invocationId],
      usage: { ...sessions.usage, [role]: nextUsage },
      updated_at: new Date().toISOString(),
    };
    const passport = await this.requiredPassport(job.job_id);
    const updatedPassport = {
      ...passport,
      passport_revision: passport.passport_revision + 1,
      session_references: {
        codex: updated.codex_thread_id,
        opus: updated.opus_session_id,
      },
      session_modes: updated.modes,
      rotation_history: updated.rotation_history,
    };
    await this.store.commitSessionsAndPassport(updated, updatedPassport);
  }
  private async syncPassportSessions(
    jobId: string,
    sessions: WorkflowSessionsV2,
  ): Promise<void> {
    const passport = await this.requiredPassport(jobId);
    const references = {
      codex: sessions.codex_thread_id,
      opus: sessions.opus_session_id,
    };
    if (
      JSON.stringify(passport.session_references) ===
        JSON.stringify(references) &&
      JSON.stringify(passport.session_modes) ===
        JSON.stringify(sessions.modes) &&
      JSON.stringify(passport.rotation_history) ===
        JSON.stringify(sessions.rotation_history)
    )
      return;
    await this.updatePassport(jobId, {
      session_references: references,
      session_modes: sessions.modes,
      rotation_history: sessions.rotation_history,
    });
  }
  private async fableOptions(
    passport: WorkflowPassportV2,
  ): Promise<FableCallOptions> {
    const workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), "orch-fable-empty-"),
    );
    return {
      workspace,
      model: passport.config.profiles.fable.model,
      max_turns: 1,
      effort: "low",
      timeout_ms: passport.config.profiles.fable.timeout_ms,
      max_input_bytes: passport.config.max_input_bytes,
      max_output_bytes: passport.config.max_output_bytes,
    };
  }
  private async fableCall<T>(
    job: WorkflowJobV2,
    binding: RosterAgent,
    options: FableCallOptions,
    request: unknown,
    call: (
      observer: (event: RoleAttemptEvent) => Promise<void>,
    ) => Promise<RoleResult<T>>,
    validate: (value: unknown) => T,
  ): Promise<RoleResult<T>> {
    try {
      return await this.invoke(
        job,
        "adviser",
        "fable",
        binding,
        request,
        call,
        validate,
      );
    } finally {
      await fs.rm(options.workspace, { recursive: true, force: true });
    }
  }
  private async invoke<T>(
    job: WorkflowJobV2,
    semanticRole: SemanticRole,
    usageRole: "codex" | "fable" | "opus",
    binding: RosterAgent,
    request: unknown,
    call: (
      observer: (event: RoleAttemptEvent) => Promise<void>,
    ) => Promise<RoleResult<T>>,
    validate: (value: unknown) => T = (value) => value as T,
  ): Promise<RoleResult<T>> {
    const invocationId = this.invocation(job);
    const requestHash = hashPersisted(request);
    const passport = await this.requiredPassport(job.job_id);
    const bindingHash = hashCanonical(binding);
    const recordsSession =
      semanticRole !== "reviewer" ||
      sameBinding(binding, passport.active_roster!.supervisor);
    const prior = await this.store.readInvocationReceipt(
      job.job_id,
      invocationId,
    );
    if (prior) {
      if (
        prior.role !== usageRole ||
        prior.phase !== job.phase ||
        prior.request_hash !== requestHash ||
        prior.workflow_revision !== job.revision ||
        (prior.semantic_role !== undefined &&
          prior.semantic_role !== semanticRole) ||
        (prior.roster_hash !== undefined &&
          prior.roster_hash !== passport.active_roster_hash) ||
        (prior.roster_revision ?? 1) !== passport.roster_revision ||
        (prior.binding_hash !== undefined &&
          prior.binding_hash !== bindingHash) ||
        (prior.role_adapter !== undefined &&
          prior.role_adapter !== binding.adapter)
      )
        throw new Error("Invocation receipt does not match workflow operation");
      const result = prior.result as RoleResult<T>;
      try {
        result.value = validate(result.value);
      } catch (error) {
        throw attachUsage(error, result.usage);
      }
      if (
        !(await this.store.readLlmAttempts(job.job_id)).some(
          (attempt) => attempt.invocation_id === invocationId,
        )
      ) {
        const base = attemptBase(
          job,
          semanticRole,
          usageRole,
          binding,
          passport,
          1,
          prior.timestamp,
        );
        await this.store.writeLlmAttempt(startedAttempt(base));
        await this.store.writeLlmAttempt(
          terminalAttempt(base, "succeeded", result.usage),
        );
      }
      await this.recordRole(
        job,
        usageRole,
        recordsSession ? result : withoutSession(result),
      );
      return result;
    }
    const started = Date.now();
    let index = 0;
    const open = new Map<string, ReturnType<typeof attemptBase>>();
    const completed = new Map<string, RoleAttemptEvent>();
    const observer = async (event: RoleAttemptEvent) => {
      if (event.status === "started") {
        const base = attemptBase(
          job,
          semanticRole,
          usageRole,
          binding,
          passport,
          ++index,
        );
        open.set(event.attempt_key, base);
        await this.store.writeLlmAttempt(startedAttempt(base));
        return;
      }
      const base = open.get(event.attempt_key);
      if (!base)
        throw new Error(
          "Adapter attempt observer emitted a terminal event without a start",
        );
      if (event.status === "succeeded") {
        completed.set(event.attempt_key, event);
        return;
      }
      await this.store.writeLlmAttempt(
        terminalAttempt(base, "failed", event.usage, event.error),
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
        duration_ms: result.usage?.duration_ms ?? Date.now() - started,
      };
      if (index === 0) {
        const base = attemptBase(
          job,
          semanticRole,
          usageRole,
          binding,
          passport,
          1,
        );
        await this.store.writeLlmAttempt(startedAttempt(base));
        await this.store.writeLlmAttempt(
          terminalAttempt(base, "succeeded", result.usage),
        );
      } else if (open.size === 1) {
        const [key, base] = [...open.entries()][0]!;
        const event = completed.get(key);
        await this.store.writeLlmAttempt(
          terminalAttempt(base, "succeeded", event?.usage ?? result.usage),
        );
        open.delete(key);
        completed.delete(key);
      }
      const receipt: WorkflowInvocationReceiptV2 = {
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
        timestamp: new Date().toISOString(),
        result,
      };
      await this.store.writeInvocationReceipt(receipt);
      await this.recordRole(
        job,
        usageRole,
        recordsSession ? result : withoutSession(result),
      );
      return result;
    } catch (error) {
      if (!(await this.store.readInvocationReceipt(job.job_id, invocationId))) {
        if (index === 0) {
          const base = attemptBase(
            job,
            semanticRole,
            usageRole,
            binding,
            passport,
            1,
          );
          await this.store.writeLlmAttempt(startedAttempt(base));
          await this.store.writeLlmAttempt(
            terminalAttempt(base, "failed", usageFromError(error), error),
          );
        } else if (open.size === 1) {
          const [key, base] = [...open.entries()][0]!;
          await this.store.writeLlmAttempt(
            terminalAttempt(base, "failed", usageFromError(error), error),
          );
          open.delete(key);
        }
        await this.recordFailedRoleCall(job, usageRole, Date.now() - started);
      }
      throw error;
    }
  }
  private async runChecksOnce(
    job: WorkflowJobV2,
    worktree: string,
    commit: string,
    commands: string[],
  ): Promise<CheckResults> {
    const trusted = await this.git.validateChecks(
      validateDeterministicCheckCommands(commands),
      worktree,
    );
    return this.effect(
      job,
      "checks",
      { worktree, commit, commands: trusted },
      validateCheckResults,
      () => this.git.runChecks(worktree, commit, trusted),
    );
  }
  private async ensureTrustedChecks(jobId: string): Promise<void> {
    const passport = await this.requiredPassport(jobId);
    await this.git.validateChecks(
      validateDeterministicCheckCommands(passport.required_checks),
      passport.active_worktree ?? undefined,
    );
  }
  private async mergeOnce(
    job: WorkflowJobV2,
    branch: string,
    commit: string,
    targetBranch: string,
    baseCommit: string,
  ): Promise<{ success: boolean; detail: string }> {
    return this.effect(
      job,
      "merge",
      { branch, commit, targetBranch, baseCommit },
      validateMergeResult,
      () => this.git.merge(branch, commit, targetBranch, baseCommit),
    );
  }
  private async effect<T>(
    job: WorkflowJobV2,
    kind: WorkflowEffectReceiptV2["kind"],
    request: unknown,
    validate: (value: unknown) => T,
    call: () => Promise<unknown>,
  ): Promise<T> {
    const invocationId = this.invocation(job);
    const requestHash = hashPersisted(request);
    const prior = await this.store.readEffectReceipt(
      job.job_id,
      invocationId,
      kind,
    );
    if (prior) {
      if (
        prior.request_hash !== requestHash ||
        prior.workflow_revision !== job.revision ||
        prior.phase !== job.phase
      )
        throw new Error(
          "Workflow effect receipt does not match current operation",
        );
      if (prior.status === "started")
        throw new Error(
          `AMBIGUOUS_EFFECT: ${kind} may have run for ${invocationId}; automatic retry is prohibited`,
        );
      return validate(prior.result);
    }
    const started: WorkflowEffectReceiptV2 = {
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
      timestamp: new Date().toISOString(),
      result: null,
    };
    await this.store.writeEffectReceipt(started);
    const result = validate(await call());
    await this.store.writeEffectReceipt({
      ...started,
      status: "completed",
      result_hash: hashPersisted(result),
      timestamp: new Date().toISOString(),
      result,
    });
    return result;
  }
  private async recordFailedRoleCall(
    job: WorkflowJobV2,
    role: "codex" | "fable" | "opus",
    durationMs: number,
  ): Promise<void> {
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
          failed_calls: current.failed_calls + 1,
        },
      },
      updated_at: new Date().toISOString(),
    });
  }
  private async ensureInterruptedAttempt(job: WorkflowJobV2): Promise<void> {
    const invocationId = this.invocation(job);
    const attempts = await this.store.readLlmAttempts(job.job_id);
    if (attempts.some((attempt) => attempt.invocation_id === invocationId))
      return;
    const passport = await this.requiredPassport(job.job_id);
    const semanticRole = semanticRoleForPhase(
      job.phase,
      job.consultation_origin,
    );
    if (!semanticRole) return;
    const binding = roleBinding(passport.active_roster!, semanticRole);
    const providerRole =
      semanticRole === "implementer"
        ? "opus"
        : semanticRole === "adviser"
          ? "fable"
          : "codex";
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
      roster_revision: passport.roster_revision!,
      status: "started",
      usage_status: "unknown",
      usage: null,
      error_category: null,
      error_message: null,
      started_at: job.current_operation!.started_at,
      completed_at: null,
    });
  }
  private invocation(job: WorkflowJobV2): string {
    if (!job.current_operation || job.current_operation.phase !== job.phase)
      throw new Error(`Workflow phase ${job.phase} has no reserved invocation`);
    return job.current_operation.invocation_id;
  }
  private assertAllowedScope(
    passport: WorkflowPassportV2,
    files: string[],
  ): void {
    if (passport.allowed_file_scope.length === 0) return;
    const outside = files.filter(
      (file) =>
        !passport.allowed_file_scope.some(
          (allowed) =>
            file === allowed ||
            file.startsWith(`${allowed.replace(/\/$/, "")}/`),
        ),
    );
    if (outside.length)
      throw new Error(
        `Opus changed files outside approved scope: ${outside.join(", ")}`,
      );
  }
  private assertJob(job: WorkflowJobV2, received: string): void {
    if (received !== job.job_id)
      throw new Error(`Artifact job_id mismatch: ${received}`);
  }
  private async context(
    jobId: string,
  ): Promise<{ passport: WorkflowPassportV2; sessions: WorkflowSessionsV2 }> {
    return {
      passport: await this.requiredPassport(jobId),
      sessions: await this.requiredSessions(jobId),
    };
  }
  private async requiredJob(id: string): Promise<WorkflowJobV2> {
    const value = await this.store.readJob(id);
    if (!value) throw new Error(`Workflow job not found: ${id}`);
    return value;
  }
  private async requiredPassport(id: string): Promise<WorkflowPassportV2> {
    const value = await this.store.readPassport(id);
    if (!value) throw new Error(`Workflow passport not found: ${id}`);
    return value;
  }
  private async requiredSessions(id: string): Promise<WorkflowSessionsV2> {
    const value = await this.store.readSessions(id);
    if (!value) throw new Error(`Workflow sessions not found: ${id}`);
    return value;
  }
  private async event(id: string, type: string, data: unknown): Promise<void> {
    await this.store.appendEvent({
      schema_version: 2,
      job_id: id,
      type,
      timestamp: new Date().toISOString(),
      data,
    });
  }
  private assertRuntimeRoster(
    roster: WorkflowRosterSnapshot,
    mode: WorkflowMode,
  ): void {
    if (mode === "direct" && roster.adviser)
      throw new Error("Direct workflow roster cannot include an adviser");
  }
}

function usage(): AgentUsage {
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
    compactions: 0,
  };
}
function attemptBase(
  job: WorkflowJobV2,
  semanticRole: SemanticRole,
  providerRole: "codex" | "fable" | "opus",
  binding: RosterAgent,
  passport: WorkflowPassportV2,
  index: number,
  startedAt = new Date().toISOString(),
) {
  const invocationId = job.current_operation!.invocation_id;
  return {
    schema_version: 1 as const,
    job_id: job.job_id,
    attempt_id: `${invocationId}_${index}`,
    invocation_id: invocationId,
    phase: job.phase,
    semantic_role: semanticRole,
    provider_role: providerRole,
    adapter: binding.adapter,
    binding_hash: hashCanonical(binding),
    roster_revision: passport.roster_revision!,
    started_at: startedAt,
  };
}
function startedAttempt(
  base: ReturnType<typeof attemptBase>,
): WorkflowLlmAttemptV1 {
  return {
    ...base,
    status: "started",
    usage_status: "unknown",
    usage: null,
    error_category: null,
    error_message: null,
    completed_at: null,
  };
}
function terminalAttempt(
  base: Pick<
    WorkflowLlmAttemptV1,
    | "schema_version"
    | "job_id"
    | "attempt_id"
    | "invocation_id"
    | "phase"
    | "semantic_role"
    | "provider_role"
    | "adapter"
    | "binding_hash"
    | "roster_revision"
    | "started_at"
  >,
  status: "succeeded" | "failed",
  value: RoleResult<unknown>["usage"] | undefined,
  error?: unknown,
): WorkflowLlmAttemptV1 {
  const duration =
    value?.duration_ms ?? Math.max(0, Date.now() - Date.parse(base.started_at));
  const hasTokens =
    value?.input_tokens !== undefined && value?.output_tokens !== undefined;
  const hasChars =
    value?.input_chars !== undefined || value?.output_chars !== undefined;
  const usageStatus = hasTokens ? "known" : hasChars ? "estimated" : "unknown";
  return {
    ...base,
    status,
    usage_status: usageStatus,
    usage: value
      ? { ...value, duration_ms: duration }
      : { duration_ms: duration },
    error_category: status === "failed" ? errorCategory(error) : null,
    error_message: status === "failed" ? safeErrorMessage(error) : null,
    completed_at: new Date().toISOString(),
  };
}
function usageFromError(
  error: unknown,
): RoleResult<unknown>["usage"] | undefined {
  if (!error || typeof error !== "object") return undefined;
  const usage = (error as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage))
    return undefined;
  const result: NonNullable<RoleResult<unknown>["usage"]> = {};
  for (const key of [
    "input_chars",
    "output_chars",
    "input_tokens",
    "output_tokens",
    "cache_read",
    "cache_write",
    "duration_ms",
    "compactions",
  ] as const) {
    const value = (usage as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      result[key] = value;
  }
  return result;
}
function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    /Unsafe|meaningful deterministic check|invalid during|mismatch|stale|requires|cannot include|outside approved scope/i.test(
      message,
    )
  )
    return "validation_error";
  if (/timed out/i.test(message)) return "timeout";
  if (/exited\s+\d+/i.test(message)) return "process_exit";
  if (/output exceeded/i.test(message)) return "output_limit";
  if (/malformed|no (?:agent message|result)/i.test(message))
    return "invalid_response";
  return "adapter_error";
}
function safeErrorMessage(error: unknown): string {
  const category = errorCategory(error);
  if (category === "validation_error")
    return error instanceof Error
      ? sanitizeValidationMessage(error.message)
      : "Workflow validation failed";
  return category === "timeout"
    ? "Adapter call timed out"
    : category === "process_exit"
      ? "Adapter process exited unsuccessfully"
      : category === "output_limit"
        ? "Adapter output exceeded the configured limit"
        : category === "invalid_response"
          ? "Adapter returned an invalid response"
          : "Adapter call failed";
}
function sanitizeValidationMessage(message: string): string {
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 512);
}
function resultValidationError(error: unknown, value: unknown): Error {
  const result = error instanceof Error ? error : new Error(String(error));
  (result as Error & { validation_result?: unknown }).validation_result = value;
  return result;
}
function attachUsage(
  error: unknown,
  usage: RoleResult<unknown>["usage"],
): Error {
  const result = error instanceof Error ? error : new Error(String(error));
  (result as Error & { usage?: RoleResult<unknown>["usage"] }).usage = usage;
  return result;
}
function validationResult(error: unknown): unknown {
  return error && typeof error === "object" && "validation_result" in error
    ? (error as { validation_result: unknown }).validation_result
    : undefined;
}
function rosterAgent(
  adapter: string,
  name: string,
  profile: WorkflowConfig["profiles"]["codex"],
): RosterAgent {
  return {
    adapter,
    profile: {
      name,
      model: profile.model,
      effort: profile.effort,
      max_turns: profile.max_turns,
      timeout_ms: profile.timeout_ms,
    },
  };
}
function profileFromRoster(
  binding: RosterAgent | null,
  fallback: WorkflowConfig["profiles"]["codex"],
): WorkflowConfig["profiles"]["codex"] {
  return binding
    ? {
        model: binding.profile.model,
        effort: binding.profile.effort,
        max_turns: binding.profile.max_turns,
        timeout_ms: binding.profile.timeout_ms,
        permission_mode: fallback.permission_mode,
      }
    : fallback;
}
function reviewerBinding(roster: WorkflowRosterSnapshot): RosterAgent {
  return "same_as" in roster.reviewer ? roster.supervisor : roster.reviewer;
}
function rosterBindings(roster: WorkflowRosterSnapshot): RosterAgent[] {
  return [
    roster.supervisor,
    roster.implementer,
    ...(roster.adviser ? [roster.adviser] : []),
    ...("same_as" in roster.reviewer ? [] : [roster.reviewer]),
  ];
}
function roleBinding(
  roster: WorkflowRosterSnapshot,
  role: SemanticRole,
): RosterAgent {
  if (role === "supervisor") return roster.supervisor;
  if (role === "implementer") return roster.implementer;
  if (role === "reviewer") return reviewerBinding(roster);
  if (roster.adviser) return roster.adviser;
  throw new Error("No persisted adviser binding exists");
}
function decisionRole(stage: CodexDecisionStage): "supervisor" | "reviewer" {
  return stage === "post_opus" || stage === "after_fable_post"
    ? "reviewer"
    : "supervisor";
}
function semanticRoleForPhase(
  phase: WorkflowPhase,
  origin: ConsultationOrigin | null,
): SemanticRole | null {
  if (phase === "opus_execution") return "implementer";
  if (phase === "fable_consultation") return "adviser";
  if (
    phase === "codex_post_opus" ||
    (phase === "codex_after_fable" && origin === "post_opus")
  )
    return "reviewer";
  if (phase === "codex_pre_opus" || phase === "codex_after_fable")
    return "supervisor";
  return null;
}
function sameBinding(left: RosterAgent, right: RosterAgent): boolean {
  return hashCanonical(left) === hashCanonical(right);
}
function withoutSession<T>(result: RoleResult<T>): RoleResult<T> {
  return {
    ...result,
    session_id: undefined,
    session_mode: "none",
    resumed: false,
    resume_failed: false,
  };
}
export function hasMeaningfulChecks(commands: string[]): boolean {
  try {
    return validateDeterministicCheckCommands(commands).length > 0;
  } catch {
    return false;
  }
}
function validateMergeResult(value: unknown): {
  success: boolean;
  detail: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Merge result must be an object");
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some((key) => key !== "success" && key !== "detail") ||
    typeof result.success !== "boolean" ||
    typeof result.detail !== "string"
  )
    throw new Error("Merge result is malformed");
  return { success: result.success, detail: result.detail };
}
