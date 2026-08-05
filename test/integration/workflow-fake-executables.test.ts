import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProcessManager } from "../../src/infrastructure/process/process-manager.js";
import {
  NativeCodexWorkflowAdapter,
  NativeFableWorkflowAdapter,
  NativeOpusWorkflowAdapter,
  detectWorkflowCapabilities,
} from "../../src/infrastructure/workflow/native-adapters.js";
import type { WorkflowPassportV2 } from "../../src/domain/workflow/state.js";

let root: string;
let originalPath: string | undefined;
let originalHome: string | undefined;
let originalResume: string | undefined;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "orch-fake-v2-"));
  originalPath = process.env.PATH;
  originalHome = process.env.HOME;
  originalResume = process.env.ORCHESTRY_ENABLE_NATIVE_RESUME;
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  await fs.mkdir(bin);
  await fs.mkdir(path.join(home, ".orch-fake"), { recursive: true });
  for (const name of ["claude", "codex"]) {
    const target = path.join(bin, name);
    await fs.copyFile(path.resolve("test/fixtures/fake-agent-cli.mjs"), target);
    await fs.chmod(target, 0o755);
  }
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  process.env.HOME = home;
  process.env.ORCHESTRY_ENABLE_NATIVE_RESUME = "1";
});
afterEach(async () => {
  process.env.PATH = originalPath;
  process.env.HOME = originalHome;
  if (originalResume === undefined)
    delete process.env.ORCHESTRY_ENABLE_NATIVE_RESUME;
  else process.env.ORCHESTRY_ENABLE_NATIVE_RESUME = originalResume;
  await fs.rm(root, { recursive: true, force: true });
});

describe("workflow v2 fake executables", () => {
  it("detects capabilities without network calls and defaults unverified resume to handoff", async () => {
    expect(await detectWorkflowCapabilities()).toMatchObject({
      codex: { available: true, native_resume: true },
      claude: { available: true, native_resume: true },
    });
    delete process.env.ORCHESTRY_ENABLE_NATIVE_RESUME;
    expect(await detectWorkflowCapabilities()).toMatchObject({
      codex: { advertised_native_resume: true, native_resume: false },
      claude: { advertised_native_resume: true, native_resume: false },
    });
  });
  it("uses exact argv and stdin-only prompts for Codex, optional Fable, and Opus", async () => {
    await scenario([
      { text: JSON.stringify(dispatch()) },
      {
        text: JSON.stringify({
          schema_version: 1,
          consultation_id: "consult_1",
          answer: "A",
          alternatives: [],
          uncertainties: [],
        }),
      },
      { text: JSON.stringify(opus()) },
    ]);
    const pm = new ProcessManager();
    const passport = samplePassport();
    await new NativeCodexWorkflowAdapter(pm).decide(
      passport,
      "pre_opus",
      { evidence: null, checks: null, opus: null, fable_advice: null },
      null,
    );
    await new NativeFableWorkflowAdapter(pm).consult(
      "wf_1",
      "consult_1",
      query(),
      options(),
    );
    await new NativeOpusWorkflowAdapter(pm).execute(
      passport,
      "OPUS_SENTINEL",
      root,
      null,
      "new",
    );
    const calls = await roleCalls();
    expect(calls[0]?.argv).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--model",
      "codex-model",
      "-c",
      "model_reasoning_effort=medium",
      "-",
    ]);
    expect(calls[1]?.argv).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--max-turns",
      "1",
      "--verbose",
      "--model",
      "fable-model",
      "--effort",
      "low",
      "--bare",
      "--tools",
      "",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-session-persistence",
    ]);
    expect(calls[2]?.argv).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--max-turns",
      "7",
      "--verbose",
      "--model",
      "opus-model",
      "--effort",
      "high",
    ]);
    expect(calls[2]?.stdin).toContain("OPUS_SENTINEL");
    expect(calls.flatMap((call) => call.argv).join(" ")).not.toContain(
      "OPUS_SENTINEL",
    );
    for (const call of calls) expect(call.env).not.toContain("OPENAI_API_KEY");
  });
  it("omits --model exactly for CLI-default profiles", async () => {
    await scenario([
      { text: JSON.stringify(dispatch()) },
      { text: JSON.stringify(opus()) },
    ]);
    const passport = samplePassport();
    passport.config.profiles.codex.model = "";
    passport.config.profiles.opus.model = "";
    const pm = new ProcessManager();
    await new NativeCodexWorkflowAdapter(pm).decide(
      passport,
      "pre_opus",
      { evidence: null, checks: null, opus: null, fable_advice: null },
      null,
    );
    await new NativeOpusWorkflowAdapter(pm).execute(
      passport,
      "DEFAULT_SENTINEL",
      root,
      null,
      "new",
    );
    const calls = await roleCalls();
    expect(calls[0]?.argv).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "-c",
      "model_reasoning_effort=medium",
      "-",
    ]);
    expect(calls[1]?.argv).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--max-turns",
      "7",
      "--verbose",
      "--effort",
      "high",
    ]);
    expect(calls.flatMap((call) => call.argv)).not.toContain(
      "DEFAULT_SENTINEL",
    );
  });
  it("fails closed on malformed structured output", async () => {
    await scenario([{ text: "not-json" }]);
    await expect(
      new NativeCodexWorkflowAdapter(new ProcessManager()).decide(
        samplePassport(),
        "pre_opus",
        { evidence: null, checks: null, opus: null, fable_advice: null },
        null,
      ),
    ).rejects.toThrow("malformed JSON");
  });
  it("terminates timed-out Opus without ambiguous retry", async () => {
    const passport = samplePassport();
    passport.config.profiles.opus.timeout_ms = 250;
    await scenario([{ text: "{}", sleep_ms: 10_000 }, { text: "{}" }]);
    await expect(
      new NativeOpusWorkflowAdapter(new ProcessManager()).execute(
        passport,
        "continue",
        root,
        "same",
        "native_resume",
      ),
    ).rejects.toThrow("timed out");
    expect(await roleCalls()).toHaveLength(1);
  });
  it("uses verified resume argv and counts expired-session handoff attempts separately", async () => {
    await scenario([
      { text: JSON.stringify(dispatch()), session_id: "same-codex" },
      { text: "", exit_code: 7, stderr: "session expired" },
      { text: JSON.stringify(opus()), session_id: "rotated-opus" },
    ]);
    const passport = samplePassport();
    const codex = await new NativeCodexWorkflowAdapter(
      new ProcessManager(),
    ).decide(
      passport,
      "pre_opus",
      { evidence: null, checks: null, opus: null, fable_advice: null },
      "same-codex",
    );
    const events: Array<{
      attempt_key: string;
      status: string;
      usage?: { duration_ms?: number };
    }> = [];
    const opusResult = await new NativeOpusWorkflowAdapter(
      new ProcessManager(),
    ).execute(
      passport,
      "continue",
      root,
      "expired-opus",
      "native_resume",
      async (event) => {
        events.push(event);
      },
    );
    const calls = await roleCalls();
    expect(calls[0]?.argv.slice(0, 3)).toEqual([
      "exec",
      "resume",
      "same-codex",
    ]);
    expect(calls[1]?.argv).toContain("--resume");
    expect(calls[2]?.argv).not.toContain("--resume");
    expect(calls[2]?.stdin).toContain("compact passport handoff");
    expect(codex.session_mode).toBe("native_resume");
    expect(opusResult).toMatchObject({
      session_mode: "passport_handoff",
      resume_failed: true,
    });
    expect(events.map((event) => event.status)).toEqual([
      "started",
      "failed",
      "started",
      "succeeded",
    ]);
    expect(new Set(events.map((event) => event.attempt_key)).size).toBe(2);
    expect(
      events
        .filter((event) => event.status !== "started")
        .every((event) => Number.isInteger(event.usage?.duration_ms)),
    ).toBe(true);
  });
});

async function scenario(responses: unknown[]) {
  await fs.writeFile(
    path.join(root, "home", ".orch-fake", "scenario.json"),
    JSON.stringify({ responses }),
  );
}
async function readCalls(): Promise<
  Array<{
    command: string;
    argv: string[];
    cwd: string;
    stdin: string;
    env: string[];
  }>
> {
  const text = await fs.readFile(
    path.join(root, "home", ".orch-fake", "calls.jsonl"),
    "utf8",
  );
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
async function roleCalls() {
  return (await readCalls()).filter(
    (call) => !call.argv.includes("--help") && !call.argv.includes("--version"),
  );
}
function query() {
  return {
    purpose: "COMPARE_BOUNDED_OPTIONS" as const,
    question: "A or B?",
    verification_method: "tests",
    fallback_if_skipped: {
      action: "DISPATCH_OPUS" as const,
      instructions: "A",
    },
  };
}
function options() {
  return {
    workspace: root,
    model: "fable-model",
    max_turns: 1 as const,
    effort: "low" as const,
    timeout_ms: 1000,
    max_input_bytes: 10_000,
    max_output_bytes: 10_000,
  };
}
function dispatch() {
  return {
    schema_version: 2,
    job_id: "wf_1",
    action: "DISPATCH_OPUS",
    summary: "go",
    implementation_brief: "implement",
    required_changes: [],
    risk_level: "low",
    fable_query: null,
    reviewed_commit: null,
    fable_advice_disposition: null,
    fable_error: null,
    fable_iteration_effect: null,
  };
}
function opus() {
  return {
    job_id: "wf_1",
    status: "completed",
    files_changed: [],
    commands_run: [],
    tests_reported: [],
    deviations: [],
    unresolved: [],
    summary: "done",
  };
}
function samplePassport(): WorkflowPassportV2 {
  const profiles = {
    fable: {
      model: "fable-model",
      effort: "low",
      max_turns: 1,
      timeout_ms: 1000,
      permission_mode: "read_only",
    },
    opus: {
      model: "opus-model",
      effort: "high",
      max_turns: 7,
      timeout_ms: 1000,
      permission_mode: "worktree",
    },
    codex: {
      model: "codex-model",
      effort: "medium",
      max_turns: 1,
      timeout_ms: 1000,
      permission_mode: "read_only",
    },
  } as const;
  return {
    schema_version: 2,
    passport_revision: 1,
    job_id: "wf_1",
    mode: "adaptive",
    current_revision: 1,
    objective: "objective",
    current_phase: "codex_pre_opus",
    accepted_brief_hash: null,
    latest_implementation_brief: null,
    hard_constraints: ["safe"],
    acceptance_criteria: [],
    decisions: [],
    allowed_file_scope: [],
    required_checks: ["npm test"],
    current_blockers: [],
    next_action: "next",
    artifacts: [],
    active_worktree: root,
    target_branch: "main",
    base_commit: "a".repeat(40),
    current_commit: null,
    session_references: { codex: null, opus: null },
    session_modes: { codex: "none", opus: "none" },
    rotation_history: [],
    config: {
      fable_total_cap: 1,
      max_input_bytes: 10_000,
      max_output_bytes: 10_000,
      passport_max_bytes: 64_000,
      profiles,
    },
  };
}
