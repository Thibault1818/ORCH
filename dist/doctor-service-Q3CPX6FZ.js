import fs from 'fs/promises';
import path from 'path';

// src/application/doctor-service.ts
var COMMAND_TIMEOUT_MS = 1e4;
var MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
var DoctorService = class {
  constructor(adapterRegistry, commandRunner, executables, projectRoot) {
    this.adapterRegistry = adapterRegistry;
    this.commandRunner = commandRunner;
    this.executables = executables;
    this.cwd = path.resolve(projectRoot ?? process.cwd());
    for (const executable of Object.values(executables)) {
      if (executable) validateDescriptor(executable);
    }
  }
  adapterRegistry;
  commandRunner;
  executables;
  cwd;
  async runAll() {
    const checks = [];
    const adapters = this.adapterRegistry.list();
    let adaptersReady = 0;
    for (const adapter of adapters) {
      const result = await adapter.test();
      if (result.ok) {
        adaptersReady++;
        checks.push({
          name: adapter.kind,
          status: "ok",
          detail: result.version
        });
      } else {
        checks.push({
          name: adapter.kind,
          status: "fail",
          detail: result.error
        });
      }
    }
    checks.push(await this.checkCommand(this.executables.git, ["--version"], "git", "git"));
    checks.push(await this.checkGitRepo());
    checks.push(await this.checkGitignore());
    checks.push(await this.checkCommand(this.executables.node, ["--version"], "node", "node"));
    return {
      checks,
      adaptersReady,
      adaptersTotal: adapters.length
    };
  }
  async checkCommand(executable, args, name, commandName) {
    if (!executable) return { name, status: "fail", detail: `${commandName}: command not found` };
    try {
      const result = await this.commandRunner.run({
        executable,
        args,
        env: doctorEnvironment(executable),
        timeoutMs: COMMAND_TIMEOUT_MS,
        maxStdoutBytes: MAX_COMMAND_OUTPUT_BYTES,
        maxStderrBytes: MAX_COMMAND_OUTPUT_BYTES
      });
      if (!result.ok) return { name, status: "fail", detail: `${commandName}: command not found` };
      return { name, status: "ok", detail: result.stdout.trim() };
    } catch {
      return { name, status: "fail", detail: `${commandName}: command not found` };
    }
  }
  async checkGitignore() {
    const gitignorePath = path.join(this.cwd, ".gitignore");
    try {
      const content = await fs.readFile(gitignorePath, "utf-8");
      const hasEntry = content.split("\n").some((line) => line.trim() === ".orchestry");
      if (hasEntry) {
        return { name: ".gitignore", status: "ok", detail: ".orchestry is excluded" };
      }
      return {
        name: ".gitignore",
        status: "fail",
        detail: ".orchestry not in .gitignore \u2014 worktrees will copy state recursively. Run: orch init"
      };
    } catch {
      return {
        name: ".gitignore",
        status: "fail",
        detail: "no .gitignore found \u2014 .orchestry may be committed to git. Run: orch init"
      };
    }
  }
  async checkGitRepo() {
    const git = this.executables.git;
    if (!git) return this.gitRepoFailure();
    try {
      const result = await this.commandRunner.run({
        executable: git,
        args: ["rev-parse", "--is-inside-work-tree"],
        cwd: this.cwd,
        env: doctorEnvironment(git),
        timeoutMs: COMMAND_TIMEOUT_MS,
        maxStdoutBytes: MAX_COMMAND_OUTPUT_BYTES,
        maxStderrBytes: MAX_COMMAND_OUTPUT_BYTES
      });
      if (!result.ok) return this.gitRepoFailure();
      return { name: "git repo", status: "ok", detail: "git repository detected" };
    } catch {
      return this.gitRepoFailure();
    }
  }
  gitRepoFailure() {
    return {
      name: "git repo",
      status: "fail",
      detail: "not a git repository \u2014 worktree/isolated modes will fail. Run: git init"
    };
  }
};
function doctorEnvironment(executable) {
  return {
    PATH: [.../* @__PURE__ */ new Set([path.dirname(executable.path), path.dirname(executable.realpath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(path.delimiter),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    NO_COLOR: "1"
  };
}
function validateDescriptor(value) {
  if (!path.isAbsolute(value.path) || !path.isAbsolute(value.realpath) || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error("DoctorService requires absolute pinned executable descriptors");
  }
}

export { DoctorService };
//# sourceMappingURL=doctor-service-Q3CPX6FZ.js.map
//# sourceMappingURL=doctor-service-Q3CPX6FZ.js.map