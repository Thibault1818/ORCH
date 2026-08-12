import { SpawnOptions, ChildProcess } from 'node:child_process';

/**
 * Typed error hierarchy for the orchestrator.
 *
 * Every error carries an exit code (matching CLI_UI_DESIGN.md §11)
 * and an optional hint for the user.
 *
 * Exit codes:
 *   0 - Success
 *   1 - General error
 *   2 - Invalid arguments
 *   3 - Not initialized (.orchestry/ not found)
 *   4 - Lock conflict (orchestrator already running)
 *   5 - Agent error (adapter test failed)
 */
declare class OrchestryError extends Error {
    readonly exitCode: number;
    readonly hint?: string | undefined;
    constructor(message: string, exitCode: number, hint?: string | undefined);
}
declare class NotInitializedError extends OrchestryError {
    constructor();
}
declare class TaskNotFoundError extends OrchestryError {
    constructor(taskId: string);
}
declare class AgentNotFoundError extends OrchestryError {
    constructor(agentId: string);
}
declare class GoalHasPendingTasksError extends OrchestryError {
    constructor(goalId: string, count: number, summary: string);
}
declare class WorkspaceError extends OrchestryError {
    constructor(message: string, hint?: string);
}
declare enum AdapterErrorKind {
    ADAPTER_NOT_FOUND = "adapter_not_found",
    AUTH_FAILED = "auth_failed",
    TIMEOUT = "timeout",
    RATE_LIMIT = "rate_limit",
    PROCESS_CRASH = "process_crash",
    SPAWN_FAILED = "spawn_failed",
    UNKNOWN = "unknown"
}
type FailurePhase = 'pre_run' | 'lead_plan_validation' | 'worker' | 'goal' | 'review' | 'orchestrator';
interface PersistedFailure {
    message: string;
    phase: FailurePhase;
    at: string;
    context?: string;
    retryable?: boolean;
    runId?: string;
    taskId?: string;
    goalId?: string;
    agentId?: string;
    errorKind?: AdapterErrorKind;
}
interface AdapterErrorHint {
    message: string;
    fix: string;
    doctorHint?: boolean;
}
declare const ERROR_HINTS: Record<AdapterErrorKind, AdapterErrorHint>;
declare function classifyAdapterError(error: string, exitCode?: number): AdapterErrorKind;

/**
 * Task domain model.
 *
 * A Task is the unit of work in the orchestrator.
 * It moves through a state machine: todo → in_progress → review → done.
 */

type TaskStatus = 'todo' | 'in_progress' | 'retrying' | 'review' | 'done' | 'failed' | 'cancelled';
type GoalTaskRole = 'lead_analysis' | 'worker' | 'lead_review';
type WorkspaceMode = 'shared' | 'worktree' | 'isolated';
type ReviewCriterion = 'test_pass' | 'typecheck' | 'lint';
interface ReviewResult {
    criterion: ReviewCriterion;
    passed: boolean;
    output: string;
}
interface TaskProof {
    branch?: string;
    base_commit?: string;
    reviewed_commit?: string;
    reviewed_diff_hash?: string;
    target_branch?: string;
    pr_url?: string;
    files_changed: string[];
    test_results?: string;
    agent_summary?: string;
}
interface Task {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: number;
    assignee?: string;
    labels: string[];
    depends_on: string[];
    created_at: string;
    updated_at: string;
    attempts: number;
    max_attempts: number;
    workspace_mode?: WorkspaceMode;
    workspace?: string;
    proof?: TaskProof;
    review_criteria?: ReviewCriterion[];
    review_results?: ReviewResult[];
    scope?: string[];
    feedback?: string;
    goalId?: string;
    goalTaskRole?: GoalTaskRole;
    goalCycle?: number;
    attachments?: string[];
    last_error?: PersistedFailure;
}
interface CreateTaskInput {
    title: string;
    description?: string;
    priority?: number;
    assignee?: string;
    labels?: string[];
    depends_on?: string[];
    max_attempts?: number;
    workspace_mode?: WorkspaceMode;
    review_criteria?: ReviewCriterion[];
    scope?: string[];
    goalId?: string;
    goalTaskRole?: GoalTaskRole;
    goalCycle?: number;
    systemGenerated?: boolean;
    attachments?: string[];
}

/**
 * Agent domain model.
 *
 * An Agent is a configured AI tool (Claude, Codex, Shell, etc.)
 * that can be assigned to execute Tasks.
 */
type AgentStatus = 'idle' | 'running' | 'error' | 'disabled';
type ApprovalPolicy = 'suggest' | 'auto' | 'manual';
type ReasoningEffort = 'low' | 'medium' | 'high';
interface AgentConfig {
    command?: string;
    model?: string;
    effort?: ReasoningEffort;
    approval_policy?: ApprovalPolicy;
    max_turns?: number;
    timeout_ms?: number;
    stall_timeout_ms?: number;
    env?: Record<string, string>;
    system_prompt?: string;
    workspace_mode?: WorkspaceMode;
    skills?: string[];
}
interface AgentStats {
    tasks_completed: number;
    tasks_failed: number;
    total_runs: number;
    total_runtime_ms: number;
    tokens_used?: number;
}
interface AgentLastError {
    message: string;
    kind: string;
    timestamp: string;
}
interface Agent {
    id: string;
    name: string;
    adapter: string;
    role?: string;
    config: AgentConfig;
    status: AgentStatus;
    current_task?: string;
    autonomous?: boolean;
    stats: AgentStats;
    last_error?: AgentLastError;
}
interface CreateAgentInput {
    name: string;
    adapter: string;
    role?: string;
    command?: string;
    model?: string;
    effort?: ReasoningEffort;
    approval_policy?: ApprovalPolicy;
    max_turns?: number;
    timeout_ms?: number;
    stall_timeout_ms?: number;
    env?: Record<string, string>;
    system_prompt?: string;
    workspace_mode?: WorkspaceMode;
    skills?: string[];
}

/**
 * Run domain model.
 *
 * A Run represents a single execution attempt of a Task by an Agent.
 * Events are stored in separate .jsonl files (append-only), not in memory.
 */

type RunStatus = 'preparing' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
interface Run {
    id: string;
    task_id: string;
    agent_id: string;
    attempt: number;
    status: RunStatus;
    started_at: string;
    finished_at?: string;
    workspace_path: string;
    prompt?: string;
    pid?: number;
    error?: string;
    failure?: PersistedFailure;
    tokens?: TokenUsage;
}
interface TokenUsage {
    input: number;
    output: number;
    reasoning: number;
    total: number;
    /** Cache tokens — informational only, NOT added to total (subset of input). */
    cache_read: number;
    cache_write: number;
}
/** Create TokenUsage with total always computed as input + output + reasoning. */
declare function createTokenUsage(input: number, output: number, opts?: {
    reasoning?: number;
    cache_read?: number;
    cache_write?: number;
}): TokenUsage;
interface RunEvent {
    timestamp: string;
    type: RunEventType;
    data: unknown;
}
type RunEventType = 'agent_output' | 'file_changed' | 'command_run' | 'tool_call' | 'error' | 'done';

declare const WORKFLOW_SCHEMA_VERSION: 2;
type ProducingRole = 'fable' | 'codex' | 'opus' | 'orchestrator' | 'human';
type CodexAction = 'DISPATCH_OPUS' | 'ACCEPT' | 'CORRECT_OPUS' | 'CONSULT_FABLE' | 'PAUSE' | 'STOP';
type FablePurpose = 'COMPARE_BOUNDED_OPTIONS' | 'GENERATE_NONCRITICAL_ALTERNATIVES' | 'CHALLENGE_REVERSIBLE_PLAN';
interface FableFallbackV1 {
    action: 'DISPATCH_OPUS' | 'CORRECT_OPUS' | 'PAUSE';
    instructions: string;
}
interface FableQueryV1 {
    purpose: FablePurpose;
    question: string;
    verification_method: string;
    fallback_if_skipped: FableFallbackV1;
}
interface CodexDecisionV2 {
    schema_version: 2;
    job_id: string;
    action: CodexAction;
    summary: string;
    implementation_brief: string | null;
    required_changes: string[];
    risk_level: 'low' | 'medium' | 'high';
    fable_query: FableQueryV1 | null;
    reviewed_commit: string | null;
    fable_advice_disposition: 'accepted' | 'rejected' | null;
    fable_error: string | null;
    fable_iteration_effect: 'avoided' | 'added' | 'unchanged' | null;
}
type FableFallbackReason = 'direct_mode' | 'workflow_cap_or_duplicate' | 'risk_not_low' | 'input_oversized' | 'fable_unavailable' | 'fable_failed' | 'malformed_request' | 'ambiguous_interruption' | 'resume_persisted_fallback';
interface FableFallbackRecordV1 {
    schema_version: 1;
    reason: FableFallbackReason;
    action: FableFallbackV1['action'];
    instructions: string;
    origin: 'pre_opus' | 'post_opus';
}
interface FableAdviceV1 {
    schema_version: 1;
    consultation_id: string;
    answer: string;
    alternatives: string[];
    uncertainties: string[];
}
interface OpusResult {
    job_id: string;
    status: 'completed' | 'partial' | 'failed';
    files_changed: string[];
    commands_run: string[];
    tests_reported: string[];
    deviations: string[];
    unresolved: string[];
    summary: string;
}
interface CheckResults {
    job_id: string;
    commit: string;
    passed: boolean;
    checks: Array<{
        command: string;
        passed: boolean;
        output: string;
    }>;
}
interface HumanApprovalV1 {
    schema_version: 1;
    job_id: string;
    target_branch: string;
    base_commit: string;
    reviewed_commit: string;
    reviewed_diff_hash: string;
    check_results_hash: string;
    reason: string;
    approved_at: string;
}
type CodexDecisionStage = 'pre_opus' | 'post_opus' | 'after_fable_pre' | 'after_fable_post';
declare function validateCodexDecision(value: unknown, stage: CodexDecisionStage): CodexDecisionV2;
declare function validateFableQuery(value: unknown): FableQueryV1;
declare function validateFableAdvice(value: unknown): FableAdviceV1;
declare function validateFableFallbackRecord(value: unknown): FableFallbackRecordV1;
declare function validateOpusResult(value: unknown): OpusResult;
declare function validateCheckResults(value: unknown): CheckResults;
declare function validateHumanApproval(value: unknown): HumanApprovalV1;

declare const SEMANTIC_ROLES: readonly ["supervisor", "implementer", "adviser", "reviewer"];
type SemanticRole = typeof SEMANTIC_ROLES[number];
interface RolePermissions {
    readonly workspace: 'read_only' | 'worktree';
    readonly tools: 'enabled' | 'none';
    readonly advisory_only: boolean;
}
declare const ROLE_PERMISSIONS: Readonly<Record<SemanticRole, RolePermissions>>;
interface RosterAgent {
    adapter: string;
    profile: RosterProfileSnapshot;
}
interface RosterProfileSnapshot {
    name: string;
    model: string;
    effort: 'low' | 'medium' | 'high';
    max_turns: number;
    timeout_ms: number;
}
interface SameAsSupervisor {
    same_as: 'supervisor';
}
interface WorkflowRosterSnapshot {
    schema_version: 1;
    supervisor: RosterAgent;
    implementer: RosterAgent;
    adviser: RosterAgent | null;
    reviewer: RosterAgent | SameAsSupervisor;
}
interface RosterInput {
    supervisor: RosterAgent;
    implementer: RosterAgent;
    adviser?: RosterAgent | null;
    reviewer?: RosterAgent | SameAsSupervisor;
}
declare function createRosterSnapshot(input: RosterInput, mode?: WorkflowMode): WorkflowRosterSnapshot;
declare function legacyRosterSnapshot(mode: WorkflowMode): WorkflowRosterSnapshot;
declare function validateRosterSnapshot(value: unknown, mode?: WorkflowMode): WorkflowRosterSnapshot;
declare function hashRosterSnapshot(value: WorkflowRosterSnapshot): string;
declare function validateRosterAgent(value: unknown, label?: string): RosterAgent;
declare function hashRosterAgent(value: RosterAgent): string;

type WorkflowPhase = 'codex_pre_opus' | 'fable_consultation' | 'codex_after_fable' | 'opus_execution' | 'codex_post_opus' | 'verification' | 'awaiting_approval' | 'merge_ready' | 'done' | 'blocked' | 'paused' | 'cancelled' | 'failed';
declare const WORKFLOW_PHASE_TRANSITIONS: Readonly<Record<WorkflowPhase, readonly WorkflowPhase[]>>;
declare function canTransitionWorkflow(from: WorkflowPhase, to: WorkflowPhase): boolean;
declare function transitionWorkflow(from: WorkflowPhase, to: WorkflowPhase): WorkflowPhase;
declare function isTerminalWorkflowPhase(phase: WorkflowPhase): boolean;

type WorkflowMode = 'adaptive' | 'direct';
type ConsultationOrigin = 'pre_opus' | 'post_opus';
type ConsultationStatus = 'unused' | 'requested' | 'attempt_started' | 'result_persisted' | 'skipped' | 'fallback_executed';
interface RoleProfile {
    model: string;
    effort: 'low' | 'medium' | 'high';
    max_turns: number;
    timeout_ms: number;
    permission_mode: 'read_only' | 'worktree';
}
interface WorkflowConfig {
    fable_total_cap: 0 | 1;
    max_input_bytes: number;
    max_output_bytes: number;
    passport_max_bytes: number;
    profiles: {
        fable: RoleProfile;
        opus: RoleProfile;
        codex: RoleProfile;
    };
}
type WorkflowConfigOverrides = Partial<Omit<WorkflowConfig, 'profiles' | 'fable_total_cap'>> & {
    fable_total_cap?: 0 | 1;
    profiles?: Partial<Record<'fable' | 'opus' | 'codex', Partial<RoleProfile>>>;
};
interface ArtifactReference {
    filename: string;
    hash: string;
    phase: WorkflowPhase;
    revision: number;
    iteration: number;
    role: ProducingRole;
}
interface WorkflowDecision {
    invocation_id: string;
    action: string;
    summary: string;
    provenance: 'codex';
    timestamp: string;
    fable_advice_disposition: 'accepted' | 'rejected' | null;
    fable_error: string | null;
    fable_iteration_effect: 'avoided' | 'added' | 'unchanged' | null;
}
interface WorkflowJobV2 {
    schema_version: 2;
    job_id: string;
    mode: WorkflowMode;
    phase: WorkflowPhase;
    resume_phase: WorkflowPhase | null;
    revision: number;
    artifact_revision: number;
    latest_artifact_hash: string | null;
    opus_iteration: number;
    fix_cycles: number;
    fable_calls: number;
    consultation_status: ConsultationStatus;
    consultation_origin: ConsultationOrigin | null;
    branch: string | null;
    worktree: string | null;
    target_branch: string | null;
    base_commit: string | null;
    current_commit: string | null;
    reviewed_diff_hash: string | null;
    accepted_brief_hash: string | null;
    last_action: string | null;
    blocker: string | null;
    next_action: string;
    current_operation: {
        phase: WorkflowPhase;
        invocation_id: string;
        started_at: string;
        retry_count: number;
    } | null;
    created_at: string;
    updated_at: string;
}
interface WorkflowPassportV2 {
    schema_version: 2;
    passport_revision: number;
    job_id: string;
    mode: WorkflowMode;
    current_revision: number;
    objective: string;
    current_phase: WorkflowPhase;
    accepted_brief_hash: string | null;
    latest_implementation_brief: ArtifactReference | null;
    hard_constraints: string[];
    acceptance_criteria: string[];
    decisions: WorkflowDecision[];
    allowed_file_scope: string[];
    required_checks: string[];
    current_blockers: string[];
    next_action: string;
    artifacts: ArtifactReference[];
    active_worktree: string | null;
    target_branch: string | null;
    base_commit: string | null;
    current_commit: string | null;
    session_references: {
        codex: string | null;
        opus: string | null;
    };
    session_modes: {
        codex: SessionMode;
        opus: SessionMode;
    };
    rotation_history: SessionRotation[];
    config: WorkflowConfig;
    roster?: WorkflowRosterSnapshot;
    roster_hash?: string;
    active_roster?: WorkflowRosterSnapshot;
    active_roster_hash?: string;
    roster_revision?: number;
    binding_rotation_history?: BindingRotation[];
}
type ValidatedWorkflowPassportV2 = WorkflowPassportV2 & Required<Pick<WorkflowPassportV2, 'roster' | 'roster_hash' | 'active_roster' | 'active_roster_hash' | 'roster_revision' | 'binding_rotation_history'>>;
type SessionMode = 'new' | 'native_resume' | 'passport_handoff' | 'none';
interface SessionRotation {
    role: 'codex' | 'opus';
    previous_id: string | null;
    next_id: string | null;
    reason: string;
    timestamp: string;
}
interface BindingRotation {
    role: SemanticRole;
    previous_binding_hash: string | null;
    new_binding_hash: string | null;
    previous_binding: RosterAgent | null;
    new_binding: RosterAgent | null;
    reason: string;
    timestamp: string;
    revision: number;
}
interface AgentUsage {
    calls: number;
    input_chars: number;
    output_chars: number;
    input_tokens: number;
    output_tokens: number;
    estimated_tokens: number;
    cache_read: number;
    cache_write: number;
    duration_ms: number;
    failed_calls: number;
    resumes: number;
    compactions: number;
}
interface WorkflowSessionsV2 {
    schema_version: 2;
    sessions_revision: number;
    job_id: string;
    codex_thread_id: string | null;
    opus_session_id: string | null;
    opus_brief_hash: string | null;
    modes: Record<'codex' | 'opus', SessionMode>;
    rotation_history: SessionRotation[];
    recorded_invocations: string[];
    usage: Record<'codex' | 'fable' | 'opus', AgentUsage>;
    updated_at: string;
}
interface WorkflowArtifactMetadataV2 {
    schema_version: 2;
    job_id: string;
    artifact_name: string;
    filename: string;
    phase: WorkflowPhase;
    workflow_revision: number;
    iteration: number;
    revision: number;
    invocation_id: string;
    producing_role: ProducingRole;
    parent_artifact_hash: string | null;
    timestamp: string;
    artifact_hash: string;
}
interface WorkflowInvocationReceiptV2 {
    schema_version: 2;
    job_id: string;
    invocation_id: string;
    phase: WorkflowPhase;
    role: 'codex' | 'fable' | 'opus';
    semantic_role?: SemanticRole;
    roster_hash?: string;
    roster_revision?: number;
    binding_hash?: string;
    role_adapter?: string;
    request_hash: string;
    request: unknown;
    result_hash: string;
    workflow_revision: number;
    timestamp: string;
    result: unknown;
}
interface WorkflowLlmAttemptV1 {
    schema_version: 1;
    job_id: string;
    attempt_id: string;
    invocation_id: string;
    phase: WorkflowPhase;
    semantic_role: SemanticRole;
    provider_role: 'codex' | 'fable' | 'opus';
    adapter: string;
    binding_hash: string;
    roster_revision: number;
    status: 'started' | 'succeeded' | 'failed';
    usage_status: 'known' | 'estimated' | 'unknown';
    usage: {
        input_chars?: number;
        output_chars?: number;
        input_tokens?: number;
        output_tokens?: number;
        cache_read?: number;
        cache_write?: number;
        duration_ms: number;
        compactions?: number;
    } | null;
    error_category: string | null;
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
}
interface WorkflowEffectReceiptV2 {
    schema_version: 2;
    job_id: string;
    invocation_id: string;
    phase: WorkflowPhase;
    kind: 'checks' | 'merge';
    request_hash: string;
    request: unknown;
    result_hash: string | null;
    workflow_revision: number;
    status: 'started' | 'completed';
    timestamp: string;
    result: unknown | null;
}
interface WorkflowEventV2 {
    schema_version: 2;
    job_id: string;
    type: string;
    timestamp: string;
    data: unknown;
}
type WorkflowJobV1 = WorkflowJobV2;
type WorkflowPassportV1 = WorkflowPassportV2;
type WorkflowSessionsV1 = WorkflowSessionsV2;
type WorkflowArtifactMetadataV1 = WorkflowArtifactMetadataV2;
type WorkflowInvocationReceiptV1 = WorkflowInvocationReceiptV2;
type WorkflowEventV1 = WorkflowEventV2;

type WorkflowPresetEffort = 'low' | 'medium' | 'high';
interface WorkflowPresetAgent {
    adapter: string;
    model: string;
    effort: WorkflowPresetEffort;
}
interface WorkflowLaunchPresetDefinition {
    supervisor: WorkflowPresetAgent;
    implementer: WorkflowPresetAgent;
    adviser: WorkflowPresetAgent | null;
    reviewer: 'supervisor' | WorkflowPresetAgent;
    mode: WorkflowMode;
    max_adviser_calls: 0 | 1;
}
/** A named collection can be stored in project or global configuration. */
interface WorkflowPresetConfig {
    default_preset?: string;
    presets?: Record<string, WorkflowLaunchPresetDefinition>;
}

/**
 * Configuration domain model.
 *
 * Represents the structure of .orchestry/config.yml
 */

interface ProjectConfig {
    name: string;
    description?: string;
}
interface AgentDefaults {
    adapter: string;
    approval_policy: ApprovalPolicy;
    max_turns: number;
    timeout_ms: number;
    stall_timeout_ms: number;
    workspace_mode: WorkspaceMode;
}
interface TaskDefaults {
    max_attempts: number;
    priority: number;
}
interface SchedulingConfig {
    poll_interval_ms: number;
    max_concurrent_agents: number;
    retry_base_delay_ms: number;
    retry_max_delay_ms: number;
}
interface ExecutionSecurityConfig {
    allow_permission_bypass: boolean;
    allow_shell_adapter: boolean;
    persist_prompts: boolean;
}
interface OrchestratorConfig {
    project: ProjectConfig;
    defaults: {
        agent: AgentDefaults;
        task: TaskDefaults;
    };
    scheduling: SchedulingConfig;
    execution: {
        security: ExecutionSecurityConfig;
    };
    workflow?: WorkflowConfigOverrides;
    workflow_launch?: WorkflowPresetConfig;
    prompt?: {
        template?: string;
        system_template?: string;
        user_template?: string;
    };
}

/**
 * Orchestrator runtime state.
 *
 * Persisted in .orchestry/state.json.
 * Updated on every mutation. Not intended for git.
 */

interface RunningEntry {
    run_id: string;
    agent_id: string;
    task_id: string;
    pid: number;
    started_at: string;
    last_event_at: string;
}
interface RetryEntry {
    task_id: string;
    attempt: number;
    due_at: string;
    error: string;
}
interface OrchestratorState {
    version: 1;
    pid?: number;
    started_at?: string;
    onboardingCompleted?: boolean;
    running: Record<string, RunningEntry>;
    claimed: Set<string>;
    retry_queue: RetryEntry[];
    stats: {
        total_runs: number;
        total_tasks_completed: number;
        total_tasks_failed: number;
        total_tokens: TokenUsage;
        total_runtime_ms: number;
    };
}

/**
 * Goal domain model.
 *
 * A Goal is a persistent objective that drives autonomous agent work.
 * Goals have lower priority than tasks — agents work on goals only
 * when no regular tasks are available.
 *
 * State machine: active → achieved | abandoned | paused
 *                paused → active | achieved | abandoned
 */
declare const GOAL_STATUSES: readonly ["active", "paused", "achieved", "abandoned"];
type GoalStatus = (typeof GOAL_STATUSES)[number];

interface Goal {
    id: string;
    title: string;
    description: string;
    status: GoalStatus;
    assignee?: string;
    orchestration?: GoalOrchestrationState;
    last_error?: PersistedFailure;
    created_at: string;
    updated_at?: string;
}
type GoalOrchestrationPhase = 'needs_analysis' | 'lead_analyzing' | 'workers_running' | 'lead_reviewing' | 'paused' | 'closed';
interface GoalOrchestrationState {
    enabled: boolean;
    phase: GoalOrchestrationPhase;
    cycle: number;
    lead_agent_id?: string;
    last_lead_task_id?: string;
    last_review_task_id?: string;
    last_transition_at?: string;
}
interface CreateGoalInput {
    title: string;
    description?: string;
    assignee?: string;
}

/**
 * Message domain model.
 *
 * A Message is a unit of inter-agent communication.
 * Messages are stored as JSON files and injected into agent prompts at dispatch time.
 */
type MessageChannel = 'direct' | 'broadcast' | 'lead';
type MessageStatus = 'pending' | 'delivered' | 'expired';
interface Message {
    id: string;
    channel: MessageChannel;
    from_agent_id: string;
    to_agent_id: string | null;
    subject: string;
    body: string;
    created_at: string;
    expires_at?: string;
    status: MessageStatus;
    delivered_at?: string;
    team_id?: string;
    reply_to?: string;
}
interface CreateMessageInput {
    channel: MessageChannel;
    from_agent_id: string;
    to_agent_id?: string;
    subject: string;
    body: string;
    ttl_ms?: number;
    team_id?: string;
    reply_to?: string;
}

type OrchestratorEvent = {
    type: 'task:created';
    task: Task;
} | {
    type: 'task:assigned';
    taskId: string;
    agentId: string;
} | {
    type: 'task:status_changed';
    taskId: string;
    from: TaskStatus;
    to: TaskStatus;
} | {
    type: 'task:auto_reviewed';
    taskId: string;
    passed: boolean;
    results: ReviewResult[];
} | {
    type: 'task:error';
    taskId: string;
    error: string;
    phase: FailurePhase;
    runId?: string;
    agentId?: string;
    goalId?: string;
    errorKind?: AdapterErrorKind;
    retryable?: boolean;
} | {
    type: 'agent:started';
    agentId: string;
    taskId: string;
    runId: string;
} | {
    type: 'agent:output';
    runId: string;
    agentId: string;
    data: string;
} | {
    type: 'agent:file_changed';
    runId: string;
    agentId: string;
    path: string;
} | {
    type: 'agent:completed';
    runId: string;
    agentId: string;
    success: boolean;
} | {
    type: 'agent:error';
    runId: string;
    agentId: string;
    error: string;
    errorKind?: AdapterErrorKind;
} | {
    type: 'run:retry';
    runId: string;
    attempt: number;
    delay_ms: number;
} | {
    type: 'orchestrator:tick';
    running: number;
    queued: number;
} | {
    type: 'orchestrator:stall_detected';
    runId: string;
} | {
    type: 'task:scope_overlap';
    taskId: string;
    overlappingTaskId: string;
    patterns: string[];
} | {
    type: 'task:cascade_failed';
    taskId: string;
    failedDependencyId: string;
    reason: string;
} | {
    type: 'workspace:merge_succeeded';
    taskId: string;
    branch: string;
} | {
    type: 'workspace:merge_conflict';
    taskId: string;
    branch: string;
    conflictInfo: string;
} | {
    type: 'task:orphaned';
    taskId: string;
} | {
    type: 'orchestrator:error';
    error: string;
    context: string;
    fatal: boolean;
} | {
    type: 'orchestrator:shutdown';
    reason: string;
} | {
    type: 'message:sent';
    messageId: string;
    fromAgentId: string;
    toAgentId: string | null;
    channel: MessageChannel;
} | {
    type: 'message:delivered';
    messageId: string;
    toAgentId: string;
    taskId: string;
} | {
    type: 'team:created';
    teamId: string;
    name: string;
    leadAgentId: string;
} | {
    type: 'team:member_joined';
    teamId: string;
    agentId: string;
} | {
    type: 'team:member_left';
    teamId: string;
    agentId: string;
} | {
    type: 'team:task_claimed';
    teamId: string;
    taskId: string;
    agentId: string;
} | {
    type: 'team:disbanded';
    teamId: string;
} | {
    type: 'team:task_added';
    teamId: string;
    taskId: string;
} | {
    type: 'agent:autonomous_toggled';
    agentId: string;
    autonomous: boolean;
} | {
    type: 'goal:created';
    goalId: string;
    title: string;
} | {
    type: 'goal:status_changed';
    goalId: string;
    from: GoalStatus;
    to: GoalStatus;
} | {
    type: 'goal:phase_changed';
    goalId: string;
    from: GoalOrchestrationPhase;
    to: GoalOrchestrationPhase;
    cycle: number;
} | {
    type: 'goal:lead_task_created';
    goalId: string;
    taskId: string;
    cycle: number;
    role: 'lead_analysis' | 'lead_review';
} | {
    type: 'goal:error';
    goalId: string;
    error: string;
    phase: FailurePhase;
    taskId?: string;
    runId?: string;
    agentId?: string;
    retryable?: boolean;
} | {
    type: 'goal:updated';
    goalId: string;
} | {
    type: 'goal:deleted';
    goalId: string;
};
type OrchestratorEventType = OrchestratorEvent['type'];
/**
 * Extract event payload by type discriminator.
 */
type EventPayload<T extends OrchestratorEventType> = Extract<OrchestratorEvent, {
    type: T;
}>;

/**
 * Task state machine — pure functions, no side effects.
 *
 * State diagram:
 *   todo → in_progress → review → done
 *                      ↘ retrying → in_progress
 *                      ↘ failed (max attempts)
 *   review → todo (rejected)
 *   * → cancelled
 *   failed → todo | retrying (manual reactivation)
 *   cancelled → todo (manual reactivation)
 *
 * Terminal statuses (done, failed, cancelled) are not auto-dispatched
 * by the orchestrator but may have manual outgoing transitions.
 */

/**
 * Check if a status transition is valid.
 */
declare function canTransition(from: TaskStatus, to: TaskStatus): boolean;
/**
 * Check if a task status is terminal — the orchestrator will not
 * auto-dispatch or retry it. Terminal tasks may still have valid
 * manual transitions (e.g. cancelled → todo, failed → todo).
 */
declare function isTerminal(status: TaskStatus): boolean;
/**
 * Check if a task can be dispatched (ready for execution).
 */
declare function isDispatchable(status: TaskStatus): boolean;
/**
 * Check if a task is blocked by unfinished dependencies.
 * Accepts either a Task[] (O(d×n) lookup) or a Map<string, Task> (O(d×1) lookup).
 *
 * Missing dependencies (deleted from store) are treated as resolved —
 * a deleted task should not permanently block dependents.
 * Dependencies are validated at creation time (task-service), so a missing
 * dep at runtime means it was deleted after the dependent was created.
 */
declare function isBlocked(task: Task, allTasks: Task[] | Map<string, Task>): boolean;
/**
 * Determine the next status after a task failure (run error or shutdown).
 * Returns 'retrying' if attempts remain, 'failed' otherwise.
 */
declare function resolveFailureStatus(task: Task): TaskStatus;

/**
 * Model tier system — single source of truth for adapter → tier → model resolution.
 *
 * Agent Shop templates reference semantic tiers (capable / balanced / fast)
 * instead of hardcoded model strings. At instantiation time, the actual model
 * is resolved based on the user's chosen adapter.
 */
/** The supported adapter kinds. */
type AdapterKind = 'claude' | 'opencode' | 'codex' | 'cursor' | 'pi' | 'grok' | 'antigravity' | 'shell';
/**
 * Semantic capability tiers — adapter-agnostic.
 *   capable  — most powerful / highest quality (opus, gpt-5.4)
 *   balanced — good quality + speed (sonnet, gpt-5.3-codex)
 *   fast     — cheapest / fastest (haiku, gpt-5-mini)
 */
type ModelTier = 'capable' | 'balanced' | 'fast';
/**
 * Tier → model mapping per adapter.
 *
 * Conventions:
 *   - shell:    '' for all tiers (model irrelevant)
 *   - opencode: '' for balanced (delegate to opencode's own config)
 *   - cursor:   'auto' for all tiers (Cursor handles selection)
 *   - antigravity: '' for balanced (delegate to Antigravity's configured default)
 */
declare const MODEL_TIER_MAP: Record<AdapterKind, Record<ModelTier, string>>;
/**
 * Resolve a concrete model string from adapter + tier.
 * Returns '' for unknown adapters (let the adapter decide).
 */
declare function resolveModel(adapter: string, tier: ModelTier): string;
/** Returns the default (balanced) model for the adapter. */
declare function defaultModelForAdapter(adapter: string): string;
/** Type guard: is a string a valid AdapterKind? */
declare function isAdapterKind(value: string): value is AdapterKind;
/** Type guard: is a string a valid ModelTier? */
declare function isModelTier(value: string): value is ModelTier;
/** All supported adapter names in display order. */
declare const SUPPORTED_ADAPTERS: readonly AdapterKind[];

/**
 * ORCH Agent Shop — pre-built agent templates.
 *
 * Each template defines a ready-to-use agent with a detailed role prompt,
 * recommended model, skills, and approval policy. Users can browse the shop
 * via `orch shop` and add agents to their project with one command.
 *
 * Role prompts define the agent's identity and high-level approach.
 * Detailed methodology comes from library skills injected at runtime.
 */

interface AgentShopTemplate {
    key: string;
    name: string;
    description: string;
    tier: ModelTier;
    approval_policy: ApprovalPolicy;
    skills: string[];
    role: string;
}
declare const AGENT_SHOP_TEMPLATES: AgentShopTemplate[];
/** Look up a shop template by its key. */
declare function getShopTemplateByKey(key: string): AgentShopTemplate | undefined;

/**
 * Typed event bus.
 *
 * The single communication channel between all layers.
 * Synchronous emit — handlers run inline.
 * TUI, logger, run store, state all subscribe independently.
 */

type Handler<T> = (event: T) => void;
declare class EventBus {
    private handlers;
    private wildcardHandlers;
    private maxListeners;
    private warnedTypes;
    /**
     * Set the maximum number of listeners per event type before a warning is emitted.
     * Helps detect memory leaks from repeated subscriptions in watch mode.
     */
    setMaxListeners(n: number): void;
    getMaxListeners(): number;
    /**
     * Get the number of listeners for a specific event type.
     */
    listenerCount(type: OrchestratorEventType): number;
    /**
     * Subscribe to events of a specific type.
     * Returns an unsubscribe function.
     */
    on<T extends OrchestratorEventType>(type: T, handler: Handler<EventPayload<T>>): () => void;
    /**
     * Subscribe to an event type, auto-unsubscribe after first call.
     */
    once<T extends OrchestratorEventType>(type: T, handler: Handler<EventPayload<T>>): () => void;
    /**
     * Unsubscribe a handler from an event type.
     */
    off<T extends OrchestratorEventType>(type: T, handler: Handler<EventPayload<T>>): void;
    /**
     * Emit an event synchronously to all subscribed handlers.
     */
    emit(event: OrchestratorEvent): void;
    private dispatchToSet;
    /**
     * Subscribe to ALL events regardless of type.
     */
    onAny(handler: Handler<OrchestratorEvent>): () => void;
    /**
     * Remove all handlers.
     */
    clear(): void;
}

/**
 * Agent factory — converts shop templates into CreateAgentInput.
 *
 * Resolves adapter-specific model from the template's semantic tier
 * and filters MCP skills (colon-format) for non-Claude adapters.
 */

/** MCP skills use colon-separated names (e.g. `package:skill-name`). */
declare function isMcpSkill(skill: string): boolean;
/**
 * Convert a shop template into CreateAgentInput for the given adapter.
 *
 * - Resolves the concrete model string from adapter + tier
 * - Filters out MCP skills for non-Claude adapters (they only work with Claude CLI)
 */
declare function templateToAgentInput(template: AgentShopTemplate, adapter: string): CreateAgentInput;

/**
 * Team domain model.
 *
 * A Team groups agents with a lead for coordinated work.
 * Teams share a task pool and enable broadcast messaging.
 */
type TeamStatus = 'active' | 'paused' | 'disbanded';
interface TeamMember {
    agent_id: string;
    role: 'lead' | 'member';
    joined_at: string;
}
interface Team {
    id: string;
    name: string;
    description?: string;
    status: TeamStatus;
    members: TeamMember[];
    task_pool: string[];
    lead_agent_id: string;
    created_at: string;
    updated_at: string;
    config: TeamConfig;
}
interface TeamConfig {
    max_concurrent_tasks?: number;
    auto_claim: boolean;
    message_ttl_ms?: number;
}
interface CreateTeamInput {
    name: string;
    description?: string;
    lead_agent_id: string;
    member_agent_ids?: string[];
    config?: Partial<TeamConfig>;
}

/**
 * Storage layer interfaces.
 *
 * All persistence goes through these contracts.
 * Implementations use atomic file writes (temp → rename).
 * Services depend on interfaces, not concrete stores.
 */

interface ITaskStore {
    list(filter?: {
        status?: TaskStatus;
        goalId?: string;
    }): Promise<Task[]>;
    get(id: string): Promise<Task | null>;
    save(task: Task): Promise<void>;
    delete(id: string): Promise<void>;
}
interface IAgentStore {
    list(): Promise<Agent[]>;
    get(id: string): Promise<Agent | null>;
    getByName(name: string): Promise<Agent | null>;
    save(agent: Agent): Promise<void>;
    delete(id: string): Promise<void>;
}
interface IRunStore {
    save(run: Run): Promise<void>;
    get(id: string): Promise<Run | null>;
    listAll(): Promise<Run[]>;
    listForTask(taskId: string): Promise<Run[]>;
    listForAgent(agentId: string): Promise<Run[]>;
    appendEvent(runId: string, event: RunEvent): Promise<void>;
    readEvents(runId: string): Promise<RunEvent[]>;
    readEventsTail(runId: string, count: number): Promise<RunEvent[]>;
    streamEvents(runId: string, signal?: AbortSignal): AsyncGenerator<RunEvent>;
    closeRunEvents(runId: string): void;
}
interface IStateStore {
    read(): Promise<OrchestratorState>;
    write(state: OrchestratorState): Promise<void>;
}
interface IConfigStore {
    read(): Promise<OrchestratorConfig>;
    write(config: OrchestratorConfig): Promise<void>;
    get(keyPath: string): Promise<unknown>;
    set(keyPath: string, value: unknown): Promise<void>;
}
interface ContextEntry {
    key: string;
    value: string;
    created_at: string;
    updated_at: string;
    ttl_ms?: number;
    expires_at?: string;
}
interface IContextStore {
    get(key: string): Promise<ContextEntry | null>;
    set(key: string, value: string, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<void>;
    list(): Promise<ContextEntry[]>;
    getAll(): Promise<Record<string, string>>;
}
interface IMessageStore {
    save(message: Message): Promise<void>;
    get(id: string): Promise<Message | null>;
    list(): Promise<Message[]>;
    listPending(agentId: string): Promise<Message[]>;
    markDelivered(id: string): Promise<void>;
    delete(id: string): Promise<void>;
    purgeExpired(): Promise<number>;
}
interface IGoalStore {
    list(filter?: {
        status?: GoalStatus;
    }): Promise<Goal[]>;
    get(id: string): Promise<Goal | null>;
    save(goal: Goal): Promise<void>;
    delete(id: string): Promise<void>;
}
interface ITeamStore {
    save(team: Team): Promise<void>;
    get(id: string): Promise<Team | null>;
    getByName(name: string): Promise<Team | null>;
    list(): Promise<Team[]>;
    delete(id: string): Promise<void>;
}

declare class Paths {
    private readonly projectRoot;
    private readonly stateRoot;
    private readonly externalWorkspaceRoot;
    constructor(projectRoot: string, stateRoot?: string, externalWorkspaceRoot?: string);
    /** Root .orchestry/ directory */
    get root(): string;
    get projectConfigRoot(): string;
    get workspacesRoot(): string;
    get configPath(): string;
    get statePath(): string;
    get lockPath(): string;
    get processRegistryPath(): string;
    get tasksDir(): string;
    get agentsDir(): string;
    get runsDir(): string;
    get templatesDir(): string;
    get logsDir(): string;
    get contextDir(): string;
    contextPath(key: string): string;
    get messagesDir(): string;
    messagePath(id: string): string;
    get goalsDir(): string;
    goalPath(id: string): string;
    get teamsDir(): string;
    get attachmentsDir(): string;
    taskAttachmentsDir(taskId: string): string;
    teamPath(id: string): string;
    get gitignorePath(): string;
    get workspaceExcludePath(): string;
    taskPath(id: string): string;
    agentPath(id: string): string;
    runPath(id: string): string;
    runEventsPath(id: string): string;
    defaultTemplatePath(): string;
    isInitialized(): Promise<boolean>;
    requireInit(): Promise<void>;
    validateStateRoot(): Promise<void>;
}

/**
 * Task service — business logic for task lifecycle.
 *
 * Validates state transitions, emits events, manages CRUD.
 * CLI commands call this service, not storage directly.
 */

declare class TaskService {
    private readonly taskStore;
    private readonly eventBus;
    private readonly config;
    private readonly paths?;
    private readonly agentStore?;
    constructor(taskStore: ITaskStore, eventBus: EventBus, config: OrchestratorConfig, paths?: Paths | undefined, agentStore?: IAgentStore | undefined);
    create(input: CreateTaskInput): Promise<Task>;
    list(filter?: {
        status?: TaskStatus;
        goalId?: string;
    }): Promise<Task[]>;
    get(id: string): Promise<Task>;
    updateStatus(id: string, newStatus: TaskStatus): Promise<Task>;
    assign(taskId: string, agentId: string): Promise<Task>;
    cancel(id: string): Promise<Task>;
    retry(id: string): Promise<Task>;
    reject(id: string, feedback?: string): Promise<Task>;
    update(id: string, fields: {
        title?: string;
        description?: string;
        priority?: number;
        labels?: string[];
        attachments?: string[];
    }): Promise<Task>;
    delete(id: string): Promise<void>;
    getAttachmentPath(taskId: string, filename: string): string;
    private copyAttachments;
    incrementAttempts(id: string): Promise<Task>;
    /**
     * Resolve an assignee value to an agent ID.
     * Accepts: agent ID (agt_xxx), agent name, or undefined.
     * Returns the agent ID if found, or undefined if input is undefined.
     * Throws InvalidArgumentsError if non-empty value matches no agent.
     */
    private resolveAssignee;
}

/**
 * Agent service — business logic for agent lifecycle.
 *
 * Manages agent CRUD, availability, and task assignment matching.
 */

declare class AgentService {
    private readonly agentStore;
    private readonly stateStore;
    private readonly eventBus;
    private readonly config;
    constructor(agentStore: IAgentStore, stateStore: IStateStore, eventBus: EventBus, config: OrchestratorConfig);
    create(input: CreateAgentInput): Promise<Agent>;
    list(): Promise<Agent[]>;
    get(id: string): Promise<Agent>;
    remove(id: string): Promise<void>;
    update(id: string, fields: {
        name?: string;
        adapter?: string;
        role?: string;
        model?: string;
        effort?: Agent['config']['effort'] | '';
        approval_policy?: Agent['config']['approval_policy'];
    }): Promise<Agent>;
    disable(id: string): Promise<Agent>;
    enable(id: string): Promise<Agent>;
    setAutonomous(id: string, enabled: boolean): Promise<Agent>;
    setStatus(id: string, status: AgentStatus): Promise<Agent>;
    updateStats(id: string, update: Partial<Agent['stats']>): Promise<Agent>;
    /**
     * Find the best available agent for a task using scoring.
     *
     * Scoring:
     * - Explicit assignee match = 100
     * - Skill match with task labels = 50 per match
     * - Role match with task labels = 30
     * - Idle status bonus = 20
     * - Success rate bonus = 0–10 (scaled by completed / total)
     */
    findBestAgent(task: Task): Promise<Agent | null>;
}

/**
 * Run service — manages run lifecycle and event streaming.
 */

declare class RunService {
    private readonly runStore;
    private readonly eventBus;
    constructor(runStore: IRunStore, eventBus: EventBus);
    create(params: {
        taskId: string;
        agentId: string;
        attempt: number;
        prompt: string;
        workspacePath: string;
        persistPrompt?: boolean;
    }): Promise<Run>;
    get(id: string): Promise<Run | null>;
    start(id: string, pid: number): Promise<Run>;
    finish(id: string, status: RunStatus, tokens?: TokenUsage, error?: string, failure?: PersistedFailure): Promise<Run>;
    appendEvent(runId: string, event: RunEvent): Promise<void>;
    listAll(): Promise<Run[]>;
    listForTask(taskId: string): Promise<Run[]>;
    listForAgent(agentId: string): Promise<Run[]>;
    readEvents(runId: string): Promise<RunEvent[]>;
    readEventsTail(runId: string, count: number): Promise<RunEvent[]>;
    /**
     * Get error and last N lines of output from the most recent failed run for a task.
     * Used to provide retry context so agents can learn from previous failures.
     */
    getLastFailedRunContext(taskId: string): Promise<{
        error: string;
        output: string;
    } | null>;
}

/**
 * MessageService — business logic for inter-agent messaging.
 *
 * Handles message creation, routing (direct/broadcast/lead),
 * delivery into agent prompts, and cleanup of expired messages.
 */

declare class MessageService {
    private readonly messageStore;
    private readonly agentStore;
    private readonly teamStore;
    private readonly eventBus;
    constructor(messageStore: IMessageStore, agentStore: IAgentStore, teamStore: ITeamStore, eventBus: EventBus);
    /**
     * Send a message. For broadcast, creates one message per recipient agent.
     * For 'lead' channel, resolves team lead and sends direct.
     */
    send(input: CreateMessageInput): Promise<Message[]>;
    /**
     * Drain mailbox: fetch pending messages for an agent and mark them delivered.
     * Called by the orchestrator during dispatchTask.
     */
    drainMailbox(agentId: string, taskId: string): Promise<Message[]>;
    listAll(): Promise<Message[]>;
    listPendingForAgent(agentId: string): Promise<Message[]>;
    listForAgent(agentId: string): Promise<Message[]>;
    purgeExpired(): Promise<number>;
    private emitSent;
}

/**
 * Process management utilities.
 *
 * Handles spawning subprocesses, PID checks, graceful kill.
 */

interface ManagedSpawnOptions extends SpawnOptions {
    owner?: string;
    ownerTag?: string;
}
interface SpawnResult {
    process: ChildProcess;
    pid: number;
    owner?: string;
    ownerTag?: string;
}
interface IProcessManager {
    isAlive(pid: number): boolean;
    kill(pid: number, signal?: NodeJS.Signals): void;
    killWithGrace(pid: number, graceMs?: number): Promise<void>;
    spawn(command: string, args: string[], options?: ManagedSpawnOptions): SpawnResult;
    active?(owner: string): number[];
    awaitQuiescent?(owner: string, timeoutMs?: number): Promise<void>;
}

type CommandTermination = 'exited' | 'spawn_error' | 'timed_out' | 'stdout_limit' | 'stderr_limit' | 'integrity_error';
interface ExecutableDescriptor {
    path: string;
    realpath: string;
    sha256: string;
}
interface CommandRequest {
    executable: string | ExecutableDescriptor;
    executableDescriptor?: ExecutableDescriptor;
    args?: readonly string[];
    cwd?: string;
    stdin?: string | Uint8Array;
    stdio?: 'inherit';
    env?: Readonly<NodeJS.ProcessEnv>;
    timeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
    killGraceMs?: number;
    owner?: unknown;
    ownerTag?: unknown;
    sandbox?: unknown;
    macosSandbox?: unknown;
    allowedExecutables?: readonly ExecutableDescriptor[];
}
interface CommandResult {
    executable: string;
    executableDescriptor: ExecutableDescriptor;
    args: string[];
    cwd: string | null;
    pid: number | null;
    ok: boolean;
    termination: CommandTermination;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdoutBuffer: Buffer;
    stdout: string;
    stderr: string;
    stdoutBytes: number;
    stderrBytes: number;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    durationMs: number;
    spawnError: {
        message: string;
        code: string | null;
    } | null;
    integrityError: string | null;
    sandbox: {
        executableDescriptor: ExecutableDescriptor;
        profile: string;
        proxyAddress: {
            host: string;
            port: number;
        };
    } | null;
}
interface StreamingCommandRequest {
    executable: string | ExecutableDescriptor;
    executableDescriptor?: ExecutableDescriptor;
    args?: readonly string[];
    cwd?: string;
    stdin?: string | Uint8Array;
    keepStdinOpen?: boolean;
    env?: Readonly<NodeJS.ProcessEnv>;
    timeoutMs?: number;
    killGraceMs?: number;
    owner?: unknown;
    ownerTag?: unknown;
    sandbox?: unknown;
    macosSandbox?: unknown;
    allowedExecutables?: readonly ExecutableDescriptor[];
    signal?: AbortSignal;
}
interface StreamingCommandCompletion {
    ok: boolean;
    termination: CommandTermination;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    spawnError: {
        message: string;
        code: string | null;
    } | null;
    integrityError: string | null;
}
interface StreamingCommandHandle extends SpawnResult {
    executableDescriptor: ExecutableDescriptor;
    completion: Promise<StreamingCommandCompletion>;
}
interface ICommandRunner {
    run(request: CommandRequest): Promise<CommandResult>;
    start(request: StreamingCommandRequest): StreamingCommandHandle;
    resolveExecutable?(command: string, pathValue?: string): Promise<ExecutableDescriptor>;
}

interface AdapterTestResult {
    ok: boolean;
    version?: string;
    error?: string;
    errorKind?: AdapterErrorKind;
    details?: Record<string, unknown>;
}
interface ExecuteParams {
    prompt: string;
    systemPrompt?: string;
    workspace: string;
    env?: Record<string, string>;
    config: AgentConfig;
    security?: {
        allowPermissionBypass?: boolean;
        allowShellAdapter?: boolean;
    };
    execution: {
        owner: string;
        sandbox: unknown;
        allowedExecutables: ExecutableDescriptor[];
    };
    persistPrompts?: boolean;
    signal?: AbortSignal;
}
/**
 * Canonical `data` shape per AgentEvent type. Each adapter should emit `data`
 * that matches its event's row below so that downstream consumers (TUI logs,
 * `orch logs` CLI, serve daemon) can render events without knowing adapter
 * internals.
 *
 *   | type        | data shape                                        |
 *   |-------------|---------------------------------------------------|
 *   | output      | { text: string, raw?: unknown }                   |
 *   | tool_call   | { name: string, input?: unknown, raw?: unknown }  |
 *   | command     | { command: string, result?: unknown, raw?: unknown } |
 *   | file_change | { paths: string[], raw?: unknown }                |
 *   | error       | { message: string, raw?: unknown }                |
 *   | done        | { result?: string, raw?: unknown }                |
 *
 * - `raw` is an optional escape hatch for the full provider payload; logs
 *   renderers must not include it in the default summary.
 * - Adapters should emit ONE `output` per logical assistant message (per
 *   text-block or per turn), not per-character delta. Use adapter-local state
 *   to aggregate streaming deltas before emitting.
 * - Intermediate progress events (tool-in-flight, "thinking" pings) should be
 *   dropped at the adapter boundary — they belong in adapter-specific UIs,
 *   not in the orchestrator event stream.
 *
 * Existing adapters predate this contract and emit a variety of shapes
 * (claude/cursor: full `parsed.message`; codex: `item`). The TUI renderer
 * (`formatAgentOutput` in src/tui/App.tsx) is defensive and accepts both
 * canonical and legacy shapes during the migration window.
 */
interface AgentEvent {
    type: 'output' | 'file_change' | 'command' | 'tool_call' | 'error' | 'done';
    timestamp: string;
    data: unknown;
    tokens?: {
        input: number;
        output: number;
        reasoning?: number;
        total: number;
        cache_read?: number;
        cache_write?: number;
    };
    errorKind?: AdapterErrorKind;
}
interface ExecuteHandle {
    pid: number;
    events: AsyncGenerator<AgentEvent>;
}
interface IAgentAdapter {
    readonly kind: string;
    test(): Promise<AdapterTestResult>;
    execute(params: ExecuteParams): ExecuteHandle;
    stop(pid: number): Promise<void>;
}

/**
 * Adapter registry.
 *
 * Maps adapter kind strings to adapter instances.
 * Pre-populated at startup in the container.
 */

declare class AdapterRegistry {
    private readonly adapters;
    register(adapter: IAgentAdapter): void;
    get(kind: string): IAgentAdapter | undefined;
    require(kind: string): IAgentAdapter;
    list(): IAgentAdapter[];
    listKinds(): string[];
    has(kind: string): boolean;
}

type MergeResult = {
    success: true;
} | {
    success: false;
    conflictInfo: string;
};

/**
 * Workspace manager interface.
 */

interface PrepareResult {
    path: string;
    branch?: string;
    baseCommit?: string;
    targetBranch?: string;
}
interface WorkspaceEvidence {
    baseCommit: string;
    commit: string;
    diffHash: string;
    changedFiles: string[];
    targetBranch: string;
}
interface IWorkspaceManager {
    prepare(task: Task, agent: Agent, config: OrchestratorConfig): Promise<PrepareResult>;
    inspect(branch: string): Promise<WorkspaceEvidence>;
    mergeBack(branch: string, expected: WorkspaceEvidence): Promise<MergeResult>;
    cleanup(taskId: string, branch?: string): Promise<void>;
    validate(workspacePath: string, projectRoot: string): void;
    /** Get files changed on a worktree branch relative to its merge-base. */
    getChangedFiles(branch: string): Promise<string[]>;
}

interface ITemplateEngine {
    render(template: string, context: PromptContext): Promise<string>;
}
interface AgentInfo {
    id: string;
    name: string;
    role?: string;
    adapter: string;
}
interface RetryContext {
    previous_error: string;
    previous_output: string;
}
interface GoalContext {
    id: string;
    title: string;
    description: string;
    status: GoalStatus;
    task_names: string[];
    progress?: string;
}
interface PromptContext {
    project: {
        name: string;
        description?: string;
    };
    task: {
        id: string;
        title: string;
        description: string;
        priority: number;
        labels: string[];
        scope?: string[];
        is_autonomous: boolean;
        goal_id?: string;
        goal_task_role?: GoalTaskRole;
        goal_cycle?: number;
    };
    agent: {
        id: string;
        name: string;
        role?: string;
    };
    agents: AgentInfo[];
    attempt: number | null;
    workspace_path: string;
    retry?: RetryContext;
    feedback?: string;
    shared_context?: Record<string, string>;
    messages?: Array<{
        id: string;
        from: string;
        subject: string;
        body: string;
        sent_at: string;
        reply_to?: string;
    }>;
    goal?: GoalContext;
}

/**
 * Skill Library loader.
 *
 * Resolves agent skill names to Markdown content from the bundled
 * `skills/library/` directory. Skills containing ':' are Claude Code
 * MCP skills — handled natively by Claude CLI, skipped here.
 *
 * Content is cached in-process for the lifetime of the SkillLoader instance.
 */
interface ISkillLoader {
    /**
     * Load and format library skill content for the given skill names.
     * MCP skills (containing ':') are silently skipped.
     * Returns formatted Markdown block or empty string if no library skills resolved.
     */
    loadSkills(skillNames: string[]): Promise<string>;
    /** List all available library skill names. */
    listAvailable(): Promise<string[]>;
}
declare class SkillLoader implements ISkillLoader {
    private readonly cache;
    private readonly libraryDirPromise;
    private availableCache;
    constructor(libraryDir?: string);
    loadSkills(skillNames: string[]): Promise<string>;
    listAvailable(): Promise<string[]>;
    private loadOne;
}

interface RoleUsage {
    input_chars?: number;
    output_chars?: number;
    input_tokens?: number;
    output_tokens?: number;
    cache_read?: number;
    cache_write?: number;
    duration_ms?: number;
    compactions?: number;
}
interface RoleAttemptEvent {
    attempt_key: string;
    status: "started" | "succeeded" | "failed";
    usage?: RoleUsage;
    error?: unknown;
}
interface RoleResult<T> {
    value: T;
    session_id?: string;
    session_mode?: "new" | "native_resume" | "passport_handoff" | "none";
    resumed?: boolean;
    resume_failed?: boolean;
    usage?: RoleUsage;
}
interface FableCallOptions {
    workspace: string;
    model: string;
    max_turns: 1;
    effort: "low";
    timeout_ms: number;
    max_input_bytes: number;
    max_output_bytes: number;
}
interface CodexDecisionEvidence {
    evidence: GitEvidence | null;
    checks: CheckResults | null;
    opus: OpusResult | null;
    fable_advice: FableAdviceV1 | null;
}
interface CodexRolePort {
    decide(passport: WorkflowPassportV2, stage: CodexDecisionStage, evidence: CodexDecisionEvidence, threadId: string | null, observer?: (event: RoleAttemptEvent) => Promise<void>): Promise<RoleResult<CodexDecisionV2>>;
    available(): Promise<{
        available: boolean;
        detail: string;
    }>;
}
interface FableRolePort {
    consult(jobId: string, consultationId: string, query: FableQueryV1, options: FableCallOptions, observer?: (event: RoleAttemptEvent) => Promise<void>): Promise<RoleResult<FableAdviceV1>>;
    available(): Promise<{
        available: boolean;
        detail: string;
    }>;
}
interface OpusRolePort {
    execute(passport: WorkflowPassportV2, prompt: string, workspace: string, sessionId: string | null, mode: "new" | "native_resume" | "passport_handoff", observer?: (event: RoleAttemptEvent) => Promise<void>): Promise<RoleResult<OpusResult>>;
    available(): Promise<{
        available: boolean;
        detail: string;
    }>;
}
interface WorkflowRoleResolver {
    availability(binding: RosterAgent, role: SemanticRole): Promise<{
        available: boolean;
        detail: string;
    }>;
    decide(binding: RosterAgent, passport: WorkflowPassportV2, stage: CodexDecisionStage, evidence: CodexDecisionEvidence, threadId: string | null, observer?: (event: RoleAttemptEvent) => Promise<void>): Promise<RoleResult<CodexDecisionV2>>;
    execute(binding: RosterAgent, passport: WorkflowPassportV2, prompt: string, workspace: string, sessionId: string | null, mode: "new" | "native_resume" | "passport_handoff", observer?: (event: RoleAttemptEvent) => Promise<void>): Promise<RoleResult<OpusResult>>;
    consult(binding: RosterAgent, jobId: string, consultationId: string, query: FableQueryV1, options: FableCallOptions, observer?: (event: RoleAttemptEvent) => Promise<void>): Promise<RoleResult<FableAdviceV1>>;
}
interface GitEvidence {
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
interface WorkflowGitPort {
    validateChecks(commands: string[], root?: string): Promise<string[]>;
    prepare(jobId: string): Promise<{
        branch: string;
        worktree: string;
        target_branch: string;
        base_commit: string;
    }>;
    inspect(branch: string, worktree: string): Promise<GitEvidence>;
    runChecks(worktree: string, commit: string, commands: string[]): Promise<CheckResults>;
    currentCommit(branch: string): Promise<string>;
    isMerged(branch: string, commit: string, targetBranch: string, baseCommit: string): Promise<boolean>;
    merge(branch: string, expectedCommit: string, targetBranch: string, baseCommit: string): Promise<{
        success: boolean;
        detail: string;
    }>;
}
interface WorkflowRolePorts {
    codex: CodexRolePort;
    fable: FableRolePort;
    opus: OpusRolePort;
    git: WorkflowGitPort;
    safeguards: WorkflowRuntimePorts['safeguards'];
}
interface WorkflowRuntimePorts {
    roles: WorkflowRoleResolver;
    git: WorkflowGitPort;
    safeguards: {
        assertReady(): Promise<unknown>;
        assertQuiescent(owner: string): Promise<void>;
    };
}
declare class LegacyWorkflowRoleResolver implements WorkflowRoleResolver {
    private readonly ports;
    constructor(ports: Pick<WorkflowRolePorts, "codex" | "fable" | "opus">);
    availability(binding: RosterAgent, role: SemanticRole): Promise<{
        available: boolean;
        detail: string;
    }>;
    decide(_binding: RosterAgent, passport: WorkflowPassportV2, stage: CodexDecisionStage, evidence: CodexDecisionEvidence, threadId: string | null, observer?: (event: RoleAttemptEvent) => Promise<void>): Promise<RoleResult<CodexDecisionV2>>;
    execute(_binding: RosterAgent, passport: WorkflowPassportV2, prompt: string, workspace: string, sessionId: string | null, mode: "new" | "native_resume" | "passport_handoff", observer?: (event: RoleAttemptEvent) => Promise<void>): Promise<RoleResult<OpusResult>>;
    consult(_binding: RosterAgent, jobId: string, consultationId: string, query: FableQueryV1, options: FableCallOptions, observer?: (event: RoleAttemptEvent) => Promise<void>): Promise<RoleResult<FableAdviceV1>>;
}

interface WorkflowExecutionSafeguards {
    assertReady(): Promise<unknown>;
    assertQuiescent(owner: string): Promise<void>;
    executableAllowlist(extra?: readonly string[]): Promise<ExecutableDescriptor[]>;
    proxyEndpoint(): Promise<{
        host: string;
        port: number;
    }>;
}

interface OrchestratorDeps {
    taskStore: ITaskStore;
    agentStore: IAgentStore;
    runStore: IRunStore;
    stateStore: IStateStore;
    adapterRegistry: AdapterRegistry;
    workspaceManager: IWorkspaceManager;
    templateEngine: ITemplateEngine;
    processManager: IProcessManager;
    commandRunner: ICommandRunner;
    reviewExecutables: {
        npm: ExecutableDescriptor;
        npx: ExecutableDescriptor;
        node: ExecutableDescriptor;
    };
    executionSafeguards: WorkflowExecutionSafeguards & {
        assertReady(): Promise<unknown>;
        assertQuiescent(owner: string): Promise<void>;
    };
    eventBus: EventBus;
    taskService: TaskService;
    agentService: AgentService;
    runService: RunService;
    contextStore?: IContextStore;
    messageService?: MessageService;
    goalStore?: IGoalStore;
    skillLoader?: ISkillLoader;
    config: OrchestratorConfig;
    projectRoot: string;
    lockPath: string;
}
declare class Orchestrator {
    private readonly deps;
    private intervalId;
    private shuttingDown;
    private state;
    private abortControllers;
    private readonly cachedTaskStore;
    private readonly cachedAgentStore;
    private readonly cachedGoalStore;
    private saveStateTimer;
    private saveStateDirty;
    private lockAcquired;
    private consecutiveTickFailures;
    private readonly maxConsecutiveTickFailures;
    private readonly maxRetryQueueSize;
    private signalHandlers;
    private immediateDispatchTimer;
    private taskCreatedUnsub;
    private tickInProgress;
    private stoppedResolvers;
    /**
     * Track taskIds with an active collectEvents() background promise.
     * Reconcile skips PID-liveness and stall checks for these tasks because
     * the process may have exited cleanly but handleRunSuccess hasn't acquired
     * the mutex yet — false-positive "crash" / "stall" detection.
     */
    private readonly activeCollectors;
    /** When true, `tick()` skips `seedAutonomousTasks()`. Set via `startWatch()` options. */
    private skipAutonomousSeeding;
    /** Task IDs started via runTask; these must not trigger reactive dispatch of other tasks. */
    private readonly singleTaskRunIds;
    /** Cooldown: track last auto-seed time per agent to prevent re-seed spam. */
    private readonly lastAutoSeedAt;
    /** Minimum interval between auto-seed tasks for the same agent (30 seconds). */
    private static readonly AUTO_SEED_COOLDOWN_MS;
    /** Promise-chain mutex to serialize critical state mutations. */
    private stateMutex;
    constructor(deps: OrchestratorDeps);
    /**
     * Check if this instance owns the lock (can mutate state).
     */
    get isOwner(): boolean;
    /**
     * Serialize access to state mutations via a Promise-chain mutex.
     * Prevents concurrent tick/stop/reconcile from reading stale state.
     */
    private withStateLock;
    /**
     * Run a single task by ID.
     * If watch mode is active (lock already held), dispatches inline via stateMutex.
     * Otherwise acquires a temporary lock for the duration of the run.
     */
    runTask(taskId: string): Promise<void>;
    /**
     * Run all dispatchable tasks.
     * If watch mode is active (lock already held), dispatches inline via stateMutex.
     * Otherwise acquires a temporary lock for the duration of the run.
     */
    runAll(): Promise<void>;
    /**
     * Invalidate caches → loadState → run dispatch fn → saveState.
     * Shared by runTask, runAll, and immediateDispatch.
     */
    private freshDispatch;
    /**
     * Acquire lock, run fn, then release lock.
     * Used by single-shot commands (runTask, runAll) that don't go through startWatch.
     */
    private withTemporaryLock;
    /**
     * Start watch mode — continuous tick loop.
     * Acquires a PID lock to prevent multiple orchestrators.
     */
    startWatch(opts?: {
        skipAutonomousSeeding?: boolean;
    }): Promise<void>;
    /**
     * Returns a promise that resolves when stop() completes.
     * Use in long-running modes (serve, run --watch) to keep the process alive.
     */
    waitForStop(): Promise<void>;
    /**
     * Register SIGINT/SIGTERM handlers for graceful shutdown.
     */
    private registerSignalHandlers;
    /**
     * Remove signal handlers to avoid listener leaks.
     */
    private removeSignalHandlers;
    /**
     * Stop the watch loop and clean up.
     */
    stop(): Promise<void>;
    /**
     * Cancel a running task: kill agent process, clean state, mark cancelled.
     * Acquires lock if not already owned (standalone CLI invocation).
     */
    cancelTask(taskId: string): Promise<void>;
    /**
     * Force-stop a specific agent: kill process, clean state, release agent.
     * Acquires lock if not already owned (standalone CLI invocation).
     */
    forceStopAgent(agentId: string): Promise<void>;
    /**
     * Single tick: Reconcile → Dispatch → Collect
     * Serialized via mutex to prevent concurrent ticks from racing on state.
     */
    private tick;
    /**
     * Schedule an immediate dispatch with 500ms debounce.
     * Called on task:created to avoid waiting for the next 30s tick.
     * Retries up to 10 times (5s) if a tick is in progress.
     */
    private scheduleImmediateDispatch;
    /**
     * Mini-tick: invalidate caches → loadState → dispatchAll → saveState.
     * Skips reconcile/collect — only dispatches new tasks immediately.
     */
    private immediateDispatch;
    /**
     * Reconcile: check PID liveness, detect stalls, process retry queue.
     */
    private reconcile;
    /** Create lead/review tasks for orchestrated goals, then legacy role-based autonomous work. */
    private seedAutonomousTasks;
    private seedGoalOrchestrationTasks;
    /**
     * Dispatch all dispatchable tasks up to max_concurrent_agents.
     */
    private dispatchAll;
    /**
     * Dispatch exactly one requested task.
     *
     * A single-shot CLI command (`orch run <task-id>`) should not opportunistically
     * consume other ready tasks while the requested run is being collected.
     * Temporarily claiming other dispatchable tasks keeps the shared dispatch path
     * focused without changing watch/run-all semantics.
     */
    private dispatchOnlyTask;
    /** Dedup + bounded push onto the retry queue. */
    private enqueueRetry;
    private ensureGoalOrchestration;
    private getGoalLeadAgentId;
    private hasOpenGoalTask;
    private isGoalWorkerTask;
    private hasNonTerminalWorkerTasks;
    private hasDispatchableWorkerTasks;
    private saveGoalPhase;
    private createGoalLeadTask;
    private buildLeadAnalysisDescription;
    private buildLeadReviewDescription;
    private isAllowedByGoalPhase;
    private isTaskAllowedByCurrentGoalPhase;
    private makeFailure;
    private recordTaskFailure;
    private recordGoalFailure;
    private handlePreRunFailure;
    /**
     * When a task permanently fails, cascade-fail all tasks that depend on it
     * (directly or transitively). Prevents dependent tasks from hanging as TODO forever.
     */
    private cascadeFailDependents;
    /**
     * Dispatch a single task: claim → assign → execute.
     */
    private dispatchTask;
    /**
     * Collect events from an adapter's async generator.
     */
    private collectEvents;
    private handleRunSuccess;
    private _handleRunSuccess;
    private handleRunFailure;
    private _handleRunFailure;
    /**
     * Run automatic review criteria on a task in 'review' status.
     * If all criteria pass, transition review → done.
     * If any fail, stay in review with results attached.
     */
    private runAutoReview;
    approveTask(taskId: string): Promise<void>;
    /**
     * Force a task to 'review' status with a summary prefix.
     * Used when merge-back fails (conflict or infrastructure error).
     */
    private forceTaskToReview;
    private unclaim;
    /**
     * Throw if this instance doesn't own the lock (read-only session).
     */
    private requireOwnership;
    private loadState;
    /**
     * On startup, clean up stale running entries left by a crashed/restarted process.
     *
     * Instead of marking orphaned tasks as 'failed' (which triggers retry → agents
     * redo already-committed work), we cancel them. Users can manually reactivate
     * specific tasks if needed.
     */
    private cleanupStaleRunningEntries;
    /**
     * Find runs stuck in 'preparing' status (orphaned by a crash before adapter.execute)
     * and mark them as cancelled. Called once at startup.
     */
    private cleanupOrphanedPreparingRuns;
    /** Cancel a task through the validated state machine. */
    private forceTaskCancelled;
    private saveState;
    /**
     * Debounced saveState — batches rapid writes within 500ms window.
     * Used for non-critical updates like last_event_at in collectEvents.
     */
    private saveStateLazy;
    /**
     * Flush any pending debounced saveState immediately.
     * Call before critical transitions to ensure state is persisted.
     */
    private flushStateLazy;
}

declare const ARTIFACT_FILES: {
    readonly codex_decision: "codex-decision-r%REV%-i%ITER%-a%SEQ%.json";
    readonly opus_instruction: "opus-instruction-r%REV%-i%ITER%-a%SEQ%.md";
    readonly fable_request: "fable-request-r%REV%-i%ITER%-a%SEQ%.json";
    readonly fable_advice: "fable-advice-r%REV%-i%ITER%-a%SEQ%.json";
    readonly routing_decision: "routing-decision-r%REV%-i%ITER%-a%SEQ%.json";
    readonly opus_report: "opus-report-r%REV%-i%ITER%-a%SEQ%.json";
    readonly opus_diff: "opus-r%REV%-i%ITER%-a%SEQ%.diff";
    readonly test_results: "test-results-r%REV%-i%ITER%-a%SEQ%.json";
    readonly human_approval: "human-approval-r%REV%-i%ITER%-a%SEQ%.json";
};
type ArtifactName = keyof typeof ARTIFACT_FILES;
interface StoredArtifact<T = unknown> {
    metadata: WorkflowArtifactMetadataV1;
    payload: T;
}
interface ArtifactWrite<T> {
    job_id: string;
    name: ArtifactName;
    phase: WorkflowPhase;
    revision: number;
    invocation_id: string;
    producing_role: ProducingRole;
    parent_artifact_hash: string | null;
    payload: unknown;
    validate: (value: unknown) => T;
    timestamp?: string;
}
declare class WorkflowArtifactStore {
    private readonly root;
    private readonly migrations;
    constructor(projectRoot: string, options?: {
        rootIsStateRoot?: boolean;
    });
    get rootPath(): string;
    createJob(job: WorkflowJobV1, passport: WorkflowPassportV1, sessions: WorkflowSessionsV1): Promise<void>;
    writeArtifact<T>(input: ArtifactWrite<T>): Promise<StoredArtifact<T>>;
    writeTextArtifact(input: Omit<ArtifactWrite<string>, "validate">): Promise<StoredArtifact<string>>;
    readArtifact<T>(jobId: string, name: ArtifactName, workflowRevision?: number): Promise<StoredArtifact<T> | null>;
    readTextArtifact(jobId: string, name: ArtifactName, workflowRevision?: number): Promise<StoredArtifact<string> | null>;
    transition(jobId: string, next: WorkflowPhase, patch?: Partial<WorkflowJobV1>): Promise<WorkflowJobV1>;
    commitTransition(jobId: string, next: WorkflowPhase, patch: Partial<WorkflowJobV1>, passportPatch: Partial<WorkflowPassportV1>): Promise<WorkflowJobV1>;
    patchJob(jobId: string, patch: Partial<WorkflowJobV1>): Promise<WorkflowJobV1>;
    reserveOperation(jobId: string, phase: WorkflowPhase, operation: NonNullable<WorkflowJobV1["current_operation"]>): Promise<boolean>;
    readJob(jobId: string): Promise<WorkflowJobV1 | null>;
    readPassport(jobId: string): Promise<WorkflowPassportV1 | null>;
    writePassport(value: WorkflowPassportV1): Promise<void>;
    readSessions(jobId: string): Promise<WorkflowSessionsV1 | null>;
    writeSessions(value: WorkflowSessionsV1): Promise<void>;
    commitSessionsAndPassport(sessionsValue: WorkflowSessionsV1, passportValue: WorkflowPassportV1): Promise<void>;
    commitBindingRotation(sessionsValue: WorkflowSessionsV1, passportValue: WorkflowPassportV1): Promise<void>;
    appendEvent(event: WorkflowEventV1): Promise<void>;
    readEvents(jobId: string): Promise<WorkflowEventV1[]>;
    writeInvocationReceipt(value: WorkflowInvocationReceiptV1): Promise<void>;
    readInvocationReceipt(jobId: string, invocationId: string): Promise<WorkflowInvocationReceiptV1 | null>;
    readInvocationReceipts(jobId: string): Promise<WorkflowInvocationReceiptV1[]>;
    writeLlmAttempt(value: WorkflowLlmAttemptV1): Promise<void>;
    readLlmAttempts(jobId: string): Promise<WorkflowLlmAttemptV1[]>;
    readEffectReceipt(jobId: string, invocationId: string, kind: WorkflowEffectReceiptV2["kind"]): Promise<WorkflowEffectReceiptV2 | null>;
    writeEffectReceipt(value: WorkflowEffectReceiptV2): Promise<void>;
    listJobs(): Promise<WorkflowJobV1[]>;
    artifactPath(jobId: string, name: ArtifactName, revision: number): string;
    private requiredJob;
    private commitSessionsPassport;
    private file;
    private latestArtifact;
    private artifactForInvocation;
    private write;
    private ensureMigration;
    private migrateOrRecover;
    private applyMigration;
    private recoverTransition;
    private applyTransition;
    private recoverPassport;
    private applyPassport;
    private recoverSessions;
    private applySessions;
    private assertRecoverableBindingRotation;
    private normalizePendingPassport;
    private secureDir;
    private lock;
}
declare function hashCanonical(value: unknown): string;

declare const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig;
interface StartWorkflowInput {
    objective: string;
    mode?: WorkflowMode;
    allowed_file_scope?: string[];
    required_checks?: string[];
    config?: WorkflowConfigOverrides;
    roster?: WorkflowRosterSnapshot;
    job_id?: string;
    allow_unverified_model?: boolean;
}
declare class WorkflowEngine {
    private readonly store;
    private readonly roles;
    private readonly git;
    private readonly safeguards;
    constructor(store: WorkflowArtifactStore, ports: WorkflowRuntimePorts | WorkflowRolePorts);
    start(input: StartWorkflowInput): Promise<string>;
    run(jobId: string): Promise<WorkflowJobV2>;
    advance(jobId: string): Promise<WorkflowJobV2>;
    pause(jobId: string): Promise<WorkflowJobV2>;
    resume(jobId: string, options?: {
        retry_invocation?: boolean;
        reason?: string;
    }): Promise<WorkflowJobV2>;
    cancel(jobId: string): Promise<WorkflowJobV2>;
    approve(jobId: string, reason: string): Promise<WorkflowJobV2>;
    private step;
    private codexDecision;
    private routeConsultation;
    private fallbackMalformedConsultation;
    private fableConsultation;
    private executeConsultationFallback;
    private dispatchOpus;
    private opusExecution;
    private verification;
    private merge;
    private reviewEvidence;
    private consultationDenial;
    private artifact;
    private payload;
    private optionalPayload;
    private textPayload;
    private transition;
    private block;
    private addArtifact;
    private recordDecision;
    private updatePassport;
    rotateSession(jobId: string, role: "codex" | "opus", reason: string): Promise<void>;
    rotateBinding(jobId: string, role: SemanticRole, binding: RosterAgent, reason: string, allowUnverifiedModel?: boolean): Promise<void>;
    private recordRole;
    private syncPassportSessions;
    private fableOptions;
    private fableCall;
    private invoke;
    private runChecksOnce;
    private ensureTrustedChecks;
    private mergeOnce;
    private effect;
    private recordFailedRoleCall;
    private ensureInterruptedAttempt;
    private invocation;
    private assertAllowedScope;
    private assertJob;
    private context;
    private requiredJob;
    private requiredPassport;
    private requiredSessions;
    private event;
    private assertRuntimeRoster;
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
interface CheckDiscoveryResult {
    package_manager: PackageManager | null;
    checks: string[];
}
/** Inspect local manifests only. Discovery never starts a process. */
declare function discoverDeterministicChecks(projectRoot: string): Promise<CheckDiscoveryResult>;
/** Validate user-supplied checks without executing or probing any binary. */
declare function validateExplicitChecks(projectRoot: string, checks: readonly string[]): Promise<string[]>;
/** Reject shell syntax and commands outside the bounded deterministic grammar. */
declare function validateDeterministicCheckCommands(checks: readonly string[]): string[];

declare const GOVERNANCE_SCHEMA_VERSION: 3;
declare const GOVERNANCE_KINDS: readonly ["binding_snapshot", "decomposition_plan", "check_binding", "candidate_evidence", "review_vote", "quorum_policy", "quorum_result", "integration_receipt", "human_approval"];
type GovernanceRecordKindV3 = typeof GOVERNANCE_KINDS[number];
type GovernanceActorRoleV3 = 'planner' | 'candidate' | 'reviewer' | 'checker' | 'integrator';
interface Base {
    schema_version: 3;
    kind: GovernanceRecordKindV3;
    governance_id: string;
    record_id: string;
}
interface GovernanceRefV3<K extends GovernanceRecordKindV3 = GovernanceRecordKindV3> {
    kind: K;
    record_id: string;
    record_hash: string;
}
interface GovernanceActorBindingV3 {
    binding_id: string;
    role: GovernanceActorRoleV3;
    principal_id: string;
    adapter: string;
    model: string;
}
interface GovernanceCheckProvenanceV3 {
    command_source: 'trusted';
    execution_environment: 'sandboxed';
}
interface BindingSnapshotV3 extends Base {
    kind: 'binding_snapshot';
    bindings: GovernanceActorBindingV3[];
    created_at: string;
}
interface DecompositionUnitV3 {
    unit_id: string;
    objective: string;
    depends_on: string[];
    owned_path_prefixes: string[];
    acceptance_criteria: string[];
    required_check_ids: string[];
}
interface DecompositionPlanV3 extends Base {
    kind: 'decomposition_plan';
    binding_snapshot: GovernanceRefV3<'binding_snapshot'>;
    objective: string;
    base_commit: string;
    target_branch: string;
    units: DecompositionUnitV3[];
    integration_check_ids: string[];
    created_by_binding_id: string;
    created_at: string;
}
interface CheckBindingV3 extends Base {
    kind: 'check_binding';
    binding_snapshot: GovernanceRefV3<'binding_snapshot'>;
    subject: {
        kind: 'candidate' | 'integration';
        id: string;
        commit: string;
    };
    check_id: string;
    command: string;
    status: 'passed' | 'failed';
    output_hash: string;
    executed_by_binding_id: string;
    provenance: GovernanceCheckProvenanceV3;
    started_at: string;
    completed_at: string;
}
interface CandidateEvidenceV3 extends Base {
    kind: 'candidate_evidence';
    plan: GovernanceRefV3<'decomposition_plan'>;
    binding_snapshot: GovernanceRefV3<'binding_snapshot'>;
    unit_id: string;
    candidate_id: string;
    produced_by_binding_id: string;
    base_commit: string;
    commit: string;
    diff_hash: string;
    changed_paths: string[];
    check_bindings: GovernanceRefV3<'check_binding'>[];
    summary: string;
    created_at: string;
}
type ReviewSubjectRefV3 = GovernanceRefV3<'candidate_evidence'> | GovernanceRefV3<'integration_receipt'>;
interface ReviewVoteV3 extends Base {
    kind: 'review_vote';
    binding_snapshot: GovernanceRefV3<'binding_snapshot'>;
    subject: ReviewSubjectRefV3;
    reviewer_binding_id: string;
    decision: 'approve' | 'reject';
    reason: string;
    cast_at: string;
}
interface QuorumPolicyV3 extends Base {
    kind: 'quorum_policy';
    binding_snapshot: GovernanceRefV3<'binding_snapshot'>;
    applies_to: 'candidate_evidence' | 'integration_receipt';
    eligible_reviewer_binding_ids: string[];
    minimum_approvals: number;
    maximum_rejections: number;
    require_distinct_principals: boolean;
    human_approval_required: boolean;
    created_by_binding_id: string;
    created_at: string;
}
interface HumanApprovalV3 extends Base {
    kind: 'human_approval';
    subject: ReviewSubjectRefV3;
    approved_by: string;
    reason: string;
    approved_at: string;
}
interface QuorumResultV3 extends Base {
    kind: 'quorum_result';
    policy: GovernanceRefV3<'quorum_policy'>;
    subject: ReviewSubjectRefV3;
    votes: GovernanceRefV3<'review_vote'>[];
    human_approval: GovernanceRefV3<'human_approval'> | null;
    approvals: number;
    rejections: number;
    satisfied: boolean;
    evaluated_at: string;
}
interface IntegrationReceiptV3 extends Base {
    kind: 'integration_receipt';
    plan: GovernanceRefV3<'decomposition_plan'>;
    binding_snapshot: GovernanceRefV3<'binding_snapshot'>;
    integrated_by_binding_id: string;
    target_branch: string;
    base_commit: string;
    candidates: Array<{
        evidence: GovernanceRefV3<'candidate_evidence'>;
        quorum_result: GovernanceRefV3<'quorum_result'>;
    }>;
    integrated_commit: string;
    diff_hash: string;
    check_bindings: GovernanceRefV3<'check_binding'>[];
    integrated_at: string;
}
type GovernanceRecordV3 = BindingSnapshotV3 | DecompositionPlanV3 | CheckBindingV3 | CandidateEvidenceV3 | ReviewVoteV3 | QuorumPolicyV3 | QuorumResultV3 | IntegrationReceiptV3 | HumanApprovalV3;
interface StoredGovernanceRecordV3<T extends GovernanceRecordV3 = GovernanceRecordV3> {
    storage_version: 1;
    record_hash: string;
    record_hmac: string;
    record: T;
}
declare function validateGovernanceRecordV3(value: unknown): GovernanceRecordV3;
declare function validateBindingSnapshotV3(value: unknown): BindingSnapshotV3;
declare function validateDecompositionPlanV3(value: unknown): DecompositionPlanV3;
declare function validateCheckBindingV3(value: unknown): CheckBindingV3;
declare function validateCandidateEvidenceV3(value: unknown): CandidateEvidenceV3;
declare function validateReviewVoteV3(value: unknown): ReviewVoteV3;
declare function validateQuorumPolicyV3(value: unknown): QuorumPolicyV3;
declare function validateHumanApprovalV3(value: unknown): HumanApprovalV3;
declare function validateQuorumResultV3(value: unknown): QuorumResultV3;
declare function validateIntegrationReceiptV3(value: unknown): IntegrationReceiptV3;
declare function validateGovernanceBranchV3(v: unknown): string;

declare class GovernanceStoreV3 {
    private readonly controllerKeyPath;
    private readonly root;
    private readonly projectRoot;
    constructor(projectRoot: string, controllerKeyPath: string);
    put<T extends GovernanceRecordV3>(input: T): Promise<StoredGovernanceRecordV3<T>>;
    read(governanceId: string, kind: GovernanceRecordKindV3, recordId: string): Promise<StoredGovernanceRecordV3 | null>;
    list(governanceId: string, kind: GovernanceRecordKindV3): Promise<StoredGovernanceRecordV3[]>;
    private validateReferences;
    private caseRoot;
    private file;
    private sign;
    private key;
    private lock;
}
declare function hashGovernanceRecordV3(value: GovernanceRecordV3): string;

interface RecomputedGitEvidenceV3 {
    base_commit: string;
    commit: string;
    diff_hash: string;
    changed_paths: string[];
}
declare class GitEvidenceVerifierV3 {
    private readonly projectRoot;
    private readonly git;
    constructor(projectRoot: string, runner: ICommandRunner);
    recompute(baseCommit: string, commit: string): Promise<RecomputedGitEvidenceV3>;
    assertAncestor(ancestor: string, descendant: string): Promise<void>;
    assertPathComposition(candidate: string, integration: string, paths: readonly string[]): Promise<void>;
}
interface ProjectOperationLeaseV3 {
    token: string;
    assertOwned(): Promise<void>;
    release(): Promise<void>;
}
interface ProjectOperationLockV3 {
    acquire(owner: string): Promise<ProjectOperationLeaseV3>;
}

declare class GovernanceServiceV3 {
    private readonly store;
    private readonly git;
    constructor(store: GovernanceStoreV3, git: GitEvidenceVerifierV3);
    savePlan(plan: DecompositionPlanV3): Promise<StoredGovernanceRecordV3<DecompositionPlanV3>>;
    saveCandidate(candidate: CandidateEvidenceV3): Promise<StoredGovernanceRecordV3<CandidateEvidenceV3>>;
    saveReviewVote(vote: ReviewVoteV3): Promise<StoredGovernanceRecordV3<ReviewVoteV3>>;
    evaluateQuorum(input: {
        governance_id: string;
        record_id: string;
        policy: GovernanceRefV3<'quorum_policy'>;
        subject: ReviewSubjectRefV3;
        votes: GovernanceRefV3<'review_vote'>[];
        human_approval?: GovernanceRefV3<'human_approval'> | null;
        evaluated_at: string;
    }): Promise<StoredGovernanceRecordV3<QuorumResultV3>>;
    saveIntegration(receipt: IntegrationReceiptV3): Promise<StoredGovernanceRecordV3<IntegrationReceiptV3>>;
    private required;
}
declare function assertNoParallelScopeOverlap(plan: DecompositionPlanV3): void;

declare class GovernedMergeV3 {
    private readonly projectRoot;
    private readonly store;
    private readonly evidence;
    private readonly quiescence;
    private readonly operationLock;
    private readonly gitRunner;
    constructor(projectRoot: string, store: GovernanceStoreV3, runner: ICommandRunner, evidence: GitEvidenceVerifierV3, quiescence: {
        assertQuiescent(owner: string): Promise<void>;
    }, operationLock: ProjectOperationLockV3);
    approve(input: {
        governance_id: string;
        record_id: string;
        integration_record_id: string;
        integration_record_hash: string;
        approved_by: string;
        reason: string;
        approved_at: string;
    }): Promise<StoredGovernanceRecordV3<HumanApprovalV3>>;
    merge(input: {
        governance_id: string;
        integration_record_id: string;
        approval_record_id: string;
    }): Promise<{
        merged: true;
        commit: string;
    }>;
    private git;
    private revalidateQuorum;
}

/**
 * Clipboard service for detecting and extracting images from the system clipboard.
 *
 * Platform support:
 * - macOS: osascript (clipboard info / clipboard as PNGf)
 * - Linux: xclip -selection clipboard
 * - Windows: PowerShell Get-Clipboard
 */
type ClipboardContentType = 'image' | 'text' | 'empty';
interface ClipboardImage {
    data: Buffer;
    ext: string;
}
/**
 * Checks whether the required clipboard tool is available on this platform.
 *
 * - macOS: pbpaste (always present)
 * - Linux: xclip
 * - Windows: PowerShell (always present)
 */
declare function isClipboardToolAvailable(): boolean;
/**
 * Detects the type of content currently in the system clipboard.
 *
 * Returns 'image' if the clipboard contains an image (PNG or TIFF),
 * 'text' if it contains text, or 'empty' if the clipboard is empty.
 */
declare function detectClipboardType(): Promise<ClipboardContentType>;
/**
 * Extracts an image from the system clipboard.
 *
 * Returns the image data as a Buffer with its file extension,
 * or null if the clipboard does not contain an image.
 */
declare function getClipboardImage(): Promise<ClipboardImage | null>;

/**
 * CLI context — resolved project root and global flags.
 *
 * Validated at entry point before any command runs.
 */
interface CliContext {
    projectRoot: string;
    stateRoot?: string;
    workspaceRoot?: string;
    json: boolean;
    quiet: boolean;
    noColor: boolean;
    ascii: boolean;
}

interface EndpointProxyTarget {
    host: string;
    port: number;
}
interface EndpointProxyAddress {
    host: string;
    port: number;
}

interface SafeguardCheck {
    name: string;
    passed: boolean;
    detail: string;
}
interface SafeguardReport {
    schema_version: 1;
    project_root: string;
    state_root: string;
    workspace_root: string;
    platform: string;
    checked_at: string;
    policy_hash: string;
    executables: ExecutableDescriptor[];
    endpoints: EndpointProxyTarget[];
    checks: SafeguardCheck[];
    ready: boolean;
}
declare class WorkflowSafeguards {
    private readonly projectRoot;
    private readonly stateRoot;
    private readonly workspaceRoot;
    private readonly runner;
    private readonly processes;
    private readonly proxyCache;
    constructor(projectRoot: string, stateRoot: string, workspaceRoot: string, runner: ICommandRunner, processes: IProcessManager);
    get attestationPath(): string;
    endpoints(): Promise<EndpointProxyTarget[]>;
    proxyEndpoint(): Promise<EndpointProxyAddress>;
    private proxyForEndpoints;
    executableAllowlist(extra?: readonly string[]): Promise<ExecutableDescriptor[]>;
    runDoctor(): Promise<SafeguardReport>;
    assertReady(): Promise<SafeguardReport>;
    assertQuiescent(owner: string): Promise<void>;
    private adversarialSandboxProbe;
    private discoverExecutables;
    private assertExecutablesAttested;
    private readVerifiedAttestation;
    private writeAttestation;
    private key;
}

/**
 * Global configuration — persists across projects.
 *
 * Stored at ~/.orchestry/global.yml
 */
/** Activity feed filter preset name */
type ActivityFilterPreset = 'all' | 'text' | 'tools' | 'errors' | 'events';

interface NotificationPreferences {
    toast: boolean;
    bell: boolean;
}
interface TuiPreferences {
    activity_filter: ActivityFilterPreset;
    notifications: NotificationPreferences;
}
interface GlobalConfig {
    tui: TuiPreferences;
    workflow_launch?: WorkflowPresetConfig;
}

/**
 * Global config store — reads/writes ~/.orchestry/global.yml
 *
 * Persists across projects. Creates directory if needed.
 */

declare class GlobalConfigStore {
    read(): Promise<GlobalConfig>;
    write(config: GlobalConfig): Promise<void>;
    set<K extends keyof GlobalConfig['tui']>(key: K, value: GlobalConfig['tui'][K]): Promise<void>;
}

/**
 * Goal service — business logic for goal lifecycle.
 *
 * Goals are persistent objectives that drive autonomous agent work.
 * State machine: active → achieved | abandoned | paused
 *                paused → active | achieved | abandoned
 *
 * Side effect: assigning an agent to a goal auto-enables autonomous mode;
 * removing the last active goal from an agent auto-disables it.
 */

declare class GoalService {
    private readonly goalStore;
    private readonly eventBus;
    private readonly agentService?;
    private readonly taskService?;
    private readonly contextStore?;
    constructor(goalStore: IGoalStore, eventBus: EventBus, agentService?: AgentService | undefined, taskService?: TaskService | undefined, contextStore?: IContextStore | undefined);
    create(input: CreateGoalInput): Promise<Goal>;
    list(filter?: {
        status?: GoalStatus;
    }): Promise<Goal[]>;
    get(id: string): Promise<Goal>;
    updateStatus(id: string, newStatus: GoalStatus, opts?: {
        force?: boolean;
    }): Promise<Goal>;
    update(id: string, fields: {
        title?: string;
        description?: string;
        assignee?: string;
    }): Promise<Goal>;
    delete(id: string): Promise<void>;
    listTasksForGoal(goalId: string): Promise<Task[]>;
    getProgressReport(goalId: string): Promise<string | undefined>;
    /** Enable autonomous mode on an agent. */
    private enableAutonomous;
    private recordGoalFailure;
    /** Check if an agent has at least one active goal. */
    private hasActiveGoalsForAgent;
    /** Cancel dispatchable (todo/retrying) autonomous tasks assigned to the agent. */
    private cancelPendingAutonomousTasks;
    /** Disable autonomous if agent has no other active goals. */
    private maybeDisableAutonomous;
}

/**
 * TeamService — business logic for team lifecycle.
 *
 * Manages team creation, membership, task pool, and self-claiming.
 */

declare class TeamService {
    private readonly teamStore;
    private readonly agentStore;
    private readonly taskStore;
    private readonly eventBus;
    constructor(teamStore: ITeamStore, agentStore: IAgentStore, taskStore: ITaskStore, eventBus: EventBus);
    create(input: CreateTeamInput): Promise<Team>;
    get(id: string): Promise<Team>;
    list(): Promise<Team[]>;
    join(teamId: string, agentId: string): Promise<Team>;
    leave(teamId: string, agentId: string): Promise<Team>;
    addTask(teamId: string, taskId: string): Promise<Team>;
    removeTask(teamId: string, taskId: string): Promise<Team>;
    setLead(teamId: string, agentId: string): Promise<Team>;
    disband(teamId: string): Promise<void>;
    /**
     * Find the team an agent belongs to (if any).
     */
    findTeamForAgent(agentId: string): Promise<Team | null>;
}

/**
 * Doctor service — diagnostics and health checks.
 *
 * Checks adapter availability, system dependencies, project state.
 */

interface DoctorCheck {
    name: string;
    status: 'ok' | 'fail' | 'skip';
    detail?: string;
}
interface DoctorReport {
    checks: DoctorCheck[];
    adaptersReady: number;
    adaptersTotal: number;
}
interface DoctorExecutables {
    git?: ExecutableDescriptor;
    node?: ExecutableDescriptor;
}
declare class DoctorService {
    private readonly adapterRegistry;
    private readonly commandRunner;
    private readonly executables;
    private readonly cwd;
    constructor(adapterRegistry: AdapterRegistry, commandRunner: ICommandRunner, executables: DoctorExecutables, projectRoot?: string);
    runAll(): Promise<DoctorReport>;
    private checkCommand;
    private checkGitignore;
    private checkGitRepo;
    private gitRepoFailure;
}

/**
 * Dependency injection container.
 *
 * Plain TypeScript object — no framework, no decorators.
 * Two modes:
 *   - LightContainer: stores + services only (fast, for read-only commands)
 *   - Container: full (+ orchestrator, adapters, template engine)
 */

/** Light container — stores + services. No heavy deps (adapters, orchestrator, LiquidJS). */
interface LightContainer {
    context: CliContext;
    paths: Paths;
    config: OrchestratorConfig;
    taskStore: ITaskStore;
    agentStore: IAgentStore;
    runStore: IRunStore;
    stateStore: IStateStore;
    configStore: IConfigStore;
    globalConfigStore: GlobalConfigStore;
    globalConfig: GlobalConfig;
    contextStore: IContextStore;
    messageStore: IMessageStore;
    goalStore: IGoalStore;
    teamStore: ITeamStore;
    eventBus: EventBus;
    taskService: TaskService;
    agentService: AgentService;
    runService: RunService;
    messageService: MessageService;
    goalService: GoalService;
    teamService: TeamService;
}
/** Full container — everything from light + orchestrator, adapters, workspace, template. */
interface Container extends LightContainer {
    processManager: IProcessManager;
    commandRunner: ICommandRunner;
    adapterRegistry: AdapterRegistry;
    templateEngine: ITemplateEngine;
    skillLoader: ISkillLoader;
    doctorService: DoctorService;
    orchestrator: Orchestrator;
    workflowStore: WorkflowArtifactStore;
    workflowEngine: WorkflowEngine;
    workflowSafeguards: WorkflowSafeguards;
}
/**
 * Build a light container (stores + services).
 * Fast — no ProcessManager, no adapters, no LiquidJS, no Orchestrator.
 * Used by read-only commands: task, agent, context, msg, goal, team, logs, status, config.
 */
declare function buildLightContainer(context: CliContext): Promise<LightContainer>;
/**
 * Build a full container (light + orchestrator + adapters + template).
 * Used by: run, tui, doctor.
 */
declare function buildFullContainer(context: CliContext): Promise<Container>;
/**
 * @deprecated Use buildLightContainer or buildFullContainer directly.
 * Kept for backward compatibility with tests.
 */
declare function buildContainer(context: CliContext): Promise<Container>;

export { AGENT_SHOP_TEMPLATES, ARTIFACT_FILES, type AdapterErrorHint, AdapterErrorKind, type AdapterKind, AdapterRegistry, type AdapterTestResult, type Agent, type AgentConfig, type AgentEvent, type AgentLastError, AgentNotFoundError, AgentService, type AgentShopTemplate, type AgentStats, type AgentStatus, type AgentUsage, type ApprovalPolicy, type ArtifactReference, type BindingRotation, type BindingSnapshotV3, type CandidateEvidenceV3, type CheckBindingV3, type CheckResults, type ClipboardContentType, type ClipboardImage, type CodexAction, type CodexDecisionStage, type CodexDecisionV2, type CodexRolePort, type ConsultationOrigin, type ConsultationStatus, type Container, type CreateAgentInput, type CreateGoalInput, type CreateTaskInput, DEFAULT_WORKFLOW_CONFIG, type DecompositionPlanV3, type DecompositionUnitV3, ERROR_HINTS, EventBus, type EventPayload, type ExecuteParams, type FableAdviceV1, type FableFallbackReason, type FableFallbackRecordV1, type FableFallbackV1, type FablePurpose, type FableQueryV1, type FableRolePort, type FailurePhase, GOVERNANCE_KINDS, GOVERNANCE_SCHEMA_VERSION, type Goal, GoalHasPendingTasksError, type GoalOrchestrationPhase, type GoalOrchestrationState, type GoalStatus, type GoalTaskRole, type GovernanceActorBindingV3, type GovernanceActorRoleV3, type GovernanceCheckProvenanceV3, type GovernanceRecordKindV3, type GovernanceRecordV3, type GovernanceRefV3, GovernanceServiceV3, GovernanceStoreV3, GovernedMergeV3, type HumanApprovalV1, type HumanApprovalV3, type IAgentAdapter, type ISkillLoader, type IntegrationReceiptV3, LegacyWorkflowRoleResolver, type LightContainer, MODEL_TIER_MAP, type ModelTier, NotInitializedError, type OpusResult, type OpusRolePort, Orchestrator, type OrchestratorConfig, type OrchestratorEvent, type OrchestratorEventType, type OrchestratorState, OrchestryError, type PersistedFailure, type ProducingRole, type ProjectConfig, type QuorumPolicyV3, type QuorumResultV3, ROLE_PERMISSIONS, type ReasoningEffort, type RetryEntry, type ReviewSubjectRefV3, type ReviewVoteV3, type RolePermissions, type RoleProfile, type RosterAgent, type RosterInput, type RosterProfileSnapshot, type Run, type RunEvent, type RunEventType, RunService, type RunStatus, type RunningEntry, SEMANTIC_ROLES, SUPPORTED_ADAPTERS, type SameAsSupervisor, type SchedulingConfig, type SemanticRole, type SessionMode, type SessionRotation, SkillLoader, type StartWorkflowInput, type StoredGovernanceRecordV3, type Task, TaskNotFoundError, type TaskProof, TaskService, type TaskStatus, type TokenUsage, type ValidatedWorkflowPassportV2, WORKFLOW_PHASE_TRANSITIONS, WORKFLOW_SCHEMA_VERSION, type WorkflowArtifactMetadataV1, type WorkflowArtifactMetadataV2, WorkflowArtifactStore, type WorkflowConfig, type WorkflowConfigOverrides, type WorkflowDecision, type WorkflowEffectReceiptV2, WorkflowEngine, type WorkflowEventV1, type WorkflowEventV2, type WorkflowGitPort, type WorkflowInvocationReceiptV1, type WorkflowInvocationReceiptV2, type WorkflowJobV1, type WorkflowJobV2, type WorkflowLlmAttemptV1, type WorkflowMode, type WorkflowPassportV1, type WorkflowPassportV2, type WorkflowPhase, type WorkflowRolePorts, type WorkflowRoleResolver, type WorkflowRosterSnapshot, type WorkflowRuntimePorts, type WorkflowSessionsV1, type WorkflowSessionsV2, WorkspaceError, type WorkspaceMode, assertNoParallelScopeOverlap, buildContainer, buildFullContainer, buildLightContainer, canTransition, canTransitionWorkflow, classifyAdapterError, createRosterSnapshot, createTokenUsage, defaultModelForAdapter, detectClipboardType, discoverDeterministicChecks, getClipboardImage, getShopTemplateByKey, hashCanonical, hashGovernanceRecordV3, hashRosterAgent, hashRosterSnapshot, isAdapterKind, isBlocked, isClipboardToolAvailable, isDispatchable, isMcpSkill, isModelTier, isTerminal, isTerminalWorkflowPhase, legacyRosterSnapshot, resolveFailureStatus, resolveModel, templateToAgentInput, transitionWorkflow, validateBindingSnapshotV3, validateCandidateEvidenceV3, validateCheckBindingV3, validateCheckResults, validateCodexDecision, validateDecompositionPlanV3, validateDeterministicCheckCommands, validateExplicitChecks, validateFableAdvice, validateFableFallbackRecord, validateFableQuery, validateGovernanceBranchV3, validateGovernanceRecordV3, validateHumanApproval, validateHumanApprovalV3, validateIntegrationReceiptV3, validateOpusResult, validateQuorumPolicyV3, validateQuorumResultV3, validateReviewVoteV3, validateRosterAgent, validateRosterSnapshot };
