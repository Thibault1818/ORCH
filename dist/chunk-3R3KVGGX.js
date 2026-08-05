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
var SEMANTIC_ROLES = ["supervisor", "implementer", "adviser", "reviewer"];
var ROLE_PERMISSIONS = Object.freeze({
  supervisor: Object.freeze({ workspace: "read_only", tools: "enabled", advisory_only: false }),
  implementer: Object.freeze({ workspace: "worktree", tools: "enabled", advisory_only: false }),
  adviser: Object.freeze({ workspace: "read_only", tools: "none", advisory_only: true }),
  reviewer: Object.freeze({ workspace: "read_only", tools: "enabled", advisory_only: false })
});
function createRosterSnapshot(input, mode = "adaptive") {
  return validateRosterSnapshot({
    schema_version: 1,
    supervisor: input.supervisor,
    implementer: input.implementer,
    adviser: input.adviser ?? null,
    reviewer: input.reviewer ?? { same_as: "supervisor" }
  }, mode);
}
function legacyRosterSnapshot(mode) {
  return createRosterSnapshot({
    supervisor: { adapter: "codex", profile: { name: "codex", model: "codex", effort: "medium", max_turns: 1, timeout_ms: 6e5 } },
    implementer: { adapter: "claude", profile: { name: "opus", model: "opus", effort: "high", max_turns: 50, timeout_ms: 18e5 } },
    adviser: mode === "adaptive" ? { adapter: "fable", profile: { name: "fable", model: "fable", effort: "low", max_turns: 1, timeout_ms: 3e5 } } : null
  }, mode);
}
function validateRosterSnapshot(value, mode) {
  const roster = object(value, "workflow roster");
  exact(roster, ["schema_version", "supervisor", "implementer", "adviser", "reviewer"], "workflow roster");
  if (roster.schema_version !== 1) throw new Error("Unsupported workflow roster schema version");
  const adviser = roster.adviser === null ? null : agent(roster.adviser, "workflow roster.adviser");
  if (mode === "direct" && adviser !== null) throw new Error("Direct workflow roster cannot include an adviser");
  return {
    schema_version: 1,
    supervisor: agent(roster.supervisor, "workflow roster.supervisor"),
    implementer: agent(roster.implementer, "workflow roster.implementer"),
    adviser,
    reviewer: reviewer(roster.reviewer)
  };
}
function hashRosterSnapshot(value) {
  const roster = validateRosterSnapshot(value);
  return createHash("sha256").update(canonicalJson(roster)).digest("hex");
}
function validateRosterAgent(value, label = "workflow roster agent") {
  return agent(value, label);
}
function hashRosterAgent(value) {
  return createHash("sha256").update(canonicalJson(validateRosterAgent(value))).digest("hex");
}
function reviewer(value) {
  const item = object(value, "workflow roster.reviewer");
  if ("same_as" in item) {
    exact(item, ["same_as"], "workflow roster.reviewer");
    if (item.same_as !== "supervisor") throw new Error("workflow roster.reviewer.same_as must be supervisor");
    return { same_as: "supervisor" };
  }
  return agent(item, "workflow roster.reviewer");
}
function agent(value, label) {
  const item = object(value, label);
  exact(item, ["adapter", "profile"], label);
  const profile2 = object(item.profile, `${label}.profile`);
  exact(profile2, ["name", "model", "effort", "max_turns", "timeout_ms"], `${label}.profile`);
  if (!["low", "medium", "high"].includes(profile2.effort)) throw new Error(`${label}.profile.effort is invalid`);
  if (!Number.isSafeInteger(profile2.max_turns) || profile2.max_turns < 1) throw new Error(`${label}.profile.max_turns is invalid`);
  if (!Number.isSafeInteger(profile2.timeout_ms) || profile2.timeout_ms < 1) throw new Error(`${label}.profile.timeout_ms is invalid`);
  return { adapter: identifier(item.adapter, `${label}.adapter`), profile: { name: identifier(profile2.name, `${label}.profile.name`), model: model(profile2.model, `${label}.profile.model`), effort: profile2.effort, max_turns: profile2.max_turns, timeout_ms: profile2.timeout_ms } };
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function exact(value, keys, label) {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) throw new Error(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${label} contains unknown field ${key}`);
}
function identifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}
function model(value, label) {
  if (value === "") return value;
  return identifier(value, label);
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const item = value;
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(",")}}`;
}

// src/domain/workflow/validation.ts
var PHASES = Object.keys(WORKFLOW_PHASE_TRANSITIONS);
var MODES = ["new", "native_resume", "passport_handoff", "none"];
function validateWorkflowJob(value) {
  const raw = record(value, "workflow job");
  if (raw.schema_version === 1) return legacyJob(raw);
  const o = raw;
  exact2(o, ["schema_version", "job_id", "mode", "phase", "resume_phase", "revision", "artifact_revision", "latest_artifact_hash", "opus_iteration", "fix_cycles", "fable_calls", "consultation_status", "consultation_origin", "branch", "worktree", "target_branch", "base_commit", "current_commit", "reviewed_diff_hash", "accepted_brief_hash", "last_action", "blocker", "next_action", "current_operation", "created_at", "updated_at"], "workflow job");
  const operation = o.current_operation === null ? null : (() => {
    const p = record(o.current_operation, "current_operation");
    exact2(p, ["phase", "invocation_id", "started_at", "retry_count"], "current_operation");
    return { phase: phase(p.phase), invocation_id: id(p.invocation_id, "invocation_id"), started_at: timestamp(p.started_at, "started_at"), retry_count: integer(p.retry_count, "retry_count", 0) };
  })();
  return { schema_version: two(o.schema_version), job_id: id(o.job_id, "job_id"), mode: enumeration(o.mode, ["adaptive", "direct"], "mode"), phase: phase(o.phase), resume_phase: o.resume_phase === null ? null : phase(o.resume_phase), revision: integer(o.revision, "revision", 1), artifact_revision: integer(o.artifact_revision, "artifact_revision", 0), latest_artifact_hash: nullableHash(o.latest_artifact_hash, "latest_artifact_hash"), opus_iteration: integer(o.opus_iteration, "opus_iteration", 1), fix_cycles: integer(o.fix_cycles, "fix_cycles", 0), fable_calls: integer(o.fable_calls, "fable_calls", 0), consultation_status: enumeration(o.consultation_status, ["unused", "requested", "attempt_started", "result_persisted", "skipped", "fallback_executed"], "consultation_status"), consultation_origin: o.consultation_origin === null ? null : enumeration(o.consultation_origin, ["pre_opus", "post_opus"], "consultation_origin"), branch: nullableString(o.branch, "branch"), worktree: nullableString(o.worktree, "worktree"), target_branch: nullableString(o.target_branch, "target_branch"), base_commit: nullableString(o.base_commit, "base_commit"), current_commit: nullableString(o.current_commit, "current_commit"), reviewed_diff_hash: nullableHash(o.reviewed_diff_hash, "reviewed_diff_hash"), accepted_brief_hash: nullableHash(o.accepted_brief_hash, "accepted_brief_hash"), last_action: nullableString(o.last_action, "last_action"), blocker: nullableString(o.blocker, "blocker"), next_action: string(o.next_action, "next_action"), current_operation: operation, created_at: timestamp(o.created_at, "created_at"), updated_at: timestamp(o.updated_at, "updated_at") };
}
function validateWorkflowPassport(value) {
  const raw = record(value, "workflow passport");
  if (raw.schema_version === 1) return legacyPassport(raw);
  const o = raw;
  exactOptional(o, ["schema_version", "passport_revision", "job_id", "mode", "current_revision", "objective", "current_phase", "accepted_brief_hash", "latest_implementation_brief", "hard_constraints", "acceptance_criteria", "decisions", "allowed_file_scope", "required_checks", "current_blockers", "next_action", "artifacts", "active_worktree", "target_branch", "base_commit", "current_commit", "session_references", "session_modes", "rotation_history", "config"], ["roster", "roster_hash", "active_roster", "active_roster_hash", "roster_revision", "binding_rotation_history"], "workflow passport");
  const mode = enumeration(o.mode, ["adaptive", "direct"], "mode");
  if ("roster" in o !== "roster_hash" in o) throw new Error("workflow passport roster and roster_hash must be provided together");
  const roster = "roster" in o ? validateRosterSnapshot(o.roster, mode) : legacyRosterFromConfig(mode, o.config);
  const rosterHash = hashRosterSnapshot(roster);
  if ("roster_hash" in o && hash(o.roster_hash, "roster_hash") !== rosterHash) throw new Error("workflow passport roster_hash does not match roster");
  const activeFields = ["active_roster", "active_roster_hash", "roster_revision", "binding_rotation_history"];
  const activeCount = activeFields.filter((key) => key in o).length;
  if (activeCount !== 0 && activeCount !== activeFields.length) throw new Error("workflow passport active roster fields must be provided together");
  const activeRoster = activeCount ? validateRosterSnapshot(o.active_roster, mode) : roster;
  const activeRosterHash = hashRosterSnapshot(activeRoster);
  if (activeCount && hash(o.active_roster_hash, "active_roster_hash") !== activeRosterHash) throw new Error("workflow passport active_roster_hash does not match active_roster");
  const rosterRevision = activeCount ? integer(o.roster_revision, "roster_revision", 1) : 1;
  const bindingHistory = activeCount ? array(o.binding_rotation_history, "binding_rotation_history").map((item, index) => bindingRotation(item, `binding_rotation_history[${index}]`)) : [];
  if (bindingHistory.length !== rosterRevision - 1 || bindingHistory.some((item, index) => item.revision !== index + 2)) throw new Error("workflow passport binding rotation history does not match roster_revision");
  return { schema_version: two(o.schema_version), passport_revision: integer(o.passport_revision, "passport_revision", 1), job_id: id(o.job_id, "job_id"), mode, current_revision: integer(o.current_revision, "current_revision", 1), objective: nonEmpty(o.objective, "objective"), current_phase: phase(o.current_phase), accepted_brief_hash: nullableHash(o.accepted_brief_hash, "accepted_brief_hash"), latest_implementation_brief: o.latest_implementation_brief === null ? null : artifact(o.latest_implementation_brief, "latest_implementation_brief"), hard_constraints: strings(o.hard_constraints, "hard_constraints"), acceptance_criteria: strings(o.acceptance_criteria, "acceptance_criteria"), decisions: array(o.decisions, "decisions").map((item, index) => decision(item, `decisions[${index}]`)), allowed_file_scope: strings(o.allowed_file_scope, "allowed_file_scope"), required_checks: strings(o.required_checks, "required_checks"), current_blockers: strings(o.current_blockers, "current_blockers"), next_action: string(o.next_action, "next_action"), artifacts: array(o.artifacts, "artifacts").map((item, index) => artifact(item, `artifacts[${index}]`)), active_worktree: nullableString(o.active_worktree, "active_worktree"), target_branch: nullableString(o.target_branch, "target_branch"), base_commit: nullableString(o.base_commit, "base_commit"), current_commit: nullableString(o.current_commit, "current_commit"), session_references: duo(o.session_references, nullableString), session_modes: duo(o.session_modes, sessionMode), rotation_history: array(o.rotation_history, "rotation_history").map((item, index) => rotation(item, `rotation_history[${index}]`)), config: config(o.config), roster, roster_hash: rosterHash, active_roster: activeRoster, active_roster_hash: activeRosterHash, roster_revision: rosterRevision, binding_rotation_history: bindingHistory };
}
function validateWorkflowSessions(value) {
  const raw = record(value, "workflow sessions");
  if (raw.schema_version === 1) return legacySessions(raw);
  const o = raw;
  exact2(o, ["schema_version", "sessions_revision", "job_id", "codex_thread_id", "opus_session_id", "opus_brief_hash", "modes", "rotation_history", "recorded_invocations", "usage", "updated_at"], "workflow sessions");
  return { schema_version: two(o.schema_version), sessions_revision: integer(o.sessions_revision, "sessions_revision", 1), job_id: id(o.job_id, "job_id"), codex_thread_id: nullableString(o.codex_thread_id, "codex_thread_id"), opus_session_id: nullableString(o.opus_session_id, "opus_session_id"), opus_brief_hash: nullableHash(o.opus_brief_hash, "opus_brief_hash"), modes: duo(o.modes, sessionMode), rotation_history: array(o.rotation_history, "rotation_history").map((item, index) => rotation(item, `rotation_history[${index}]`)), recorded_invocations: strings(o.recorded_invocations, "recorded_invocations").map((item) => id(item, "invocation_id")), usage: trio(o.usage, usage), updated_at: timestamp(o.updated_at, "updated_at") };
}
function config(value) {
  const o = record(value, "workflow config");
  exact2(o, ["fable_total_cap", "max_input_bytes", "max_output_bytes", "passport_max_bytes", "profiles"], "workflow config");
  return { fable_total_cap: enumeration(o.fable_total_cap, [0, 1], "fable_total_cap"), max_input_bytes: integer(o.max_input_bytes, "max_input_bytes", 1), max_output_bytes: integer(o.max_output_bytes, "max_output_bytes", 1), passport_max_bytes: integer(o.passport_max_bytes, "passport_max_bytes", 1), profiles: trio(o.profiles, profile) };
}
function profile(value, label) {
  const o = record(value, label);
  exact2(o, ["model", "effort", "max_turns", "timeout_ms", "permission_mode"], label);
  return { model: model2(o.model, `${label}.model`), effort: enumeration(o.effort, ["low", "medium", "high"], `${label}.effort`), max_turns: integer(o.max_turns, `${label}.max_turns`, 1), timeout_ms: integer(o.timeout_ms, `${label}.timeout_ms`, 1), permission_mode: enumeration(o.permission_mode, ["read_only", "worktree"], `${label}.permission_mode`) };
}
function artifact(value, label) {
  const o = record(value, label);
  exact2(o, ["filename", "hash", "phase", "revision", "iteration", "role"], label);
  const filename = nonEmpty(o.filename, `${label}.filename`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) throw new Error(`${label}.filename is invalid`);
  return { filename, hash: hash(o.hash, `${label}.hash`), phase: phase(o.phase), revision: integer(o.revision, `${label}.revision`, 1), iteration: integer(o.iteration, `${label}.iteration`, 1), role: enumeration(o.role, ["codex", "fable", "opus", "orchestrator"], `${label}.role`) };
}
function decision(value, label) {
  const o = record(value, label);
  exact2(o, ["invocation_id", "action", "summary", "provenance", "timestamp", "fable_advice_disposition", "fable_error", "fable_iteration_effect"], label);
  return { invocation_id: id(o.invocation_id, `${label}.invocation_id`), action: nonEmpty(o.action, `${label}.action`), summary: nonEmpty(o.summary, `${label}.summary`), provenance: enumeration(o.provenance, ["codex"], `${label}.provenance`), timestamp: timestamp(o.timestamp, `${label}.timestamp`), fable_advice_disposition: o.fable_advice_disposition === null ? null : enumeration(o.fable_advice_disposition, ["accepted", "rejected"], `${label}.fable_advice_disposition`), fable_error: nullableString(o.fable_error, `${label}.fable_error`), fable_iteration_effect: o.fable_iteration_effect === null ? null : enumeration(o.fable_iteration_effect, ["avoided", "added", "unchanged"], `${label}.fable_iteration_effect`) };
}
function rotation(value, label) {
  const o = record(value, label);
  exact2(o, ["role", "previous_id", "next_id", "reason", "timestamp"], label);
  return { role: enumeration(o.role, ["codex", "opus"], `${label}.role`), previous_id: nullableString(o.previous_id, `${label}.previous_id`), next_id: nullableString(o.next_id, `${label}.next_id`), reason: nonEmpty(o.reason, `${label}.reason`), timestamp: timestamp(o.timestamp, `${label}.timestamp`) };
}
function bindingRotation(value, label) {
  const o = record(value, label);
  exact2(o, ["role", "previous_binding_hash", "new_binding_hash", "previous_binding", "new_binding", "reason", "timestamp", "revision"], label);
  const previous = o.previous_binding === null ? null : validateRosterAgent(o.previous_binding, `${label}.previous_binding`);
  const next = o.new_binding === null ? null : validateRosterAgent(o.new_binding, `${label}.new_binding`);
  const previousHash = nullableHash(o.previous_binding_hash, `${label}.previous_binding_hash`);
  const newHash = nullableHash(o.new_binding_hash, `${label}.new_binding_hash`);
  if ((previous ? hashRosterAgent(previous) : null) !== previousHash || (next ? hashRosterAgent(next) : null) !== newHash) throw new Error(`${label} binding hash does not match binding`);
  return { role: enumeration(o.role, ["supervisor", "implementer", "adviser", "reviewer"], `${label}.role`), previous_binding_hash: previousHash, new_binding_hash: newHash, previous_binding: previous, new_binding: next, reason: nonEmpty(o.reason, `${label}.reason`), timestamp: timestamp(o.timestamp, `${label}.timestamp`), revision: integer(o.revision, `${label}.revision`, 2) };
}
function usage(value, label) {
  const o = record(value, label);
  exact2(o, ["calls", "input_chars", "output_chars", "input_tokens", "output_tokens", "estimated_tokens", "cache_read", "cache_write", "duration_ms", "failed_calls", "resumes", "compactions"], label);
  return Object.fromEntries(Object.keys(o).map((key) => [key, integer(o[key], `${label}.${key}`, 0)]));
}
function duo(value, validate) {
  const o = record(value, "role record");
  exact2(o, ["codex", "opus"], "role record");
  return { codex: validate(o.codex, "codex"), opus: validate(o.opus, "opus") };
}
function trio(value, validate) {
  const o = record(value, "role record");
  exact2(o, ["codex", "fable", "opus"], "role record");
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
function exact2(value, keys, label) {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) throw new Error(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${label} contains unknown field ${key}`);
}
function exactOptional(value, required, optional, label) {
  const expected = /* @__PURE__ */ new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw new Error(`${label} is missing ${key}`);
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
function model2(value, label) {
  const result = string(value, label);
  if (result === "") return result;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(result)) throw new Error(`${label} is invalid`);
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
  const roster = legacyRosterSnapshot("adaptive");
  const rosterHash = hashRosterSnapshot(roster);
  return { schema_version: 2, passport_revision: Number(o.passport_revision) || 1, job_id: jobId, mode: "adaptive", current_revision: Number(o.current_revision) || 1, objective: String(o.objective ?? "Legacy workflow"), current_phase: "blocked", accepted_brief_hash: null, latest_implementation_brief: null, hard_constraints: Array.isArray(o.hard_constraints) ? o.hard_constraints.map(String) : [], acceptance_criteria: Array.isArray(o.acceptance_criteria) ? o.acceptance_criteria.map(String) : [], decisions: [], allowed_file_scope: Array.isArray(o.allowed_file_scope) ? o.allowed_file_scope.map(String) : [], required_checks: Array.isArray(o.required_checks) ? o.required_checks.map(String) : [], current_blockers: ["LEGACY_SCHEMA: v1 workflow is inspectable but not resumable"], next_action: "Start a new workflow", artifacts: [], active_worktree: stringOrNull(o.active_worktree), target_branch: stringOrNull(o.target_branch), base_commit: stringOrNull(o.base_commit), current_commit: stringOrNull(o.current_commit), session_references: { codex: null, opus: null }, session_modes: { codex: "none", opus: "none" }, rotation_history: [], config: legacyConfig(o.config), roster, roster_hash: rosterHash, active_roster: roster, active_roster_hash: rosterHash, roster_revision: 1, binding_rotation_history: [] };
}
function legacySessions(o) {
  const empty = zeroUsage();
  const oldUsage = o.usage && typeof o.usage === "object" ? o.usage : {};
  return { schema_version: 2, sessions_revision: 1, job_id: id(o.job_id, "job_id"), codex_thread_id: stringOrNull(o.codex_thread_id), opus_session_id: stringOrNull(o.opus_session_id), opus_brief_hash: null, modes: { codex: "none", opus: "none" }, rotation_history: [], recorded_invocations: Array.isArray(o.recorded_invocations) ? o.recorded_invocations.map(String) : [], usage: { codex: oldUsage.codex ?? empty, fable: oldUsage.fable ?? empty, opus: oldUsage.opus ?? empty }, updated_at: typeof o.updated_at === "string" ? o.updated_at : (/* @__PURE__ */ new Date(0)).toISOString() };
}
function legacyConfig(value) {
  const o = value && typeof value === "object" ? value : {};
  const defaults = { fable: { model: "fable", effort: "low", max_turns: 1, timeout_ms: 3e5, permission_mode: "read_only" }, opus: { model: "opus", effort: "high", max_turns: 50, timeout_ms: 18e5, permission_mode: "worktree" }, codex: { model: "codex", effort: "medium", max_turns: 1, timeout_ms: 6e5, permission_mode: "read_only" } };
  return { fable_total_cap: 1, max_input_bytes: Number(o.max_input_bytes) || 128e3, max_output_bytes: Number(o.max_output_bytes) || 64e3, passport_max_bytes: Number(o.passport_max_bytes) || 64e3, profiles: o.profiles && typeof o.profiles === "object" ? o.profiles : defaults };
}
function legacyRosterFromConfig(mode, value) {
  const c = config(value);
  const binding = (adapter, name) => ({ adapter, profile: { name, model: c.profiles[name].model, effort: c.profiles[name].effort, max_turns: c.profiles[name].max_turns, timeout_ms: c.profiles[name].timeout_ms } });
  return validateRosterSnapshot({ schema_version: 1, supervisor: binding("codex", "codex"), implementer: binding("claude", "opus"), adviser: mode === "adaptive" && c.fable_total_cap > 0 ? binding("fable", "fable") : null, reviewer: { same_as: "supervisor" } }, mode);
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
    if (validatedPassport.job_id !== id2 || validatedSessions.job_id !== id2)
      throw new Error("Workflow job_id mismatch");
    if (validatedPassport.roster_revision !== 1 || validatedPassport.binding_rotation_history.length !== 0 || validatedPassport.active_roster_hash !== validatedPassport.roster_hash || canonicalJson2(validatedPassport.active_roster) !== canonicalJson2(validatedPassport.roster))
      throw new Error(
        "New workflow must begin with the immutable initial roster as active revision 1"
      );
    if (Buffer.byteLength(JSON.stringify(validatedPassport)) > validatedPassport.config.passport_max_bytes)
      throw new Error("Workflow passport exceeded configured maximum");
    await this.secureDir(id2);
    if (await this.readJob(id2))
      throw new Error(`Workflow job already exists: ${id2}`);
    await Promise.all([
      this.write(this.file(id2, "job.json"), validatedJob),
      this.write(this.file(id2, "passport.json"), validatedPassport),
      this.write(
        this.file(
          id2,
          `passports/passport-${String(validatedPassport.passport_revision).padStart(6, "0")}.json`
        ),
        validatedPassport
      ),
      this.write(this.file(id2, "sessions.json"), validatedSessions)
    ]);
  }
  async writeArtifact(input) {
    const id2 = safeId(input.job_id);
    return this.lock(id2, async () => {
      const job = await this.requiredJob(id2);
      if (!input.invocation_id)
        throw new Error("Artifact invocation_id is required");
      const prior = await this.artifactForInvocation(
        id2,
        input.name,
        input.invocation_id
      );
      if (prior) {
        if (job.artifact_revision < prior.metadata.revision)
          await this.write(this.file(id2, "job.json"), {
            ...job,
            artifact_revision: prior.metadata.revision,
            latest_artifact_hash: prior.metadata.artifact_hash,
            updated_at: prior.metadata.timestamp
          });
        return prior;
      }
      if (input.revision !== job.artifact_revision + 1)
        throw new Error(
          `Stale artifact revision: expected ${job.artifact_revision + 1}, received ${input.revision}`
        );
      if (input.parent_artifact_hash !== job.latest_artifact_hash)
        throw new Error("Stale parent_artifact_hash");
      if (input.parent_artifact_hash !== null && !SHA256.test(input.parent_artifact_hash))
        throw new Error("Invalid parent_artifact_hash");
      if (job.phase !== input.phase)
        throw new Error(
          `Artifact phase ${input.phase} does not match job phase ${job.phase}`
        );
      const payload = input.validate(removeForbidden(input.payload));
      const timestamp2 = iso(input.timestamp ?? (/* @__PURE__ */ new Date()).toISOString());
      const artifactHash = hashCanonical(payload);
      const filename = artifactFilename(
        input.name,
        job.revision,
        job.opus_iteration,
        input.revision
      );
      const stored = {
        metadata: {
          schema_version: 2,
          job_id: id2,
          artifact_name: input.name,
          filename,
          phase: input.phase,
          workflow_revision: job.revision,
          iteration: job.opus_iteration,
          revision: input.revision,
          invocation_id: input.invocation_id,
          producing_role: input.producing_role,
          parent_artifact_hash: input.parent_artifact_hash,
          timestamp: timestamp2,
          artifact_hash: artifactHash
        },
        payload
      };
      const file = path.join(this.root, id2, "artifacts", filename);
      try {
        await fs.access(file);
        throw new Error(
          `Refusing to overwrite immutable artifact: ${filename}`
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await this.write(file, stored);
      await this.write(this.file(id2, "job.json"), {
        ...job,
        artifact_revision: input.revision,
        latest_artifact_hash: artifactHash,
        updated_at: timestamp2
      });
      return stored;
    });
  }
  async writeTextArtifact(input) {
    return this.writeArtifact({
      ...input,
      validate: (value) => {
        if (typeof value !== "string" || !value.trim())
          throw new Error(`${input.name} must be non-empty text`);
        return sanitizeText(value);
      }
    });
  }
  async readArtifact(jobId, name, workflowRevision) {
    const id2 = safeId(jobId);
    await this.requiredJob(id2);
    const value = await this.latestArtifact(id2, name, workflowRevision);
    if (!value) return null;
    if (value.metadata.job_id !== id2 || hashCanonical(value.payload) !== value.metadata.artifact_hash)
      throw new Error("Workflow artifact integrity check failed");
    return value;
  }
  async readTextArtifact(jobId, name, workflowRevision) {
    const value = await this.readArtifact(
      jobId,
      name,
      workflowRevision
    );
    if (value && typeof value.payload !== "string")
      throw new Error("Workflow text artifact is not text");
    return value;
  }
  async transition(jobId, next, patch = {}) {
    return this.commitTransition(jobId, next, patch, {});
  }
  async commitTransition(jobId, next, patch, passportPatch) {
    const id2 = safeId(jobId);
    return this.lock(id2, async () => {
      await this.recoverSessions(id2);
      await this.recoverPassport(id2);
      await this.recoverTransition(id2);
      const job = await this.requiredJob(id2);
      const passport = await this.readPassport(id2);
      if (!passport) throw new Error(`Workflow passport not found: ${id2}`);
      if (!canTransitionWorkflow(job.phase, next))
        throw new Error(
          `Invalid workflow phase transition: ${job.phase} -> ${next}`
        );
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const updatedJob = validateWorkflowJob({
        ...job,
        ...patch,
        schema_version: 2,
        job_id: id2,
        phase: next,
        revision: job.revision + 1,
        updated_at: now
      });
      const updatedPassport = validateWorkflowPassport({
        ...passport,
        ...passportPatch,
        schema_version: 2,
        job_id: id2,
        passport_revision: passport.passport_revision + 1,
        current_phase: next,
        current_revision: updatedJob.revision,
        next_action: updatedJob.next_action,
        current_blockers: updatedJob.blocker ? [updatedJob.blocker] : []
      });
      assertSameRoster(passport, updatedPassport);
      if (Buffer.byteLength(JSON.stringify(updatedPassport)) > updatedPassport.config.passport_max_bytes)
        throw new Error("Workflow passport exceeded configured maximum");
      const event = {
        schema_version: 2,
        job_id: id2,
        type: "phase_changed",
        timestamp: now,
        data: {
          transition_id: `transition-${updatedJob.revision}`,
          from: job.phase,
          to: next
        }
      };
      const journal = {
        job: updatedJob,
        passport: updatedPassport,
        event
      };
      await this.write(this.file(id2, "transition.pending.json"), journal);
      await this.applyTransition(id2, journal);
      return updatedJob;
    });
  }
  async patchJob(jobId, patch) {
    const id2 = safeId(jobId);
    return this.lock(id2, async () => {
      const job = await this.requiredJob(id2);
      const updated = validateWorkflowJob({
        ...job,
        ...patch,
        schema_version: 2,
        job_id: id2,
        phase: job.phase,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      await this.write(this.file(id2, "job.json"), updated);
      return updated;
    });
  }
  async reserveOperation(jobId, phase2, operation) {
    const id2 = safeId(jobId);
    return this.lock(id2, async () => {
      const job = await this.requiredJob(id2);
      if (job.phase !== phase2 || job.current_operation !== null) return false;
      const updated = validateWorkflowJob({
        ...job,
        current_operation: operation,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      await this.write(this.file(id2, "job.json"), updated);
      return true;
    });
  }
  async readJob(jobId) {
    const id2 = safeId(jobId);
    await this.recoverSessions(id2);
    await this.recoverTransition(id2);
    const value = await readJson(this.file(id2, "job.json"));
    return value === null ? null : validateWorkflowJob(value);
  }
  async readPassport(jobId) {
    const id2 = safeId(jobId);
    await this.recoverSessions(id2);
    await this.recoverPassport(id2);
    await this.recoverTransition(id2);
    const value = await readJson(this.file(id2, "passport.json"));
    return value === null ? null : validateWorkflowPassport(value);
  }
  async writePassport(value) {
    const validated = validateWorkflowPassport(value);
    const id2 = safeId(validated.job_id);
    if (Buffer.byteLength(JSON.stringify(validated)) > validated.config.passport_max_bytes)
      throw new Error("Workflow passport exceeded configured maximum");
    await this.lock(id2, async () => {
      await this.recoverPassport(id2);
      const current = await this.readPassport(id2);
      if (current) assertSameRoster(current, validated);
      if (current && validated.passport_revision !== current.passport_revision + 1)
        throw new Error(
          `Stale passport revision: expected ${current.passport_revision + 1}, received ${validated.passport_revision}`
        );
      const journal = { passport: validated };
      await this.write(this.file(id2, "passport.pending.json"), journal);
      await this.applyPassport(id2, journal);
    });
  }
  async readSessions(jobId) {
    const id2 = safeId(jobId);
    await this.recoverSessions(id2);
    const value = await readJson(this.file(id2, "sessions.json"));
    return value === null ? null : validateWorkflowSessions(value);
  }
  async writeSessions(value) {
    const validated = validateWorkflowSessions(value);
    const id2 = safeId(validated.job_id);
    await this.requiredJob(id2);
    await this.lock(id2, async () => {
      await this.recoverSessions(id2);
      const current = await readJson(this.file(id2, "sessions.json"));
      if (current && validated.sessions_revision !== validateWorkflowSessions(current).sessions_revision + 1)
        throw new Error("Stale sessions revision");
      const journal = {
        kind: "sessions",
        sessions: validated
      };
      await this.write(this.file(id2, "sessions.pending.json"), journal);
      await this.applySessions(id2, journal);
    });
  }
  async commitSessionsAndPassport(sessionsValue, passportValue) {
    return this.commitSessionsPassport(sessionsValue, passportValue, false);
  }
  async commitBindingRotation(sessionsValue, passportValue) {
    return this.commitSessionsPassport(sessionsValue, passportValue, true);
  }
  async appendEvent(event) {
    const id2 = safeId(event.job_id);
    await this.requiredJob(id2);
    await appendJsonl(this.file(id2, "events.jsonl"), {
      ...event,
      data: removeForbidden(event.data)
    });
    await fs.chmod(this.file(id2, "events.jsonl"), 384).catch(() => {
    });
  }
  async readEvents(jobId) {
    return readJsonl(this.file(safeId(jobId), "events.jsonl"));
  }
  async writeInvocationReceipt(value) {
    const id2 = safeId(value.job_id);
    const file = this.file(
      id2,
      `invocations/${safeId(value.invocation_id)}.json`
    );
    const request = removeForbidden(value.request);
    const result = removeForbidden(value.result);
    const normalized = {
      ...value,
      request,
      result,
      request_hash: hashCanonical(request),
      result_hash: hashCanonical(result)
    };
    await this.lock(id2, async () => {
      const prior = await readJson(file);
      if (prior) {
        if (canonicalJson2(prior) !== canonicalJson2(normalized))
          throw new Error("Conflicting invocation receipt already exists");
        return;
      }
      await this.write(file, normalized);
    });
  }
  async readInvocationReceipt(jobId, invocationId) {
    const value = await readJson(
      this.file(safeId(jobId), `invocations/${safeId(invocationId)}.json`)
    );
    if (!value) return null;
    if (value.schema_version !== 2 || value.job_id !== jobId || value.invocation_id !== invocationId || !SHA256.test(value.request_hash) || value.request_hash !== hashCanonical(value.request) || !SHA256.test(value.result_hash) || value.result_hash !== hashCanonical(value.result) || !Number.isSafeInteger(value.workflow_revision) || value.roster_revision !== void 0 && (!Number.isSafeInteger(value.roster_revision) || value.roster_revision < 1))
      throw new Error("Invalid invocation receipt");
    return value;
  }
  async readInvocationReceipts(jobId) {
    const id2 = safeId(jobId);
    const dir = this.file(id2, "invocations");
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const receipts = await Promise.all(
      entries.filter((entry) => entry.endsWith(".json")).map((entry) => this.readInvocationReceipt(id2, entry.slice(0, -5)))
    );
    return receipts.filter((value) => value !== null).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  async writeLlmAttempt(value) {
    const attempt = validateAttempt(value);
    const id2 = safeId(attempt.job_id);
    const file = this.file(
      id2,
      `attempts/${safeId(attempt.attempt_id)}-${attempt.status === "started" ? "started" : "terminal"}.json`
    );
    await this.lock(id2, async () => {
      const prior = await readJson(file);
      if (prior) {
        if (canonicalJson2(prior) !== canonicalJson2(attempt))
          throw new Error("Conflicting LLM attempt receipt already exists");
        return;
      }
      if (attempt.status !== "started") {
        const started = await readJson(
          this.file(id2, `attempts/${safeId(attempt.attempt_id)}-started.json`)
        );
        if (!started || started.status !== "started" || started.binding_hash !== attempt.binding_hash || started.semantic_role !== attempt.semantic_role || started.adapter !== attempt.adapter)
          throw new Error(
            "LLM attempt terminal receipt does not match its start"
          );
      }
      await this.write(file, attempt);
    });
  }
  async readLlmAttempts(jobId) {
    const id2 = safeId(jobId);
    const dir = this.file(id2, "attempts");
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const grouped = /* @__PURE__ */ new Map();
    for (const entry of entries.filter((item) => item.endsWith(".json")).sort()) {
      const raw = await readJson(path.join(dir, entry));
      if (!raw) continue;
      const attempt = validateAttempt(raw);
      if (attempt.job_id !== id2) throw new Error("Invalid LLM attempt receipt");
      const current = grouped.get(attempt.attempt_id);
      if (!current || attempt.status !== "started")
        grouped.set(attempt.attempt_id, attempt);
    }
    return [...grouped.values()].sort(
      (a, b) => a.started_at.localeCompare(b.started_at)
    );
  }
  async readEffectReceipt(jobId, invocationId, kind) {
    const id2 = safeId(jobId);
    const invocation = safeId(invocationId);
    const completed = await readJson(
      this.file(id2, `effects/${invocation}-${kind}-completed.json`)
    );
    const value = completed ?? await readJson(
      this.file(id2, `effects/${invocation}-${kind}-started.json`)
    );
    if (!value) return null;
    const validResult = value.status === "started" ? value.result === null && value.result_hash === null : value.result !== null && typeof value.result_hash === "string" && SHA256.test(value.result_hash) && value.result_hash === hashCanonical(value.result);
    if (value.schema_version !== 2 || value.job_id !== jobId || value.invocation_id !== invocationId || value.kind !== kind || !SHA256.test(value.request_hash) || value.request_hash !== hashCanonical(value.request) || !Number.isSafeInteger(value.workflow_revision) || !["started", "completed"].includes(value.status) || !validResult)
      throw new Error("Invalid workflow effect receipt");
    return value;
  }
  async writeEffectReceipt(value) {
    const id2 = safeId(value.job_id);
    const file = this.file(
      id2,
      `effects/${safeId(value.invocation_id)}-${value.kind}-${value.status}.json`
    );
    const request = removeForbidden(value.request);
    const result = removeForbidden(value.result);
    const normalized = {
      ...value,
      request,
      request_hash: hashCanonical(request),
      result,
      result_hash: value.status === "completed" ? hashCanonical(result) : null
    };
    await this.lock(id2, async () => {
      const prior = await readJson(file);
      if (prior) {
        if (canonicalJson2(prior) !== canonicalJson2(normalized))
          throw new Error("Conflicting workflow effect receipt already exists");
        return;
      }
      const other = await this.readEffectReceipt(
        id2,
        value.invocation_id,
        value.kind
      );
      if (other && (other.request_hash !== normalized.request_hash || other.workflow_revision !== normalized.workflow_revision))
        throw new Error("Conflicting workflow effect receipt already exists");
      await this.write(file, normalized);
    });
  }
  async listJobs() {
    let entries;
    try {
      entries = await fs.readdir(this.root);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const jobs = (await Promise.all(
      entries.map((id2) => SAFE_ID.test(id2) ? this.readJob(id2) : null)
    )).filter((job) => job !== null);
    return jobs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  artifactPath(jobId, name, revision) {
    return path.join(
      this.root,
      safeId(jobId),
      "artifacts",
      artifactFilename(name, revision, 0, 0)
    );
  }
  async requiredJob(id2) {
    const job = await this.readJob(id2);
    if (!job) throw new Error(`Workflow job not found: ${id2}`);
    return job;
  }
  async commitSessionsPassport(sessionsValue, passportValue, bindingRotation2) {
    const sessions = validateWorkflowSessions(sessionsValue);
    const passport = validateWorkflowPassport(passportValue);
    const id2 = safeId(sessions.job_id);
    if (passport.job_id !== id2)
      throw new Error("Session/passport job_id mismatch");
    await this.lock(id2, async () => {
      await this.recoverSessions(id2);
      const currentSessionsRaw = await readJson(
        this.file(id2, "sessions.json")
      );
      const currentPassportRaw = await readJson(
        this.file(id2, "passport.json")
      );
      if (!currentSessionsRaw || !currentPassportRaw)
        throw new Error("Session/passport state is missing");
      const currentSessions = validateWorkflowSessions(currentSessionsRaw);
      const currentPassport = validateWorkflowPassport(currentPassportRaw);
      if (bindingRotation2)
        await this.assertRecoverableBindingRotation(
          id2,
          currentPassport,
          passport
        );
      else assertSameRoster(currentPassport, passport);
      if (sessions.sessions_revision !== currentSessions.sessions_revision + 1)
        throw new Error("Stale sessions revision");
      if (passport.passport_revision !== currentPassport.passport_revision + 1)
        throw new Error("Stale passport revision");
      if (Buffer.byteLength(JSON.stringify(passport)) > passport.config.passport_max_bytes)
        throw new Error("Workflow passport exceeded configured maximum");
      const journal = {
        kind: bindingRotation2 ? "binding_rotation" : "sessions_passport",
        sessions,
        passport
      };
      await this.write(this.file(id2, "sessions.pending.json"), journal);
      await this.applySessions(id2, journal);
    });
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
      if (value?.metadata.artifact_name === name && (workflowRevision === void 0 || value.metadata.workflow_revision === workflowRevision) && (!latest || value.metadata.revision > latest.metadata.revision))
        latest = value;
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
      if (value?.metadata.artifact_name === name && value.metadata.invocation_id === invocationId)
        return value;
    }
    return null;
  }
  async write(file, value) {
    await atomicWrite(file, canonicalJson2(removeForbidden(value)) + "\n");
  }
  async recoverTransition(id2) {
    const journal = await readJson(
      this.file(id2, "transition.pending.json")
    );
    if (journal) {
      journal.passport = await this.normalizePendingPassport(
        id2,
        journal.passport
      );
      await this.applyTransition(id2, journal);
    }
  }
  async applyTransition(id2, journal) {
    const pending = this.file(id2, "transition.pending.json");
    const currentJobRaw = await readJson(this.file(id2, "job.json"));
    const currentPassportRaw = await readJson(
      this.file(id2, "passport.json")
    );
    const currentJob = currentJobRaw ? validateWorkflowJob(currentJobRaw) : null;
    const currentPassport = currentPassportRaw ? validateWorkflowPassport(currentPassportRaw) : null;
    if (currentJob && currentPassport && (currentJob.revision > journal.job.revision || currentPassport.passport_revision > journal.passport.passport_revision)) {
      if (currentJob.revision >= journal.job.revision && currentPassport.passport_revision >= journal.passport.passport_revision) {
        await fs.rm(pending, { force: true });
        return;
      }
      throw new Error(
        "Transition journal is inconsistent with newer canonical state"
      );
    }
    if (currentJob?.revision === journal.job.revision && canonicalJson2(currentJob) !== canonicalJson2(journal.job))
      throw new Error("Transition journal conflicts with canonical job");
    if (currentPassport?.passport_revision === journal.passport.passport_revision && canonicalJson2(currentPassport) !== canonicalJson2(journal.passport))
      throw new Error("Transition journal conflicts with canonical passport");
    const snapshot = this.file(
      id2,
      `passports/passport-${String(journal.passport.passport_revision).padStart(6, "0")}.json`
    );
    const existing = await readJson(snapshot);
    if (existing && canonicalJson2(existing) !== canonicalJson2(journal.passport))
      throw new Error(
        "Transition journal conflicts with immutable passport snapshot"
      );
    if (!existing) await this.write(snapshot, journal.passport);
    await this.write(this.file(id2, "passport.json"), journal.passport);
    await this.write(this.file(id2, "job.json"), journal.job);
    const events = await readJsonl(
      this.file(id2, "events.jsonl")
    );
    const transitionId = journal.event.data.transition_id;
    if (!events.some(
      (event) => event.data?.transition_id === transitionId
    ))
      await appendJsonl(this.file(id2, "events.jsonl"), journal.event);
    await fs.rm(pending, { force: true });
  }
  async recoverPassport(id2) {
    const journal = await readJson(
      this.file(id2, "passport.pending.json")
    );
    if (journal) {
      journal.passport = await this.normalizePendingPassport(
        id2,
        journal.passport
      );
      await this.applyPassport(id2, journal);
    }
  }
  async applyPassport(id2, journal) {
    const pending = this.file(id2, "passport.pending.json");
    const currentRaw = await readJson(this.file(id2, "passport.json"));
    const current = currentRaw ? validateWorkflowPassport(currentRaw) : null;
    if (current && current.passport_revision > journal.passport.passport_revision) {
      await fs.rm(pending, { force: true });
      return;
    }
    if (current?.passport_revision === journal.passport.passport_revision && canonicalJson2(current) !== canonicalJson2(journal.passport))
      throw new Error("Passport journal conflicts with canonical passport");
    const snapshot = this.file(
      id2,
      `passports/passport-${String(journal.passport.passport_revision).padStart(6, "0")}.json`
    );
    const existing = await readJson(snapshot);
    if (existing && canonicalJson2(existing) !== canonicalJson2(journal.passport))
      throw new Error("Passport journal conflicts with immutable snapshot");
    if (!existing) await this.write(snapshot, journal.passport);
    await this.write(this.file(id2, "passport.json"), journal.passport);
    await fs.rm(pending, { force: true });
  }
  async recoverSessions(id2) {
    const journal = await readJson(
      this.file(id2, "sessions.pending.json")
    );
    if (journal) {
      journal.kind ??= journal.passport ? "sessions_passport" : "sessions";
      if (journal.passport)
        journal.passport = await this.normalizePendingPassport(
          id2,
          journal.passport
        );
      await this.applySessions(id2, journal);
    }
  }
  async applySessions(id2, journal) {
    const pending = this.file(id2, "sessions.pending.json");
    if (!["sessions", "sessions_passport", "binding_rotation"].includes(
      journal.kind
    ))
      throw new Error("Sessions journal kind is invalid");
    const sessions = validateWorkflowSessions(journal.sessions);
    const passport = journal.passport ? validateWorkflowPassport(journal.passport) : null;
    if (journal.kind === "sessions" !== (passport === null))
      throw new Error("Sessions journal kind does not match its payload");
    const currentSessionsRaw = await readJson(
      this.file(id2, "sessions.json")
    );
    const currentPassportRaw = passport ? await readJson(this.file(id2, "passport.json")) : null;
    const currentSessions = currentSessionsRaw ? validateWorkflowSessions(currentSessionsRaw) : null;
    const currentPassport = currentPassportRaw ? validateWorkflowPassport(currentPassportRaw) : null;
    if (currentSessions && (currentSessions.sessions_revision > sessions.sessions_revision || passport && currentPassport && currentPassport.passport_revision > passport.passport_revision)) {
      if (currentSessions.sessions_revision >= sessions.sessions_revision && (!passport || currentPassport && currentPassport.passport_revision >= passport.passport_revision)) {
        await fs.rm(pending, { force: true });
        return;
      }
      throw new Error(
        "Sessions journal is inconsistent with newer canonical state"
      );
    }
    if (currentSessions?.sessions_revision === sessions.sessions_revision && canonicalJson2(currentSessions) !== canonicalJson2(sessions))
      throw new Error("Sessions journal conflicts with canonical sessions");
    if (passport && currentPassport?.passport_revision === passport.passport_revision && canonicalJson2(currentPassport) !== canonicalJson2(passport))
      throw new Error("Sessions journal conflicts with canonical passport");
    if (passport && currentPassport && currentPassport.passport_revision < passport.passport_revision) {
      if (journal.kind === "binding_rotation")
        await this.assertRecoverableBindingRotation(
          id2,
          currentPassport,
          passport
        );
      else assertSameRoster(currentPassport, passport);
    }
    const revision = String(sessions.sessions_revision).padStart(6, "0");
    const snapshot = this.file(id2, `sessions/sessions-${revision}.json`);
    const existing = await readJson(snapshot);
    if (existing && canonicalJson2(existing) !== canonicalJson2(sessions))
      throw new Error("Sessions journal conflicts with immutable snapshot");
    if (!existing) await this.write(snapshot, sessions);
    if (passport) {
      const passportSnapshot = this.file(
        id2,
        `passports/passport-${String(passport.passport_revision).padStart(6, "0")}.json`
      );
      const existingPassport = await readJson(passportSnapshot);
      if (existingPassport && canonicalJson2(existingPassport) !== canonicalJson2(passport))
        throw new Error(
          "Sessions journal conflicts with immutable passport snapshot"
        );
      if (!existingPassport) await this.write(passportSnapshot, passport);
      await this.write(this.file(id2, "passport.json"), passport);
    }
    await this.write(this.file(id2, "sessions.json"), sessions);
    await fs.rm(pending, { force: true });
  }
  async assertRecoverableBindingRotation(id2, current, next) {
    const jobRaw = await readJson(this.file(id2, "job.json"));
    if (!jobRaw) throw new Error("Workflow job state is missing");
    const job = validateWorkflowJob(jobRaw);
    if (job.phase !== "paused" && job.phase !== "blocked" || job.current_operation !== null || !job.resume_phase || job.resume_phase === "verification" || job.resume_phase === "merge_ready" || ["done", "cancelled", "failed"].includes(job.resume_phase) || next.current_revision !== job.revision || next.current_phase !== job.phase || current.current_revision !== job.revision || current.current_phase !== job.phase)
      throw new Error("Binding rotation became stale before commit");
    assertBindingRotation(current, next);
  }
  async normalizePendingPassport(id2, value) {
    const raw = value;
    const currentRaw = await readJson(this.file(id2, "passport.json"));
    if (!currentRaw) return validateWorkflowPassport(raw);
    const current = validateWorkflowPassport(currentRaw);
    const initial = "roster" in raw || "roster_hash" in raw ? {} : { roster: current.roster, roster_hash: current.roster_hash };
    const active = [
      "active_roster",
      "active_roster_hash",
      "roster_revision",
      "binding_rotation_history"
    ].some((key) => key in raw) ? {} : {
      active_roster: current.active_roster,
      active_roster_hash: current.active_roster_hash,
      roster_revision: current.roster_revision,
      binding_rotation_history: current.binding_rotation_history
    };
    return validateWorkflowPassport({ ...raw, ...initial, ...active });
  }
  async secureDir(id2) {
    const dir = this.file(id2, "");
    await Promise.all([
      ensureDir(path.join(dir, "artifacts")),
      ensureDir(path.join(dir, "passports")),
      ensureDir(path.join(dir, "sessions")),
      ensureDir(path.join(dir, "invocations")),
      ensureDir(path.join(dir, "attempts")),
      ensureDir(path.join(dir, "effects"))
    ]);
    await Promise.all([
      fs.chmod(this.root, 448).catch(() => {
      }),
      fs.chmod(dir, 448),
      fs.chmod(path.join(dir, "artifacts"), 448),
      fs.chmod(path.join(dir, "passports"), 448),
      fs.chmod(path.join(dir, "sessions"), 448),
      fs.chmod(path.join(dir, "invocations"), 448),
      fs.chmod(path.join(dir, "attempts"), 448),
      fs.chmod(path.join(dir, "effects"), 448)
    ]);
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
        if (Date.now() > deadline)
          throw new Error(`Workflow lock is active: ${id2}`);
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
  return {
    filename: stored.metadata.filename,
    hash: stored.metadata.artifact_hash,
    phase: stored.metadata.phase,
    revision: stored.metadata.revision,
    iteration: stored.metadata.iteration,
    role: stored.metadata.producing_role
  };
}
function hashCanonical(value) {
  return createHash("sha256").update(canonicalJson2(value)).digest("hex");
}
function hashPersisted(value) {
  return hashCanonical(removeForbidden(value));
}
function canonicalJson2(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson2).join(",")}]`;
  const o = value;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson2(o[k])}`).join(",")}}`;
}
function removeForbidden(value) {
  const safe = sanitizeForPersistence(value);
  if (Array.isArray(safe)) return safe.map(removeForbidden);
  if (safe && typeof safe === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(safe))
      if (!FORBIDDEN_FIELD.test(key)) out[key] = removeForbidden(nested);
    return out;
  }
  return safe;
}
function safeId(value) {
  if (!SAFE_ID.test(value) || value === "." || value === "..")
    throw new Error(`Invalid workflow job id: ${value}`);
  return value;
}
function iso(value) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
  return value;
}
function validateAttempt(value) {
  if (value.schema_version !== 1 || !SAFE_ID.test(value.job_id) || !SAFE_ID.test(value.attempt_id) || !SAFE_ID.test(value.invocation_id) || !["supervisor", "implementer", "adviser", "reviewer"].includes(
    value.semantic_role
  ) || !["codex", "fable", "opus"].includes(value.provider_role) || !SAFE_ID.test(value.adapter) || !SHA256.test(value.binding_hash) || !Number.isSafeInteger(value.roster_revision) || value.roster_revision < 1 || !["started", "succeeded", "failed"].includes(value.status) || !["known", "estimated", "unknown"].includes(value.usage_status) || !Number.isFinite(Date.parse(value.started_at)) || value.completed_at !== null && !Number.isFinite(Date.parse(value.completed_at)))
    throw new Error("Invalid LLM attempt receipt");
  if (value.status === "started" && (value.completed_at !== null || value.usage !== null || value.error_category !== null || value.error_message !== null || value.usage_status !== "unknown"))
    throw new Error("Invalid started LLM attempt receipt");
  if (value.status !== "started" && value.completed_at === null)
    throw new Error("Invalid terminal LLM attempt receipt");
  if (value.status === "failed" && !value.error_category)
    throw new Error("Failed LLM attempt requires an error category");
  if (value.usage && (!Number.isSafeInteger(value.usage.duration_ms) || value.usage.duration_ms < 0))
    throw new Error("Invalid LLM attempt usage");
  if (value.usage_status === "known" && (!value.usage || !Number.isSafeInteger(value.usage.input_tokens) || !Number.isSafeInteger(value.usage.output_tokens)))
    throw new Error(
      "Known LLM attempt usage requires exact input and output tokens"
    );
  if (value.usage_status === "estimated" && (!value.usage || !Number.isSafeInteger(value.usage.input_chars) && !Number.isSafeInteger(value.usage.output_chars)))
    throw new Error("Estimated LLM attempt usage requires character metrics");
  return value;
}
function artifactFilename(name, workflowRevision, iteration, sequence) {
  return ARTIFACT_FILES[name].replace("%REV%", String(workflowRevision).padStart(3, "0")).replace("%ITER%", String(iteration).padStart(3, "0")).replace("%SEQ%", String(sequence).padStart(6, "0"));
}
function assertSameRoster(current, next) {
  if (current.roster_hash !== next.roster_hash || canonicalJson2(current.roster) !== canonicalJson2(next.roster))
    throw new Error("Workflow initial roster is immutable after job creation");
  if (current.active_roster_hash !== next.active_roster_hash || canonicalJson2(current.active_roster) !== canonicalJson2(next.active_roster) || current.roster_revision !== next.roster_revision || canonicalJson2(current.binding_rotation_history) !== canonicalJson2(next.binding_rotation_history))
    throw new Error(
      "Workflow active roster may only change through binding rotation"
    );
}
function assertBindingRotation(current, next) {
  if (current.roster_hash !== next.roster_hash || canonicalJson2(current.roster) !== canonicalJson2(next.roster))
    throw new Error("Workflow initial roster is immutable after job creation");
  if (next.roster_revision !== current.roster_revision + 1 || next.binding_rotation_history.length !== current.binding_rotation_history.length + 1 || canonicalJson2(next.binding_rotation_history.slice(0, -1)) !== canonicalJson2(current.binding_rotation_history) || next.binding_rotation_history.at(-1)?.revision !== next.roster_revision)
    throw new Error("Invalid binding rotation history");
  const rotation2 = next.binding_rotation_history.at(-1);
  const currentRoster = current.active_roster;
  const nextRoster = next.active_roster;
  const before = effectiveBinding(currentRoster, rotation2.role);
  const after = effectiveBinding(nextRoster, rotation2.role);
  if (canonicalJson2(before) !== canonicalJson2(rotation2.previous_binding) || canonicalJson2(after) !== canonicalJson2(rotation2.new_binding))
    throw new Error(
      "Binding rotation history does not describe the active roster change"
    );
  const unchanged = ["supervisor", "implementer", "adviser", "reviewer"].filter((role) => role !== rotation2.role);
  if (unchanged.some(
    (role) => canonicalJson2(currentRoster[role]) !== canonicalJson2(nextRoster[role])
  ))
    throw new Error("Binding rotation may change only one semantic role");
}
function effectiveBinding(roster, role) {
  if (role === "reviewer")
    return "same_as" in roster.reviewer ? roster.supervisor : roster.reviewer;
  return roster[role];
}

export { ARTIFACT_FILES, ROLE_PERMISSIONS, SEMANTIC_ROLES, WORKFLOW_PHASE_TRANSITIONS, WorkflowArtifactStore, artifactReference, canTransitionWorkflow, createRosterSnapshot, hashCanonical, hashPersisted, hashRosterAgent, hashRosterSnapshot, isTerminalWorkflowPhase, legacyRosterSnapshot, transitionWorkflow, validateRosterAgent, validateRosterSnapshot };
//# sourceMappingURL=chunk-3R3KVGGX.js.map
//# sourceMappingURL=chunk-3R3KVGGX.js.map