import { describe, expect, it, vi } from 'vitest';
import { GrokAdapter } from '../../../src/infrastructure/adapters/grok.js';
import type { ExecuteParams } from '../../../src/infrastructure/adapters/interface.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn((...args: unknown[]) => (args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void)(null, 'grok 0.2.64', '')) };
});
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return { ...actual, promisify: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => new Promise((resolve, reject) => fn(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }))) };
});

function processManager(): IProcessManager {
  return { isAlive: vi.fn(() => false), kill: vi.fn(), killWithGrace: vi.fn(async () => {}), spawn: vi.fn() } as unknown as IProcessManager;
}

function params(): ExecuteParams {
  return { prompt: 'PROMPT_SENTINEL', systemPrompt: 'SYSTEM_SENTINEL', workspace: '/tmp/grok-ws', env: { SAFE_VALUE: 'ENV_SENTINEL' }, config: {} };
}

describe('GrokAdapter', () => {
  it('fails closed before spawn because stdin transport is unproven', () => {
    const pm = processManager();
    const adapter = new GrokAdapter(pm);
    expect(() => adapter.execute(params())).toThrow('stdin prompt transport is not proven');
    expect(pm.spawn).not.toHaveBeenCalled();
  });

  it('uses a restricted environment for its version-only health probe', async () => {
    const { execFile } = await import('node:child_process');
    const adapter = new GrokAdapter(processManager());
    await expect(adapter.test()).resolves.toMatchObject({ ok: true, version: 'grok 0.2.64' });
    expect(execFile).toHaveBeenCalledWith('grok', ['--version'], expect.objectContaining({ env: expect.any(Object) }), expect.any(Function));
    const env = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2].env as Record<string, string>;
    expect(JSON.stringify(env)).not.toContain('ENV_SENTINEL');
  });

  it('returns grok kind and delegates stop', async () => {
    const pm = processManager();
    const adapter = new GrokAdapter(pm);
    expect(adapter.kind).toBe('grok');
    await adapter.stop(7777);
    expect(pm.killWithGrace).toHaveBeenCalledWith(7777);
  });
});
