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

export interface RoleUsage {
  input_chars?: number;
  output_chars?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read?: number;
  cache_write?: number;
  duration_ms?: number;
  compactions?: number;
}
export interface RoleAttemptEvent {
  attempt_key: string;
  status: "started" | "succeeded" | "failed";
  usage?: RoleUsage;
  error?: unknown;
}
export interface RoleResult<T> {
  value: T;
  session_id?: string;
  session_mode?: "new" | "native_resume" | "passport_handoff" | "none";
  resumed?: boolean;
  resume_failed?: boolean;
  usage?: RoleUsage;
}
export interface FableCallOptions {
  workspace: string;
  model: string;
  max_turns: 1;
  effort: "low";
  timeout_ms: number;
  max_input_bytes: number;
  max_output_bytes: number;
}

export interface CodexDecisionEvidence {
  evidence: GitEvidence | null;
  checks: CheckResults | null;
  opus: OpusResult | null;
  fable_advice: FableAdviceV1 | null;
}
export interface CodexRolePort {
  decide(
    passport: WorkflowPassportV2,
    stage: CodexDecisionStage,
    evidence: CodexDecisionEvidence,
    threadId: string | null,
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ): Promise<RoleResult<CodexDecisionV2>>;
  available(): Promise<{ available: boolean; detail: string }>;
}
export interface FableRolePort {
  consult(
    jobId: string,
    consultationId: string,
    query: FableQueryV1,
    options: FableCallOptions,
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ): Promise<RoleResult<FableAdviceV1>>;
  available(): Promise<{ available: boolean; detail: string }>;
}
export interface OpusRolePort {
  execute(
    passport: WorkflowPassportV2,
    prompt: string,
    workspace: string,
    sessionId: string | null,
    mode: "new" | "native_resume" | "passport_handoff",
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ): Promise<RoleResult<OpusResult>>;
  available(): Promise<{ available: boolean; detail: string }>;
}

export interface WorkflowRoleResolver {
  availability(
    binding: RosterAgent,
    role: SemanticRole,
  ): Promise<{ available: boolean; detail: string }>;
  decide(
    binding: RosterAgent,
    passport: WorkflowPassportV2,
    stage: CodexDecisionStage,
    evidence: CodexDecisionEvidence,
    threadId: string | null,
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ): Promise<RoleResult<CodexDecisionV2>>;
  execute(
    binding: RosterAgent,
    passport: WorkflowPassportV2,
    prompt: string,
    workspace: string,
    sessionId: string | null,
    mode: "new" | "native_resume" | "passport_handoff",
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ): Promise<RoleResult<OpusResult>>;
  consult(
    binding: RosterAgent,
    jobId: string,
    consultationId: string,
    query: FableQueryV1,
    options: FableCallOptions,
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ): Promise<RoleResult<FableAdviceV1>>;
}

export interface GitEvidence {
  branch: string;
  worktree: string;
  commit: string;
  diff: string;
  diff_hash: string;
  files_changed: string[];
  insertions: number;
  deletions: number;
  risk_signals: string[];
}
export interface WorkflowGitPort {
  validateChecks(commands: string[], root?: string): Promise<string[]>;
  prepare(jobId: string): Promise<{
    branch: string;
    worktree: string;
    target_branch: string;
    base_commit: string;
  }>;
  inspect(branch: string, worktree: string): Promise<GitEvidence>;
  runChecks(
    worktree: string,
    commit: string,
    commands: string[],
  ): Promise<CheckResults>;
  currentCommit(branch: string): Promise<string>;
  isMerged(
    branch: string,
    commit: string,
    targetBranch: string,
    baseCommit: string,
  ): Promise<boolean>;
  merge(
    branch: string,
    expectedCommit: string,
    targetBranch: string,
    baseCommit: string,
  ): Promise<{ success: boolean; detail: string }>;
}
export interface WorkflowRolePorts {
  codex: CodexRolePort;
  fable: FableRolePort;
  opus: OpusRolePort;
  git: WorkflowGitPort;
  safeguards: WorkflowRuntimePorts['safeguards'];
}
export interface WorkflowRuntimePorts {
  roles: WorkflowRoleResolver;
  git: WorkflowGitPort;
  safeguards: {
    assertReady(): Promise<unknown>;
    assertQuiescent(owner: string): Promise<void>;
    runQuiescent<T>(owner: string, action: () => Promise<T>): Promise<T>;
  };
}

export class LegacyWorkflowRoleResolver implements WorkflowRoleResolver {
  constructor(
    private readonly ports: Pick<WorkflowRolePorts, "codex" | "fable" | "opus">,
  ) {}

  async availability(binding: RosterAgent, role: SemanticRole) {
    const supported =
      role === "supervisor" || role === "reviewer"
        ? binding.adapter === "codex"
        : role === "implementer"
          ? binding.adapter === "claude"
          : binding.adapter === "claude" || binding.adapter === "fable";
    if (!supported)
      return {
        available: false,
        detail: `Unsupported ${role} binding: ${binding.adapter}`,
      };
    return role === "supervisor" || role === "reviewer"
      ? this.ports.codex.available()
      : role === "implementer"
        ? this.ports.opus.available()
        : this.ports.fable.available();
  }

  decide(
    _binding: RosterAgent,
    passport: WorkflowPassportV2,
    stage: CodexDecisionStage,
    evidence: CodexDecisionEvidence,
    threadId: string | null,
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ) {
    return this.ports.codex.decide(
      passport,
      stage,
      evidence,
      threadId,
      observer,
    );
  }
  execute(
    _binding: RosterAgent,
    passport: WorkflowPassportV2,
    prompt: string,
    workspace: string,
    sessionId: string | null,
    mode: "new" | "native_resume" | "passport_handoff",
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ) {
    return this.ports.opus.execute(
      passport,
      prompt,
      workspace,
      sessionId,
      mode,
      observer,
    );
  }
  consult(
    _binding: RosterAgent,
    jobId: string,
    consultationId: string,
    query: FableQueryV1,
    options: FableCallOptions,
    observer?: (event: RoleAttemptEvent) => Promise<void>,
  ) {
    return this.ports.fable.consult(
      jobId,
      consultationId,
      query,
      options,
      observer,
    );
  }
}
