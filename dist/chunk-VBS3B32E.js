import { readJson, appendJsonl, readJsonl, atomicWrite, ensureDir } from './chunk-54K3JU53.js';
import { sanitizeText, sanitizeForPersistence } from './chunk-RQZGDMFG.js';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// src/domain/workflow/transitions.ts
var ACTIVE = ["codex_pre_opus", "fable_consultation", "codex_after_fable", "opus_execution", "codex_post_opus", "verification", "merge_ready"];
var WORKFLOW_PHASE_TRANSITIONS = {
  codex_pre_opus: ["fable_consultation", "opus_execution", "paused", "cancelled", "failed"],
  fable_consultation: ["codex_after_fable", "opus_execution", "paused", "cancelled", "failed"],
  codex_after_fable: ["opus_execution", "verification", "paused", "cancelled", "failed"],
  opus_execution: ["codex_post_opus", "blocked", "paused", "cancelled", "failed"],
  codex_post_opus: ["fable_consultation", "opus_execution", "verification", "paused", "cancelled", "failed"],
  verification: ["merge_ready", "blocked", "paused", "cancelled", "failed"],
  merge_ready: ["done", "blocked", "paused", "cancelled", "failed"],
  done: [],
  blocked: [...ACTIVE, "cancelled"],
  paused: [...ACTIVE, "blocked", "cancelled"],
  cancelled: [],
  failed: []
};
function canTransitionWorkflow(from, to) {
  return WORKFLOW_PHASE_TRANSITIONS[from].includes(to);
}
function transitionWorkflow(from, to) {
  if (!canTransitionWorkflow(from, to)) throw new Error(`Invalid workflow phase transition: ${from} -> ${to}`);
  return to;
}
function isTerminalWorkflowPhase(phase2) {
  return phase2 === "done" || phase2 === "cancelled" || phase2 === "failed";
}

// src/domain/workflow/validation.ts
var PHASES = Object.keys(WORKFLOW_PHASE_TRANSITIONS);
var MODES = ["new", "native_resume", "passport_handoff", "none"];
function validateWorkflowJob(value) {
  const raw = record(value, "workflow job");
  if (raw.schema_version === 1) return legacyJob(raw);
  const o = raw;
  exact(o, ["schema_version", "job_id", "mode", "phase", "resume_phase", "revision", "artifact_revision", "latest_artifact_hash", "opus_iteration", "fix_cycles", "fable_calls", "consultation_status", "consultation_origin", "branch", "worktree", "target_branch", "base_commit", "current_commit", "reviewed_diff_hash", "accepted_brief_hash", "last_action", "blocker", "next_action", "current_operation", "created_at", "updated_at"], "workflow job");
  const operation = o.current_operation === null ? null : (() => {
    const p = record(o.current_operation, "current_operation");
    exact(p, ["phase", "invocation_id", "started_at", "retry_count"], "current_operation");
    return { phase: phase(p.phase), invocation_id: id(p.invocation_id, "invocation_id"), started_at: timestamp(p.started_at, "started_at"), retry_count: integer(p.retry_count, "retry_count", 0) };
  })();
  return { schema_version: two(o.schema_version), job_id: id(o.job_id, "job_id"), mode: enumeration(o.mode, ["adaptive", "direct"], "mode"), phase: phase(o.phase), resume_phase: o.resume_phase === null ? null : phase(o.resume_phase), revision: integer(o.revision, "revision", 1), artifact_revision: integer(o.artifact_revision, "artifact_revision", 0), latest_artifact_hash: nullableHash(o.latest_artifact_hash, "latest_artifact_hash"), opus_iteration: integer(o.opus_iteration, "opus_iteration", 1), fix_cycles: integer(o.fix_cycles, "fix_cycles", 0), fable_calls: integer(o.fable_calls, "fable_calls", 0), consultation_status: enumeration(o.consultation_status, ["unused", "requested", "attempt_started", "result_persisted", "skipped", "fallback_executed"], "consultation_status"), consultation_origin: o.consultation_origin === null ? null : enumeration(o.consultation_origin, ["pre_opus", "post_opus"], "consultation_origin"), branch: nullableString(o.branch, "branch"), worktree: nullableString(o.worktree, "worktree"), target_branch: nullableString(o.target_branch, "target_branch"), base_commit: nullableString(o.base_commit, "base_commit"), current_commit: nullableString(o.current_commit, "current_commit"), reviewed_diff_hash: nullableHash(o.reviewed_diff_hash, "reviewed_diff_hash"), accepted_brief_hash: nullableHash(o.accepted_brief_hash, "accepted_brief_hash"), last_action: nullableString(o.last_action, "last_action"), blocker: nullableString(o.blocker, "blocker"), next_action: string(o.next_action, "next_action"), current_operation: operation, created_at: timestamp(o.created_at, "created_at"), updated_at: timestamp(o.updated_at, "updated_at") };
}
function validateWorkflowPassport(value) {
  const raw = record(value, "workflow passport");
  if (raw.schema_version === 1) return legacyPassport(raw);
  const o = raw;
  exact(o, ["schema_version", "passport_revision", "job_id", "mode", "current_revision", "objective", "current_phase", "accepted_brief_hash", "latest_implementation_brief", "hard_constraints", "acceptance_criteria", "decisions", "allowed_file_scope", "required_checks", "current_blockers", "next_action", "artifacts", "active_worktree", "target_branch", "base_commit", "current_commit", "session_references", "session_modes", "rotation_history", "config"], "workflow passport");
  return { schema_version: two(o.schema_version), passport_revision: integer(o.passport_revision, "passport_revision", 1), job_id: id(o.job_id, "job_id"), mode: enumeration(o.mode, ["adaptive", "direct"], "mode"), current_revision: integer(o.current_revision, "current_revision", 1), objective: nonEmpty(o.objective, "objective"), current_phase: phase(o.current_phase), accepted_brief_hash: nullableHash(o.accepted_brief_hash, "accepted_brief_hash"), latest_implementation_brief: o.latest_implementation_brief === null ? null : artifact(o.latest_implementation_brief, "latest_implementation_brief"), hard_constraints: strings(o.hard_constraints, "hard_constraints"), acceptance_criteria: strings(o.acceptance_criteria, "acceptance_criteria"), decisions: array(o.decisions, "decisions").map((item, index) => decision(item, `decisions[${index}]`)), allowed_file_scope: strings(o.allowed_file_scope, "allowed_file_scope"), required_checks: strings(o.required_checks, "required_checks"), current_blockers: strings(o.current_blockers, "current_blockers"), next_action: string(o.next_action, "next_action"), artifacts: array(o.artifacts, "artifacts").map((item, index) => artifact(item, `artifacts[${index}]`)), active_worktree: nullableString(o.active_worktree, "active_worktree"), target_branch: nullableString(o.target_branch, "target_branch"), base_commit: nullableString(o.base_commit, "base_commit"), current_commit: nullableString(o.current_commit, "current_commit"), session_references: duo(o.session_references, nullableString), session_modes: duo(o.session_modes, sessionMode), rotation_history: array(o.rotation_history, "rotation_history").map((item, index) => rotation(item, `rotation_history[${index}]`)), config: config(o.config) };
}
function validateWorkflowSessions(value) {
  const raw = record(value, "workflow sessions");
  if (raw.schema_version === 1) return legacySessions(raw);
  const o = raw;
  exact(o, ["schema_version", "job_id", "codex_thread_id", "opus_session_id", "opus_brief_hash", "modes", "rotation_history", "recorded_invocations", "usage", "updated_at"], "workflow sessions");
  return { schema_version: two(o.schema_version), job_id: id(o.job_id, "job_id"), codex_thread_id: nullableString(o.codex_thread_id, "codex_thread_id"), opus_session_id: nullableString(o.opus_session_id, "opus_session_id"), opus_brief_hash: nullableHash(o.opus_brief_hash, "opus_brief_hash"), modes: duo(o.modes, sessionMode), rotation_history: array(o.rotation_history, "rotation_history").map((item, index) => rotation(item, `rotation_history[${index}]`)), recorded_invocations: strings(o.recorded_invocations, "recorded_invocations").map((item) => id(item, "invocation_id")), usage: trio(o.usage, usage), updated_at: timestamp(o.updated_at, "updated_at") };
}
function config(value) {
  const o = record(value, "workflow config");
  exact(o, ["fable_total_cap", "max_input_bytes", "max_output_bytes", "passport_max_bytes", "profiles"], "workflow config");
  return { fable_total_cap: enumeration(o.fable_total_cap, [0, 1], "fable_total_cap"), max_input_bytes: integer(o.max_input_bytes, "max_input_bytes", 1), max_output_bytes: integer(o.max_output_bytes, "max_output_bytes", 1), passport_max_bytes: integer(o.passport_max_bytes, "passport_max_bytes", 1), profiles: trio(o.profiles, profile) };
}
function profile(value, label) {
  const o = record(value, label);
  exact(o, ["model", "effort", "max_turns", "timeout_ms", "permission_mode"], label);
  return { model: nonEmpty(o.model, `${label}.model`), effort: enumeration(o.effort, ["low", "medium", "high"], `${label}.effort`), max_turns: integer(o.max_turns, `${label}.max_turns`, 1), timeout_ms: integer(o.timeout_ms, `${label}.timeout_ms`, 1), permission_mode: enumeration(o.permission_mode, ["read_only", "worktree"], `${label}.permission_mode`) };
}
function artifact(value, label) {
  const o = record(value, label);
  exact(o, ["filename", "hash", "phase", "revision", "iteration", "role"], label);
  const filename = nonEmpty(o.filename, `${label}.filename`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) throw new Error(`${label}.filename is invalid`);
  return { filename, hash: hash(o.hash, `${label}.hash`), phase: phase(o.phase), revision: integer(o.revision, `${label}.revision`, 1), iteration: integer(o.iteration, `${label}.iteration`, 1), role: enumeration(o.role, ["codex", "fable", "opus", "orchestrator"], `${label}.role`) };
}
function decision(value, label) {
  const o = record(value, label);
  exact(o, ["invocation_id", "action", "summary", "provenance", "timestamp"], label);
  return { invocation_id: id(o.invocation_id, `${label}.invocation_id`), action: nonEmpty(o.action, `${label}.action`), summary: nonEmpty(o.summary, `${label}.summary`), provenance: enumeration(o.provenance, ["codex"], `${label}.provenance`), timestamp: timestamp(o.timestamp, `${label}.timestamp`) };
}
function rotation(value, label) {
  const o = record(value, label);
  exact(o, ["role", "previous_id", "next_id", "reason", "timestamp"], label);
  return { role: enumeration(o.role, ["codex", "opus"], `${label}.role`), previous_id: nullableString(o.previous_id, `${label}.previous_id`), next_id: nullableString(o.next_id, `${label}.next_id`), reason: nonEmpty(o.reason, `${label}.reason`), timestamp: timestamp(o.timestamp, `${label}.timestamp`) };
}
function usage(value, label) {
  const o = record(value, label);
  exact(o, ["calls", "input_chars", "output_chars", "input_tokens", "output_tokens", "estimated_tokens", "cache_read", "cache_write", "duration_ms", "failed_calls", "resumes", "compactions"], label);
  return Object.fromEntries(Object.keys(o).map((key) => [key, integer(o[key], `${label}.${key}`, 0)]));
}
function duo(value, validate) {
  const o = record(value, "role record");
  exact(o, ["codex", "opus"], "role record");
  return { codex: validate(o.codex, "codex"), opus: validate(o.opus, "opus") };
}
function trio(value, validate) {
  const o = record(value, "role record");
  exact(o, ["codex", "fable", "opus"], "role record");
  return { codex: validate(o.codex, "codex"), fable: validate(o.fable, "fable"), opus: validate(o.opus, "opus") };
}
function sessionMode(value, label) {
  return enumeration(value, MODES, label);
}
function phase(value) {
  return enumeration(value, PHASES, "phase");
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function exact(value, keys, label) {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) throw new Error(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${label} contains unknown field ${key}`);
}
function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function strings(value, label) {
  return array(value, label).map((item, index) => string(item, `${label}[${index}]`));
}
function string(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function nonEmpty(value, label) {
  const result = string(value, label);
  if (!result.trim()) throw new Error(`${label} must not be empty`);
  return result;
}
function nullableString(value, label) {
  return value === null ? null : string(value, label);
}
function hash(value, label) {
  const result = string(value, label);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label} must be a SHA-256 hash`);
  return result;
}
function nullableHash(value, label) {
  return value === null ? null : hash(value, label);
}
function integer(value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return value;
}
function timestamp(value, label) {
  const result = string(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be a timestamp`);
  return result;
}
function id(value, label) {
  const result = nonEmpty(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) throw new Error(`${label} is invalid`);
  return result;
}
function two(value) {
  if (value !== 2) throw new Error("Unsupported workflow schema version");
  return 2;
}
function enumeration(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} has an invalid value`);
  return value;
}
function legacyJob(o) {
  const terminal = o.phase === "done" || o.phase === "cancelled" || o.phase === "failed" ? o.phase : "blocked";
  const now = typeof o.updated_at === "string" ? o.updated_at : (/* @__PURE__ */ new Date(0)).toISOString();
  return { schema_version: 2, job_id: id(o.job_id, "job_id"), mode: "adaptive", phase: terminal, resume_phase: null, revision: Number(o.revision) || 1, artifact_revision: Number(o.artifact_revision) || 0, latest_artifact_hash: typeof o.latest_artifact_hash === "string" ? o.latest_artifact_hash : null, opus_iteration: Number(o.opus_iteration) || 1, fix_cycles: Number(o.fix_cycles) || 0, fable_calls: Number(o.fable_total_calls) || 0, consultation_status: "skipped", consultation_origin: null, branch: stringOrNull(o.branch), worktree: stringOrNull(o.worktree), target_branch: stringOrNull(o.target_branch), base_commit: stringOrNull(o.base_commit), current_commit: stringOrNull(o.current_commit), reviewed_diff_hash: stringOrNull(o.reviewed_diff_hash), accepted_brief_hash: null, last_action: null, blocker: terminal === "blocked" ? "LEGACY_SCHEMA: start a new workflow; v1 execution cannot be resumed safely" : stringOrNull(o.blocker), next_action: terminal === "blocked" ? "Start a new adaptive or direct workflow" : String(o.next_action ?? "No further action"), current_operation: null, created_at: typeof o.created_at === "string" ? o.created_at : now, updated_at: now };
}
function legacyPassport(o) {
  const jobId = id(o.job_id, "job_id");
  return { schema_version: 2, passport_revision: Number(o.passport_revision) || 1, job_id: jobId, mode: "adaptive", current_revision: Number(o.current_revision) || 1, objective: String(o.objective ?? "Legacy workflow"), current_phase: "blocked", accepted_brief_hash: null, latest_implementation_brief: null, hard_constraints: Array.isArray(o.hard_constraints) ? o.hard_constraints.map(String) : [], acceptance_criteria: Array.isArray(o.acceptance_criteria) ? o.acceptance_criteria.map(String) : [], decisions: [], allowed_file_scope: Array.isArray(o.allowed_file_scope) ? o.allowed_file_scope.map(String) : [], required_checks: Array.isArray(o.required_checks) ? o.required_checks.map(String) : [], current_blockers: ["LEGACY_SCHEMA: v1 workflow is inspectable but not resumable"], next_action: "Start a new workflow", artifacts: [], active_worktree: stringOrNull(o.active_worktree), target_branch: stringOrNull(o.target_branch), base_commit: stringOrNull(o.base_commit), current_commit: stringOrNull(o.current_commit), session_references: { codex: null, opus: null }, session_modes: { codex: "none", opus: "none" }, rotation_history: [], config: legacyConfig(o.config) };
}
function legacySessions(o) {
  const empty = zeroUsage();
  const oldUsage = o.usage && typeof o.usage === "object" ? o.usage : {};
  return { schema_version: 2, job_id: id(o.job_id, "job_id"), codex_thread_id: stringOrNull(o.codex_thread_id), opus_session_id: stringOrNull(o.opus_session_id), opus_brief_hash: null, modes: { codex: "none", opus: "none" }, rotation_history: [], recorded_invocations: Array.isArray(o.recorded_invocations) ? o.recorded_invocations.map(String) : [], usage: { codex: oldUsage.codex ?? empty, fable: oldUsage.fable ?? empty, opus: oldUsage.opus ?? empty }, updated_at: typeof o.updated_at === "string" ? o.updated_at : (/* @__PURE__ */ new Date(0)).toISOString() };
}
function legacyConfig(value) {
  const o = value && typeof value === "object" ? value : {};
  const defaults = { fable: { model: "fable", effort: "low", max_turns: 1, timeout_ms: 3e5, permission_mode: "read_only" }, opus: { model: "opus", effort: "high", max_turns: 50, timeout_ms: 18e5, permission_mode: "worktree" }, codex: { model: "codex", effort: "medium", max_turns: 1, timeout_ms: 6e5, permission_mode: "read_only" } };
  return { fable_total_cap: 1, max_input_bytes: Number(o.max_input_bytes) || 128e3, max_output_bytes: Number(o.max_output_bytes) || 64e3, passport_max_bytes: Number(o.passport_max_bytes) || 64e3, profiles: o.profiles && typeof o.profiles === "object" ? o.profiles : defaults };
}
function zeroUsage() {
  return { calls: 0, input_chars: 0, output_chars: 0, input_tokens: 0, output_tokens: 0, estimated_tokens: 0, cache_read: 0, cache_write: 0, duration_ms: 0, failed_calls: 0, resumes: 0, compactions: 0 };
}
function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

// src/infrastructure/workflow/artifact-store.ts
var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var SHA256 = /^[a-f0-9]{64}$/;
var FORBIDDEN_FIELD = /^(?:env|environment|credentials?|private[_-]?key|privatekey|pem|api[_-]?key|password|passwd|secret|token)$/i;
var ARTIFACT_FILES = {
  codex_decision: "codex-decision-r%REV%-i%ITER%-a%SEQ%.json",
  opus_instruction: "opus-instruction-r%REV%-i%ITER%-a%SEQ%.md",
  fable_request: "fable-request-r%REV%-i%ITER%-a%SEQ%.json",
  fable_advice: "fable-advice-r%REV%-i%ITER%-a%SEQ%.json",
  routing_decision: "routing-decision-r%REV%-i%ITER%-a%SEQ%.json",
  opus_report: "opus-report-r%REV%-i%ITER%-a%SEQ%.json",
  opus_diff: "opus-r%REV%-i%ITER%-a%SEQ%.diff",
  test_results: "test-results-r%REV%-i%ITER%-a%SEQ%.json"
};
var WorkflowArtifactStore = class {
  root;
  constructor(projectRoot) {
    this.root = path.join(projectRoot, ".orchestry", "workflows");
  }
  async createJob(job, passport, sessions) {
    const validatedJob = validateWorkflowJob(job);
    const validatedPassport = validateWorkflowPassport(passport);
    const validatedSessions = validateWorkflowSessions(sessions);
    const id2 = safeId(validatedJob.job_id);
    if (validatedPassport.job_id !== id2 || validatedSessions.job_id !== id2) throw new Error("Workflow job_id mismatch");
    if (Buffer.byteLength(JSON.stringify(validatedPassport)) > validatedPassport.config.passport_max_bytes) throw new Error("Workflow passport exceeded configured maximum");
    await this.secureDir(id2);
    if (await this.readJob(id2)) throw new Error(`Workflow job already exists: ${id2}`);
    await Promise.all([this.write(this.file(id2, "job.json"), validatedJob), this.write(this.file(id2, "passport.json"), validatedPassport), this.write(this.file(id2, `passports/passport-${String(validatedPassport.passport_revision).padStart(6, "0")}.json`), validatedPassport), this.write(this.file(id2, "sessions.json"), validatedSessions)]);
  }
  async writeArtifact(input) {
    const id2 = safeId(input.job_id);
    return this.lock(id2, async () => {
      const job = await this.requiredJob(id2);
      if (!input.invocation_id) throw new Error("Artifact invocation_id is required");
      const prior = await this.artifactForInvocation(id2, input.name, input.invocation_id);
      if (prior) {
        if (job.artifact_revision < prior.metadata.revision) await this.write(this.file(id2, "job.json"), { ...job, artifact_revision: prior.metadata.revision, latest_artifact_hash: prior.metadata.artifact_hash, updated_at: prior.metadata.timestamp });
        return prior;
      }
      if (input.revision !== job.artifact_revision + 1) throw new Error(`Stale artifact revision: expected ${job.artifact_revision + 1}, received ${input.revision}`);
      if (input.parent_artifact_hash !== job.latest_artifact_hash) throw new Error("Stale parent_artifact_hash");
      if (input.parent_artifact_hash !== null && !SHA256.test(input.parent_artifact_hash)) throw new Error("Invalid parent_artifact_hash");
      if (job.phase !== input.phase) throw new Error(`Artifact phase ${input.phase} does not match job phase ${job.phase}`);
      const payload = input.validate(removeForbidden(input.payload));
      const timestamp2 = iso(input.timestamp ?? (/* @__PURE__ */ new Date()).toISOString());
      const artifactHash = hashCanonical(payload);
      const filename = artifactFilename(input.name, job.revision, job.opus_iteration, input.revision);
      const stored = { metadata: { schema_version: 2, job_id: id2, artifact_name: input.name, filename, phase: input.phase, workflow_revision: job.revision, iteration: job.opus_iteration, revision: input.revision, invocation_id: input.invocation_id, producing_role: input.producing_role, parent_artifact_hash: input.parent_artifact_hash, timestamp: timestamp2, artifact_hash: artifactHash }, payload };
      const file = path.join(this.root, id2, "artifacts", filename);
      try {
        await fs.access(file);
        throw new Error(`Refusing to overwrite immutable artifact: ${filename}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await this.write(file, stored);
      await this.write(this.file(id2, "job.json"), { ...job, artifact_revision: input.revision, latest_artifact_hash: artifactHash, updated_at: timestamp2 });
      return stored;
    });
  }
  async writeTextArtifact(input) {
    return this.writeArtifact({ ...input, validate: (value) => {
      if (typeof value !== "string" || !value.trim()) throw new Error(`${input.name} must be non-empty text`);
      return sanitizeText(value);
    } });
  }
  async readArtifact(jobId, name, workflowRevision) {
    const id2 = safeId(jobId);
    const job = await this.requiredJob(id2);
    const value = await this.latestArtifact(id2, name, workflowRevision ?? job.revision);
    if (!value) return null;
    if (value.metadata.job_id !== id2 || hashCanonical(value.payload) !== value.metadata.artifact_hash) throw new Error("Workflow artifact integrity check failed");
    return value;
  }
  async readTextArtifact(jobId, name, workflowRevision) {
    const value = await this.readArtifact(jobId, name, workflowRevision);
    if (value && typeof value.payload !== "string") throw new Error("Workflow text artifact is not text");
    return value;
  }
  async transition(jobId, next, patch = {}) {
    const id2 = safeId(jobId);
    return this.lock(id2, async () => {
      const job = await this.requiredJob(id2);
      if (!canTransitionWorkflow(job.phase, next)) throw new Error(`Invalid workflow phase transition: ${job.phase} -> ${next}`);
      const updated = validateWorkflowJob({ ...job, ...patch, schema_version: 2, job_id: id2, phase: next, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
      await this.write(this.file(id2, "job.json"), updated);
      return updated;
    });
  }
  async commitTransition(jobId, next, patch, passportPatch) {
    const id2 = safeId(jobId);
    return this.lock(id2, async () => {
      await this.recoverTransition(id2);
      const job = await this.requiredJob(id2);
      const passport = await this.readPassport(id2);
      if (!passport) throw new Error(`Workflow passport not found: ${id2}`);
      if (!canTransitionWorkflow(job.phase, next)) throw new Error(`Invalid workflow phase transition: ${job.phase} -> ${next}`);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const updatedJob = validateWorkflowJob({ ...job, ...patch, schema_version: 2, job_id: id2, phase: next, updated_at: now });
      const updatedPassport = validateWorkflowPassport({ ...passport, ...passportPatch, schema_version: 2, job_id: id2, passport_revision: passport.passport_revision + 1, current_phase: next, current_revision: updatedJob.revision, next_action: updatedJob.next_action, current_blockers: updatedJob.blocker ? [updatedJob.blocker] : [] });
      if (Buffer.byteLength(JSON.stringify(updatedPassport)) > updatedPassport.config.passport_max_bytes) throw new Error("Workflow passport exceeded configured maximum");
      const event = { schema_version: 2, job_id: id2, type: "phase_changed", timestamp: now, data: { transition_id: `transition-${updatedPassport.passport_revision}`, from: job.phase, to: next } };
      const journal = { job: updatedJob, passport: updatedPassport, event };
      await this.write(this.file(id2, "transition.pending.json"), journal);
      await this.applyTransition(id2, journal);
      return updatedJob;
    });
  }
  async patchJob(jobId, patch) {
    const id2 = safeId(jobId);
    return this.lock(id2, async () => {
      const job = await this.requiredJob(id2);
      const updated = validateWorkflowJob({ ...job, ...patch, schema_version: 2, job_id: id2, phase: job.phase, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
      await this.write(this.file(id2, "job.json"), updated);
      return updated;
    });
  }
  async reserveOperation(jobId, phase2, operation) {
    const id2 = safeId(jobId);
    return this.lock(id2, async () => {
      const job = await this.requiredJob(id2);
      if (job.phase !== phase2 || job.current_operation !== null) return false;
      const updated = validateWorkflowJob({ ...job, current_operation: operation, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
      await this.write(this.file(id2, "job.json"), updated);
      return true;
    });
  }
  async readJob(jobId) {
    const id2 = safeId(jobId);
    await this.recoverTransition(id2);
    const value = await readJson(this.file(id2, "job.json"));
    return value === null ? null : validateWorkflowJob(value);
  }
  async readPassport(jobId) {
    const id2 = safeId(jobId);
    const value = await readJson(this.file(id2, "passport.json"));
    return value === null ? null : validateWorkflowPassport(value);
  }
  async writePassport(value) {
    const validated = validateWorkflowPassport(value);
    const id2 = safeId(validated.job_id);
    if (Buffer.byteLength(JSON.stringify(validated)) > validated.config.passport_max_bytes) throw new Error("Workflow passport exceeded configured maximum");
    await this.lock(id2, async () => {
      const current = await this.readPassport(id2);
      if (current && validated.passport_revision !== current.passport_revision + 1) throw new Error(`Stale passport revision: expected ${current.passport_revision + 1}, received ${validated.passport_revision}`);
      const snapshot = this.file(id2, `passports/passport-${String(validated.passport_revision).padStart(6, "0")}.json`);
      try {
        await fs.access(snapshot);
        throw new Error(`Refusing to overwrite passport revision ${validated.passport_revision}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await this.write(snapshot, validated);
      await this.write(this.file(id2, "passport.json"), validated);
    });
  }
  async readSessions(jobId) {
    const id2 = safeId(jobId);
    const value = await readJson(this.file(id2, "sessions.json"));
    return value === null ? null : validateWorkflowSessions(value);
  }
  async writeSessions(value) {
    const validated = validateWorkflowSessions(value);
    safeId(validated.job_id);
    await this.requiredJob(validated.job_id);
    await this.write(this.file(validated.job_id, "sessions.json"), validated);
  }
  async appendEvent(event) {
    const id2 = safeId(event.job_id);
    await this.requiredJob(id2);
    await appendJsonl(this.file(id2, "events.jsonl"), { ...event, data: removeForbidden(event.data) });
    await fs.chmod(this.file(id2, "events.jsonl"), 384).catch(() => {
    });
  }
  async readEvents(jobId) {
    return readJsonl(this.file(safeId(jobId), "events.jsonl"));
  }
  async writeInvocationReceipt(value) {
    const id2 = safeId(value.job_id);
    const file = this.file(id2, `invocations/${safeId(value.invocation_id)}.json`);
    await this.lock(id2, async () => {
      const prior = await readJson(file);
      if (prior) {
        if (canonicalJson(prior) !== canonicalJson(value)) throw new Error("Conflicting invocation receipt already exists");
        return;
      }
      await this.write(file, value);
    });
  }
  async readInvocationReceipt(jobId, invocationId) {
    const value = await readJson(this.file(safeId(jobId), `invocations/${safeId(invocationId)}.json`));
    if (!value) return null;
    if (value.schema_version !== 2 || value.job_id !== jobId || value.invocation_id !== invocationId || !SHA256.test(value.request_hash) || !Number.isSafeInteger(value.workflow_revision)) throw new Error("Invalid invocation receipt");
    return value;
  }
  async listJobs() {
    let entries;
    try {
      entries = await fs.readdir(this.root);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const jobs = (await Promise.all(entries.map((id2) => SAFE_ID.test(id2) ? this.readJob(id2) : null))).filter((job) => job !== null);
    return jobs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  artifactPath(jobId, name, revision) {
    return path.join(this.root, safeId(jobId), "artifacts", artifactFilename(name, revision, 0, 0));
  }
  async requiredJob(id2) {
    const job = await this.readJob(id2);
    if (!job) throw new Error(`Workflow job not found: ${id2}`);
    return job;
  }
  file(id2, name) {
    return path.join(this.root, safeId(id2), name);
  }
  async latestArtifact(id2, name, workflowRevision) {
    const dir = this.file(id2, "artifacts");
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    let latest = null;
    for (const entry of entries) {
      const value = await readJson(path.join(dir, entry));
      if (value?.metadata.artifact_name === name && value.metadata.workflow_revision === workflowRevision && (!latest || value.metadata.revision > latest.metadata.revision)) latest = value;
    }
    return latest;
  }
  async artifactForInvocation(id2, name, invocationId) {
    const dir = this.file(id2, "artifacts");
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    for (const entry of entries) {
      const value = await readJson(path.join(dir, entry));
      if (value?.metadata.artifact_name === name && value.metadata.invocation_id === invocationId) return value;
    }
    return null;
  }
  async write(file, value) {
    await atomicWrite(file, canonicalJson(removeForbidden(value)) + "\n");
  }
  async recoverTransition(id2) {
    const journal = await readJson(this.file(id2, "transition.pending.json"));
    if (journal) await this.applyTransition(id2, journal);
  }
  async applyTransition(id2, journal) {
    const snapshot = this.file(id2, `passports/passport-${String(journal.passport.passport_revision).padStart(6, "0")}.json`);
    if (!await readJson(snapshot)) await this.write(snapshot, journal.passport);
    await this.write(this.file(id2, "passport.json"), journal.passport);
    await this.write(this.file(id2, "job.json"), journal.job);
    const events = await readJsonl(this.file(id2, "events.jsonl"));
    const transitionId = journal.event.data.transition_id;
    if (!events.some((event) => event.data?.transition_id === transitionId)) await appendJsonl(this.file(id2, "events.jsonl"), journal.event);
    await fs.rm(this.file(id2, "transition.pending.json"), { force: true });
  }
  async secureDir(id2) {
    const dir = this.file(id2, "");
    await Promise.all([ensureDir(path.join(dir, "artifacts")), ensureDir(path.join(dir, "passports")), ensureDir(path.join(dir, "invocations"))]);
    await Promise.all([fs.chmod(this.root, 448).catch(() => {
    }), fs.chmod(dir, 448), fs.chmod(path.join(dir, "artifacts"), 448), fs.chmod(path.join(dir, "passports"), 448), fs.chmod(path.join(dir, "invocations"), 448)]);
  }
  async lock(id2, fn) {
    await this.secureDir(id2);
    const lock = this.file(id2, ".workflow.lock");
    const deadline = Date.now() + 5e3;
    while (true) {
      try {
        await fs.mkdir(lock, { mode: 448 });
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        const stat = await fs.stat(lock).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 3e4) {
          await fs.rm(lock, { recursive: true, force: true });
          continue;
        }
        if (Date.now() > deadline) throw new Error(`Workflow lock is active: ${id2}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(lock, { recursive: true, force: true });
    }
  }
};
function artifactReference(_name, stored) {
  return { filename: stored.metadata.filename, hash: stored.metadata.artifact_hash, phase: stored.metadata.phase, revision: stored.metadata.revision, iteration: stored.metadata.iteration, role: stored.metadata.producing_role };
}
function hashCanonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
function removeForbidden(value) {
  const safe = sanitizeForPersistence(value);
  if (Array.isArray(safe)) return safe.map(removeForbidden);
  if (safe && typeof safe === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(safe)) if (!FORBIDDEN_FIELD.test(key)) out[key] = removeForbidden(nested);
    return out;
  }
  return safe;
}
function safeId(value) {
  if (!SAFE_ID.test(value) || value === "." || value === "..") throw new Error(`Invalid workflow job id: ${value}`);
  return value;
}
function iso(value) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
  return value;
}
function artifactFilename(name, workflowRevision, iteration, sequence) {
  return ARTIFACT_FILES[name].replace("%REV%", String(workflowRevision).padStart(3, "0")).replace("%ITER%", String(iteration).padStart(3, "0")).replace("%SEQ%", String(sequence).padStart(6, "0"));
}

export { ARTIFACT_FILES, WORKFLOW_PHASE_TRANSITIONS, WorkflowArtifactStore, artifactReference, canTransitionWorkflow, hashCanonical, isTerminalWorkflowPhase, transitionWorkflow };
//# sourceMappingURL=chunk-VBS3B32E.js.map
//# sourceMappingURL=chunk-VBS3B32E.js.map