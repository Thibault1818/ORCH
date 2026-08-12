/**
 * Path resolution for .orchestry/ directory.
 *
 * All path construction goes through this module.
 * Validates initialization state and sanitizes identifiers.
 */

import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { accessSync } from 'node:fs';
import fs from 'node:fs/promises';
import { NotInitializedError } from '../../domain/errors.js';
import { pathExists } from './fs-utils.js';

export const ORCHESTRY_DIR = '.orchestry';
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export class Paths {
  constructor(
    private readonly projectRoot: string,
    private readonly stateRoot = path.join(projectRoot, ORCHESTRY_DIR),
    private readonly externalWorkspaceRoot = path.join(stateRoot, 'workspaces'),
  ) {}

  /** Root .orchestry/ directory */
  get root(): string {
    return this.stateRoot;
  }

  get projectConfigRoot(): string {
    return path.join(this.projectRoot, ORCHESTRY_DIR);
  }

  get workspacesRoot(): string {
    return this.externalWorkspaceRoot;
  }

  get configPath(): string {
    return path.join(this.projectConfigRoot, 'config.yml');
  }

  get statePath(): string {
    return path.join(this.root, 'state.json');
  }

  get lockPath(): string {
    return path.join(this.root, 'orchestry.lock');
  }

  get processRegistryPath(): string {
    return path.join(this.root, 'process-groups.json');
  }

  get tasksDir(): string {
    return path.join(this.root, 'tasks');
  }

  get agentsDir(): string {
    return path.join(this.root, 'agents');
  }

  get runsDir(): string {
    return path.join(this.root, 'runs');
  }

  get templatesDir(): string {
    return path.join(this.root, 'templates');
  }

  get logsDir(): string {
    return path.join(this.root, 'logs');
  }

  get contextDir(): string {
    return path.join(this.root, 'context');
  }

  contextPath(key: string): string {
    return path.join(this.contextDir, `${sanitizeId(key)}.json`);
  }

  get messagesDir(): string {
    return path.join(this.root, 'messages');
  }

  messagePath(id: string): string {
    return path.join(this.messagesDir, `${sanitizeId(id)}.json`);
  }

  get goalsDir(): string {
    return path.join(this.root, 'goals');
  }

  goalPath(id: string): string {
    return path.join(this.goalsDir, `${sanitizeId(id)}.yml`);
  }

  get teamsDir(): string {
    return path.join(this.root, 'teams');
  }

  get attachmentsDir(): string {
    return path.join(this.root, 'attachments');
  }

  taskAttachmentsDir(taskId: string): string {
    return path.join(this.attachmentsDir, sanitizeId(taskId));
  }

  teamPath(id: string): string {
    return path.join(this.teamsDir, `${sanitizeId(id)}.yml`);
  }

  get gitignorePath(): string {
    return path.join(this.projectConfigRoot, '.gitignore');
  }

  get workspaceExcludePath(): string {
    return path.join(this.projectConfigRoot, 'workspace-exclude');
  }

  taskPath(id: string): string {
    return path.join(this.tasksDir, `${sanitizeId(id)}.yml`);
  }

  agentPath(id: string): string {
    return path.join(this.agentsDir, `${sanitizeId(id)}.yml`);
  }

  runPath(id: string): string {
    return path.join(this.runsDir, `${sanitizeId(id)}.json`);
  }

  runEventsPath(id: string): string {
    return path.join(this.runsDir, `${sanitizeId(id)}.jsonl`);
  }

  defaultTemplatePath(): string {
    return path.join(this.templatesDir, 'default.md');
  }

  async isInitialized(): Promise<boolean> {
    return pathExists(this.root);
  }

  async requireInit(): Promise<void> {
    if (!(await this.isInitialized())) {
      throw new NotInitializedError();
    }
    await this.validateStateRoot();
  }

  async validateStateRoot(): Promise<void> {
    const expected = path.resolve(this.root);
    const stat = await fs.lstat(expected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe .orchestry directory: ${expected}`);
    }
    const realRoot = await fs.realpath(expected);
    const project = await fs.realpath(this.projectRoot);
    const workspace = path.resolve(this.externalWorkspaceRoot);
    if (path.resolve(this.stateRoot) !== path.resolve(this.projectConfigRoot) && (contains(project, realRoot) || contains(realRoot, project)))
      throw new Error(`Unsafe ORCH state directory location: ${expected}`);
    if (path.resolve(this.stateRoot) !== path.resolve(this.projectConfigRoot) && (contains(workspace, realRoot) || contains(realRoot, workspace)))
      throw new Error('ORCH state and workspace roots must be separate');
    await fs.chmod(expected, 0o700).catch(() => {});
  }
}

export function externalOrchestryRoots(projectRoot: string, home = os.homedir()): { stateRoot: string; workspaceRoot: string } {
  const id = createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 24);
  const base = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'orchestry')
    : path.join(home, '.local', 'state', 'orchestry');
  return {
    stateRoot: path.join(base, 'state', id),
    workspaceRoot: path.join(base, 'workspaces', id),
  };
}

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Validate an identifier for use in file paths.
 * Only allows [A-Za-z0-9._-] characters.
 * Rejects identifiers containing forbidden characters (path separators, etc.)
 * to prevent path traversal attacks.
 */
export function sanitizeId(id: string): string {
  if (id === '.' || id === '..') {
    throw new Error(`Invalid identifier: "${id}"`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid identifier: "${id}"`);
  }
  return id;
}

/**
 * Validate that a workspace path is within the project root.
 * Prevents path traversal attacks.
 */
export function validateWorkspacePath(workspacePath: string, projectRoot: string): void {
  const resolved = path.resolve(workspacePath);
  const root = path.resolve(projectRoot);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Workspace path "${workspacePath}" is outside project root`);
  }
}

/**
 * Module-level cache for findProjectRoot().
 * Key: resolved startDir, Value: found project root.
 * Avoids repeated accessSync() traversals on every CLI invocation.
 */
const projectRootCache = new Map<string, string>();

/**
 * Resolve project root by walking up from cwd looking for .orchestry/.
 * Returns cwd if not found (for init command).
 *
 * Results are cached per startDir to avoid redundant filesystem traversals.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  const resolvedStart = path.resolve(startDir);
  const cached = projectRootCache.get(resolvedStart);
  if (cached !== undefined) return cached;

  let dir = resolvedStart;
  const root = path.parse(dir).root;

  while (dir !== root) {
    try {
      accessSync(path.join(dir, '.orchestry'));
      projectRootCache.set(resolvedStart, dir);
      return dir;
    } catch {
      // Not found, go up
    }
    dir = path.dirname(dir);
  }

  // Not found — return resolved dir (for init command)
  projectRootCache.set(resolvedStart, resolvedStart);
  return resolvedStart;
}

/**
 * Clear the findProjectRoot cache.
 * Useful in tests or after `orch init` changes the project structure.
 */
export function clearProjectRootCache(): void {
  projectRootCache.clear();
}
