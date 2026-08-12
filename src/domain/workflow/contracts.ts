export const WORKFLOW_SCHEMA_VERSION = 2 as const;

export type ProducingRole = 'fable' | 'codex' | 'opus' | 'orchestrator' | 'human';
export type CodexAction = 'DISPATCH_OPUS' | 'ACCEPT' | 'CORRECT_OPUS' | 'CONSULT_FABLE' | 'PAUSE' | 'STOP';
export type FablePurpose = 'COMPARE_BOUNDED_OPTIONS' | 'GENERATE_NONCRITICAL_ALTERNATIVES' | 'CHALLENGE_REVERSIBLE_PLAN';

export interface FableFallbackV1 {
  action: 'DISPATCH_OPUS' | 'CORRECT_OPUS' | 'PAUSE';
  instructions: string;
}

export interface FableQueryV1 {
  purpose: FablePurpose;
  question: string;
  verification_method: string;
  fallback_if_skipped: FableFallbackV1;
}

export interface CodexDecisionV2 {
  schema_version: 2;
  job_id: string;
  action: CodexAction;
  summary: string;
  implementation_brief: string | null;
  required_changes: string[];
  risk_level: 'low' | 'medium' | 'high';
  fable_query: FableQueryV1 | null;
  reviewed_commit: string | null;
  fable_advice_disposition: 'accepted' | 'rejected' | null;
  fable_error: string | null;
  fable_iteration_effect: 'avoided' | 'added' | 'unchanged' | null;
}

export type FableFallbackReason = 'direct_mode' | 'workflow_cap_or_duplicate' | 'risk_not_low' | 'input_oversized' | 'fable_unavailable' | 'fable_failed' | 'malformed_request' | 'ambiguous_interruption' | 'resume_persisted_fallback';
export interface FableFallbackRecordV1 { schema_version: 1; reason: FableFallbackReason; action: FableFallbackV1['action']; instructions: string; origin: 'pre_opus' | 'post_opus'; }

export interface FableAdviceV1 {
  schema_version: 1;
  consultation_id: string;
  answer: string;
  alternatives: string[];
  uncertainties: string[];
}

export interface OpusResult {
  job_id: string;
  status: 'completed' | 'partial' | 'failed';
  files_changed: string[];
  commands_run: string[];
  tests_reported: string[];
  deviations: string[];
  unresolved: string[];
  summary: string;
}

export interface CheckResults {
  job_id: string;
  commit: string;
  passed: boolean;
  checks: Array<{ command: string; passed: boolean; output: string }>;
}

export interface HumanApprovalV1 {
  schema_version: 1;
  job_id: string;
  target_branch: string;
  base_commit: string;
  reviewed_commit: string;
  reviewed_diff_hash: string;
  check_results_hash: string;
  reason: string;
  approved_at: string;
}

export type CodexDecisionStage = 'pre_opus' | 'post_opus' | 'after_fable_pre' | 'after_fable_post';

export function validateCodexDecision(value: unknown, stage: CodexDecisionStage): CodexDecisionV2 {
  const o = exact(value, ['schema_version', 'job_id', 'action', 'summary', 'implementation_brief', 'required_changes', 'risk_level', 'fable_query', 'reviewed_commit', 'fable_advice_disposition', 'fable_error', 'fable_iteration_effect'], 'Codex decision');
  if (o.schema_version !== 2) throw new Error('Unsupported Codex decision schema version');
  const action = enumeration(o.action, ['DISPATCH_OPUS', 'ACCEPT', 'CORRECT_OPUS', 'CONSULT_FABLE', 'PAUSE', 'STOP'] as const, 'action');
  const allowed = stage === 'pre_opus' ? ['DISPATCH_OPUS', 'CONSULT_FABLE', 'PAUSE', 'STOP'] : stage === 'post_opus' ? ['ACCEPT', 'CORRECT_OPUS', 'CONSULT_FABLE', 'PAUSE', 'STOP'] : stage === 'after_fable_pre' ? ['DISPATCH_OPUS', 'PAUSE', 'STOP'] : ['ACCEPT', 'CORRECT_OPUS', 'PAUSE', 'STOP'];
  if (!allowed.includes(action)) throw new Error(`Codex action ${action} is invalid during ${stage}`);
  const implementationBrief = o.implementation_brief === null ? null : nonEmpty(o.implementation_brief, 'implementation_brief');
  const requiredChanges = strings(o.required_changes, 'required_changes');
  const fableQuery = o.fable_query === null ? null : validateFableQuery(o.fable_query);
  const reviewedCommit = o.reviewed_commit === null ? null : commit(o.reviewed_commit);
  const disposition = o.fable_advice_disposition === null ? null : enumeration(o.fable_advice_disposition, ['accepted', 'rejected'] as const, 'fable_advice_disposition');
  const fableError = o.fable_error === null ? null : nonEmpty(o.fable_error, 'fable_error');
  const iterationEffect = o.fable_iteration_effect === null ? null : enumeration(o.fable_iteration_effect, ['avoided', 'added', 'unchanged'] as const, 'fable_iteration_effect');
  const afterFable = stage === 'after_fable_pre' || stage === 'after_fable_post';
  if (action === 'DISPATCH_OPUS' && !implementationBrief) throw new Error('DISPATCH_OPUS requires implementation_brief');
  if (action !== 'DISPATCH_OPUS' && implementationBrief !== null) throw new Error(`${action} cannot include implementation_brief`);
  if (action === 'CORRECT_OPUS' && requiredChanges.length === 0) throw new Error('CORRECT_OPUS requires required_changes');
  if (action !== 'CORRECT_OPUS' && requiredChanges.length > 0) throw new Error(`${action} cannot include required_changes`);
  if (action === 'CONSULT_FABLE' && !fableQuery) throw new Error('CONSULT_FABLE requires fable_query');
  if (action !== 'CONSULT_FABLE' && fableQuery !== null) throw new Error(`${action} requires fable_query null`);
  if (fableQuery && (stage === 'pre_opus' || stage === 'after_fable_pre') && fableQuery.fallback_if_skipped.action === 'CORRECT_OPUS') throw new Error('Pre-Opus consultation cannot use CORRECT_OPUS fallback');
  if (fableQuery && (stage === 'post_opus' || stage === 'after_fable_post') && fableQuery.fallback_if_skipped.action === 'DISPATCH_OPUS') throw new Error('Post-Opus consultation cannot use DISPATCH_OPUS fallback');
  if ((stage === 'post_opus' || stage === 'after_fable_post') && reviewedCommit === null) throw new Error('Post-Opus decision requires reviewed_commit');
  if ((stage === 'pre_opus' || stage === 'after_fable_pre') && reviewedCommit !== null) throw new Error('Pre-Opus decision cannot include reviewed_commit');
  if (afterFable && (disposition === null || iterationEffect === null)) throw new Error('After-Fable decision must record advice disposition and iteration effect');
  if (!afterFable && (disposition !== null || fableError !== null || iterationEffect !== null)) throw new Error('Non-Fable decision cannot record Fable outcome');
  return { schema_version: 2, job_id: id(o.job_id), action, summary: nonEmpty(o.summary, 'summary'), implementation_brief: implementationBrief, required_changes: requiredChanges, risk_level: enumeration(o.risk_level, ['low', 'medium', 'high'] as const, 'risk_level'), fable_query: fableQuery, reviewed_commit: reviewedCommit, fable_advice_disposition: disposition, fable_error: fableError, fable_iteration_effect: iterationEffect };
}

export function validateFableQuery(value: unknown): FableQueryV1 {
  const o = exact(value, ['purpose', 'question', 'verification_method', 'fallback_if_skipped'], 'Fable query');
  const fallback = exact(o.fallback_if_skipped, ['action', 'instructions'], 'Fable fallback');
  return {
    purpose: enumeration(o.purpose, ['COMPARE_BOUNDED_OPTIONS', 'GENERATE_NONCRITICAL_ALTERNATIVES', 'CHALLENGE_REVERSIBLE_PLAN'] as const, 'purpose'),
    question: nonEmpty(o.question, 'question'),
    verification_method: nonEmpty(o.verification_method, 'verification_method'),
    fallback_if_skipped: { action: enumeration(fallback.action, ['DISPATCH_OPUS', 'CORRECT_OPUS', 'PAUSE'] as const, 'fallback action'), instructions: nonEmpty(fallback.instructions, 'fallback instructions') },
  };
}

export function validateFableAdvice(value: unknown): FableAdviceV1 {
  const o = exact(value, ['schema_version', 'consultation_id', 'answer', 'alternatives', 'uncertainties'], 'Fable advice');
  if (o.schema_version !== 1) throw new Error('Unsupported Fable advice schema version');
  return { schema_version: 1, consultation_id: id(o.consultation_id), answer: nonEmpty(o.answer, 'answer'), alternatives: strings(o.alternatives, 'alternatives'), uncertainties: strings(o.uncertainties, 'uncertainties') };
}

export function validateFableFallbackRecord(value: unknown): FableFallbackRecordV1 {
  const o = exact(value, ['schema_version', 'reason', 'action', 'instructions', 'origin'], 'Fable fallback record');
  if (o.schema_version !== 1) throw new Error('Unsupported Fable fallback record schema version');
  return { schema_version: 1, reason: enumeration(o.reason, ['direct_mode', 'workflow_cap_or_duplicate', 'risk_not_low', 'input_oversized', 'fable_unavailable', 'fable_failed', 'malformed_request', 'ambiguous_interruption', 'resume_persisted_fallback'] as const, 'reason'), action: enumeration(o.action, ['DISPATCH_OPUS', 'CORRECT_OPUS', 'PAUSE'] as const, 'fallback action'), instructions: nonEmpty(o.instructions, 'fallback instructions'), origin: enumeration(o.origin, ['pre_opus', 'post_opus'] as const, 'origin') };
}

export function validateOpusResult(value: unknown): OpusResult {
  const o = exact(value, ['job_id', 'status', 'files_changed', 'commands_run', 'tests_reported', 'deviations', 'unresolved', 'summary'], 'Opus result');
  return { job_id: id(o.job_id), status: enumeration(o.status, ['completed', 'partial', 'failed'] as const, 'status'), files_changed: strings(o.files_changed, 'files_changed'), commands_run: strings(o.commands_run, 'commands_run'), tests_reported: strings(o.tests_reported, 'tests_reported'), deviations: strings(o.deviations, 'deviations'), unresolved: strings(o.unresolved, 'unresolved'), summary: nonEmpty(o.summary, 'summary') };
}

export function validateCheckResults(value: unknown): CheckResults {
  const o = exact(value, ['job_id', 'commit', 'passed', 'checks'], 'Check results');
  const checks = array(o.checks, 'checks').map((item, index) => { const c = exact(item, ['command', 'passed', 'output'], `checks[${index}]`); return { command: nonEmpty(c.command, 'command'), passed: bool(c.passed, 'passed'), output: text(c.output, 'output') }; });
  const passed = bool(o.passed, 'passed');
  if (passed !== checks.every((check) => check.passed)) throw new Error('Check aggregate does not match individual results');
  return { job_id: id(o.job_id), commit: commit(o.commit), passed, checks };
}

export function validateHumanApproval(value: unknown): HumanApprovalV1 {
  const o = exact(value, ['schema_version', 'job_id', 'target_branch', 'base_commit', 'reviewed_commit', 'reviewed_diff_hash', 'check_results_hash', 'reason', 'approved_at'], 'Human approval');
  if (o.schema_version !== 1) throw new Error('Unsupported human approval schema version');
  const approvedAt = nonEmpty(o.approved_at, 'approved_at');
  if (!Number.isFinite(Date.parse(approvedAt))) throw new Error('approved_at must be a timestamp');
  return { schema_version: 1, job_id: id(o.job_id), target_branch: nonEmpty(o.target_branch, 'target_branch'), base_commit: commit(o.base_commit), reviewed_commit: commit(o.reviewed_commit), reviewed_diff_hash: hash(o.reviewed_diff_hash, 'reviewed_diff_hash'), check_results_hash: hash(o.check_results_hash, 'check_results_hash'), reason: nonEmpty(o.reason, 'reason'), approved_at: approvedAt };
}

type ObjectValue = Record<string, unknown>;
function exact(value: unknown, keys: string[], label: string): ObjectValue { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); const object = value as ObjectValue; for (const key of keys) if (!(key in object)) throw new Error(`${label} is missing ${key}`); const allowed = new Set(keys); for (const key of Object.keys(object)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`); return object; }
function array(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== 'string') throw new Error(`${label} must be a string`); return value; }
function nonEmpty(value: unknown, label: string): string { const result = text(value, label); if (!result.trim()) throw new Error(`${label} must not be empty`); return result; }
function strings(value: unknown, label: string): string[] { return array(value, label).map((v, i) => text(v, `${label}[${i}]`)); }
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`); return value; }
function id(value: unknown): string { const result = nonEmpty(value, 'id'); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) throw new Error('Invalid id'); return result; }
function commit(value: unknown): string { const result = text(value, 'commit'); if (!/^[a-f0-9]{7,64}$/.test(result)) throw new Error('Invalid commit'); return result; }
function hash(value: unknown, label: string): string { const result = text(value, label); if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label} must be a SHA-256 hash`); return result; }
function enumeration<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] { if (typeof value !== 'string' || !values.includes(value)) throw new Error(`${label} has an invalid value`); return value as T[number]; }
