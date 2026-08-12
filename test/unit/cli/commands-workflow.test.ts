import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerWorkflowCommand } from "../../../src/cli/commands/workflow.js";
import type { WorkflowCapabilities } from "../../../src/cli/workflow-wizard.js";
import type {
  AdapterCapabilityDescriptor,
  WorkflowCapabilityRole,
} from "../../../src/infrastructure/adapters/interface.js";
import { makeContainer } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

function descriptor(
  adapter: AdapterCapabilityDescriptor["adapter"],
  compatible: WorkflowCapabilityRole | WorkflowCapabilityRole[] | null,
  installed = true,
): AdapterCapabilityDescriptor {
  const command =
    adapter === "antigravity"
      ? "agy"
      : adapter === "fable"
        ? "claude"
        : (adapter as AdapterCapabilityDescriptor["command"]);
  const roles =
    compatible === null
      ? []
      : Array.isArray(compatible)
        ? compatible
        : [compatible];
  const role_compatibility = Object.fromEntries(
    (["supervisor", "implementer", "adviser", "reviewer"] as const).map(
      (role) => [
        role,
        {
          compatible: roles.includes(role),
          reasons: roles.includes(role)
            ? []
            : [`${adapter} cannot serve ${role}`],
        },
      ],
    ),
  ) as AdapterCapabilityDescriptor["role_compatibility"];
  return {
    adapter,
    command,
    installed,
    version: installed ? "1" : null,
    transport: roles.length ? "stdin" : "unsupported",
    structured_output: { supported: true, format: "json" },
    sandbox: { supported: true, mode: "read-only" },
    tools: { configurable: false, mode: "enabled" },
    resume: { advertised: false, enabled: false },
    role_compatibility,
    models: {
      cli_default: roles.length > 0,
      verified:
        adapter === "claude" ? [{ id: "opus", source: "trusted_catalog" }] : [],
    },
    supported_options: [],
    unsupported_options: [],
    detail: installed ? "test" : "CLI is not installed",
    available: installed,
    advertised_native_resume: false,
    native_resume: false,
  };
}

const capabilities: WorkflowCapabilities = {
  codex: descriptor("codex", ["supervisor", "reviewer"]),
  claude: descriptor("claude", ["implementer", "reviewer"]),
  opencode: descriptor("opencode", "implementer"),
  fable: descriptor("fable", "adviser"),
  grok: descriptor("grok", null),
  antigravity: descriptor("antigravity", null),
};

async function setup(config: Record<string, unknown> = { workflow: {} }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orch-workflow-cli-"));
  roots.push(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "vitest run" } }),
  );
  await fs.writeFile(path.join(root, "package-lock.json"), "{}");
  const start = vi.fn(async () => "wf_test");
  const run = vi.fn(async () => ({ phase: "completed" }));
  const approve = vi.fn(async () => ({ phase: "merge_ready" }));
  const rotateBinding = vi.fn(async () => {});
  const container = makeContainer({
    context: {
      json: true,
      quiet: false,
      noColor: false,
      ascii: false,
      projectRoot: root,
    },
    config: config as any,
    workflowEngine: { start, run, approve, rotateBinding } as any,
    workflowStore: {
      readJob: vi.fn(async () => ({ phase: "awaiting_approval", current_commit: "abcdef1234567890" })),
      readPassport: vi.fn(async () => ({
        roster: {
          schema_version: 1,
          supervisor: {
            adapter: "codex",
            profile: {
              name: "codex",
              model: "codex",
              effort: "medium",
              max_turns: 1,
              timeout_ms: 1000,
            },
          },
          implementer: {
            adapter: "claude",
            profile: {
              name: "opus",
              model: "opus",
              effort: "high",
              max_turns: 50,
              timeout_ms: 1000,
            },
          },
          adviser: null,
          reviewer: { same_as: "supervisor" },
        },
      })),
    } as any,
  });
  const program = new Command().exitOverride();
  registerWorkflowCommand(program, container, {
    detectCapabilities: async () => capabilities,
    isTTY: () => false,
    readStdin: async () => "Objective from stdin",
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  return { program, start, run, approve, rotateBinding, container };
}

describe("workflow start preflight", () => {
  it("requires an interactive exact-commit challenge before approval", async () => {
    const { container, approve, run } = await setup();
    const program = new Command().exitOverride();
    registerWorkflowCommand(program, container as any, {
      confirmApproval: async () => "approve abcdef123456",
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["workflow", "approve", "wf_test", "--reason", "reviewed"], { from: "user" });
    expect(approve).toHaveBeenCalledWith("wf_test", "reviewed");
    expect(run).toHaveBeenCalledWith("wf_test");
  });

  it("rejects a mismatched approval challenge", async () => {
    const { container, approve } = await setup();
    const program = new Command().exitOverride();
    registerWorkflowCommand(program, container as any, { confirmApproval: async () => "approve wrong" });
    await expect(program.parseAsync(["workflow", "approve", "wf_test", "--reason", "reviewed"], { from: "user" })).rejects.toThrow("challenge");
    expect(approve).not.toHaveBeenCalled();
  });
  it("prints a complete dry-run summary without calling the engine", async () => {
    const { program, start, run } = await setup();
    await program.parseAsync(["workflow", "start", "--yes", "--dry-run"], {
      from: "user",
    });
    expect(start).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    const summary = JSON.parse(
      (console.log as ReturnType<typeof vi.fn>).mock.calls[0]![0],
    );
    expect(summary).toMatchObject({
      objective: { supplied: true },
      mode: "adaptive",
      roster: {
        supervisor: {
          adapter: "codex",
          profile: { model: "CLI default", verification: "cli_default" },
        },
        implementer: {
          adapter: "claude",
          profile: { model: "opus", verification: "verified" },
        },
        adviser: null,
        reviewer: { same_as: "supervisor" },
      },
      checks: ["npm run test"],
      adviser: { enabled: false, max_calls: 0 },
      dry_run: true,
    });
    expect(JSON.stringify(summary)).not.toContain("Objective from stdin");
  });
  it("requires --yes for a noninteractive non-dry-run start", async () => {
    const { program, start } = await setup();
    await expect(
      program.parseAsync(["workflow", "start"], { from: "user" }),
    ).rejects.toThrow("requires --yes");
    expect(start).not.toHaveBeenCalled();
    await expect(
      program.parseAsync(["workflow", "start", "--dry-run"], { from: "user" }),
    ).resolves.toBeDefined();
  });
  it.each(["", "n"])(
    "does not create a job when final confirmation is %j",
    async (answer) => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "orch-workflow-cli-"),
      );
      roots.push(root);
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
      );
      await fs.writeFile(path.join(root, "package-lock.json"), "{}");
      const start = vi.fn();
      const container = makeContainer({
        context: {
          json: true,
          quiet: false,
          noColor: false,
          ascii: false,
          projectRoot: root,
        },
        config: { workflow: {} } as any,
        workflowEngine: { start, run: vi.fn() } as any,
      });
      const prompt = vi.fn(async (question: string) =>
        question === "Objective: "
          ? "CONFIRM_SENTINEL"
          : question.startsWith("Start this workflow?")
            ? answer
            : "",
      );
      const program = new Command().exitOverride();
      registerWorkflowCommand(program, container, {
        detectCapabilities: async () => capabilities,
        isTTY: () => true,
        prompt,
      });
      vi.spyOn(console, "log").mockImplementation(() => {});
      await program.parseAsync(["workflow", "start"], { from: "user" });
      expect(start).not.toHaveBeenCalled();
      expect(prompt.mock.calls.at(-1)?.[0]).toBe("Start this workflow? [y/N] ");
    },
  );
  it("starts only after an explicit interactive Yes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "orch-workflow-cli-"));
    roots.push(root);
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    await fs.writeFile(path.join(root, "package-lock.json"), "{}");
    const start = vi.fn(async () => "wf_yes");
    const container = makeContainer({
      context: {
        json: true,
        quiet: false,
        noColor: false,
        ascii: false,
        projectRoot: root,
      },
      config: { workflow: {} } as any,
      workflowEngine: {
        start,
        run: vi.fn(async () => ({ phase: "done" })),
      } as any,
    });
    const prompt = vi.fn(async (question: string) =>
      question === "Objective: "
        ? "CONFIRM_SENTINEL"
        : question.startsWith("Start this workflow?")
          ? "Yes"
          : "",
    );
    const program = new Command().exitOverride();
    registerWorkflowCommand(program, container, {
      detectCapabilities: async () => capabilities,
      isTTY: () => true,
      prompt,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["workflow", "start"], { from: "user" });
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]![0].objective).toBe("CONFIRM_SENTINEL");
  });
  it("rejects the legacy positional objective", async () => {
    const { program, start } = await setup();
    await expect(
      program.parseAsync(["workflow", "start", "ARGV_SENTINEL", "--yes"], {
        from: "user",
      }),
    ).rejects.toThrow("not accepted in argv");
    expect(start).not.toHaveBeenCalled();
  });
  it("reads a bounded regular objective file and rejects symlinks", async () => {
    const { program, start, container } = await setup();
    const file = path.join(container.context.projectRoot, "objective.txt");
    const link = path.join(container.context.projectRoot, "objective-link.txt");
    await fs.writeFile(file, "FILE_SENTINEL");
    await fs.symlink(file, link);
    await program.parseAsync(
      ["workflow", "start", "--yes", "--objective-file", file],
      { from: "user" },
    );
    expect(start.mock.calls[0]![0].objective).toBe("FILE_SENTINEL");
    const second = await setup();
    await expect(
      second.program.parseAsync(
        ["workflow", "start", "--yes", "--objective-file", link],
        { from: "user" },
      ),
    ).rejects.toThrow("regular, non-symlink");
  });
  it("rejects a malicious explicit check before capability detection", async () => {
    const { program, start } = await setup();
    await expect(
      program.parseAsync(
        ["workflow", "start", "--yes", "--check", "npm test; touch owned"],
        { from: "user" },
      ),
    ).rejects.toThrow("Unsafe");
    expect(start).not.toHaveBeenCalled();
  });

  it("blocks an incompatible role before engine start", async () => {
    const { program, start } = await setup();
    await expect(
      program.parseAsync(
        ["workflow", "start", "--yes", "--supervisor", "grok"],
        { from: "user" },
      ),
    ).rejects.toThrow("Supervisor CLI grok is incompatible");
    expect(start).not.toHaveBeenCalled();
  });

  it("does not detect model capabilities when no trusted check exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "orch-workflow-cli-"));
    roots.push(root);
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: {} }),
    );
    await fs.writeFile(path.join(root, "package-lock.json"), "{}");
    const detectCapabilities = vi.fn(async () => capabilities);
    const container = makeContainer({
      context: {
        json: true,
        quiet: false,
        noColor: false,
        ascii: false,
        projectRoot: root,
      },
      config: { workflow: {} } as any,
    });
    const program = new Command().exitOverride();
    registerWorkflowCommand(program, container, {
      detectCapabilities,
      isTTY: () => false,
      readStdin: async () => "Objective",
    });
    await expect(
      program.parseAsync(["workflow", "start", "--yes"], { from: "user" }),
    ).rejects.toThrow("No meaningful deterministic check");
    expect(detectCapabilities).not.toHaveBeenCalled();
  });

  it("preserves a selected preset adviser when CLI options omit adviser", async () => {
    const selected = {
      supervisor: { adapter: "codex", model: "", effort: "high" },
      implementer: { adapter: "claude", model: "opus", effort: "high" },
      adviser: { adapter: "fable", model: "", effort: "low" },
      reviewer: "supervisor",
      mode: "adaptive",
      max_adviser_calls: 1,
    };
    const { program } = await setup({
      workflow: {},
      workflow_launch: { presets: { selected } },
    });
    await program.parseAsync(
      ["workflow", "start", "--yes", "--preset", "selected", "--dry-run"],
      { from: "user" },
    );
    const summary = JSON.parse(
      (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0],
    );
    expect(summary).toMatchObject({
      roster: { adviser: { adapter: "fable" } },
      adviser: { enabled: true, max_calls: 1 },
    });
  });
  it("rejects an explicit unverified model unless advanced opt-in is present", async () => {
    const { program, start } = await setup();
    await expect(
      program.parseAsync(
        ["workflow", "start", "--yes", "--supervisor-model", "explicit-model"],
        { from: "user" },
      ),
    ).rejects.toThrow("is unverified");
    expect(start).not.toHaveBeenCalled();
    await program.parseAsync(
      [
        "workflow",
        "start",
        "--yes",
        "--supervisor-model",
        "explicit-model",
        "--allow-unverified-model",
        "--dry-run",
      ],
      { from: "user" },
    );
    const summary = JSON.parse(
      (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0],
    );
    expect(summary.roster.supervisor.profile).toMatchObject({
      model: "explicit-model",
      verification: "UNVERIFIED",
    });
  });

  it("passes a separate reviewer profile through to engine start", async () => {
    const { program, start } = await setup();
    await program.parseAsync(
      [
        "workflow",
        "start",
        "--yes",
        "--reviewer",
        "claude",
        "--reviewer-model",
        "opus",
        "--reviewer-effort",
        "low",
      ],
      { from: "user" },
    );
    expect(start.mock.calls[0]![0].roster.reviewer).toEqual({
      adapter: "claude",
      profile: {
        name: "reviewer",
        model: "opus",
        effort: "low",
        max_turns: 1,
        timeout_ms: 600_000,
      },
    });
  });

  it("reports every CLI descriptor even when deterministic checks are missing", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "orch-workflow-doctor-"),
    );
    roots.push(root);
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: {} }),
    );
    const detectCapabilities = vi.fn(async () => ({
      ...capabilities,
      grok: descriptor("grok", null, true),
      antigravity: descriptor("antigravity", null, false),
    }));
    const container = makeContainer({
      context: {
        json: true,
        quiet: false,
        noColor: false,
        ascii: false,
        projectRoot: root,
      },
      config: { workflow: {} } as any,
    });
    const program = new Command().exitOverride();
    registerWorkflowCommand(program, container, {
      detectCapabilities,
      isTTY: () => false,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["workflow", "doctor"], { from: "user" });
    const output = JSON.parse(
      (console.log as ReturnType<typeof vi.fn>).mock.calls[0]![0],
    );
    expect(detectCapabilities).toHaveBeenCalledOnce();
    expect(Object.keys(output.cli_descriptors)).toEqual([
      "codex",
      "claude",
      "opencode",
      "fable",
      "grok",
      "antigravity",
    ]);
    expect(output.blockers).toContain(
      "No meaningful deterministic check was found",
    );
    expect(output.blockers.join("\n")).not.toContain("grok");
  });
  it("doctor evaluates the configured default preset and adviser compatibility", async () => {
    const selected = {
      supervisor: { adapter: "codex", model: "codex", effort: "high" },
      implementer: { adapter: "claude", model: "opus", effort: "high" },
      adviser: { adapter: "grok", model: "grok", effort: "low" },
      reviewer: "supervisor",
      mode: "adaptive",
      max_adviser_calls: 1,
    };
    const { program } = await setup({
      workflow: {},
      workflow_launch: { default_preset: "selected", presets: { selected } },
    });
    await program.parseAsync(["workflow", "doctor"], { from: "user" });
    const output = JSON.parse(
      (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0],
    );
    expect(output.evaluated_preset).toBe("selected");
    expect(output.blockers.join("\n")).toContain("Configured Adviser CLI grok");
  });

  it("requires explicit opt-in for an unverified binding rotation", async () => {
    const { program, rotateBinding } = await setup();
    await expect(
      program.parseAsync(
        [
          "workflow",
          "binding-rotate",
          "wf_test",
          "implementer",
          "--adapter",
          "claude",
          "--model",
          "sonnet",
          "--effort",
          "medium",
          "--reason",
          "supported upgrade",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow("is unverified");
    await program.parseAsync(
      [
        "workflow",
        "binding-rotate",
        "wf_test",
        "implementer",
        "--adapter",
        "claude",
        "--model",
        "sonnet",
        "--allow-unverified-model",
        "--effort",
        "medium",
        "--reason",
        "supported upgrade",
        "--max-turns",
        "25",
        "--timeout",
        "9000",
      ],
      { from: "user" },
    );
    expect(rotateBinding).toHaveBeenCalledWith(
      "wf_test",
      "implementer",
      {
        adapter: "claude",
        profile: {
          name: "opus",
          model: "sonnet",
          effort: "medium",
          max_turns: 25,
          timeout_ms: 9000,
        },
      },
      "supported upgrade",
      true,
    );
  });
  it("reports attempts by semantic role and adapter without provider double counting", async () => {
    const { program, container } = await setup();
    const roster = (await container.workflowStore.readPassport("wf_test"))!
      .roster!;
    const zero = {
      calls: 0,
      input_chars: 0,
      output_chars: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_tokens: 0,
      cache_read: 0,
      cache_write: 0,
      duration_ms: 0,
      failed_calls: 0,
      resumes: 0,
      compactions: 0,
    };
    const attempt = (
      semantic_role: string,
      adapter: string,
      status: string,
      input_tokens?: number,
    ) => ({
      semantic_role,
      adapter,
      status,
      usage_status: input_tokens === undefined ? "unknown" : "known",
      usage:
        input_tokens === undefined
          ? { duration_ms: 5 }
          : { input_tokens, output_tokens: 1, duration_ms: 5 },
    });
    Object.assign(container.workflowStore, {
      listJobs: vi.fn(async () => [{ job_id: "wf_test" }]),
      readJob: vi.fn(async () => ({
        job_id: "wf_test",
        mode: "direct",
        phase: "done",
        consultation_origin: null,
        fable_calls: 0,
        blocker: null,
      })),
      readSessions: vi.fn(async () => ({
        usage: {
          codex: { ...zero, calls: 9, estimated_tokens: 999 },
          fable: zero,
          opus: zero,
        },
      })),
      readPassport: vi.fn(async () => ({
        mode: "direct",
        roster,
        roster_hash: "a".repeat(64),
        active_roster: roster,
        active_roster_hash: "a".repeat(64),
        roster_revision: 1,
        binding_rotation_history: [],
        config: { fable_total_cap: 0 },
        required_checks: ["npm test"],
      })),
      readInvocationReceipts: vi.fn(async () => []),
      readLlmAttempts: vi.fn(async () => [
        attempt("supervisor", "codex", "succeeded", 10),
        attempt("implementer", "claude", "failed"),
      ]),
    });
    await program.parseAsync(["workflow", "status", "wf_test"], {
      from: "user",
    });
    const status = JSON.parse(
      (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0],
    );
    expect(status.usage.source).toBe("semantic_attempts");
    expect(status.usage.semantic_roles.supervisor).toMatchObject({
      attempts: 1,
      succeeded: 1,
      known_tokens: 11,
    });
    expect(status.usage.semantic_roles.implementer).toMatchObject({
      attempts: 1,
      failed: 1,
      unknown_usage: 1,
    });
    expect(status.usage.adapters).toMatchObject({
      codex: { attempts: 1 },
      claude: { attempts: 1, failed: 1 },
    });
    expect(status.usage.legacy_fallback).toMatchObject({
      additive: false,
      source: "legacy_provider_buckets",
    });
    expect(status.tokens).toEqual({
      exact: null,
      estimated: 0,
      unknown_attempts: 1,
      estimated_attempts: 0,
    });
  });
  it("does not label estimated-only usage as exact", async () => {
    const { program, container } = await setup();
    const roster = (await container.workflowStore.readPassport("wf_test"))!
      .roster!;
    const zero = {
      calls: 0,
      input_chars: 0,
      output_chars: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_tokens: 0,
      cache_read: 0,
      cache_write: 0,
      duration_ms: 0,
      failed_calls: 0,
      resumes: 0,
      compactions: 0,
    };
    Object.assign(container.workflowStore, {
      listJobs: vi.fn(async () => [{ job_id: "wf_test" }]),
      readJob: vi.fn(async () => ({
        job_id: "wf_test",
        mode: "direct",
        phase: "done",
        consultation_origin: null,
        fable_calls: 0,
        blocker: null,
      })),
      readSessions: vi.fn(async () => ({
        usage: { codex: zero, fable: zero, opus: zero },
      })),
      readPassport: vi.fn(async () => ({
        mode: "direct",
        roster,
        roster_hash: "a".repeat(64),
        active_roster: roster,
        active_roster_hash: "a".repeat(64),
        roster_revision: 1,
        binding_rotation_history: [],
        config: { fable_total_cap: 0 },
        required_checks: ["npm test"],
      })),
      readInvocationReceipts: vi.fn(async () => []),
      readLlmAttempts: vi.fn(async () => [
        {
          invocation_id: "inv_1",
          semantic_role: "supervisor",
          adapter: "codex",
          status: "succeeded",
          usage_status: "estimated",
          usage: { input_chars: 8, output_chars: 4, duration_ms: 5 },
        },
      ]),
    });
    await program.parseAsync(["workflow", "status", "wf_test"], {
      from: "user",
    });
    const status = JSON.parse(
      (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0],
    );
    expect(status.tokens).toMatchObject({
      exact: null,
      estimated: 3,
      estimated_attempts: 1,
    });
    expect(status.usage.completeness).toBe("mixed_unknown");
  });
});
