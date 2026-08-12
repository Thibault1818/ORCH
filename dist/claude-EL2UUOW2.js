import { adapterCommandRunner, probeVersion, buildFullPrompt, buildChildEnv, createStreamingEvents, extractTokens } from './chunk-GZNNMHER.js';
import './chunk-W5CCIQAE.js';
import './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-Z7JNYNWE.js';
import './chunk-OBMT332P.js';

// src/infrastructure/adapters/claude.ts
var ClaudeAdapter = class {
  constructor(processManager, runner) {
    this.processManager = processManager;
    this.runner = adapterCommandRunner(processManager, runner);
  }
  processManager;
  kind = "claude";
  runner;
  async test() {
    try {
      return { ok: true, version: await probeVersion(this.runner, "claude") };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "Claude Code CLI not found. Install: npm i -g @anthropic-ai/claude-code",
        errorKind: classifyAdapterError(msg)
      };
    }
  }
  execute(params) {
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--max-turns",
      String(params.config.max_turns ?? 50),
      "--verbose"
    ];
    if (params.security?.allowPermissionBypass === true) {
      args.push("--dangerously-skip-permissions");
    }
    if (params.config.model) {
      args.push("--model", params.config.model);
    }
    if (params.config.effort) {
      args.push("--effort", params.config.effort);
    }
    const effectiveSystemPrompt = params.systemPrompt ?? params.config.system_prompt;
    const command = this.runner.start({
      executable: "claude",
      args,
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal,
      stdin: buildFullPrompt(effectiveSystemPrompt, params.prompt),
      timeoutMs: params.config.timeout_ms,
      owner: params.execution.owner,
      sandbox: params.execution.sandbox,
      allowedExecutables: params.execution.allowedExecutables
    });
    const events = createStreamingEvents(command, parseClaudeEvent, "Claude", params.signal);
    return { pid: command.pid, events };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};
function parseClaudeEvent(line) {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    switch (parsed.type) {
      case "assistant":
        return { type: "output", timestamp, data: parsed.message ?? parsed };
      case "tool_use":
        return { type: "tool_call", timestamp, data: parsed };
      case "tool_result":
        return { type: "output", timestamp, data: parsed };
      case "error": {
        const errData = parsed.error ?? parsed;
        const errMsg = typeof errData === "string" ? errData : JSON.stringify(errData);
        return { type: "error", timestamp, data: errData, errorKind: classifyAdapterError(errMsg) };
      }
      case "result": {
        const tokens = extractTokens(parsed, { statsFallback: true });
        return { type: "done", timestamp, data: parsed, tokens };
      }
      default:
        return { type: "output", timestamp, data: parsed };
    }
  } catch {
    return { type: "output", timestamp: (/* @__PURE__ */ new Date()).toISOString(), data: line };
  }
}

export { ClaudeAdapter };
//# sourceMappingURL=claude-EL2UUOW2.js.map
//# sourceMappingURL=claude-EL2UUOW2.js.map