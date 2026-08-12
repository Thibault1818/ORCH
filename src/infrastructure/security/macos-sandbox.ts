import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export interface SandboxExecutableDescriptor {
  path: string;
  realpath: string;
  sha256: string;
}

export interface SandboxProxyAddress {
  host: string;
  port: number;
}

export interface MacosSandboxRequest {
  workspace: string;
  proxyAddress: SandboxProxyAddress;
  sandboxExecutable?: string;
  readOnlyPaths?: readonly string[];
  readOnlyFiles?: readonly string[];
  writablePaths?: readonly string[];
  allowedExecutablePaths?: readonly string[];
  writableWorkspace?: boolean;
}

export interface PreparedMacosSandbox {
  executable: SandboxExecutableDescriptor;
  profile: string;
  workspace: string;
  proxyAddress: SandboxProxyAddress;
}

const SYSTEM_READ_PATHS = ['/System', '/Library/Apple', '/usr/lib', '/usr/share', '/dev', '/private/etc/ssl'];

export function macosSandboxPolicy(): Readonly<Record<string, unknown>> {
  return {
    version: 1,
    default: 'deny',
    system_read_subpaths: [...SYSTEM_READ_PATHS].sort(),
    executable_read_rule: 'literal',
    runtime_library_read_rule: 'mach-o-dependency-directories',
    executable_exec_rule: 'literal',
    workspace_read_rule: 'subpath',
    workspace_write_rule: 'explicit',
    network_rule: 'deny-except-loopback-proxy',
    signal_rule: 'self',
  };
}

export function generateMacosSandboxProfile(request: MacosSandboxRequest, workspace = path.resolve(request.workspace), executablePaths: readonly string[] = []): string {
  const proxy = validateProxyAddress(request.proxyAddress);
  const executableFiles = new Set(uniquePaths(executablePaths));
  const literalReadFiles = new Set(uniquePaths([...executableFiles, ...(request.readOnlyFiles ?? [])]));
  const readSubpaths = uniquePaths([workspace, ...SYSTEM_READ_PATHS, ...(request.readOnlyPaths ?? [])])
    .filter((value) => !executableFiles.has(value))
    .map((value) => `  (subpath ${sandboxString(value)})`)
    .join('\n');
  const readFiles = [...literalReadFiles]
    .map((value) => `  (literal ${sandboxString(value)})`)
    .join('\n');
  return [
    '(version 1)',
    '(deny default)',
    '(import "system.sb")',
    '(deny network*)',
    '(allow process-fork)',
    '(allow process-info*)',
    ...(request.allowedExecutablePaths?.length
      ? ['(allow process-exec', ...uniquePaths(request.allowedExecutablePaths).map((value) => `  (literal ${sandboxString(value)})`), ')']
      : ['(allow process-exec (literal "/usr/bin/false"))']),
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow file-read*',
    readSubpaths,
    readFiles,
    ')',
    ...(request.writableWorkspace === false ? [] : [`(allow file-write* (subpath ${sandboxString(workspace)}))`]),
    ...(request.writablePaths ?? []).map((value) => `(allow file-write* (subpath ${sandboxString(value)}))`),
    '(allow file-write-data (literal "/dev/null"))',
    `(allow network-outbound (remote tcp ${sandboxString(`localhost:${proxy.port}`)}))`,
  ].join('\n');
}

export async function prepareMacosSandbox(request: MacosSandboxRequest, executablePaths: readonly string[] = []): Promise<PreparedMacosSandbox> {
  if (process.platform !== 'darwin') throw new Error('macOS sandboxing requires darwin');
  const workspace = await fs.realpath(path.resolve(request.workspace));
  if (!(await fs.stat(workspace)).isDirectory()) throw new Error(`Sandbox workspace is not a directory: ${workspace}`);
  const proxyAddress = validateProxyAddress(request.proxyAddress);
  const executable = await describeExecutable(request.sandboxExecutable ?? '/usr/bin/sandbox-exec');
  return {
    executable,
    profile: generateMacosSandboxProfile({ ...request, proxyAddress }, workspace, executablePaths),
    workspace,
    proxyAddress,
  };
}

async function describeExecutable(value: string): Promise<SandboxExecutableDescriptor> {
  const requestedPath = path.resolve(value);
  await fs.access(requestedPath, 1);
  const realpath = await fs.realpath(requestedPath);
  const stat = await fs.stat(realpath);
  if (!stat.isFile()) throw new Error(`Sandbox executable is not a file: ${requestedPath}`);
  return { path: requestedPath, realpath, sha256: await sha256(realpath) };
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function validateProxyAddress(value: SandboxProxyAddress): SandboxProxyAddress {
  const host = stripIpv6Brackets(value.host).toLowerCase();
  if (!isLoopback(host)) throw new Error('Sandbox proxy must use a numeric loopback address');
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65_535) throw new Error('Sandbox proxy port is invalid');
  return { host, port: value.port };
}

function isLoopback(host: string): boolean {
  if (net.isIP(host) === 4) return host.startsWith('127.');
  return net.isIP(host) === 6 && (host === '::1' || host.toLowerCase() === '0:0:0:0:0:0:0:1');
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function sandboxString(value: string): string {
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) throw new Error('Sandbox value contains invalid characters');
  return JSON.stringify(value).replace(/\\u2028|\\u2029/g, '');
}

function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => path.resolve(value)))].sort();
}
