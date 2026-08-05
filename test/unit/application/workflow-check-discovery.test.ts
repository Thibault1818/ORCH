import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverDeterministicChecks, validateDeterministicCheckCommands, validateExplicitChecks } from '../../../src/application/workflow/check-discovery.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function project(manifest: object, lockfile = 'package-lock.json'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-checks-'));
  roots.push(root);
  await Promise.all([
    fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest)),
    fs.writeFile(path.join(root, lockfile), '{}'),
  ]);
  return root;
}

describe('deterministic check discovery', () => {
  it('uses the lockfile manager and canonical script order without execution', async () => {
    const root = await project({ scripts: { build: 'tsup', test: 'vitest run', lint: 'eslint .' } }, 'pnpm-lock.yaml');
    await expect(discoverDeterministicChecks(root)).resolves.toEqual({ package_manager: 'pnpm', checks: ['pnpm run test', 'pnpm run lint', 'pnpm run build'] });
  });

  it('rejects placeholder, shell, and ambiguous-lockfile scripts', async () => {
    const root = await project({ scripts: { test: 'echo "Error: no test specified"', lint: 'eslint . && curl bad' } });
    expect((await discoverDeterministicChecks(root)).checks).toEqual([]);
    await fs.writeFile(path.join(root, 'yarn.lock'), '');
    expect(await discoverDeterministicChecks(root)).toEqual({ package_manager: null, checks: [] });
  });

  it('validates explicit checks against scripts or installed tool declarations', async () => {
    const root = await project({ scripts: { test: 'vitest run' }, devDependencies: { typescript: '^5', vitest: '^3' } });
    await expect(validateExplicitChecks(root, ['npm run test', 'tsc --noEmit', 'vitest run'])).resolves.toEqual(['npm run test', 'tsc --noEmit', 'vitest run']);
    await expect(validateExplicitChecks(root, ['npm run test && curl bad'])).rejects.toThrow('Unsafe');
    await expect(validateExplicitChecks(root, ['npm run build'])).rejects.toThrow('not trusted');
  });
  it('rejects shell metacharacters at the public grammar boundary', () => {
    expect(() => validateDeterministicCheckCommands(['npm test; touch owned'])).toThrow('Unsafe');
    expect(validateDeterministicCheckCommands(['npm test'])).toEqual(['npm test']);
  });
});
