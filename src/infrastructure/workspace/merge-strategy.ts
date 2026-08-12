import path from 'node:path';
import os from 'node:os';
import type { ICommandRunner } from '../process/command-runner.js';
import { CommandRunner, resolveExecutable } from '../process/command-runner.js';
import type { IProcessManager } from '../process/process-manager.js';
import { HardenedGit } from '../git/hardened-git.js';

export type MergeResult =
  | { success: true }
  | { success: false; conflictInfo: string };

export class MergeStrategy {
  private readonly runner: ICommandRunner;
  private readonly git: Promise<HardenedGit>;

  constructor(
    private readonly projectRoot: string,
    runner: ICommandRunner | IProcessManager,
  ) {
    const commandRunner = 'run' in runner ? runner : new CommandRunner(runner);
    this.runner = commandRunner;
    this.git = (async () => new HardenedGit(
      commandRunner,
      commandRunner.resolveExecutable ? await commandRunner.resolveExecutable('git') : await resolveExecutable('git'),
      { configRoot: path.join(os.tmpdir(), 'orch-merge-git') },
    ))();
  }

  async mergeBack(branch: string): Promise<MergeResult> {
    const git = await this.git;
    const result = await git.run(
      this.projectRoot,
      ['merge', '--no-ff', branch, '-m', `Merge ${branch}`],
      { output: 'result' },
    );
    if (result.ok) return { success: true };
    const output = `${result.stdout}${result.stderr}`.slice(0, 1000);
    if (output.includes('CONFLICT') || output.includes('Merge conflict'))
      await git.run(this.projectRoot, ['merge', '--abort'], { output: 'result' });
    return { success: false, conflictInfo: output };
  }
}
