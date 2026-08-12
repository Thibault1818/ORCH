/**
 * Shell adapter.
 *
 * Spawns an arbitrary command via `bash -lc`.
 * Task metadata is passed via environment variables; prompt text is not.
 * Consumes stdout and stderr concurrently to avoid deadlocks.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import type { ICommandRunner } from '../process/command-runner.js';
import { streamingCommandFailureMessage } from '../process/command-runner.js';
import { adapterCommandRunner, buildChildEnv, probeVersion } from './utils.js';
import { readLines } from '../process/process-manager.js';
import { EventBuffer } from './event-buffer.js';
import { classifyAdapterError, AdapterErrorKind } from '../../domain/errors.js';

export class ShellAdapter implements IAgentAdapter {
  readonly kind = 'shell';

  private readonly runner: ICommandRunner;

  constructor(private readonly processManager: IProcessManager, runner?: ICommandRunner) {
    this.runner = adapterCommandRunner(processManager, runner);
  }

  async test(): Promise<AdapterTestResult> {
    try {
      const version = (await probeVersion(this.runner, 'bash')).split('\n')[0]?.trim() ?? 'unknown';
      return { ok: true, version };
    } catch {
      return { ok: false, error: 'bash not found', errorKind: classifyAdapterError('bash not found') };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    if (params.security?.allowShellAdapter !== true) {
      async function* errorGen(): AsyncGenerator<AgentEvent> {
        const err = Object.assign(
          new Error('Shell adapter is disabled. Set execution.security.allow_shell_adapter=true to opt in.'),
          { errorKind: AdapterErrorKind.SPAWN_FAILED },
        );
        throw err;
      }
      return { pid: 0, events: errorGen() };
    }

    const command = params.config.command;
    if (!command) {
      async function* errorGen(): AsyncGenerator<AgentEvent> {
        const err = Object.assign(
          new Error('Shell adapter requires a command in agent config'),
          { errorKind: AdapterErrorKind.SPAWN_FAILED },
        );
        throw err;
      }
      return { pid: 0, events: errorGen() };
    }

    const started = this.runner.start({
      executable: 'bash',
      args: ['-lc', command],
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal,
      timeoutMs: params.config.timeout_ms,
      owner: params.execution.owner,
      sandbox: params.execution.sandbox,
      allowedExecutables: params.execution.allowedExecutables,
    });
    const proc = started.process;
    const pid = started.pid;

    const signal = params.signal;
    const processManager = this.processManager;

    async function* generateEvents(): AsyncGenerator<AgentEvent> {
      // Ring buffer with backpressure replaces Array.shift() polling
      const buffer = new EventBuffer();

      // Ensure process is reaped on abort — SIGTERM + grace period + SIGKILL
      const onAbort = () => {
        processManager.killWithGrace(pid, 5_000).catch(() => {});
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      const stdoutPromise = (async () => {
        if (!proc.stdout) return;
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          await buffer.push({
            type: 'output',
            timestamp: new Date().toISOString(),
            data: line,
          });
        }
      })();

      const stderrPromise = (async () => {
        if (!proc.stderr) return;
        for await (const line of readLines(proc.stderr)) {
          if (signal?.aborted) break;
          await buffer.push({
            type: 'error',
            timestamp: new Date().toISOString(),
            data: line,
            errorKind: classifyAdapterError(line),
          });
        }
      })();

      // Close the buffer once both streams are drained (or on error)
      void Promise.all([stdoutPromise, stderrPromise]).then(
        () => buffer.close(),
        () => buffer.close(),
      );

      // Yield events as they arrive — no polling, no busy-wait
      yield* buffer;

      // Clean up abort listener
      if (signal && !signal.aborted) {
        signal.removeEventListener('abort', onAbort);
      }

      const completion = await started.completion;
      if (!completion.ok && !signal?.aborted) {
        throw new Error(completion.termination === 'exited'
          ? `Shell command exited with code ${completion.exitCode}`
          : streamingCommandFailureMessage(completion, 'Shell command'));
      }
    }

    return { pid, events: generateEvents() };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}
