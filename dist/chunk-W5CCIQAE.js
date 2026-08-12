import { spawn, spawnSync } from 'child_process';
import { mkdirSync, openSync, writeFileSync, closeSync, rmSync, readFileSync, existsSync, lstatSync, chmodSync, renameSync } from 'fs';
import os from 'os';
import path from 'path';

// src/infrastructure/process/process-manager.ts
var ProcessManager = class {
  constructor(registryPath = defaultProcessRegistryPath()) {
    this.registryPath = registryPath;
    this.registryPath = path.resolve(registryPath);
  }
  registryPath;
  ownedPids = /* @__PURE__ */ new Set();
  isAlive(pid) {
    if (!isSafePid(pid)) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err.code === "EPERM") return true;
      return false;
    }
  }
  kill(pid, signal = "SIGTERM") {
    const registry = this.registry();
    if (!this.ownedPids.has(pid) && !registry.groups.some((group) => group.pid === pid)) return;
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
      }
    }
  }
  async killWithGrace(pid, graceMs = 1e4) {
    if (!this.ownedPids.has(pid) && !this.registry().groups.some((group) => group.pid === pid)) return;
    if (!this.isGroupAlive(pid)) {
      this.release(pid);
      return;
    }
    this.kill(pid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if (!this.isGroupAlive(pid)) {
        this.release(pid);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    this.kill(pid, "SIGKILL");
    const forceDeadline = Date.now() + 1e3;
    while (Date.now() < forceDeadline && this.isGroupAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!this.isGroupAlive(pid)) this.release(pid);
  }
  spawn(command, args, options) {
    const { owner, ownerTag, ...spawnOptions } = options ?? {};
    const tag = normalizeOwner(owner ?? ownerTag);
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
      detached: true
      // Callers cannot disable the process group used for cleanup.
    });
    if (!proc.pid) {
      if (typeof proc.once === "function") proc.once("error", () => {
      });
      throw new Error(`Failed to spawn process: ${command}`);
    }
    proc.unref();
    const identity = processGroupIdentity(proc.pid);
    if (!identity) {
      this.signalGroup(proc.pid, "SIGKILL");
      throw new Error(`Failed to establish process-group identity: ${proc.pid}`);
    }
    try {
      this.updateRegistry((registry) => {
        registry.groups = registry.groups.filter((group) => group.pid !== proc.pid);
        registry.groups.push({ pid: proc.pid, owner: tag, identity, registered_at: (/* @__PURE__ */ new Date()).toISOString() });
      });
      this.ownedPids.add(proc.pid);
    } catch (error) {
      this.signalGroup(proc.pid, "SIGKILL");
      throw error;
    }
    const leaderClosed = () => {
      const pid = proc.pid;
      this.signalGroup(pid, "SIGKILL");
      if (!this.isGroupAlive(pid)) {
        try {
          this.release(pid);
        } catch {
        }
      }
    };
    proc.once("close", leaderClosed);
    return tag ? { process: proc, pid: proc.pid, owner: tag, ownerTag: tag } : { process: proc, pid: proc.pid };
  }
  active(owner) {
    const tag = requireOwner(owner);
    return this.registry().groups.filter((group) => group.owner === tag).map((group) => group.pid).sort((left, right) => left - right);
  }
  async awaitQuiescent(owner, timeoutMs) {
    const tag = requireOwner(owner);
    if (timeoutMs !== void 0 && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)) {
      throw new Error("timeoutMs must be a non-negative integer");
    }
    const deadline = timeoutMs === void 0 ? Infinity : Date.now() + timeoutMs;
    while (this.active(tag).length > 0) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for process owner to become quiescent: ${tag}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, deadline - Date.now())));
    }
  }
  isGroupAlive(pid) {
    if (!isSafePid(pid)) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }
  signalGroup(pid, signal) {
    try {
      process.kill(-pid, signal);
    } catch {
    }
  }
  release(pid) {
    this.updateRegistry((registry) => {
      registry.groups = registry.groups.filter((group) => group.pid !== pid);
    });
    this.ownedPids.delete(pid);
  }
  registry() {
    return this.updateRegistry(() => {
    });
  }
  updateRegistry(update) {
    return withRegistryLock(this.registryPath, () => {
      const registry = readRegistry(this.registryPath);
      registry.groups = registry.groups.filter((group) => {
        const identity = processGroupIdentity(group.pid);
        return this.isGroupAlive(group.pid) && (identity === null || identity === group.identity);
      });
      update(registry);
      registry.groups.sort((left, right) => left.pid - right.pid);
      writeRegistry(this.registryPath, registry);
      return registry;
    });
  }
};
function defaultProcessRegistryPath(home = os.homedir()) {
  const configured = process.env.ORCHESTRY_PROCESS_REGISTRY;
  if (configured?.trim()) return path.resolve(configured);
  const base = process.platform === "darwin" ? path.join(home, "Library", "Application Support", "orchestry") : path.join(home, ".local", "state", "orchestry");
  return path.join(base, "process-groups.json");
}
function readRegistry(file) {
  if (!existsSync(file)) return { schema_version: 2, groups: [] };
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 63) !== 0) throw new Error(`Unsafe process-group registry: ${file}`);
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Invalid process-group registry: ${file}`);
  }
  if (!value || typeof value !== "object") throw new Error(`Invalid process-group registry: ${file}`);
  const candidate = value;
  if (candidate.schema_version !== 1 && candidate.schema_version !== 2) throw new Error(`Unsupported process-group registry schema: ${String(candidate.schema_version)}`);
  if (!Array.isArray(candidate.groups)) throw new Error(`Invalid process-group registry: ${file}`);
  const groups = candidate.groups.map((entry) => migrateGroup(entry, candidate.schema_version));
  return { schema_version: 2, groups };
}
function migrateGroup(value, schema) {
  if (!value || typeof value !== "object") throw new Error("Invalid process-group registry entry");
  const entry = value;
  if (!isSafePid(entry.pid ?? 0) || entry.owner !== null && typeof entry.owner !== "string") throw new Error("Invalid process-group registry entry");
  const owner = entry.owner === null ? null : requireOwner(entry.owner);
  if (schema === 2) {
    if (typeof entry.identity !== "string" || !entry.identity || typeof entry.registered_at !== "string" || !Number.isFinite(Date.parse(entry.registered_at))) {
      throw new Error("Invalid process-group registry entry");
    }
    return { pid: entry.pid, owner, identity: entry.identity, registered_at: entry.registered_at };
  }
  return {
    pid: entry.pid,
    owner,
    identity: processGroupIdentity(entry.pid) ?? "stale",
    registered_at: typeof entry.registered_at === "string" && Number.isFinite(Date.parse(entry.registered_at)) ? entry.registered_at : (/* @__PURE__ */ new Date(0)).toISOString()
  };
}
function writeRegistry(file, registry) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 448 });
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(registry)}
`, { mode: 384, flag: "wx" });
  chmodSync(temporary, 384);
  renameSync(temporary, file);
  chmodSync(file, 384);
}
function withRegistryLock(file, action) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 448 });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 2e3;
  let fd = null;
  while (fd === null) {
    try {
      fd = openSync(lock, "wx", 384);
      writeFileSync(fd, `${process.pid} ${Date.now()}
`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      removeStaleLock(lock);
      if (Date.now() >= deadline) throw new Error(`Timed out locking process-group registry: ${file}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return action();
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}
function removeStaleLock(file) {
  try {
    const [pidValue, createdValue] = readFileSync(file, "utf8").trim().split(/\s+/);
    const pid = Number(pidValue);
    const created = Number(createdValue);
    if (!isSafePid(pid) || !isProcessAlive(pid) || !Number.isFinite(created) || Date.now() - created > 3e4) rmSync(file, { force: true });
  } catch {
  }
}
function processGroupIdentity(pid) {
  if (!isSafePid(pid)) return null;
  const result = spawnSync("/bin/ps", ["-o", "pgid=", "-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 1e3 });
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(result.stdout);
  if (!match || Number(match[1]) !== pid) return null;
  return match[2];
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function isSafePid(pid) {
  return Number.isSafeInteger(pid) && pid > 1;
}
function normalizeOwner(owner) {
  if (owner === void 0) return null;
  return requireOwner(owner);
}
function requireOwner(owner) {
  const value = owner.trim();
  if (!value) throw new Error("Process owner must not be empty");
  return value;
}
var MAX_LINE_LEN = 16384;
function capLine(s) {
  return s.length > MAX_LINE_LEN ? s.slice(0, MAX_LINE_LEN) : s;
}
async function* readLines(stream) {
  const chunks = [];
  let totalLen = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8");
    if (buf.length === 0) continue;
    chunks.push(buf);
    totalLen += buf.length;
    const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, totalLen);
    chunks.length = 0;
    totalLen = 0;
    let offset = 0;
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf(10, offset)) !== -1) {
      if (newlineIdx > offset) {
        yield capLine(buffer.toString("utf-8", offset, newlineIdx));
      }
      offset = newlineIdx + 1;
    }
    if (offset < buffer.length) {
      const remainder = buffer.subarray(offset);
      chunks.push(remainder);
      totalLen = remainder.length;
    }
  }
  if (totalLen > 0) {
    const final = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, totalLen);
    yield capLine(final.toString("utf-8"));
  }
}

export { ProcessManager, defaultProcessRegistryPath, readLines };
//# sourceMappingURL=chunk-W5CCIQAE.js.map
//# sourceMappingURL=chunk-W5CCIQAE.js.map