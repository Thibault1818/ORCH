import type { ProducingRole } from './contracts.js';
import type { WorkflowPhase } from './transitions.js';

export type WorkflowMode = 'adaptive' | 'direct';
export type ConsultationOrigin = 'pre_opus' | 'post_opus';
export type ConsultationStatus = 'unused' | 'requested' | 'attempt_started' | 'result_persisted' | 'skipped' | 'fallback_executed';
export interface RoleProfile { model: string; effort: 'low' | 'medium' | 'high'; max_turns: number; timeout_ms: number; permission_mode: 'read_only' | 'worktree'; }
export interface WorkflowConfig { fable_total_cap: 0 | 1; max_input_bytes: number; max_output_bytes: number; passport_max_bytes: number; profiles: { fable: RoleProfile; opus: RoleProfile; codex: RoleProfile }; }
export type WorkflowConfigOverrides = Partial<Omit<WorkflowConfig, 'profiles' | 'fable_total_cap'>> & { fable_total_cap?: 0 | 1; profiles?: Partial<Record<'fable' | 'opus' | 'codex', Partial<RoleProfile>>> };
export interface ArtifactReference { filename: string; hash: string; phase: WorkflowPhase; revision: number; iteration: number; role: ProducingRole; }
export interface WorkflowDecision { invocation_id: string; action: string; summary: string; provenance: 'codex'; timestamp: string; fable_advice_disposition: 'accepted' | 'rejected' | null; fable_error: string | null; fable_iteration_effect: 'avoided' | 'added' | 'unchanged' | null; }

export interface WorkflowJobV2 {
  schema_version: 2; job_id: string; mode: WorkflowMode; phase: WorkflowPhase; resume_phase: WorkflowPhase | null;
  revision: number; artifact_revision: number; latest_artifact_hash: string | null; opus_iteration: number; fix_cycles: number;
  fable_calls: number; consultation_status: ConsultationStatus; consultation_origin: ConsultationOrigin | null;
  branch: string | null; worktree: string | null; target_branch: string | null; base_commit: string | null; current_commit: string | null; reviewed_diff_hash: string | null;
  accepted_brief_hash: string | null; last_action: string | null; blocker: string | null; next_action: string;
  current_operation: { phase: WorkflowPhase; invocation_id: string; started_at: string; retry_count: number } | null; created_at: string; updated_at: string;
}

export interface WorkflowPassportV2 {
  schema_version: 2; passport_revision: number; job_id: string; mode: WorkflowMode; current_revision: number; objective: string; current_phase: WorkflowPhase;
  accepted_brief_hash: string | null; latest_implementation_brief: ArtifactReference | null; hard_constraints: string[]; acceptance_criteria: string[];
  decisions: WorkflowDecision[]; allowed_file_scope: string[]; required_checks: string[]; current_blockers: string[]; next_action: string; artifacts: ArtifactReference[];
  active_worktree: string | null; target_branch: string | null; base_commit: string | null; current_commit: string | null;
  session_references: { codex: string | null; opus: string | null }; session_modes: { codex: SessionMode; opus: SessionMode }; rotation_history: SessionRotation[]; config: WorkflowConfig;
}

export type SessionMode = 'new' | 'native_resume' | 'passport_handoff' | 'none';
export interface SessionRotation { role: 'codex' | 'opus'; previous_id: string | null; next_id: string | null; reason: string; timestamp: string; }
export interface AgentUsage { calls: number; input_chars: number; output_chars: number; input_tokens: number; output_tokens: number; estimated_tokens: number; cache_read: number; cache_write: number; duration_ms: number; failed_calls: number; resumes: number; compactions: number; }
export interface WorkflowSessionsV2 { schema_version: 2; sessions_revision: number; job_id: string; codex_thread_id: string | null; opus_session_id: string | null; opus_brief_hash: string | null; modes: Record<'codex' | 'opus', SessionMode>; rotation_history: SessionRotation[]; recorded_invocations: string[]; usage: Record<'codex' | 'fable' | 'opus', AgentUsage>; updated_at: string; }
export interface WorkflowArtifactMetadataV2 { schema_version: 2; job_id: string; artifact_name: string; filename: string; phase: WorkflowPhase; workflow_revision: number; iteration: number; revision: number; invocation_id: string; producing_role: ProducingRole; parent_artifact_hash: string | null; timestamp: string; artifact_hash: string; }
export interface WorkflowInvocationReceiptV2 { schema_version: 2; job_id: string; invocation_id: string; phase: WorkflowPhase; role: 'codex' | 'fable' | 'opus'; request_hash: string; request: unknown; result_hash: string; workflow_revision: number; timestamp: string; result: unknown; }
export interface WorkflowEffectReceiptV2 { schema_version: 2; job_id: string; invocation_id: string; phase: WorkflowPhase; kind: 'checks' | 'merge'; request_hash: string; request: unknown; result_hash: string | null; workflow_revision: number; status: 'started' | 'completed'; timestamp: string; result: unknown | null; }
export interface WorkflowEventV2 { schema_version: 2; job_id: string; type: string; timestamp: string; data: unknown; }

// Kept as aliases so existing programmatic imports fail by schema validation rather than module resolution.
export type WorkflowJobV1 = WorkflowJobV2;
export type WorkflowPassportV1 = WorkflowPassportV2;
export type WorkflowSessionsV1 = WorkflowSessionsV2;
export type WorkflowArtifactMetadataV1 = WorkflowArtifactMetadataV2;
export type WorkflowInvocationReceiptV1 = WorkflowInvocationReceiptV2;
export type WorkflowEventV1 = WorkflowEventV2;
