import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ICommandRunner } from '../process/command-runner.js';
import { resolveExecutable } from '../process/command-runner.js';
import { HardenedGit } from '../git/hardened-git.js';

export interface RecomputedGitEvidenceV3 { base_commit: string; commit: string; diff_hash: string; changed_paths: string[]; }

export class GitEvidenceVerifierV3 {
  private readonly git: Promise<HardenedGit>;
  constructor(private readonly projectRoot: string, runner: ICommandRunner) {
    if (!path.isAbsolute(projectRoot)) throw new Error('Git evidence project root must be absolute');
    this.git = (async () => new HardenedGit(runner, await resolveExecutable('git')))();
  }

  async recompute(baseCommit: string, commit: string): Promise<RecomputedGitEvidenceV3> {
    const git = await this.git;
    const [actualBase, actualCommit] = await Promise.all([
      git.run(this.projectRoot, ['rev-parse', '--verify', '--end-of-options', `${baseCommit}^{commit}`]),
      git.run(this.projectRoot, ['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`]),
    ]);
    if (actualBase.trim() !== baseCommit || actualCommit.trim() !== commit) throw new Error('Git evidence references a missing or ambiguous commit');
    await git.run(this.projectRoot, ['merge-base', '--is-ancestor', baseCommit, commit]);
    const [diff, names] = await Promise.all([
      git.run(this.projectRoot, ['diff', '--binary', '--full-index', '--no-color', '--no-renames', baseCommit, commit, '--'], { output: 'result' }),
      git.run(this.projectRoot, ['diff', '--name-only', '-z', '--no-renames', baseCommit, commit, '--'], { output: 'result' }),
    ]);
    if (!diff.ok || !names.ok || diff.stdoutTruncated || names.stdoutTruncated) throw new Error('Unable to recompute complete Git evidence');
    const changedPaths = parseNulPaths(names.stdoutBuffer);
    return { base_commit: baseCommit, commit, diff_hash: createHash('sha256').update(diff.stdoutBuffer).digest('hex'), changed_paths: changedPaths };
  }

  async assertAncestor(ancestor: string, descendant: string): Promise<void> {
    await (await this.git).run(this.projectRoot, ['merge-base', '--is-ancestor', ancestor, descendant]);
  }

  async assertPathComposition(candidate: string, integration: string, paths: readonly string[]): Promise<void> {
    const git = await this.git;
    for (const changedPath of paths) {
      const [candidateEntry, integrationEntry] = await Promise.all([
        git.run(this.projectRoot, ['ls-tree', '-z', candidate, '--', changedPath], { output: 'result' }),
        git.run(this.projectRoot, ['ls-tree', '-z', integration, '--', changedPath], { output: 'result' }),
      ]);
      if (!candidateEntry.ok || !integrationEntry.ok || !candidateEntry.stdoutBuffer.equals(integrationEntry.stdoutBuffer)) throw new Error(`Integration does not preserve candidate composition for path: ${changedPath}`);
    }
  }
}

export interface ProjectOperationLeaseV3 { token: string; assertOwned(): Promise<void>; release(): Promise<void>; }
export interface ProjectOperationLockV3 { acquire(owner: string): Promise<ProjectOperationLeaseV3>; }

export class FileProjectOperationLockV3 implements ProjectOperationLockV3 {
  private readonly lockPath: string;
  constructor(projectRoot: string) { this.lockPath = path.join(path.resolve(projectRoot), '.orchestry', 'governance', 'v3', '.project-operation.lock'); }

  async acquire(owner: string): Promise<ProjectOperationLeaseV3> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(owner)) throw new Error('Invalid project operation lock owner');
    await fs.mkdir(path.dirname(this.lockPath), { recursive: true, mode: 0o700 });
    const token = randomUUID();
    try { await fs.writeFile(this.lockPath, JSON.stringify({ owner, token, pid: process.pid }), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Governance project operation lock is active'); throw error; }
    const assertOwned = async () => {
      const stat = await fs.lstat(this.lockPath);
      if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)) throw new Error('Governance project operation lock is unsafe');
      const value = JSON.parse(await fs.readFile(this.lockPath, 'utf8')) as Record<string, unknown>;
      if (value.owner !== owner || value.token !== token || value.pid !== process.pid) throw new Error('Governance project operation lock ownership was lost');
    };
    return {
      token,
      assertOwned,
      release: async () => { await assertOwned(); await fs.unlink(this.lockPath); },
    };
  }
}

function parseNulPaths(output: Buffer): string[] {
  if (output.length === 0) return [];
  if (output[output.length - 1] !== 0) throw new Error('Git changed-path output is not NUL terminated');
  const paths: string[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index++) {
    if (output[index] !== 0) continue;
    const bytes = output.subarray(start, index);
    const value = bytes.toString('utf8');
    if (!bytes.length || !Buffer.from(value, 'utf8').equals(bytes)) throw new Error('Git changed-path output is invalid UTF-8');
    paths.push(value);
    start = index + 1;
  }
  return paths;
}
