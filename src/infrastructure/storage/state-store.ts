/**
 * File-based orchestrator state store.
 *
 * State is stored in .orchestry/state.json.
 * Updated atomically on every mutation.
 */

import fs from 'node:fs/promises';
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
    await this.recoverMigration();
    const raw = await readJson<unknown>(this.paths.statePath);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const version = stateVersion(raw);
    const persisted = migrateState(raw);
    if (version === 0) await this.persistMigration(persisted);
    return deserializeState(persisted);
  }

  async write(state: OrchestratorState): Promise<void> {
    const serializable = validatePersistedState({ ...state, claimed: Array.from(state.claimed) });
    await writeJson(this.paths.statePath, serializable);
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
}
