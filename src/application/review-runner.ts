/**
 * ReviewRunner — automatic review of completed tasks.
 *
 * Executes review criteria (test_pass, typecheck, lint) as commands
 * and returns pass/fail results. Used by the orchestrator to auto-approve
 * tasks that have review_criteria defined.
 *
 * Staged evaluation: criteria are sorted by speed (typecheck → test → lint)
 * and execution stops on first failure (fail-fast) to save compute.
 */

import os from 'node:os';
import path from 'node:path';
import type { ReviewCriterion, ReviewResult } from '../domain/task.js';
import { commandFailureMessage, type ExecutableDescriptor, type ICommandRunner } from '../infrastructure/process/command-runner.js';
import { sanitizeText } from '../infrastructure/security/redaction.js';

const CRITERION_COMMANDS: Record<ReviewCriterion, { executable: keyof ReviewRunnerExecutables; args: string[] }> = {
  test_pass: { executable: 'npm', args: ['test'] },
  typecheck: { executable: 'npx', args: ['tsc', '--noEmit'] },
  lint: { executable: 'npm', args: ['run', 'lint'] },
};

/** Execution order: fastest checks first. */
const CRITERION_ORDER: readonly ReviewCriterion[] = ['typecheck', 'lint', 'test_pass'];

export interface ReviewRunnerOptions {
  cwd: string;
  timeout_ms?: number;
  /** When true, stop on first failed criterion (default: true). */
  fail_fast?: boolean;
}

export interface ReviewRunnerExecutables {
  npm: ExecutableDescriptor;
  npx: ExecutableDescriptor;
  node: ExecutableDescriptor;
}

export interface ReviewRunnerSafeguards {
  assertReady(): Promise<unknown>;
  executableAllowlist(extra?: readonly string[]): Promise<ExecutableDescriptor[]>;
  proxyEndpoint(): Promise<{ host: string; port: number }>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

export class ReviewRunner {
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly failFast: boolean;
  private readonly env: Readonly<NodeJS.ProcessEnv>;

  constructor(
    options: ReviewRunnerOptions,
    private readonly commandRunner: ICommandRunner,
    private readonly executables: ReviewRunnerExecutables,
    private readonly safeguards: ReviewRunnerSafeguards,
    private readonly owner: string,
  ) {
    this.cwd = path.resolve(options.cwd);
    this.timeoutMs = bounded(options.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 'timeout_ms');
    this.failFast = options.fail_fast ?? true;
    for (const executable of Object.values(executables)) validateDescriptor(executable);
    this.env = reviewEnvironment(executables);
  }

  /**
   * Run criteria in staged order (typecheck → lint → test).
   * In fail-fast mode (default), stops on first failure.
   */
  async runAll(criteria: ReviewCriterion[]): Promise<ReviewResult[]> {
    const sorted = sortCriteria(criteria);
    const results: ReviewResult[] = [];

    for (const criterion of sorted) {
      const result = await this.runCriterion(criterion);
      results.push(result);
      if (this.failFast && !result.passed) break;
    }

    return results;
  }

  /**
   * Check if all results passed.
   */
  static allPassed(results: ReviewResult[]): boolean {
    return results.length > 0 && results.every((r) => r.passed);
  }

  /**
   * Format results into a human-readable report.
   */
  static formatReport(results: ReviewResult[]): string {
    const lines = results.map((r) => {
      const icon = r.passed ? '✓' : '✗';
      const truncated = r.output;
      return `${icon} ${r.criterion}: ${r.passed ? 'PASSED' : 'FAILED'}\n  ${truncated}`;
    });
    return lines.join('\n\n');
  }

  private async runCriterion(criterion: ReviewCriterion): Promise<ReviewResult> {
    const { executable, args } = CRITERION_COMMANDS[criterion];
    try {
      await this.safeguards.assertReady();
      const allowedExecutables = await this.safeguards.executableAllowlist();
      const proxyAddress = await this.safeguards.proxyEndpoint();
      const result = await this.commandRunner.run({
        executable: this.executables[executable],
        args,
        cwd: this.cwd,
        env: this.env,
        timeoutMs: this.timeoutMs,
        maxStdoutBytes: MAX_COMMAND_OUTPUT_BYTES,
        maxStderrBytes: MAX_COMMAND_OUTPUT_BYTES,
        owner: this.owner,
        allowedExecutables,
        sandbox: {
          workspace: this.cwd,
          proxyAddress,
          writableWorkspace: true,
          readOnlyFiles: allowedExecutables.map((value) => value.realpath),
        },
      });
      const output = `${result.stdout}\n${result.stderr}`.trim() || (result.ok ? '' : commandFailureMessage(result));
      return {
        criterion,
        passed: result.ok,
        output: sanitizeText(output).slice(0, 2000),
      };
    } catch (error) {
      return {
        criterion,
        passed: false,
        output: sanitizeText(error instanceof Error ? error.message : String(error)).slice(0, 2000),
      };
    }
  }
}

function reviewEnvironment(executables: ReviewRunnerExecutables): NodeJS.ProcessEnv {
  const tempRoot = path.join(os.tmpdir(), 'orch-review');
  const pathEntries = [
    path.dirname(executables.node.path),
    path.dirname(executables.node.realpath),
    ...[executables.npm, executables.npx].flatMap((value) => [path.dirname(value.path), path.dirname(value.realpath)]),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  return {
    PATH: [...new Set(pathEntries)].join(path.delimiter),
    HOME: tempRoot,
    XDG_CONFIG_HOME: path.join(tempRoot, 'xdg-config'),
    XDG_CACHE_HOME: path.join(tempRoot, 'xdg-cache'),
    NPM_CONFIG_CACHE: path.join(tempRoot, 'npm-cache'),
    NPM_CONFIG_USERCONFIG: path.join(tempRoot, 'npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(tempRoot, 'global-npmrc'),
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    CI: '1',
    NO_COLOR: '1',
  };
}

function validateDescriptor(value: ExecutableDescriptor): void {
  if (!path.isAbsolute(value.path) || !path.isAbsolute(value.realpath) || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error('ReviewRunner requires absolute pinned executable descriptors');
  }
}

function bounded(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

/** Sort criteria by CRITERION_ORDER (fastest first). */
function sortCriteria(criteria: ReviewCriterion[]): ReviewCriterion[] {
  return [...criteria].sort((a, b) => {
    const ai = CRITERION_ORDER.indexOf(a);
    const bi = CRITERION_ORDER.indexOf(b);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });
}
