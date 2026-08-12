/**
 * Claude Code adapter.
 *
 * Spawns `claude --print --output-format stream-json` in headless mode.
 * Prompt is piped via stdin instead of argv.
 * Parses JSON-lines from stdout into AgentEvent stream.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import type { ICommandRunner } from '../process/command-runner.js';
import { extractTokens, createStreamingEvents, buildChildEnv, buildFullPrompt, adapterCommandRunner, probeVersion } from './utils.js';
import { classifyAdapterError } from '../../domain/errors.js';

export class ClaudeAdapter implements IAgentAdapter {
  readonly kind = 'claude';

  private readonly runner: ICommandRunner;

  constructor(private readonly processManager: IProcessManager, runner?: ICommandRunner) {
    this.runner = adapterCommandRunner(processManager, runner);
  }

  async test(): Promise<AdapterTestResult> {
    try {
      return { ok: true, version: await probeVersion(this.runner, 'claude') };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: 'Claude Code CLI not found. Install: npm i -g @anthropic-ai/claude-code',
        errorKind: classifyAdapterError(msg),
      };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--max-turns', String(params.config.max_turns ?? 50),
      '--verbose',
    ];

    if (params.security?.allowPermissionBypass === true) {
      args.push('--dangerously-skip-permissions');
    }

    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    if (params.config.effort) {
      args.push('--effort', params.config.effort);
    }

    // Keep both system and user prompts out of argv.
    const effectiveSystemPrompt = params.systemPrompt ?? params.config.system_prompt;

    const command = this.runner.start({
      executable: 'claude',
      args,
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal,
      stdin: buildFullPrompt(effectiveSystemPrompt, params.prompt),
      timeoutMs: params.config.timeout_ms,
      owner: params.execution.owner,
      sandbox: params.execution.sandbox,
      allowedExecutables: params.execution.allowedExecutables,
    });

    const events = createStreamingEvents(command, parseClaudeEvent, 'Claude', params.signal);

    return { pid: command.pid, events };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function parseClaudeEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed: Record<string, unknown> = JSON.parse(line);
    const timestamp = new Date().toISOString();

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
        const tokens = extractTokens(parsed, { statsFallback: true });
        return { type: 'done', timestamp, data: parsed, tokens };
      }
      default:
        return { type: 'output', timestamp, data: parsed };
    }
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: line };
  }
}
