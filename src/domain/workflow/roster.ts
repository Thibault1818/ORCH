import { createHash } from 'node:crypto';
import type { WorkflowMode } from './state.js';

export const SEMANTIC_ROLES = ['supervisor', 'implementer', 'adviser', 'reviewer'] as const;
export type SemanticRole = typeof SEMANTIC_ROLES[number];

export interface RolePermissions {
  readonly workspace: 'read_only' | 'worktree';
  readonly tools: 'enabled' | 'none';
  readonly advisory_only: boolean;
}

export const ROLE_PERMISSIONS: Readonly<Record<SemanticRole, RolePermissions>> = Object.freeze({
  supervisor: Object.freeze({ workspace: 'read_only', tools: 'enabled', advisory_only: false }),
  implementer: Object.freeze({ workspace: 'worktree', tools: 'enabled', advisory_only: false }),
  adviser: Object.freeze({ workspace: 'read_only', tools: 'none', advisory_only: true }),
  reviewer: Object.freeze({ workspace: 'read_only', tools: 'enabled', advisory_only: false }),
});

export interface RosterAgent {
  adapter: string;
  profile: RosterProfileSnapshot;
}

export interface RosterProfileSnapshot {
  name: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  max_turns: number;
  timeout_ms: number;
}

export interface SameAsSupervisor {
  same_as: 'supervisor';
}

export interface WorkflowRosterSnapshot {
  schema_version: 1;
  supervisor: RosterAgent;
  implementer: RosterAgent;
  adviser: RosterAgent | null;
  reviewer: RosterAgent | SameAsSupervisor;
}

export interface RosterInput {
  supervisor: RosterAgent;
  implementer: RosterAgent;
  adviser?: RosterAgent | null;
  reviewer?: RosterAgent | SameAsSupervisor;
}

export function createRosterSnapshot(input: RosterInput, mode: WorkflowMode = 'adaptive'): WorkflowRosterSnapshot {
  return validateRosterSnapshot({
    schema_version: 1,
    supervisor: input.supervisor,
    implementer: input.implementer,
    adviser: input.adviser ?? null,
    reviewer: input.reviewer ?? { same_as: 'supervisor' },
  }, mode);
}

export function legacyRosterSnapshot(mode: WorkflowMode): WorkflowRosterSnapshot {
  return createRosterSnapshot({
    supervisor: { adapter: 'codex', profile: { name: 'codex', model: 'codex', effort: 'medium', max_turns: 1, timeout_ms: 600_000 } },
    implementer: { adapter: 'claude', profile: { name: 'opus', model: 'opus', effort: 'high', max_turns: 50, timeout_ms: 1_800_000 } },
    adviser: mode === 'adaptive' ? { adapter: 'fable', profile: { name: 'fable', model: 'fable', effort: 'low', max_turns: 1, timeout_ms: 300_000 } } : null,
  }, mode);
}

export function validateRosterSnapshot(value: unknown, mode?: WorkflowMode): WorkflowRosterSnapshot {
  const roster = object(value, 'workflow roster');
  exact(roster, ['schema_version', 'supervisor', 'implementer', 'adviser', 'reviewer'], 'workflow roster');
  if (roster.schema_version !== 1) throw new Error('Unsupported workflow roster schema version');
  const adviser = roster.adviser === null ? null : agent(roster.adviser, 'workflow roster.adviser');
  if (mode === 'direct' && adviser !== null) throw new Error('Direct workflow roster cannot include an adviser');
  return {
    schema_version: 1,
    supervisor: agent(roster.supervisor, 'workflow roster.supervisor'),
    implementer: agent(roster.implementer, 'workflow roster.implementer'),
    adviser,
    reviewer: reviewer(roster.reviewer),
  };
}

export function hashRosterSnapshot(value: WorkflowRosterSnapshot): string {
  const roster = validateRosterSnapshot(value);
  return createHash('sha256').update(canonicalJson(roster)).digest('hex');
}

export function validateRosterAgent(value: unknown, label = 'workflow roster agent'): RosterAgent { return agent(value, label); }
export function hashRosterAgent(value: RosterAgent): string { return createHash('sha256').update(canonicalJson(validateRosterAgent(value))).digest('hex'); }

function reviewer(value: unknown): WorkflowRosterSnapshot['reviewer'] {
  const item = object(value, 'workflow roster.reviewer');
  if ('same_as' in item) {
    exact(item, ['same_as'], 'workflow roster.reviewer');
    if (item.same_as !== 'supervisor') throw new Error('workflow roster.reviewer.same_as must be supervisor');
    return { same_as: 'supervisor' };
  }
  return agent(item, 'workflow roster.reviewer');
}

function agent(value: unknown, label: string): RosterAgent {
  const item = object(value, label);
  exact(item, ['adapter', 'profile'], label);
  const profile = object(item.profile, `${label}.profile`);
  exact(profile, ['name', 'model', 'effort', 'max_turns', 'timeout_ms'], `${label}.profile`);
  if (!['low', 'medium', 'high'].includes(profile.effort as string)) throw new Error(`${label}.profile.effort is invalid`);
  if (!Number.isSafeInteger(profile.max_turns) || (profile.max_turns as number) < 1) throw new Error(`${label}.profile.max_turns is invalid`);
  if (!Number.isSafeInteger(profile.timeout_ms) || (profile.timeout_ms as number) < 1) throw new Error(`${label}.profile.timeout_ms is invalid`);
  return { adapter: identifier(item.adapter, `${label}.adapter`), profile: { name: identifier(profile.name, `${label}.profile.name`), model: model(profile.model, `${label}.profile.model`), effort: profile.effort as RosterProfileSnapshot['effort'], max_turns: profile.max_turns as number, timeout_ms: profile.timeout_ms as number } };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[], label: string): void {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) throw new Error(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${label} contains unknown field ${key}`);
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function model(value: unknown, label: string): string {
  if (value === '') return value;
  return identifier(value, label);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`;
}
