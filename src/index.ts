/**
 * Library entry point.
 *
 * Re-exports domain types and core services for programmatic use.
 */

// Domain
export type { Task, TaskStatus, CreateTaskInput, WorkspaceMode, TaskProof, GoalTaskRole } from './domain/task.js';
export type { Agent, AgentStatus, AgentConfig, CreateAgentInput, ApprovalPolicy, ReasoningEffort, AgentStats, AgentLastError } from './domain/agent.js';
export type { Run, RunStatus, RunEvent, RunEventType, TokenUsage } from './domain/run.js';
export { createTokenUsage } from './domain/run.js';
export type { OrchestratorConfig, ProjectConfig, SchedulingConfig } from './domain/config.js';
export type { OrchestratorState, RunningEntry, RetryEntry } from './domain/state.js';
export type { OrchestratorEvent, OrchestratorEventType, EventPayload } from './domain/events.js';
export type { Goal, GoalStatus, CreateGoalInput, GoalOrchestrationPhase, GoalOrchestrationState } from './domain/goal.js';
export { OrchestryError, NotInitializedError, TaskNotFoundError, AgentNotFoundError, GoalHasPendingTasksError, WorkspaceError, AdapterErrorKind, ERROR_HINTS, classifyAdapterError } from './domain/errors.js';
export type { AdapterErrorHint, FailurePhase, PersistedFailure } from './domain/errors.js';
export { canTransition, isTerminal, isDispatchable, isBlocked, resolveFailureStatus } from './domain/transitions.js';
export type { AdapterKind, ModelTier } from './domain/model-tiers.js';
export { resolveModel, defaultModelForAdapter, isAdapterKind, isModelTier, MODEL_TIER_MAP, SUPPORTED_ADAPTERS } from './domain/model-tiers.js';
export type { AgentShopTemplate } from './domain/agent-shop.js';
export { AGENT_SHOP_TEMPLATES, getShopTemplateByKey } from './domain/agent-shop.js';

// Pure application helpers
export { templateToAgentInput, isMcpSkill } from './application/agent-factory.js';
export { discoverDeterministicChecks, validateDeterministicCheckCommands, validateExplicitChecks } from './application/workflow/check-discovery.js';

// Infrastructure interfaces
export type { ISkillLoader } from './infrastructure/skills/skill-loader.js';
export { SkillLoader } from './infrastructure/skills/skill-loader.js';
export * from './domain/workflow/contracts.js';
export * from './domain/workflow/state.js';
export * from './domain/workflow/transitions.js';
export * from './domain/workflow/roster.js';

// Clipboard
export { detectClipboardType, getClipboardImage, isClipboardToolAvailable } from './infrastructure/clipboard-service.js';
export type { ClipboardContentType, ClipboardImage } from './infrastructure/clipboard-service.js';
