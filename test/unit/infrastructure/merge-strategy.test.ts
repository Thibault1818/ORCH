import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MergeStrategy } from '../../../src/infrastructure/workspace/merge-strategy.js';
import { CommandRunner } from '../../../src/infrastructure/process/command-runner.js';
import { ProcessManager } from '../../../src/infrastructure/process/process-manager.js';

const exec = promisify(execFile);

describe('MergeStrategy hardened command path', () => {
  it('merges a branch with hooks and ambient config disabled', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-merge-'));
    try {
      await exec('git', ['init', '-b', 'main'], { cwd: root });
      await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
      await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
      await fs.writeFile(path.join(root, 'file'), 'base');
      await exec('git', ['add', '.'], { cwd: root });
      await exec('git', ['commit', '-m', 'base'], { cwd: root });
      await exec('git', ['switch', '-c', 'feature'], { cwd: root });
      await fs.writeFile(path.join(root, 'file'), 'feature');
      await exec('git', ['commit', '-am', 'feature'], { cwd: root });
      await exec('git', ['switch', 'main'], { cwd: root });
      const strategy = new MergeStrategy(root, new CommandRunner(new ProcessManager()));
      await expect(strategy.mergeBack('feature')).resolves.toEqual({ success: true });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
