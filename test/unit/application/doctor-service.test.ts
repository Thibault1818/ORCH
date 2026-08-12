import { describe, expect, it, vi } from 'vitest';
import { DoctorService, type DoctorExecutables } from '../../../src/application/doctor-service.js';
import type { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { CommandResult, ExecutableDescriptor, ICommandRunner } from '../../../src/infrastructure/process/command-runner.js';

const git = descriptor('/usr/bin/git');
const node = descriptor('/usr/bin/node');

function descriptor(executablePath: string): ExecutableDescriptor {
  return { path: executablePath, realpath: executablePath, sha256: 'b'.repeat(64) };
}

function result(executable: ExecutableDescriptor, stdout: string, ok = true): CommandResult {
  return {
    executable: executable.realpath,
    executableDescriptor: executable,
    args: [],
    cwd: null,
    pid: 1,
    ok,
    termination: 'exited',
    exitCode: ok ? 0 : 1,
    signal: null,
    stdout,
    stderr: '',
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    spawnError: null,
    integrityError: null,
    sandbox: null,
  };
}

function service(executables: DoctorExecutables = { git, node }) {
  const run = vi.fn<ICommandRunner['run']>(async (request) => {
    const executable = request.executable as ExecutableDescriptor;
    if (request.args?.[0] === 'rev-parse') return result(executable, 'true\n');
    return result(executable, executable === git ? 'git version 2.40\n' : 'v20.0.0\n');
  });
  const registry = { list: () => [] } as unknown as AdapterRegistry;
  const commandRunner: ICommandRunner = {
    run,
    start: () => { throw new Error('not used'); },
  };
  return { doctor: new DoctorService(registry, commandRunner, executables, '/tmp/project'), run };
}

describe('DoctorService', () => {
  it('runs checks through pinned executables with bounded safe requests', async () => {
    const { doctor, run } = service();

    const report = await doctor.runAll();

    expect(report.checks).toEqual(expect.arrayContaining([
      { name: 'git', status: 'ok', detail: 'git version 2.40' },
      { name: 'git repo', status: 'ok', detail: 'git repository detected' },
      { name: 'node', status: 'ok', detail: 'v20.0.0' },
    ]));
    expect(run).toHaveBeenCalledTimes(3);
    for (const [request] of run.mock.calls) {
      expect(request.executable).toMatchObject({ path: expect.stringMatching(/^\//), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(request).toMatchObject({ timeoutMs: 10_000, maxStdoutBytes: 64 * 1024, maxStderrBytes: 64 * 1024 });
      expect(request.env).toEqual(expect.objectContaining({ GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }));
      expect(request.env).not.toHaveProperty('NODE_OPTIONS');
    }
  });

  it('reports unavailable executables without attempting to run them', async () => {
    const { doctor, run } = service({});

    const report = await doctor.runAll();

    expect(report.checks).toEqual(expect.arrayContaining([
      { name: 'git', status: 'fail', detail: 'git: command not found' },
      { name: 'node', status: 'fail', detail: 'node: command not found' },
    ]));
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed when a command exceeds its limits or exits unsuccessfully', async () => {
    const { doctor, run } = service();
    run.mockResolvedValue(result(git, '', false));

    const report = await doctor.runAll();

    expect(report.checks.find((check) => check.name === 'git')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'git repo')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'node')?.status).toBe('fail');
  });
});
