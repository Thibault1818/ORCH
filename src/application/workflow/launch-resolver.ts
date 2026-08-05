import type { WorkflowConfigOverrides, WorkflowMode } from '../../domain/workflow/state.js';
import { createRosterSnapshot, type RosterAgent, type WorkflowRosterSnapshot } from '../../domain/workflow/roster.js';
import {
  BUILT_IN_WORKFLOW_PRESETS,
  CODEX_CLAUDE_OPUS_PRESET,
  presetToWorkflowConfig,
  type WorkflowLaunchPreset,
  type WorkflowLaunchPresetDefinition,
  type WorkflowPresetConfig,
} from '../../domain/workflow/presets.js';
import { discoverDeterministicChecks, validateExplicitChecks } from './check-discovery.js';

export interface WorkflowLaunchOverrides extends Partial<WorkflowLaunchPresetDefinition> {}

export interface ResolveWorkflowLaunchInput {
  project_root: string;
  selected_preset?: string;
  project?: WorkflowPresetConfig;
  global?: WorkflowPresetConfig;
  explicit?: WorkflowLaunchOverrides;
  required_checks?: string[];
}

export interface ResolvedWorkflowLaunch {
  preset: WorkflowLaunchPreset;
  mode: WorkflowMode;
  required_checks: string[];
  config: WorkflowConfigOverrides;
  roster: WorkflowRosterSnapshot;
}

/** Resolve and validate everything needed before WorkflowEngine.start is called. */
export async function resolveWorkflowLaunch(input: ResolveWorkflowLaunchInput): Promise<ResolvedWorkflowLaunch> {
  const selected = resolveWorkflowPreset(input.selected_preset, input.project, input.global);
  const preset = applyExplicitOverrides(selected, input.explicit);
  validateRuntimeBindings(preset);

  const checks = input.required_checks !== undefined
    ? await validateExplicitChecks(input.project_root, input.required_checks)
    : (await discoverDeterministicChecks(input.project_root)).checks;
  if (checks.length === 0) throw new Error('No meaningful deterministic check was found; configure an explicit trusted check before starting the workflow');

  const config = presetToWorkflowConfig(preset);
  const roster = createRosterSnapshot({
    supervisor: binding(preset.supervisor, 'supervisor'),
    implementer: binding(preset.implementer, 'implementer'),
    adviser: preset.adviser ? binding(preset.adviser, 'adviser') : null,
    reviewer: preset.reviewer === 'supervisor' ? { same_as: 'supervisor' } : binding(preset.reviewer, 'reviewer'),
  }, preset.mode);
  return { preset, mode: preset.mode, required_checks: checks, config, roster };
}

function validateRuntimeBindings(preset: WorkflowLaunchPreset): void {
  if (preset.mode === 'direct' && preset.adviser) throw new Error('Direct workflow cannot include an adviser');
  if (!preset.adviser && preset.max_adviser_calls !== 0) throw new Error('Adviser call cap must be zero when no adviser is configured');
}

function binding(agent: WorkflowLaunchPresetDefinition['supervisor'], role: 'supervisor' | 'implementer' | 'adviser' | 'reviewer'): RosterAgent {
  const defaults = role === 'supervisor' ? { name: 'codex', max_turns: 1, timeout_ms: 600_000 } : role === 'implementer' ? { name: 'opus', max_turns: 50, timeout_ms: 1_800_000 } : role === 'adviser' ? { name: 'fable', max_turns: 1, timeout_ms: 300_000 } : { name: 'reviewer', max_turns: 1, timeout_ms: 600_000 };
  return { adapter: agent.adapter, profile: { ...defaults, model: agent.model, effort: agent.effort } };
}

export function resolveWorkflowPreset(name: string | undefined, project: WorkflowPresetConfig | undefined, global: WorkflowPresetConfig | undefined): WorkflowLaunchPreset {
  const selected = name ?? project?.default_preset ?? global?.default_preset;
  if (!selected) return CODEX_CLAUDE_OPUS_PRESET;
  const projectDefinition = project?.presets?.[selected];
  if (projectDefinition) return { name: selected, scope: 'project', ...projectDefinition };
  const globalDefinition = global?.presets?.[selected];
  if (globalDefinition) return { name: selected, scope: 'global', ...globalDefinition };
  if (selected === 'direct-codex-claude-opus') return CODEX_CLAUDE_OPUS_PRESET;
  const builtIn = BUILT_IN_WORKFLOW_PRESETS[selected];
  if (builtIn) return builtIn;
  throw new Error(`Unknown workflow preset: ${selected}`);
}

export function workflowPresetNames(project: WorkflowPresetConfig | undefined, global: WorkflowPresetConfig | undefined): string[] {
  return [...new Set([...Object.keys(BUILT_IN_WORKFLOW_PRESETS), ...Object.keys(global?.presets ?? {}), ...Object.keys(project?.presets ?? {})])];
}

function applyExplicitOverrides(base: WorkflowLaunchPreset, explicit: WorkflowLaunchOverrides | undefined): WorkflowLaunchPreset {
  if (!explicit) return base;
  return {
    ...base,
    ...explicit,
    supervisor: explicit.supervisor ?? base.supervisor,
    implementer: explicit.implementer ?? base.implementer,
    adviser: explicit.adviser !== undefined ? explicit.adviser : base.adviser,
    name: base.name,
    scope: base.scope,
  };
}
