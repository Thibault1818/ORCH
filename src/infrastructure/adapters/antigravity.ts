/**
 * Antigravity CLI adapter.
 *
 * Generic execution intentionally fails closed before spawning a process until
 * stdin prompt transport is proven for a supported Antigravity CLI version.
 * Passing a prompt with `-p` would expose it in argv and is therefore prohibited.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import type { ICommandRunner } from '../process/command-runner.js';
import { adapterCommandRunner, buildChildEnv, probeVersion } from './utils.js';
import { classifyAdapterError } from '../../domain/errors.js';

export class AntigravityAdapter implements IAgentAdapter {
  readonly kind = 'antigravity';

  private readonly runner: ICommandRunner;

  constructor(private readonly processManager: IProcessManager, runner?: ICommandRunner) {
    this.runner = adapterCommandRunner(processManager, runner);
  }

  async test(): Promise<AdapterTestResult> {
    try {
      return { ok: true, version: await probeVersion(this.runner, 'agy', buildChildEnv()) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: 'Antigravity CLI not found. Install Google Antigravity CLI and ensure `agy` is on PATH.',
        errorKind: classifyAdapterError(msg),
      };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    void params;
    throw new Error('Antigravity execution is disabled: supported stdin prompt transport is not proven and argv prompt transport is prohibited');
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}
