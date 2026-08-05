import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkflowLaunch } from '../../../src/application/workflow/launch-resolver.js';
import type { WorkflowLaunchPresetDefinition } from '../../../src/domain/workflow/presets.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function root(withTest = true): Promise<string> {
  const result = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-launch-'));
  roots.push(result);
  await fs.writeFile(path.join(result, 'package.json'), JSON.stringify({ scripts: withTest ? { test: 'vitest run' } : {} }));
  await fs.writeFile(path.join(result, 'package-lock.json'), '{}');
  return result;
}

const projectPreset: WorkflowLaunchPresetDefinition = {
  supervisor: { adapter: 'codex', model: 'project-codex', effort: 'medium' },
  implementer: { adapter: 'claude', model: 'project-opus', effort: 'high' },
  adviser: null,
  reviewer: 'supervisor',
  mode: 'direct',
  max_adviser_calls: 0,
};

describe('workflow launch resolver', () => {
  it('uses built-in defaults and discovered checks', async () => {
    const result = await resolveWorkflowLaunch({ project_root: await root() });
    expect(result).toMatchObject({ preset: { name: 'codex-claude-opus' }, mode: 'adaptive', required_checks: ['npm run test'], config: { fable_total_cap: 0 } });
  });

  it('applies explicit input over selected preset over project default', async () => {
    const result = await resolveWorkflowLaunch({
      project_root: await root(),
      selected_preset: 'selected',
      project: { default_preset: 'default', presets: { default: { ...projectPreset, mode: 'adaptive' }, selected: projectPreset } },
      explicit: { mode: 'adaptive', supervisor: { adapter: 'codex', model: 'explicit', effort: 'high' } },
    });
    expect(result.preset).toMatchObject({ name: 'selected', mode: 'adaptive', supervisor: { model: 'explicit' }, implementer: { model: 'project-opus' } });
  });

  it('constructs a dedicated reviewer profile in the persisted start roster', async () => {
    const reviewer = { adapter: 'claude', model: 'review-model', effort: 'medium' } as const;
    const result = await resolveWorkflowLaunch({ project_root: await root(), explicit: { reviewer } });
    expect(result.preset.reviewer).toEqual(reviewer);
    expect(result.roster.reviewer).toEqual({ adapter: 'claude', profile: { name: 'reviewer', model: 'review-model', effort: 'medium', max_turns: 1, timeout_ms: 600_000 } });
  });

  it('fails before launch when no meaningful check exists', async () => {
    await expect(resolveWorkflowLaunch({ project_root: await root(false) })).rejects.toThrow('No meaningful deterministic check');
  });

  it('resolves selected, project, and global preset precedence', async () => {
    const global = { default_preset: 'global-default', presets: { 'global-default': { ...projectPreset, supervisor: { ...projectPreset.supervisor, model: 'global' } }, shared: { ...projectPreset, supervisor: { ...projectPreset.supervisor, model: 'global-shared' } } } };
    const project = { default_preset: 'project-default', presets: { 'project-default': { ...projectPreset, supervisor: { ...projectPreset.supervisor, model: 'project' } }, shared: { ...projectPreset, supervisor: { ...projectPreset.supervisor, model: 'project-shared' } } } };
    const projectResult = await resolveWorkflowLaunch({ project_root: await root(), project, global });
    const selectedResult = await resolveWorkflowLaunch({ project_root: await root(), selected_preset: 'shared', project, global });
    const globalResult = await resolveWorkflowLaunch({ project_root: await root(), global });
    expect(projectResult.preset.supervisor.model).toBe('project');
    expect(selectedResult.preset.supervisor.model).toBe('project-shared');
    expect(globalResult.preset.supervisor.model).toBe('global');
  });
});
