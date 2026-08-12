import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  run: vi.fn(async () => ({ ok: true, stdout: 'git version 2.0\n' })),
  resolveExecutable: vi.fn(async () => ({ path: '/bin/git', realpath: '/bin/git', sha256: '0'.repeat(64) })),
}));

vi.mock('../../../src/infrastructure/process/command-runner.js', () => ({
  CommandRunner: class { run = mocks.run; },
  resolveExecutable: mocks.resolveExecutable,
}));

import { registerSetupCommand } from '../../../src/cli/commands/setup.js';

let home: string; let originalHome: string | undefined;
beforeEach(async () => { vi.clearAllMocks(); home = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-setup-')); originalHome = process.env.HOME; process.env.HOME = home; });
afterEach(async () => { process.env.HOME = originalHome; await fs.rm(home, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('orch setup', () => {
  it('does not write configuration for status-only setup', async () => { const program = new Command(); registerSetupCommand(program); await program.parseAsync(['node', 'orch', 'setup']); await expect(fs.access(path.join(home, '.claude'))).rejects.toThrow(); });
  it('requires explicit confirmation before Claude integration', async () => { const program = new Command(); registerSetupCommand(program); await program.parseAsync(['node', 'orch', 'setup', 'claude-integration']); await expect(fs.access(path.join(home, '.claude'))).rejects.toThrow(); });
  it('checks the git version through CommandRunner', async () => { const program = new Command(); registerSetupCommand(program); await program.parseAsync(['node', 'orch', 'setup']); expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ args: ['--version'], timeoutMs: 5_000 })); });
});
