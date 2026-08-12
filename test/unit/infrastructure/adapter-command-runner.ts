import type { ChildProcess } from 'node:child_process';
import { vi } from 'vitest';
import type { ICommandRunner, CommandRequest, CommandResult, StreamingCommandCompletion, StreamingCommandHandle, StreamingCommandRequest } from '../../../src/infrastructure/process/command-runner.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';

const descriptor = { path: '/test/adapter', realpath: '/test/adapter', sha256: '0'.repeat(64) };
export const adapterExecution = {
  owner: 'tsk_adapter',
  sandbox: { workspace: '/tmp', proxyAddress: { host: '127.0.0.1', port: 4321 }, writableWorkspace: true },
  allowedExecutables: [descriptor],
};

export function attachAdapterCommandRunner(
  processManager: IProcessManager,
  process: ChildProcess,
  version = 'adapter 1.0.0',
): IProcessManager & ICommandRunner {
  const run = vi.fn(async (request: CommandRequest): Promise<CommandResult> => ({
    executable: typeof request.executable === 'string' ? request.executable : request.executable.realpath,
    executableDescriptor: descriptor,
    args: [...(request.args ?? [])],
    cwd: request.cwd ?? null,
    pid: 1,
    ok: true,
    termination: 'exited',
    exitCode: 0,
    signal: null,
    stdout: version,
    stderr: '',
    stdoutBytes: Buffer.byteLength(version),
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    spawnError: null,
    integrityError: null,
    sandbox: null,
  }));
  const start = vi.fn((request: StreamingCommandRequest): StreamingCommandHandle => {
    const executable = typeof request.executable === 'string' ? request.executable : request.executable.realpath;
    const spawned = processManager.spawn(executable, [...(request.args ?? [])], {
      cwd: request.cwd,
      env: { ...(request.env ?? {}) },
      stdio: [request.stdin === undefined && !request.keepStdinOpen ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (request.stdin !== undefined) {
      spawned.process.stdin?.write(request.stdin);
      if (!request.keepStdinOpen) spawned.process.stdin?.end();
    }
    const completion = new Promise<StreamingCommandCompletion>((resolve) => {
      spawned.process.once('close', (exitCode, signal) => resolve({
        ok: exitCode === 0,
        termination: 'exited',
        exitCode,
        signal,
        spawnError: null,
        integrityError: null,
      }));
      spawned.process.once('error', (error: NodeJS.ErrnoException) => resolve({
        ok: false,
        termination: 'spawn_error',
        exitCode: null,
        signal: null,
        spawnError: { message: error.message, code: error.code ?? null },
        integrityError: null,
      }));
    });
    if (request.signal) {
      const abort = () => { void processManager.killWithGrace(spawned.pid, 1_000); };
      if (request.signal.aborted) abort();
      else request.signal.addEventListener('abort', abort, { once: true });
    }
    return { ...spawned, executableDescriptor: descriptor, completion };
  });
  const resolveExecutable = vi.fn(async () => descriptor);
  return Object.assign(processManager, { run, start, resolveExecutable });
}
