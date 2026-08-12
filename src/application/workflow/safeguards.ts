import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { domainToASCII } from 'node:url';
import { CommandRunner, resolveExecutable, verifyExecutable, type ExecutableDescriptor, type ICommandRunner } from '../../infrastructure/process/command-runner.js';
import type { IProcessManager } from '../../infrastructure/process/process-manager.js';
import { EndpointProxy, type EndpointProxyAddress, type EndpointProxyTarget } from '../../infrastructure/security/endpoint-proxy.js';
import { generateMacosSandboxProfile, macosSandboxPolicy } from '../../infrastructure/security/macos-sandbox.js';
import { HardenedGit } from '../../infrastructure/git/hardened-git.js';

const ATTESTATION_MAX_AGE_MS = 24 * 60 * 60_000;
const DEFAULT_ENDPOINTS: readonly EndpointProxyTarget[] = [
  { host: 'api.openai.com', port: 443 },
  { host: 'api.anthropic.com', port: 443 },
  { host: 'openrouter.ai', port: 443 },
  { host: '127.0.0.1', port: 11434 },
];

export interface SafeguardCheck { name: string; passed: boolean; detail: string }
export interface SafeguardReport {
  schema_version: 1;
  project_root: string;
  state_root: string;
  workspace_root: string;
  platform: string;
  checked_at: string;
  policy_hash: string;
  executables: ExecutableDescriptor[];
  endpoints: EndpointProxyTarget[];
  checks: SafeguardCheck[];
  ready: boolean;
}
interface SignedAttestation { report: SafeguardReport; signature: string }

export class WorkflowSafeguards {
  private readonly proxyCache = new Map<string, Promise<{ proxy: EndpointProxy; address: EndpointProxyAddress }>>();

  constructor(
    private readonly projectRoot: string,
    private readonly stateRoot: string,
    private readonly workspaceRoot: string,
    private readonly runner: ICommandRunner,
    private readonly processes: IProcessManager,
  ) {}

  get attestationPath(): string { return path.join(this.stateRoot, 'workflow-doctor-attestation.json'); }

  async endpoints(): Promise<EndpointProxyTarget[]> {
    const configured = process.env.ORCHESTRY_MODEL_ENDPOINTS;
    const values = !configured?.trim() ? DEFAULT_ENDPOINTS : configured.split(',').filter(Boolean).map((entry) => {
      const match = /^([^:\s]+):(\d+)$/.exec(entry.trim());
      if (!match) throw new Error(`Invalid ORCHESTRY_MODEL_ENDPOINTS entry: ${entry}`);
      return { host: match[1]!, port: Number(match[2]) };
    });
    return normalizeEndpoints(values);
  }

  async proxyEndpoint(): Promise<EndpointProxyAddress> {
    const attestation = await this.assertReady();
    return this.proxyForEndpoints(attestation.endpoints, attestation.policy_hash);
  }

  private async proxyForEndpoints(endpoints: readonly EndpointProxyTarget[], policyKey = canonicalHash(normalizeEndpoints(endpoints))): Promise<EndpointProxyAddress> {
    const key = policyKey;
    let cached = this.proxyCache.get(key);
    if (!cached) {
      const proxy = new EndpointProxy({ allowlist: endpoints });
      cached = proxy.start().then((address) => ({ proxy, address })).catch((error) => {
        this.proxyCache.delete(key);
        throw error;
      });
      this.proxyCache.set(key, cached);
    }
    return (await cached).address;
  }

  async executableAllowlist(extra: readonly string[] = []): Promise<ExecutableDescriptor[]> {
    const descriptors = await this.discoverExecutables(extra);
    await this.assertExecutablesAttested(descriptors);
    return descriptors;
  }

  async runDoctor(): Promise<SafeguardReport> {
    const checks: SafeguardCheck[] = [];
    const record = async (name: string, action: () => Promise<string>) => {
      try { checks.push({ name, passed: true, detail: await action() }); }
      catch (error) { checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) }); }
    };
    const executables = await this.discoverExecutables();
    const endpoints = await this.endpoints();
    await record('platform', async () => {
      if (process.platform !== 'darwin') throw new Error('real-project workflow requires macOS sandbox-exec');
      const sandbox = executables.find((value) => value.realpath === '/usr/bin/sandbox-exec');
      if (!sandbox) throw new Error('sandbox-exec is missing from the attested executable policy');
      await verifyExecutable(sandbox);
      return 'macOS sandbox-exec is pinned';
    });
    await record('root-separation', async () => {
      const roots = [this.projectRoot, this.stateRoot, this.workspaceRoot].map((value) => path.resolve(value));
      if (roots.some((left, index) => roots.some((right, other) => index !== other && contains(left, right))))
        throw new Error('project, state, and workspace roots must not contain each other');
      await Promise.all([this.stateRoot, this.workspaceRoot].map((value) => fs.mkdir(value, { recursive: true, mode: 0o700 })));
      return 'controller state and clones are external and disjoint';
    });
    await record('executable-integrity', async () => {
      await Promise.all(executables.map(verifyExecutable));
      return `${executables.length} executable paths pinned by SHA-256`;
    });
    await record('git-hardening', async () => {
      const git = executables.find((value) => path.basename(value.path) === 'git' || path.basename(value.realpath) === 'git');
      if (!git) throw new Error('git executable is unavailable');
      const hardened = new HardenedGit(this.runner, git, { configRoot: path.join(this.stateRoot, 'git-doctor') });
      const version = await hardened.run(this.projectRoot, ['version']);
      return version.trim();
    });
    await record('sandbox-adversarial', async () => this.adversarialSandboxProbe(executables));
    await record('process-quiescence', async () => {
      const owner = 'workflow-doctor';
      await this.processes.awaitQuiescent?.(owner, 1_000);
      if (this.processes.active?.(owner).length) throw new Error('process registry is not quiescent');
      return 'owner process groups are quiescent';
    });
    const report: SafeguardReport = {
      schema_version: 1,
      project_root: await fs.realpath(this.projectRoot),
      state_root: path.resolve(this.stateRoot),
      workspace_root: path.resolve(this.workspaceRoot),
      platform: `${process.platform}-${process.arch}`,
      checked_at: new Date().toISOString(),
      policy_hash: policyHash(endpoints, executables),
      executables,
      endpoints,
      checks,
      ready: checks.every((check) => check.passed),
    };
    if (report.ready) await this.writeAttestation(report);
    else await fs.rm(this.attestationPath, { force: true });
    return report;
  }

  async assertReady(): Promise<SafeguardReport> {
    const value = await this.readVerifiedAttestation();
    if (Date.now() - Date.parse(value.report.checked_at) > ATTESTATION_MAX_AGE_MS) throw new Error('Real-project mode is blocked: workflow doctor attestation expired');
    if (value.report.project_root !== await fs.realpath(this.projectRoot) || value.report.state_root !== path.resolve(this.stateRoot) || value.report.workspace_root !== path.resolve(this.workspaceRoot))
      throw new Error('Real-project mode is blocked: workflow doctor attestation belongs to different roots');
    const [endpoints, executables] = await Promise.all([this.endpoints(), this.discoverExecutables()]);
    if (!safeEqual(policyHash(endpoints, executables), value.report.policy_hash)) throw new Error('Real-project mode is blocked: workflow doctor policy drift detected');
    await Promise.all(executables.map(verifyExecutable));
    return value.report;
  }

  async assertQuiescent(owner: string): Promise<void> {
    if (!this.processes.awaitQuiescent || !this.processes.active) throw new Error('Approval requires process-group quiescence support');
    await this.processes.awaitQuiescent(owner, 10_000);
    if (this.processes.active(owner).length) throw new Error(`Approval blocked while agent process groups remain active: ${owner}`);
  }

  async runQuiescent<T>(owner: string, action: () => Promise<T>): Promise<T> {
    if (!this.processes.runQuiescent) throw new Error('Operation requires atomic process-group quiescence support');
    return this.processes.runQuiescent(owner, action, 10_000);
  }

  private async adversarialSandboxProbe(executables: ExecutableDescriptor[]): Promise<string> {
    const root = await fs.mkdtemp(path.join(this.workspaceRoot, 'doctor-probe-'));
    const outside = path.join(this.stateRoot, `doctor-forbidden-${Date.now()}`);
    const proxy = await this.proxyForEndpoints(await this.endpoints());
    const node = executables.find((value) => path.basename(value.realpath) === 'node');
    if (!node) throw new Error('pinned Node executable is unavailable');
    try {
      const result = await this.runner.run({
        executable: node,
        args: ['-e', `const fs=require('fs');let denied=0;try{fs.writeFileSync(${JSON.stringify(outside)},'forged')}catch{denied++}const net=require('net');const s=net.connect(9,'1.1.1.1');s.on('error',()=>{denied++;if(denied===2)process.exit(0)});setTimeout(()=>process.exit(2),1000)`],
        cwd: root,
        env: {},
        timeoutMs: 3_000,
        maxStdoutBytes: 4_096,
        maxStderrBytes: 4_096,
        allowedExecutables: [node],
        sandbox: { workspace: root, proxyAddress: proxy, writableWorkspace: true },
        owner: 'workflow-doctor',
      });
      if (!result.ok) throw new Error(`sandbox adversarial probe failed to execute: ${result.stderr || result.termination}`);
      if (await fs.stat(outside).then(() => true).catch(() => false)) throw new Error('sandbox filesystem escape probe succeeded');
      const unpinned = await this.runner.run({
        executable: node,
        args: ['-e', `const r=require('child_process').spawnSync('/usr/bin/id',[],{stdio:'ignore'});process.exit(r.error?0:2)`],
        cwd: root,
        env: {},
        timeoutMs: 3_000,
        maxStdoutBytes: 4_096,
        maxStderrBytes: 4_096,
        allowedExecutables: [node],
        sandbox: { workspace: root, proxyAddress: proxy, writableWorkspace: true },
        owner: 'workflow-doctor',
      });
      if (!unpinned.ok) throw new Error('unpinned executable probe was not denied');
      const profile = generateMacosSandboxProfile({ workspace: root, proxyAddress: proxy, writableWorkspace: true, allowedExecutablePaths: [node.realpath] });
      if (!profile.includes('(deny network*)')) throw new Error('sandbox profile is not deny-by-default');
      return 'filesystem escape, direct network, and unpinned execution denied';
    } finally {
      await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { force: true })]);
    }
  }

  private async discoverExecutables(extra: readonly string[] = []): Promise<ExecutableDescriptor[]> {
    const names = new Set(['/usr/bin/sandbox-exec', 'git', 'node', 'npm', 'npx', 'sh', 'bash', 'env', 'codex', 'claude', 'opencode', ...extra]);
    for (const value of process.env.ORCHESTRY_EXECUTABLE_ALLOWLIST?.split(path.delimiter).filter(Boolean) ?? []) names.add(value);
    const descriptors: ExecutableDescriptor[] = [];
    for (const name of names) {
      try { descriptors.push(await resolveExecutable(name)); } catch { /* unavailable providers are reported elsewhere */ }
    }
    const bin = path.join(this.projectRoot, 'node_modules', '.bin');
    for (const name of (await fs.readdir(bin).catch(() => [])).sort()) {
      try { descriptors.push(await resolveExecutable(path.join(bin, name))); } catch { /* non-executable entry */ }
    }
    const unique = [...new Map(descriptors.map((value) => [value.realpath, value])).values()]
      .sort((left, right) => left.realpath.localeCompare(right.realpath));
    await Promise.all(unique.map(verifyExecutable));
    return unique;
  }

  private async assertExecutablesAttested(executables: readonly ExecutableDescriptor[]): Promise<void> {
    const value = await this.readVerifiedAttestation();
    const attested = new Map(value.report.executables.map((descriptor) => [descriptor.realpath, descriptor]));
    for (const descriptor of executables) {
      const approved = attested.get(descriptor.realpath);
      if (!approved || canonicalJson(approved) !== canonicalJson(descriptor)) {
        throw new Error(`Real-project mode is blocked: executable was not attested by workflow doctor: ${descriptor.realpath}`);
      }
    }
  }

  private async readVerifiedAttestation(): Promise<SignedAttestation> {
    const value = JSON.parse(await fs.readFile(this.attestationPath, 'utf8').catch(() => { throw new Error('Real-project mode is blocked: run orch workflow doctor'); })) as SignedAttestation;
    if (!value?.report || typeof value.signature !== 'string' || typeof value.report.policy_hash !== 'string' || !safeEqual(sign(value.report, await this.key()), value.signature) || !value.report.ready) {
      throw new Error('Real-project mode is blocked: workflow doctor attestation is invalid');
    }
    return value;
  }

  private async writeAttestation(report: SafeguardReport): Promise<void> {
    await fs.mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
    const value: SignedAttestation = { report, signature: sign(report, await this.key()) };
    const temporary = `${this.attestationPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.attestationPath);
  }

  private async key(): Promise<Buffer> {
    const file = path.join(this.stateRoot, 'controller-attestation.key');
    await fs.mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Controller attestation key permissions are unsafe');
      return fs.readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const key = randomBytes(32);
      await fs.writeFile(file, key, { mode: 0o600, flag: 'wx' });
      return key;
    }
  }
}

function sign(value: unknown, key: Buffer): string { return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex'); }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex'); return a.length === b.length && timingSafeEqual(a, b); }
function contains(root: string, candidate: string): boolean { const relative = path.relative(path.resolve(root), path.resolve(candidate)); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }

function policyHash(endpoints: readonly EndpointProxyTarget[], executables: readonly ExecutableDescriptor[]): string {
  return canonicalHash({
    endpoints: normalizeEndpoints(endpoints),
    executables: [...executables].map((value) => ({ path: path.resolve(value.path), realpath: path.resolve(value.realpath), sha256: value.sha256 })).sort((left, right) => left.realpath.localeCompare(right.realpath)),
    sandbox: macosSandboxPolicy(),
  });
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeEndpoints(values: readonly EndpointProxyTarget[]): EndpointProxyTarget[] {
  const normalized = values.map((value) => {
    const raw = value.host.startsWith('[') && value.host.endsWith(']') ? value.host.slice(1, -1) : value.host;
    const host = net.isIP(raw) ? raw.toLowerCase() : domainToASCII(raw.replace(/\.$/, '')).toLowerCase();
    if (!host || (!net.isIP(host) && !host.split('.').every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label)))) throw new Error(`Invalid endpoint host: ${value.host}`);
    if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65_535) throw new Error(`Invalid endpoint port: ${value.port}`);
    return { host, port: value.port };
  });
  const unique = new Map<string, EndpointProxyTarget>();
  for (const value of normalized) {
    const key = `${net.isIP(value.host) === 6 ? `[${value.host}]` : value.host}:${value.port}`;
    if (unique.has(key)) throw new Error(`Duplicate endpoint policy entry: ${key}`);
    unique.set(key, value);
  }
  return [...unique.values()].sort((left, right) => left.host.localeCompare(right.host) || left.port - right.port);
}
