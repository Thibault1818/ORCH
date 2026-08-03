export const WORKFLOW_SCHEMA_VERSION = 1 as const;

export type ProducingRole = 'fable' | 'codex' | 'opus' | 'orchestrator';

export interface CodexBrief {
  job_id: string;
  objective: string;
  constraints: string[];
  allowed_file_scope: string[];
  required_checks: string[];
}

export interface FablePlan {
  job_id: string;
  revision: number;
  assumptions: string[];
  acceptance_criteria: string[];
  implementation_steps: string[];
  risks: string[];
  questions_requiring_human: string[];
}

export interface CodexPlanReview {
  job_id: string;
  revision: number;
  verdict: 'GO' | 'APPLY_AND_GO' | 'REVISE' | 'STOP';
  summary: string;
  required_changes: string[];
  requires_re_review: boolean;
  risk_level: 'low' | 'medium' | 'high';
  reason: string;
  acceptance_criteria: string[];
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

export interface FableComplianceReview {
  job_id: string;
  approved_plan_hash: string;
  verdict: 'ALIGNED' | 'GAPS_FOUND' | 'UNCERTAIN';
  plan_deviations: string[];
  missing_requirements: string[];
  recommended_repairs: string[];
}

export interface CodexTechnicalReview {
  job_id: string;
  reviewed_commit: string;
  checks_passed: boolean;
  evidence: string[];
  required_fixes: string[];
  concise_reason: string;
}

export interface CodexSynthesis {
  job_id: string;
  reviewed_commit: string;
  verdict: 'GO' | 'REVISE' | 'STOP';
  merge_allowed: boolean;
  evidence: string[];
  summary: string;
  required_changes: string[];
  requires_re_review: boolean;
  risk_level: 'low' | 'medium' | 'high';
  reason: string;
}

export interface CheckResults {
  job_id: string;
  commit: string;
  passed: boolean;
  checks: Array<{ command: string; passed: boolean; output: string }>;
}

export type WorkflowContract = CodexBrief | FablePlan | CodexPlanReview | OpusResult |
  FableComplianceReview | CodexTechnicalReview | CodexSynthesis | CheckResults;

type ObjectValue = Record<string, unknown>;

export function validateCodexBrief(value: unknown): CodexBrief {
  const o = exact(value, ['job_id', 'objective', 'constraints', 'allowed_file_scope', 'required_checks'], 'Codex brief');
  return { job_id: id(o.job_id), objective: nonEmpty(o.objective, 'objective'), constraints: strings(o.constraints, 'constraints'), allowed_file_scope: strings(o.allowed_file_scope, 'allowed_file_scope'), required_checks: strings(o.required_checks, 'required_checks') };
}

export function validateFablePlan(value: unknown): FablePlan {
  const o = exact(value, ['job_id', 'revision', 'assumptions', 'acceptance_criteria', 'implementation_steps', 'risks', 'questions_requiring_human'], 'Fable plan');
  return { job_id: id(o.job_id), revision: revision(o.revision), assumptions: strings(o.assumptions, 'assumptions'), acceptance_criteria: strings(o.acceptance_criteria, 'acceptance_criteria'), implementation_steps: strings(o.implementation_steps, 'implementation_steps'), risks: strings(o.risks, 'risks'), questions_requiring_human: strings(o.questions_requiring_human, 'questions_requiring_human') };
}

export function validateCodexPlanReview(value: unknown): CodexPlanReview {
  const o = exact(value, ['job_id', 'revision', 'verdict', 'summary', 'required_changes', 'requires_re_review', 'risk_level', 'reason', 'acceptance_criteria'], 'Codex plan review');
  const verdict = enumeration(o.verdict, ['GO', 'APPLY_AND_GO', 'REVISE', 'STOP'] as const, 'verdict');
  const requiredChanges = strings(o.required_changes, 'required_changes');
  const requiresReReview = bool(o.requires_re_review, 'requires_re_review');
  if (verdict === 'APPLY_AND_GO' && requiredChanges.length === 0) throw new Error('APPLY_AND_GO requires required_changes');
  if (verdict === 'GO' && requiredChanges.length > 0) throw new Error('GO cannot include required_changes');
  if (verdict === 'GO' && requiresReReview) throw new Error('GO cannot require re-review');
  return { job_id: id(o.job_id), revision: revision(o.revision), verdict, summary: nonEmpty(o.summary, 'summary'), required_changes: requiredChanges, requires_re_review: requiresReReview, risk_level: enumeration(o.risk_level, ['low', 'medium', 'high'] as const, 'risk_level'), reason: nonEmpty(o.reason, 'reason'), acceptance_criteria: strings(o.acceptance_criteria, 'acceptance_criteria') };
}

export function validateOpusResult(value: unknown): OpusResult {
  const o = exact(value, ['job_id', 'status', 'files_changed', 'commands_run', 'tests_reported', 'deviations', 'unresolved', 'summary'], 'Opus result');
  return { job_id: id(o.job_id), status: enumeration(o.status, ['completed', 'partial', 'failed'] as const, 'status'), files_changed: strings(o.files_changed, 'files_changed'), commands_run: strings(o.commands_run, 'commands_run'), tests_reported: strings(o.tests_reported, 'tests_reported'), deviations: strings(o.deviations, 'deviations'), unresolved: strings(o.unresolved, 'unresolved'), summary: nonEmpty(o.summary, 'summary') };
}

export function validateFableComplianceReview(value: unknown): FableComplianceReview {
  const o = exact(value, ['job_id', 'approved_plan_hash', 'verdict', 'plan_deviations', 'missing_requirements', 'recommended_repairs'], 'Fable compliance review');
  return { job_id: id(o.job_id), approved_plan_hash: hash(o.approved_plan_hash), verdict: enumeration(o.verdict, ['ALIGNED', 'GAPS_FOUND', 'UNCERTAIN'] as const, 'verdict'), plan_deviations: strings(o.plan_deviations, 'plan_deviations'), missing_requirements: strings(o.missing_requirements, 'missing_requirements'), recommended_repairs: strings(o.recommended_repairs, 'recommended_repairs') };
}

export function validateCodexTechnicalReview(value: unknown): CodexTechnicalReview {
  const o = exact(value, ['job_id', 'reviewed_commit', 'checks_passed', 'evidence', 'required_fixes', 'concise_reason'], 'Codex technical review');
  return { job_id: id(o.job_id), reviewed_commit: commit(o.reviewed_commit), checks_passed: bool(o.checks_passed, 'checks_passed'), evidence: strings(o.evidence, 'evidence'), required_fixes: strings(o.required_fixes, 'required_fixes'), concise_reason: nonEmpty(o.concise_reason, 'concise_reason') };
}

export function validateCodexSynthesis(value: unknown): CodexSynthesis {
  const o = exact(value, ['job_id', 'reviewed_commit', 'verdict', 'merge_allowed', 'evidence', 'summary', 'required_changes', 'requires_re_review', 'risk_level', 'reason'], 'Codex synthesis');
  const verdict = enumeration(o.verdict, ['GO', 'REVISE', 'STOP'] as const, 'verdict');
  const mergeAllowed = bool(o.merge_allowed, 'merge_allowed');
  const requiredChanges = strings(o.required_changes, 'required_changes');
  if (mergeAllowed && verdict !== 'GO') throw new Error('merge_allowed requires GO');
  if (verdict === 'GO' && requiredChanges.length > 0) throw new Error('GO cannot include required_changes');
  const requiresReReview = bool(o.requires_re_review, 'requires_re_review');
  if (mergeAllowed && requiresReReview) throw new Error('merge_allowed cannot require re-review');
  return { job_id: id(o.job_id), reviewed_commit: commit(o.reviewed_commit), verdict, merge_allowed: mergeAllowed, evidence: strings(o.evidence, 'evidence'), summary: nonEmpty(o.summary, 'summary'), required_changes: requiredChanges, requires_re_review: requiresReReview, risk_level: enumeration(o.risk_level, ['low', 'medium', 'high'] as const, 'risk_level'), reason: nonEmpty(o.reason, 'reason') };
}

export function validateCheckResults(value: unknown): CheckResults {
  const o = exact(value, ['job_id', 'commit', 'passed', 'checks'], 'Check results');
  const checks = array(o.checks, 'checks').map((item, index) => {
    const c = exact(item, ['command', 'passed', 'output'], `checks[${index}]`);
    return { command: nonEmpty(c.command, 'command'), passed: bool(c.passed, 'passed'), output: text(c.output, 'output') };
  });
  const passed = bool(o.passed, 'passed');
  if (passed !== checks.every((check) => check.passed)) throw new Error('Check aggregate does not match individual results');
  return { job_id: id(o.job_id), commit: commit(o.commit), passed, checks };
}

function exact(value: unknown, keys: string[], label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value as ObjectValue;
  for (const key of keys) if (!(key in object)) throw new Error(`${label} is missing ${key}`);
  const allowed = new Set(keys);
  for (const key of Object.keys(object)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  return object;
}
function array(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== 'string') throw new Error(`${label} must be a string`); return value; }
function nonEmpty(value: unknown, label: string): string { const result = text(value, label); if (!result.trim()) throw new Error(`${label} must not be empty`); return result; }
function strings(value: unknown, label: string): string[] { return array(value, label).map((v, i) => text(v, `${label}[${i}]`)); }
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`); return value; }
function revision(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('revision must be a positive integer'); return value as number; }
function id(value: unknown): string { const result = nonEmpty(value, 'job_id'); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) throw new Error('Invalid job_id'); return result; }
function hash(value: unknown): string { const result = text(value, 'hash'); if (!/^[a-f0-9]{64}$/.test(result)) throw new Error('Invalid hash'); return result; }
function commit(value: unknown): string { const result = text(value, 'commit'); if (!/^[a-f0-9]{7,64}$/.test(result)) throw new Error('Invalid commit'); return result; }
function enumeration<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] { if (typeof value !== 'string' || !values.includes(value)) throw new Error(`${label} has an invalid value`); return value as T[number]; }
