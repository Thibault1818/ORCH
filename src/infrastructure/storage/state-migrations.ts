import type { OrchestratorState, RetryEntry, RunningEntry } from '../../domain/state.js';
import { DEFAULT_STATE } from '../../domain/state.js';

export const STATE_SCHEMA_VERSION = 1;

export interface StateMigrationJournal {
  schema_version: 1;
  from_version: 0;
  to_version: 1;
  state: PersistedOrchestratorState;
}

export interface PersistedOrchestratorState extends Omit<OrchestratorState, 'claimed'> {
  claimed: string[];
}

export function stateVersion(value: unknown): 0 | 1 {
  const raw = object(value, 'orchestrator state');
  if (raw.version === undefined || raw.version === 0) return 0;
  if (raw.version === STATE_SCHEMA_VERSION) return STATE_SCHEMA_VERSION;
  if (Number.isSafeInteger(raw.version) && (raw.version as number) > STATE_SCHEMA_VERSION)
    throw new Error(`Unsupported future orchestrator state version: ${raw.version}`);
  throw new Error('Invalid orchestrator state version');
}

export function migrateState(value: unknown): PersistedOrchestratorState {
  const version = stateVersion(value);
  const raw = object(value, 'orchestrator state');
  return validatePersistedState({ ...raw, version: STATE_SCHEMA_VERSION }, version === 0);
}

export function validatePersistedState(value: unknown, legacy = false): PersistedOrchestratorState {
  const raw = object(value, 'orchestrator state');
  if (raw.version !== STATE_SCHEMA_VERSION)
    throw new Error(`Unsupported orchestrator state version: ${String(raw.version)}`);

  const defaults = structuredClone(DEFAULT_STATE);
  const runningRaw = optionalObject(raw.running, 'running', legacy);
  const running: Record<string, RunningEntry> = {};
  for (const [key, entry] of Object.entries(runningRaw)) {
    const item = object(entry, `running.${key}`);
    running[key] = {
      run_id: string(item.run_id, `running.${key}.run_id`),
      agent_id: string(item.agent_id, `running.${key}.agent_id`),
      task_id: string(item.task_id, `running.${key}.task_id`),
      pid: integer(item.pid, `running.${key}.pid`, 1),
      started_at: string(item.started_at, `running.${key}.started_at`),
      last_event_at: string(item.last_event_at, `running.${key}.last_event_at`),
    };
  }

  const claimedRaw = optionalArray(raw.claimed, 'claimed', legacy);
  const claimed = claimedRaw.map((item, index) => string(item, `claimed[${index}]`));
  const retryRaw = optionalArray(raw.retry_queue, 'retry_queue', legacy);
  const retry_queue: RetryEntry[] = retryRaw.map((entry, index) => {
    const item = object(entry, `retry_queue[${index}]`);
    return {
      task_id: string(item.task_id, `retry_queue[${index}].task_id`),
      attempt: integer(item.attempt, `retry_queue[${index}].attempt`, 0),
      due_at: string(item.due_at, `retry_queue[${index}].due_at`),
      error: string(item.error, `retry_queue[${index}].error`),
    };
  });

  const statsRaw = optionalObject(raw.stats, 'stats', legacy);
  const tokensRaw = optionalObject(statsRaw.total_tokens, 'stats.total_tokens', legacy);
  const number = (value: unknown, fallback: number, label: string) =>
    value === undefined ? fallback : integer(value, label, 0);

  const state: PersistedOrchestratorState = {
    version: STATE_SCHEMA_VERSION,
    onboardingCompleted:
      typeof raw.onboardingCompleted === 'boolean' ? raw.onboardingCompleted : false,
    running,
    claimed,
    retry_queue,
    stats: {
      total_runs: number(statsRaw.total_runs, defaults.stats.total_runs, 'stats.total_runs'),
      total_tasks_completed: number(
        statsRaw.total_tasks_completed,
        defaults.stats.total_tasks_completed,
        'stats.total_tasks_completed',
      ),
      total_tasks_failed: number(
        statsRaw.total_tasks_failed,
        defaults.stats.total_tasks_failed,
        'stats.total_tasks_failed',
      ),
      total_tokens: {
        input: number(tokensRaw.input, defaults.stats.total_tokens.input, 'stats.total_tokens.input'),
        output: number(tokensRaw.output, defaults.stats.total_tokens.output, 'stats.total_tokens.output'),
        reasoning: number(
          tokensRaw.reasoning,
          defaults.stats.total_tokens.reasoning,
          'stats.total_tokens.reasoning',
        ),
        total: number(tokensRaw.total, defaults.stats.total_tokens.total, 'stats.total_tokens.total'),
        cache_read: number(
          tokensRaw.cache_read,
          defaults.stats.total_tokens.cache_read,
          'stats.total_tokens.cache_read',
        ),
        cache_write: number(
          tokensRaw.cache_write,
          defaults.stats.total_tokens.cache_write,
          'stats.total_tokens.cache_write',
        ),
      },
      total_runtime_ms: number(
        statsRaw.total_runtime_ms,
        defaults.stats.total_runtime_ms,
        'stats.total_runtime_ms',
      ),
    },
  };
  if (raw.pid !== undefined) state.pid = integer(raw.pid, 'pid', 1);
  if (raw.started_at !== undefined) state.started_at = string(raw.started_at, 'started_at');
  return state;
}

export function validateStateMigrationJournal(value: unknown): StateMigrationJournal {
  const raw = object(value, 'state migration journal');
  if (raw.schema_version !== 1 || raw.from_version !== 0 || raw.to_version !== 1)
    throw new Error('Invalid state migration journal');
  return {
    schema_version: 1,
    from_version: 0,
    to_version: 1,
    state: validatePersistedState(raw.state),
  };
}

export function deserializeState(value: PersistedOrchestratorState): OrchestratorState {
  return { ...value, claimed: new Set(value.claimed) };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown, label: string, legacy: boolean): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return object(value, label);
}

function optionalArray(value: unknown, label: string, legacy: boolean): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error(`${label} must be an integer >= ${minimum}`);
  return value as number;
}
