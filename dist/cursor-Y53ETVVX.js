import { adapterCommandRunner, buildFullPrompt, buildChildEnv, createStreamingEvents, extractTokens, probeVersion } from './chunk-GZNNMHER.js';
import './chunk-W5CCIQAE.js';
import './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-Z7JNYNWE.js';
import './chunk-OBMT332P.js';

// src/infrastructure/adapters/cursor.ts
async function findCommand(runner) {
  for (const cmd of ["cursor-agent", "agent"]) {
    try {
      return { command: cmd, version: await probeVersion(runner, cmd) };
    } catch {
    }
  }
  return null;
}
var CursorAdapter = class {
  constructor(processManager, runner) {
    this.processManager = processManager;
    this.runner = adapterCommandRunner(processManager, runner);
  }
  processManager;
  kind = "cursor";
  resolvedCommand = "cursor-agent";
  runner;
  async test() {
    const found = await findCommand(this.runner);
    if (found) {
      this.resolvedCommand = found.command;
      return { ok: true, version: found.version };
    }
    return {
      ok: false,
      error: "Cursor Agent CLI not found. The headless agent CLI is required (cursor-agent or agent).",
      errorKind: "adapter_not_found" /* ADAPTER_NOT_FOUND */
    };
  }
  execute(params) {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--workspace",
      params.workspace
    ];
    if (params.security?.allowPermissionBypass === true) {
      args.push("--yolo");
    }
    if (params.config.model) {
      args.push("--model", params.config.model);
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
      allowedExecutables: params.execution.allowedExecutables
    });
    const events = createStreamingEvents(command, parseCursorEvent, "Cursor agent", params.signal);
    return { pid: command.pid, events };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};
function parseCursorEvent(line) {
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
        const tokens = extractTokens(parsed);
        return { type: "done", timestamp, data: parsed, tokens };
      }
      default:
        return { type: "output", timestamp, data: parsed };
    }
  } catch {
    return { type: "output", timestamp: (/* @__PURE__ */ new Date()).toISOString(), data: line };
  }
}

export { CursorAdapter };
//# sourceMappingURL=cursor-Y53ETVVX.js.map
//# sourceMappingURL=cursor-Y53ETVVX.js.map