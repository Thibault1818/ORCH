import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerProviderCommand } from '../../../src/cli/commands/provider.js';
import { makeContainer } from './helpers.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe('provider commands', () => {
  it('rejects unavailable models without making a model call', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-provider-'));
    roots.push(root);
    const program = new Command();
    registerProviderCommand(program, makeContainer({ context: { projectRoot: root, json: true, quiet: false, noColor: false, ascii: false } }) as any);
    await expect(program.parseAsync(['provider', 'qualify', 'opencode', '--model', 'ollama/missing'], { from: 'user' })).rejects.toThrow('not available');
    await expect(fs.access(path.join(root, '.orchestry', 'providers'))).rejects.toThrow();
  });
});
