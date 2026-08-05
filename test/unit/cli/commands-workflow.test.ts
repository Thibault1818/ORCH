import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerWorkflowCommand } from '../../../src/cli/commands/workflow.js';
import type { WorkflowCapabilities } from '../../../src/cli/workflow-wizard.js';
import type { AdapterCapabilityDescriptor, WorkflowCapabilityRole } from '../../../src/infrastructure/adapters/interface.js';
import { makeContainer } from './helpers.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function descriptor(adapter: AdapterCapabilityDescriptor['adapter'], compatible: WorkflowCapabilityRole | WorkflowCapabilityRole[] | null, installed = true): AdapterCapabilityDescriptor {
  const command = adapter === 'antigravity' ? 'agy' : adapter === 'fable' ? 'claude' : adapter as AdapterCapabilityDescriptor['command'];
  const roles = compatible === null ? [] : Array.isArray(compatible) ? compatible : [compatible];
  const role_compatibility = Object.fromEntries((['supervisor', 'implementer', 'adviser', 'reviewer'] as const).map((role) => [role, { compatible: roles.includes(role), reasons: roles.includes(role) ? [] : [`${adapter} cannot serve ${role}`] }])) as AdapterCapabilityDescriptor['role_compatibility'];
  return { adapter, command, installed, version: installed ? '1' : null, transport: roles.length ? 'stdin' : 'unsupported', structured_output: { supported: true, format: 'json' }, sandbox: { supported: true, mode: 'read-only' }, tools: { configurable: false, mode: 'enabled' }, resume: { advertised: false, enabled: false }, role_compatibility, supported_options: [], unsupported_options: [], detail: installed ? 'test' : 'CLI is not installed', available: installed, advertised_native_resume: false, native_resume: false };
}

const capabilities: WorkflowCapabilities = { codex: descriptor('codex', ['supervisor', 'reviewer']), claude: descriptor('claude', ['implementer', 'reviewer']), fable: descriptor('fable', 'adviser'), grok: descriptor('grok', null), antigravity: descriptor('antigravity', null) };

async function setup(config: Record<string, unknown> = { workflow: {} }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-workflow-cli-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
  await fs.writeFile(path.join(root, 'package-lock.json'), '{}');
  const start = vi.fn(async () => 'wf_test');
  const run = vi.fn(async () => ({ phase: 'completed' }));
  const rotateBinding = vi.fn(async () => {});
  const container = makeContainer({ context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: root }, config: config as any, workflowEngine: { start, run, rotateBinding } as any, workflowStore: { readPassport: vi.fn(async () => ({ roster: { schema_version: 1, supervisor: { adapter: 'codex', profile: { name: 'codex', model: 'codex', effort: 'medium', max_turns: 1, timeout_ms: 1000 } }, implementer: { adapter: 'claude', profile: { name: 'opus', model: 'opus', effort: 'high', max_turns: 50, timeout_ms: 1000 } }, adviser: null, reviewer: { same_as: 'supervisor' } } })) } as any });
  const program = new Command().exitOverride();
  registerWorkflowCommand(program, container, { detectCapabilities: async () => capabilities, isTTY: () => false });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return { program, start, run, rotateBinding, container };
}

describe('workflow start preflight', () => {
  it('prints a complete dry-run summary without calling the engine', async () => {
    const { program, start, run } = await setup();
    await program.parseAsync(['workflow', 'start', 'Keep this objective accepted', '--yes', '--dry-run'], { from: 'user' });
    expect(start).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    const summary = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(summary).toMatchObject({ objective: 'Keep this objective accepted', mode: 'adaptive', roster: { supervisor: { adapter: 'codex' }, implementer: { adapter: 'claude' }, adviser: null, reviewer: { same_as: 'supervisor' } }, checks: ['npm run test'], max_adviser_calls: 0, dry_run: true });
  });
  it('requires --yes for a noninteractive non-dry-run start', async () => { const { program, start } = await setup(); await expect(program.parseAsync(['workflow', 'start', 'Objective'], { from: 'user' })).rejects.toThrow('requires --yes'); expect(start).not.toHaveBeenCalled(); await expect(program.parseAsync(['workflow', 'start', 'Objective', '--dry-run'], { from: 'user' })).resolves.toBeDefined(); });
  it('rejects a malicious explicit check before capability detection', async () => { const { program, start } = await setup(); await expect(program.parseAsync(['workflow', 'start', 'Objective', '--yes', '--check', 'npm test; touch owned'], { from: 'user' })).rejects.toThrow('Unsafe'); expect(start).not.toHaveBeenCalled(); });

  it('blocks an incompatible role before engine start', async () => {
    const { program, start } = await setup();
    await expect(program.parseAsync(['workflow', 'start', 'Objective', '--yes', '--supervisor', 'grok'], { from: 'user' })).rejects.toThrow('Supervisor CLI grok is incompatible');
    expect(start).not.toHaveBeenCalled();
  });

  it('does not detect model capabilities when no trusted check exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-workflow-cli-'));
    roots.push(root);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}');
    const detectCapabilities = vi.fn(async () => capabilities);
    const container = makeContainer({ context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: root }, config: { workflow: {} } as any });
    const program = new Command().exitOverride();
    registerWorkflowCommand(program, container, { detectCapabilities, isTTY: () => false });
    await expect(program.parseAsync(['workflow', 'start', 'Objective', '--yes'], { from: 'user' })).rejects.toThrow('No meaningful deterministic check');
    expect(detectCapabilities).not.toHaveBeenCalled();
  });

  it('preserves a selected preset adviser when CLI options omit adviser', async () => {
    const selected = { supervisor: { adapter: 'codex', model: 'codex', effort: 'high' }, implementer: { adapter: 'claude', model: 'opus', effort: 'high' }, adviser: { adapter: 'fable', model: 'fable', effort: 'low' }, reviewer: 'supervisor', mode: 'adaptive', max_adviser_calls: 1 };
    const { program } = await setup({ workflow: {}, workflow_launch: { presets: { selected } } });
    await program.parseAsync(['workflow', 'start', 'Objective', '--yes', '--preset', 'selected', '--dry-run'], { from: 'user' });
    const summary = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);
    expect(summary).toMatchObject({ roster: { adviser: { adapter: 'fable' } }, max_adviser_calls: 1 });
  });
  it('preserves explicit role flags when entering the interactive wizard', async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-workflow-cli-')); roots.push(root); await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } })); await fs.writeFile(path.join(root, 'package-lock.json'), '{}'); const container = makeContainer({ context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: root }, config: { workflow: {} } as any, workflowEngine: { start: vi.fn(), run: vi.fn() } as any }); const program = new Command().exitOverride(); registerWorkflowCommand(program, container, { detectCapabilities: async () => capabilities, isTTY: () => true, prompt: async () => '' }); vi.spyOn(console, 'log').mockImplementation(() => {}); await program.parseAsync(['workflow', 'start', 'Objective', '--supervisor-model', 'explicit-model', '--dry-run'], { from: 'user' }); const summary = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]); expect(summary.roster.supervisor.profile.model).toBe('explicit-model'); });

  it('passes a separate reviewer profile through to engine start', async () => {
    const { program, start } = await setup();
    await program.parseAsync(['workflow', 'start', 'Objective', '--yes', '--reviewer', 'claude', '--reviewer-model', 'review-model', '--reviewer-effort', 'low'], { from: 'user' });
    expect(start.mock.calls[0]![0].roster.reviewer).toEqual({ adapter: 'claude', profile: { name: 'reviewer', model: 'review-model', effort: 'low', max_turns: 1, timeout_ms: 600_000 } });
  });

  it('reports every CLI descriptor even when deterministic checks are missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-workflow-doctor-'));
    roots.push(root);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
    const detectCapabilities = vi.fn(async () => ({ ...capabilities, grok: descriptor('grok', null, true), antigravity: descriptor('antigravity', null, false) }));
    const container = makeContainer({ context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: root }, config: { workflow: {} } as any });
    const program = new Command().exitOverride();
    registerWorkflowCommand(program, container, { detectCapabilities, isTTY: () => false });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['workflow', 'doctor'], { from: 'user' });
    const output = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(detectCapabilities).toHaveBeenCalledOnce();
    expect(Object.keys(output.cli_descriptors)).toEqual(['codex', 'claude', 'fable', 'grok', 'antigravity']);
    expect(output.blockers).toContain('No meaningful deterministic check was found');
    expect(output.blockers.join('\n')).not.toContain('grok');
  });
  it('doctor evaluates the configured default preset and adviser compatibility', async () => { const selected = { supervisor: { adapter: 'codex', model: 'codex', effort: 'high' }, implementer: { adapter: 'claude', model: 'opus', effort: 'high' }, adviser: { adapter: 'grok', model: 'grok', effort: 'low' }, reviewer: 'supervisor', mode: 'adaptive', max_adviser_calls: 1 }; const { program } = await setup({ workflow: {}, workflow_launch: { default_preset: 'selected', presets: { selected } } }); await program.parseAsync(['workflow', 'doctor'], { from: 'user' }); const output = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]); expect(output.evaluated_preset).toBe('selected'); expect(output.blockers.join('\n')).toContain('Configured Adviser CLI grok'); });

  it('passes an explicit binding rotation without invoking capability detection', async () => { const { program, rotateBinding } = await setup(); await program.parseAsync(['workflow', 'binding-rotate', 'wf_test', 'implementer', '--adapter', 'claude', '--model', 'sonnet', '--effort', 'medium', '--reason', 'supported upgrade', '--max-turns', '25', '--timeout', '9000'], { from: 'user' }); expect(rotateBinding).toHaveBeenCalledWith('wf_test', 'implementer', { adapter: 'claude', profile: { name: 'opus', model: 'sonnet', effort: 'medium', max_turns: 25, timeout_ms: 9000 } }, 'supported upgrade'); });
  it('reports receipt usage by semantic role without duplicating provider buckets', async () => { const { program, container } = await setup(); const roster = (await container.workflowStore.readPassport('wf_test'))!.roster!; const zero = { calls: 0, input_chars: 0, output_chars: 0, input_tokens: 0, output_tokens: 0, estimated_tokens: 0, cache_read: 0, cache_write: 0, duration_ms: 0, failed_calls: 0, resumes: 0, compactions: 0 }; Object.assign(container.workflowStore, { listJobs: vi.fn(async () => [{ job_id: 'wf_test' }]), readJob: vi.fn(async () => ({ job_id: 'wf_test', mode: 'direct', phase: 'done', consultation_origin: null, fable_calls: 0, blocker: null })), readSessions: vi.fn(async () => ({ usage: { codex: { ...zero, calls: 2, estimated_tokens: 999 }, fable: zero, opus: zero } })), readPassport: vi.fn(async () => ({ mode: 'direct', roster, roster_hash: 'a'.repeat(64), active_roster: roster, active_roster_hash: 'a'.repeat(64), roster_revision: 1, binding_rotation_history: [], config: { fable_total_cap: 0 }, required_checks: ['npm test'] })), readInvocationReceipts: vi.fn(async () => [{ semantic_role: 'supervisor', result: { usage: { input_tokens: 10, output_tokens: 5, duration_ms: 20 } } }, { semantic_role: 'reviewer', result: { usage: { input_tokens: 7, output_tokens: 3, duration_ms: 30 } } }]) }); await program.parseAsync(['workflow', 'status', 'wf_test'], { from: 'user' }); const status = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]); expect(status.usage).toEqual({ semantic_roles: { supervisor: { calls: 1, tokens: 15, duration_ms: 20, failures: 0 }, implementer: { calls: 0, tokens: 0, duration_ms: 0, failures: 0 }, adviser: { calls: 0, tokens: 0, duration_ms: 0, failures: 0 }, reviewer: { calls: 1, tokens: 10, duration_ms: 30, failures: 0 } }, legacy_fallback: null }); expect(status.tokens).toBe(25); });
});
