import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from '../../../src/infrastructure/storage/state-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import type { OrchestratorState } from '../../../src/domain/state.js';

let tmpDir: string;
let paths: Paths;
let store: StateStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-state-'));
  // Create .orchestry structure
  await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new StateStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('StateStore', () => {
  it('returns default state when file does not exist', async () => {
    const state = await store.read();
    expect(state).toEqual(DEFAULT_STATE);
  });

  it('returns a deep clone of default state (not shared reference)', async () => {
    const s1 = await store.read();
    const s2 = await store.read();
    s1.stats.total_runs = 999;
    expect(s2.stats.total_runs).toBe(0);
  });

  it('round-trips state through write/read', async () => {
    const state: OrchestratorState = {
      ...structuredClone(DEFAULT_STATE),
      pid: 12345,
      started_at: '2025-01-01T00:00:00Z',
      stats: {
        total_runs: 5,
        total_tasks_completed: 3,
        total_tasks_failed: 1,
        total_tokens: { input: 100, output: 200, reasoning: 0, total: 300, cache_read: 0, cache_write: 0 },
        total_runtime_ms: 60000,
      },
    };

    await store.write(state);
    const loaded = await store.read();

    expect(loaded).toEqual(state);
  });

  it('validates corrupted state with null running field', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.orchestry', 'state.json'),
      JSON.stringify({ version: 1, running: null, claimed: null, retry_queue: 'bad', stats: null }),
    );

    const state = await store.read();
    expect(state.running).toEqual({});
    expect(state.claimed).toEqual(new Set());
    expect(state.retry_queue).toEqual([]);
    expect(state.stats).toEqual(DEFAULT_STATE.stats);
  });

  it('defaults onboardingCompleted to false when missing from file', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.orchestry', 'state.json'),
      JSON.stringify({ version: 1, running: {}, claimed: [], retry_queue: [] }),
    );
    const state = await store.read();
    expect(state.onboardingCompleted).toBe(false);
  });

  it('preserves onboardingCompleted true through round-trip', async () => {
    const state = structuredClone(DEFAULT_STATE);
    state.onboardingCompleted = true;
    await store.write(state);
    const loaded = await store.read();
    expect(loaded.onboardingCompleted).toBe(true);
  });

  it('falls back to false when onboardingCompleted is non-boolean', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.orchestry', 'state.json'),
      JSON.stringify({ version: 1, running: {}, claimed: [], retry_queue: [], onboardingCompleted: 'yes' }),
    );
    const state = await store.read();
    expect(state.onboardingCompleted).toBe(false);
  });

  it('falls back to false when onboardingCompleted is null', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.orchestry', 'state.json'),
      JSON.stringify({ version: 1, running: {}, claimed: [], retry_queue: [], onboardingCompleted: null }),
    );
    const state = await store.read();
    expect(state.onboardingCompleted).toBe(false);
  });

  it('DEFAULT_STATE.onboardingCompleted is false', () => {
    expect(DEFAULT_STATE.onboardingCompleted).toBe(false);
  });

  it('round-trips onboardingCompleted=false through write/read', async () => {
    const state = structuredClone(DEFAULT_STATE);
    state.onboardingCompleted = false;
    await store.write(state);
    const loaded = await store.read();
    expect(loaded.onboardingCompleted).toBe(false);
  });

  it('preserves valid fields while fixing corrupted ones', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.orchestry', 'state.json'),
      JSON.stringify({
        version: 1,
        pid: 42,
        running: { r1: { run_id: 'r1', agent_id: 'a1', task_id: 't1', pid: 1, started_at: '', last_event_at: '' } },
        claimed: ['t1'],
        retry_queue: null,
        stats: { total_runs: 10 },
      }),
    );

    const state = await store.read();
    expect(state.pid).toBe(42);
    expect(state.running).toHaveProperty('r1');
    expect(state.claimed).toEqual(new Set(['t1']));
    expect(state.retry_queue).toEqual([]);
    expect(state.stats.total_runs).toBe(10);
    expect(state.stats.total_tasks_completed).toBe(0);
  });

  it('migrates old total_tokens without reasoning/cache fields', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.orchestry', 'state.json'),
      JSON.stringify({
        version: 1,
        running: {},
        claimed: [],
        retry_queue: [],
        stats: {
          total_runs: 5,
          total_tasks_completed: 3,
          total_tasks_failed: 1,
          total_tokens: { input: 100, output: 200, total: 300 },
          total_runtime_ms: 60000,
        },
      }),
    );

    const state = await store.read();
    expect(state.stats.total_tokens.input).toBe(100);
    expect(state.stats.total_tokens.output).toBe(200);
    expect(state.stats.total_tokens.total).toBe(300);
    expect(state.stats.total_tokens.reasoning).toBe(0);
    expect(state.stats.total_tokens.cache_read).toBe(0);
    expect(state.stats.total_tokens.cache_write).toBe(0);
  });

  it('atomically migrates unversioned state and is idempotent', async () => {
    const file = path.join(tmpDir, '.orchestry', 'state.json');
    await fs.writeFile(file, JSON.stringify({
      running: {
        tsk_1: {
          run_id: 'run_1', agent_id: 'agt_1', task_id: 'tsk_1', pid: 123,
          started_at: '2026-08-01T00:00:00Z', last_event_at: '2026-08-01T00:00:01Z',
        },
      },
      claimed: ['tsk_1'],
      retry_queue: [{ task_id: 'tsk_2', attempt: 1, due_at: 'later', error: 'retry' }],
      stats: { total_runs: 2, total_tokens: { input: 10, output: 5, total: 15 } },
    }));

    expect(await store.read()).toMatchObject({ version: 1, claimed: new Set(['tsk_1']) });
    const first = await fs.readFile(file, 'utf8');
    expect(JSON.parse(first)).toMatchObject({
      version: 1,
      stats: { total_tokens: { reasoning: 0, cache_read: 0, cache_write: 0 } },
    });
    await store.read();
    expect(await fs.readFile(file, 'utf8')).toBe(first);
  });

  it('recovers an interrupted state migration journal', async () => {
    const dir = path.join(tmpDir, '.orchestry');
    const migrated = {
      version: 1,
      onboardingCompleted: false,
      running: {},
      claimed: ['tsk_recovered'],
      retry_queue: [],
      stats: structuredClone(DEFAULT_STATE.stats),
    };
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ version: 0, claimed: [] }));
    await fs.writeFile(path.join(dir, 'state.migration.pending.json'), JSON.stringify({
      schema_version: 1, from_version: 0, to_version: 1, state: migrated,
    }));

    expect((await store.read()).claimed).toEqual(new Set(['tsk_recovered']));
    await expect(fs.access(path.join(dir, 'state.migration.pending.json'))).rejects.toThrow();
  });

  it('rejects future versions and malformed nested state', async () => {
    const file = path.join(tmpDir, '.orchestry', 'state.json');
    await fs.writeFile(file, JSON.stringify({ version: 2 }));
    await expect(store.read()).rejects.toThrow('future orchestrator state version');

    await fs.writeFile(file, JSON.stringify({
      version: 1,
      running: { tsk_bad: { run_id: 'run_1', agent_id: 'agt_1', task_id: 'tsk_bad', pid: '123' } },
      claimed: [], retry_queue: [], stats: {},
    }));
    await expect(store.read()).rejects.toThrow('running.tsk_bad.pid');
  });
});
