import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProcessManager } from '../../../src/infrastructure/process/process-manager.js';

describe('ProcessManager durable recovery', () => {
  let root: string;
  let registry: string;
  const cleanup: Array<{ manager: ProcessManager; pid: number }> = [];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-process-recovery-'));
    registry = path.join(root, 'process-groups.json');
  });

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map(({ manager, pid }) => manager.killWithGrace(pid, 20)));
    await fs.rm(root, { recursive: true, force: true });
  });

  it('shares durable ownership and termination across manager instances', async () => {
    const first = new ProcessManager(registry);
    const handle = first.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { owner: 'workflow-one', env: {} });
    cleanup.push({ manager: first, pid: handle.pid });

    const recovered = new ProcessManager(registry);
    expect(recovered.active('workflow-one')).toEqual([handle.pid]);
    await expect(recovered.awaitQuiescent('workflow-one', 0)).rejects.toThrow('Timed out');
    const closed = new Promise<void>((resolve) => handle.process.once('close', () => resolve()));
    await recovered.killWithGrace(handle.pid, 20);
    await closed;
    expect(recovered.active('workflow-one')).toEqual([]);
    expect((await fs.stat(registry)).mode & 0o777).toBe(0o600);
  });

  it('removes stale entries without signalling an unrelated PID', async () => {
    await fs.writeFile(registry, `${JSON.stringify({
      schema_version: 2,
      groups: [{ pid: 999_999_991, owner: 'stale', identity: 'old process', registered_at: new Date(0).toISOString() }],
    })}\n`, { mode: 0o600 });

    const recovered = new ProcessManager(registry);
    expect(recovered.active('stale')).toEqual([]);
    expect(JSON.parse(await fs.readFile(registry, 'utf8'))).toEqual({ schema_version: 3, groups: [], reservations: [], freezes: [] });
  });

  it('migrates a live schema-v1 registry and preserves ownership', async () => {
    const first = new ProcessManager(registry);
    const handle = first.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { owner: 'migrated', env: {} });
    cleanup.push({ manager: first, pid: handle.pid });
    const current = JSON.parse(await fs.readFile(registry, 'utf8')) as { groups: Array<{ pid: number; owner: string }> };
    await fs.writeFile(registry, `${JSON.stringify({ schema_version: 1, groups: current.groups.map(({ pid, owner }) => ({ pid, owner })) })}\n`, { mode: 0o600 });

    const recovered = new ProcessManager(registry);
    expect(recovered.active('migrated')).toEqual([handle.pid]);
    const migrated = JSON.parse(await fs.readFile(registry, 'utf8')) as { schema_version: number; groups: Array<{ identity?: string; registered_at?: string }> };
    expect(migrated.schema_version).toBe(3);
    expect(migrated.groups[0]).toMatchObject({ identity: expect.any(String), registered_at: expect.any(String) });
  });

  it('fails closed on a recovered ambiguous spawn reservation', async () => {
    const identity = (await import('node:child_process')).execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' }).trim();
    await fs.writeFile(registry, `${JSON.stringify({ schema_version: 3, groups: [], reservations: [{ id: 'pending', owner: 'workflow', parent_pid: process.pid, parent_identity: identity, created_at: new Date().toISOString() }], freezes: [] })}\n`, { mode: 0o600 });
    const recovered = new ProcessManager(registry);
    await expect(recovered.runQuiescent('workflow', async () => {}, 0)).rejects.toThrow('Timed out');
  });
});
