import { describe, expect, it, vi } from 'vitest';
import { runWorkflowWizard, type WorkflowCapabilities } from '../../../src/cli/workflow-wizard.js';
import { CODEX_CLAUDE_OPUS_PRESET, type WorkflowLaunchPreset } from '../../../src/domain/workflow/presets.js';
import type { AdapterCapabilityDescriptor, WorkflowCapabilityRole } from '../../../src/infrastructure/adapters/interface.js';

function descriptor(adapter: AdapterCapabilityDescriptor['adapter'], compatible: WorkflowCapabilityRole | WorkflowCapabilityRole[] | null, reason = 'wrong semantic role'): AdapterCapabilityDescriptor {
  const command = adapter === 'antigravity' ? 'agy' : adapter === 'fable' ? 'claude' : adapter as AdapterCapabilityDescriptor['command'];
  const roles = compatible === null ? [] : Array.isArray(compatible) ? compatible : [compatible];
  const role_compatibility = Object.fromEntries((['supervisor', 'implementer', 'adviser', 'reviewer'] as const).map((role) => [role, { compatible: roles.includes(role), reasons: roles.includes(role) ? [] : [reason] }])) as AdapterCapabilityDescriptor['role_compatibility'];
  return { adapter, command, installed: true, version: '1.0.0', transport: roles.length ? 'stdin' : 'unsupported', structured_output: { supported: true, format: 'json' }, sandbox: { supported: true, mode: 'read-only' }, tools: { configurable: false, mode: 'enabled' }, resume: { advertised: false, enabled: false }, role_compatibility, supported_options: [], unsupported_options: [], detail: reason, available: true, advertised_native_resume: false, native_resume: false };
}

const capabilities: WorkflowCapabilities = {
  codex: descriptor('codex', ['supervisor', 'reviewer']),
  claude: descriptor('claude', 'implementer'),
  fable: descriptor('fable', 'adviser'),
  grok: descriptor('grok', null, 'stdin transport is not proven'),
  antigravity: descriptor('antigravity', null),
};

describe('workflow wizard', () => {
  it('uses semantic defaults and shows installed incompatible CLIs with reasons', async () => {
    const answers = ['', '', '', '', '', '', '', '', '', '', ''];
    const prompt = vi.fn(async () => answers.shift() ?? '');
    const result = await runWorkflowWizard({ preset: CODEX_CLAUDE_OPUS_PRESET, preset_names: [CODEX_CLAUDE_OPUS_PRESET.name], capabilities, discovered_checks: ['npm run test'] }, prompt);
    expect(result).toMatchObject({ mode: 'adaptive', supervisor: { adapter: 'codex' }, implementer: { adapter: 'claude' }, adviser: null, reviewer: 'supervisor', checks: ['npm run test'] });
    expect(prompt.mock.calls.map(([question]) => question).join('\n')).toContain('grok: stdin transport is not proven');
  });

  it('stops after three invalid selections', async () => {
    const prompt = vi.fn(async () => 'invalid');
    await expect(runWorkflowWizard({ preset: CODEX_CLAUDE_OPUS_PRESET, preset_names: [CODEX_CLAUDE_OPUS_PRESET.name], capabilities, discovered_checks: ['npm run test'] }, prompt)).rejects.toThrow('Too many invalid preset selections');
    expect(prompt).toHaveBeenCalledTimes(3);
  });

  it('loads the chosen preset defaults before prompting for roles', async () => {
    const selected: WorkflowLaunchPreset = { ...CODEX_CLAUDE_OPUS_PRESET, name: 'with-adviser', scope: 'project', adviser: { adapter: 'fable', model: 'selected-fable', effort: 'medium' }, max_adviser_calls: 1 };
    const answers = ['with-adviser', '', '', '', '', '', '', '', '', '', '', '', ''];
    const prompt = vi.fn(async () => answers.shift() ?? '');
    const result = await runWorkflowWizard({ preset: CODEX_CLAUDE_OPUS_PRESET, preset_names: [CODEX_CLAUDE_OPUS_PRESET.name, selected.name], presets: { [selected.name]: selected }, capabilities, discovered_checks: ['npm run test'] }, prompt);
    expect(result).toMatchObject({ preset: 'with-adviser', adviser: { adapter: 'fable', model: 'selected-fable', effort: 'medium' }, max_adviser_calls: 1 });
  });

  it('loads a chosen preset dedicated reviewer defaults', async () => {
    const selected: WorkflowLaunchPreset = { ...CODEX_CLAUDE_OPUS_PRESET, name: 'reviewed', scope: 'project', reviewer: { adapter: 'codex', model: 'review-profile', effort: 'low' } };
    const answers = ['reviewed', '', '', '', '', '', '', '', '', '', '', '', ''];
    const prompt = vi.fn(async () => answers.shift() ?? '');
    const result = await runWorkflowWizard({ preset: CODEX_CLAUDE_OPUS_PRESET, preset_names: [CODEX_CLAUDE_OPUS_PRESET.name, selected.name], presets: { [selected.name]: selected }, capabilities, discovered_checks: ['npm run test'] }, prompt);
    expect(result.reviewer).toEqual({ adapter: 'codex', model: 'review-profile', effort: 'low' });
  });
});
