/**
 * File-based orchestrator state store.
 *
 * State is stored in .orchestry/state.json.
 * Updated atomically on every mutation.
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DEFAULT_STATE, type OrchestratorState } from '../../domain/state.js';
import { readJson, writeJson } from './fs-utils.js';
import type { IStateStore } from './interfaces.js';
import type { Paths } from './paths.js';
import {
  deserializeState,
  migrateState,
  stateVersion,
  validatePersistedState,
  validateStateMigrationJournal,
  type PersistedOrchestratorState,
  type StateMigrationJournal,
} from './state-migrations.js';

export class StateStore implements IStateStore {
  constructor(private readonly paths: Paths) {}

  async read(): Promise<OrchestratorState> {
    return this.withLock(() => this.readUnlocked());
  }

  private async readUnlocked(): Promise<OrchestratorState> {
    await this.recoverMigration();
    const raw = await readJson<unknown>(this.paths.statePath);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const version = stateVersion(raw);
    const persisted = migrateState(raw);
    if (version === 0) await this.persistMigration(persisted);
    return deserializeState(persisted);
  }

  async write(state: OrchestratorState): Promise<void> {
    await this.withLock(async () => {
      const serializable = validatePersistedState({ ...state, claimed: Array.from(state.claimed) });
      await writeJson(this.paths.statePath, serializable);
    });
  }

  private get migrationPath(): string {
    return path.join(path.dirname(this.paths.statePath), 'state.migration.pending.json');
  }

  private async persistMigration(state: PersistedOrchestratorState): Promise<void> {
    const journal: StateMigrationJournal = {
      schema_version: 1,
      from_version: 0,
      to_version: 1,
      state,
    };
    await writeJson(this.migrationPath, journal);
    await writeJson(this.paths.statePath, state);
    await fs.rm(this.migrationPath, { force: true });
  }

  private async recoverMigration(): Promise<void> {
    const rawJournal = await readJson<unknown>(this.migrationPath);
    if (!rawJournal) return;
    const journal = validateStateMigrationJournal(rawJournal);
    const current = await readJson<unknown>(this.paths.statePath);
    if (current) {
      const version = stateVersion(current);
      if (version === 1) {
        const validated = validatePersistedState(current);
        if (JSON.stringify(validated) !== JSON.stringify(journal.state))
          throw new Error('State migration journal conflicts with canonical state');
        await fs.rm(this.migrationPath, { force: true });
        return;
      }
    }
    await writeJson(this.paths.statePath, journal.state);
    await fs.rm(this.migrationPath, { force: true });
  }

  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    const lockPath = path.join(path.dirname(this.paths.statePath), 'state-store.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    const token = randomUUID();
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await removeDeadLock(lockPath);
        if (Date.now() >= deadline) throw new Error('State store lock is active');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try { return await action(); }
    finally {
      const value = await fs.readFile(lockPath, 'utf8').then((raw) => JSON.parse(raw) as Record<string, unknown>).catch(() => null);
      if (value?.token === token) await fs.unlink(lockPath).catch(() => {});
    }
  }
}

async function removeDeadLock(lockPath: string): Promise<void> {
  const value = await fs.readFile(lockPath, 'utf8').then((raw) => JSON.parse(raw) as Record<string, unknown>).catch(() => null);
  const stat = await fs.lstat(lockPath).catch(() => null);
  if ((value && typeof value.pid === 'number' && !processAlive(value.pid)) || (!value && stat && Date.now() - stat.mtimeMs > 30_000)) {
    const stale = `${lockPath}.stale-${randomUUID()}`;
    await fs.rename(lockPath, stale).then(() => fs.rm(stale, { force: true })).catch(() => {});
  }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
