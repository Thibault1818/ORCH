import fs2 from 'fs/promises';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { realpathSync, createReadStream, accessSync, statSync, openSync, readSync, closeSync } from 'fs';
import path2 from 'path';
import net from 'net';

// src/infrastructure/process/command-runner.ts
var SYSTEM_READ_PATHS = ["/System", "/Library/Apple", "/usr/lib", "/usr/share", "/dev", "/private/etc/ssl"];
function macosSandboxPolicy() {
  return {
    version: 1,
    default: "deny",
    system_read_subpaths: [...SYSTEM_READ_PATHS].sort(),
    executable_read_rule: "literal",
    runtime_library_read_rule: "mach-o-dependency-directories",
    executable_exec_rule: "literal",
    workspace_read_rule: "subpath",
    workspace_write_rule: "explicit",
    network_rule: "deny-except-loopback-proxy",
    signal_rule: "self"
  };
}
function generateMacosSandboxProfile(request, workspace = path2.resolve(request.workspace), executablePaths = []) {
  const proxy = validateProxyAddress(request.proxyAddress);
  const executableFiles = new Set(uniquePaths(executablePaths));
  const literalReadFiles = new Set(uniquePaths([...executableFiles, ...request.readOnlyFiles ?? []]));
  const readSubpaths = uniquePaths([workspace, ...SYSTEM_READ_PATHS, ...request.readOnlyPaths ?? []]).filter((value) => !executableFiles.has(value)).map((value) => `  (subpath ${sandboxString(value)})`).join("\n");
  const readFiles = [...literalReadFiles].map((value) => `  (literal ${sandboxString(value)})`).join("\n");
  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(deny network*)",
    "(allow process-fork)",
    "(allow process-info*)",
    ...request.allowedExecutablePaths?.length ? ["(allow process-exec", ...uniquePaths(request.allowedExecutablePaths).map((value) => `  (literal ${sandboxString(value)})`), ")"] : ['(allow process-exec (literal "/usr/bin/false"))'],
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read*",
    readSubpaths,
    readFiles,
    ")",
    ...request.writableWorkspace === false ? [] : [`(allow file-write* (subpath ${sandboxString(workspace)}))`],
    ...(request.writablePaths ?? []).map((value) => `(allow file-write* (subpath ${sandboxString(value)}))`),
    '(allow file-write-data (literal "/dev/null"))',
    `(allow network-outbound (remote tcp ${sandboxString(`localhost:${proxy.port}`)}))`
  ].join("\n");
}
async function prepareMacosSandbox(request, executablePaths = []) {
  if (process.platform !== "darwin") throw new Error("macOS sandboxing requires darwin");
  const workspace = await fs2.realpath(path2.resolve(request.workspace));
  if (!(await fs2.stat(workspace)).isDirectory()) throw new Error(`Sandbox workspace is not a directory: ${workspace}`);
  const proxyAddress = validateProxyAddress(request.proxyAddress);
  const executable = await describeExecutable(request.sandboxExecutable ?? "/usr/bin/sandbox-exec");
  return {
    executable,
    profile: generateMacosSandboxProfile({ ...request, proxyAddress }, workspace, executablePaths),
    workspace,
    proxyAddress
  };
}
async function describeExecutable(value) {
  const requestedPath = path2.resolve(value);
  await fs2.access(requestedPath, 1);
  const realpath = await fs2.realpath(requestedPath);
  const stat = await fs2.stat(realpath);
  if (!stat.isFile()) throw new Error(`Sandbox executable is not a file: ${requestedPath}`);
  return { path: requestedPath, realpath, sha256: await sha256(realpath) };
}
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function validateProxyAddress(value) {
  const host = stripIpv6Brackets(value.host).toLowerCase();
  if (!isLoopback(host)) throw new Error("Sandbox proxy must use a numeric loopback address");
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error("Sandbox proxy port is invalid");
  return { host, port: value.port };
}
function isLoopback(host) {
  if (net.isIP(host) === 4) return host.startsWith("127.");
  return net.isIP(host) === 6 && (host === "::1" || host.toLowerCase() === "0:0:0:0:0:0:0:1");
}
function stripIpv6Brackets(value) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}
function sandboxString(value) {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) throw new Error("Sandbox value contains invalid characters");
  return JSON.stringify(value).replace(/\\u2028|\\u2029/g, "");
}
function uniquePaths(values) {
  return [...new Set(values.map((value) => path2.resolve(value)))].sort();
}

// src/infrastructure/process/command-runner.ts
var CommandRunner = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  processManager;
  resolveExecutable(command, pathValue) {
    return resolveExecutable(command, pathValue);
  }
  start(request) {
    validateStreamingRequest(request);
    const args = [...request.args ?? []];
    const descriptor = streamingRequestDescriptor(request);
    const owner = optionalOwner(request.owner, "owner");
    const ownerTag = optionalOwner(request.ownerTag, "ownerTag");
    const sandboxRequest = optionalSandbox(request.sandbox ?? request.macosSandbox);
    const allowedExecutables = uniqueDescriptors([descriptor, ...request.allowedExecutables ?? []]);
    const effectiveSandbox = sandboxRequest ? {
      ...sandboxRequest,
      readOnlyPaths: [...explicitReadSubpaths(sandboxRequest.readOnlyPaths ?? [], allowedExecutables), ...macosRuntimeReadSubpaths(allowedExecutables)],
      readOnlyFiles: [...sandboxRequest.readOnlyFiles ?? [], ...macosRuntimeReadFiles(allowedExecutables)],
      allowedExecutablePaths: allowedExecutables.map((value) => value.realpath)
    } : null;
    const sandbox = effectiveSandbox ? prepareMacosSandboxSync(effectiveSandbox, allowedExecutables.map((value) => value.realpath)) : null;
    const sandboxCwd = sandbox && request.cwd ? realpathSync(path2.resolve(request.cwd)) : null;
    if (sandbox && sandboxCwd && !isWithin(sandboxCwd, sandbox.workspace)) throw new Error("Sandboxed cwd must be within the workspace");
    const spawnExecutable = sandbox?.executable.realpath ?? descriptor.realpath;
    const spawnArgs = sandbox ? ["-p", sandbox.profile, descriptor.realpath, ...args] : args;
    const spawnEnv = sandbox ? sandboxEnvironment(request.env, sandbox) : { ...request.env ?? {} };
    for (const executable of allowedExecutables) verifyExecutableSync(executable);
    if (sandbox) verifyExecutableSync(sandbox.executable);
    const spawned = this.processManager.spawn(spawnExecutable, spawnArgs, {
      cwd: sandboxCwd ?? request.cwd ?? sandbox?.workspace,
      env: spawnEnv,
      stdio: [request.stdin === void 0 && !request.keepStdinOpen ? "ignore" : "pipe", "pipe", "pipe"],
      owner,
      ownerTag
    });
    const child = spawned.process;
    let termination = "exited";
    let cleanup = null;
    const stop = (reason) => {
      if (termination !== "exited") return;
      termination = reason;
      cleanup = this.processManager.killWithGrace(spawned.pid, request.killGraceMs ?? 1e3);
    };
    const onAbort = () => stop("timed_out");
    if (request.signal) {
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = request.timeoutMs === void 0 ? null : setTimeout(() => stop("timed_out"), request.timeoutMs);
    if (request.stdin !== void 0) {
      if (request.keepStdinOpen) child.stdin?.write(request.stdin);
      else child.stdin?.end(request.stdin);
    }
    const completion = new Promise((resolve) => {
      let settled = false;
      const finish = async (exitCode, signal, spawnError) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        let integrityError = null;
        try {
          for (const executable of allowedExecutables) verifyExecutableSync(executable);
          if (sandbox) verifyExecutableSync(sandbox.executable);
        } catch (error) {
          integrityError = error instanceof Error ? error.message : String(error);
          termination = "integrity_error";
        }
        if (cleanup) await cleanup;
        if (spawnError && termination === "exited") termination = "spawn_error";
        resolve({
          ok: termination === "exited" && exitCode === 0,
          termination,
          exitCode,
          signal,
          spawnError,
          integrityError
        });
      };
      child.once("close", (code, signal) => void finish(code, signal, null));
      child.once("error", (error) => void finish(null, null, { message: error.message, code: error.code ?? null }));
    });
    return { ...spawned, executableDescriptor: descriptor, completion };
  }
  async run(request) {
    validateRequest(request);
    const started = Date.now();
    const args = [...request.args ?? []];
    const descriptor = await requestDescriptor(request);
    const owner = optionalOwner(request.owner, "owner");
    const ownerTag = optionalOwner(request.ownerTag, "ownerTag");
    const sandboxRequest = optionalSandbox(request.sandbox ?? request.macosSandbox);
    const allowedExecutables = uniqueDescriptors([descriptor, ...request.allowedExecutables ?? []]);
    const effectiveSandbox = sandboxRequest ? {
      ...sandboxRequest,
      readOnlyPaths: [...explicitReadSubpaths(sandboxRequest.readOnlyPaths ?? [], allowedExecutables), ...macosRuntimeReadSubpaths(allowedExecutables)],
      readOnlyFiles: [...sandboxRequest.readOnlyFiles ?? [], ...macosRuntimeReadFiles(allowedExecutables)],
      allowedExecutablePaths: allowedExecutables.map((value) => value.realpath)
    } : null;
    const sandbox = effectiveSandbox ? await prepareMacosSandbox(effectiveSandbox, allowedExecutables.map((value) => value.realpath)) : null;
    const sandboxCwd = sandbox && request.cwd ? await fs2.realpath(path2.resolve(request.cwd)) : null;
    if (sandbox && sandboxCwd && !isWithin(sandboxCwd, sandbox.workspace)) throw new Error("Sandboxed cwd must be within the workspace");
    const spawnExecutable = sandbox?.executable.realpath ?? descriptor.realpath;
    const spawnArgs = sandbox ? ["-p", sandbox.profile, descriptor.realpath, ...args] : args;
    const spawnEnv = sandbox ? sandboxEnvironment(request.env, sandbox) : { ...request.env ?? {} };
    await Promise.all([...allowedExecutables.map(verifyExecutable), sandbox ? verifyExecutable(sandbox.executable) : Promise.resolve()]);
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let termination = "exited";
    let cleanup = null;
    let child;
    let pid = null;
    let integrityError = null;
    try {
      const spawned = this.processManager.spawn(spawnExecutable, spawnArgs, {
        cwd: sandboxCwd ?? request.cwd ?? sandbox?.workspace,
        env: spawnEnv,
        stdio: request.stdio === "inherit" ? "inherit" : [request.stdin === void 0 ? "ignore" : "pipe", "pipe", "pipe"],
        owner,
        ownerTag
      });
      child = spawned.process;
      pid = spawned.pid;
    } catch (error) {
      const cause = error;
      return result({ request, descriptor, sandbox, args, started, pid, termination: "spawn_error", stdout, stderr, stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated, exitCode: null, signal: null, spawnError: { message: cause.message, code: cause.code ?? null }, integrityError });
    }
    const stop = (reason) => {
      if (termination !== "exited") return;
      termination = reason;
      cleanup = this.processManager.killWithGrace(pid, request.killGraceMs ?? 1e3);
    };
    const capture = (chunks, chunk, current, maximum, stream) => {
      const remaining = Math.max(0, maximum - current);
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      if (chunk.length > remaining) {
        if (stream === "stdout") stdoutTruncated = true;
        else stderrTruncated = true;
        stop(`${stream}_limit`);
      }
      return current + chunk.length;
    };
    child.stdout?.on("data", (value) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stdoutBytes = capture(stdout, chunk, stdoutBytes, request.maxStdoutBytes, "stdout");
    });
    child.stderr?.on("data", (value) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stderrBytes = capture(stderr, chunk, stderrBytes, request.maxStderrBytes, "stderr");
    });
    if (request.stdin !== void 0) child.stdin?.end(request.stdin);
    const timer = setTimeout(() => stop("timed_out"), request.timeoutMs);
    const closed = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.once("close", (code, signal) => finish({ exitCode: code, signal, spawnError: null }));
      child.once("error", (error) => finish({ exitCode: null, signal: null, spawnError: { message: error.message, code: error.code ?? null } }));
    });
    clearTimeout(timer);
    try {
      await Promise.all([...allowedExecutables.map(verifyExecutable), sandbox ? verifyExecutable(sandbox.executable) : Promise.resolve()]);
    } catch (error) {
      integrityError = error instanceof Error ? error.message : String(error);
      termination = "integrity_error";
    }
    if (cleanup) await cleanup;
    if (closed.spawnError && termination === "exited") termination = "spawn_error";
    return result({ request, descriptor, sandbox, args, started, pid, termination, stdout, stderr, stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated, integrityError, ...closed });
  }
};
function streamingCommandFailureMessage(value, executable) {
  if (value.termination === "timed_out") return `${executable} timed out`;
  if (value.termination === "integrity_error") return value.integrityError ?? `${executable} failed executable integrity verification`;
  if (value.termination === "spawn_error") return value.spawnError?.message ?? "Process could not be started";
  return `${executable} exited ${value.exitCode}`;
}
async function requireExecutable(command, pathValue = process.env.PATH ?? "") {
  return (await resolveExecutable(command, pathValue)).realpath;
}
async function resolveExecutable(command, pathValue = process.env.PATH ?? "") {
  if (path2.isAbsolute(command)) return describeExecutable2(command);
  if (command.includes("/") || command.includes("\\")) throw new Error(`Executable path must be absolute or a bare name: ${command}`);
  for (const entry of pathValue.split(path2.delimiter).filter(Boolean)) {
    const candidate = path2.resolve(entry, command);
    try {
      return await describeExecutable2(candidate);
    } catch {
    }
  }
  throw new Error(`Executable not found: ${command}`);
}
async function verifyExecutable(descriptor) {
  validateDescriptor(descriptor);
  const currentRealpath = await fs2.realpath(descriptor.path);
  if (currentRealpath !== descriptor.realpath) throw new Error(`Executable realpath changed: ${descriptor.path}`);
  await fs2.access(currentRealpath, process.platform === "win32" ? void 0 : 1);
  const currentHash = await sha2562(currentRealpath);
  if (currentHash !== descriptor.sha256) throw new Error(`Executable SHA-256 changed: ${descriptor.realpath}`);
}
function commandFailureMessage(value) {
  if (value.termination === "timed_out") return `${value.executable} timed out`;
  if (value.termination === "stdout_limit" || value.termination === "stderr_limit") return `${value.executable} output exceeded configured maximum`;
  if (value.termination === "integrity_error") return value.integrityError ?? `${value.executable} failed executable integrity verification`;
  if (value.termination === "spawn_error") return value.spawnError?.message ?? "Process could not be started";
  return `${value.executable} exited ${value.exitCode}: ${value.stderr}`;
}
async function describeExecutable2(value) {
  const requestedPath = path2.resolve(value);
  await fs2.access(requestedPath, process.platform === "win32" ? void 0 : 1);
  const realpath = await fs2.realpath(requestedPath);
  const stat = await fs2.stat(realpath);
  if (!stat.isFile()) throw new Error(`Executable is not a file: ${requestedPath}`);
  return { path: requestedPath, realpath, sha256: await sha2562(realpath) };
}
async function sha2562(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function sha256Sync(file) {
  const hash = createHash("sha256");
  const fd = openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytesRead));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}
async function requestDescriptor(request) {
  if (request.executableDescriptor) {
    if (typeof request.executable !== "string" || path2.resolve(request.executable) !== request.executableDescriptor.path) {
      throw new Error("Executable and executableDescriptor path do not match");
    }
    return request.executableDescriptor;
  }
  if (typeof request.executable !== "string") return request.executable;
  return resolveExecutable(request.executable);
}
function streamingRequestDescriptor(request) {
  if (request.executableDescriptor) {
    if (typeof request.executable !== "string" || path2.resolve(request.executable) !== request.executableDescriptor.path) {
      throw new Error("Executable and executableDescriptor path do not match");
    }
    return request.executableDescriptor;
  }
  if (typeof request.executable !== "string") return request.executable;
  return resolveExecutableSync(request.executable, request.env?.PATH ?? process.env.PATH ?? "");
}
function resolveExecutableSync(command, pathValue) {
  if (path2.isAbsolute(command)) return describeExecutableSync(command);
  if (command.includes("/") || command.includes("\\")) throw new Error(`Executable path must be absolute or a bare name: ${command}`);
  for (const entry of pathValue.split(path2.delimiter).filter(Boolean)) {
    try {
      return describeExecutableSync(path2.resolve(entry, command));
    } catch {
    }
  }
  throw new Error(`Executable not found: ${command}`);
}
function describeExecutableSync(value) {
  const requestedPath = path2.resolve(value);
  accessSync(requestedPath, process.platform === "win32" ? void 0 : 1);
  const realpath = realpathSync(requestedPath);
  if (!statSync(realpath).isFile()) throw new Error(`Executable is not a file: ${requestedPath}`);
  return { path: requestedPath, realpath, sha256: sha256Sync(realpath) };
}
function verifyExecutableSync(descriptor) {
  validateDescriptor(descriptor);
  const currentRealpath = realpathSync(descriptor.path);
  if (currentRealpath !== descriptor.realpath) throw new Error(`Executable realpath changed: ${descriptor.path}`);
  accessSync(currentRealpath, process.platform === "win32" ? void 0 : 1);
  if (sha256Sync(currentRealpath) !== descriptor.sha256) throw new Error(`Executable SHA-256 changed: ${descriptor.realpath}`);
}
function prepareMacosSandboxSync(request, executablePaths) {
  if (process.platform !== "darwin") throw new Error("macOS sandboxing requires darwin");
  const workspace = realpathSync(path2.resolve(request.workspace));
  if (!statSync(workspace).isDirectory()) throw new Error(`Sandbox workspace is not a directory: ${workspace}`);
  const executable = describeExecutableSync(request.sandboxExecutable ?? "/usr/bin/sandbox-exec");
  const proxyHost = request.proxyAddress.host;
  const proxyAddress = {
    host: (proxyHost.startsWith("[") && proxyHost.endsWith("]") ? proxyHost.slice(1, -1) : proxyHost).toLowerCase(),
    port: request.proxyAddress.port
  };
  return {
    executable,
    profile: generateMacosSandboxProfile({ ...request, proxyAddress }, workspace, executablePaths),
    workspace,
    proxyAddress
  };
}
function validateDescriptor(value) {
  if (!path2.isAbsolute(value.path) || !path2.isAbsolute(value.realpath) || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error("Executable descriptor is invalid");
  }
}
function sandboxEnvironment(env, sandbox) {
  const host = sandbox.proxyAddress.host.includes(":") ? `[${sandbox.proxyAddress.host}]` : sandbox.proxyAddress.host;
  const proxy = `http://${host}:${sandbox.proxyAddress.port}`;
  return { ...env ?? {}, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, NO_PROXY: "", no_proxy: "" };
}
function isWithin(candidate, root) {
  const relative = path2.relative(root, path2.resolve(candidate));
  return relative === "" || !relative.startsWith(`..${path2.sep}`) && relative !== ".." && !path2.isAbsolute(relative);
}
function optionalOwner(value, label) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function optionalSandbox(value) {
  if (value === void 0 || value === null) return void 0;
  if (!value || typeof value !== "object") throw new Error("sandbox must be a macOS sandbox request");
  const candidate = value;
  if (typeof candidate.workspace !== "string" || !candidate.proxyAddress || typeof candidate.proxyAddress !== "object") {
    throw new Error("sandbox must include workspace and proxyAddress");
  }
  return candidate;
}
function uniqueDescriptors(values) {
  const result2 = /* @__PURE__ */ new Map();
  for (const value of values) {
    validateDescriptor(value);
    const prior = result2.get(value.realpath);
    if (prior && prior.sha256 !== value.sha256) throw new Error(`Conflicting executable descriptor: ${value.realpath}`);
    result2.set(value.realpath, value);
  }
  return [...result2.values()];
}
function explicitReadSubpaths(values, executables) {
  const executablePaths = new Set(executables.flatMap((value) => [path2.resolve(value.path), path2.resolve(value.realpath)]));
  return [...new Set(values.map((value) => path2.resolve(value)).filter((value) => !executablePaths.has(value)))];
}
function macosRuntimeReadFiles(executables) {
  return macosRuntimeReads(executables).files;
}
function macosRuntimeReadSubpaths(executables) {
  return macosRuntimeReads(executables).subpaths;
}
function macosRuntimeReads(executables) {
  if (process.platform !== "darwin") return { files: [], subpaths: [] };
  const files = /* @__PURE__ */ new Set();
  const subpaths = /* @__PURE__ */ new Set();
  for (const executable of executables) {
    const executableRoot = path2.dirname(executable.realpath);
    const queue = [executable.realpath];
    const inspected = /* @__PURE__ */ new Set();
    while (queue.length > 0 && inspected.size < 512) {
      const image = queue.shift();
      const canonicalImage = realpathSync(image);
      if (inspected.has(canonicalImage)) continue;
      inspected.add(canonicalImage);
      const loadCommands = spawnSync("/usr/bin/otool", ["-l", canonicalImage], { encoding: "utf8", timeout: 2e3 });
      const libraries = spawnSync("/usr/bin/otool", ["-L", canonicalImage], { encoding: "utf8", timeout: 2e3 });
      if (loadCommands.status !== 0 || libraries.status !== 0 || typeof loadCommands.stdout !== "string" || typeof libraries.stdout !== "string") continue;
      const loader = path2.dirname(canonicalImage);
      const rpaths = [...loadCommands.stdout.matchAll(/\n\s*path\s+(\S+)\s+\(offset/g)].map((match) => resolveDyldPath(match[1], loader, executableRoot, [])).filter((value) => value !== null);
      for (const line of libraries.stdout.split("\n").slice(1)) {
        const dependency = /^\s*(\S+)\s+\(/.exec(line)?.[1];
        if (!dependency) continue;
        const resolved = resolveDyldPath(dependency, loader, executableRoot, rpaths);
        if (resolved && statFile(resolved)) {
          for (const value of literalSymlinkChain(resolved)) files.add(value);
          for (const value of macosRuntimeConfigurationFiles(resolved)) {
            for (const component of literalSymlinkChain(value)) files.add(component);
          }
          queue.push(resolved);
        }
      }
    }
  }
  return { files: [...files].sort(), subpaths: [...subpaths].sort() };
}
function macosRuntimeConfigurationFiles(library) {
  const match = /^(.*)\/opt\/(openssl@[^/]+)\/lib\//.exec(library);
  if (!match) return [];
  const values = [
    path2.join(match[1], "etc", match[2], "openssl.cnf"),
    path2.join(match[1], "etc", match[2], "cert.pem")
  ];
  return values.filter(statFile);
}
function literalSymlinkChain(value) {
  const result2 = /* @__PURE__ */ new Set();
  let current = path2.resolve(value);
  for (let index = 0; index < 32; index++) {
    addLiteralPathComponents(result2, current);
    addResolvedAncestorVariants(result2, current);
    const real = realpathSync(current);
    addLiteralPathComponents(result2, real);
    if (real === current) break;
    current = real;
  }
  return [...result2];
}
function addResolvedAncestorVariants(result2, value) {
  let ancestor = path2.resolve(value);
  while (ancestor !== path2.dirname(ancestor)) {
    try {
      const resolved = path2.join(realpathSync(ancestor), path2.relative(ancestor, value));
      addLiteralPathComponents(result2, resolved);
    } catch {
    }
    ancestor = path2.dirname(ancestor);
  }
}
function addLiteralPathComponents(result2, value) {
  let current = path2.resolve(value);
  while (current !== path2.dirname(current)) {
    result2.add(current);
    current = path2.dirname(current);
  }
}
function resolveDyldPath(value, loader, executable, rpaths) {
  if (path2.isAbsolute(value)) return path2.normalize(value);
  if (value.startsWith("@loader_path/")) return path2.resolve(loader, value.slice("@loader_path/".length));
  if (value.startsWith("@executable_path/")) return path2.resolve(executable, value.slice("@executable_path/".length));
  if (value.startsWith("@rpath/")) {
    const suffix = value.slice("@rpath/".length);
    for (const root of rpaths) {
      const candidate = path2.resolve(root, suffix);
      if (statFile(candidate)) return candidate;
    }
  }
  return null;
}
function statFile(value) {
  try {
    return statSync(value).isFile();
  } catch {
    return false;
  }
}
function validateRequest(request) {
  const executablePath = typeof request.executable === "string" ? request.executable : request.executable.path;
  if (!path2.isAbsolute(executablePath)) throw new Error(`CommandRunner requires an absolute executable: ${executablePath}`);
  const owner = optionalOwner(request.owner, "owner");
  const ownerTag = optionalOwner(request.ownerTag, "ownerTag");
  if (owner !== void 0 && ownerTag !== void 0 && owner !== ownerTag) throw new Error("owner and ownerTag must match");
  if (request.stdio === "inherit" && request.stdin !== void 0) throw new Error("stdin cannot be supplied when stdio is inherited");
  for (const [label, value] of [["timeoutMs", request.timeoutMs], ["maxStdoutBytes", request.maxStdoutBytes], ["maxStderrBytes", request.maxStderrBytes]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  }
}
function validateStreamingRequest(request) {
  const executablePath = typeof request.executable === "string" ? request.executable : request.executable.path;
  if (!executablePath) throw new Error("CommandRunner requires an executable");
  const owner = optionalOwner(request.owner, "owner");
  const ownerTag = optionalOwner(request.ownerTag, "ownerTag");
  if (owner !== void 0 && ownerTag !== void 0 && owner !== ownerTag) throw new Error("owner and ownerTag must match");
  if (request.timeoutMs !== void 0 && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1)) {
    throw new Error("timeoutMs must be a positive integer");
  }
}
function result(input) {
  const stdoutBuffer = Buffer.concat(input.stdout);
  return { executable: input.descriptor.realpath, executableDescriptor: input.descriptor, args: input.args, cwd: input.request.cwd ?? input.sandbox?.workspace ?? null, pid: input.pid, ok: input.termination === "exited" && input.exitCode === 0, termination: input.termination, exitCode: input.exitCode, signal: input.signal, stdoutBuffer, stdout: stdoutBuffer.toString("utf8"), stderr: Buffer.concat(input.stderr).toString("utf8"), stdoutBytes: input.stdoutBytes, stderrBytes: input.stderrBytes, stdoutTruncated: input.stdoutTruncated, stderrTruncated: input.stderrTruncated, durationMs: Date.now() - input.started, spawnError: input.spawnError, integrityError: input.integrityError, sandbox: input.sandbox ? { executableDescriptor: input.sandbox.executable, profile: input.sandbox.profile, proxyAddress: input.sandbox.proxyAddress } : null };
}

export { CommandRunner, commandFailureMessage, generateMacosSandboxProfile, macosSandboxPolicy, requireExecutable, resolveExecutable, streamingCommandFailureMessage, verifyExecutable };
//# sourceMappingURL=chunk-OBMT332P.js.map
//# sourceMappingURL=chunk-OBMT332P.js.map