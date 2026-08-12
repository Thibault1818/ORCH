/**
 * Process management utilities.
 *
 * Handles spawning subprocesses, PID checks, graceful kill.
 */

import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

export interface ManagedSpawnOptions extends SpawnOptions {
  owner?: string;
  ownerTag?: string;
}

export interface SpawnResult {
  process: ChildProcess;
  pid: number;
  owner?: string;
  ownerTag?: string;
}

export interface IProcessManager {
  isAlive(pid: number): boolean;
  kill(pid: number, signal?: NodeJS.Signals): void;
  killWithGrace(pid: number, graceMs?: number): Promise<void>;
  spawn(command: string, args: string[], options?: ManagedSpawnOptions): SpawnResult;
  active?(owner: string): number[];
  awaitQuiescent?(owner: string, timeoutMs?: number): Promise<void>;
  runQuiescent?<T>(owner: string, action: () => Promise<T>, timeoutMs?: number): Promise<T>;
}

interface ProcessGroupRecord {
  pid: number;
  owner: string | null;
  identity: string;
  registered_at: string;
}

interface ProcessGroupRegistry {
  schema_version: 3;
  groups: ProcessGroupRecord[];
  reservations: SpawnReservation[];
  freezes: ScopeFreeze[];
}

interface SpawnReservation {
  id: string;
  owner: string | null;
  parent_pid: number;
  parent_identity: string;
  created_at: string;
}

interface ScopeFreeze {
  owner: string;
  token: string;
  holder_pid: number;
  holder_identity: string;
  created_at: string;
}

export class ProcessManager implements IProcessManager {
  private readonly ownedPids = new Set<number>();
  private readonly quiescenceContext = new AsyncLocalStorage<{ owner: string; token: string }>();

  constructor(readonly registryPath: string = defaultProcessRegistryPath()) {
    this.registryPath = path.resolve(registryPath);
  }

  isAlive(pid: number): boolean {
    if (!isSafePid(pid)) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM means process exists but we lack permission to signal it
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
      return false;
    }
  }

  kill(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
    const registry = this.registry();
    if (!this.ownedPids.has(pid) && !registry.groups.some((group) => group.pid === pid)) return;
    // Kill entire process group (-pid) to clean up child processes (vitest, playwright, etc.)
    try {
      process.kill(-pid, signal);
    } catch {
      // Group kill failed — fall back to direct PID kill
      try {
        process.kill(pid, signal);
      } catch {
        // Process already dead
      }
    }
  }

  async killWithGrace(pid: number, graceMs: number = 10_000): Promise<void> {
    if (!this.ownedPids.has(pid) && !this.registry().groups.some((group) => group.pid === pid)) return;
    if (!this.isGroupAlive(pid)) {
      this.release(pid);
      return;
    }

    this.kill(pid, 'SIGTERM');

    const deadline = Date.now() + graceMs;

    while (Date.now() < deadline) {
      if (!this.isGroupAlive(pid)) {
        this.release(pid);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    this.kill(pid, 'SIGKILL');
    const forceDeadline = Date.now() + 1_000;
    while (Date.now() < forceDeadline && this.isGroupAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!this.isGroupAlive(pid)) this.release(pid);
  }

  spawn(command: string, args: string[], options?: ManagedSpawnOptions): SpawnResult {
    const { owner, ownerTag, ...spawnOptions } = options ?? {};
    const context = this.quiescenceContext.getStore();
    const tag = normalizeOwner(owner ?? ownerTag) ?? context?.owner ?? null;
    const reservation: SpawnReservation = {
      id: randomUUID(),
      owner: tag,
      parent_pid: process.pid,
      parent_identity: processIdentity(process.pid) ?? `node-${process.pid}`,
      created_at: new Date().toISOString(),
    };
    this.updateRegistry((registry) => {
      const freeze = tag === null ? registry.freezes[0] : registry.freezes.find((value) => value.owner === tag);
      if (freeze && freeze.token !== context?.token) throw new Error(`Process owner is frozen for a quiescent operation: ${tag ?? freeze.owner}`);
      registry.reservations.push(reservation);
    });

    let proc: ChildProcess;
    try {
      proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...spawnOptions,
        detached: true, // Callers cannot disable the process group used for cleanup.
      });
    } catch (error) {
      this.removeReservation(reservation.id);
      throw error;
    }

    if (!proc.pid) {
      // spawn failures emit asynchronously even though no PID is assigned.
      if (typeof proc.once === 'function') proc.once('error', () => {});
      this.removeReservation(reservation.id);
      throw new Error(`Failed to spawn process: ${command}`);
    }

    // Allow parent to exit without waiting for this child.
    // Pipes (stdout/stderr) still hold refs while being read — that's intentional.
    proc.unref();
    const identity = processGroupIdentity(proc.pid);
    if (!identity) {
      this.signalGroup(proc.pid, 'SIGKILL');
      if (!this.isGroupAlive(proc.pid)) this.removeReservation(reservation.id);
      throw new Error(`Failed to establish process-group identity: ${proc.pid}`);
    }
    try {
      this.updateRegistry((registry) => {
        if (!registry.reservations.some((value) => value.id === reservation.id)) throw new Error('Process spawn reservation was lost');
        registry.reservations = registry.reservations.filter((value) => value.id !== reservation.id);
        registry.groups = registry.groups.filter((group) => group.pid !== proc.pid);
        registry.groups.push({ pid: proc.pid!, owner: tag, identity, registered_at: new Date().toISOString() });
      });
      this.ownedPids.add(proc.pid);
    } catch (error) {
      this.signalGroup(proc.pid, 'SIGKILL');
      if (!this.isGroupAlive(proc.pid)) this.removeReservation(reservation.id);
      throw error;
    }
    const leaderClosed = () => {
      const pid = proc.pid!;
      this.signalGroup(pid, 'SIGKILL');
      if (!this.isGroupAlive(pid)) {
        try { this.release(pid); } catch { /* A later reconciliation will remove the stale entry. */ }
      }
    };
    proc.once('close', leaderClosed);

    return tag
      ? { process: proc, pid: proc.pid, owner: tag, ownerTag: tag }
      : { process: proc, pid: proc.pid };
  }

  active(owner: string): number[] {
    const tag = requireOwner(owner);
    return this.registry().groups
      .filter((group) => group.owner === null || group.owner === tag)
      .map((group) => group.pid)
      .sort((left, right) => left - right);
  }

  async awaitQuiescent(owner: string, timeoutMs?: number): Promise<void> {
    const tag = requireOwner(owner);
    validateTimeout(timeoutMs);
    const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
    while (this.hasBlockers(tag)) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for process owner to become quiescent: ${tag}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, deadline - Date.now())));
    }
  }

  async runQuiescent<T>(owner: string, action: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
    const tag = requireOwner(owner);
    validateTimeout(timeoutMs);
    const existing = this.quiescenceContext.getStore();
    if (existing?.owner === tag) return action();
    const token = randomUUID();
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let acquired = false;
      this.updateRegistry((registry) => {
        if (registry.freezes.some((freeze) => freeze.owner === tag)) return;
        if (registry.groups.some((group) => group.owner === null || group.owner === tag)) return;
        if (registry.reservations.some((reservation) => reservation.owner === null || reservation.owner === tag)) return;
        registry.freezes.push({ owner: tag, token, holder_pid: process.pid, holder_identity: processIdentity(process.pid) ?? `node-${process.pid}`, created_at: new Date().toISOString() });
        acquired = true;
      });
      if (acquired) break;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for process owner to become quiescent: ${tag}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, deadline - Date.now())));
    }
    try { return await this.quiescenceContext.run({ owner: tag, token }, action); }
    finally {
      this.updateRegistry((registry) => {
        registry.freezes = registry.freezes.filter((freeze) => freeze.token !== token);
      });
    }
  }

  private isGroupAlive(pid: number): boolean {
    if (!isSafePid(pid)) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  private signalGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-pid, signal);
    } catch {
      // The process group is already gone.
    }
  }

  private release(pid: number): void {
    this.updateRegistry((registry) => {
      registry.groups = registry.groups.filter((group) => group.pid !== pid);
    });
    this.ownedPids.delete(pid);
  }

  private removeReservation(id: string): void {
    this.updateRegistry((registry) => {
      registry.reservations = registry.reservations.filter((reservation) => reservation.id !== id);
    });
  }

  private hasBlockers(owner: string): boolean {
    const registry = this.registry();
    return registry.groups.some((group) => group.owner === null || group.owner === owner)
      || registry.reservations.some((reservation) => reservation.owner === null || reservation.owner === owner);
  }

  private registry(): ProcessGroupRegistry {
    return this.updateRegistry(() => {});
  }

  private updateRegistry(update: (registry: ProcessGroupRegistry) => void): ProcessGroupRegistry {
    return withRegistryLock(this.registryPath, () => {
      const registry = readRegistry(this.registryPath);
      registry.groups = registry.groups.filter((group) => {
        const identity = processGroupIdentity(group.pid);
        return this.isGroupAlive(group.pid) && (identity === null || identity === group.identity);
      });
      registry.freezes = registry.freezes.filter((freeze) => processIdentity(freeze.holder_pid) === freeze.holder_identity);
      update(registry);
      registry.groups.sort((left, right) => left.pid - right.pid);
      registry.reservations.sort((left, right) => left.id.localeCompare(right.id));
      registry.freezes.sort((left, right) => left.owner.localeCompare(right.owner));
      writeRegistry(this.registryPath, registry);
      return registry;
    });
  }
}

export function defaultProcessRegistryPath(home = os.homedir()): string {
  const configured = process.env.ORCHESTRY_PROCESS_REGISTRY;
  if (configured?.trim()) return path.resolve(configured);
  const base = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'orchestry')
    : path.join(home, '.local', 'state', 'orchestry');
  return path.join(base, 'process-groups.json');
}

function readRegistry(file: string): ProcessGroupRegistry {
  if (!existsSync(file)) return { schema_version: 3, groups: [], reservations: [], freezes: [] };
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error(`Unsafe process-group registry: ${file}`);
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`Invalid process-group registry: ${file}`); }
  if (!value || typeof value !== 'object') throw new Error(`Invalid process-group registry: ${file}`);
  const candidate = value as { schema_version?: unknown; groups?: unknown };
  if (candidate.schema_version !== 1 && candidate.schema_version !== 2 && candidate.schema_version !== 3) throw new Error(`Unsupported process-group registry schema: ${String(candidate.schema_version)}`);
  if (!Array.isArray(candidate.groups)) throw new Error(`Invalid process-group registry: ${file}`);
  const schema = candidate.schema_version as 1 | 2 | 3;
  const groups = candidate.groups.map((entry) => migrateGroup(entry, schema));
  if (schema !== 3) return { schema_version: 3, groups, reservations: [], freezes: [] };
  const extended = value as { reservations?: unknown; freezes?: unknown };
  if (!Array.isArray(extended.reservations) || !Array.isArray(extended.freezes)) throw new Error(`Invalid process-group registry: ${file}`);
  return { schema_version: 3, groups, reservations: extended.reservations.map(validateReservation), freezes: extended.freezes.map(validateFreeze) };
}

function migrateGroup(value: unknown, schema: 1 | 2 | 3): ProcessGroupRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid process-group registry entry');
  const entry = value as Partial<ProcessGroupRecord>;
  if (!isSafePid(entry.pid ?? 0) || (entry.owner !== null && typeof entry.owner !== 'string')) throw new Error('Invalid process-group registry entry');
  const owner = entry.owner === null ? null : requireOwner(entry.owner!);
  if (schema >= 2) {
    if (typeof entry.identity !== 'string' || !entry.identity || typeof entry.registered_at !== 'string' || !Number.isFinite(Date.parse(entry.registered_at))) {
      throw new Error('Invalid process-group registry entry');
    }
    return { pid: entry.pid!, owner, identity: entry.identity, registered_at: entry.registered_at };
  }
  return {
    pid: entry.pid!,
    owner,
    identity: processGroupIdentity(entry.pid!) ?? 'stale',
    registered_at: typeof entry.registered_at === 'string' && Number.isFinite(Date.parse(entry.registered_at)) ? entry.registered_at : new Date(0).toISOString(),
  };
}

function validateReservation(value: unknown): SpawnReservation {
  if (!value || typeof value !== 'object') throw new Error('Invalid process spawn reservation');
  const entry = value as Partial<SpawnReservation>;
  if (typeof entry.id !== 'string' || !entry.id || (entry.owner !== null && typeof entry.owner !== 'string') || !isSafePid(entry.parent_pid ?? 0) || typeof entry.parent_identity !== 'string' || !entry.parent_identity || typeof entry.created_at !== 'string' || !Number.isFinite(Date.parse(entry.created_at))) throw new Error('Invalid process spawn reservation');
  return { id: entry.id, owner: entry.owner === null ? null : requireOwner(entry.owner!), parent_pid: entry.parent_pid!, parent_identity: entry.parent_identity, created_at: entry.created_at };
}

function validateFreeze(value: unknown): ScopeFreeze {
  if (!value || typeof value !== 'object') throw new Error('Invalid process scope freeze');
  const entry = value as Partial<ScopeFreeze>;
  if (typeof entry.owner !== 'string' || typeof entry.token !== 'string' || !entry.token || !isSafePid(entry.holder_pid ?? 0) || typeof entry.holder_identity !== 'string' || !entry.holder_identity || typeof entry.created_at !== 'string' || !Number.isFinite(Date.parse(entry.created_at))) throw new Error('Invalid process scope freeze');
  return { owner: requireOwner(entry.owner), token: entry.token, holder_pid: entry.holder_pid!, holder_identity: entry.holder_identity, created_at: entry.created_at };
}

function writeRegistry(file: string, registry: ProcessGroupRegistry): void {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(registry)}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
  chmodSync(file, 0o600);
}

function withRegistryLock<T>(file: string, action: () => T): T {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 2_000;
  let fd: number | null = null;
  const token = randomUUID();
  while (fd === null) {
    try {
      fd = openSync(lock, 'wx', 0o600);
      writeFileSync(fd, `${process.pid} ${Date.now()} ${token}\n`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      removeStaleLock(lock);
      if (Date.now() >= deadline) throw new Error(`Timed out locking process-group registry: ${file}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return action(); }
  finally {
    closeSync(fd);
    try { if (readFileSync(lock, 'utf8').trim().split(/\s+/)[2] === token) rmSync(lock, { force: true }); } catch { /* Lock ownership was already lost. */ }
  }
}

function removeStaleLock(file: string): void {
  try {
    const [pidValue, createdValue] = readFileSync(file, 'utf8').trim().split(/\s+/);
    const pid = Number(pidValue);
    const created = Number(createdValue);
    if (!isSafePid(pid) || !isProcessAlive(pid) || !Number.isFinite(created)) rmSync(file, { force: true });
  } catch { /* A concurrent owner may be creating or releasing the lock. */ }
}

function processGroupIdentity(pid: number): string | null {
  if (!isSafePid(pid)) return null;
  const result = spawnSync('/bin/ps', ['-o', 'pgid=', '-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 1_000 });
  if (result.status !== 0 || typeof result.stdout !== 'string') return null;
  const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(result.stdout);
  if (!match || Number(match[1]) !== pid) return null;
  return match[2]!;
}

function processIdentity(pid: number): string | null {
  if (!isSafePid(pid)) return null;
  const result = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 1_000 });
  if (result.status !== 0 || typeof result.stdout !== 'string' || !result.stdout.trim()) return null;
  return result.stdout.trim();
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function isSafePid(pid: number): boolean {
  return Number.isSafeInteger(pid) && pid > 1;
}

function normalizeOwner(owner: string | undefined): string | null {
  if (owner === undefined) return null;
  return requireOwner(owner);
}

function requireOwner(owner: string): string {
  const value = owner.trim();
  if (!value) throw new Error('Process owner must not be empty');
  return value;
}

function validateTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)) throw new Error('timeoutMs must be a non-negative integer');
}

/**
 * Max stdout line length before truncation (16 KB).
 * First layer of a three-layer cap: readLines (16 KB) → serializeEventData (8 KB) → bus emit (4 KB).
 * Truncated lines produce invalid JSON → adapters' catch block handles gracefully.
 */
const MAX_LINE_LEN = 16384;

/** Cap a string to MAX_LINE_LEN. */
function capLine(s: string): string {
  return s.length > MAX_LINE_LEN ? s.slice(0, MAX_LINE_LEN) : s;
}

/**
 * Read lines from a readable stream as an async generator.
 *
 * Uses `for await` on the raw Readable (proper backpressure) instead of
 * readline.createInterface, which buffers all 'line' events in an unbounded
 * queue even when the consumer is paused — causing OOM under high throughput.
 *
 * Uses Buffer.concat + offset tracking to avoid O(n²) string copies.
 */
export async function* readLines(stream: Readable): AsyncGenerator<string> {
  const chunks: Buffer[] = [];
  let totalLen = 0;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, 'utf-8');
    if (buf.length === 0) continue;
    chunks.push(buf);
    totalLen += buf.length;

    // Concat once per chunk arrival, then scan for newlines with offset tracking
    const buffer = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, totalLen);
    chunks.length = 0;
    totalLen = 0;

    let offset = 0;
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf(0x0a, offset)) !== -1) {
      if (newlineIdx > offset) {
        yield capLine(buffer.toString('utf-8', offset, newlineIdx));
      }
      offset = newlineIdx + 1;
    }

    // Keep unconsumed remainder for next chunk
    if (offset < buffer.length) {
      const remainder = buffer.subarray(offset);
      chunks.push(remainder);
      totalLen = remainder.length;
    }
  }

  // Flush remaining data (last line without trailing newline)
  if (totalLen > 0) {
    const final = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, totalLen);
    yield capLine(final.toString('utf-8'));
  }
}
