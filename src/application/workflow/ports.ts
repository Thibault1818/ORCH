import type { CheckResults, CodexDecisionStage, CodexDecisionV2, FableAdviceV1, FableQueryV1, OpusResult } from '../../domain/workflow/contracts.js';
import type { WorkflowPassportV2 } from '../../domain/workflow/state.js';

export interface RoleUsage { input_chars?: number; output_chars?: number; input_tokens?: number; output_tokens?: number; cache_read?: number; cache_write?: number; duration_ms?: number; compactions?: number; }
export interface RoleResult<T> { value: T; session_id?: string; session_mode?: 'new' | 'native_resume' | 'passport_handoff' | 'none'; resumed?: boolean; resume_failed?: boolean; usage?: RoleUsage; }
export interface FableCallOptions { workspace: string; model: string; max_turns: 1; effort: 'low'; timeout_ms: number; max_input_bytes: number; max_output_bytes: number; }

export interface CodexDecisionEvidence { evidence: GitEvidence | null; checks: CheckResults | null; opus: OpusResult | null; fable_advice: FableAdviceV1 | null; }
export interface CodexRolePort {
  decide(passport: WorkflowPassportV2, stage: CodexDecisionStage, evidence: CodexDecisionEvidence, threadId: string | null): Promise<RoleResult<CodexDecisionV2>>;
  available(): Promise<{ available: boolean; detail: string }>;
}
export interface FableRolePort {
  consult(jobId: string, consultationId: string, query: FableQueryV1, options: FableCallOptions): Promise<RoleResult<FableAdviceV1>>;
  available(): Promise<{ available: boolean; detail: string }>;
}
export interface OpusRolePort {
  execute(passport: WorkflowPassportV2, prompt: string, workspace: string, sessionId: string | null, mode: 'new' | 'native_resume' | 'passport_handoff'): Promise<RoleResult<OpusResult>>;
  available(): Promise<{ available: boolean; detail: string }>;
}

export interface GitEvidence { branch: string; worktree: string; commit: string; diff: string; diff_hash: string; files_changed: string[]; insertions: number; deletions: number; risk_signals: string[]; }
export interface WorkflowGitPort {
  prepare(jobId: string): Promise<{ branch: string; worktree: string; target_branch: string; base_commit: string }>;
  inspect(branch: string, worktree: string): Promise<GitEvidence>;
  runChecks(worktree: string, commit: string, commands: string[]): Promise<CheckResults>;
  currentCommit(branch: string): Promise<string>;
  isMerged(branch: string, commit: string, targetBranch: string, baseCommit: string): Promise<boolean>;
  merge(branch: string, expectedCommit: string, targetBranch: string, baseCommit: string): Promise<{ success: boolean; detail: string }>;
}
export interface WorkflowRolePorts { codex: CodexRolePort; fable: FableRolePort; opus: OpusRolePort; git: WorkflowGitPort; }
