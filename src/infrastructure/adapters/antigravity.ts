/**
 * Antigravity CLI adapter.
 *
 * Generic execution intentionally fails closed before spawning a process until
 * stdin prompt transport is proven for a supported Antigravity CLI version.
 * Passing a prompt with `-p` would expose it in argv and is therefore prohibited.
 */

import type { ChildProcess } from 'node:child_process';
import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { readLines } from '../process/process-manager.js';
import { buildChildEnv } from './utils.js';
import { classifyAdapterError } from '../../domain/errors.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class AntigravityAdapter implements IAgentAdapter {
  readonly kind = 'antigravity';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    try {
      const { stdout } = await execFileAsync('agy', ['--version'], { env: buildChildEnv() });
      return { ok: true, version: stdout.trim() };
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

// Retained and unit-tested independently for a future secure transport implementation.
function createAntigravityEvents(proc: ChildProcess, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  async function* generate(): AsyncGenerator<AgentEvent> {
    let finalText = '';

    let exitCode: number | null = null;
    let exitError: Error | null = null;
    const exitPromise = new Promise<void>((resolve) => {
      proc.on('close', (code) => { exitCode = code; resolve(); });
      proc.on('error', (err) => { exitError = err; resolve(); });
    });

    if (proc.stdout) {
      try {
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          finalText += finalText ? `\n${line}` : line;
          yield {
            type: 'output',
            timestamp: new Date().toISOString(),
            data: { text: line },
          };
        }
      } finally {
        proc.stdout.destroy();
      }
    }

    await exitPromise;

    if (exitError && !signal?.aborted) {
      const spawnErr = exitError as Error;
      throw Object.assign(new Error(spawnErr.message), {
        errorKind: classifyAdapterError(spawnErr.message, exitCode ?? undefined),
      });
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted) {
      const msg = `Antigravity process exited with code ${exitCode}`;
      throw Object.assign(new Error(msg), {
        errorKind: classifyAdapterError(msg, exitCode),
      });
    }
    if (!signal?.aborted) {
      yield {
        type: 'done',
        timestamp: new Date().toISOString(),
        data: { result: finalText },
      };
    }
  }

  return generate();
}
