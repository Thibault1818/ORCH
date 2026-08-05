import type { WorkflowConfigOverrides, WorkflowMode } from './state.js';

export type WorkflowPresetScope = 'project' | 'global' | 'built_in';
export type WorkflowPresetRole = 'supervisor' | 'implementer' | 'adviser';
export type WorkflowPresetEffort = 'low' | 'medium' | 'high';

export interface WorkflowPresetAgent {
  adapter: string;
  model: string;
  effort: WorkflowPresetEffort;
}

export interface WorkflowLaunchPresetDefinition {
  supervisor: WorkflowPresetAgent;
  implementer: WorkflowPresetAgent;
  adviser: WorkflowPresetAgent | null;
  reviewer: 'supervisor' | WorkflowPresetAgent;
  mode: WorkflowMode;
  max_adviser_calls: 0 | 1;
}

export interface WorkflowLaunchPreset extends WorkflowLaunchPresetDefinition {
  name: string;
  scope: WorkflowPresetScope;
}

/** A named collection can be stored in project or global configuration. */
export interface WorkflowPresetConfig {
  default_preset?: string;
  presets?: Record<string, WorkflowLaunchPresetDefinition>;
}

export const CODEX_CLAUDE_OPUS_PRESET: WorkflowLaunchPreset = {
  name: 'codex-claude-opus',
  scope: 'built_in',
  supervisor: { adapter: 'codex', model: 'codex', effort: 'high' },
  implementer: { adapter: 'claude', model: 'opus', effort: 'high' },
  adviser: null,
  reviewer: 'supervisor',
  mode: 'adaptive',
  max_adviser_calls: 0,
};

export const BUILT_IN_WORKFLOW_PRESETS: Readonly<Record<string, WorkflowLaunchPreset>> = {
  [CODEX_CLAUDE_OPUS_PRESET.name]: CODEX_CLAUDE_OPUS_PRESET,
};

/** @deprecated Use CODEX_CLAUDE_OPUS_PRESET. */
export const DIRECT_CODEX_CLAUDE_OPUS_PRESET = CODEX_CLAUDE_OPUS_PRESET;

export function presetToWorkflowConfig(preset: WorkflowLaunchPresetDefinition): WorkflowConfigOverrides {
  return {
    fable_total_cap: preset.max_adviser_calls,
    profiles: {
      codex: { model: preset.supervisor.model, effort: preset.supervisor.effort, permission_mode: 'read_only' },
      opus: { model: preset.implementer.model, effort: preset.implementer.effort, permission_mode: 'worktree' },
    },
  };
}
