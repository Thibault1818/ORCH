import { buildChildEnv } from './chunk-RFV7B6JD.js';
import './chunk-UG72A2JI.js';
import './chunk-Z7JNYNWE.js';
import { validateExplicitChecks } from './chunk-D6YHC656.js';
import { hashCanonical } from './chunk-3R3KVGGX.js';
import './chunk-54K3JU53.js';
import './chunk-RQZGDMFG.js';
import './chunk-UGPJGAIN.js';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
var NativeCodexWorkflowAdapter = class {
  constructor(pm) {
    this.pm = pm;
  }
  pm;
  decide(passport, stage, evidence, thread, observe = async () => {
  }) {
    const instruction = "Return only strict JSON with schema_version 2, job_id, action DISPATCH_OPUS|ACCEPT|CORRECT_OPUS|CONSULT_FABLE|PAUSE|STOP, summary, implementation_brief, required_changes, risk_level low|medium|high, fable_query, reviewed_commit, fable_advice_disposition, fable_error, fable_iteration_effect. Use fable_query:null normally. Set the three Fable outcome fields to null except after a Fable consultation; then record accepted|rejected, any explicit error or null, and avoided|added|unchanged iteration effect. CONSULT_FABLE is exceptional, low-risk, advisory-only, and requires purpose, question, verification_method, and fallback_if_skipped. Never ask Fable about repository facts, security, architecture, merge approval, or irreversible decisions.";
    return this.call(
      instruction,
      { stage, passport: project(passport), ...evidence },
      passport,
      thread,
      evidence.evidence?.worktree ?? process.cwd(),
      observe
    );
  }
  async available() {
    const result = await capability("codex");
    return {
      available: result.available && result.unsupported_options.length === 0,
      detail: result.detail
    };
  }
  async call(instruction, projection, passport, thread, cwd = process.cwd(), observe = async () => {
  }) {
    const capabilities = await capability("codex");
    const native = thread !== null && capabilities.native_resume;
    let result;
    let fallback = false;
    try {
      result = await this.run(
        instruction,
        projection,
        passport,
        cwd,
        native ? thread : null,
        observe
      );
    } catch (error) {
      if (!native || !isInvalidSession(error)) throw error;
      result = await this.run(
        instruction,
        projection,
        passport,
        cwd,
        null,
        observe
      );
      fallback = true;
    }
    return {
      value: parseJson(result.text, result.usage),
      session_id: result.sessionId ?? (!fallback ? thread ?? void 0 : void 0),
      session_mode: fallback || thread !== null && !native ? "passport_handoff" : native ? "native_resume" : "new",
      resumed: native && !fallback,
      resume_failed: thread !== null && (!native || fallback),
      usage: result.usage
    };
  }
  async run(instruction, projection, passport, cwd, resumeId, observe) {
    const profile = passport.config.profiles.codex;
    const prompt = bounded(
      `${instruction}

${JSON.stringify(projection)}`,
      passport.config.max_input_bytes
    );
    const args = resumeId ? ["exec", "resume", resumeId, "--json", "--sandbox", "read-only"] : ["exec", "--json", "--sandbox", "read-only"];
    if (profile.model) args.push("--model", profile.model);
    args.push("-c", `model_reasoning_effort=${profile.effort}`, "-");
    return observedCall(observe, async () => {
      const output = await spawnCapture(
        this.pm,
        "codex",
        args,
        cwd,
        prompt,
        passport.config.max_output_bytes,
        profile.timeout_ms
      );
      const lines = output.split("\n").filter(Boolean).map(parseObject);
      let text = "";
      let sessionId;
      let usage = {};
      for (const line of lines) {
        if (line.type === "thread.started" && typeof line.thread_id === "string")
          sessionId = line.thread_id;
        const item = object(line.item);
        if (item.type === "agent_message" && typeof item.text === "string")
          text = item.text;
        if (line.type === "turn.completed") usage = usageObject(line.usage);
      }
      if (!text) throw new Error("Codex returned no agent message");
      return {
        text,
        sessionId,
        usage: {
          input_chars: prompt.length,
          output_chars: text.length,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens
        }
      };
    });
  }
};
var NativeFableWorkflowAdapter = class {
  constructor(pm) {
    this.pm = pm;
  }
  pm;
  consult(jobId, consultationId, query, options, observe = async () => {
  }) {
    return this.call(
      "Answer one bounded noncritical question. Return only strict JSON with schema_version:1, consultation_id, answer, alternatives, uncertainties. Do not return actions, verdicts, execution instructions, passport updates, or merge advice.",
      {
        job_id: jobId,
        consultation_id: consultationId,
        purpose: query.purpose,
        question: query.question,
        verification_method: query.verification_method
      },
      options,
      observe
    );
  }
  async available() {
    const result = await capability("claude", "fable");
    return {
      available: result.available && result.unsupported_options.length === 0,
      detail: result.detail
    };
  }
  async call(instruction, projection, options, observe) {
    const prompt = bounded(
      `${instruction}

${JSON.stringify(projection)}`,
      options.max_input_bytes
    );
    const result = await observedCall(
      observe,
      () => claudeCall(
        this.pm,
        prompt,
        options.workspace,
        options.model,
        1,
        "low",
        options.timeout_ms,
        options.max_output_bytes,
        true
      )
    );
    return {
      value: parseJson(result.text, result.usage),
      session_mode: "none",
      usage: result.usage
    };
  }
};
var NativeOpusWorkflowAdapter = class {
  constructor(pm) {
    this.pm = pm;
  }
  pm;
  async execute(passport, prompt, workspace, sessionId, mode, observe = async () => {
  }) {
    const taskContext = JSON.stringify({
      job_id: passport.job_id,
      objective: passport.objective,
      hard_constraints: passport.hard_constraints,
      accepted_brief_hash: passport.accepted_brief_hash,
      acceptance_criteria: passport.acceptance_criteria,
      allowed_file_scope: passport.allowed_file_scope,
      required_checks: passport.required_checks
    });
    const profile = passport.config.profiles.opus;
    const capabilities = await capability("claude", "opus");
    const native = mode === "native_resume" && sessionId !== null && capabilities.native_resume;
    const effectiveMode = native ? "native_resume" : sessionId ? "passport_handoff" : "new";
    const recovery = effectiveMode === "passport_handoff" ? `This is a new process using a compact passport handoff, not a resumed native session.
${JSON.stringify(project(passport))}

` : "";
    const instruction = `Task passport projection:
${taskContext}

Do not modify files outside allowed_file_scope when it is non-empty.

${recovery}${prompt}

Implement, test, and commit on the current worktree branch. End with strict JSON: job_id, status completed|partial|failed, files_changed, commands_run, tests_reported, deviations, unresolved, summary.`;
    let result;
    let fallback = false;
    try {
      result = await observedCall(
        observe,
        () => claudeCall(
          this.pm,
          bounded(instruction, passport.config.max_input_bytes),
          workspace,
          profile.model,
          profile.max_turns,
          profile.effort,
          profile.timeout_ms,
          passport.config.max_output_bytes,
          false,
          native ? sessionId : null
        )
      );
    } catch (error) {
      if (!native || !isInvalidSession(error)) throw error;
      const handoff = `Task passport projection:
${taskContext}

Do not modify files outside allowed_file_scope when it is non-empty.

This is a new process using a compact passport handoff, not a resumed native session.
${JSON.stringify(project(passport))}

${prompt}

Implement, test, and commit on the current worktree branch. End with strict JSON: job_id, status completed|partial|failed, files_changed, commands_run, tests_reported, deviations, unresolved, summary.`;
      result = await observedCall(
        observe,
        () => claudeCall(
          this.pm,
          bounded(handoff, passport.config.max_input_bytes),
          workspace,
          profile.model,
          profile.max_turns,
          profile.effort,
          profile.timeout_ms,
          passport.config.max_output_bytes
        )
      );
      fallback = true;
    }
    return {
      value: parseJson(result.text, result.usage),
      session_id: result.sessionId ?? (!fallback ? sessionId ?? void 0 : void 0),
      session_mode: fallback ? "passport_handoff" : effectiveMode,
      resumed: native && !fallback,
      resume_failed: sessionId !== null && (!native || fallback),
      usage: result.usage
    };
  }
  async available() {
    const result = await capability("claude", "opus");
    return {
      available: result.available && result.unsupported_options.length === 0,
      detail: result.detail
    };
  }
};
var NativeWorkflowRoleResolver = class {
  codex;
  adviser;
  implementer;
  constructor(pm) {
    this.codex = new NativeCodexWorkflowAdapter(pm);
    this.adviser = new NativeFableWorkflowAdapter(pm);
    this.implementer = new NativeOpusWorkflowAdapter(pm);
  }
  async availability(binding, role) {
    if (!supports(binding, role))
      return {
        available: false,
        detail: `Unsupported ${role} binding: ${binding.adapter}`
      };
    return role === "supervisor" || role === "reviewer" ? this.codex.available() : role === "implementer" ? this.implementer.available() : this.adviser.available();
  }
  decide(binding, passport, stage, evidence, threadId, observer) {
    assertSupported(
      binding,
      stage === "post_opus" || stage === "after_fable_post" ? "reviewer" : "supervisor"
    );
    return this.codex.decide(
      withProfile(passport, "codex", binding),
      stage,
      evidence,
      threadId,
      observer
    );
  }
  execute(binding, passport, prompt, workspace, sessionId, mode, observer) {
    assertSupported(binding, "implementer");
    return this.implementer.execute(
      withProfile(passport, "opus", binding),
      prompt,
      workspace,
      sessionId,
      mode,
      observer
    );
  }
  consult(binding, jobId, consultationId, query, options, observer) {
    assertSupported(binding, "adviser");
    return this.adviser.consult(
      jobId,
      consultationId,
      query,
      {
        ...options,
        model: binding.profile.model,
        timeout_ms: binding.profile.timeout_ms
      },
      observer
    );
  }
};
var NativeWorkflowGitGateway = class {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }
  projectRoot;
  validateChecks(commands, root = this.projectRoot) {
    return validateExplicitChecks(root, commands);
  }
  async prepare(jobId) {
    const branch = `orchestry/workflow/${jobId}`;
    const target_branch = (await git(this.projectRoot, ["branch", "--show-current"])).trim();
    if (!target_branch) throw new Error("Controller must be on a named branch");
    const base_commit = (await git(this.projectRoot, ["rev-parse", "HEAD"])).trim();
    const worktree = path.join(
      this.projectRoot,
      ".orchestry",
      "workspaces",
      jobId
    );
    await fs.mkdir(path.dirname(worktree), { recursive: true, mode: 448 });
    try {
      const existingBranch = (await git(worktree, ["branch", "--show-current"])).trim();
      const existingCommit = (await git(worktree, ["rev-parse", "HEAD"])).trim();
      const status = (await git(worktree, ["status", "--porcelain"])).trim();
      if (existingBranch !== branch || existingCommit !== base_commit || status)
        throw new Error(
          "Existing workflow worktree does not match the expected clean base"
        );
      return { branch, worktree, target_branch, base_commit };
    } catch (error) {
      if (error instanceof Error && error.message.includes("does not match"))
        throw error;
    }
    try {
      await git(this.projectRoot, [
        "worktree",
        "add",
        worktree,
        "-b",
        branch,
        base_commit
      ]);
    } catch {
      const branchCommit = await git(this.projectRoot, ["rev-parse", branch]).then((value) => value.trim()).catch(() => null);
      if (branchCommit !== base_commit)
        throw new Error(
          "Existing workflow branch does not match the expected base"
        );
      await git(this.projectRoot, ["worktree", "prune"]);
      await git(this.projectRoot, ["worktree", "add", worktree, branch]);
    }
    await fs.rm(path.join(worktree, ".orchestry"), {
      recursive: true,
      force: true
    });
    return { branch, worktree, target_branch, base_commit };
  }
  async inspect(branch, worktree) {
    const status = (await git(worktree, ["status", "--porcelain"])).trim();
    if (status)
      throw new Error(
        "Opus worktree contains uncommitted changes; review requires a committed snapshot"
      );
    const commit = (await git(worktree, ["rev-parse", "HEAD"])).trim();
    const base = (await git(this.projectRoot, ["merge-base", "HEAD", branch])).trim();
    const diff = await git(
      this.projectRoot,
      ["diff", "--binary", `${base}...${commit}`],
      16 * 1024 * 1024
    );
    const files = (await git(this.projectRoot, [
      "diff",
      "--name-only",
      `${base}...${commit}`
    ])).trim().split("\n").filter(Boolean);
    const stat = await git(this.projectRoot, [
      "diff",
      "--numstat",
      `${base}...${commit}`
    ]);
    let insertions = 0;
    let deletions = 0;
    for (const line of stat.split("\n")) {
      const [a, d] = line.split("	");
      insertions += Number(a) || 0;
      deletions += Number(d) || 0;
    }
    const risk_signals = files.filter(
      (file) => /auth|security|secret|migration|deploy|infra|billing/i.test(file)
    );
    return {
      branch,
      worktree,
      commit,
      diff,
      diff_hash: hashCanonical(diff),
      files_changed: files,
      insertions,
      deletions,
      risk_signals
    };
  }
  async runChecks(worktree, commit, commands) {
    const trusted = await this.validateChecks(commands, worktree);
    const checks = [];
    for (const command of trusted) {
      const [executable, ...args] = command.split(" ");
      try {
        const { stdout, stderr } = await execFileAsync(executable, args, {
          cwd: worktree,
          env: buildChildEnv(),
          maxBuffer: 4 * 1024 * 1024
        });
        checks.push({ command, passed: true, output: `${stdout}${stderr}` });
      } catch (error) {
        const e = error;
        checks.push({
          command,
          passed: false,
          output: `${e.stdout ?? ""}${e.stderr ?? e.message}`
        });
      }
    }
    return {
      job_id: path.basename(worktree),
      commit,
      passed: checks.every((check) => check.passed),
      checks
    };
  }
  async currentCommit(branch) {
    return (await git(this.projectRoot, ["rev-parse", branch])).trim();
  }
  async isMerged(_branch, commit, targetBranch, baseCommit) {
    try {
      const currentBranch = (await git(this.projectRoot, ["branch", "--show-current"])).trim();
      if (currentBranch !== targetBranch) return false;
      await git(this.projectRoot, [
        "merge-base",
        "--is-ancestor",
        baseCommit,
        targetBranch
      ]);
      await git(this.projectRoot, [
        "merge-base",
        "--is-ancestor",
        commit,
        targetBranch
      ]);
      const reviewedTree = (await git(this.projectRoot, ["rev-parse", `${commit}^{tree}`])).trim();
      const targetTree = (await git(this.projectRoot, ["rev-parse", `${targetBranch}^{tree}`])).trim();
      return reviewedTree === targetTree;
    } catch {
      return false;
    }
  }
  async merge(branch, expectedCommit, targetBranch, baseCommit) {
    try {
      if (!branch.startsWith("orchestry/workflow/"))
        return {
          success: false,
          detail: "Refusing to merge a non-workflow branch"
        };
      const currentBranch = (await git(this.projectRoot, ["branch", "--show-current"])).trim();
      if (currentBranch !== targetBranch)
        return {
          success: false,
          detail: `Controller branch changed from ${targetBranch} to ${currentBranch}`
        };
      const targetCommit = (await git(this.projectRoot, ["rev-parse", "HEAD"])).trim();
      if (targetCommit !== baseCommit)
        return {
          success: false,
          detail: "Target branch changed since workflow start"
        };
      const branchCommit = (await git(this.projectRoot, ["rev-parse", branch])).trim();
      if (branchCommit !== expectedCommit)
        return {
          success: false,
          detail: "Workflow branch changed after review"
        };
      const status = (await git(this.projectRoot, ["status", "--porcelain"])).trim();
      if (status)
        return { success: false, detail: "Controller worktree is dirty" };
      await git(this.projectRoot, [
        "merge",
        "--no-ff",
        expectedCommit,
        "-m",
        `Merge reviewed ${branch}`
      ]);
      return { success: true, detail: "merged" };
    } catch (error) {
      await git(this.projectRoot, ["merge", "--abort"]).catch(() => "");
      return {
        success: false,
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }
};
async function claudeCall(pm, prompt, cwd, model, maxTurns, effort, timeout, maxOutput, toolFree = false, resumeId = null) {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--max-turns",
    String(maxTurns),
    "--verbose"
  ];
  if (model) args.push("--model", model);
  args.push("--effort", effort);
  if (resumeId) args.push("--resume", resumeId);
  if (toolFree)
    args.push(
      "--bare",
      "--tools",
      "",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-session-persistence"
    );
  const output = await spawnCapture(
    pm,
    "claude",
    args,
    cwd,
    prompt,
    maxOutput,
    timeout
  );
  let text = "";
  let sessionId;
  let usage = {};
  for (const line of output.split("\n").filter(Boolean).map(parseObject)) {
    if (line.type === "result") {
      if (typeof line.result === "string") text = line.result;
      if (typeof line.session_id === "string") sessionId = line.session_id;
      usage = usageObject(line.usage);
    }
  }
  if (!text) throw new Error("Claude returned no result");
  return {
    text,
    sessionId,
    usage: {
      input_chars: prompt.length,
      output_chars: text.length,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read: usage.cache_read_input_tokens,
      cache_write: usage.cache_creation_input_tokens
    }
  };
}
async function spawnCapture(pm, command, args, cwd, input, maxBytes, timeoutMs) {
  const { process: child, pid } = pm.spawn(command, args, {
    cwd,
    env: buildChildEnv(),
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let exceeded = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void pm.killWithGrace(pid, 1e3);
  }, timeoutMs);
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
    if (Buffer.byteLength(stdout) > maxBytes) {
      exceeded = true;
      void pm.killWithGrace(pid, 1e3);
    }
  });
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 64e3) stderr += chunk.toString();
  });
  child.stdin?.end(input);
  const code = await new Promise((resolve, reject) => {
    child.on("close", (value) => resolve(value ?? 1));
    child.on("error", reject);
  }).finally(() => clearTimeout(timer));
  if (timedOut) throw new Error(`${command} timed out after ${timeoutMs}ms`);
  if (exceeded)
    throw new Error(`${command} output exceeded configured maximum`);
  if (code !== 0) throw new Error(`${command} exited ${code}: ${stderr}`);
  return stdout;
}
async function observedCall(observe, call) {
  const attemptKey = randomUUID();
  const started = Date.now();
  await observe({ attempt_key: attemptKey, status: "started" });
  try {
    const result = await call();
    result.usage = {
      ...result.usage,
      duration_ms: result.usage?.duration_ms ?? Date.now() - started
    };
    await observe({
      attempt_key: attemptKey,
      status: "succeeded",
      usage: result.usage
    });
    return result;
  } catch (error) {
    await observe({
      attempt_key: attemptKey,
      status: "failed",
      error,
      usage: {
        ...usageFromError(error),
        duration_ms: usageFromError(error)?.duration_ms ?? Date.now() - started
      }
    });
    throw error;
  }
}
async function detectWorkflowCapabilities() {
  const [codex, claude, fable, grok, antigravity] = await Promise.all([
    capability("codex"),
    capability("claude", "opus"),
    capability("claude", "fable"),
    capability("grok"),
    capability("agy")
  ]);
  return { codex, claude, fable, grok, antigravity };
}
async function capability(command, role = "opus") {
  const adapter = command === "agy" ? "antigravity" : command === "claude" && role === "fable" ? "fable" : command;
  try {
    const env = buildChildEnv();
    const [{ stdout: version }, { stdout: help }] = await Promise.all([
      execFileAsync(command, ["--version"], { env, timeout: 5e3 }),
      execFileAsync(command, ["--help"], {
        env,
        timeout: 5e3,
        maxBuffer: 1024 * 1024
      })
    ]);
    return describeCapability(adapter, command, role, version.trim(), help);
  } catch {
    return unavailableCapability(adapter, command);
  }
}
function describeCapability(adapter, command, role, version, help) {
  const claudeBase = [
    "--print",
    "--output-format",
    "--max-turns",
    "--model",
    "--effort"
  ];
  const required = command === "claude" ? role === "fable" ? [
    ...claudeBase,
    "--bare",
    "--tools",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    "--no-session-persistence"
  ] : claudeBase : command === "codex" ? ["exec", "--json", "--sandbox", "--model"] : [];
  const unsupported = required.filter((flag) => !help.includes(flag));
  const advertisedResume = command === "claude" ? help.includes("--resume") : command === "codex" && /\bresume\b/.test(help);
  const nativeResume = advertisedResume && role !== "fable" && process.env.ORCHESTRY_ENABLE_NATIVE_RESUME === "1";
  const secureTransport = command === "codex" || command === "claude";
  const compatibleRoles = command === "codex" ? ["supervisor", "reviewer"] : command === "claude" && role === "opus" ? ["implementer"] : command === "claude" ? ["adviser"] : [];
  const optionReason = unsupported.length ? `Required options are unavailable: ${unsupported.join(", ")}` : null;
  const transportReason = secureTransport ? null : `${command} stdin prompt transport is not proven; argv prompt transport is prohibited`;
  const roleCompatibility = Object.fromEntries(
    ["supervisor", "implementer", "adviser", "reviewer"].map(
      (candidate) => {
        const compatible = compatibleRoles.includes(candidate);
        const reasons = compatible ? [optionReason].filter((value) => value !== null) : [
          transportReason ?? `${adapter} is not compatible with the ${candidate} workflow role`
        ];
        return [
          candidate,
          { compatible: compatible && reasons.length === 0, reasons }
        ];
      }
    )
  );
  const detail = transportReason ?? optionReason ?? `Required ${role} options detected; continuation mode: ${nativeResume ? "native_resume (explicitly enabled)" : advertisedResume ? "passport_handoff (native resume advertised but not empirically enabled)" : "passport_handoff"}.`;
  return {
    adapter,
    command,
    installed: true,
    version,
    transport: secureTransport ? "stdin" : "unsupported",
    structured_output: command === "codex" ? { supported: help.includes("--json"), format: "jsonl" } : command === "claude" ? {
      supported: help.includes("--output-format"),
      format: "stream-json"
    } : { supported: false, format: null },
    sandbox: command === "codex" ? { supported: help.includes("--sandbox"), mode: "read-only" } : { supported: false, mode: null },
    tools: command === "claude" && role === "fable" ? { configurable: help.includes("--tools"), mode: "disabled" } : command === "claude" ? { configurable: false, mode: "enabled" } : command === "codex" ? { configurable: false, mode: "enabled" } : { configurable: false, mode: "unknown" },
    resume: { advertised: advertisedResume, enabled: nativeResume },
    role_compatibility: roleCompatibility,
    models: {
      cli_default: secureTransport,
      verified: command === "claude" && role === "opus" ? [{ id: "opus", source: "trusted_catalog" }] : []
    },
    supported_options: required.filter((flag) => help.includes(flag)),
    unsupported_options: unsupported,
    detail,
    available: true,
    advertised_native_resume: advertisedResume,
    native_resume: nativeResume
  };
}
function unavailableCapability(adapter, command) {
  const reason = `${command} CLI unavailable`;
  const role_compatibility = Object.fromEntries(
    ["supervisor", "implementer", "adviser", "reviewer"].map(
      (role) => [role, { compatible: false, reasons: [reason] }]
    )
  );
  return {
    adapter,
    command,
    installed: false,
    version: null,
    transport: command === "codex" || command === "claude" ? "stdin" : "unsupported",
    structured_output: { supported: false, format: null },
    sandbox: { supported: false, mode: null },
    tools: { configurable: false, mode: "unknown" },
    resume: { advertised: false, enabled: false },
    role_compatibility,
    models: {
      cli_default: command === "codex" || command === "claude",
      verified: []
    },
    supported_options: [],
    unsupported_options: [],
    detail: reason,
    available: false,
    advertised_native_resume: false,
    native_resume: false
  };
}
async function git(cwd, args, maxBuffer = 4 * 1024 * 1024) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: buildChildEnv(),
    maxBuffer
  });
  return stdout;
}
function parseObject(line) {
  try {
    return JSON.parse(line);
  } catch {
    return {};
  }
}
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function usageObject(value) {
  const result = {};
  for (const [key, nested] of Object.entries(object(value)))
    if (typeof nested === "number") result[key] = nested;
  return result;
}
function parseJson(text, usage) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const error = new Error("Role returned malformed JSON");
    error.usage = usage;
    throw error;
  }
}
function bounded(value, max) {
  if (Buffer.byteLength(value) > max)
    throw new Error("Role input exceeded configured maximum");
  return value;
}
function isInvalidSession(error) {
  return error instanceof Error && /(?:session|thread).*(?:expired|invalid|not found)|(?:expired|invalid|not found).*(?:session|thread)/i.test(
    error.message
  );
}
function usageFromError(error) {
  if (!error || typeof error !== "object") return void 0;
  const usage = error.usage;
  return usage && typeof usage === "object" && !Array.isArray(usage) ? usage : void 0;
}
function project(passport) {
  return {
    schema_version: passport.schema_version,
    job_id: passport.job_id,
    mode: passport.mode,
    objective: passport.objective,
    hard_constraints: passport.hard_constraints,
    acceptance_criteria: passport.acceptance_criteria,
    current_phase: passport.current_phase,
    current_revision: passport.current_revision,
    accepted_brief_hash: passport.accepted_brief_hash,
    latest_implementation_brief: passport.latest_implementation_brief,
    allowed_file_scope: passport.allowed_file_scope,
    required_checks: passport.required_checks,
    current_blockers: passport.current_blockers,
    next_action: passport.next_action,
    current_commit: passport.current_commit,
    active_roster_hash: passport.active_roster_hash,
    roster_revision: passport.roster_revision,
    relevant_artifacts: passport.artifacts.slice(-12),
    session_references: passport.session_references,
    session_modes: passport.session_modes
  };
}
function supports(binding, role) {
  if (role === "supervisor" || role === "reviewer")
    return binding.adapter === "codex";
  if (role === "implementer") return binding.adapter === "claude";
  return binding.adapter === "claude" || binding.adapter === "fable";
}
function assertSupported(binding, role) {
  if (!supports(binding, role))
    throw new Error(`Unsupported ${role} binding: ${binding.adapter}`);
}
function withProfile(passport, key, binding) {
  return {
    ...passport,
    config: {
      ...passport.config,
      profiles: {
        ...passport.config.profiles,
        [key]: {
          ...passport.config.profiles[key],
          model: binding.profile.model,
          effort: binding.profile.effort,
          max_turns: binding.profile.max_turns,
          timeout_ms: binding.profile.timeout_ms
        }
      }
    }
  };
}

export { NativeCodexWorkflowAdapter, NativeFableWorkflowAdapter, NativeOpusWorkflowAdapter, NativeWorkflowGitGateway, NativeWorkflowRoleResolver, detectWorkflowCapabilities };
//# sourceMappingURL=native-adapters-B34254ZQ.js.map
//# sourceMappingURL=native-adapters-B34254ZQ.js.map