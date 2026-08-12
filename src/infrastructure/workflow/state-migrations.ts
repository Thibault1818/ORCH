import type {
  WorkflowJobV2,
  WorkflowPassportV2,
  WorkflowSessionsV2,
} from '../../domain/workflow/state.js';
import {
  validateWorkflowJob,
  validateWorkflowPassport,
  validateWorkflowSessions,
} from '../../domain/workflow/validation.js';

export const WORKFLOW_SCHEMA_VERSION = 2;

export interface WorkflowMigrationJournal {
  schema_version: 1;
  from_version: 1;
  to_version: 2;
  job: WorkflowJobV2;
  passport: WorkflowPassportV2;
  sessions: WorkflowSessionsV2;
}

export function workflowStateVersion(value: unknown, label: string): 1 | 2 {
  const raw = object(value, label);
  if (raw.schema_version === 1 || raw.schema_version === 2) return raw.schema_version;
  if (
    Number.isSafeInteger(raw.schema_version) &&
    (raw.schema_version as number) > WORKFLOW_SCHEMA_VERSION
  )
    throw new Error(`Unsupported future ${label} schema version: ${raw.schema_version}`);
  throw new Error(`Unsupported ${label} schema version: ${String(raw.schema_version)}`);
}

export function migrateWorkflowState(
  jobValue: unknown,
  passportValue: unknown,
  sessionsValue: unknown,
): WorkflowMigrationJournal {
  const versions = [
    workflowStateVersion(jobValue, 'workflow job'),
    workflowStateVersion(passportValue, 'workflow passport'),
    workflowStateVersion(sessionsValue, 'workflow sessions'),
  ];
  if (versions.some((version) => version !== 1))
    throw new Error('Workflow migration requires a complete schema-v1 job, passport, and sessions set');
  validateLegacyNestedState(passportValue, sessionsValue);

  // Validate the migrated value again as v2. This catches malformed legacy nested
  // values that the compatibility conversion would otherwise carry through.
  const job = validateWorkflowJob(validateWorkflowJob(jobValue));
  const legacyPassport = validateWorkflowPassport(passportValue);
  const passport = validateWorkflowPassport({
    ...legacyPassport,
    current_revision: job.revision,
    current_phase: job.phase,
  });
  const migratedSessions = validateWorkflowSessions(sessionsValue);
  const sessions = validateWorkflowSessions({
    ...migratedSessions,
    usage: Object.fromEntries(Object.entries(migratedSessions.usage).map(([role, value]) => [
      role,
      { ...zeroUsage(), ...value },
    ])),
  });
  if (job.job_id !== passport.job_id || job.job_id !== sessions.job_id)
    throw new Error('Legacy workflow state has mismatched job_id values');
  if (passport.current_revision !== job.revision || passport.current_phase !== job.phase)
    throw new Error('Migrated workflow passport does not match migrated job state');
  return {
    schema_version: 1,
    from_version: 1,
    to_version: 2,
    job,
    passport,
    sessions,
  };
}

function validateLegacyNestedState(passportValue: unknown, sessionsValue: unknown): void {
  const passport = object(passportValue, 'legacy workflow passport');
  for (const field of [
    'hard_constraints',
    'acceptance_criteria',
    'allowed_file_scope',
    'required_checks',
  ]) {
    const value = passport[field];
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string')))
      throw new Error(`legacy workflow passport ${field} must be an array of strings`);
  }
  const sessions = object(sessionsValue, 'legacy workflow sessions');
  if (sessions.recorded_invocations !== undefined && (
    !Array.isArray(sessions.recorded_invocations) ||
    sessions.recorded_invocations.some((item) => typeof item !== 'string')
  ))
    throw new Error('legacy workflow sessions recorded_invocations must be an array of strings');
}

function zeroUsage() {
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

export function validateWorkflowMigrationJournal(value: unknown): WorkflowMigrationJournal {
  const raw = object(value, 'workflow migration journal');
  if (raw.schema_version !== 1 || raw.from_version !== 1 || raw.to_version !== 2)
    throw new Error('Invalid workflow migration journal');
  const job = validateWorkflowJob(raw.job);
  const passport = validateWorkflowPassport(raw.passport);
  const sessions = validateWorkflowSessions(raw.sessions);
  if (job.job_id !== passport.job_id || job.job_id !== sessions.job_id)
    throw new Error('Workflow migration journal has mismatched job_id values');
  if (passport.current_revision !== job.revision || passport.current_phase !== job.phase)
    throw new Error('Workflow migration journal contains inconsistent state');
  return {
    schema_version: 1,
    from_version: 1,
    to_version: 2,
    job,
    passport,
    sessions,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
