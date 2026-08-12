import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewRunner, type ReviewRunnerExecutables } from '../../../src/application/review-runner.js';
import type { ReviewResult } from '../../../src/domain/task.js';
import type { CommandResult, ICommandRunner } from '../../../src/infrastructure/process/command-runner.js';

const executables: ReviewRunnerExecutables = {
  npm: descriptor('/opt/bin/npm'),
  npx: descriptor('/opt/bin/npx'),
  node: descriptor('/opt/bin/node'),
};

function descriptor(executablePath: string) {
  return { path: executablePath, realpath: executablePath, sha256: 'a'.repeat(64) };
}

function commandResult(stdout: string, stderr = '', ok = true): CommandResult {
  return {
    executable: executables.npm.realpath,
    executableDescriptor: executables.npm,
    args: [],
    cwd: '/tmp/test',
    pid: 1,
    ok,
    termination: 'exited',
    exitCode: ok ? 0 : 1,
    signal: null,
    stdout,
    stderr,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    spawnError: null,
    integrityError: null,
    sandbox: null,
  };
}

describe('ReviewRunner', () => {
  let run: ReturnType<typeof vi.fn<ICommandRunner['run']>>;
  let commandRunner: ICommandRunner;
  const safeguards = {
    assertReady: vi.fn(async () => ({})),
    executableAllowlist: vi.fn(async () => Object.values(executables)),
    proxyEndpoint: vi.fn(async () => ({ host: '127.0.0.1', port: 4321 })),
  };

  beforeEach(() => {
    run = vi.fn<ICommandRunner['run']>();
    commandRunner = {
      run,
      start: () => { throw new Error('not used'); },
    };
  });

  describe('runAll', () => {
    it('runs all criteria in staged order', async () => {
      run.mockResolvedValueOnce(commandResult('No errors found'));
      run.mockResolvedValueOnce(commandResult('All tests passed'));
      const runner = new ReviewRunner({ cwd: '/tmp/test' }, commandRunner, executables, safeguards, 'tsk_review');

      const results = await runner.runAll(['test_pass', 'typecheck']);

      expect(results).toEqual([
        { criterion: 'typecheck', passed: true, output: 'No errors found' },
        { criterion: 'test_pass', passed: true, output: 'All tests passed' },
      ]);
      expect(run.mock.calls.map(([request]) => request.executable)).toEqual([executables.npx, executables.npm]);
    });

    it('sorts criteria: typecheck, lint, test_pass', async () => {
      run.mockResolvedValue(commandResult('ok'));
      const runner = new ReviewRunner({ cwd: '/tmp/test' }, commandRunner, executables, safeguards, 'tsk_review');

      const results = await runner.runAll(['test_pass', 'lint', 'typecheck']);

      expect(results.map((result) => result.criterion)).toEqual(['typecheck', 'lint', 'test_pass']);
    });

    it('stops on first failure by default', async () => {
      run.mockResolvedValueOnce(commandResult('', 'error TS2345', false));
      const runner = new ReviewRunner({ cwd: '/tmp/test' }, commandRunner, executables, safeguards, 'tsk_review');

      const results = await runner.runAll(['test_pass', 'typecheck', 'lint']);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ criterion: 'typecheck', passed: false });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('runs all criteria when fail_fast is false', async () => {
      run.mockResolvedValue(commandResult('', 'failed', false));
      const runner = new ReviewRunner({ cwd: '/tmp/test', fail_fast: false }, commandRunner, executables, safeguards, 'tsk_review');

      const results = await runner.runAll(['test_pass', 'typecheck', 'lint']);

      expect(results).toHaveLength(3);
      expect(results.every((result) => !result.passed)).toBe(true);
    });

    it('uses bounded execution and an explicit safe environment', async () => {
      run.mockResolvedValue(commandResult('ok'));
      const runner = new ReviewRunner({ cwd: '/my/project', timeout_ms: 60_000 }, commandRunner, executables, safeguards, 'tsk_review');

      await runner.runAll(['test_pass']);

      expect(run).toHaveBeenCalledWith(expect.objectContaining({
        executable: executables.npm,
        args: ['test'],
        cwd: '/my/project',
        timeoutMs: 60_000,
        maxStdoutBytes: 1024 * 1024,
        maxStderrBytes: 1024 * 1024,
        env: expect.objectContaining({ CI: '1', NO_COLOR: '1' }),
        allowedExecutables: [executables.npm, executables.npx, executables.node],
        owner: 'tsk_review',
        sandbox: expect.objectContaining({ workspace: '/my/project' }),
      }));
      expect(run.mock.calls[0]![0].env).not.toHaveProperty('NODE_OPTIONS');
      expect(run.mock.calls[0]![0].env?.PATH).toBe('/opt/bin:/usr/bin:/bin:/usr/sbin:/sbin');
    });

    it('rejects an unbounded timeout', () => {
      expect(() => new ReviewRunner({ cwd: '/tmp/test', timeout_ms: 600_001 }, commandRunner, executables, safeguards, 'tsk_review'))
        .toThrow('timeout_ms');
    });

    it('fails closed when command execution rejects', async () => {
      run.mockRejectedValueOnce(new Error('Executable SHA-256 changed'));
      const runner = new ReviewRunner({ cwd: '/tmp/test' }, commandRunner, executables, safeguards, 'tsk_review');

      const results = await runner.runAll(['test_pass']);

      expect(results).toEqual([{ criterion: 'test_pass', passed: false, output: 'Executable SHA-256 changed' }]);
    });

    it('truncates and redacts persisted output', async () => {
      run.mockResolvedValue(commandResult(`Authorization: Bearer secret-token\n${'x'.repeat(3000)}`, 'api_key="supersecret12345"', false));
      const runner = new ReviewRunner({ cwd: '/tmp/test' }, commandRunner, executables, safeguards, 'tsk_review');

      const [result] = await runner.runAll(['test_pass']);

      expect(result!.output.length).toBeLessThanOrEqual(2000);
      expect(result!.output).toContain('Authorization: Bearer [REDACTED]');
      expect(result!.output).not.toContain('secret-token');
      expect(result!.output).not.toContain('supersecret12345');
    });
  });

  describe('allPassed', () => {
    it('requires at least one result and all results passing', () => {
      expect(ReviewRunner.allPassed([{ criterion: 'test_pass', passed: true, output: 'ok' }])).toBe(true);
      expect(ReviewRunner.allPassed([{ criterion: 'typecheck', passed: false, output: 'error' }])).toBe(false);
      expect(ReviewRunner.allPassed([])).toBe(false);
    });
  });

  describe('formatReport', () => {
    it('formats mixed results', () => {
      const results: ReviewResult[] = [
        { criterion: 'test_pass', passed: true, output: 'ok' },
        { criterion: 'typecheck', passed: false, output: 'fail' },
      ];

      const report = ReviewRunner.formatReport(results);

      expect(report).toContain('✓ test_pass: PASSED');
      expect(report).toContain('✗ typecheck: FAILED');
    });
  });
});
