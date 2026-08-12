import { describe, expect, it, vi } from 'vitest';
import { detectWorkflowCapabilities } from '../../../src/infrastructure/workflow/native-adapters.js';
import type { ICommandRunner } from '../../../src/infrastructure/process/command-runner.js';

describe('workflow capability descriptors', () => {
  it('reports truthful transport and role compatibility using CommandRunner probes only', async () => {
    const run = vi.fn(async (request: any) => {
      const executable = typeof request.executable === 'string' ? request.executable : request.executable.realpath;
      const command = executable.slice(1);
      const args = request.args as string[];
      const help = command === 'codex'
        ? 'exec --json --sandbox --model resume'
        : command === 'claude'
          ? '--print --output-format --max-turns --model --effort --bare --tools --disable-slash-commands --strict-mcp-config --mcp-config --no-session-persistence --resume'
          : command === 'opencode'
            ? 'run --format --model --pure'
            : '-p prompt';
      return { ok: true, stdout: args[0] === '--version' ? `${command} test-version` : help, stderr: '' } as any;
    });
    const runner: ICommandRunner = {
      resolveExecutable: async (command) => ({ path: `/${command}`, realpath: `/${command}`, sha256: 'a'.repeat(64) }),
      run,
      start: () => { throw new Error('unused'); },
    };
    const capabilities = await detectWorkflowCapabilities(runner);
    expect(capabilities.codex).toMatchObject({ installed: true, transport: 'stdin', structured_output: { supported: true, format: 'jsonl' }, sandbox: { supported: true, mode: 'read-only' } });
    expect(capabilities.claude.role_compatibility.implementer.compatible).toBe(true);
    expect(capabilities.opencode.role_compatibility.implementer.compatible).toBe(true);
    expect(capabilities.fable.role_compatibility.adviser.compatible).toBe(true);
    expect(capabilities.grok.transport).toBe('unsupported');
    expect(capabilities.antigravity.transport).toBe('unsupported');
    expect(run).toHaveBeenCalledTimes(12);
  });
});
