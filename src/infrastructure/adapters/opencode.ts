/**
 * OpenCode adapter.
 *
 * Spawns `opencode run --format json` in headless mode and pipes prompts via stdin.
 * Parses JSONL events from stdout into AgentEvent stream.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import type { ICommandRunner } from '../process/command-runner.js';
import { createStreamingEvents, buildFullPrompt, buildChildEnv, adapterCommandRunner, probeVersion } from './utils.js';
import { classifyAdapterError } from '../../domain/errors.js';
import { createTokenUsage } from '../../domain/run.js';

export class OpenCodeAdapter implements IAgentAdapter {
  readonly kind = 'opencode';

  private readonly runner: ICommandRunner;

  constructor(private readonly processManager: IProcessManager, runner?: ICommandRunner) {
    this.runner = adapterCommandRunner(processManager, runner);
  }

  async test(): Promise<AdapterTestResult> {
    try {
      return { ok: true, version: await probeVersion(this.runner, 'opencode') };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: 'OpenCode CLI not found. Install: npm i -g opencode',
        errorKind: classifyAdapterError(msg),
      };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const args = [
      'run',
      '--format', 'json',
    ];

    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    const command = this.runner.start({
      executable: 'opencode',
      args,
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal,
      stdin: buildFullPrompt(params.systemPrompt, params.prompt),
      timeoutMs: params.config.timeout_ms,
      owner: params.execution.owner,
      sandbox: params.execution.sandbox,
      allowedExecutables: params.execution.allowedExecutables,
    });

    const events = createStreamingEvents(command, parseOpenCodeEvent, 'OpenCode', params.signal);

    return { pid: command.pid, events };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function parseOpenCodeEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed: Record<string, unknown> = JSON.parse(line);
    const timestamp = new Date().toISOString();
    const type = (parsed.type as string) ?? '';
    const part = (parsed.part as Record<string, unknown>) ?? {};

    switch (type) {
      case 'step_start':
        return null; // lifecycle event — no user-visible content

      case 'text':
        return { type: 'output', timestamp, data: part.text ?? part };

      case 'tool_use': {
        const state = (part.state as Record<string, unknown>) ?? {};
        if (state.status === 'error') {
          const errMsg = typeof state.error === 'string' ? state.error : JSON.stringify(state);
          return { type: 'error', timestamp, data: state, errorKind: classifyAdapterError(errMsg) };
        }
        // Map to { name, input } shape expected by TUI formatToolInput
        return { type: 'tool_call', timestamp, data: { name: part.tool, input: state.input } };
      }

      case 'step_finish': {
        const reason = part.reason as string | undefined;
        const tokens = extractOpenCodeTokens(part);

        if (reason === 'error') {
          const errMsg = typeof part.error === 'string' ? part.error : JSON.stringify(part);
          return { type: 'error', timestamp, data: part, tokens, errorKind: classifyAdapterError(errMsg) };
        }
        if (reason === 'tool-calls') {
          return null; // intermediate lifecycle — tool_use events carry the actual content
        }
        // reason === 'stop', 'max_tokens', or any other terminal reason → done
        return { type: 'done', timestamp, data: part, tokens };
      }

      default:
        return { type: 'output', timestamp, data: parsed };
    }
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: line };
  }
}

/** Extract token usage from opencode step_finish part. */
function extractOpenCodeTokens(part: Record<string, unknown>): import('../../domain/run.js').TokenUsage | undefined {
  const tokens = part.tokens as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens.input !== 'number') return undefined;

  const input = tokens.input;
  const output = typeof tokens.output === 'number' ? tokens.output : 0;
  const reasoning = typeof tokens.reasoning === 'number' ? tokens.reasoning : 0;
  return createTokenUsage(input, output, { reasoning });
}
