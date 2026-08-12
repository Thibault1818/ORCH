import { HardenedGit } from './chunk-47ZZP7VU.js';
import { verifyExecutable, generateMacosSandboxProfile, resolveExecutable, macosSandboxPolicy } from './chunk-OBMT332P.js';
import { randomBytes, createHmac, timingSafeEqual, createHash } from 'crypto';
import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import { domainToASCII } from 'url';
import dns from 'dns/promises';
import http from 'http';

var HOP_HEADERS = /* @__PURE__ */ new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
var EndpointProxy = class {
  server;
  configured = /* @__PURE__ */ new Map();
  resolved = /* @__PURE__ */ new Map();
  sockets = /* @__PURE__ */ new Set();
  listenHost;
  listenPort;
  connectTimeoutMs;
  resolveHost;
  started = false;
  constructor(options) {
    this.listenHost = normalizeIp(options.listenHost ?? "127.0.0.1");
    if (!isLoopback(this.listenHost)) throw new Error("Endpoint proxy must listen on a numeric loopback address");
    this.listenPort = validPort(options.listenPort ?? 0, true);
    this.connectTimeoutMs = options.connectTimeoutMs ?? 1e4;
    if (!Number.isSafeInteger(this.connectTimeoutMs) || this.connectTimeoutMs < 1) throw new Error("connectTimeoutMs must be a positive integer");
    this.resolveHost = options.resolve ?? resolveHost;
    for (const target of options.allowlist) {
      const normalized = normalizeTarget(target);
      const key = targetKey(normalized.host, normalized.port);
      if (this.configured.has(key)) throw new Error(`Duplicate proxy allowlist endpoint: ${key}`);
      this.configured.set(key, normalized);
    }
    this.server = http.createServer((request, response) => void this.handleHttp(request, response));
    this.server.on("connect", (request, socket, head) => void this.handleConnect(request, socket, head));
    this.server.on("upgrade", (_request, socket) => socket.destroy());
    this.server.on("connection", (socket) => this.track(socket));
  }
  async start() {
    if (this.started) return this.address();
    for (const [key, target] of this.configured) {
      const addresses = await this.resolveHost(target.host);
      const safe = uniqueAddresses(addresses);
      if (safe.length === 0) throw new Error(`Proxy endpoint did not resolve: ${target.host}`);
      this.resolved.set(key, { ...target, addresses: safe });
    }
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(this.listenPort, this.listenHost, () => {
        this.server.unref();
        this.server.off("error", onError);
        resolve();
      });
    });
    this.started = true;
    return this.address();
  }
  address() {
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Endpoint proxy is not listening");
    return { host: normalizeIp(address.address), port: address.port };
  }
  async close() {
    for (const socket of this.sockets) socket.destroy();
    if (!this.server.listening) {
      this.started = false;
      return;
    }
    await new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
    this.started = false;
  }
  async handleConnect(request, client, head) {
    try {
      const authority = parseAuthority(request.url ?? "");
      const target = this.allowed(authority.host, authority.port);
      const upstream = await this.connect(target);
      this.track(upstream);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    } catch (error) {
      if (!client.destroyed) client.end(`HTTP/1.1 ${isDenied(error) ? "403 Forbidden" : "502 Bad Gateway"}\r
Connection: close\r
\r
`);
    }
  }
  async handleHttp(request, response) {
    try {
      const targetUrl = proxyUrl(request);
      if (targetUrl.protocol !== "http:" || targetUrl.username || targetUrl.password || targetUrl.hash) throw new ProxyDeniedError("Only unauthenticated HTTP proxy URLs are supported");
      const port = validPort(targetUrl.port ? Number(targetUrl.port) : 80);
      const host = normalizeHost(targetUrl.hostname);
      const target = this.allowed(host, port);
      const address = target.addresses[0];
      const upstream = http.request({
        host: address.address,
        family: address.family,
        port,
        method: request.method,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        headers: forwardHeaders(request.headers, hostHeader(host, port)),
        agent: false,
        timeout: this.connectTimeoutMs
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, forwardHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(response);
      });
      upstream.once("timeout", () => upstream.destroy(new Error("Proxy upstream timed out")));
      upstream.once("error", () => {
        if (!response.headersSent) response.writeHead(502, { connection: "close" });
        response.end();
      });
      request.pipe(upstream);
    } catch (error) {
      response.writeHead(isDenied(error) ? 403 : 502, { connection: "close" });
      response.end();
    }
  }
  allowed(host, port) {
    const target = this.resolved.get(targetKey(normalizeHost(host), port));
    if (!target) throw new ProxyDeniedError(`Proxy endpoint is not allowlisted: ${host}:${port}`);
    return target;
  }
  async connect(target) {
    let lastError = null;
    for (const address of target.addresses) {
      try {
        return await connectAddress(address, target.port, this.connectTimeoutMs);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error("Proxy endpoint connection failed");
  }
  track(socket) {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
  }
};
var ProxyDeniedError = class extends Error {
};
async function resolveHost(host) {
  const ip = net.isIP(host);
  if (ip === 4 || ip === 6) return [{ address: host, family: ip }];
  const values = await dns.lookup(host, { all: true, verbatim: true });
  return values.map((value) => {
    if (value.family !== 4 && value.family !== 6) throw new Error(`Resolver returned an invalid address family: ${value.family}`);
    return { address: value.address, family: value.family };
  });
}
function connectAddress(address, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address.address, family: address.family, port });
    const timer = setTimeout(() => socket.destroy(new Error("Proxy endpoint connection timed out")), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
function proxyUrl(request) {
  const value = request.url ?? "";
  if (/^http:\/\//i.test(value)) return new URL(value);
  const host = request.headers.host;
  if (!host || !value.startsWith("/")) throw new ProxyDeniedError("Proxy request target is invalid");
  return new URL(`http://${host}${value}`);
}
function parseAuthority(value) {
  if (!value || /[\s/@?#]/.test(value)) throw new ProxyDeniedError("CONNECT authority is invalid");
  const bracketed = /^\[([^\]]+)]:(\d+)$/.exec(value);
  const plain = /^([^:]+):(\d+)$/.exec(value);
  const match = bracketed ?? plain;
  if (!match) throw new ProxyDeniedError("CONNECT requires an explicit host and port");
  return normalizeTarget({ host: match[1], port: Number(match[2]) });
}
function normalizeTarget(target) {
  return { host: normalizeHost(target.host), port: validPort(target.port) };
}
function normalizeHost(value) {
  const unwrapped = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  const ip = normalizeIp(unwrapped);
  if (net.isIP(ip)) return ip;
  const ascii = domainToASCII(unwrapped.replace(/\.$/, "")).toLowerCase();
  if (!ascii || ascii.length > 253 || !ascii.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) {
    throw new Error(`Invalid endpoint host: ${value}`);
  }
  return ascii;
}
function normalizeIp(value) {
  const unwrapped = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return unwrapped.toLowerCase();
}
function uniqueAddresses(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const value of values) {
    const address = normalizeIp(value.address);
    const family = net.isIP(address);
    if (family !== value.family || family !== 4 && family !== 6) throw new Error(`Resolver returned an invalid address: ${value.address}`);
    const key = `${family}:${address}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ address, family });
    }
  }
  return result;
}
function forwardHeaders(headers, host) {
  const connectionTokens = new Set((headers.connection ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === "host" || HOP_HEADERS.has(lower) || connectionTokens.has(lower)) continue;
    result[lower] = value;
  }
  if (host) result.host = host;
  return result;
}
function hostHeader(host, port) {
  const formatted = net.isIP(host) === 6 ? `[${host}]` : host;
  return port === 80 ? formatted : `${formatted}:${port}`;
}
function targetKey(host, port) {
  return `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}
function validPort(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) throw new Error(`Invalid endpoint port: ${value}`);
  return value;
}
function isLoopback(host) {
  if (net.isIP(host) === 4) return host.startsWith("127.");
  return net.isIP(host) === 6 && (host === "::1" || host === "0:0:0:0:0:0:0:1");
}
function isDenied(error) {
  return error instanceof ProxyDeniedError;
}

// src/application/workflow/safeguards.ts
var ATTESTATION_MAX_AGE_MS = 24 * 60 * 6e4;
var DEFAULT_ENDPOINTS = [
  { host: "api.openai.com", port: 443 },
  { host: "api.anthropic.com", port: 443 },
  { host: "openrouter.ai", port: 443 },
  { host: "127.0.0.1", port: 11434 }
];
var WorkflowSafeguards = class {
  constructor(projectRoot, stateRoot, workspaceRoot, runner, processes) {
    this.projectRoot = projectRoot;
    this.stateRoot = stateRoot;
    this.workspaceRoot = workspaceRoot;
    this.runner = runner;
    this.processes = processes;
  }
  projectRoot;
  stateRoot;
  workspaceRoot;
  runner;
  processes;
  proxyCache = /* @__PURE__ */ new Map();
  get attestationPath() {
    return path.join(this.stateRoot, "workflow-doctor-attestation.json");
  }
  async endpoints() {
    const configured = process.env.ORCHESTRY_MODEL_ENDPOINTS;
    const values = !configured?.trim() ? DEFAULT_ENDPOINTS : configured.split(",").filter(Boolean).map((entry) => {
      const match = /^([^:\s]+):(\d+)$/.exec(entry.trim());
      if (!match) throw new Error(`Invalid ORCHESTRY_MODEL_ENDPOINTS entry: ${entry}`);
      return { host: match[1], port: Number(match[2]) };
    });
    return normalizeEndpoints(values);
  }
  async proxyEndpoint() {
    const attestation = await this.assertReady();
    return this.proxyForEndpoints(attestation.endpoints, attestation.policy_hash);
  }
  async proxyForEndpoints(endpoints, policyKey = canonicalHash(normalizeEndpoints(endpoints))) {
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
  async executableAllowlist(extra = []) {
    const descriptors = await this.discoverExecutables(extra);
    await this.assertExecutablesAttested(descriptors);
    return descriptors;
  }
  async runDoctor() {
    const checks = [];
    const record = async (name, action) => {
      try {
        checks.push({ name, passed: true, detail: await action() });
      } catch (error) {
        checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
      }
    };
    const executables = await this.discoverExecutables();
    const endpoints = await this.endpoints();
    await record("platform", async () => {
      if (process.platform !== "darwin") throw new Error("real-project workflow requires macOS sandbox-exec");
      await verifyExecutable(await resolveExecutable("/usr/bin/sandbox-exec"));
      return "macOS sandbox-exec is pinned";
    });
    await record("root-separation", async () => {
      const roots = [this.projectRoot, this.stateRoot, this.workspaceRoot].map((value) => path.resolve(value));
      if (roots.some((left, index) => roots.some((right, other) => index !== other && contains(left, right))))
        throw new Error("project, state, and workspace roots must not contain each other");
      await Promise.all([this.stateRoot, this.workspaceRoot].map((value) => fs.mkdir(value, { recursive: true, mode: 448 })));
      return "controller state and clones are external and disjoint";
    });
    await record("executable-integrity", async () => {
      await Promise.all(executables.map(verifyExecutable));
      return `${executables.length} executable paths pinned by SHA-256`;
    });
    await record("git-hardening", async () => {
      const git = executables.find((value) => path.basename(value.path) === "git" || path.basename(value.realpath) === "git");
      if (!git) throw new Error("git executable is unavailable");
      const hardened = new HardenedGit(this.runner, git, { configRoot: path.join(this.stateRoot, "git-doctor") });
      const version = await hardened.run(this.projectRoot, ["version"]);
      return version.trim();
    });
    await record("sandbox-adversarial", async () => this.adversarialSandboxProbe(executables));
    await record("process-quiescence", async () => {
      const owner = `doctor-${Date.now()}`;
      await this.processes.awaitQuiescent?.(owner, 1e3);
      if (this.processes.active?.(owner).length) throw new Error("process registry is not quiescent");
      return "owner process groups are quiescent";
    });
    const report = {
      schema_version: 1,
      project_root: await fs.realpath(this.projectRoot),
      state_root: path.resolve(this.stateRoot),
      workspace_root: path.resolve(this.workspaceRoot),
      platform: `${process.platform}-${process.arch}`,
      checked_at: (/* @__PURE__ */ new Date()).toISOString(),
      policy_hash: policyHash(endpoints, executables),
      executables,
      endpoints,
      checks,
      ready: checks.every((check) => check.passed)
    };
    if (report.ready) await this.writeAttestation(report);
    else await fs.rm(this.attestationPath, { force: true });
    return report;
  }
  async assertReady() {
    const value = await this.readVerifiedAttestation();
    if (Date.now() - Date.parse(value.report.checked_at) > ATTESTATION_MAX_AGE_MS) throw new Error("Real-project mode is blocked: workflow doctor attestation expired");
    if (value.report.project_root !== await fs.realpath(this.projectRoot) || value.report.state_root !== path.resolve(this.stateRoot) || value.report.workspace_root !== path.resolve(this.workspaceRoot))
      throw new Error("Real-project mode is blocked: workflow doctor attestation belongs to different roots");
    const [endpoints, executables] = await Promise.all([this.endpoints(), this.discoverExecutables()]);
    if (!safeEqual(policyHash(endpoints, executables), value.report.policy_hash)) throw new Error("Real-project mode is blocked: workflow doctor policy drift detected");
    await Promise.all(executables.map(verifyExecutable));
    return value.report;
  }
  async assertQuiescent(owner) {
    if (!this.processes.awaitQuiescent || !this.processes.active) throw new Error("Approval requires process-group quiescence support");
    await this.processes.awaitQuiescent(owner, 1e4);
    if (this.processes.active(owner).length) throw new Error(`Approval blocked while agent process groups remain active: ${owner}`);
  }
  async adversarialSandboxProbe(executables) {
    const root = await fs.mkdtemp(path.join(this.workspaceRoot, "doctor-probe-"));
    const outside = path.join(this.stateRoot, `doctor-forbidden-${Date.now()}`);
    const proxy = await this.proxyForEndpoints(await this.endpoints());
    const node = executables.find((value) => path.basename(value.realpath) === "node");
    if (!node) throw new Error("pinned Node executable is unavailable");
    try {
      const result = await this.runner.run({
        executable: node,
        args: ["-e", `const fs=require('fs');let denied=0;try{fs.writeFileSync(${JSON.stringify(outside)},'forged')}catch{denied++}const net=require('net');const s=net.connect(9,'1.1.1.1');s.on('error',()=>{denied++;if(denied===2)process.exit(0)});setTimeout(()=>process.exit(2),1000)`],
        cwd: root,
        env: {},
        timeoutMs: 3e3,
        maxStdoutBytes: 4096,
        maxStderrBytes: 4096,
        allowedExecutables: [node],
        sandbox: { workspace: root, proxyAddress: proxy, writableWorkspace: true },
        owner: "workflow-doctor"
      });
      if (!result.ok) throw new Error(`sandbox adversarial probe failed to execute: ${result.stderr || result.termination}`);
      if (await fs.stat(outside).then(() => true).catch(() => false)) throw new Error("sandbox filesystem escape probe succeeded");
      const unpinned = await this.runner.run({
        executable: node,
        args: ["-e", `const r=require('child_process').spawnSync('/usr/bin/id',[],{stdio:'ignore'});process.exit(r.error?0:2)`],
        cwd: root,
        env: {},
        timeoutMs: 3e3,
        maxStdoutBytes: 4096,
        maxStderrBytes: 4096,
        allowedExecutables: [node],
        sandbox: { workspace: root, proxyAddress: proxy, writableWorkspace: true },
        owner: "workflow-doctor"
      });
      if (!unpinned.ok) throw new Error("unpinned executable probe was not denied");
      const profile = generateMacosSandboxProfile({ workspace: root, proxyAddress: proxy, writableWorkspace: true, allowedExecutablePaths: [node.realpath] });
      if (!profile.includes("(deny network*)")) throw new Error("sandbox profile is not deny-by-default");
      return "filesystem escape, direct network, and unpinned execution denied";
    } finally {
      await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { force: true })]);
    }
  }
  async discoverExecutables(extra = []) {
    const names = /* @__PURE__ */ new Set(["git", "node", "npm", "npx", "sh", "bash", "env", "codex", "claude", "opencode", ...extra]);
    for (const value of process.env.ORCHESTRY_EXECUTABLE_ALLOWLIST?.split(path.delimiter).filter(Boolean) ?? []) names.add(value);
    const descriptors = [];
    for (const name of names) {
      try {
        descriptors.push(await resolveExecutable(name));
      } catch {
      }
    }
    const bin = path.join(this.projectRoot, "node_modules", ".bin");
    for (const name of (await fs.readdir(bin).catch(() => [])).sort()) {
      try {
        descriptors.push(await resolveExecutable(path.join(bin, name)));
      } catch {
      }
    }
    const unique = [...new Map(descriptors.map((value) => [value.realpath, value])).values()].sort((left, right) => left.realpath.localeCompare(right.realpath));
    await Promise.all(unique.map(verifyExecutable));
    return unique;
  }
  async assertExecutablesAttested(executables) {
    const value = await this.readVerifiedAttestation();
    const attested = new Map(value.report.executables.map((descriptor) => [descriptor.realpath, descriptor]));
    for (const descriptor of executables) {
      const approved = attested.get(descriptor.realpath);
      if (!approved || canonicalJson(approved) !== canonicalJson(descriptor)) {
        throw new Error(`Real-project mode is blocked: executable was not attested by workflow doctor: ${descriptor.realpath}`);
      }
    }
  }
  async readVerifiedAttestation() {
    const value = JSON.parse(await fs.readFile(this.attestationPath, "utf8").catch(() => {
      throw new Error("Real-project mode is blocked: run orch workflow doctor");
    }));
    if (!value?.report || typeof value.signature !== "string" || typeof value.report.policy_hash !== "string" || !safeEqual(sign(value.report, await this.key()), value.signature) || !value.report.ready) {
      throw new Error("Real-project mode is blocked: workflow doctor attestation is invalid");
    }
    return value;
  }
  async writeAttestation(report) {
    await fs.mkdir(this.stateRoot, { recursive: true, mode: 448 });
    const value = { report, signature: sign(report, await this.key()) };
    const temporary = `${this.attestationPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value)}
`, { mode: 384 });
    await fs.rename(temporary, this.attestationPath);
  }
  async key() {
    const file = path.join(this.stateRoot, "controller-attestation.key");
    await fs.mkdir(this.stateRoot, { recursive: true, mode: 448 });
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 63) !== 0) throw new Error("Controller attestation key permissions are unsafe");
      return fs.readFile(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const key = randomBytes(32);
      await fs.writeFile(file, key, { mode: 384, flag: "wx" });
      return key;
    }
  }
};
function sign(value, key) {
  return createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
}
function safeEqual(left, right) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
function contains(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
function policyHash(endpoints, executables) {
  return canonicalHash({
    endpoints: normalizeEndpoints(endpoints),
    executables: [...executables].map((value) => ({ path: path.resolve(value.path), realpath: path.resolve(value.realpath), sha256: value.sha256 })).sort((left, right) => left.realpath.localeCompare(right.realpath)),
    sandbox: macosSandboxPolicy()
  });
}
function canonicalHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function normalizeEndpoints(values) {
  const normalized = values.map((value) => {
    const raw = value.host.startsWith("[") && value.host.endsWith("]") ? value.host.slice(1, -1) : value.host;
    const host = net.isIP(raw) ? raw.toLowerCase() : domainToASCII(raw.replace(/\.$/, "")).toLowerCase();
    if (!host || !net.isIP(host) && !host.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) throw new Error(`Invalid endpoint host: ${value.host}`);
    if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error(`Invalid endpoint port: ${value.port}`);
    return { host, port: value.port };
  });
  const unique = /* @__PURE__ */ new Map();
  for (const value of normalized) {
    const key = `${net.isIP(value.host) === 6 ? `[${value.host}]` : value.host}:${value.port}`;
    if (unique.has(key)) throw new Error(`Duplicate endpoint policy entry: ${key}`);
    unique.set(key, value);
  }
  return [...unique.values()].sort((left, right) => left.host.localeCompare(right.host) || left.port - right.port);
}

export { WorkflowSafeguards };
//# sourceMappingURL=safeguards-OYONLEGJ.js.map
//# sourceMappingURL=safeguards-OYONLEGJ.js.map