import { readLines } from './chunk-W5CCIQAE.js';
import { createTokenUsage } from './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-Z7JNYNWE.js';
import { CommandRunner, commandFailureMessage, streamingCommandFailureMessage } from './chunk-OBMT332P.js';

// src/infrastructure/adapters/utils.ts
var PARENT_ENV_ALLOWLIST = /* @__PURE__ */ new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "TERM",
  "COLORTERM",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME"
]);
var ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
var EXPLICIT_ENV_DENYLIST = /* @__PURE__ */ new Set([
  "PATH",
  "NODE_PATH",
  "NODE_OPTIONS",
  "BASH_ENV",
  "ENV",
  "GIT_CONFIG",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_COUNT",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "PERL5OPT",
  "PERL5LIB"
]);
function isSafeExplicitEnvName(key) {
  const upper = key.toUpperCase();
  return ENV_NAME_RE.test(key) && !EXPLICIT_ENV_DENYLIST.has(upper) && !upper.startsWith("LD_") && !upper.startsWith("DYLD_") && !upper.startsWith("NPM_CONFIG_") && !upper.startsWith("GIT_CONFIG_KEY_") && !upper.startsWith("GIT_CONFIG_VALUE_");
}
function buildFullPrompt(systemPrompt, userPrompt) {
  return systemPrompt ? systemPrompt + "\n\n" + userPrompt : userPrompt;
}
function buildChildEnv(explicitEnv, extraEnv) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if ((PARENT_ENV_ALLOWLIST.has(key) || key.startsWith("LC_")) && value !== void 0) {
      env[key] = value;
    }
  }
  for (const source of [explicitEnv, extraEnv]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (isSafeExplicitEnvName(key)) env[key] = value;
    }
  }
  return env;
}
function adapterCommandRunner(processManager, runner) {
  if (runner) return runner;
  const candidate = processManager;
  if (typeof candidate.run === "function" && typeof candidate.start === "function") return candidate;
  return new CommandRunner(processManager);
}
async function probeVersion(runner, command, env = buildChildEnv()) {
  const executable = runner.resolveExecutable ? await runner.resolveExecutable(command, env.PATH ?? process.env.PATH ?? "") : command;
  const result = await runner.run({
    executable,
    args: ["--version"],
    env,
    timeoutMs: 5e3,
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 1024 * 1024
  });
  if (!result.ok) throw new Error(commandFailureMessage(result));
  return result.stdout.trim();
}
function extractTokens(parsed, opts) {
  let usage = parsed.usage;
  if (!usage && opts?.statsFallback) {
    const stats = parsed.stats;
    usage = stats?.usage;
  }
  if (usage && typeof usage.input_tokens === "number") {
    const input = usage.input_tokens;
    const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    const reasoning = typeof usage.reasoning_tokens === "number" ? usage.reasoning_tokens : 0;
    const cache_read = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
    const cache_write = typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0;
    return createTokenUsage(input, output, { reasoning, cache_read, cache_write });
  }
  return void 0;
}
function createStreamingEvents(command, parseEvent, adapterName, signal) {
  async function* generate() {
    let gotDoneEvent = false;
    const proc = command.process;
    if (proc.stdout) {
      try {
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          const event = parseEvent(line);
          if (event) {
            if (event.type === "done") gotDoneEvent = true;
            yield event;
          }
        }
      } finally {
        proc.stdout.destroy();
      }
    }
    const completion = await command.completion;
    if (!completion.ok && !signal?.aborted && !gotDoneEvent) {
      const detail = streamingCommandFailureMessage(completion, adapterName);
      const classified = classifyAdapterError(detail, completion.exitCode ?? void 0);
      const msg = completion.termination === "exited" ? `${adapterName} process exited with code ${completion.exitCode}` : detail;
      const err = Object.assign(new Error(msg), { errorKind: classified });
      throw err;
    }
  }
  return generate();
}

export { adapterCommandRunner, buildChildEnv, buildFullPrompt, createStreamingEvents, extractTokens, probeVersion };
//# sourceMappingURL=chunk-GZNNMHER.js.map
//# sourceMappingURL=chunk-GZNNMHER.js.map