import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowSafeguards } from '../../src/application/workflow/safeguards.js';
import { CommandRunner } from '../../src/infrastructure/process/command-runner.js';
import { ProcessManager } from '../../src/infrastructure/process/process-manager.js';
import { resolveExecutable } from '../../src/infrastructure/process/command-runner.js';

let project: string;
let state: string;
let workspaces: string;
let safeguards: WorkflowSafeguards;
let modelEndpoints: string | undefined;
let executableAllowlist: string | undefined;

beforeEach(async () => {
  modelEndpoints = process.env.ORCHESTRY_MODEL_ENDPOINTS;
  executableAllowlist = process.env.ORCHESTRY_EXECUTABLE_ALLOWLIST;
  delete process.env.ORCHESTRY_MODEL_ENDPOINTS;
  delete process.env.ORCHESTRY_EXECUTABLE_ALLOWLIST;
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-safe-project-'));
  state = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-safe-state-'));
  workspaces = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-safe-clones-'));
  const processes = new ProcessManager();
  safeguards = new WorkflowSafeguards(project, state, workspaces, new CommandRunner(processes), processes);
});

afterEach(async () => {
  if (modelEndpoints === undefined) delete process.env.ORCHESTRY_MODEL_ENDPOINTS;
  else process.env.ORCHESTRY_MODEL_ENDPOINTS = modelEndpoints;
  if (executableAllowlist === undefined) delete process.env.ORCHESTRY_EXECUTABLE_ALLOWLIST;
  else process.env.ORCHESTRY_EXECUTABLE_ALLOWLIST = executableAllowlist;
  await Promise.all([project, state, workspaces].map((value) => fs.rm(value, { recursive: true, force: true })));
});

describe.runIf(process.platform === 'darwin')('workflow safeguards', () => {
  it('passes real sandbox escape, persistence, executable, network, and quiescence probes', async () => {
    const report = await safeguards.runDoctor();
    expect(report.ready).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    await expect(safeguards.assertReady()).resolves.toMatchObject({ ready: true });
  }, 20_000);

  it('rejects approval-forgery by modifying the signed doctor report', async () => {
    expect((await safeguards.runDoctor()).ready).toBe(true);
    const file = safeguards.attestationPath;
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as { report: { ready: boolean }; signature: string };
    value.report.ready = false;
    await fs.writeFile(file, JSON.stringify(value));
    await expect(safeguards.assertReady()).rejects.toThrow('attestation is invalid');
  }, 20_000);

  it('rejects endpoint policy drift after doctor attestation', async () => {
    expect((await safeguards.runDoctor()).ready).toBe(true);
    process.env.ORCHESTRY_MODEL_ENDPOINTS = 'api.openai.com:443,example.com:443';
    await expect(safeguards.assertReady()).rejects.toThrow('policy drift');
    await expect(safeguards.proxyEndpoint()).rejects.toThrow('policy drift');
  }, 20_000);

  it('rejects executable policy drift and dynamic executable expansion', async () => {
    expect((await safeguards.runDoctor()).ready).toBe(true);
    process.env.ORCHESTRY_EXECUTABLE_ALLOWLIST = '/usr/bin/id';
    await expect(safeguards.assertReady()).rejects.toThrow('policy drift');
    await expect(safeguards.executableAllowlist(['/usr/bin/id'])).rejects.toThrow('executable was not attested');
  }, 20_000);

  it('blocks approval while an owner-tagged process group is still active', async () => {
    const processes = new ProcessManager();
    const guarded = new WorkflowSafeguards(project, state, workspaces, new CommandRunner(processes), processes);
    const node = await resolveExecutable('node');
    const handle = new CommandRunner(processes).start({ executable: node, args: ['-e', 'setTimeout(() => {}, 30000)'], env: {}, owner: 'wf_active' });
    await expect(guarded.assertQuiescent('wf_active')).rejects.toThrow('Timed out');
    await processes.killWithGrace(handle.pid, 20);
    await handle.completion;
    await expect(guarded.assertQuiescent('wf_active')).resolves.toBeUndefined();
  }, 15_000);
});
