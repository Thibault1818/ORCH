import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CheckResults,
  CodexDecisionStage,
  CodexDecisionV2,
  FableAdviceV1,
  FableQueryV1,
  OpusResult,
} from "../../domain/workflow/contracts.js";
import type { WorkflowPassportV2 } from "../../domain/workflow/state.js";
import type {
  RosterAgent,
  SemanticRole,
} from "../../domain/workflow/roster.js";
import { ProcessManager, type IProcessManager } from "../process/process-manager.js";
import { CommandRunner, commandFailureMessage, requireExecutable, resolveExecutable, type ExecutableDescriptor, type ICommandRunner } from "../process/command-runner.js";
import { HardenedGit } from "../git/hardened-git.js";
import { buildChildEnv } from "../adapters/utils.js";
import type {
  AdapterCapabilityDescriptor,
  WorkflowCapabilityRole,
} from "../adapters/interface.js";
import type {
  CodexDecisionEvidence,
  CodexRolePort,
  FableCallOptions,
  FableRolePort,
  GitEvidence,
  OpusRolePort,
  RoleAttemptEvent,
  RoleResult,
  WorkflowGitPort,
  WorkflowRoleResolver,
} from "../../application/workflow/ports.js";
import { hashCanonical } from "./artifact-store.js";
import { WorkflowDriverRegistry } from "./driver-registry.js";
import { validateExplicitChecks } from "../../application/workflow/check-discovery.js";

export class NativeCodexWorkflowAdapter implements CodexRolePort {
  constructor(private readonly pm: IProcessManager, private readonly runner?: ICommandRunner, private readonly safeguards?: WorkflowExecutionSafeguards) {}
  decide(
    passport: WorkflowPassportV2,
    stage: CodexDecisionStage,
    evidence: CodexDecisionEvidence,
    thread: string | null,
    observe: (event: RoleAttemptEvent) => Promise<void> = async () => {},
  ) {
    const instruction =
      "Return only strict JSON with schema_version 2, job_id, action DISPATCH_OPUS|ACCEPT|CORRECT_OPUS|CONSULT_FABLE|PAUSE|STOP, summary, implementation_brief, required_changes, risk_level low|medium|high, fable_query, reviewed_commit, fable_advice_disposition, fable_error, fable_iteration_effect. Use fable_query:null normally. Set the three Fable outcome fields to null except after a Fable consultation; then record accepted|rejected, any explicit error or null, and avoided|added|unchanged iteration effect. CONSULT_FABLE is exceptional, low-risk, advisory-only, and requires purpose, question, verification_method, and fallback_if_skipped. Never ask Fable about repository facts, security, architecture, merge approval, or irreversible decisions.";
    return this.call<CodexDecisionV2>(
      instruction,
      { stage, passport: project(passport), ...evidence },
      passport,
      thread,
      evidence.evidence?.worktree ?? process.cwd(),
      observe,
    );
  }
  async available() {
    const result = await capability("codex");
    return {
      available: result.available && result.unsupported_options.length === 0,
      detail: result.detail,
    };
  }
  private async call<T>(
    instruction: string,
    projection: unknown,
    passport: WorkflowPassportV2,
    thread: string | null,
    cwd = process.cwd(),
    observe: (event: RoleAttemptEvent) => Promise<void> = async () => {},
  ): Promise<RoleResult<T>> {
    const capabilities = await capability("codex");
    const native = thread !== null && capabilities.native_resume;
    let result: Awaited<ReturnType<NativeCodexWorkflowAdapter["run"]>>;
    let fallback = false;
    try {
      result = await this.run(
        instruction,
        projection,
        passport,
        cwd,
        native ? thread : null,
        observe,
      );
    } catch (error) {
      if (!native || !isInvalidSession(error)) throw error;
      result = await this.run(
        instruction,
        projection,
        passport,
        cwd,
        null,
        observe,
      );
      fallback = true;
    }
    return {
      value: parseJson<T>(result.text, result.usage),
      session_id:
        result.sessionId ?? (!fallback ? (thread ?? undefined) : undefined),
      session_mode:
        fallback || (thread !== null && !native)
          ? "passport_handoff"
          : native
            ? "native_resume"
            : "new",
      resumed: native && !fallback,
      resume_failed: thread !== null && (!native || fallback),
      usage: result.usage,
    };
  }
  private async run(
    instruction: string,
    projection: unknown,
    passport: WorkflowPassportV2,
    cwd: string,
    resumeId: string | null,
    observe: (event: RoleAttemptEvent) => Promise<void>,
  ) {
    const profile = passport.config.profiles.codex;
    const prompt = bounded(
      `${instruction}\n\n${JSON.stringify(projection)}`,
      passport.config.max_input_bytes,
    );
    const args = resumeId
      ? ["exec", "resume", resumeId, "--json", "--sandbox", "read-only"]
      : ["exec", "--json", "--sandbox", "read-only"];
    if (profile.model) args.push("--model", profile.model);
    args.push("-c", `model_reasoning_effort=${profile.effort}`, "-");
    return observedCall(observe, async () => {
      const output = await spawnCapture(
        this.pm,
        this.runner,
        this.safeguards,
        passport.job_id,
        "codex",
        args,
        cwd,
        prompt,
        passport.config.max_output_bytes,
        profile.timeout_ms,
      );
      const lines = output.split("\n").filter(Boolean).map(parseObject);
      let text = "";
      let sessionId: string | undefined;
      let usage: Record<string, number> = {};
      for (const line of lines) {
        if (
          line.type === "thread.started" &&
          typeof line.thread_id === "string"
        )
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
          output_tokens: usage.output_tokens,
        },
      };
    });
  }
}

export class NativeFableWorkflowAdapter implements FableRolePort {
  constructor(private readonly pm: IProcessManager, private readonly runner?: ICommandRunner, private readonly safeguards?: WorkflowExecutionSafeguards) {}
  consult(
    jobId: string,
    consultationId: string,
    query: FableQueryV1,
    options: FableCallOptions,
    observe: (event: RoleAttemptEvent) => Promise<void> = async () => {},
  ) {
    return this.call<FableAdviceV1>(
      "Answer one bounded noncritical question. Return only strict JSON with schema_version:1, consultation_id, answer, alternatives, uncertainties. Do not return actions, verdicts, execution instructions, passport updates, or merge advice.",
      {
        job_id: jobId,
        consultation_id: consultationId,
        purpose: query.purpose,
        question: query.question,
        verification_method: query.verification_method,
      },
      jobId,
      options,
      observe,
    );
  }
  async available() {
    const result = await capability("claude", "fable");
    return {
      available: result.available && result.unsupported_options.length === 0,
      detail: result.detail,
    };
  }
  private async call<T>(
    instruction: string,
    projection: unknown,
    jobId: string,
    options: FableCallOptions,
    observe: (event: RoleAttemptEvent) => Promise<void>,
  ): Promise<RoleResult<T>> {
    const prompt = bounded(
      `${instruction}\n\n${JSON.stringify(projection)}`,
      options.max_input_bytes,
    );
    const result = await observedCall(observe, () =>
      claudeCall(
         this.pm,
         this.runner,
         this.safeguards,
         jobId,
        prompt,
        options.workspace,
        options.model,
        1,
        "low",
        options.timeout_ms,
        options.max_output_bytes,
        true,
      ),
    );
    return {
      value: parseJson<T>(result.text, result.usage),
      session_mode: "none",
      usage: result.usage,
    };
  }
}

export class NativeOpusWorkflowAdapter implements OpusRolePort {
  constructor(private readonly pm: IProcessManager, private readonly runner?: ICommandRunner, private readonly safeguards?: WorkflowExecutionSafeguards) {}
  async execute(
    passport: WorkflowPassportV2,
    prompt: string,
    workspace: string,
    sessionId: string | null,
    mode: "new" | "native_resume" | "passport_handoff",
    observe: (event: RoleAttemptEvent) => Promise<void> = async () => {},
  ) {
    const taskContext = JSON.stringify({
      job_id: passport.job_id,
      objective: passport.objective,
      hard_constraints: passport.hard_constraints,
      accepted_brief_hash: passport.accepted_brief_hash,
      acceptance_criteria: passport.acceptance_criteria,
      allowed_file_scope: passport.allowed_file_scope,
      required_checks: passport.required_checks,
    });
    const profile = passport.config.profiles.opus;
    const capabilities = await capability("claude", "opus");
    const native =
      mode === "native_resume" &&
      sessionId !== null &&
      capabilities.native_resume;
    const effectiveMode: "new" | "native_resume" | "passport_handoff" = native
      ? "native_resume"
      : sessionId
        ? "passport_handoff"
        : "new";
    const recovery =
      effectiveMode === "passport_handoff"
        ? `This is a new process using a compact passport handoff, not a resumed native session.\n${JSON.stringify(project(passport))}\n\n`
        : "";
    const instruction = `Task passport projection:\n${taskContext}\n\nDo not modify files outside allowed_file_scope when it is non-empty.\n\n${recovery}${prompt}\n\nImplement, test, and commit on the current worktree branch. End with strict JSON: job_id, status completed|partial|failed, files_changed, commands_run, tests_reported, deviations, unresolved, summary.`;
    let result: Awaited<ReturnType<typeof claudeCall>>;
    let fallback = false;
    try {
      result = await observedCall(observe, () =>
        claudeCall(
           this.pm,
           this.runner,
           this.safeguards,
           passport.job_id,
          bounded(instruction, passport.config.max_input_bytes),
          workspace,
          profile.model,
          profile.max_turns,
          profile.effort,
          profile.timeout_ms,
          passport.config.max_output_bytes,
          false,
          native ? sessionId : null,
        ),
      );
    } catch (error) {
      if (!native || !isInvalidSession(error)) throw error;
      const handoff = `Task passport projection:\n${taskContext}\n\nDo not modify files outside allowed_file_scope when it is non-empty.\n\nThis is a new process using a compact passport handoff, not a resumed native session.\n${JSON.stringify(project(passport))}\n\n${prompt}\n\nImplement, test, and commit on the current worktree branch. End with strict JSON: job_id, status completed|partial|failed, files_changed, commands_run, tests_reported, deviations, unresolved, summary.`;
      result = await observedCall(observe, () =>
        claudeCall(
         this.pm,
         this.runner,
         this.safeguards,
         passport.job_id,
          bounded(handoff, passport.config.max_input_bytes),
          workspace,
          profile.model,
          profile.max_turns,
          profile.effort,
          profile.timeout_ms,
          passport.config.max_output_bytes,
        ),
      );
      fallback = true;
    }
    return {
      value: parseJson<OpusResult>(result.text, result.usage),
      session_id:
        result.sessionId ?? (!fallback ? (sessionId ?? undefined) : undefined),
      session_mode: fallback ? "passport_handoff" : effectiveMode,
      resumed: native && !fallback,
      resume_failed: sessionId !== null && (!native || fallback),
      usage: result.usage,
    };
  }
  async available() {
    const result = await capability("claude", "opus");
    return {
      available: result.available && result.unsupported_options.length === 0,
      detail: result.detail,
    };
  }
}

export class NativeOpenCodeWorkflowAdapter implements OpusRolePort {
  constructor(private readonly pm: IProcessManager, private readonly runner?: ICommandRunner, private readonly safeguards?: WorkflowExecutionSafeguards) {}

  async execute(
    passport: WorkflowPassportV2,
    prompt: string,
    workspace: string,
    sessionId: string | null,
    _mode: "new" | "native_resume" | "passport_handoff",
    observe: (event: RoleAttemptEvent) => Promise<void> = async () => {},
  ): Promise<RoleResult<OpusResult>> {
    const profile = passport.config.profiles.opus;
    if (!profile.model || !profile.model.includes("/"))
      throw new Error("OpenCode workflow implementers require an explicit provider/model");
    const recovery = sessionId ? `This is a new OpenCode process using a compact passport handoff.\n${JSON.stringify(project(passport))}\n\n` : "";
    const instruction = bounded(`${recovery}${prompt}\n\nImplement and commit only in the current worktree. End with strict JSON: job_id, status completed|partial|failed, files_changed, commands_run, tests_reported, deviations, unresolved, summary.`, passport.config.max_input_bytes);
    const result = await observedCall(observe, () => openCodeCall(this.pm, this.runner, this.safeguards, passport.job_id, instruction, workspace, profile.model, profile.timeout_ms, passport.config.max_output_bytes));
    return {
      value: parseJson<OpusResult>(result.text, result.usage),
      session_id: result.sessionId,
      session_mode: sessionId ? "passport_handoff" : "new",
      resumed: false,
      resume_failed: sessionId !== null,
      usage: result.usage,
    };
  }

  async available() {
    const result = await capability("opencode");
    return { available: result.available && result.unsupported_options.length === 0, detail: result.detail };
  }
}

export class NativeWorkflowRoleResolver implements WorkflowRoleResolver {
  private readonly registry: WorkflowDriverRegistry;

  constructor(value: IProcessManager | WorkflowDriverRegistry, runner?: ICommandRunner, safeguards?: WorkflowExecutionSafeguards) {
    if (!(value instanceof WorkflowDriverRegistry) && (!runner || !safeguards)) throw new Error('Native workflow execution requires a command runner and safeguards');
    this.registry = value instanceof WorkflowDriverRegistry ? value : createNativeWorkflowDriverRegistry(value, runner!, safeguards!);
  }

  async availability(binding: RosterAgent, role: SemanticRole) {
    const driver = role === "implementer"
      ? this.registry.get(binding.adapter, "implementer")
      : role === "adviser"
        ? this.registry.get(binding.adapter, "adviser")
        : this.registry.get(binding.adapter, role);
    return driver ? driver.available() : { available: false, detail: `Unsupported ${role} binding: ${binding.adapter}` };
  }

  decide(
    binding: RosterAgent,
    passport: WorkflowPassportV2,
    stage: CodexDecisionStage,
    evidence: CodexDecisionEvidence,
    threadId: string | null,
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ) {
    const role = stage === "post_opus" || stage === "after_fable_post" ? "reviewer" : "supervisor";
    const driver = this.registry.require(binding.adapter, role);
    return driver.decide(
      withProfile(passport, "codex", binding),
      stage,
      evidence,
      threadId,
      observer,
    );
  }

  execute(
    binding: RosterAgent,
    passport: WorkflowPassportV2,
    prompt: string,
    workspace: string,
    sessionId: string | null,
    mode: "new" | "native_resume" | "passport_handoff",
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ) {
    const driver = this.registry.require(binding.adapter, "implementer");
    return driver.execute(
      withProfile(passport, "opus", binding),
      prompt,
      workspace,
      sessionId,
      mode,
      observer,
    );
  }

  consult(
    binding: RosterAgent,
    jobId: string,
    consultationId: string,
    query: FableQueryV1,
    options: FableCallOptions,
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ) {
    const driver = this.registry.require(binding.adapter, "adviser");
    return driver.consult(
      jobId,
      consultationId,
      query,
      {
        ...options,
        model: binding.profile.model,
        timeout_ms: binding.profile.timeout_ms,
      },
      observer,
    );
  }
}

export function createNativeWorkflowDriverRegistry(pm: IProcessManager, runner: ICommandRunner, safeguards: WorkflowExecutionSafeguards): WorkflowDriverRegistry {
  const codex = new NativeCodexWorkflowAdapter(pm, runner, safeguards);
  const adviser = new NativeFableWorkflowAdapter(pm, runner, safeguards);
  const implementer = new NativeOpusWorkflowAdapter(pm, runner, safeguards);
  const openCode = new NativeOpenCodeWorkflowAdapter(pm, runner, safeguards);
  return new WorkflowDriverRegistry()
    .register("codex", "supervisor", codex)
    .register("codex", "reviewer", codex)
    .register("claude", "implementer", implementer)
    .register("opencode", "implementer", openCode)
    .register("claude", "adviser", adviser)
    .register("fable", "adviser", adviser);
}

export class NativeWorkflowGitGateway implements WorkflowGitPort {
  private readonly runner: ICommandRunner;
  private readonly gitRunner: Promise<HardenedGit>;
  constructor(
    private readonly projectRoot: string,
    runner: ICommandRunner,
    private readonly workspaceRoot = path.join(os.tmpdir(), "orchestry-workspaces"),
    gitExecutable: ExecutableDescriptor,
    private readonly executionSafeguards: WorkflowExecutionSafeguards,
  ) {
    const commandRunner = runner;
    this.runner = commandRunner;
    this.gitRunner = (async () => new HardenedGit(
      commandRunner,
      gitExecutable ?? await resolveExecutable("git"),
      { configRoot: path.join(this.workspaceRoot, ".git-runtime") },
    ))();
  }
  validateChecks(commands: string[], root = this.projectRoot) {
    return validateExplicitChecks(root, commands);
  }
  async prepare(jobId: string) {
    const branch = `orchestry/workflow/${jobId}`;
    const target_branch = (
      await this.git(this.projectRoot, ["branch", "--show-current"])
    ).trim();
    if (!target_branch) throw new Error("Controller must be on a named branch");
    const base_commit = (
      await this.git(this.projectRoot, ["rev-parse", "HEAD"])
    ).trim();
    const worktree = path.join(this.workspaceRoot, jobId);
    await fs.mkdir(path.dirname(worktree), { recursive: true, mode: 0o700 });
    try {
      const existingBranch = (
        await this.git(worktree, ["branch", "--show-current"])
      ).trim();
      const existingCommit = (
        await this.git(worktree, ["rev-parse", "HEAD"])
      ).trim();
      const status = (await this.git(worktree, ["status", "--porcelain"])).trim();
      if (existingBranch !== branch || existingCommit !== base_commit || status)
        throw new Error(
          "Existing workflow clone does not match the expected clean base",
        );
      return { branch, worktree, target_branch, base_commit };
    } catch (error) {
      if (error instanceof Error && error.message.includes("does not match"))
        throw error;
    }
    try {
      await this.git(this.workspaceRoot, ["clone", "--local", "--no-hardlinks", this.projectRoot, worktree], { fileProtocol: "always" });
      await this.git(worktree, ["checkout", "-b", branch, base_commit]);
    } catch (error) {
      await fs.rm(worktree, { recursive: true, force: true });
      throw error;
    }
    await fs.rm(path.join(worktree, ".orchestry"), {
      recursive: true,
      force: true,
    });
    return { branch, worktree, target_branch, base_commit };
  }
  async inspect(branch: string, worktree: string): Promise<GitEvidence> {
    const status = (await this.git(worktree, ["status", "--porcelain"])).trim();
    if (status)
      throw new Error(
        "Opus worktree contains uncommitted changes; review requires a committed snapshot",
      );
    const commit = (await this.git(worktree, ["rev-parse", "HEAD"])).trim();
    const base = (
      await this.git(worktree, ["merge-base", `origin/${await this.targetBranch(worktree)}`, branch])
    ).trim();
    const diff = await this.git(
      worktree,
      ["diff", "--binary", `${base}...${commit}`],
      { maxStdoutBytes: 16 * 1024 * 1024 },
    );
    const files = (
      await this.git(worktree, [
        "diff",
        "--name-only",
        `${base}...${commit}`,
      ])
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    const stat = await this.git(worktree, [
      "diff",
      "--numstat",
      `${base}...${commit}`,
    ]);
    let insertions = 0;
    let deletions = 0;
    for (const line of stat.split("\n")) {
      const [a, d] = line.split("\t");
      insertions += Number(a) || 0;
      deletions += Number(d) || 0;
    }
    const risk_signals = files.filter((file) =>
      /auth|security|secret|migration|deploy|infra|billing/i.test(file),
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
      risk_signals,
    };
  }
  async runChecks(
    worktree: string,
    commit: string,
    commands: string[],
  ): Promise<CheckResults> {
    const trusted = await this.validateChecks(commands, worktree);
    const proxy = await this.executionSafeguards.proxyEndpoint();
    const allowedExecutables = await this.executionSafeguards.executableAllowlist();
    const checks: CheckResults["checks"] = [];
    for (const command of trusted) {
      const [executable, ...args] = command.split(" ");
      let executionRoot: string | null = null;
      try {
        const [absolute, beforeHead, beforeStatus] = await Promise.all([
          resolveCheckExecutable(executable!, worktree),
          this.git(worktree, ["rev-parse", "HEAD"]),
          this.git(worktree, ["status", "--porcelain"]),
        ]);
        if (beforeHead.trim() !== commit || beforeStatus.trim())
          throw new Error("Check worktree is not the exact clean reviewed commit");
        executionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-check-"));
        await Promise.all([
          fs.mkdir(path.join(executionRoot, "home"), { mode: 0o700 }),
          fs.mkdir(path.join(executionRoot, "xdg-config"), { mode: 0o700 }),
          fs.mkdir(path.join(executionRoot, "xdg-cache"), { mode: 0o700 }),
          fs.mkdir(path.join(executionRoot, "tmp"), { mode: 0o700 }),
        ]);
        const result = await this.runner.run({
          executable: absolute,
          args,
          cwd: worktree,
          env: checkEnvironment(executionRoot, worktree, absolute),
          timeoutMs: 15 * 60_000,
          maxStdoutBytes: 4 * 1024 * 1024,
          maxStderrBytes: 4 * 1024 * 1024,
          owner: path.basename(worktree),
          allowedExecutables,
           sandbox: { workspace: worktree, proxyAddress: proxy, writableWorkspace: true, readOnlyFiles: allowedExecutables.map((value) => value.realpath) },
        });
        const [afterHead, afterStatus] = await Promise.all([
          this.git(worktree, ["rev-parse", "HEAD"]),
          this.git(worktree, ["status", "--porcelain"]),
        ]);
        const unchanged = afterHead.trim() === commit && !afterStatus.trim();
        checks.push({
          command,
          passed: result.ok && unchanged,
          output: `${result.stdout}${result.stderr}${unchanged ? "" : "\nCheck mutated the reviewed worktree"}${result.ok ? "" : `\n${commandFailureMessage(result)}`}`,
        });
      } catch (error) {
        checks.push({
          command,
          passed: false,
          output: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (executionRoot) await fs.rm(executionRoot, { recursive: true, force: true });
      }
    }
    return {
      job_id: path.basename(worktree),
      commit,
      passed: checks.every((check) => check.passed),
      checks,
    };
  }
  async currentCommit(branch: string) {
    return (await this.git(this.cloneForBranch(branch), ["rev-parse", branch])).trim();
  }
  async isMerged(
    _branch: string,
    commit: string,
    targetBranch: string,
    baseCommit: string,
  ) {
    try {
      const currentBranch = (
        await this.git(this.projectRoot, ["branch", "--show-current"])
      ).trim();
      if (currentBranch !== targetBranch) return false;
      await this.git(this.projectRoot, [
        "merge-base",
        "--is-ancestor",
        baseCommit,
        targetBranch,
      ]);
      await this.git(this.projectRoot, [
        "merge-base",
        "--is-ancestor",
        commit,
        targetBranch,
      ]);
      const reviewedTree = (
        await this.git(this.cloneForBranch(_branch), ["rev-parse", `${commit}^{tree}`])
      ).trim();
      const targetTree = (
        await this.git(this.projectRoot, ["rev-parse", `${targetBranch}^{tree}`])
      ).trim();
      return reviewedTree === targetTree;
    } catch {
      return false;
    }
  }
  async merge(
    branch: string,
    expectedCommit: string,
    targetBranch: string,
    baseCommit: string,
  ) {
    try {
      if (!branch.startsWith("orchestry/workflow/"))
        return {
          success: false,
          detail: "Refusing to merge a non-workflow branch",
        };
      const currentBranch = (
        await this.git(this.projectRoot, ["branch", "--show-current"])
      ).trim();
      if (currentBranch !== targetBranch)
        return {
          success: false,
          detail: `Controller branch changed from ${targetBranch} to ${currentBranch}`,
        };
      const targetCommit = (
        await this.git(this.projectRoot, ["rev-parse", "HEAD"])
      ).trim();
      if (targetCommit !== baseCommit)
        return {
          success: false,
          detail: "Target branch changed since workflow start",
        };
      const branchCommit = (await this.git(this.cloneForBranch(branch), ["rev-parse", branch])).trim();
      if (branchCommit !== expectedCommit)
        return {
          success: false,
          detail: "Workflow branch changed after review",
        };
      const status = (
        await this.git(this.projectRoot, ["status", "--porcelain"])
      ).trim();
      if (status)
        return { success: false, detail: "Controller worktree is dirty" };
      const integrationRef = `refs/orchestry/integration/${path.basename(branch)}`;
      await this.git(this.projectRoot, ["fetch", "--no-tags", this.cloneForBranch(branch), `${expectedCommit}:${integrationRef}`], { fileProtocol: "always" });
      await this.git(this.projectRoot, [
        "merge",
        "--no-ff",
        integrationRef,
        "-m",
        `Merge reviewed ${branch}`,
      ]);
      return { success: true, detail: "merged" };
    } catch (error) {
      await this.git(this.projectRoot, ["merge", "--abort"]).catch(() => "");
      return {
        success: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private cloneForBranch(branch: string): string {
    if (!branch.startsWith("orchestry/workflow/")) throw new Error("Invalid workflow branch");
    return path.join(this.workspaceRoot, branch.slice("orchestry/workflow/".length));
  }

  private async targetBranch(worktree: string): Promise<string> {
    const value = (await this.git(worktree, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
    return value.replace(/^origin\//, "");
  }

  private async git(cwd: string, args: readonly string[], options: { fileProtocol?: "user" | "always"; maxStdoutBytes?: number } = {}): Promise<string> {
    return (await this.gitRunner).run(cwd, args, options);
  }
}

async function resolveCheckExecutable(command: string, worktree: string): Promise<string> {
  if (["tsc", "vitest", "jest", "eslint", "biome"].includes(command)) {
    const local = path.join(worktree, "node_modules", ".bin", command);
    try { return await requireExecutable(local); } catch { /* use the approved PATH fallback */ }
  }
  return requireExecutable(command);
}

function checkEnvironment(root: string, worktree: string, executable: string): NodeJS.ProcessEnv {
  const home = path.join(root, "home");
  const pathEntries = [path.join(worktree, "node_modules", ".bin"), path.dirname(executable), path.dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return {
    ...buildChildEnv(),
    PATH: [...new Set(pathEntries)].join(path.delimiter),
    HOME: home,
    XDG_CONFIG_HOME: path.join(root, "xdg-config"),
    XDG_CACHE_HOME: path.join(root, "xdg-cache"),
    TMPDIR: path.join(root, "tmp"),
    NPM_CONFIG_CACHE: path.join(root, "npm-cache"),
    NPM_CONFIG_USERCONFIG: path.join(root, "npmrc"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    CI: "1",
    NO_COLOR: "1",
  };
}

async function claudeCall(
  pm: IProcessManager,
  runner: ICommandRunner | undefined,
  safeguards: WorkflowExecutionSafeguards | undefined,
  owner: string,
  prompt: string,
  cwd: string,
  model: string,
  maxTurns: number,
  effort: "low" | "medium" | "high",
  timeout: number,
  maxOutput: number,
  toolFree = false,
  resumeId: string | null = null,
) {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--max-turns",
    String(maxTurns),
    "--verbose",
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
      "--no-session-persistence",
    );
  const output = await spawnCapture(
    pm,
    runner,
    safeguards,
    owner,
    "claude",
    args,
    cwd,
    prompt,
    maxOutput,
    timeout,
  );
  let text = "";
  let sessionId: string | undefined;
  let usage: Record<string, number> = {};
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
      cache_write: usage.cache_creation_input_tokens,
    },
  };
}
async function openCodeCall(pm: IProcessManager, runner: ICommandRunner | undefined, safeguards: WorkflowExecutionSafeguards | undefined, owner: string, prompt: string, cwd: string, model: string, timeout: number, maxOutput: number) {
  const args = ["run", "--format", "json", "--pure", "--model", model];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orch-opencode-"));
  const home = path.join(root, "home");
  const xdgConfig = path.join(root, "xdg-config");
  const xdgData = path.join(root, "xdg-data");
  const xdgCache = path.join(root, "xdg-cache");
  await Promise.all([home, xdgConfig, xdgData, xdgCache].map((dir) => fs.mkdir(dir, { recursive: true, mode: 0o700 })));
  const configPath = path.join(root, "opencode.json");
  await fs.writeFile(configPath, JSON.stringify({ $schema: "https://opencode.ai/config.json", model, small_model: model, share: "disabled", enabled_providers: [model.split("/")[0]], plugin: [], mcp: {} }), { mode: 0o600 });
  let output: string;
  try {
    output = await spawnCapture(pm, runner, safeguards, owner, "opencode", args, cwd, prompt, maxOutput, timeout, {
      HOME: home,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_DATA_HOME: xdgData,
      XDG_CACHE_HOME: xdgCache,
      OPENCODE_CONFIG: configPath,
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  let text = "";
  let sessionId: string | undefined;
  let usage: Record<string, number> = {};
  for (const line of output.split("\n").filter(Boolean).map(parseObject)) {
    const part = object(line.part);
    if (line.type === "text" && typeof part.text === "string") text += part.text;
    if (typeof line.sessionID === "string") sessionId = line.sessionID;
    if (line.type === "step_finish") usage = usageObject(part.tokens);
  }
  if (!text) throw new Error("OpenCode returned no result");
  return { text, sessionId, usage: { input_tokens: usage.input, output_tokens: usage.output, duration_ms: undefined } };
}
async function spawnCapture(
  pm: IProcessManager,
  runner: ICommandRunner | undefined,
  safeguards: WorkflowExecutionSafeguards | undefined,
  owner: string,
  command: string,
  args: string[],
  cwd: string,
  input: string,
  maxBytes: number,
  timeoutMs: number,
  extraEnv?: Record<string, string>,
): Promise<string> {
  const effectiveRunner = runner ?? new CommandRunner(pm);
  const executable = effectiveRunner.resolveExecutable
    ? await effectiveRunner.resolveExecutable(command)
    : await resolveExecutable(command);
  const allowedExecutables = safeguards ? await safeguards.executableAllowlist([command]) : [executable];
  const sandbox = safeguards ? {
    workspace: cwd,
    proxyAddress: await safeguards.proxyEndpoint(),
    writableWorkspace: true,
    readOnlyPaths: allowedExecutables.map((value) => value.realpath),
  } : undefined;
  const result = await effectiveRunner.run({
    executable,
    args,
    cwd,
    stdin: input,
    env: buildChildEnv(undefined, extraEnv),
    timeoutMs,
    maxStdoutBytes: maxBytes,
    maxStderrBytes: 64_000,
    owner,
    allowedExecutables,
    ...(sandbox ? { sandbox } : {}),
  });
  if (!result.ok) throw new Error(commandFailureMessage(result));
  return result.stdout;
}

export interface WorkflowExecutionSafeguards {
  assertReady(): Promise<unknown>;
  assertQuiescent(owner: string): Promise<void>;
  executableAllowlist(extra?: readonly string[]): Promise<ExecutableDescriptor[]>;
  proxyEndpoint(): Promise<{ host: string; port: number }>;
}
async function observedCall<T extends { usage?: RoleResult<unknown>["usage"] }>(
  observe: (event: RoleAttemptEvent) => Promise<void>,
  call: () => Promise<T>,
): Promise<T> {
  const attemptKey = randomUUID();
  const started = Date.now();
  await observe({ attempt_key: attemptKey, status: "started" });
  try {
    const result = await call();
    result.usage = {
      ...result.usage,
      duration_ms: result.usage?.duration_ms ?? Date.now() - started,
    };
    await observe({
      attempt_key: attemptKey,
      status: "succeeded",
      usage: result.usage,
    });
    return result;
  } catch (error) {
    await observe({
      attempt_key: attemptKey,
      status: "failed",
      error,
      usage: {
        ...usageFromError(error),
        duration_ms: usageFromError(error)?.duration_ms ?? Date.now() - started,
      },
    });
    throw error;
  }
}
export async function detectWorkflowCapabilities(runner?: ICommandRunner): Promise<
  Record<
    "codex" | "claude" | "opencode" | "fable" | "grok" | "antigravity",
    AdapterCapabilityDescriptor
  >
> {
  const [codex, claude, opencode, fable, grok, antigravity] = await Promise.all([
    capability("codex", "opus", runner),
    capability("claude", "opus", runner),
    capability("opencode", "opus", runner),
    capability("claude", "fable", runner),
    capability("grok", "opus", runner),
    capability("agy", "opus", runner),
  ]);
  return { codex, claude, opencode, fable, grok, antigravity };
}

async function capability(
  command: "codex" | "claude" | "opencode" | "grok" | "agy",
  role: "opus" | "fable" = "opus",
  providedRunner?: ICommandRunner,
): Promise<AdapterCapabilityDescriptor> {
  const adapter =
    command === "agy"
      ? "antigravity"
      : command === "claude" && role === "fable"
        ? "fable"
        : command;
  try {
    const env = buildChildEnv();
    const runner = providedRunner ?? new CommandRunner(new ProcessManager());
    const executable = runner.resolveExecutable ? await runner.resolveExecutable(command) : await resolveExecutable(command);
    const helpArgs = command === "opencode" ? ["run", "--help"] : ["--help"];
    const [{ stdout: version, stderr: versionError }, { stdout: help, stderr: helpError }] = await Promise.all([
      runner.run({ executable, args: ["--version"], env, timeoutMs: 5_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 }),
      runner.run({ executable, args: helpArgs, env, timeoutMs: 5_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 }),
    ]);
    return describeCapability(adapter, command, role, `${version}${versionError}`.trim(), `${help}${helpError}`);
  } catch {
    return unavailableCapability(adapter, command);
  }
}

function describeCapability(
  adapter: AdapterCapabilityDescriptor["adapter"],
  command: AdapterCapabilityDescriptor["command"],
  role: "opus" | "fable",
  version: string,
  help: string,
): AdapterCapabilityDescriptor {
  const claudeBase = [
    "--print",
    "--output-format",
    "--max-turns",
    "--model",
    "--effort",
  ];
  const required =
    command === "claude"
      ? role === "fable"
        ? [
            ...claudeBase,
            "--bare",
            "--tools",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--mcp-config",
            "--no-session-persistence",
          ]
        : claudeBase
      : command === "codex"
        ? ["exec", "--json", "--sandbox", "--model"]
        : command === "opencode"
          ? ["--format", "--model", "--pure"]
        : [];
  const unsupported = required.filter((flag) => !help.includes(flag));
  const advertisedResume =
    command === "claude"
      ? help.includes("--resume")
      : command === "codex" && /\bresume\b/.test(help);
  const nativeResume =
    advertisedResume &&
    role !== "fable" &&
    process.env.ORCHESTRY_ENABLE_NATIVE_RESUME === "1";
  const secureTransport = command === "codex" || command === "claude" || command === "opencode";
  const compatibleRoles: WorkflowCapabilityRole[] =
    command === "codex"
      ? ["supervisor", "reviewer"]
      : command === "claude" && role === "opus"
        ? ["implementer"]
        : command === "opencode"
          ? ["implementer"]
        : command === "claude"
          ? ["adviser"]
          : [];
  const optionReason = unsupported.length
    ? `Required options are unavailable: ${unsupported.join(", ")}`
    : null;
  const transportReason = secureTransport
    ? null
    : `${command} stdin prompt transport is not proven; argv prompt transport is prohibited`;
  const roleCompatibility = Object.fromEntries(
    (["supervisor", "implementer", "adviser", "reviewer"] as const).map(
      (candidate) => {
        const compatible = compatibleRoles.includes(candidate);
        const reasons = compatible
          ? [optionReason].filter((value): value is string => value !== null)
          : [
              transportReason ??
                `${adapter} is not compatible with the ${candidate} workflow role`,
            ];
        return [
          candidate,
          { compatible: compatible && reasons.length === 0, reasons },
        ];
      },
    ),
  ) as AdapterCapabilityDescriptor["role_compatibility"];
  const detail =
    transportReason ??
    optionReason ??
    `Required ${role} options detected; continuation mode: ${nativeResume ? "native_resume (explicitly enabled)" : advertisedResume ? "passport_handoff (native resume advertised but not empirically enabled)" : "passport_handoff"}.`;
  return {
    adapter,
    command,
    installed: true,
    version,
    transport: secureTransport ? "stdin" : "unsupported",
    structured_output:
      command === "codex"
        ? { supported: help.includes("--json"), format: "jsonl" }
        : command === "opencode"
          ? { supported: help.includes("--format"), format: "jsonl" }
        : command === "claude"
          ? {
              supported: help.includes("--output-format"),
              format: "stream-json",
            }
          : { supported: false, format: null },
    sandbox:
      command === "codex"
        ? { supported: help.includes("--sandbox"), mode: "read-only" }
        : { supported: false, mode: null },
    tools:
      command === "claude" && role === "fable"
        ? { configurable: help.includes("--tools"), mode: "disabled" }
        : command === "claude"
          ? { configurable: false, mode: "enabled" }
          : command === "codex"
            ? { configurable: false, mode: "enabled" }
            : { configurable: false, mode: "unknown" },
    resume: { advertised: advertisedResume, enabled: nativeResume },
    role_compatibility: roleCompatibility,
    models: {
      cli_default: secureTransport && command !== "opencode",
      verified:
        command === "claude" && role === "opus"
          ? [{ id: "opus", source: "trusted_catalog" }]
          : [],
    },
    supported_options: required.filter((flag) => help.includes(flag)),
    unsupported_options: unsupported,
    detail,
    available: true,
    advertised_native_resume: advertisedResume,
    native_resume: nativeResume,
  };
}

function unavailableCapability(
  adapter: AdapterCapabilityDescriptor["adapter"],
  command: AdapterCapabilityDescriptor["command"],
): AdapterCapabilityDescriptor {
  const reason = `${command} CLI unavailable`;
  const role_compatibility = Object.fromEntries(
    (["supervisor", "implementer", "adviser", "reviewer"] as const).map(
      (role) => [role, { compatible: false, reasons: [reason] }],
    ),
  ) as AdapterCapabilityDescriptor["role_compatibility"];
  return {
    adapter,
    command,
    installed: false,
    version: null,
    transport:
      command === "codex" || command === "claude" || command === "opencode" ? "stdin" : "unsupported",
    structured_output: { supported: false, format: null },
    sandbox: { supported: false, mode: null },
    tools: { configurable: false, mode: "unknown" },
    resume: { advertised: false, enabled: false },
    role_compatibility,
    models: {
      cli_default: command === "codex" || command === "claude",
      verified: [],
    },
    supported_options: [],
    unsupported_options: [],
    detail: reason,
    available: false,
    advertised_native_resume: false,
    native_resume: false,
  };
}
function parseObject(line: string): Record<string, unknown> {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return {};
  }
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function usageObject(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, nested] of Object.entries(object(value)))
    if (typeof nested === "number") result[key] = nested;
  return result;
}
function parseJson<T>(text: string, usage?: RoleResult<unknown>["usage"]): T {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const error = new Error("Role returned malformed JSON") as Error & {
      usage?: RoleResult<unknown>["usage"];
    };
    error.usage = usage;
    throw error;
  }
}
function bounded(value: string, max: number): string {
  if (Buffer.byteLength(value) > max)
    throw new Error("Role input exceeded configured maximum");
  return value;
}
function isInvalidSession(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:session|thread).*(?:expired|invalid|not found)|(?:expired|invalid|not found).*(?:session|thread)/i.test(
      error.message,
    )
  );
}
function usageFromError(
  error: unknown,
): RoleResult<unknown>["usage"] | undefined {
  if (!error || typeof error !== "object") return undefined;
  const usage = (error as { usage?: unknown }).usage;
  return usage && typeof usage === "object" && !Array.isArray(usage)
    ? (usage as RoleResult<unknown>["usage"])
    : undefined;
}
function project(passport: WorkflowPassportV2) {
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
    session_modes: passport.session_modes,
  };
}
function withProfile(
  passport: WorkflowPassportV2,
  key: "codex" | "opus",
  binding: RosterAgent,
): WorkflowPassportV2 {
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
          timeout_ms: binding.profile.timeout_ms,
        },
      },
    },
  };
}
