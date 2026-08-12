import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import type { AdapterCapabilityDescriptor, WorkflowCapabilityRole } from '../infrastructure/adapters/interface.js';
import type { WorkflowLaunchPreset, WorkflowPresetAgent, WorkflowPresetEffort } from '../domain/workflow/presets.js';

export type WorkflowCapabilities = Record<'codex' | 'claude' | 'opencode' | 'fable' | 'grok' | 'antigravity', AdapterCapabilityDescriptor>;
export type WorkflowPrompt = (question: string) => Promise<string>;

export interface WorkflowWizardInput {
  preset: WorkflowLaunchPreset;
  preset_names: string[];
  presets?: Record<string, WorkflowLaunchPreset>;
  capabilities: WorkflowCapabilities;
  discovered_checks: string[];
  allow_unverified_model?: boolean;
}

export interface WorkflowWizardResult {
  preset: string;
  mode: 'adaptive' | 'direct';
  supervisor: WorkflowPresetAgent;
  implementer: WorkflowPresetAgent;
  adviser: WorkflowPresetAgent | null;
  reviewer: 'supervisor' | WorkflowPresetAgent;
  max_adviser_calls: 0 | 1;
  checks: string[];
}

export async function runWorkflowWizard(input: WorkflowWizardInput, prompt: WorkflowPrompt): Promise<WorkflowWizardResult> {
  const preset = await chooseText(prompt, 'Preset', input.preset_names, input.preset.name);
  const defaults = input.presets?.[preset] ?? input.preset;
  const mode = await chooseText(prompt, 'Mode', ['adaptive', 'direct'] as const, defaults.mode);
  const supervisor = await chooseAgent(prompt, 'Supervisor', 'supervisor', input.capabilities, defaults.supervisor, input.allow_unverified_model);
  const implementer = await chooseAgent(prompt, 'Implementer', 'implementer', input.capabilities, defaults.implementer, input.allow_unverified_model);
  const adviser = mode === 'direct'
    ? null
    : await chooseOptionalAgent(prompt, 'Adviser', 'adviser', input.capabilities, defaults.adviser, input.allow_unverified_model);
  const reviewerDefault = defaults.reviewer === 'supervisor' ? 'supervisor' : defaults.reviewer.adapter;
  const reviewerChoice = await chooseText(prompt, 'Reviewer', ['supervisor', ...compatibleAdapters('reviewer', input.capabilities)] as const, reviewerDefault);
  const reviewer = reviewerChoice === 'supervisor'
    ? 'supervisor' as const
    : await configureAgent(prompt, 'Reviewer', reviewerChoice, input.capabilities, defaults.reviewer === 'supervisor' ? defaults.supervisor : defaults.reviewer, input.allow_unverified_model);
  const maxDefault: 0 | 1 = adviser ? defaults.max_adviser_calls || 1 : 0;
  const max = adviser ? await chooseText(prompt, 'Maximum adviser calls', ['0', '1'] as const, String(maxDefault)) : '0';
  const checks = await chooseChecks(prompt, input.discovered_checks);
  return { preset, mode, supervisor, implementer, adviser, reviewer, max_adviser_calls: Number(max) as 0 | 1, checks };
}

export function createReadlineWorkflowPrompt(input: Readable = process.stdin, output: Writable = process.stdout): { prompt: WorkflowPrompt; close: () => void } {
  const readline = createInterface({ input, output });
  return { prompt: (question) => readline.question(question), close: () => readline.close() };
}

function compatibleAdapters(role: WorkflowCapabilityRole, capabilities: WorkflowCapabilities): string[] {
  return unique(Object.values(capabilities).filter((item) => item.role_compatibility[role].compatible).map((item) => item.adapter));
}

function capabilityHelp(role: WorkflowCapabilityRole, capabilities: WorkflowCapabilities): string {
  return Object.values(capabilities).filter((item) => item.installed && !item.role_compatibility[role].compatible)
    .map((item) => `${item.adapter}: ${item.role_compatibility[role].reasons[0] ?? 'incompatible'}`).join('; ');
}

async function chooseAgent(prompt: WorkflowPrompt, label: string, role: WorkflowCapabilityRole, capabilities: WorkflowCapabilities, fallback: WorkflowPresetAgent, allowUnverified = false): Promise<WorkflowPresetAgent> {
  const choices = compatibleAdapters(role, capabilities);
  if (choices.length === 0) throw new Error(`No compatible CLI is available for ${label}`);
  const help = capabilityHelp(role, capabilities);
  const adapter = await chooseText(prompt, `${label} CLI${help ? ` (unavailable: ${help})` : ''}`, choices, choices.includes(fallback.adapter) ? fallback.adapter : choices[0]!);
  return configureAgent(prompt, label, adapter, capabilities, fallback, allowUnverified);
}

async function chooseOptionalAgent(prompt: WorkflowPrompt, label: string, role: WorkflowCapabilityRole, capabilities: WorkflowCapabilities, fallback: WorkflowPresetAgent | null, allowUnverified = false): Promise<WorkflowPresetAgent | null> {
  const compatible = compatibleAdapters(role, capabilities);
  const help = capabilityHelp(role, capabilities);
  const adapter = await chooseText(prompt, `${label} CLI${help ? ` (unavailable: ${help})` : ''}`, ['none', ...compatible], fallback?.adapter ?? 'none');
  return adapter === 'none' ? null : configureAgent(prompt, label, adapter, capabilities, fallback ?? { adapter, model: '', effort: 'low' }, allowUnverified);
}

async function configureAgent(prompt: WorkflowPrompt, label: string, adapter: string, capabilities: WorkflowCapabilities, fallback: WorkflowPresetAgent, allowUnverified = false): Promise<WorkflowPresetAgent> {
  const descriptor = Object.values(capabilities).find((item) => item.adapter === adapter);
  if (!descriptor) throw new Error(`No capability descriptor exists for ${adapter}`);
  const known = descriptor.models.verified.map((item) => item.id);
  const choices = [...(descriptor.models.cli_default ? ['CLI default'] : []), ...known];
  if (allowUnverified) choices.push('Custom (UNVERIFIED)');
  const fallbackChoice = fallback.model ? (known.includes(fallback.model) ? fallback.model : allowUnverified ? 'Custom (UNVERIFIED)' : choices[0]!) : 'CLI default';
  const selected = await chooseText(prompt, `${label} model/profile`, choices, fallbackChoice);
  const model = selected === 'CLI default' ? '' : selected === 'Custom (UNVERIFIED)' ? await boundedValue(prompt, `${label} custom model/profile: `, fallback.model) : selected;
  const effort = await chooseText(prompt, `${label} effort`, ['low', 'medium', 'high'] as const, fallback.effort);
  return { adapter, model, effort: effort as WorkflowPresetEffort };
}

async function chooseChecks(prompt: WorkflowPrompt, checks: string[]): Promise<string[]> {
  if (checks.length === 0) return [];
  const choices = checks.map((check, index) => `${index + 1}:${check}`).join(', ');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = (await prompt(`Trusted checks (${choices}) [all]: `)).trim();
    if (!answer || answer.toLowerCase() === 'all') return checks;
    const indexes = answer.split(',').map((value) => Number(value.trim()) - 1);
    if (indexes.length > 0 && indexes.every((index) => Number.isInteger(index) && checks[index])) return unique(indexes.map((index) => checks[index]!));
  }
  throw new Error('Too many invalid trusted check selections');
}

async function chooseText<T extends string>(prompt: WorkflowPrompt, label: string, choices: readonly T[], fallback: string): Promise<T> {
  const defaultValue = choices.includes(fallback as T) ? fallback as T : choices[0];
  if (!defaultValue) throw new Error(`No choices are available for ${label}`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = (await prompt(`${label} (${choices.join('/')}) [${defaultValue}]: `)).trim();
    const value = answer || defaultValue;
    if (choices.includes(value as T)) return value as T;
  }
  throw new Error(`Too many invalid ${label.toLowerCase()} selections`);
}

async function boundedValue(prompt: WorkflowPrompt, question: string, fallback: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = (await prompt(question)).trim() || fallback;
    if (/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(answer)) return answer;
  }
  throw new Error('Too many invalid model/profile values');
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
