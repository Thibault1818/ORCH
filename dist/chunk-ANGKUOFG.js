import { NotInitializedError } from './chunk-Z7JNYNWE.js';
import { pathExists } from './chunk-54K3JU53.js';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { accessSync } from 'fs';
import fs from 'fs/promises';

var ORCHESTRY_DIR = ".orchestry";
var ID_PATTERN = /^[A-Za-z0-9._-]+$/;
var Paths = class {
  constructor(projectRoot, stateRoot = path.join(projectRoot, ORCHESTRY_DIR), externalWorkspaceRoot = path.join(stateRoot, "workspaces")) {
    this.projectRoot = projectRoot;
    this.stateRoot = stateRoot;
    this.externalWorkspaceRoot = externalWorkspaceRoot;
  }
  projectRoot;
  stateRoot;
  externalWorkspaceRoot;
  /** Root .orchestry/ directory */
  get root() {
    return this.stateRoot;
  }
  get projectConfigRoot() {
    return path.join(this.projectRoot, ORCHESTRY_DIR);
  }
  get workspacesRoot() {
    return this.externalWorkspaceRoot;
  }
  get configPath() {
    return path.join(this.projectConfigRoot, "config.yml");
  }
  get statePath() {
    return path.join(this.root, "state.json");
  }
  get lockPath() {
    return path.join(this.root, "orchestry.lock");
  }
  get processRegistryPath() {
    return path.join(this.root, "process-groups.json");
  }
  get tasksDir() {
    return path.join(this.root, "tasks");
  }
  get agentsDir() {
    return path.join(this.root, "agents");
  }
  get runsDir() {
    return path.join(this.root, "runs");
  }
  get templatesDir() {
    return path.join(this.root, "templates");
  }
  get logsDir() {
    return path.join(this.root, "logs");
  }
  get contextDir() {
    return path.join(this.root, "context");
  }
  contextPath(key) {
    return path.join(this.contextDir, `${sanitizeId(key)}.json`);
  }
  get messagesDir() {
    return path.join(this.root, "messages");
  }
  messagePath(id) {
    return path.join(this.messagesDir, `${sanitizeId(id)}.json`);
  }
  get goalsDir() {
    return path.join(this.root, "goals");
  }
  goalPath(id) {
    return path.join(this.goalsDir, `${sanitizeId(id)}.yml`);
  }
  get teamsDir() {
    return path.join(this.root, "teams");
  }
  get attachmentsDir() {
    return path.join(this.root, "attachments");
  }
  taskAttachmentsDir(taskId) {
    return path.join(this.attachmentsDir, sanitizeId(taskId));
  }
  teamPath(id) {
    return path.join(this.teamsDir, `${sanitizeId(id)}.yml`);
  }
  get gitignorePath() {
    return path.join(this.projectConfigRoot, ".gitignore");
  }
  get workspaceExcludePath() {
    return path.join(this.projectConfigRoot, "workspace-exclude");
  }
  taskPath(id) {
    return path.join(this.tasksDir, `${sanitizeId(id)}.yml`);
  }
  agentPath(id) {
    return path.join(this.agentsDir, `${sanitizeId(id)}.yml`);
  }
  runPath(id) {
    return path.join(this.runsDir, `${sanitizeId(id)}.json`);
  }
  runEventsPath(id) {
    return path.join(this.runsDir, `${sanitizeId(id)}.jsonl`);
  }
  defaultTemplatePath() {
    return path.join(this.templatesDir, "default.md");
  }
  async isInitialized() {
    return pathExists(this.root);
  }
  async requireInit() {
    if (!await this.isInitialized()) {
      throw new NotInitializedError();
    }
    await this.validateStateRoot();
  }
  async validateStateRoot() {
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
      throw new Error("ORCH state and workspace roots must be separate");
    await fs.chmod(expected, 448).catch(() => {
    });
  }
};
function externalOrchestryRoots(projectRoot, home = os.homedir()) {
  const id = createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 24);
  const base = process.platform === "darwin" ? path.join(home, "Library", "Application Support", "orchestry") : path.join(home, ".local", "state", "orchestry");
  return {
    stateRoot: path.join(base, "state", id),
    workspaceRoot: path.join(base, "workspaces", id)
  };
}
function contains(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
function sanitizeId(id) {
  if (id === "." || id === "..") {
    throw new Error(`Invalid identifier: "${id}"`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid identifier: "${id}"`);
  }
  return id;
}
function validateWorkspacePath(workspacePath, projectRoot) {
  const resolved = path.resolve(workspacePath);
  const root = path.resolve(projectRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Workspace path "${workspacePath}" is outside project root`);
  }
}
var projectRootCache = /* @__PURE__ */ new Map();
function findProjectRoot(startDir = process.cwd()) {
  const resolvedStart = path.resolve(startDir);
  const cached = projectRootCache.get(resolvedStart);
  if (cached !== void 0) return cached;
  let dir = resolvedStart;
  const root = path.parse(dir).root;
  while (dir !== root) {
    try {
      accessSync(path.join(dir, ".orchestry"));
      projectRootCache.set(resolvedStart, dir);
      return dir;
    } catch {
    }
    dir = path.dirname(dir);
  }
  projectRootCache.set(resolvedStart, resolvedStart);
  return resolvedStart;
}
function clearProjectRootCache() {
  projectRootCache.clear();
}

export { ORCHESTRY_DIR, Paths, clearProjectRootCache, externalOrchestryRoots, findProjectRoot, sanitizeId, validateWorkspacePath };
//# sourceMappingURL=chunk-ANGKUOFG.js.map
//# sourceMappingURL=chunk-ANGKUOFG.js.map