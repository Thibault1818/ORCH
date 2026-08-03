import type { ProducingRole } from './contracts.js';
import type { WorkflowPhase } from './transitions.js';

export type PostReviewMode = 'always';
export interface RoleProfile { model: string; effort: 'low' | 'medium' | 'high'; max_turns: number; timeout_ms: number; permission_mode: 'read_only' | 'worktree'; }
export interface WorkflowConfig { fable_pre_opus_cap: number; fable_post_opus_per_iteration_cap: number; fable_total_cap: number; max_input_bytes: number; max_output_bytes: number; passport_max_bytes: number; post_review: PostReviewMode; profiles: { fable: RoleProfile; opus: RoleProfile; codex: RoleProfile }; }
export type WorkflowConfigOverrides = Partial<Omit<WorkflowConfig, 'profiles'>> & { profiles?: Partial<Record<'fable' | 'opus' | 'codex', Partial<RoleProfile>>> };
export interface ArtifactReference { filename: string; hash: string; phase: WorkflowPhase; revision: number; iteration: number; role: ProducingRole; }
export interface WorkflowDecision { invocation_id: string; verdict: string; reason: string; timestamp: string; }

export interface WorkflowJobV1 {
  schema_version: 1; job_id: string; phase: WorkflowPhase; resume_phase: WorkflowPhase | null;
  revision: number; artifact_revision: number; latest_artifact_hash: string | null;
  fable_pre_opus_calls: number; fable_post_opus_calls: number; fable_post_opus_iteration_calls: number; fable_total_calls: number; fix_cycles: number; opus_iteration: number;
  branch: string | null; worktree: string | null; target_branch: string | null; base_commit: string | null; current_commit: string | null;
  approved_plan_hash: string | null; reviewed_diff_hash: string | null; last_verdict: string | null; blocker: string | null;
  next_action: string; current_operation: { phase: WorkflowPhase; invocation_id: string; started_at: string; retry_count: number } | null; created_at: string; updated_at: string;
}

export interface WorkflowPassportV1 {
  schema_version: 1; passport_revision: number; job_id: string; current_revision: number; objective: string; current_phase: WorkflowPhase;
  approved_plan_hash: string | null; latest_accepted_plan: ArtifactReference | null; hard_constraints: string[]; acceptance_criteria: string[]; mandatory_amendments: string[];
  decisions: WorkflowDecision[]; allowed_file_scope: string[]; required_checks: string[];
  current_blockers: string[]; next_action: string; artifacts: ArtifactReference[];
  active_worktree: string | null; target_branch: string | null; base_commit: string | null; current_commit: string | null; session_references: { codex: string | null; fable: string | null; opus: string | null }; session_modes: { codex: SessionMode; fable: SessionMode; opus: SessionMode }; rotation_history: SessionRotation[]; config: WorkflowConfig;
}

export type SessionMode = 'new' | 'native_resume' | 'passport_handoff' | 'none';
export interface SessionRotation { role: 'codex' | 'fable' | 'opus'; previous_id: string | null; next_id: string | null; reason: string; timestamp: string; }
export interface AgentUsage { calls: number; input_chars: number; output_chars: number; input_tokens: number; output_tokens: number; estimated_tokens: number; cache_read: number; cache_write: number; duration_ms: number; failed_calls: number; resumes: number; compactions: number; }
export interface WorkflowSessionsV1 { schema_version: 1; job_id: string; codex_thread_id: string | null; fable_session_id: string | null; opus_session_id: string | null; opus_plan_hash: string | null; modes: Record<'codex' | 'fable' | 'opus', SessionMode>; rotation_history: SessionRotation[]; recorded_invocations: string[]; usage: Record<'codex' | 'fable' | 'opus', AgentUsage>; updated_at: string; }
export interface WorkflowArtifactMetadataV1 { schema_version: 1; job_id: string; artifact_name: string; filename: string; phase: WorkflowPhase; workflow_revision: number; iteration: number; revision: number; invocation_id: string; producing_role: ProducingRole; parent_artifact_hash: string | null; timestamp: string; artifact_hash: string; }
export interface WorkflowInvocationReceiptV1 { schema_version: 1; job_id: string; invocation_id: string; phase: WorkflowPhase; role: 'codex' | 'fable' | 'opus'; timestamp: string; result: unknown; }
export interface WorkflowEventV1 { schema_version: 1; job_id: string; type: string; timestamp: string; data: unknown; }
