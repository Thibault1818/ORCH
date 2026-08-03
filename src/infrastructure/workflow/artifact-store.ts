import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProducingRole } from '../../domain/workflow/contracts.js';
import type { ArtifactReference, WorkflowArtifactMetadataV1, WorkflowEventV1, WorkflowJobV1, WorkflowPassportV1, WorkflowSessionsV1 } from '../../domain/workflow/state.js';
import { canTransitionWorkflow, type WorkflowPhase } from '../../domain/workflow/transitions.js';
import { sanitizeForPersistence, sanitizeText } from '../security/redaction.js';
import { appendJsonl, atomicWrite, ensureDir, readJson, readJsonl } from '../storage/fs-utils.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_FIELD = /^(?:env|environment|credentials?|private[_-]?key|privatekey|pem|api[_-]?key|password|passwd|secret|token)$/i;

export const ARTIFACT_FILES = {
  codex_brief: 'codex-brief-r%REV%-a%SEQ%.json', fable_plan: 'fable-plan-r%REV%-a%SEQ%.json', codex_plan_review: 'codex-plan-review-r%REV%-a%SEQ%.json',
  fable_final_prompt: 'fable-final-prompt-r%REV%-a%SEQ%.md', opus_report: 'opus-report-r%REV%-a%SEQ%.json', opus_diff: 'opus-r%REV%-a%SEQ%.diff',
  test_results: 'test-results-r%REV%-a%SEQ%.json', codex_technical_review: 'codex-technical-review-r%REV%-a%SEQ%.json',
  fable_compliance_review: 'fable-compliance-review-r%REV%-a%SEQ%.json', codex_synthesis: 'codex-synthesis-r%REV%-a%SEQ%.json',
} as const;
export type ArtifactName = keyof typeof ARTIFACT_FILES;

export interface StoredArtifact<T = unknown> { metadata: WorkflowArtifactMetadataV1; payload: T; }
export interface ArtifactWrite<T> { job_id: string; name: ArtifactName; phase: WorkflowPhase; revision: number; producing_role: ProducingRole; parent_artifact_hash: string | null; payload: unknown; validate: (value: unknown) => T; timestamp?: string; }

export class WorkflowArtifactStore {
  private readonly root: string;
  constructor(projectRoot: string) { this.root = path.join(projectRoot, '.orchestry', 'workflows'); }

  async createJob(job: WorkflowJobV1, passport: WorkflowPassportV1, sessions: WorkflowSessionsV1): Promise<void> {
    const id = safeId(job.job_id);
    if (passport.job_id !== id || sessions.job_id !== id) throw new Error('Workflow job_id mismatch');
    await this.secureDir(id);
    if (await this.readJob(id)) throw new Error(`Workflow job already exists: ${id}`);
    await Promise.all([this.write(this.file(id, 'job.json'), job), this.write(this.file(id, 'passport.json'), passport), this.write(this.file(id, `passports/passport-${String(passport.passport_revision).padStart(6, '0')}.json`), passport), this.write(this.file(id, 'sessions.json'), sessions)]);
  }

  async writeArtifact<T>(input: ArtifactWrite<T>): Promise<StoredArtifact<T>> {
    const id = safeId(input.job_id);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (input.revision !== job.artifact_revision + 1) throw new Error(`Stale artifact revision: expected ${job.artifact_revision + 1}, received ${input.revision}`);
      if (input.parent_artifact_hash !== job.latest_artifact_hash) throw new Error('Stale parent_artifact_hash');
      if (input.parent_artifact_hash !== null && !SHA256.test(input.parent_artifact_hash)) throw new Error('Invalid parent_artifact_hash');
      if (job.phase !== input.phase) throw new Error(`Artifact phase ${input.phase} does not match job phase ${job.phase}`);
      const payload = input.validate(removeForbidden(input.payload));
      const timestamp = iso(input.timestamp ?? new Date().toISOString());
      const artifactHash = hashCanonical(payload);
      const filename = artifactFilename(input.name, job.revision, input.revision);
      const stored: StoredArtifact<T> = { metadata: { schema_version: 1, job_id: id, artifact_name: input.name, filename, phase: input.phase, workflow_revision: job.revision, revision: input.revision, producing_role: input.producing_role, parent_artifact_hash: input.parent_artifact_hash, timestamp, artifact_hash: artifactHash }, payload };
      const file = path.join(this.root, id, 'artifacts', filename);
      try { await fs.access(file); throw new Error(`Refusing to overwrite immutable artifact: ${filename}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await this.write(file, stored);
      await this.write(this.file(id, 'job.json'), { ...job, artifact_revision: input.revision, latest_artifact_hash: artifactHash, updated_at: timestamp });
      return stored;
    });
  }

  async writeTextArtifact(input: Omit<ArtifactWrite<string>, 'validate'>): Promise<StoredArtifact<string>> {
    return this.writeArtifact({ ...input, validate: (value) => {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`${input.name} must be non-empty text`);
      return sanitizeText(value);
    } });
  }

  async readArtifact<T>(jobId: string, name: ArtifactName, workflowRevision?: number): Promise<StoredArtifact<T> | null> {
    const id = safeId(jobId); const job = await this.requiredJob(id);
    const value = await this.latestArtifact<T>(id, name, workflowRevision ?? job.revision);
    if (!value) return null;
    if (value.metadata.job_id !== id || hashCanonical(value.payload) !== value.metadata.artifact_hash) throw new Error('Workflow artifact integrity check failed');
    return value;
  }

  async readTextArtifact(jobId: string, name: ArtifactName, workflowRevision?: number): Promise<StoredArtifact<string> | null> {
    const value = await this.readArtifact<string>(jobId, name, workflowRevision); if (value && typeof value.payload !== 'string') throw new Error('Workflow text artifact is not text'); return value;
  }

  async transition(jobId: string, next: WorkflowPhase, patch: Partial<WorkflowJobV1> = {}): Promise<WorkflowJobV1> {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (!canTransitionWorkflow(job.phase, next)) throw new Error(`Invalid workflow phase transition: ${job.phase} -> ${next}`);
      const updated: WorkflowJobV1 = { ...job, ...patch, schema_version: 1, job_id: id, phase: next, updated_at: new Date().toISOString() };
      await this.write(this.file(id, 'job.json'), updated); return updated;
    });
  }

  async patchJob(jobId: string, patch: Partial<WorkflowJobV1>): Promise<WorkflowJobV1> {
    const id = safeId(jobId); return this.lock(id, async () => { const job = await this.requiredJob(id); const updated = { ...job, ...patch, schema_version: 1 as const, job_id: id, phase: job.phase, updated_at: new Date().toISOString() }; await this.write(this.file(id, 'job.json'), updated); return updated; });
  }
  async reserveOperation(jobId: string, phase: WorkflowPhase, operation: NonNullable<WorkflowJobV1['current_operation']>): Promise<boolean> { const id = safeId(jobId); return this.lock(id, async () => { const job = await this.requiredJob(id); if (job.phase !== phase || job.current_operation !== null) return false; await this.write(this.file(id, 'job.json'), { ...job, current_operation: operation, updated_at: new Date().toISOString() }); return true; }); }
  async readJob(jobId: string): Promise<WorkflowJobV1 | null> { const id = safeId(jobId); return readJson<WorkflowJobV1>(this.file(id, 'job.json')); }
  async readPassport(jobId: string): Promise<WorkflowPassportV1 | null> { const id = safeId(jobId); return readJson<WorkflowPassportV1>(this.file(id, 'passport.json')); }
  async writePassport(value: WorkflowPassportV1): Promise<void> { const id = safeId(value.job_id); await this.lock(id, async () => { const current = await this.readPassport(id); if (current && value.passport_revision !== current.passport_revision + 1) throw new Error(`Stale passport revision: expected ${current.passport_revision + 1}, received ${value.passport_revision}`); const snapshot = this.file(id, `passports/passport-${String(value.passport_revision).padStart(6, '0')}.json`); try { await fs.access(snapshot); throw new Error(`Refusing to overwrite passport revision ${value.passport_revision}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } await this.write(snapshot, value); await this.write(this.file(id, 'passport.json'), value); }); }
  async readSessions(jobId: string): Promise<WorkflowSessionsV1 | null> { const id = safeId(jobId); return readJson<WorkflowSessionsV1>(this.file(id, 'sessions.json')); }
  async writeSessions(value: WorkflowSessionsV1): Promise<void> { safeId(value.job_id); await this.requiredJob(value.job_id); await this.write(this.file(value.job_id, 'sessions.json'), value); }
  async appendEvent(event: WorkflowEventV1): Promise<void> { const id = safeId(event.job_id); await this.requiredJob(id); await appendJsonl(this.file(id, 'events.jsonl'), { ...event, data: removeForbidden(event.data) }); await fs.chmod(this.file(id, 'events.jsonl'), 0o600).catch(() => {}); }
  async readEvents(jobId: string): Promise<WorkflowEventV1[]> { return readJsonl<WorkflowEventV1>(this.file(safeId(jobId), 'events.jsonl')); }
  async listJobs(): Promise<WorkflowJobV1[]> { let entries: string[]; try { entries = await fs.readdir(this.root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } const jobs = (await Promise.all(entries.map((id) => SAFE_ID.test(id) ? this.readJob(id) : null))).filter((job): job is WorkflowJobV1 => job !== null); return jobs.sort((a, b) => b.updated_at.localeCompare(a.updated_at)); }
  artifactPath(jobId: string, name: ArtifactName, revision: number): string { return path.join(this.root, safeId(jobId), 'artifacts', artifactFilename(name, revision, 0)); }

  private async requiredJob(id: string): Promise<WorkflowJobV1> { const job = await this.readJob(id); if (!job) throw new Error(`Workflow job not found: ${id}`); return job; }
  private file(id: string, name: string): string { return path.join(this.root, safeId(id), name); }
  private async latestArtifact<T>(id: string, name: ArtifactName, workflowRevision: number): Promise<StoredArtifact<T> | null> { const dir = this.file(id, 'artifacts'); let entries: string[]; try { entries = await fs.readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } let latest: StoredArtifact<T> | null = null; for (const entry of entries) { const value = await readJson<StoredArtifact<T>>(path.join(dir, entry)); if (value?.metadata.artifact_name === name && value.metadata.workflow_revision === workflowRevision && (!latest || value.metadata.revision > latest.metadata.revision)) latest = value; } return latest; }
  private async write(file: string, value: unknown): Promise<void> { await atomicWrite(file, canonicalJson(removeForbidden(value)) + '\n'); }
  private async secureDir(id: string): Promise<void> { const dir = this.file(id, ''); await Promise.all([ensureDir(path.join(dir, 'artifacts')), ensureDir(path.join(dir, 'passports'))]); await Promise.all([fs.chmod(this.root, 0o700).catch(() => {}), fs.chmod(dir, 0o700), fs.chmod(path.join(dir, 'artifacts'), 0o700), fs.chmod(path.join(dir, 'passports'), 0o700)]); }
  private async lock<T>(id: string, fn: () => Promise<T>): Promise<T> { await this.secureDir(id); const lock = this.file(id, '.workflow.lock'); const deadline = Date.now() + 5_000; while (true) { try { await fs.mkdir(lock, { mode: 0o700 }); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; const stat = await fs.stat(lock).catch(() => null); if (stat && Date.now() - stat.mtimeMs > 30_000) { await fs.rm(lock, { recursive: true, force: true }); continue; } if (Date.now() > deadline) throw new Error(`Workflow lock is active: ${id}`); await new Promise((r) => setTimeout(r, 10)); } } try { return await fn(); } finally { await fs.rm(lock, { recursive: true, force: true }); } }
}

export function artifactReference<T>(_name: string, stored: StoredArtifact<T>): ArtifactReference { return { filename: stored.metadata.filename, hash: stored.metadata.artifact_hash, phase: stored.metadata.phase, revision: stored.metadata.revision }; }
export function hashCanonical(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; const o = value as Record<string, unknown>; return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`; }
function removeForbidden(value: unknown): unknown { const safe = sanitizeForPersistence(value); if (Array.isArray(safe)) return safe.map(removeForbidden); if (safe && typeof safe === 'object') { const out: Record<string, unknown> = {}; for (const [key, nested] of Object.entries(safe)) if (!FORBIDDEN_FIELD.test(key)) out[key] = removeForbidden(nested); return out; } return safe; }
function safeId(value: string): string { if (!SAFE_ID.test(value) || value === '.' || value === '..') throw new Error(`Invalid workflow job id: ${value}`); return value; }
function iso(value: string): string { if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp'); return value; }
function artifactFilename(name: ArtifactName, workflowRevision: number, sequence: number): string { return ARTIFACT_FILES[name].replace('%REV%', String(workflowRevision).padStart(3, '0')).replace('%SEQ%', String(sequence).padStart(6, '0')); }
