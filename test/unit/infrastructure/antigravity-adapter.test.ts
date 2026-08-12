import { describe, expect, it, vi } from 'vitest';
import { AntigravityAdapter } from '../../../src/infrastructure/adapters/antigravity.js';
import type { ExecuteParams } from '../../../src/infrastructure/adapters/interface.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { ICommandRunner } from '../../../src/infrastructure/process/command-runner.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn((...args: unknown[]) => (args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void)(null, 'agy 2.0.0', '')) };
});
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return { ...actual, promisify: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => new Promise((resolve, reject) => fn(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }))) };
});

function processManager(): IProcessManager {
  return {
    isAlive: vi.fn(() => false),
    kill: vi.fn(),
    killWithGrace: vi.fn(async () => {}),
    spawn: vi.fn(),
    start: vi.fn(),
    run: vi.fn(async () => ({ ok: true, stdout: 'agy 2.0.0' })),
  } as unknown as IProcessManager & ICommandRunner;
}

function params(): ExecuteParams {
  return { prompt: 'PROMPT_SENTINEL', systemPrompt: 'SYSTEM_SENTINEL', workspace: '/tmp/agy-ws', env: { SAFE_VALUE: 'ENV_SENTINEL' }, config: {} };
}

describe('AntigravityAdapter', () => {
  it('fails closed before spawn because stdin transport is unproven', () => {
    const pm = processManager();
    const adapter = new AntigravityAdapter(pm);
    expect(() => adapter.execute(params())).toThrow('stdin prompt transport is not proven');
    expect(pm.spawn).not.toHaveBeenCalled();
  });

  it('uses a restricted environment for its version-only health probe', async () => {
    const { execFile } = await import('node:child_process');
    const adapter = new AntigravityAdapter(processManager());
    await expect(adapter.test()).resolves.toMatchObject({ ok: true, version: 'agy 2.0.0' });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('returns antigravity kind and delegates stop', async () => {
    const pm = processManager();
    const adapter = new AntigravityAdapter(pm);
    expect(adapter.kind).toBe('antigravity');
    await adapter.stop(8888);
    expect(pm.killWithGrace).toHaveBeenCalledWith(8888);
  });
});
