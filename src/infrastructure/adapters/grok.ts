/**
 * Grok CLI adapter.
 *
 * Generic execution intentionally fails closed before spawning a process until
 * stdin prompt transport is proven for a supported Grok CLI version. Passing a
 * prompt with `-p` would expose it in argv and is therefore prohibited.
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
const OUTPUT_CHUNK_LEN = 240;

export class GrokAdapter implements IAgentAdapter {
  readonly kind = 'grok';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    try {
      const { stdout } = await execFileAsync('grok', ['--version'], { env: buildChildEnv() });
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: 'Grok CLI not found. Install and authenticate the grok CLI, then ensure `grok` is on PATH.',
        errorKind: classifyAdapterError(msg),
      };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    void params;
    throw new Error('Grok execution is disabled: supported stdin prompt transport is not proven and argv prompt transport is prohibited');
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

// Retained and unit-tested independently for a future secure transport implementation.
function createGrokEvents(proc: ChildProcess, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  async function* generate(): AsyncGenerator<AgentEvent> {
    let gotDoneEvent = false;
    let textBuffer = '';
    let finalText = '';

    let exitCode: number | null = null;
    let exitError: Error | null = null;
    const exitPromise = new Promise<void>((resolve) => {
      proc.on('close', (code) => { exitCode = code; resolve(); });
      proc.on('error', (err) => { exitError = err; resolve(); });
    });

    const flushOutput = function* (): Generator<AgentEvent> {
      if (!textBuffer) return;
      const chunk = textBuffer;
      textBuffer = '';
      yield {
        type: 'output',
        timestamp: new Date().toISOString(),
        data: { text: chunk },
      };
    };

    if (proc.stdout) {
      try {
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          const event = parseGrokEvent(line, {
            appendText: (text) => {
              textBuffer += text;
              finalText += text;
            },
            finalText: () => finalText,
          });
          if (!event) {
            if (textBuffer.length >= OUTPUT_CHUNK_LEN) {
              yield* flushOutput();
            }
            continue;
          }
          if (event.type === 'done') {
            yield* flushOutput();
            gotDoneEvent = true;
          }
          yield event;
        }
      } finally {
        proc.stdout.destroy();
      }
    }

    await exitPromise;

    if (!gotDoneEvent && !signal?.aborted) {
      yield* flushOutput();
    }

    if (exitError && !signal?.aborted && !gotDoneEvent) {
      const spawnErr = exitError as Error;
      throw Object.assign(new Error(spawnErr.message), {
        errorKind: classifyAdapterError(spawnErr.message, exitCode ?? undefined),
      });
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
      const msg = `Grok process exited with code ${exitCode}`;
      throw Object.assign(new Error(msg), {
        errorKind: classifyAdapterError(msg, exitCode),
      });
    }
    if (!gotDoneEvent && !signal?.aborted && exitCode === 0) {
      yield {
        type: 'done',
        timestamp: new Date().toISOString(),
        data: { result: finalText },
      };
    }
  }

  return generate();
}

function parseGrokEvent(
  line: string,
  state: { appendText: (text: string) => void; finalText: () => string },
): AgentEvent | null {
  if (!line.trim()) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: { text: line } };
  }

  const timestamp = new Date().toISOString();
  const type = typeof parsed.type === 'string' ? parsed.type : '';

  switch (type) {
    case 'thought':
      return null;

    case 'text':
      if (typeof parsed.data === 'string') {
        state.appendText(parsed.data);
      }
      return null;

    case 'tool_call':
    case 'tool_use':
      return { type: 'tool_call', timestamp, data: parsed };

    case 'tool_result':
      return { type: 'output', timestamp, data: parsed };

    case 'error': {
      const message = typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed);
      return { type: 'error', timestamp, data: parsed, errorKind: classifyAdapterError(message) };
    }

    case 'end':
      return { type: 'done', timestamp, data: { result: state.finalText(), raw: parsed } };

    default:
      return { type: 'output', timestamp, data: parsed };
  }
}
