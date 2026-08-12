/**
 * Cursor Agent adapter.
 *
 * Spawns `cursor-agent` (Cursor's headless agent CLI) with `--output-format stream-json`.
 * Falls back to `agent` command if `cursor-agent` is not found.
 * Parses JSON-lines from stdout into AgentEvent stream.
 *
 * Note: This requires Cursor Agent CLI, not the regular `cursor` IDE command.
 * Install via: npm i -g @anthropic-ai/cursor-agent (when available)
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import type { ICommandRunner } from '../process/command-runner.js';
import { extractTokens, createStreamingEvents, buildFullPrompt, buildChildEnv, adapterCommandRunner, probeVersion } from './utils.js';
import { classifyAdapterError, AdapterErrorKind } from '../../domain/errors.js';
/** Try multiple command names and return the first that works */
async function findCommand(runner: ICommandRunner): Promise<{ command: string; version: string } | null> {
  for (const cmd of ['cursor-agent', 'agent']) {
    try {
      return { command: cmd, version: await probeVersion(runner, cmd) };
    } catch {
      // try next
    }
  }
  return null;
}

export class CursorAdapter implements IAgentAdapter {
  readonly kind = 'cursor';

  private resolvedCommand: string = 'cursor-agent';

  private readonly runner: ICommandRunner;

  constructor(private readonly processManager: IProcessManager, runner?: ICommandRunner) {
    this.runner = adapterCommandRunner(processManager, runner);
  }

  async test(): Promise<AdapterTestResult> {
    const found = await findCommand(this.runner);
    if (found) {
      this.resolvedCommand = found.command;
      return { ok: true, version: found.version };
    }
    return {
      ok: false,
      error: 'Cursor Agent CLI not found. The headless agent CLI is required (cursor-agent or agent).',
      errorKind: AdapterErrorKind.ADAPTER_NOT_FOUND,
    };
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--workspace', params.workspace,
    ];

    if (params.security?.allowPermissionBypass === true) {
      args.push('--yolo');
    }

    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    const command = this.runner.start({
      executable: this.resolvedCommand,
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

    const events = createStreamingEvents(command, parseCursorEvent, 'Cursor agent', params.signal);

    return { pid: command.pid, events };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function parseCursorEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed: Record<string, unknown> = JSON.parse(line);
    const timestamp = new Date().toISOString();

    // Cursor stream-json uses the same format as Claude stream-json
    switch (parsed.type) {
      case 'assistant':
        return { type: 'output', timestamp, data: (parsed.message as unknown) ?? parsed };
      case 'tool_use':
        return { type: 'tool_call', timestamp, data: parsed };
      case 'tool_result':
        return { type: 'output', timestamp, data: parsed };
      case 'error': {
        const errData = (parsed.error as unknown) ?? parsed;
        const errMsg = typeof errData === 'string' ? errData : JSON.stringify(errData);
        return { type: 'error', timestamp, data: errData, errorKind: classifyAdapterError(errMsg) };
      }
      case 'result': {
        const tokens = extractTokens(parsed);
        return { type: 'done', timestamp, data: parsed, tokens };
      }
      default:
        return { type: 'output', timestamp, data: parsed };
    }
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: line };
  }
}
