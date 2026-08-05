import { describe, expect, it } from 'vitest';
import { createRosterSnapshot, hashRosterSnapshot, ROLE_PERMISSIONS, validateRosterSnapshot } from '../../../src/domain/workflow/roster.js';

const required = {
  schema_version: 1,
  supervisor: { adapter: 'codex', profile: { name: 'review-high', model: 'codex', effort: 'high', max_turns: 1, timeout_ms: 600_000 } },
  implementer: { adapter: 'claude', profile: { name: 'build-high', model: 'opus', effort: 'high', max_turns: 50, timeout_ms: 1_800_000 } },
  adviser: null,
  reviewer: { same_as: 'supervisor' },
} as const;

describe('workflow roster', () => {
  it('requires every semantic role in persisted snapshots', () => {
    const { implementer: _, ...missing } = required;
    expect(() => validateRosterSnapshot(missing)).toThrow('missing implementer');
  });

  it('defaults adviser absence to null and reviewer to supervisor', () => {
    expect(createRosterSnapshot({ supervisor: required.supervisor, implementer: required.implementer })).toMatchObject({
      adviser: null,
      reviewer: { same_as: 'supervisor' },
    });
  });

  it('publishes frozen canonical permissions', () => {
    expect(ROLE_PERMISSIONS).toEqual({
      supervisor: { workspace: 'read_only', tools: 'enabled', advisory_only: false },
      implementer: { workspace: 'worktree', tools: 'enabled', advisory_only: false },
      adviser: { workspace: 'read_only', tools: 'none', advisory_only: true },
      reviewer: { workspace: 'read_only', tools: 'enabled', advisory_only: false },
    });
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    expect(Object.values(ROLE_PERMISSIONS).every(Object.isFrozen)).toBe(true);
  });

  it('rejects an adviser in direct mode', () => {
    expect(() => validateRosterSnapshot({ ...required, adviser: { adapter: 'fable', profile: { name: 'advice', model: 'fable', effort: 'low', max_turns: 1, timeout_ms: 300_000 } } }, 'direct')).toThrow('cannot include an adviser');
  });

  it('keeps adapters and profiles separate and accepts a dedicated reviewer', () => {
    const reviewer = { adapter: 'codex', profile: { name: 'independent-review', model: 'codex', effort: 'high', max_turns: 1, timeout_ms: 600_000 } } as const;
    expect(validateRosterSnapshot({ ...required, reviewer }).reviewer).toEqual(reviewer);
  });

  it('hashes canonical snapshots deterministically', () => {
    const reordered = { reviewer: required.reviewer, adviser: null, implementer: { profile: { timeout_ms: 1_800_000, max_turns: 50, effort: 'high', model: 'opus', name: 'build-high' }, adapter: 'claude' }, supervisor: { profile: { timeout_ms: 600_000, max_turns: 1, effort: 'high', model: 'codex', name: 'review-high' }, adapter: 'codex' }, schema_version: 1 } as const;
    expect(hashRosterSnapshot(required)).toBe(hashRosterSnapshot(reordered));
    expect(hashRosterSnapshot(required)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRosterSnapshot({ ...required, implementer: { ...required.implementer, profile: { ...required.implementer.profile, name: 'build-low' } } })).not.toBe(hashRosterSnapshot(required));
  });

  it('rejects unknown snapshot fields', () => {
    expect(() => validateRosterSnapshot({ ...required, permissions: {} })).toThrow('unknown field permissions');
  });
});
