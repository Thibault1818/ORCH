import { commandFailureMessage, verifyExecutable } from './chunk-OBMT332P.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

var DEFAULT_TIMEOUT_MS = 6e4;
var MAX_TIMEOUT_MS = 12e4;
var DEFAULT_STDOUT_BYTES = 4 * 1024 * 1024;
var MAX_STDOUT_BYTES = 16 * 1024 * 1024;
var DEFAULT_STDERR_BYTES = 256 * 1024;
var MAX_STDERR_BYTES = 1024 * 1024;
var MAX_ATTRIBUTE_FILES = 256;
var MAX_ATTRIBUTE_BYTES = 256 * 1024;
var MAX_WORKTREE_ENTRIES = 5e4;
var DIFF_COMMANDS = /* @__PURE__ */ new Set([
  "diff",
  "diff-files",
  "diff-index",
  "diff-tree",
  "log",
  "show",
  "format-patch",
  "range-diff",
  "whatchanged"
]);
var BASE_CONFIG = [
  "core.hooksPath=/dev/null",
  "core.fsmonitor=false",
  "core.attributesFile=/dev/null",
  "core.excludesFile=/dev/null",
  "credential.helper=",
  "protocol.allow=never",
  "protocol.http.allow=always",
  "protocol.https.allow=always",
  "protocol.git.allow=always",
  "protocol.ext.allow=never",
  "diff.external=/bin/false",
  "commit.gpgSign=false",
  "tag.gpgSign=false"
];
var HardenedGit = class {
  constructor(runner, git, options = {}) {
    this.runner = runner;
    this.git = git;
    if (!path.isAbsolute(git.path) || !path.isAbsolute(git.realpath)) throw new Error("Pinned Git executable must be absolute");
    this.configRoot = path.resolve(options.configRoot ?? path.join(os.tmpdir(), `orch-hardened-git-${randomUUID()}`));
    this.identity = options.identity ?? { name: "ORCH", email: "orch@localhost" };
    if (!this.identity.name || !this.identity.email || /[\0\r\n]/.test(this.identity.name) || /[\0\r\n]/.test(this.identity.email)) {
      throw new Error("Git identity name and email must be non-empty single-line values");
    }
    this.defaults = {
      timeoutMs: bounded(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, "timeoutMs"),
      maxStdoutBytes: bounded(options.maxStdoutBytes ?? DEFAULT_STDOUT_BYTES, MAX_STDOUT_BYTES, "maxStdoutBytes"),
      maxStderrBytes: bounded(options.maxStderrBytes ?? DEFAULT_STDERR_BYTES, MAX_STDERR_BYTES, "maxStderrBytes")
    };
  }
  runner;
  git;
  configRoot;
  identity;
  defaults;
  async run(cwd, args, options = {}) {
    if (!path.isAbsolute(cwd)) throw new Error("HardenedGit cwd must be absolute");
    const command = validateArgs(args);
    const limits = this.limits(options);
    await Promise.all([this.prepareConfigRoot(), this.verifyExecutable()]);
    if (command === "clone") {
      await this.preflightClone(cwd, args, options, limits);
      args = insertCloneNoCheckout(args);
    } else if (command === "checkout") {
      await this.rejectUnsafeCheckout(cwd, args, options, limits);
    }
    const result = await this.execute(cwd, args, options, limits);
    if (result.ok && command === "clone") {
      const destination = cloneDestination(cwd, args);
      await this.rejectAttributesInTree(destination, "HEAD", options, limits);
    }
    if (options.output === "result" || options.returnResult === true) return result;
    if (!result.ok) throw new Error(commandFailureMessage(result));
    return result.stdout;
  }
  limits(options) {
    const limits = {
      timeoutMs: bounded(options.timeoutMs ?? this.defaults.timeoutMs, MAX_TIMEOUT_MS, "timeoutMs"),
      maxStdoutBytes: bounded(options.maxStdoutBytes ?? this.defaults.maxStdoutBytes, MAX_STDOUT_BYTES, "maxStdoutBytes"),
      maxStderrBytes: bounded(options.maxStderrBytes ?? this.defaults.maxStderrBytes, MAX_STDERR_BYTES, "maxStderrBytes")
    };
    if (options.killGraceMs !== void 0) limits.killGraceMs = bounded(options.killGraceMs, 1e4, "killGraceMs");
    return limits;
  }
  async execute(cwd, args, options, limits) {
    const command = args[0];
    const hardenedArgs = [];
    for (const config of BASE_CONFIG) hardenedArgs.push("-c", config);
    hardenedArgs.push("-c", `protocol.file.allow=${options.fileProtocol ?? "user"}`);
    hardenedArgs.push("-c", `user.name=${this.identity.name}`, "-c", `user.email=${this.identity.email}`);
    hardenedArgs.push("-c", `alias.${command}=`);
    hardenedArgs.push(command);
    if (DIFF_COMMANDS.has(command)) hardenedArgs.push("--no-ext-diff", "--no-textconv");
    hardenedArgs.push(...args.slice(1));
    const request = {
      executable: this.git,
      args: hardenedArgs,
      cwd,
      env: this.environment(),
      timeoutMs: limits.timeoutMs,
      maxStdoutBytes: limits.maxStdoutBytes,
      maxStderrBytes: limits.maxStderrBytes
    };
    if (limits.killGraceMs !== void 0) request.killGraceMs = limits.killGraceMs;
    if (options.owner !== void 0) request.owner = options.owner;
    if (options.sandbox !== void 0) request.sandbox = options.sandbox;
    return this.runner.run(request);
  }
  environment() {
    const home = path.join(this.configRoot, "home");
    return {
      HOME: home,
      XDG_CONFIG_HOME: path.join(this.configRoot, "xdg-config"),
      XDG_CACHE_HOME: path.join(this.configRoot, "xdg-cache"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/false",
      GIT_EDITOR: "/bin/false",
      GIT_SEQUENCE_EDITOR: "/bin/false",
      GIT_MERGE_AUTOEDIT: "no",
      SSH_ASKPASS: "/bin/false",
      SSH_ASKPASS_REQUIRE: "never",
      GCM_INTERACTIVE: "Never",
      GIT_SSH: "/bin/false",
      GIT_SSH_COMMAND: "/bin/false",
      GIT_PAGER: "cat",
      PAGER: "cat",
      LANG: "C",
      LC_ALL: "C",
      GIT_AUTHOR_NAME: this.identity.name,
      GIT_AUTHOR_EMAIL: this.identity.email,
      GIT_COMMITTER_NAME: this.identity.name,
      GIT_COMMITTER_EMAIL: this.identity.email,
      EMAIL: this.identity.email
    };
  }
  async prepareConfigRoot() {
    await fs.mkdir(this.configRoot, { recursive: true, mode: 448 });
    const stat = await fs.lstat(this.configRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Hardened Git config root must be a real directory");
    if (process.platform !== "win32" && (stat.mode & 63) !== 0) throw new Error("Hardened Git config root must not be accessible by other users");
    if (process.getuid && stat.uid !== process.getuid()) throw new Error("Hardened Git config root must be owned by the current user");
    const directories = [
      fs.mkdir(path.join(this.configRoot, "home"), { recursive: true, mode: 448 }),
      fs.mkdir(path.join(this.configRoot, "xdg-config"), { recursive: true, mode: 448 }),
      fs.mkdir(path.join(this.configRoot, "xdg-cache"), { recursive: true, mode: 448 })
    ];
    await Promise.all(directories);
    for (const name of ["home", "xdg-config", "xdg-cache"]) {
      const child = await fs.lstat(path.join(this.configRoot, name));
      if (!child.isDirectory() || child.isSymbolicLink()) throw new Error(`Hardened Git ${name} must be a real directory`);
    }
  }
  async verifyExecutable() {
    await verifyExecutable(this.git);
  }
  async preflightClone(cwd, args, options, limits) {
    rejectCloneConfig(args);
    cloneDestination(cwd, args);
    const source = cloneOperands(args)[0];
    if (source.includes("://") || /^[^/]+@[^:]+:/.test(source)) return;
    const localSource = path.resolve(cwd, source);
    let stat;
    try {
      stat = await fs.stat(localSource);
    } catch {
      return;
    }
    if (!stat.isDirectory()) return;
    await this.rejectAttributesInTree(localSource, "HEAD", options, limits);
  }
  async rejectUnsafeCheckout(cwd, args, options, limits) {
    await this.rejectAttributesOnDisk(cwd);
    await this.rejectAttributesInIndex(cwd, options, limits);
    const candidate = checkoutCandidate(args);
    if (!candidate) return;
    const probe = await this.execute(cwd, ["rev-parse", "--verify", `${candidate}^{tree}`], options, limits);
    if (probe.ok) {
      await this.rejectAttributesInTree(cwd, candidate, options, limits);
      return;
    }
    const remoteRefs = await this.execute(
      cwd,
      ["for-each-ref", "--format=%(refname)", `refs/remotes/*/${candidate}`],
      options,
      limits
    );
    if (!remoteRefs.ok) throw new Error(`Cannot inspect checkout target: ${commandFailureMessage(remoteRefs)}`);
    for (const ref of remoteRefs.stdout.split("\n").filter(Boolean)) await this.rejectAttributesInTree(cwd, ref, options, limits);
  }
  async rejectAttributesInTree(cwd, tree, options, limits) {
    const listing = await this.execute(cwd, ["ls-tree", "-rz", "--full-tree", tree], options, limits);
    if (!listing.ok) throw new Error(`Cannot inspect repository attributes: ${commandFailureMessage(listing)}`);
    const entries = listing.stdout.split("\0").filter((entry) => isAttributesEntry(entry));
    if (entries.length > MAX_ATTRIBUTE_FILES) throw new Error("Repository contains too many .gitattributes files to inspect safely");
    for (const entry of entries) {
      const match = /^[0-7]+\s+blob\s+([0-9a-f]+)\t(.+)$/i.exec(entry);
      if (!match) throw new Error("Unexpected git ls-tree output while inspecting .gitattributes");
      const blob = await this.execute(cwd, ["cat-file", "blob", match[1]], options, {
        ...limits,
        maxStdoutBytes: Math.min(limits.maxStdoutBytes, MAX_ATTRIBUTE_BYTES)
      });
      if (!blob.ok) throw new Error(`Cannot inspect ${match[2]}: ${commandFailureMessage(blob)}`);
      rejectFilterAttributes(blob.stdout, match[2]);
    }
  }
  async rejectAttributesInIndex(cwd, options, limits) {
    const listing = await this.execute(cwd, ["ls-files", "-s", "-z"], options, limits);
    if (!listing.ok) throw new Error(`Cannot inspect indexed attributes: ${commandFailureMessage(listing)}`);
    const entries = listing.stdout.split("\0").filter((entry) => isAttributesEntry(entry));
    if (entries.length > MAX_ATTRIBUTE_FILES) throw new Error("Repository contains too many indexed .gitattributes files to inspect safely");
    for (const entry of entries) {
      const match = /^[0-7]+\s+([0-9a-f]+)\s+\d\t(.+)$/i.exec(entry);
      if (!match) throw new Error("Unexpected git ls-files output while inspecting .gitattributes");
      const blob = await this.execute(cwd, ["cat-file", "blob", match[1]], options, {
        ...limits,
        maxStdoutBytes: Math.min(limits.maxStdoutBytes, MAX_ATTRIBUTE_BYTES)
      });
      if (!blob.ok) throw new Error(`Cannot inspect ${match[2]}: ${commandFailureMessage(blob)}`);
      rejectFilterAttributes(blob.stdout, match[2]);
    }
  }
  async rejectAttributesOnDisk(root) {
    const pending = [root];
    let entries = 0;
    while (pending.length > 0) {
      const directory = pending.pop();
      let children;
      try {
        children = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        throw new Error(`Cannot inspect worktree directory for .gitattributes: ${directory}`);
      }
      for (const child of children) {
        if (++entries > MAX_WORKTREE_ENTRIES) throw new Error("Worktree is too large to inspect .gitattributes safely");
        if (child.name === ".git") continue;
        const childPath = path.join(directory, child.name);
        if (child.isDirectory()) pending.push(childPath);
        if (child.name !== ".gitattributes") continue;
        if (!child.isFile()) throw new Error(`Unsafe non-file .gitattributes: ${childPath}`);
        const stat = await fs.stat(childPath);
        if (stat.size > MAX_ATTRIBUTE_BYTES) throw new Error(`.gitattributes exceeds safety limit: ${childPath}`);
        rejectFilterAttributes(await fs.readFile(childPath, "utf8"), childPath);
      }
    }
  }
};
function validateArgs(args) {
  if (args.length === 0 || !args[0] || !/^[a-z][a-z0-9-]*$/.test(args[0])) throw new Error("Git arguments must begin with a valid subcommand");
  if (args.some((arg) => arg.includes("\0"))) throw new Error("Git arguments cannot contain NUL bytes");
  if (args.some((arg) => arg === "--config-env" || arg.startsWith("--config-env="))) {
    throw new Error("Caller-supplied Git config is not allowed");
  }
  if (args.some((arg) => arg === "--ext-diff" || arg === "--textconv")) {
    throw new Error("External diff and textconv are not allowed");
  }
  return args[0];
}
function rejectCloneConfig(args) {
  if (args.slice(1).some((arg) => arg === "-c" || /^-c.+/.test(arg) || arg === "--config" || arg.startsWith("--config="))) {
    throw new Error("git clone config overrides are not allowed");
  }
  if (args.slice(1).some((arg) => arg === "-u" || /^-u.+/.test(arg) || arg === "--upload-pack" || arg.startsWith("--upload-pack="))) {
    throw new Error("Custom git clone upload-pack is not allowed");
  }
  if (args.slice(1).some((arg) => arg === "--template" || arg.startsWith("--template=") || arg === "--separate-git-dir" || arg.startsWith("--separate-git-dir="))) {
    throw new Error("Custom clone templates and separate Git directories are not allowed");
  }
  if (args.slice(1).some((arg) => arg === "--recurse-submodules" || arg.startsWith("--recurse-submodules=") || arg === "--recursive" || arg === "--remote-submodules")) {
    throw new Error("Clone submodule checkout is not allowed");
  }
}
function insertCloneNoCheckout(args) {
  if (args.includes("--no-checkout") || args.includes("-n") || args.includes("--bare") || args.includes("--mirror")) return [...args];
  return [args[0], "--no-checkout", ...args.slice(1)];
}
function cloneDestination(cwd, args) {
  const operands = cloneOperands(args);
  if (operands.length !== 2) throw new Error("Hardened git clone requires an explicit destination directory");
  return path.resolve(cwd, operands[1]);
}
function cloneOperands(args) {
  const optionsWithValues = /* @__PURE__ */ new Set([
    "-b",
    "--branch",
    "-o",
    "--origin",
    "-u",
    "--upload-pack",
    "--depth",
    "--shallow-since",
    "--shallow-exclude",
    "--reference",
    "--reference-if-able",
    "--separate-git-dir",
    "-j",
    "--jobs",
    "--server-option",
    "--filter",
    "--bundle-uri",
    "--template",
    "--ref-format"
  ]);
  const operands = [];
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (optionsWithValues.has(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    operands.push(arg);
  }
  return operands;
}
function checkoutCandidate(args) {
  const branchOptions = /* @__PURE__ */ new Set(["-b", "-B", "--orphan"]);
  const optionsWithValues = /* @__PURE__ */ new Set(["--conflict", "--pathspec-from-file"]);
  let createsBranch = false;
  const operands = [];
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") break;
    if (branchOptions.has(arg)) {
      createsBranch = true;
      index++;
      continue;
    }
    if (optionsWithValues.has(arg)) {
      index++;
      continue;
    }
    if (!arg.startsWith("-")) operands.push(arg);
  }
  if (createsBranch) return operands[0] ?? "HEAD";
  return operands[0];
}
function rejectFilterAttributes(content, source) {
  if (content.includes("\0")) throw new Error(`NUL byte in ${source}`);
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/(?:^|[\t ])(?:filter(?:=[^\t ]+)?|-filter|!filter)(?=$|[\t ])/u.test(line)) {
      throw new Error(`Unsafe filter driver attribute in ${source}`);
    }
  }
}
function isAttributesEntry(entry) {
  const separator = entry.indexOf("	");
  if (separator < 0) return false;
  const entryPath = entry.slice(separator + 1);
  return entryPath === ".gitattributes" || entryPath.endsWith("/.gitattributes");
}
function bounded(value, maximum, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

export { HardenedGit };
//# sourceMappingURL=chunk-47ZZP7VU.js.map
//# sourceMappingURL=chunk-47ZZP7VU.js.map