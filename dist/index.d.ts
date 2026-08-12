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

export { AGENT_SHOP_TEMPLATES, type AdapterErrorHint, AdapterErrorKind, type AdapterKind, type Agent, type AgentConfig, type AgentLastError, AgentNotFoundError, type AgentShopTemplate, type AgentStats, type AgentStatus, type AgentUsage, type ApprovalPolicy, type ArtifactReference, type BindingRotation, type CheckResults, type ClipboardContentType, type ClipboardImage, type CodexAction, type CodexDecisionStage, type CodexDecisionV2, type ConsultationOrigin, type ConsultationStatus, type CreateAgentInput, type CreateGoalInput, type CreateTaskInput, ERROR_HINTS, type EventPayload, type FableAdviceV1, type FableFallbackReason, type FableFallbackRecordV1, type FableFallbackV1, type FablePurpose, type FableQueryV1, type FailurePhase, type Goal, GoalHasPendingTasksError, type GoalOrchestrationPhase, type GoalOrchestrationState, type GoalStatus, type GoalTaskRole, type HumanApprovalV1, type ISkillLoader, MODEL_TIER_MAP, type ModelTier, NotInitializedError, type OpusResult, type OrchestratorConfig, type OrchestratorEvent, type OrchestratorEventType, type OrchestratorState, OrchestryError, type PersistedFailure, type ProducingRole, type ProjectConfig, ROLE_PERMISSIONS, type ReasoningEffort, type RetryEntry, type RolePermissions, type RoleProfile, type RosterAgent, type RosterInput, type RosterProfileSnapshot, type Run, type RunEvent, type RunEventType, type RunStatus, type RunningEntry, SEMANTIC_ROLES, SUPPORTED_ADAPTERS, type SameAsSupervisor, type SchedulingConfig, type SemanticRole, type SessionMode, type SessionRotation, SkillLoader, type Task, TaskNotFoundError, type TaskProof, type TaskStatus, type TokenUsage, type ValidatedWorkflowPassportV2, WORKFLOW_PHASE_TRANSITIONS, WORKFLOW_SCHEMA_VERSION, type WorkflowArtifactMetadataV1, type WorkflowArtifactMetadataV2, type WorkflowConfig, type WorkflowConfigOverrides, type WorkflowDecision, type WorkflowEffectReceiptV2, type WorkflowEventV1, type WorkflowEventV2, type WorkflowInvocationReceiptV1, type WorkflowInvocationReceiptV2, type WorkflowJobV1, type WorkflowJobV2, type WorkflowLlmAttemptV1, type WorkflowMode, type WorkflowPassportV1, type WorkflowPassportV2, type WorkflowPhase, type WorkflowRosterSnapshot, type WorkflowSessionsV1, type WorkflowSessionsV2, WorkspaceError, type WorkspaceMode, canTransition, canTransitionWorkflow, classifyAdapterError, createRosterSnapshot, createTokenUsage, defaultModelForAdapter, detectClipboardType, discoverDeterministicChecks, getClipboardImage, getShopTemplateByKey, hashRosterAgent, hashRosterSnapshot, isAdapterKind, isBlocked, isClipboardToolAvailable, isDispatchable, isMcpSkill, isModelTier, isTerminal, isTerminalWorkflowPhase, legacyRosterSnapshot, resolveFailureStatus, resolveModel, templateToAgentInput, transitionWorkflow, validateCheckResults, validateCodexDecision, validateDeterministicCheckCommands, validateExplicitChecks, validateFableAdvice, validateFableFallbackRecord, validateFableQuery, validateHumanApproval, validateOpusResult, validateRosterAgent, validateRosterSnapshot };
