import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeWorkflowGitGateway } from '../../src/infrastructure/workflow/native-adapters.js';
import { CommandRunner, resolveExecutable } from '../../src/infrastructure/process/command-runner.js';
import { ProcessManager } from '../../src/infrastructure/process/process-manager.js';

const exec = promisify(execFile);
let root: string;
let workspaceRoot: string;
let gateway: NativeWorkflowGitGateway;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-git-gateway-'));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-git-clones-'));
  await exec('git', ['init', '-b', 'main'], { cwd: root });
  await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
  await fs.writeFile(path.join(root, 'file.txt'), 'base\n');
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  const runner = new CommandRunner(new ProcessManager(path.join(workspaceRoot, 'processes.json')));
  const git = await resolveExecutable('git');
  const safeguards = {
    assertReady: async () => ({}),
    assertQuiescent: async () => {},
    executableAllowlist: async () => [git],
    proxyEndpoint: async () => ({ host: '127.0.0.1', port: 4321 }),
  };
  gateway = new NativeWorkflowGitGateway(root, runner, workspaceRoot, git, safeguards);
});

afterEach(async () => {
  await Promise.all([root, workspaceRoot].map((value) => fs.rm(value, { recursive: true, force: true })));
});

describe('NativeWorkflowGitGateway', () => {
  it('rejects shell syntax before running native checks', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}');
    await expect(gateway.runChecks(root, 'commit', ['npm test; touch owned'])).rejects.toThrow('Unsafe');
    await expect(fs.access(path.join(root, 'owned'))).rejects.toThrow();
  });

  it('isolates implementation in an external clone', async () => {
    const prepared = await gateway.prepare('wf_test');
    expect(prepared.target_branch).toBe('main');
    expect(prepared.worktree.startsWith(workspaceRoot)).toBe(true);
    expect(prepared.worktree.startsWith(root)).toBe(false);
    await fs.writeFile(path.join(prepared.worktree, 'file.txt'), 'changed\n');
    await exec('git', ['add', '.'], { cwd: prepared.worktree });
    await exec('git', ['commit', '-m', 'change'], { cwd: prepared.worktree });
    expect(await fs.readFile(path.join(root, 'file.txt'), 'utf8')).toBe('base\n');
    expect((await gateway.inspect(prepared.branch, prepared.worktree)).files_changed).toEqual(['file.txt']);
  });

  it('reconciles an existing clean clone after controller restart', async () => {
    const first = await gateway.prepare('wf_restart');
    expect(await gateway.prepare('wf_restart')).toEqual(first);
  });

  it('rejects a stale clone instead of adopting it', async () => {
    const prepared = await gateway.prepare('wf_stale');
    await fs.writeFile(path.join(prepared.worktree, 'stale.txt'), 'stale\n');
    await exec('git', ['add', '.'], { cwd: prepared.worktree });
    await exec('git', ['commit', '-m', 'stale'], { cwd: prepared.worktree });
    await expect(gateway.prepare('wf_stale')).rejects.toThrow('does not match the expected clean base');
  });

  it('rejects merge after target branch drift', async () => {
    const prepared = await gateway.prepare('wf_drift');
    const reviewedCommit = (await exec('git', ['rev-parse', prepared.branch], { cwd: prepared.worktree })).stdout.trim();
    await fs.writeFile(path.join(root, 'other.txt'), 'drift\n');
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'drift'], { cwd: root });
    await expect(gateway.merge(prepared.branch, reviewedCommit, prepared.target_branch, prepared.base_commit)).resolves.toMatchObject({ success: false, detail: 'Target branch changed since workflow start' });
  });

  it('rejects merge when the clone branch moves after review', async () => {
    const prepared = await gateway.prepare('wf_move');
    const reviewedCommit = (await exec('git', ['rev-parse', prepared.branch], { cwd: prepared.worktree })).stdout.trim();
    await fs.writeFile(path.join(prepared.worktree, 'file.txt'), 'changed\n');
    await exec('git', ['add', '.'], { cwd: prepared.worktree });
    await exec('git', ['commit', '-m', 'unreviewed'], { cwd: prepared.worktree });
    await expect(gateway.merge(prepared.branch, reviewedCommit, prepared.target_branch, prepared.base_commit)).resolves.toMatchObject({ success: false, detail: 'Workflow branch changed after review' });
  });

  it('imports and merges only the exact reviewed clone commit', async () => {
    const prepared = await gateway.prepare('wf_merge');
    await fs.writeFile(path.join(prepared.worktree, 'file.txt'), 'reviewed\n');
    await exec('git', ['add', '.'], { cwd: prepared.worktree });
    await exec('git', ['commit', '-m', 'reviewed'], { cwd: prepared.worktree });
    const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: prepared.worktree })).stdout.trim();
    await expect(gateway.merge(prepared.branch, commit, prepared.target_branch, prepared.base_commit)).resolves.toEqual({ success: true, detail: 'merged' });
    expect(await fs.readFile(path.join(root, 'file.txt'), 'utf8')).toBe('reviewed\n');
    expect(await gateway.isMerged(prepared.branch, commit, prepared.target_branch, prepared.base_commit)).toBe(true);
  });
});
