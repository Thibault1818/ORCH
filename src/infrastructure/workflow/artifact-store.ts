import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProducingRole } from "../../domain/workflow/contracts.js";
import type {
  ArtifactReference,
  WorkflowArtifactMetadataV1,
  WorkflowEffectReceiptV2,
  WorkflowEventV1,
  WorkflowInvocationReceiptV1,
  WorkflowJobV1,
  WorkflowLlmAttemptV1,
  WorkflowPassportV1,
  WorkflowSessionsV1,
} from "../../domain/workflow/state.js";
import {
  canTransitionWorkflow,
  type WorkflowPhase,
} from "../../domain/workflow/transitions.js";
import {
  validateWorkflowJob,
  validateWorkflowPassport,
  validateWorkflowSessions,
} from "../../domain/workflow/validation.js";
import { sanitizeForPersistence, sanitizeText } from "../security/redaction.js";
import {
  appendJsonl,
  atomicWrite,
  ensureDir,
  readJson,
  readJsonl,
} from "../storage/fs-utils.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_FIELD =
  /^(?:env|environment|credentials?|private[_-]?key|privatekey|pem|api[_-]?key|password|passwd|secret|token)$/i;

export const ARTIFACT_FILES = {
  codex_decision: "codex-decision-r%REV%-i%ITER%-a%SEQ%.json",
  opus_instruction: "opus-instruction-r%REV%-i%ITER%-a%SEQ%.md",
  fable_request: "fable-request-r%REV%-i%ITER%-a%SEQ%.json",
  fable_advice: "fable-advice-r%REV%-i%ITER%-a%SEQ%.json",
  routing_decision: "routing-decision-r%REV%-i%ITER%-a%SEQ%.json",
  opus_report: "opus-report-r%REV%-i%ITER%-a%SEQ%.json",
  opus_diff: "opus-r%REV%-i%ITER%-a%SEQ%.diff",
  test_results: "test-results-r%REV%-i%ITER%-a%SEQ%.json",
} as const;
export type ArtifactName = keyof typeof ARTIFACT_FILES;

export interface StoredArtifact<T = unknown> {
  metadata: WorkflowArtifactMetadataV1;
  payload: T;
}
export interface ArtifactWrite<T> {
  job_id: string;
  name: ArtifactName;
  phase: WorkflowPhase;
  revision: number;
  invocation_id: string;
  producing_role: ProducingRole;
  parent_artifact_hash: string | null;
  payload: unknown;
  validate: (value: unknown) => T;
  timestamp?: string;
}
interface TransitionJournal {
  job: WorkflowJobV1;
  passport: WorkflowPassportV1;
  event: WorkflowEventV1;
}
interface PassportJournal {
  passport: WorkflowPassportV1;
}
interface SessionsJournal {
  kind: "sessions" | "sessions_passport" | "binding_rotation";
  sessions: WorkflowSessionsV1;
  passport?: WorkflowPassportV1;
}

export class WorkflowArtifactStore {
  private readonly root: string;
  constructor(projectRoot: string) {
    this.root = path.join(projectRoot, ".orchestry", "workflows");
  }

  async createJob(
    job: WorkflowJobV1,
    passport: WorkflowPassportV1,
    sessions: WorkflowSessionsV1,
  ): Promise<void> {
    const validatedJob = validateWorkflowJob(job);
    const validatedPassport = validateWorkflowPassport(passport);
    const validatedSessions = validateWorkflowSessions(sessions);
    const id = safeId(validatedJob.job_id);
    if (validatedPassport.job_id !== id || validatedSessions.job_id !== id)
      throw new Error("Workflow job_id mismatch");
    if (
      validatedPassport.roster_revision !== 1 ||
      validatedPassport.binding_rotation_history.length !== 0 ||
      validatedPassport.active_roster_hash !== validatedPassport.roster_hash ||
      canonicalJson(validatedPassport.active_roster) !==
        canonicalJson(validatedPassport.roster)
    )
      throw new Error(
        "New workflow must begin with the immutable initial roster as active revision 1",
      );
    if (
      Buffer.byteLength(JSON.stringify(validatedPassport)) >
      validatedPassport.config.passport_max_bytes
    )
      throw new Error("Workflow passport exceeded configured maximum");
    await this.secureDir(id);
    if (await this.readJob(id))
      throw new Error(`Workflow job already exists: ${id}`);
    await Promise.all([
      this.write(this.file(id, "job.json"), validatedJob),
      this.write(this.file(id, "passport.json"), validatedPassport),
      this.write(
        this.file(
          id,
          `passports/passport-${String(validatedPassport.passport_revision).padStart(6, "0")}.json`,
        ),
        validatedPassport,
      ),
      this.write(this.file(id, "sessions.json"), validatedSessions),
    ]);
  }

  async writeArtifact<T>(input: ArtifactWrite<T>): Promise<StoredArtifact<T>> {
    const id = safeId(input.job_id);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (!input.invocation_id)
        throw new Error("Artifact invocation_id is required");
      const prior = await this.artifactForInvocation<T>(
        id,
        input.name,
        input.invocation_id,
      );
      if (prior) {
        if (job.artifact_revision < prior.metadata.revision)
          await this.write(this.file(id, "job.json"), {
            ...job,
            artifact_revision: prior.metadata.revision,
            latest_artifact_hash: prior.metadata.artifact_hash,
            updated_at: prior.metadata.timestamp,
          });
        return prior;
      }
      if (input.revision !== job.artifact_revision + 1)
        throw new Error(
          `Stale artifact revision: expected ${job.artifact_revision + 1}, received ${input.revision}`,
        );
      if (input.parent_artifact_hash !== job.latest_artifact_hash)
        throw new Error("Stale parent_artifact_hash");
      if (
        input.parent_artifact_hash !== null &&
        !SHA256.test(input.parent_artifact_hash)
      )
        throw new Error("Invalid parent_artifact_hash");
      if (job.phase !== input.phase)
        throw new Error(
          `Artifact phase ${input.phase} does not match job phase ${job.phase}`,
        );
      const payload = input.validate(removeForbidden(input.payload));
      const timestamp = iso(input.timestamp ?? new Date().toISOString());
      const artifactHash = hashCanonical(payload);
      const filename = artifactFilename(
        input.name,
        job.revision,
        job.opus_iteration,
        input.revision,
      );
      const stored: StoredArtifact<T> = {
        metadata: {
          schema_version: 2,
          job_id: id,
          artifact_name: input.name,
          filename,
          phase: input.phase,
          workflow_revision: job.revision,
          iteration: job.opus_iteration,
          revision: input.revision,
          invocation_id: input.invocation_id,
          producing_role: input.producing_role,
          parent_artifact_hash: input.parent_artifact_hash,
          timestamp,
          artifact_hash: artifactHash,
        },
        payload,
      };
      const file = path.join(this.root, id, "artifacts", filename);
      try {
        await fs.access(file);
        throw new Error(
          `Refusing to overwrite immutable artifact: ${filename}`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await this.write(file, stored);
      await this.write(this.file(id, "job.json"), {
        ...job,
        artifact_revision: input.revision,
        latest_artifact_hash: artifactHash,
        updated_at: timestamp,
      });
      return stored;
    });
  }

  async writeTextArtifact(
    input: Omit<ArtifactWrite<string>, "validate">,
  ): Promise<StoredArtifact<string>> {
    return this.writeArtifact({
      ...input,
      validate: (value) => {
        if (typeof value !== "string" || !value.trim())
          throw new Error(`${input.name} must be non-empty text`);
        return sanitizeText(value);
      },
    });
  }

  async readArtifact<T>(
    jobId: string,
    name: ArtifactName,
    workflowRevision?: number,
  ): Promise<StoredArtifact<T> | null> {
    const id = safeId(jobId);
    await this.requiredJob(id);
    const value = await this.latestArtifact<T>(id, name, workflowRevision);
    if (!value) return null;
    if (
      value.metadata.job_id !== id ||
      hashCanonical(value.payload) !== value.metadata.artifact_hash
    )
      throw new Error("Workflow artifact integrity check failed");
    return value;
  }

  async readTextArtifact(
    jobId: string,
    name: ArtifactName,
    workflowRevision?: number,
  ): Promise<StoredArtifact<string> | null> {
    const value = await this.readArtifact<string>(
      jobId,
      name,
      workflowRevision,
    );
    if (value && typeof value.payload !== "string")
      throw new Error("Workflow text artifact is not text");
    return value;
  }

  async transition(
    jobId: string,
    next: WorkflowPhase,
    patch: Partial<WorkflowJobV1> = {},
  ): Promise<WorkflowJobV1> {
    return this.commitTransition(jobId, next, patch, {});
  }
  async commitTransition(
    jobId: string,
    next: WorkflowPhase,
    patch: Partial<WorkflowJobV1>,
    passportPatch: Partial<WorkflowPassportV1>,
  ): Promise<WorkflowJobV1> {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      await this.recoverSessions(id);
      await this.recoverPassport(id);
      await this.recoverTransition(id);
      const job = await this.requiredJob(id);
      const passport = await this.readPassport(id);
      if (!passport) throw new Error(`Workflow passport not found: ${id}`);
      if (!canTransitionWorkflow(job.phase, next))
        throw new Error(
          `Invalid workflow phase transition: ${job.phase} -> ${next}`,
        );
      const now = new Date().toISOString();
      const updatedJob = validateWorkflowJob({
        ...job,
        ...patch,
        schema_version: 2,
        job_id: id,
        phase: next,
        revision: job.revision + 1,
        updated_at: now,
      });
      const updatedPassport = validateWorkflowPassport({
        ...passport,
        ...passportPatch,
        schema_version: 2,
        job_id: id,
        passport_revision: passport.passport_revision + 1,
        current_phase: next,
        current_revision: updatedJob.revision,
        next_action: updatedJob.next_action,
        current_blockers: updatedJob.blocker ? [updatedJob.blocker] : [],
      });
      assertSameRoster(passport, updatedPassport);
      if (
        Buffer.byteLength(JSON.stringify(updatedPassport)) >
        updatedPassport.config.passport_max_bytes
      )
        throw new Error("Workflow passport exceeded configured maximum");
      const event: WorkflowEventV1 = {
        schema_version: 2,
        job_id: id,
        type: "phase_changed",
        timestamp: now,
        data: {
          transition_id: `transition-${updatedJob.revision}`,
          from: job.phase,
          to: next,
        },
      };
      const journal: TransitionJournal = {
        job: updatedJob,
        passport: updatedPassport,
        event,
      };
      await this.write(this.file(id, "transition.pending.json"), journal);
      await this.applyTransition(id, journal);
      return updatedJob;
    });
  }

  async patchJob(
    jobId: string,
    patch: Partial<WorkflowJobV1>,
  ): Promise<WorkflowJobV1> {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      const updated = validateWorkflowJob({
        ...job,
        ...patch,
        schema_version: 2,
        job_id: id,
        phase: job.phase,
        updated_at: new Date().toISOString(),
      });
      await this.write(this.file(id, "job.json"), updated);
      return updated;
    });
  }
  async reserveOperation(
    jobId: string,
    phase: WorkflowPhase,
    operation: NonNullable<WorkflowJobV1["current_operation"]>,
  ): Promise<boolean> {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (job.phase !== phase || job.current_operation !== null) return false;
      const updated = validateWorkflowJob({
        ...job,
        current_operation: operation,
        updated_at: new Date().toISOString(),
      });
      await this.write(this.file(id, "job.json"), updated);
      return true;
    });
  }
  async readJob(jobId: string): Promise<WorkflowJobV1 | null> {
    const id = safeId(jobId);
    await this.recoverSessions(id);
    await this.recoverTransition(id);
    const value = await readJson<unknown>(this.file(id, "job.json"));
    return value === null ? null : validateWorkflowJob(value);
  }
  async readPassport(jobId: string): Promise<WorkflowPassportV1 | null> {
    const id = safeId(jobId);
    await this.recoverSessions(id);
    await this.recoverPassport(id);
    await this.recoverTransition(id);
    const value = await readJson<unknown>(this.file(id, "passport.json"));
    return value === null ? null : validateWorkflowPassport(value);
  }
  async writePassport(value: WorkflowPassportV1): Promise<void> {
    const validated = validateWorkflowPassport(value);
    const id = safeId(validated.job_id);
    if (
      Buffer.byteLength(JSON.stringify(validated)) >
      validated.config.passport_max_bytes
    )
      throw new Error("Workflow passport exceeded configured maximum");
    await this.lock(id, async () => {
      await this.recoverPassport(id);
      const current = await this.readPassport(id);
      if (current) assertSameRoster(current, validated);
      if (
        current &&
        validated.passport_revision !== current.passport_revision + 1
      )
        throw new Error(
          `Stale passport revision: expected ${current.passport_revision + 1}, received ${validated.passport_revision}`,
        );
      const journal: PassportJournal = { passport: validated };
      await this.write(this.file(id, "passport.pending.json"), journal);
      await this.applyPassport(id, journal);
    });
  }
  async readSessions(jobId: string): Promise<WorkflowSessionsV1 | null> {
    const id = safeId(jobId);
    await this.recoverSessions(id);
    const value = await readJson<unknown>(this.file(id, "sessions.json"));
    return value === null ? null : validateWorkflowSessions(value);
  }
  async writeSessions(value: WorkflowSessionsV1): Promise<void> {
    const validated = validateWorkflowSessions(value);
    const id = safeId(validated.job_id);
    await this.requiredJob(id);
    await this.lock(id, async () => {
      await this.recoverSessions(id);
      const current = await readJson<unknown>(this.file(id, "sessions.json"));
      if (
        current &&
        validated.sessions_revision !==
          validateWorkflowSessions(current).sessions_revision + 1
      )
        throw new Error("Stale sessions revision");
      const journal: SessionsJournal = {
        kind: "sessions",
        sessions: validated,
      };
      await this.write(this.file(id, "sessions.pending.json"), journal);
      await this.applySessions(id, journal);
    });
  }
  async commitSessionsAndPassport(
    sessionsValue: WorkflowSessionsV1,
    passportValue: WorkflowPassportV1,
  ): Promise<void> {
    return this.commitSessionsPassport(sessionsValue, passportValue, false);
  }
  async commitBindingRotation(
    sessionsValue: WorkflowSessionsV1,
    passportValue: WorkflowPassportV1,
  ): Promise<void> {
    return this.commitSessionsPassport(sessionsValue, passportValue, true);
  }
  async appendEvent(event: WorkflowEventV1): Promise<void> {
    const id = safeId(event.job_id);
    await this.requiredJob(id);
    await appendJsonl(this.file(id, "events.jsonl"), {
      ...event,
      data: removeForbidden(event.data),
    });
    await fs.chmod(this.file(id, "events.jsonl"), 0o600).catch(() => {});
  }
  async readEvents(jobId: string): Promise<WorkflowEventV1[]> {
    return readJsonl<WorkflowEventV1>(this.file(safeId(jobId), "events.jsonl"));
  }
  async writeInvocationReceipt(
    value: WorkflowInvocationReceiptV1,
  ): Promise<void> {
    const id = safeId(value.job_id);
    const file = this.file(
      id,
      `invocations/${safeId(value.invocation_id)}.json`,
    );
    const request = removeForbidden(value.request);
    const result = removeForbidden(value.result);
    const normalized = {
      ...value,
      request,
      result,
      request_hash: hashCanonical(request),
      result_hash: hashCanonical(result),
    };
    await this.lock(id, async () => {
      const prior = await readJson<WorkflowInvocationReceiptV1>(file);
      if (prior) {
        if (canonicalJson(prior) !== canonicalJson(normalized))
          throw new Error("Conflicting invocation receipt already exists");
        return;
      }
      await this.write(file, normalized);
    });
  }
  async readInvocationReceipt(
    jobId: string,
    invocationId: string,
  ): Promise<WorkflowInvocationReceiptV1 | null> {
    const value = await readJson<WorkflowInvocationReceiptV1>(
      this.file(safeId(jobId), `invocations/${safeId(invocationId)}.json`),
    );
    if (!value) return null;
    if (
      value.schema_version !== 2 ||
      value.job_id !== jobId ||
      value.invocation_id !== invocationId ||
      !SHA256.test(value.request_hash) ||
      value.request_hash !== hashCanonical(value.request) ||
      !SHA256.test(value.result_hash) ||
      value.result_hash !== hashCanonical(value.result) ||
      !Number.isSafeInteger(value.workflow_revision) ||
      (value.roster_revision !== undefined &&
        (!Number.isSafeInteger(value.roster_revision) ||
          value.roster_revision < 1))
    )
      throw new Error("Invalid invocation receipt");
    return value;
  }
  async readInvocationReceipts(
    jobId: string,
  ): Promise<WorkflowInvocationReceiptV1[]> {
    const id = safeId(jobId);
    const dir = this.file(id, "invocations");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const receipts = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => this.readInvocationReceipt(id, entry.slice(0, -5))),
    );
    return receipts
      .filter((value): value is WorkflowInvocationReceiptV1 => value !== null)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  async writeLlmAttempt(value: WorkflowLlmAttemptV1): Promise<void> {
    const attempt = validateAttempt(value);
    const id = safeId(attempt.job_id);
    const file = this.file(
      id,
      `attempts/${safeId(attempt.attempt_id)}-${attempt.status === "started" ? "started" : "terminal"}.json`,
    );
    await this.lock(id, async () => {
      const prior = await readJson<WorkflowLlmAttemptV1>(file);
      if (prior) {
        if (canonicalJson(prior) !== canonicalJson(attempt))
          throw new Error("Conflicting LLM attempt receipt already exists");
        return;
      }
      if (attempt.status !== "started") {
        const started = await readJson<WorkflowLlmAttemptV1>(
          this.file(id, `attempts/${safeId(attempt.attempt_id)}-started.json`),
        );
        if (
          !started ||
          started.status !== "started" ||
          started.binding_hash !== attempt.binding_hash ||
          started.semantic_role !== attempt.semantic_role ||
          started.adapter !== attempt.adapter
        )
          throw new Error(
            "LLM attempt terminal receipt does not match its start",
          );
      }
      await this.write(file, attempt);
    });
  }
  async readLlmAttempts(jobId: string): Promise<WorkflowLlmAttemptV1[]> {
    const id = safeId(jobId);
    const dir = this.file(id, "attempts");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const grouped = new Map<string, WorkflowLlmAttemptV1>();
    for (const entry of entries
      .filter((item) => item.endsWith(".json"))
      .sort()) {
      const raw = await readJson<WorkflowLlmAttemptV1>(path.join(dir, entry));
      if (!raw) continue;
      const attempt = validateAttempt(raw);
      if (attempt.job_id !== id) throw new Error("Invalid LLM attempt receipt");
      const current = grouped.get(attempt.attempt_id);
      if (!current || attempt.status !== "started")
        grouped.set(attempt.attempt_id, attempt);
    }
    return [...grouped.values()].sort((a, b) =>
      a.started_at.localeCompare(b.started_at),
    );
  }
  async readEffectReceipt(
    jobId: string,
    invocationId: string,
    kind: WorkflowEffectReceiptV2["kind"],
  ): Promise<WorkflowEffectReceiptV2 | null> {
    const id = safeId(jobId);
    const invocation = safeId(invocationId);
    const completed = await readJson<WorkflowEffectReceiptV2>(
      this.file(id, `effects/${invocation}-${kind}-completed.json`),
    );
    const value =
      completed ??
      (await readJson<WorkflowEffectReceiptV2>(
        this.file(id, `effects/${invocation}-${kind}-started.json`),
      ));
    if (!value) return null;
    const validResult =
      value.status === "started"
        ? value.result === null && value.result_hash === null
        : value.result !== null &&
          typeof value.result_hash === "string" &&
          SHA256.test(value.result_hash) &&
          value.result_hash === hashCanonical(value.result);
    if (
      value.schema_version !== 2 ||
      value.job_id !== jobId ||
      value.invocation_id !== invocationId ||
      value.kind !== kind ||
      !SHA256.test(value.request_hash) ||
      value.request_hash !== hashCanonical(value.request) ||
      !Number.isSafeInteger(value.workflow_revision) ||
      !["started", "completed"].includes(value.status) ||
      !validResult
    )
      throw new Error("Invalid workflow effect receipt");
    return value;
  }
  async writeEffectReceipt(value: WorkflowEffectReceiptV2): Promise<void> {
    const id = safeId(value.job_id);
    const file = this.file(
      id,
      `effects/${safeId(value.invocation_id)}-${value.kind}-${value.status}.json`,
    );
    const request = removeForbidden(value.request);
    const result = removeForbidden(value.result);
    const normalized = {
      ...value,
      request,
      request_hash: hashCanonical(request),
      result,
      result_hash: value.status === "completed" ? hashCanonical(result) : null,
    };
    await this.lock(id, async () => {
      const prior = await readJson<WorkflowEffectReceiptV2>(file);
      if (prior) {
        if (canonicalJson(prior) !== canonicalJson(normalized))
          throw new Error("Conflicting workflow effect receipt already exists");
        return;
      }
      const other = await this.readEffectReceipt(
        id,
        value.invocation_id,
        value.kind,
      );
      if (
        other &&
        (other.request_hash !== normalized.request_hash ||
          other.workflow_revision !== normalized.workflow_revision)
      )
        throw new Error("Conflicting workflow effect receipt already exists");
      await this.write(file, normalized);
    });
  }
  async listJobs(): Promise<WorkflowJobV1[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const jobs = (
      await Promise.all(
        entries.map((id) => (SAFE_ID.test(id) ? this.readJob(id) : null)),
      )
    ).filter((job): job is WorkflowJobV1 => job !== null);
    return jobs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  artifactPath(jobId: string, name: ArtifactName, revision: number): string {
    return path.join(
      this.root,
      safeId(jobId),
      "artifacts",
      artifactFilename(name, revision, 0, 0),
    );
  }

  private async requiredJob(id: string): Promise<WorkflowJobV1> {
    const job = await this.readJob(id);
    if (!job) throw new Error(`Workflow job not found: ${id}`);
    return job;
  }
  private async commitSessionsPassport(
    sessionsValue: WorkflowSessionsV1,
    passportValue: WorkflowPassportV1,
    bindingRotation: boolean,
  ): Promise<void> {
    const sessions = validateWorkflowSessions(sessionsValue);
    const passport = validateWorkflowPassport(passportValue);
    const id = safeId(sessions.job_id);
    if (passport.job_id !== id)
      throw new Error("Session/passport job_id mismatch");
    await this.lock(id, async () => {
      await this.recoverSessions(id);
      const currentSessionsRaw = await readJson<unknown>(
        this.file(id, "sessions.json"),
      );
      const currentPassportRaw = await readJson<unknown>(
        this.file(id, "passport.json"),
      );
      if (!currentSessionsRaw || !currentPassportRaw)
        throw new Error("Session/passport state is missing");
      const currentSessions = validateWorkflowSessions(currentSessionsRaw);
      const currentPassport = validateWorkflowPassport(currentPassportRaw);
      if (bindingRotation)
        await this.assertRecoverableBindingRotation(
          id,
          currentPassport,
          passport,
        );
      else assertSameRoster(currentPassport, passport);
      if (sessions.sessions_revision !== currentSessions.sessions_revision + 1)
        throw new Error("Stale sessions revision");
      if (passport.passport_revision !== currentPassport.passport_revision + 1)
        throw new Error("Stale passport revision");
      if (
        Buffer.byteLength(JSON.stringify(passport)) >
        passport.config.passport_max_bytes
      )
        throw new Error("Workflow passport exceeded configured maximum");
      const journal: SessionsJournal = {
        kind: bindingRotation ? "binding_rotation" : "sessions_passport",
        sessions,
        passport,
      };
      await this.write(this.file(id, "sessions.pending.json"), journal);
      await this.applySessions(id, journal);
    });
  }
  private file(id: string, name: string): string {
    return path.join(this.root, safeId(id), name);
  }
  private async latestArtifact<T>(
    id: string,
    name: ArtifactName,
    workflowRevision?: number,
  ): Promise<StoredArtifact<T> | null> {
    const dir = this.file(id, "artifacts");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let latest: StoredArtifact<T> | null = null;
    for (const entry of entries) {
      const value = await readJson<StoredArtifact<T>>(path.join(dir, entry));
      if (
        value?.metadata.artifact_name === name &&
        (workflowRevision === undefined ||
          value.metadata.workflow_revision === workflowRevision) &&
        (!latest || value.metadata.revision > latest.metadata.revision)
      )
        latest = value;
    }
    return latest;
  }
  private async artifactForInvocation<T>(
    id: string,
    name: ArtifactName,
    invocationId: string,
  ): Promise<StoredArtifact<T> | null> {
    const dir = this.file(id, "artifacts");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    for (const entry of entries) {
      const value = await readJson<StoredArtifact<T>>(path.join(dir, entry));
      if (
        value?.metadata.artifact_name === name &&
        value.metadata.invocation_id === invocationId
      )
        return value;
    }
    return null;
  }
  private async write(file: string, value: unknown): Promise<void> {
    await atomicWrite(file, canonicalJson(removeForbidden(value)) + "\n");
  }
  private async recoverTransition(id: string): Promise<void> {
    const journal = await readJson<TransitionJournal>(
      this.file(id, "transition.pending.json"),
    );
    if (journal) {
      journal.passport = await this.normalizePendingPassport(
        id,
        journal.passport,
      );
      await this.applyTransition(id, journal);
    }
  }
  private async applyTransition(
    id: string,
    journal: TransitionJournal,
  ): Promise<void> {
    const pending = this.file(id, "transition.pending.json");
    const currentJobRaw = await readJson<unknown>(this.file(id, "job.json"));
    const currentPassportRaw = await readJson<unknown>(
      this.file(id, "passport.json"),
    );
    const currentJob = currentJobRaw
      ? validateWorkflowJob(currentJobRaw)
      : null;
    const currentPassport = currentPassportRaw
      ? validateWorkflowPassport(currentPassportRaw)
      : null;
    if (
      currentJob &&
      currentPassport &&
      (currentJob.revision > journal.job.revision ||
        currentPassport.passport_revision > journal.passport.passport_revision)
    ) {
      if (
        currentJob.revision >= journal.job.revision &&
        currentPassport.passport_revision >= journal.passport.passport_revision
      ) {
        await fs.rm(pending, { force: true });
        return;
      }
      throw new Error(
        "Transition journal is inconsistent with newer canonical state",
      );
    }
    if (
      currentJob?.revision === journal.job.revision &&
      canonicalJson(currentJob) !== canonicalJson(journal.job)
    )
      throw new Error("Transition journal conflicts with canonical job");
    if (
      currentPassport?.passport_revision ===
        journal.passport.passport_revision &&
      canonicalJson(currentPassport) !== canonicalJson(journal.passport)
    )
      throw new Error("Transition journal conflicts with canonical passport");
    const snapshot = this.file(
      id,
      `passports/passport-${String(journal.passport.passport_revision).padStart(6, "0")}.json`,
    );
    const existing = await readJson<unknown>(snapshot);
    if (existing && canonicalJson(existing) !== canonicalJson(journal.passport))
      throw new Error(
        "Transition journal conflicts with immutable passport snapshot",
      );
    if (!existing) await this.write(snapshot, journal.passport);
    await this.write(this.file(id, "passport.json"), journal.passport);
    await this.write(this.file(id, "job.json"), journal.job);
    const events = await readJsonl<WorkflowEventV1>(
      this.file(id, "events.jsonl"),
    );
    const transitionId = (journal.event.data as { transition_id?: string })
      .transition_id;
    if (
      !events.some(
        (event) =>
          (event.data as { transition_id?: string })?.transition_id ===
          transitionId,
      )
    )
      await appendJsonl(this.file(id, "events.jsonl"), journal.event);
    await fs.rm(pending, { force: true });
  }
  private async recoverPassport(id: string): Promise<void> {
    const journal = await readJson<PassportJournal>(
      this.file(id, "passport.pending.json"),
    );
    if (journal) {
      journal.passport = await this.normalizePendingPassport(
        id,
        journal.passport,
      );
      await this.applyPassport(id, journal);
    }
  }
  private async applyPassport(
    id: string,
    journal: PassportJournal,
  ): Promise<void> {
    const pending = this.file(id, "passport.pending.json");
    const currentRaw = await readJson<unknown>(this.file(id, "passport.json"));
    const current = currentRaw ? validateWorkflowPassport(currentRaw) : null;
    if (
      current &&
      current.passport_revision > journal.passport.passport_revision
    ) {
      await fs.rm(pending, { force: true });
      return;
    }
    if (
      current?.passport_revision === journal.passport.passport_revision &&
      canonicalJson(current) !== canonicalJson(journal.passport)
    )
      throw new Error("Passport journal conflicts with canonical passport");
    const snapshot = this.file(
      id,
      `passports/passport-${String(journal.passport.passport_revision).padStart(6, "0")}.json`,
    );
    const existing = await readJson<unknown>(snapshot);
    if (existing && canonicalJson(existing) !== canonicalJson(journal.passport))
      throw new Error("Passport journal conflicts with immutable snapshot");
    if (!existing) await this.write(snapshot, journal.passport);
    await this.write(this.file(id, "passport.json"), journal.passport);
    await fs.rm(pending, { force: true });
  }
  private async recoverSessions(id: string): Promise<void> {
    const journal = await readJson<SessionsJournal>(
      this.file(id, "sessions.pending.json"),
    );
    if (journal) {
      journal.kind ??= journal.passport ? "sessions_passport" : "sessions";
      if (journal.passport)
        journal.passport = await this.normalizePendingPassport(
          id,
          journal.passport,
        );
      await this.applySessions(id, journal);
    }
  }
  private async applySessions(
    id: string,
    journal: SessionsJournal,
  ): Promise<void> {
    const pending = this.file(id, "sessions.pending.json");
    if (
      !["sessions", "sessions_passport", "binding_rotation"].includes(
        journal.kind,
      )
    )
      throw new Error("Sessions journal kind is invalid");
    const sessions = validateWorkflowSessions(journal.sessions);
    const passport = journal.passport
      ? validateWorkflowPassport(journal.passport)
      : null;
    if ((journal.kind === "sessions") !== (passport === null))
      throw new Error("Sessions journal kind does not match its payload");
    const currentSessionsRaw = await readJson<unknown>(
      this.file(id, "sessions.json"),
    );
    const currentPassportRaw = passport
      ? await readJson<unknown>(this.file(id, "passport.json"))
      : null;
    const currentSessions = currentSessionsRaw
      ? validateWorkflowSessions(currentSessionsRaw)
      : null;
    const currentPassport = currentPassportRaw
      ? validateWorkflowPassport(currentPassportRaw)
      : null;
    if (
      currentSessions &&
      (currentSessions.sessions_revision > sessions.sessions_revision ||
        (passport &&
          currentPassport &&
          currentPassport.passport_revision > passport.passport_revision))
    ) {
      if (
        currentSessions.sessions_revision >= sessions.sessions_revision &&
        (!passport ||
          (currentPassport &&
            currentPassport.passport_revision >= passport.passport_revision))
      ) {
        await fs.rm(pending, { force: true });
        return;
      }
      throw new Error(
        "Sessions journal is inconsistent with newer canonical state",
      );
    }
    if (
      currentSessions?.sessions_revision === sessions.sessions_revision &&
      canonicalJson(currentSessions) !== canonicalJson(sessions)
    )
      throw new Error("Sessions journal conflicts with canonical sessions");
    if (
      passport &&
      currentPassport?.passport_revision === passport.passport_revision &&
      canonicalJson(currentPassport) !== canonicalJson(passport)
    )
      throw new Error("Sessions journal conflicts with canonical passport");
    if (
      passport &&
      currentPassport &&
      currentPassport.passport_revision < passport.passport_revision
    ) {
      if (journal.kind === "binding_rotation")
        await this.assertRecoverableBindingRotation(
          id,
          currentPassport,
          passport,
        );
      else assertSameRoster(currentPassport, passport);
    }
    const revision = String(sessions.sessions_revision).padStart(6, "0");
    const snapshot = this.file(id, `sessions/sessions-${revision}.json`);
    const existing = await readJson<unknown>(snapshot);
    if (existing && canonicalJson(existing) !== canonicalJson(sessions))
      throw new Error("Sessions journal conflicts with immutable snapshot");
    if (!existing) await this.write(snapshot, sessions);
    if (passport) {
      const passportSnapshot = this.file(
        id,
        `passports/passport-${String(passport.passport_revision).padStart(6, "0")}.json`,
      );
      const existingPassport = await readJson<unknown>(passportSnapshot);
      if (
        existingPassport &&
        canonicalJson(existingPassport) !== canonicalJson(passport)
      )
        throw new Error(
          "Sessions journal conflicts with immutable passport snapshot",
        );
      if (!existingPassport) await this.write(passportSnapshot, passport);
      await this.write(this.file(id, "passport.json"), passport);
    }
    await this.write(this.file(id, "sessions.json"), sessions);
    await fs.rm(pending, { force: true });
  }
  private async assertRecoverableBindingRotation(
    id: string,
    current: WorkflowPassportV1,
    next: WorkflowPassportV1,
  ): Promise<void> {
    const jobRaw = await readJson<unknown>(this.file(id, "job.json"));
    if (!jobRaw) throw new Error("Workflow job state is missing");
    const job = validateWorkflowJob(jobRaw);
    if (
      (job.phase !== "paused" && job.phase !== "blocked") ||
      job.current_operation !== null ||
      !job.resume_phase ||
      job.resume_phase === "verification" ||
      job.resume_phase === "merge_ready" ||
      ["done", "cancelled", "failed"].includes(job.resume_phase) ||
      next.current_revision !== job.revision ||
      next.current_phase !== job.phase ||
      current.current_revision !== job.revision ||
      current.current_phase !== job.phase
    )
      throw new Error("Binding rotation became stale before commit");
    assertBindingRotation(current, next);
  }
  private async normalizePendingPassport(
    id: string,
    value: WorkflowPassportV1,
  ): Promise<WorkflowPassportV1> {
    const raw = value as WorkflowPassportV1 & Record<string, unknown>;
    const currentRaw = await readJson<unknown>(this.file(id, "passport.json"));
    if (!currentRaw) return validateWorkflowPassport(raw);
    const current = validateWorkflowPassport(currentRaw);
    const initial =
      "roster" in raw || "roster_hash" in raw
        ? {}
        : { roster: current.roster, roster_hash: current.roster_hash };
    const active = [
      "active_roster",
      "active_roster_hash",
      "roster_revision",
      "binding_rotation_history",
    ].some((key) => key in raw)
      ? {}
      : {
          active_roster: current.active_roster,
          active_roster_hash: current.active_roster_hash,
          roster_revision: current.roster_revision,
          binding_rotation_history: current.binding_rotation_history,
        };
    return validateWorkflowPassport({ ...raw, ...initial, ...active });
  }
  private async secureDir(id: string): Promise<void> {
    const dir = this.file(id, "");
    await Promise.all([
      ensureDir(path.join(dir, "artifacts")),
      ensureDir(path.join(dir, "passports")),
      ensureDir(path.join(dir, "sessions")),
      ensureDir(path.join(dir, "invocations")),
      ensureDir(path.join(dir, "attempts")),
      ensureDir(path.join(dir, "effects")),
    ]);
    await Promise.all([
      fs.chmod(this.root, 0o700).catch(() => {}),
      fs.chmod(dir, 0o700),
      fs.chmod(path.join(dir, "artifacts"), 0o700),
      fs.chmod(path.join(dir, "passports"), 0o700),
      fs.chmod(path.join(dir, "sessions"), 0o700),
      fs.chmod(path.join(dir, "invocations"), 0o700),
      fs.chmod(path.join(dir, "attempts"), 0o700),
      fs.chmod(path.join(dir, "effects"), 0o700),
    ]);
  }
  private async lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    await this.secureDir(id);
    const lock = this.file(id, ".workflow.lock");
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        await fs.mkdir(lock, { mode: 0o700 });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const stat = await fs.stat(lock).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 30_000) {
          await fs.rm(lock, { recursive: true, force: true });
          continue;
        }
        if (Date.now() > deadline)
          throw new Error(`Workflow lock is active: ${id}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(lock, { recursive: true, force: true });
    }
  }
}

export function artifactReference<T>(
  _name: string,
  stored: StoredArtifact<T>,
): ArtifactReference {
  return {
    filename: stored.metadata.filename,
    hash: stored.metadata.artifact_hash,
    phase: stored.metadata.phase,
    revision: stored.metadata.revision,
    iteration: stored.metadata.iteration,
    role: stored.metadata.producing_role,
  };
}
export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function hashPersisted(value: unknown): string {
  return hashCanonical(removeForbidden(value));
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}
function removeForbidden(value: unknown): unknown {
  const safe = sanitizeForPersistence(value);
  if (Array.isArray(safe)) return safe.map(removeForbidden);
  if (safe && typeof safe === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(safe))
      if (!FORBIDDEN_FIELD.test(key)) out[key] = removeForbidden(nested);
    return out;
  }
  return safe;
}
function safeId(value: string): string {
  if (!SAFE_ID.test(value) || value === "." || value === "..")
    throw new Error(`Invalid workflow job id: ${value}`);
  return value;
}
function iso(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
  return value;
}
function validateAttempt(value: WorkflowLlmAttemptV1): WorkflowLlmAttemptV1 {
  if (
    value.schema_version !== 1 ||
    !SAFE_ID.test(value.job_id) ||
    !SAFE_ID.test(value.attempt_id) ||
    !SAFE_ID.test(value.invocation_id) ||
    !["supervisor", "implementer", "adviser", "reviewer"].includes(
      value.semantic_role,
    ) ||
    !["codex", "fable", "opus"].includes(value.provider_role) ||
    !SAFE_ID.test(value.adapter) ||
    !SHA256.test(value.binding_hash) ||
    !Number.isSafeInteger(value.roster_revision) ||
    value.roster_revision < 1 ||
    !["started", "succeeded", "failed"].includes(value.status) ||
    !["known", "estimated", "unknown"].includes(value.usage_status) ||
    !Number.isFinite(Date.parse(value.started_at)) ||
    (value.completed_at !== null &&
      !Number.isFinite(Date.parse(value.completed_at)))
  )
    throw new Error("Invalid LLM attempt receipt");
  if (
    value.status === "started" &&
    (value.completed_at !== null ||
      value.usage !== null ||
      value.error_category !== null ||
      value.error_message !== null ||
      value.usage_status !== "unknown")
  )
    throw new Error("Invalid started LLM attempt receipt");
  if (value.status !== "started" && value.completed_at === null)
    throw new Error("Invalid terminal LLM attempt receipt");
  if (value.status === "failed" && !value.error_category)
    throw new Error("Failed LLM attempt requires an error category");
  if (
    value.usage &&
    (!Number.isSafeInteger(value.usage.duration_ms) ||
      value.usage.duration_ms < 0)
  )
    throw new Error("Invalid LLM attempt usage");
  if (
    value.usage_status === "known" &&
    (!value.usage ||
      !Number.isSafeInteger(value.usage.input_tokens) ||
      !Number.isSafeInteger(value.usage.output_tokens))
  )
    throw new Error(
      "Known LLM attempt usage requires exact input and output tokens",
    );
  if (
    value.usage_status === "estimated" &&
    (!value.usage ||
      (!Number.isSafeInteger(value.usage.input_chars) &&
        !Number.isSafeInteger(value.usage.output_chars)))
  )
    throw new Error("Estimated LLM attempt usage requires character metrics");
  return value;
}
function artifactFilename(
  name: ArtifactName,
  workflowRevision: number,
  iteration: number,
  sequence: number,
): string {
  return ARTIFACT_FILES[name]
    .replace("%REV%", String(workflowRevision).padStart(3, "0"))
    .replace("%ITER%", String(iteration).padStart(3, "0"))
    .replace("%SEQ%", String(sequence).padStart(6, "0"));
}
function assertSameRoster(
  current: WorkflowPassportV1,
  next: WorkflowPassportV1,
): void {
  if (
    current.roster_hash !== next.roster_hash ||
    canonicalJson(current.roster) !== canonicalJson(next.roster)
  )
    throw new Error("Workflow initial roster is immutable after job creation");
  if (
    current.active_roster_hash !== next.active_roster_hash ||
    canonicalJson(current.active_roster) !==
      canonicalJson(next.active_roster) ||
    current.roster_revision !== next.roster_revision ||
    canonicalJson(current.binding_rotation_history) !==
      canonicalJson(next.binding_rotation_history)
  )
    throw new Error(
      "Workflow active roster may only change through binding rotation",
    );
}
function assertBindingRotation(
  current: WorkflowPassportV1,
  next: WorkflowPassportV1,
): void {
  if (
    current.roster_hash !== next.roster_hash ||
    canonicalJson(current.roster) !== canonicalJson(next.roster)
  )
    throw new Error("Workflow initial roster is immutable after job creation");
  if (
    next.roster_revision !== current.roster_revision! + 1 ||
    next.binding_rotation_history!.length !==
      current.binding_rotation_history!.length + 1 ||
    canonicalJson(next.binding_rotation_history!.slice(0, -1)) !==
      canonicalJson(current.binding_rotation_history) ||
    next.binding_rotation_history!.at(-1)?.revision !== next.roster_revision
  )
    throw new Error("Invalid binding rotation history");
  const rotation = next.binding_rotation_history!.at(-1)!;
  const currentRoster = current.active_roster!;
  const nextRoster = next.active_roster!;
  const before = effectiveBinding(currentRoster, rotation.role);
  const after = effectiveBinding(nextRoster, rotation.role);
  if (
    canonicalJson(before) !== canonicalJson(rotation.previous_binding) ||
    canonicalJson(after) !== canonicalJson(rotation.new_binding)
  )
    throw new Error(
      "Binding rotation history does not describe the active roster change",
    );
  const unchanged = (
    ["supervisor", "implementer", "adviser", "reviewer"] as const
  ).filter((role) => role !== rotation.role);
  if (
    unchanged.some(
      (role) =>
        canonicalJson(currentRoster[role]) !== canonicalJson(nextRoster[role]),
    )
  )
    throw new Error("Binding rotation may change only one semantic role");
}
function effectiveBinding(
  roster: NonNullable<WorkflowPassportV1["active_roster"]>,
  role: "supervisor" | "implementer" | "adviser" | "reviewer",
) {
  if (role === "reviewer")
    return "same_as" in roster.reviewer ? roster.supervisor : roster.reviewer;
  return roster[role];
}
