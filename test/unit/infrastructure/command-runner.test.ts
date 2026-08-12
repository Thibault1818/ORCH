import { describe, expect, it } from 'vitest';
import { CommandRunner, requireExecutable } from '../../../src/infrastructure/process/command-runner.js';
import { ProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import { readLines } from '../../../src/infrastructure/process/process-manager.js';

describe('CommandRunner', () => {
  const runner = new CommandRunner(new ProcessManager());

  it('requires absolute executables and preserves stdin without a shell', async () => {
    await expect(runner.run({ executable: 'node', args: [], timeoutMs: 1000, maxStdoutBytes: 1000, maxStderrBytes: 1000 })).rejects.toThrow('absolute executable');
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdin.pipe(process.stdout)'],
      stdin: 'literal; $(not-a-shell)',
      env: {},
      timeoutMs: 1000,
      maxStdoutBytes: 1000,
      maxStderrBytes: 1000,
    });
    expect(result).toMatchObject({ ok: true, termination: 'exited', stdout: 'literal; $(not-a-shell)' });
    expect(result.stdoutBuffer).toEqual(Buffer.from('literal; $(not-a-shell)'));
  });

  it('uses only the supplied environment', async () => {
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
      env: { SAFE_VALUE: 'yes' },
      timeoutMs: 1000,
      maxStdoutBytes: 10000,
      maxStderrBytes: 1000,
    });
    const env = JSON.parse(result.stdout) as Record<string, string>;
    expect(env.SAFE_VALUE).toBe('yes');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.HOME).toBeUndefined();
  });

  it('preserves bounded binary stdout bytes', async () => {
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(Buffer.from([0, 255, 128, 10]))'],
      env: {},
      timeoutMs: 1000,
      maxStdoutBytes: 100,
      maxStderrBytes: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.stdoutBuffer).toEqual(Buffer.from([0, 255, 128, 10]));
  });

  it('supports inherited stdio for interactive commands', async () => {
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.exit(0)'],
      env: {},
      stdio: 'inherit',
      timeoutMs: 1000,
      maxStdoutBytes: 1,
      maxStderrBytes: 1,
    });
    expect(result).toMatchObject({ ok: true, stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0 });
  });

  it('rejects supplied stdin with inherited stdio', async () => {
    await expect(runner.run({
      executable: process.execPath,
      stdin: 'input',
      stdio: 'inherit',
      timeoutMs: 1000,
      maxStdoutBytes: 1,
      maxStderrBytes: 1,
    })).rejects.toThrow('stdin cannot be supplied');
  });

  it('caps output by bytes and terminates the process', async () => {
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(10000)); setInterval(() => {}, 1000)'],
      env: {},
      timeoutMs: 5000,
      maxStdoutBytes: 32,
      maxStderrBytes: 32,
      killGraceMs: 50,
    });
    expect(result).toMatchObject({ ok: false, termination: 'stdout_limit', stdoutTruncated: true });
    expect(Buffer.byteLength(result.stdout)).toBe(32);
  });

  it('times out and cleans up the child process', async () => {
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      env: {},
      timeoutMs: 50,
      maxStdoutBytes: 100,
      maxStderrBytes: 100,
      killGraceMs: 50,
    });
    expect(result).toMatchObject({ ok: false, termination: 'timed_out' });
  });

  it('resolves PATH commands once to a canonical absolute executable', async () => {
    const resolved = await requireExecutable('node');
    expect(resolved.startsWith('/')).toBe(true);
  });

  it('starts streaming commands with pinned executables and stdin', async () => {
    const command = runner.start({
      executable: process.execPath,
      args: ['-e', 'process.stdin.pipe(process.stdout)'],
      stdin: 'streamed input',
      env: {},
    });
    const lines: string[] = [];
    for await (const line of readLines(command.process.stdout!)) lines.push(line);
    await expect(command.completion).resolves.toMatchObject({ ok: true, termination: 'exited' });
    expect(lines).toEqual(['streamed input']);
    expect(command.executableDescriptor.realpath.startsWith('/')).toBe(true);
  });

  it('terminates a streaming command on abort', async () => {
    const controller = new AbortController();
    const command = runner.start({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      env: {},
      signal: controller.signal,
      killGraceMs: 50,
    });
    controller.abort();
    await expect(command.completion).resolves.toMatchObject({ ok: false, termination: 'timed_out' });
  });
});
