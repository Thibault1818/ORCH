import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceManager } from '../../../src/infrastructure/workspace/workspace-manager.js';
import { CommandRunner } from '../../../src/infrastructure/process/command-runner.js';
import { ProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';

const exec = promisify(execFile);
let project: string;
let workspaces: string;
let manager: WorkspaceManager;

beforeEach(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-workspace-project-'));
  workspaces = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-workspace-clones-'));
  await exec('git', ['init', '-b', 'main'], { cwd: project });
  await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: project });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: project });
  await fs.writeFile(path.join(project, 'file.txt'), 'base\n');
  await exec('git', ['add', '.'], { cwd: project });
  await exec('git', ['commit', '-m', 'base'], { cwd: project });
  manager = new WorkspaceManager(project, workspaces, new CommandRunner(new ProcessManager()));
});

afterEach(async () => {
  await Promise.all([project, workspaces].map((value) => fs.rm(value, { recursive: true, force: true })));
});

describe('WorkspaceManager isolated clones', () => {
  it('rejects shared mode because it cannot defer changes for approval', async () => {
    await expect(manager.prepare(task({ workspace_mode: 'shared' }), agent(), DEFAULT_CONFIG)).rejects.toThrow('shared');
  });

  it.each(['worktree', 'isolated'] as const)('maps %s mode to an external no-hardlink clone', async (workspace_mode) => {
    const prepared = await manager.prepare(task({ workspace_mode }), agent(), DEFAULT_CONFIG);
    expect(prepared.path.startsWith(workspaces)).toBe(true);
    expect(prepared.path.startsWith(project)).toBe(false);
    expect(prepared.branch).toMatch(/^orchestry\/tsk_ws1\//);
    await fs.writeFile(path.join(prepared.path, 'file.txt'), 'changed\n');
    expect(await fs.readFile(path.join(project, 'file.txt'), 'utf8')).toBe('base\n');
  });

  it('rejects a stale or dirty clone on restart', async () => {
    const prepared = await manager.prepare(task(), agent(), DEFAULT_CONFIG);
    await fs.writeFile(path.join(prepared.path, 'dirty.txt'), 'dirty');
    await expect(manager.prepare(task(), agent(), DEFAULT_CONFIG)).rejects.toThrow('stale or dirty');
  });

  it('imports and merges the exact committed clone revision', async () => {
    const prepared = await manager.prepare(task(), agent(), DEFAULT_CONFIG);
    await fs.writeFile(path.join(prepared.path, 'file.txt'), 'reviewed\n');
    await exec('git', ['add', '.'], { cwd: prepared.path });
    await exec('git', ['commit', '-m', 'reviewed'], { cwd: prepared.path });
    const evidence = await manager.inspect(prepared.branch!);
    await expect(manager.mergeBack(prepared.branch!, evidence)).resolves.toEqual({ success: true });
    expect(await fs.readFile(path.join(project, 'file.txt'), 'utf8')).toBe('reviewed\n');
  });

  it('cleans the external clone', async () => {
    const prepared = await manager.prepare(task(), agent(), DEFAULT_CONFIG);
    await manager.cleanup('tsk_ws1');
    await expect(fs.access(prepared.path)).rejects.toThrow();
  });

  it('fails closed outside a Git repository', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-not-git-'));
    try {
      const isolated = new WorkspaceManager(plain, workspaces, new CommandRunner(new ProcessManager()));
      await expect(isolated.prepare(task(), agent(), DEFAULT_CONFIG)).rejects.toThrow('requires a git repository');
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });
});

function task(overrides: Partial<Task> = {}): Task {
  return { id: 'tsk_ws1', title: 'Workspace test', description: '', status: 'todo', priority: 3, labels: [], depends_on: [], created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', attempts: 0, max_attempts: 3, ...overrides };
}
function agent(): Agent {
  return { id: 'agt_ws1', name: 'Agent', adapter: 'claude', config: { approval_policy: 'auto', max_turns: 10, timeout_ms: 1000, stall_timeout_ms: 1000 }, status: 'idle', stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 } };
}
