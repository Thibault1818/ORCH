import { describe, expect, it, vi } from 'vitest';

const { execFile } = vi.hoisted(() => ({
  execFile: vi.fn((...call: unknown[]) => {
    const command = call[0] as string;
    const args = call[1] as string[];
    const callback = call.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
    const version = `${command} test-version`;
    const help = command === 'codex'
      ? 'exec --json --sandbox --model resume'
      : command === 'claude'
        ? '--print --output-format --max-turns --model --effort --bare --tools --disable-slash-commands --strict-mcp-config --mcp-config --no-session-persistence --resume'
        : '-p prompt';
    callback(null, args[0] === '--version' ? version : help, '');
  }),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile };
});
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return { ...actual, promisify: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => new Promise((resolve, reject) => fn(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }))) };
});

import { detectWorkflowCapabilities } from '../../../src/infrastructure/workflow/native-adapters.js';

describe('workflow capability descriptors', () => {
  it('reports truthful transport and role compatibility using probes only', async () => {
    const capabilities = await detectWorkflowCapabilities();

    expect(Object.keys(capabilities)).toEqual(['codex', 'claude', 'fable', 'grok', 'antigravity']);
    expect(capabilities.codex).toMatchObject({ installed: true, transport: 'stdin', structured_output: { supported: true, format: 'jsonl' }, sandbox: { supported: true, mode: 'read-only' } });
    expect(capabilities.codex.role_compatibility.supervisor).toEqual({ compatible: true, reasons: [] });
    expect(capabilities.codex.role_compatibility.reviewer).toEqual({ compatible: true, reasons: [] });
    expect(capabilities.claude).toMatchObject({ installed: true, transport: 'stdin', structured_output: { supported: true, format: 'stream-json' }, tools: { mode: 'enabled' } });
    expect(capabilities.claude.role_compatibility.implementer).toEqual({ compatible: true, reasons: [] });
    expect(capabilities.fable).toMatchObject({ installed: true, transport: 'stdin', tools: { configurable: true, mode: 'disabled' }, resume: { advertised: true, enabled: false } });
    expect(capabilities.fable.role_compatibility.adviser).toEqual({ compatible: true, reasons: [] });
    expect(Object.keys(capabilities.codex.role_compatibility)).toEqual(['supervisor', 'implementer', 'adviser', 'reviewer']);
    for (const descriptor of [capabilities.grok, capabilities.antigravity]) {
      expect(descriptor).toMatchObject({ installed: true, transport: 'unsupported', structured_output: { supported: false }, sandbox: { supported: false }, resume: { advertised: false, enabled: false } });
      expect(Object.values(descriptor.role_compatibility).every((role) => !role.compatible)).toBe(true);
      expect(descriptor.detail).toContain('argv prompt transport is prohibited');
    }

    expect(execFile).toHaveBeenCalledTimes(10);
    for (const call of execFile.mock.calls) {
      expect(call[1]).toHaveLength(1);
      expect(['--version', '--help']).toContain(call[1][0]);
      expect(call[2]).toMatchObject({ env: expect.any(Object) });
    }
  });
});
