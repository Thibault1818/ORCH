import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Agent } from '../../domain/agent.js';
import type { OrchestratorConfig } from '../../domain/config.js';
import type { Task, WorkspaceMode } from '../../domain/task.js';
import { WorkspaceError } from '../../domain/errors.js';
import type { ICommandRunner } from '../process/command-runner.js';
import { CommandRunner, resolveExecutable } from '../process/command-runner.js';
import type { IProcessManager } from '../process/process-manager.js';
import { HardenedGit } from '../git/hardened-git.js';
import { validateWorkspacePath, sanitizeId } from '../storage/paths.js';
import type { IWorkspaceManager, PrepareResult, WorkspaceEvidence } from './interface.js';
import type { MergeResult } from './merge-strategy.js';

export class WorkspaceManager implements IWorkspaceManager {
  private readonly runner: ICommandRunner;
  private readonly git: Promise<HardenedGit>;
  private gitRepoChecked = false;

  constructor(
    private readonly projectRoot: string,
    private readonly workspaceRoot: string,
    runner: ICommandRunner | IProcessManager,
  ) {
    const commandRunner = 'run' in runner ? runner : new CommandRunner(runner);
    this.runner = commandRunner;
    this.git = (async () => new HardenedGit(
      commandRunner,
      commandRunner.resolveExecutable ? await commandRunner.resolveExecutable('git') : await resolveExecutable('git'),
      { configRoot: path.join(os.tmpdir(), 'orch-workspace-git') },
    ))();
  }

  async prepare(task: Task, agent: Agent, config: OrchestratorConfig): Promise<PrepareResult> {
    const mode = this.resolveMode(task, agent, config);
    if (mode === 'shared') throw new WorkspaceError('workspace_mode "shared" is disabled because changes cannot be held for human approval');
    await this.requireGitRepo(mode);
    return this.prepareClone(task);
  }

  async inspect(branch: string): Promise<WorkspaceEvidence> {
    const clone = this.cloneForBranch(branch);
    const git = await this.git;
    const status = (await git.run(clone, ['status', '--porcelain'])).trim();
    if (status) throw new WorkspaceError('Isolated clone has uncommitted changes');
    const [commit, baseCommit, targetBranch] = await Promise.all([
      git.run(clone, ['rev-parse', 'HEAD']),
      git.run(clone, ['merge-base', 'HEAD', '@{upstream}']),
      git.run(this.projectRoot, ['branch', '--show-current']),
    ]);
    const base = baseCommit.trim();
    const head = commit.trim();
    const diff = await git.run(clone, ['diff', '--binary', `${base}...${head}`], { maxStdoutBytes: 16 * 1024 * 1024 });
    const changedFiles = (await git.run(clone, ['diff', '--name-only', '-z', `${base}...${head}`]))
      .split('\0').filter(Boolean).sort();
    return {
      baseCommit: base,
      commit: head,
      diffHash: createHash('sha256').update(diff).digest('hex'),
      changedFiles,
      targetBranch: targetBranch.trim(),
    };
  }

  async mergeBack(branch: string, expected: WorkspaceEvidence): Promise<MergeResult> {
    try {
      const clone = this.cloneForBranch(branch);
      const git = await this.git;
      const actual = await this.inspect(branch);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) return { success: false, conflictInfo: 'Approved workspace evidence changed' };
      const [currentBranch, currentCommit, controllerStatus] = await Promise.all([
        git.run(this.projectRoot, ['branch', '--show-current']),
        git.run(this.projectRoot, ['rev-parse', 'HEAD']),
        git.run(this.projectRoot, ['status', '--porcelain']),
      ]);
      if (currentBranch.trim() !== expected.targetBranch || currentCommit.trim() !== expected.baseCommit)
        return { success: false, conflictInfo: 'Target branch changed after review' };
      if (controllerStatus.trim()) return { success: false, conflictInfo: 'Controller worktree is dirty' };
      const integrationRef = `refs/orchestry/tasks/${sanitizeId(branch.split('/')[1] ?? '')}`;
      await git.run(this.projectRoot, ['fetch', '--no-tags', clone, `${expected.commit}:${integrationRef}`], { fileProtocol: 'always' });
      const result = await git.run(this.projectRoot, ['merge', '--ff-only', integrationRef], { output: 'result' });
      if (result.ok) return { success: true };
      const output = `${result.stdout}${result.stderr}`.slice(0, 1000);
      if (/CONFLICT|Merge conflict/.test(output)) await git.run(this.projectRoot, ['merge', '--abort'], { output: 'result' });
      return { success: false, conflictInfo: output };
    } catch (error) {
      return { success: false, conflictInfo: error instanceof Error ? error.message : String(error) };
    }
  }

  async cleanup(taskId: string): Promise<void> {
    await fs.rm(path.join(this.workspaceRoot, sanitizeId(taskId)), { recursive: true, force: true });
  }

  validate(workspacePath: string, projectRoot: string): void {
    validateWorkspacePath(workspacePath, projectRoot);
  }

  async getChangedFiles(branch: string): Promise<string[]> {
    try {
      const clone = this.cloneForBranch(branch);
      const git = await this.git;
      const base = (await git.run(clone, ['merge-base', 'HEAD', '@{upstream}'])).trim();
      return (await git.run(clone, ['diff', '--name-only', `${base}...HEAD`])).trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  private resolveMode(task: Task, agent: Agent, config: OrchestratorConfig): WorkspaceMode {
    return task.workspace_mode ?? agent.config.workspace_mode ?? config.defaults.agent.workspace_mode ?? 'worktree';
  }

  private async requireGitRepo(mode: WorkspaceMode): Promise<void> {
    if (!this.gitRepoChecked) {
      try {
        this.gitRepoChecked = (await (await this.git).run(this.projectRoot, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
      } catch {
        this.gitRepoChecked = false;
      }
    }
    if (!this.gitRepoChecked)
      throw new WorkspaceError(
        `workspace_mode "${mode}" requires a git repository`,
        'Run: git init && git add -A && git commit -m "Initial commit"\n         Or set workspace_mode: shared in .orchestry/config.yml',
      );
  }

  private async prepareClone(task: Task): Promise<PrepareResult> {
    const id = sanitizeId(task.id);
    const workspace = path.join(this.workspaceRoot, id);
    const branch = `orchestry/${id}/${sanitizeTitle(task.title) || id}`;
    const git = await this.git;
    const [baseValue, targetValue] = await Promise.all([
      git.run(this.projectRoot, ['rev-parse', 'HEAD']),
      git.run(this.projectRoot, ['branch', '--show-current']),
    ]);
    const base = baseValue.trim();
    const targetBranch = targetValue.trim();
    if (!targetBranch) throw new WorkspaceError('Controller must be on a named branch');
    await fs.mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    try {
      const [existingBranch, status] = await Promise.all([
        git.run(workspace, ['branch', '--show-current']),
        git.run(workspace, ['status', '--porcelain']),
      ]);
      if (existingBranch.trim() !== branch || status.trim()) throw new WorkspaceError('Existing isolated clone is stale or dirty');
      await git.run(workspace, ['merge-base', '--is-ancestor', base, 'HEAD']);
      return { path: workspace, branch, baseCommit: base, targetBranch };
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      await fs.rm(workspace, { recursive: true, force: true });
    }
    try {
      await git.run(this.workspaceRoot, ['clone', '--local', '--no-hardlinks', this.projectRoot, workspace], { fileProtocol: 'always' });
      await git.run(workspace, ['checkout', '-b', branch, base]);
      await git.run(workspace, ['branch', '--set-upstream-to', `origin/${targetBranch}`, branch]);
      await fs.rm(path.join(workspace, '.orchestry'), { recursive: true, force: true });
      return { path: workspace, branch, baseCommit: base, targetBranch };
    } catch (error) {
      await fs.rm(workspace, { recursive: true, force: true });
      throw new WorkspaceError(`Isolated git clone failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private cloneForBranch(branch: string): string {
    const match = /^orchestry\/([A-Za-z0-9._-]+)\//.exec(branch);
    if (!match) throw new WorkspaceError('Invalid isolated clone branch');
    return path.join(this.workspaceRoot, sanitizeId(match[1]!));
  }
}

function sanitizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}
