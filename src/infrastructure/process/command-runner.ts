import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { accessSync, closeSync, createReadStream, openSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { IProcessManager, SpawnResult } from './process-manager.js';
import { generateMacosSandboxProfile, prepareMacosSandbox, type MacosSandboxRequest, type PreparedMacosSandbox } from '../security/macos-sandbox.js';

export type CommandTermination = 'exited' | 'spawn_error' | 'timed_out' | 'stdout_limit' | 'stderr_limit' | 'integrity_error';

export interface ExecutableDescriptor {
  path: string;
  realpath: string;
  sha256: string;
}

export interface CommandRequest {
  executable: string | ExecutableDescriptor;
  executableDescriptor?: ExecutableDescriptor;
  args?: readonly string[];
  cwd?: string;
  stdin?: string | Uint8Array;
  stdio?: 'inherit';
  env?: Readonly<NodeJS.ProcessEnv>;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  killGraceMs?: number;
  owner?: unknown;
  ownerTag?: unknown;
  sandbox?: unknown;
  macosSandbox?: unknown;
  allowedExecutables?: readonly ExecutableDescriptor[];
}

export interface CommandResult {
  executable: string;
  executableDescriptor: ExecutableDescriptor;
  args: string[];
  cwd: string | null;
  pid: number | null;
  ok: boolean;
  termination: CommandTermination;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutBuffer: Buffer;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  spawnError: { message: string; code: string | null } | null;
  integrityError: string | null;
  sandbox: { executableDescriptor: ExecutableDescriptor; profile: string; proxyAddress: { host: string; port: number } } | null;
}

export interface StreamingCommandRequest {
  executable: string | ExecutableDescriptor;
  executableDescriptor?: ExecutableDescriptor;
  args?: readonly string[];
  cwd?: string;
  stdin?: string | Uint8Array;
  keepStdinOpen?: boolean;
  env?: Readonly<NodeJS.ProcessEnv>;
  timeoutMs?: number;
  killGraceMs?: number;
  owner?: unknown;
  ownerTag?: unknown;
  sandbox?: unknown;
  macosSandbox?: unknown;
  allowedExecutables?: readonly ExecutableDescriptor[];
  signal?: AbortSignal;
}

export interface StreamingCommandCompletion {
  ok: boolean;
  termination: CommandTermination;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  spawnError: { message: string; code: string | null } | null;
  integrityError: string | null;
}

export interface StreamingCommandHandle extends SpawnResult {
  executableDescriptor: ExecutableDescriptor;
  completion: Promise<StreamingCommandCompletion>;
}

export interface ICommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
  start(request: StreamingCommandRequest): StreamingCommandHandle;
  resolveExecutable?(command: string, pathValue?: string): Promise<ExecutableDescriptor>;
}

export class CommandRunner implements ICommandRunner {
  constructor(private readonly processManager: IProcessManager) {}

  resolveExecutable(command: string, pathValue?: string): Promise<ExecutableDescriptor> {
    return resolveExecutable(command, pathValue);
  }

  start(request: StreamingCommandRequest): StreamingCommandHandle {
    validateStreamingRequest(request);
    const args = [...(request.args ?? [])];
    const descriptor = streamingRequestDescriptor(request);
    const owner = optionalOwner(request.owner, 'owner');
    const ownerTag = optionalOwner(request.ownerTag, 'ownerTag');
    const sandboxRequest = optionalSandbox(request.sandbox ?? request.macosSandbox);
    const allowedExecutables = uniqueDescriptors([descriptor, ...(request.allowedExecutables ?? [])]);
    const effectiveSandbox = sandboxRequest
      ? {
          ...sandboxRequest,
          readOnlyPaths: [...explicitReadSubpaths(sandboxRequest.readOnlyPaths ?? [], allowedExecutables), ...macosRuntimeReadSubpaths(allowedExecutables)],
          readOnlyFiles: [...(sandboxRequest.readOnlyFiles ?? []), ...macosRuntimeReadFiles(allowedExecutables)],
          allowedExecutablePaths: allowedExecutables.map((value) => value.realpath),
        }
      : null;
    const sandbox = effectiveSandbox ? prepareMacosSandboxSync(effectiveSandbox, allowedExecutables.map((value) => value.realpath)) : null;
    const sandboxCwd = sandbox && request.cwd ? realpathSync(path.resolve(request.cwd)) : null;
    if (sandbox && sandboxCwd && !isWithin(sandboxCwd, sandbox.workspace)) throw new Error('Sandboxed cwd must be within the workspace');
    const spawnExecutable = sandbox?.executable.realpath ?? descriptor.realpath;
    const spawnArgs = sandbox ? ['-p', sandbox.profile, descriptor.realpath, ...args] : args;
    const spawnEnv = sandbox ? sandboxEnvironment(request.env, sandbox) : { ...(request.env ?? {}) };
    for (const executable of allowedExecutables) verifyExecutableSync(executable);
    if (sandbox) verifyExecutableSync(sandbox.executable);

    const spawned = this.processManager.spawn(spawnExecutable, spawnArgs, {
      cwd: sandboxCwd ?? request.cwd ?? sandbox?.workspace,
      env: spawnEnv,
      stdio: [request.stdin === undefined && !request.keepStdinOpen ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      owner,
      ownerTag,
    });
    const child = spawned.process;
    let termination: CommandTermination = 'exited';
    let cleanup: Promise<void> | null = null;
    const stop = (reason: CommandTermination) => {
      if (termination !== 'exited') return;
      termination = reason;
      cleanup = this.processManager.killWithGrace(spawned.pid, request.killGraceMs ?? 1_000);
    };
    const onAbort = () => stop('timed_out');
    if (request.signal) {
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = request.timeoutMs === undefined ? null : setTimeout(() => stop('timed_out'), request.timeoutMs);
    if (request.stdin !== undefined) {
      if (request.keepStdinOpen) child.stdin?.write(request.stdin);
      else child.stdin?.end(request.stdin);
    }

    const completion = new Promise<StreamingCommandCompletion>((resolve) => {
      let settled = false;
      const finish = async (exitCode: number | null, signal: NodeJS.Signals | null, spawnError: StreamingCommandCompletion['spawnError']) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        let integrityError: string | null = null;
        try {
          for (const executable of allowedExecutables) verifyExecutableSync(executable);
          if (sandbox) verifyExecutableSync(sandbox.executable);
        } catch (error) {
          integrityError = error instanceof Error ? error.message : String(error);
          termination = 'integrity_error';
        }
        if (cleanup) await cleanup;
        if (spawnError && termination === 'exited') termination = 'spawn_error';
        resolve({
          ok: termination === 'exited' && exitCode === 0,
          termination,
          exitCode,
          signal,
          spawnError,
          integrityError,
        });
      };
      child.once('close', (code, signal) => void finish(code, signal, null));
      child.once('error', (error: NodeJS.ErrnoException) => void finish(null, null, { message: error.message, code: error.code ?? null }));
    });

    return { ...spawned, executableDescriptor: descriptor, completion };
  }

  async run(request: CommandRequest): Promise<CommandResult> {
    validateRequest(request);
    const started = Date.now();
    const args = [...(request.args ?? [])];
    const descriptor = await requestDescriptor(request);
    const owner = optionalOwner(request.owner, 'owner');
    const ownerTag = optionalOwner(request.ownerTag, 'ownerTag');
    const sandboxRequest = optionalSandbox(request.sandbox ?? request.macosSandbox);
    const allowedExecutables = uniqueDescriptors([descriptor, ...(request.allowedExecutables ?? [])]);
    const effectiveSandbox = sandboxRequest
      ? {
          ...sandboxRequest,
          readOnlyPaths: [...explicitReadSubpaths(sandboxRequest.readOnlyPaths ?? [], allowedExecutables), ...macosRuntimeReadSubpaths(allowedExecutables)],
          readOnlyFiles: [...(sandboxRequest.readOnlyFiles ?? []), ...macosRuntimeReadFiles(allowedExecutables)],
          allowedExecutablePaths: allowedExecutables.map((value) => value.realpath),
        }
      : null;
    const sandbox = effectiveSandbox ? await prepareMacosSandbox(effectiveSandbox, allowedExecutables.map((value) => value.realpath)) : null;
    const sandboxCwd = sandbox && request.cwd ? await fs.realpath(path.resolve(request.cwd)) : null;
    if (sandbox && sandboxCwd && !isWithin(sandboxCwd, sandbox.workspace)) throw new Error('Sandboxed cwd must be within the workspace');
    const spawnExecutable = sandbox?.executable.realpath ?? descriptor.realpath;
    const spawnArgs = sandbox ? ['-p', sandbox.profile, descriptor.realpath, ...args] : args;
    const spawnEnv = sandbox ? sandboxEnvironment(request.env, sandbox) : { ...(request.env ?? {}) };
    await Promise.all([...allowedExecutables.map(verifyExecutable), sandbox ? verifyExecutable(sandbox.executable) : Promise.resolve()]);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let termination: CommandTermination = 'exited';
    let cleanup: Promise<void> | null = null;
    let child;
    let pid: number | null = null;
    let integrityError: string | null = null;

    try {
      const spawned = this.processManager.spawn(spawnExecutable, spawnArgs, {
        cwd: sandboxCwd ?? request.cwd ?? sandbox?.workspace,
        env: spawnEnv,
        stdio: request.stdio === 'inherit'
          ? 'inherit'
          : [request.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        owner,
        ownerTag,
      });
      child = spawned.process;
      pid = spawned.pid;
    } catch (error) {
      const cause = error as NodeJS.ErrnoException;
      return result({ request, descriptor, sandbox, args, started, pid, termination: 'spawn_error', stdout, stderr, stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated, exitCode: null, signal: null, spawnError: { message: cause.message, code: cause.code ?? null }, integrityError });
    }

    const stop = (reason: CommandTermination) => {
      if (termination !== 'exited') return;
      termination = reason;
      cleanup = this.processManager.killWithGrace(pid!, request.killGraceMs ?? 1_000);
    };
    const capture = (chunks: Buffer[], chunk: Buffer, current: number, maximum: number, stream: 'stdout' | 'stderr') => {
      const remaining = Math.max(0, maximum - current);
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      if (chunk.length > remaining) {
        if (stream === 'stdout') stdoutTruncated = true;
        else stderrTruncated = true;
        stop(`${stream}_limit`);
      }
      return current + chunk.length;
    };
    child.stdout?.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stdoutBytes = capture(stdout, chunk, stdoutBytes, request.maxStdoutBytes, 'stdout');
    });
    child.stderr?.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stderrBytes = capture(stderr, chunk, stderrBytes, request.maxStderrBytes, 'stderr');
    });
    if (request.stdin !== undefined) child.stdin?.end(request.stdin);

    const timer = setTimeout(() => stop('timed_out'), request.timeoutMs);
    const closed = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; spawnError: CommandResult['spawnError'] }>((resolve) => {
      let settled = false;
      const finish = (value: { exitCode: number | null; signal: NodeJS.Signals | null; spawnError: CommandResult['spawnError'] }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.once('close', (code, signal) => finish({ exitCode: code, signal, spawnError: null }));
      child.once('error', (error: NodeJS.ErrnoException) => finish({ exitCode: null, signal: null, spawnError: { message: error.message, code: error.code ?? null } }));
    });
    clearTimeout(timer);
    try {
      await Promise.all([...allowedExecutables.map(verifyExecutable), sandbox ? verifyExecutable(sandbox.executable) : Promise.resolve()]);
    } catch (error) {
      integrityError = error instanceof Error ? error.message : String(error);
      termination = 'integrity_error';
    }
    if (cleanup) await cleanup;
    if (closed.spawnError && termination === 'exited') termination = 'spawn_error';
    return result({ request, descriptor, sandbox, args, started, pid, termination, stdout, stderr, stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated, integrityError, ...closed });
  }
}

export function streamingCommandFailureMessage(value: StreamingCommandCompletion, executable: string): string {
  if (value.termination === 'timed_out') return `${executable} timed out`;
  if (value.termination === 'integrity_error') return value.integrityError ?? `${executable} failed executable integrity verification`;
  if (value.termination === 'spawn_error') return value.spawnError?.message ?? 'Process could not be started';
  return `${executable} exited ${value.exitCode}`;
}

export async function requireExecutable(command: string, pathValue = process.env.PATH ?? ''): Promise<string> {
  return (await resolveExecutable(command, pathValue)).realpath;
}

export async function resolveExecutable(command: string, pathValue = process.env.PATH ?? ''): Promise<ExecutableDescriptor> {
  if (path.isAbsolute(command)) return describeExecutable(command);
  if (command.includes('/') || command.includes('\\')) throw new Error(`Executable path must be absolute or a bare name: ${command}`);
  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(entry, command);
    try { return await describeExecutable(candidate); } catch { /* continue */ }
  }
  throw new Error(`Executable not found: ${command}`);
}

export async function verifyExecutable(descriptor: ExecutableDescriptor): Promise<void> {
  validateDescriptor(descriptor);
  const currentRealpath = await fs.realpath(descriptor.path);
  if (currentRealpath !== descriptor.realpath) throw new Error(`Executable realpath changed: ${descriptor.path}`);
  await fs.access(currentRealpath, process.platform === 'win32' ? undefined : 1);
  const currentHash = await sha256(currentRealpath);
  if (currentHash !== descriptor.sha256) throw new Error(`Executable SHA-256 changed: ${descriptor.realpath}`);
}

export function commandFailureMessage(value: CommandResult): string {
  if (value.termination === 'timed_out') return `${value.executable} timed out`;
  if (value.termination === 'stdout_limit' || value.termination === 'stderr_limit') return `${value.executable} output exceeded configured maximum`;
  if (value.termination === 'integrity_error') return value.integrityError ?? `${value.executable} failed executable integrity verification`;
  if (value.termination === 'spawn_error') return value.spawnError?.message ?? 'Process could not be started';
  return `${value.executable} exited ${value.exitCode}: ${value.stderr}`;
}

async function describeExecutable(value: string): Promise<ExecutableDescriptor> {
  const requestedPath = path.resolve(value);
  await fs.access(requestedPath, process.platform === 'win32' ? undefined : 1);
  const realpath = await fs.realpath(requestedPath);
  const stat = await fs.stat(realpath);
  if (!stat.isFile()) throw new Error(`Executable is not a file: ${requestedPath}`);
  return { path: requestedPath, realpath, sha256: await sha256(realpath) };
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function sha256Sync(file: string): string {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead: number;
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytesRead));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

async function requestDescriptor(request: CommandRequest): Promise<ExecutableDescriptor> {
  if (request.executableDescriptor) {
    if (typeof request.executable !== 'string' || path.resolve(request.executable) !== request.executableDescriptor.path) {
      throw new Error('Executable and executableDescriptor path do not match');
    }
    return request.executableDescriptor;
  }
  if (typeof request.executable !== 'string') return request.executable;
  return resolveExecutable(request.executable);
}

function streamingRequestDescriptor(request: StreamingCommandRequest): ExecutableDescriptor {
  if (request.executableDescriptor) {
    if (typeof request.executable !== 'string' || path.resolve(request.executable) !== request.executableDescriptor.path) {
      throw new Error('Executable and executableDescriptor path do not match');
    }
    return request.executableDescriptor;
  }
  if (typeof request.executable !== 'string') return request.executable;
  return resolveExecutableSync(request.executable, request.env?.PATH ?? process.env.PATH ?? '');
}

function resolveExecutableSync(command: string, pathValue: string): ExecutableDescriptor {
  if (path.isAbsolute(command)) return describeExecutableSync(command);
  if (command.includes('/') || command.includes('\\')) throw new Error(`Executable path must be absolute or a bare name: ${command}`);
  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    try { return describeExecutableSync(path.resolve(entry, command)); } catch { /* continue */ }
  }
  throw new Error(`Executable not found: ${command}`);
}

function describeExecutableSync(value: string): ExecutableDescriptor {
  const requestedPath = path.resolve(value);
  accessSync(requestedPath, process.platform === 'win32' ? undefined : 1);
  const realpath = realpathSync(requestedPath);
  if (!statSync(realpath).isFile()) throw new Error(`Executable is not a file: ${requestedPath}`);
  return { path: requestedPath, realpath, sha256: sha256Sync(realpath) };
}

function verifyExecutableSync(descriptor: ExecutableDescriptor): void {
  validateDescriptor(descriptor);
  const currentRealpath = realpathSync(descriptor.path);
  if (currentRealpath !== descriptor.realpath) throw new Error(`Executable realpath changed: ${descriptor.path}`);
  accessSync(currentRealpath, process.platform === 'win32' ? undefined : 1);
  if (sha256Sync(currentRealpath) !== descriptor.sha256) throw new Error(`Executable SHA-256 changed: ${descriptor.realpath}`);
}

function prepareMacosSandboxSync(request: MacosSandboxRequest, executablePaths: readonly string[]): PreparedMacosSandbox {
  if (process.platform !== 'darwin') throw new Error('macOS sandboxing requires darwin');
  const workspace = realpathSync(path.resolve(request.workspace));
  if (!statSync(workspace).isDirectory()) throw new Error(`Sandbox workspace is not a directory: ${workspace}`);
  const executable = describeExecutableSync(request.sandboxExecutable ?? '/usr/bin/sandbox-exec');
  const proxyHost = request.proxyAddress.host;
  const proxyAddress = {
    host: (proxyHost.startsWith('[') && proxyHost.endsWith(']') ? proxyHost.slice(1, -1) : proxyHost).toLowerCase(),
    port: request.proxyAddress.port,
  };
  return {
    executable,
    profile: generateMacosSandboxProfile({ ...request, proxyAddress }, workspace, executablePaths),
    workspace,
    proxyAddress,
  };
}

function validateDescriptor(value: ExecutableDescriptor): void {
  if (!path.isAbsolute(value.path) || !path.isAbsolute(value.realpath) || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error('Executable descriptor is invalid');
  }
}

function sandboxEnvironment(env: Readonly<NodeJS.ProcessEnv> | undefined, sandbox: PreparedMacosSandbox): NodeJS.ProcessEnv {
  const host = sandbox.proxyAddress.host.includes(':') ? `[${sandbox.proxyAddress.host}]` : sandbox.proxyAddress.host;
  const proxy = `http://${host}:${sandbox.proxyAddress.port}`;
  return { ...(env ?? {}), HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, NO_PROXY: '', no_proxy: '' };
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function optionalOwner(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalSandbox(value: unknown): MacosSandboxRequest | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object') throw new Error('sandbox must be a macOS sandbox request');
  const candidate = value as Partial<MacosSandboxRequest>;
  if (typeof candidate.workspace !== 'string' || !candidate.proxyAddress || typeof candidate.proxyAddress !== 'object') {
    throw new Error('sandbox must include workspace and proxyAddress');
  }
  return candidate as MacosSandboxRequest;
}

function uniqueDescriptors(values: readonly ExecutableDescriptor[]): ExecutableDescriptor[] {
  const result = new Map<string, ExecutableDescriptor>();
  for (const value of values) {
    validateDescriptor(value);
    const prior = result.get(value.realpath);
    if (prior && prior.sha256 !== value.sha256) throw new Error(`Conflicting executable descriptor: ${value.realpath}`);
    result.set(value.realpath, value);
  }
  return [...result.values()];
}

function explicitReadSubpaths(values: readonly string[], executables: readonly ExecutableDescriptor[]): string[] {
  const executablePaths = new Set(executables.flatMap((value) => [path.resolve(value.path), path.resolve(value.realpath)]));
  return [...new Set(values.map((value) => path.resolve(value)).filter((value) => !executablePaths.has(value)))];
}

function macosRuntimeReadFiles(executables: readonly ExecutableDescriptor[]): string[] {
  return macosRuntimeReads(executables).files;
}

function macosRuntimeReadSubpaths(executables: readonly ExecutableDescriptor[]): string[] {
  return macosRuntimeReads(executables).subpaths;
}

function macosRuntimeReads(executables: readonly ExecutableDescriptor[]): { files: string[]; subpaths: string[] } {
  if (process.platform !== 'darwin') return { files: [], subpaths: [] };
  const files = new Set<string>();
  const subpaths = new Set<string>();
  for (const executable of executables) {
    const executableRoot = path.dirname(executable.realpath);
    const queue = [executable.realpath];
    const inspected = new Set<string>();
    while (queue.length > 0 && inspected.size < 512) {
      const image = queue.shift()!;
      const canonicalImage = realpathSync(image);
      if (inspected.has(canonicalImage)) continue;
      inspected.add(canonicalImage);
      const loadCommands = spawnSync('/usr/bin/otool', ['-l', canonicalImage], { encoding: 'utf8', timeout: 2_000 });
      const libraries = spawnSync('/usr/bin/otool', ['-L', canonicalImage], { encoding: 'utf8', timeout: 2_000 });
      if (loadCommands.status !== 0 || libraries.status !== 0 || typeof loadCommands.stdout !== 'string' || typeof libraries.stdout !== 'string') continue;
      const loader = path.dirname(canonicalImage);
      const rpaths = [...loadCommands.stdout.matchAll(/\n\s*path\s+(\S+)\s+\(offset/g)]
        .map((match) => resolveDyldPath(match[1]!, loader, executableRoot, []))
        .filter((value): value is string => value !== null);
      for (const line of libraries.stdout.split('\n').slice(1)) {
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

function macosRuntimeConfigurationFiles(library: string): string[] {
  const match = /^(.*)\/opt\/(openssl@[^/]+)\/lib\//.exec(library);
  if (!match) return [];
  const values = [
    path.join(match[1]!, 'etc', match[2]!, 'openssl.cnf'),
    path.join(match[1]!, 'etc', match[2]!, 'cert.pem'),
  ];
  return values.filter(statFile);
}

function literalSymlinkChain(value: string): string[] {
  const result = new Set<string>();
  let current = path.resolve(value);
  for (let index = 0; index < 32; index++) {
    addLiteralPathComponents(result, current);
    addResolvedAncestorVariants(result, current);
    const real = realpathSync(current);
    addLiteralPathComponents(result, real);
    if (real === current) break;
    current = real;
  }
  return [...result];
}

function addResolvedAncestorVariants(result: Set<string>, value: string): void {
  let ancestor = path.resolve(value);
  while (ancestor !== path.dirname(ancestor)) {
    try {
      const resolved = path.join(realpathSync(ancestor), path.relative(ancestor, value));
      addLiteralPathComponents(result, resolved);
    } catch {
      // A missing component cannot be used by dyld.
    }
    ancestor = path.dirname(ancestor);
  }
}

function addLiteralPathComponents(result: Set<string>, value: string): void {
  let current = path.resolve(value);
  while (current !== path.dirname(current)) {
    result.add(current);
    current = path.dirname(current);
  }
}

function resolveDyldPath(value: string, loader: string, executable: string, rpaths: readonly string[]): string | null {
  if (path.isAbsolute(value)) return path.normalize(value);
  if (value.startsWith('@loader_path/')) return path.resolve(loader, value.slice('@loader_path/'.length));
  if (value.startsWith('@executable_path/')) return path.resolve(executable, value.slice('@executable_path/'.length));
  if (value.startsWith('@rpath/')) {
    const suffix = value.slice('@rpath/'.length);
    for (const root of rpaths) {
      const candidate = path.resolve(root, suffix);
      if (statFile(candidate)) return candidate;
    }
  }
  return null;
}

function statFile(value: string): boolean {
  try { return statSync(value).isFile(); } catch { return false; }
}

function validateRequest(request: CommandRequest): void {
  const executablePath = typeof request.executable === 'string' ? request.executable : request.executable.path;
  if (!path.isAbsolute(executablePath)) throw new Error(`CommandRunner requires an absolute executable: ${executablePath}`);
  const owner = optionalOwner(request.owner, 'owner');
  const ownerTag = optionalOwner(request.ownerTag, 'ownerTag');
  if (owner !== undefined && ownerTag !== undefined && owner !== ownerTag) throw new Error('owner and ownerTag must match');
  if (request.stdio === 'inherit' && request.stdin !== undefined) throw new Error('stdin cannot be supplied when stdio is inherited');
  for (const [label, value] of [['timeoutMs', request.timeoutMs], ['maxStdoutBytes', request.maxStdoutBytes], ['maxStderrBytes', request.maxStderrBytes]] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  }
}

function validateStreamingRequest(request: StreamingCommandRequest): void {
  const executablePath = typeof request.executable === 'string' ? request.executable : request.executable.path;
  if (!executablePath) throw new Error('CommandRunner requires an executable');
  const owner = optionalOwner(request.owner, 'owner');
  const ownerTag = optionalOwner(request.ownerTag, 'ownerTag');
  if (owner !== undefined && ownerTag !== undefined && owner !== ownerTag) throw new Error('owner and ownerTag must match');
  if (request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1)) {
    throw new Error('timeoutMs must be a positive integer');
  }
}

function result(input: { request: CommandRequest; descriptor: ExecutableDescriptor; sandbox: PreparedMacosSandbox | null; args: string[]; started: number; pid: number | null; termination: CommandTermination; stdout: Buffer[]; stderr: Buffer[]; stdoutBytes: number; stderrBytes: number; stdoutTruncated: boolean; stderrTruncated: boolean; exitCode: number | null; signal: NodeJS.Signals | null; spawnError: CommandResult['spawnError']; integrityError: string | null }): CommandResult {
  const stdoutBuffer = Buffer.concat(input.stdout);
  return { executable: input.descriptor.realpath, executableDescriptor: input.descriptor, args: input.args, cwd: input.request.cwd ?? input.sandbox?.workspace ?? null, pid: input.pid, ok: input.termination === 'exited' && input.exitCode === 0, termination: input.termination, exitCode: input.exitCode, signal: input.signal, stdoutBuffer, stdout: stdoutBuffer.toString('utf8'), stderr: Buffer.concat(input.stderr).toString('utf8'), stdoutBytes: input.stdoutBytes, stderrBytes: input.stderrBytes, stdoutTruncated: input.stdoutTruncated, stderrTruncated: input.stderrTruncated, durationMs: Date.now() - input.started, spawnError: input.spawnError, integrityError: input.integrityError, sandbox: input.sandbox ? { executableDescriptor: input.sandbox.executable, profile: input.sandbox.profile, proxyAddress: input.sandbox.proxyAddress } : null };
}
