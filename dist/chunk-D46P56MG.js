import { readJson, appendJsonl, readJsonl, atomicWrite, ensureDir } from './chunk-54K3JU53.js';
import { sanitizeText, sanitizeForPersistence } from './chunk-RQZGDMFG.js';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// src/domain/workflow/transitions.ts
var ACTIVE = ["codex_brief", "fable_plan", "codex_plan_review", "fable_final_prompt", "opus_execution", "codex_technical_review", "fable_compliance_review", "codex_synthesis", "merge_ready"];
var WORKFLOW_PHASE_TRANSITIONS = {
  codex_brief: ["fable_plan", "blocked", "paused", "cancelled", "failed"],
  fable_plan: ["codex_plan_review", "blocked", "paused", "cancelled", "failed"],
  codex_plan_review: ["fable_plan", "fable_final_prompt", "blocked", "paused", "cancelled", "failed"],
  fable_final_prompt: ["opus_execution", "blocked", "paused", "cancelled", "failed"],
  opus_execution: ["codex_technical_review", "blocked", "paused", "cancelled", "failed"],
  codex_technical_review: ["fable_compliance_review", "codex_synthesis", "blocked", "paused", "cancelled", "failed"],
  fable_compliance_review: ["codex_synthesis", "blocked", "paused", "cancelled", "failed"],
  codex_synthesis: ["fable_final_prompt", "fable_plan", "merge_ready", "blocked", "paused", "cancelled", "failed"],
  merge_ready: ["done", "blocked", "failed", "paused", "cancelled"],
  done: [],
  blocked: ["codex_brief", "fable_plan", "codex_plan_review", "fable_final_prompt", "opus_execution", "codex_technical_review", "fable_compliance_review", "codex_synthesis", "merge_ready", "cancelled"],
  paused: [...ACTIVE, "blocked", "cancelled"],
  cancelled: [],
  failed: []
};
function canTransitionWorkflow(from, to) {
  return WORKFLOW_PHASE_TRANSITIONS[from].includes(to);
}
function transitionWorkflow(from, to) {
  if (!canTransitionWorkflow(from, to)) throw new Error(`Invalid workflow phase transition: ${from} -> ${to}`);
  return to;
}
function isTerminalWorkflowPhase(phase) {
  return phase === "done" || phase === "cancelled" || phase === "failed";
}

// src/infrastructure/workflow/artifact-store.ts
var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var SHA256 = /^[a-f0-9]{64}$/;
var FORBIDDEN_FIELD = /^(?:env|environment|credentials?|private[_-]?key|privatekey|pem|api[_-]?key|password|passwd|secret|token)$/i;
var ARTIFACT_FILES = {
  codex_brief: "codex-brief-r%REV%-a%SEQ%.json",
  fable_plan: "fable-plan-r%REV%-a%SEQ%.json",
  codex_plan_review: "codex-plan-review-r%REV%-a%SEQ%.json",
  fable_final_prompt: "fable-final-prompt-r%REV%-a%SEQ%.md",
  opus_report: "opus-report-r%REV%-a%SEQ%.json",
  opus_diff: "opus-r%REV%-a%SEQ%.diff",
  test_results: "test-results-r%REV%-a%SEQ%.json",
  codex_technical_review: "codex-technical-review-r%REV%-a%SEQ%.json",
  fable_compliance_review: "fable-compliance-review-r%REV%-a%SEQ%.json",
  codex_synthesis: "codex-synthesis-r%REV%-a%SEQ%.json"
};
var WorkflowArtifactStore = class {
  root;
  constructor(projectRoot) {
    this.root = path.join(projectRoot, ".orchestry", "workflows");
  }
  async createJob(job, passport, sessions) {
    const id = safeId(job.job_id);
    if (passport.job_id !== id || sessions.job_id !== id) throw new Error("Workflow job_id mismatch");
    await this.secureDir(id);
    if (await this.readJob(id)) throw new Error(`Workflow job already exists: ${id}`);
    await Promise.all([this.write(this.file(id, "job.json"), job), this.write(this.file(id, "passport.json"), passport), this.write(this.file(id, `passports/passport-${String(passport.passport_revision).padStart(6, "0")}.json`), passport), this.write(this.file(id, "sessions.json"), sessions)]);
  }
  async writeArtifact(input) {
    const id = safeId(input.job_id);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (input.revision !== job.artifact_revision + 1) throw new Error(`Stale artifact revision: expected ${job.artifact_revision + 1}, received ${input.revision}`);
      if (input.parent_artifact_hash !== job.latest_artifact_hash) throw new Error("Stale parent_artifact_hash");
      if (input.parent_artifact_hash !== null && !SHA256.test(input.parent_artifact_hash)) throw new Error("Invalid parent_artifact_hash");
      if (job.phase !== input.phase) throw new Error(`Artifact phase ${input.phase} does not match job phase ${job.phase}`);
      const payload = input.validate(removeForbidden(input.payload));
      const timestamp = iso(input.timestamp ?? (/* @__PURE__ */ new Date()).toISOString());
      const artifactHash = hashCanonical(payload);
      const filename = artifactFilename(input.name, job.revision, input.revision);
      const stored = { metadata: { schema_version: 1, job_id: id, artifact_name: input.name, filename, phase: input.phase, workflow_revision: job.revision, revision: input.revision, producing_role: input.producing_role, parent_artifact_hash: input.parent_artifact_hash, timestamp, artifact_hash: artifactHash }, payload };
      const file = path.join(this.root, id, "artifacts", filename);
      try {
        await fs.access(file);
        throw new Error(`Refusing to overwrite immutable artifact: ${filename}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await this.write(file, stored);
      await this.write(this.file(id, "job.json"), { ...job, artifact_revision: input.revision, latest_artifact_hash: artifactHash, updated_at: timestamp });
      return stored;
    });
  }
  async writeTextArtifact(input) {
    return this.writeArtifact({ ...input, validate: (value) => {
      if (typeof value !== "string" || !value.trim()) throw new Error(`${input.name} must be non-empty text`);
      return sanitizeText(value);
    } });
  }
  async readArtifact(jobId, name, workflowRevision) {
    const id = safeId(jobId);
    const job = await this.requiredJob(id);
    const value = await this.latestArtifact(id, name, workflowRevision ?? job.revision);
    if (!value) return null;
    if (value.metadata.job_id !== id || hashCanonical(value.payload) !== value.metadata.artifact_hash) throw new Error("Workflow artifact integrity check failed");
    return value;
  }
  async readTextArtifact(jobId, name, workflowRevision) {
    const value = await this.readArtifact(jobId, name, workflowRevision);
    if (value && typeof value.payload !== "string") throw new Error("Workflow text artifact is not text");
    return value;
  }
  async transition(jobId, next, patch = {}) {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (!canTransitionWorkflow(job.phase, next)) throw new Error(`Invalid workflow phase transition: ${job.phase} -> ${next}`);
      const updated = { ...job, ...patch, schema_version: 1, job_id: id, phase: next, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      await this.write(this.file(id, "job.json"), updated);
      return updated;
    });
  }
  async patchJob(jobId, patch) {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      const updated = { ...job, ...patch, schema_version: 1, job_id: id, phase: job.phase, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      await this.write(this.file(id, "job.json"), updated);
      return updated;
    });
  }
  async reserveOperation(jobId, phase, operation) {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (job.phase !== phase || job.current_operation !== null) return false;
      await this.write(this.file(id, "job.json"), { ...job, current_operation: operation, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
      return true;
    });
  }
  async readJob(jobId) {
    const id = safeId(jobId);
    return readJson(this.file(id, "job.json"));
  }
  async readPassport(jobId) {
    const id = safeId(jobId);
    return readJson(this.file(id, "passport.json"));
  }
  async writePassport(value) {
    const id = safeId(value.job_id);
    await this.lock(id, async () => {
      const current = await this.readPassport(id);
      if (current && value.passport_revision !== current.passport_revision + 1) throw new Error(`Stale passport revision: expected ${current.passport_revision + 1}, received ${value.passport_revision}`);
      const snapshot = this.file(id, `passports/passport-${String(value.passport_revision).padStart(6, "0")}.json`);
      try {
        await fs.access(snapshot);
        throw new Error(`Refusing to overwrite passport revision ${value.passport_revision}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await this.write(snapshot, value);
      await this.write(this.file(id, "passport.json"), value);
    });
  }
  async readSessions(jobId) {
    const id = safeId(jobId);
    return readJson(this.file(id, "sessions.json"));
  }
  async writeSessions(value) {
    safeId(value.job_id);
    await this.requiredJob(value.job_id);
    await this.write(this.file(value.job_id, "sessions.json"), value);
  }
  async appendEvent(event) {
    const id = safeId(event.job_id);
    await this.requiredJob(id);
    await appendJsonl(this.file(id, "events.jsonl"), { ...event, data: removeForbidden(event.data) });
    await fs.chmod(this.file(id, "events.jsonl"), 384).catch(() => {
    });
  }
  async readEvents(jobId) {
    return readJsonl(this.file(safeId(jobId), "events.jsonl"));
  }
  async listJobs() {
    let entries;
    try {
      entries = await fs.readdir(this.root);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const jobs = (await Promise.all(entries.map((id) => SAFE_ID.test(id) ? this.readJob(id) : null))).filter((job) => job !== null);
    return jobs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  artifactPath(jobId, name, revision) {
    return path.join(this.root, safeId(jobId), "artifacts", artifactFilename(name, revision, 0));
  }
  async requiredJob(id) {
    const job = await this.readJob(id);
    if (!job) throw new Error(`Workflow job not found: ${id}`);
    return job;
  }
  file(id, name) {
    return path.join(this.root, safeId(id), name);
  }
  async latestArtifact(id, name, workflowRevision) {
    const dir = this.file(id, "artifacts");
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    let latest = null;
    for (const entry of entries) {
      const value = await readJson(path.join(dir, entry));
      if (value?.metadata.artifact_name === name && value.metadata.workflow_revision === workflowRevision && (!latest || value.metadata.revision > latest.metadata.revision)) latest = value;
    }
    return latest;
  }
  async write(file, value) {
    await atomicWrite(file, canonicalJson(removeForbidden(value)) + "\n");
  }
  async secureDir(id) {
    const dir = this.file(id, "");
    await Promise.all([ensureDir(path.join(dir, "artifacts")), ensureDir(path.join(dir, "passports"))]);
    await Promise.all([fs.chmod(this.root, 448).catch(() => {
    }), fs.chmod(dir, 448), fs.chmod(path.join(dir, "artifacts"), 448), fs.chmod(path.join(dir, "passports"), 448)]);
  }
  async lock(id, fn) {
    await this.secureDir(id);
    const lock = this.file(id, ".workflow.lock");
    const deadline = Date.now() + 5e3;
    while (true) {
      try {
        await fs.mkdir(lock, { mode: 448 });
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        const stat = await fs.stat(lock).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 3e4) {
          await fs.rm(lock, { recursive: true, force: true });
          continue;
        }
        if (Date.now() > deadline) throw new Error(`Workflow lock is active: ${id}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(lock, { recursive: true, force: true });
    }
  }
};
function artifactReference(_name, stored) {
  return { filename: stored.metadata.filename, hash: stored.metadata.artifact_hash, phase: stored.metadata.phase, revision: stored.metadata.revision };
}
function hashCanonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
function removeForbidden(value) {
  const safe = sanitizeForPersistence(value);
  if (Array.isArray(safe)) return safe.map(removeForbidden);
  if (safe && typeof safe === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(safe)) if (!FORBIDDEN_FIELD.test(key)) out[key] = removeForbidden(nested);
    return out;
  }
  return safe;
}
function safeId(value) {
  if (!SAFE_ID.test(value) || value === "." || value === "..") throw new Error(`Invalid workflow job id: ${value}`);
  return value;
}
function iso(value) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
  return value;
}
function artifactFilename(name, workflowRevision, sequence) {
  return ARTIFACT_FILES[name].replace("%REV%", String(workflowRevision).padStart(3, "0")).replace("%SEQ%", String(sequence).padStart(6, "0"));
}

export { ARTIFACT_FILES, WORKFLOW_PHASE_TRANSITIONS, WorkflowArtifactStore, artifactReference, canTransitionWorkflow, hashCanonical, isTerminalWorkflowPhase, transitionWorkflow };
//# sourceMappingURL=chunk-D46P56MG.js.map
//# sourceMappingURL=chunk-D46P56MG.js.map