/**
 * Doctor service — diagnostics and health checks.
 *
 * Checks adapter availability, system dependencies, project state.
 */

import type { AdapterRegistry } from '../infrastructure/adapters/registry.js';
import type { ExecutableDescriptor, ICommandRunner } from '../infrastructure/process/command-runner.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'fail' | 'skip';
  detail?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  adaptersReady: number;
  adaptersTotal: number;
}

export interface DoctorExecutables {
  git?: ExecutableDescriptor;
  node?: ExecutableDescriptor;
}

export class DoctorService {
  private readonly cwd: string;

  constructor(
    private readonly adapterRegistry: AdapterRegistry,
    private readonly commandRunner: ICommandRunner,
    private readonly executables: DoctorExecutables,
    projectRoot?: string,
  ) {
    this.cwd = path.resolve(projectRoot ?? process.cwd());
    for (const executable of Object.values(executables)) {
      if (executable) validateDescriptor(executable);
    }
  }

  async runAll(): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [];

    // Check adapters
    const adapters = this.adapterRegistry.list();
    let adaptersReady = 0;

    for (const adapter of adapters) {
      const result = await adapter.test();
      if (result.ok) {
        adaptersReady++;
        checks.push({
          name: adapter.kind,
          status: 'ok',
          detail: result.version,
        });
      } else {
        checks.push({
          name: adapter.kind,
          status: 'fail',
          detail: result.error,
        });
      }
    }

    // Check git
    checks.push(await this.checkCommand(this.executables.git, ['--version'], 'git', 'git'));

    // Check git repository (required for worktree/isolated workspace modes)
    checks.push(await this.checkGitRepo());

    // Check .orchestry in root .gitignore (prevents recursive worktrees)
    checks.push(await this.checkGitignore());

    // Check node
    checks.push(await this.checkCommand(this.executables.node, ['--version'], 'node', 'node'));

    return {
      checks,
      adaptersReady,
      adaptersTotal: adapters.length,
    };
  }

  private async checkCommand(
    executable: ExecutableDescriptor | undefined,
    args: readonly string[],
    name: string,
    commandName: string,
  ): Promise<DoctorCheck> {
    if (!executable) return { name, status: 'fail', detail: `${commandName}: command not found` };
    try {
      const result = await this.commandRunner.run({
        executable,
        args,
        env: doctorEnvironment(executable),
        timeoutMs: COMMAND_TIMEOUT_MS,
        maxStdoutBytes: MAX_COMMAND_OUTPUT_BYTES,
        maxStderrBytes: MAX_COMMAND_OUTPUT_BYTES,
      });
      if (!result.ok) return { name, status: 'fail', detail: `${commandName}: command not found` };
      return { name, status: 'ok', detail: result.stdout.trim() };
    } catch {
      return { name, status: 'fail', detail: `${commandName}: command not found` };
    }
  }

  private async checkGitignore(): Promise<DoctorCheck> {
    const gitignorePath = path.join(this.cwd, '.gitignore');
    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      const hasEntry = content.split('\n').some((line) => line.trim() === '.orchestry');
      if (hasEntry) {
        return { name: '.gitignore', status: 'ok', detail: '.orchestry is excluded' };
      }
      return {
        name: '.gitignore',
        status: 'fail',
        detail: '.orchestry not in .gitignore — worktrees will copy state recursively. Run: orch init',
      };
    } catch {
      return {
        name: '.gitignore',
        status: 'fail',
        detail: 'no .gitignore found — .orchestry may be committed to git. Run: orch init',
      };
    }
  }

  private async checkGitRepo(): Promise<DoctorCheck> {
    const git = this.executables.git;
    if (!git) return this.gitRepoFailure();
    try {
      const result = await this.commandRunner.run({
        executable: git,
        args: ['rev-parse', '--is-inside-work-tree'],
        cwd: this.cwd,
        env: doctorEnvironment(git),
        timeoutMs: COMMAND_TIMEOUT_MS,
        maxStdoutBytes: MAX_COMMAND_OUTPUT_BYTES,
        maxStderrBytes: MAX_COMMAND_OUTPUT_BYTES,
      });
      if (!result.ok) return this.gitRepoFailure();
      return { name: 'git repo', status: 'ok', detail: 'git repository detected' };
    } catch {
      return this.gitRepoFailure();
    }
  }

  private gitRepoFailure(): DoctorCheck {
    return {
      name: 'git repo',
      status: 'fail',
      detail: 'not a git repository — worktree/isolated modes will fail. Run: git init',
    };
  }
}

function doctorEnvironment(executable: ExecutableDescriptor): NodeJS.ProcessEnv {
  return {
    PATH: [...new Set([path.dirname(executable.path), path.dirname(executable.realpath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(path.delimiter),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    NO_COLOR: '1',
  };
}

function validateDescriptor(value: ExecutableDescriptor): void {
  if (!path.isAbsolute(value.path) || !path.isAbsolute(value.realpath) || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error('DoctorService requires absolute pinned executable descriptors');
  }
}
