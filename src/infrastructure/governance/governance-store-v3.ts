import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GOVERNANCE_KINDS, validateGovernanceRecordV3, type GovernanceRecordKindV3, type GovernanceRecordV3, type GovernanceRefV3, type StoredGovernanceRecordV3 } from '../../domain/governance/contracts-v3.js';
import { sanitizeForPersistence } from '../security/redaction.js';
import { atomicWrite, ensureDir, readJson } from '../storage/fs-utils.js';

export class GovernanceStoreV3 {
  private readonly root: string;
  private readonly projectRoot: string;
  constructor(projectRoot: string, private readonly controllerKeyPath: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.root = path.join(this.projectRoot, '.orchestry', 'governance', 'v3');
    if (!path.isAbsolute(controllerKeyPath) || contains(this.projectRoot, controllerKeyPath)) throw new Error('Governance controller key must use an absolute path outside the repository');
  }

  async put<T extends GovernanceRecordV3>(input: T): Promise<StoredGovernanceRecordV3<T>> {
    const record = validateGovernanceRecordV3(sanitizeForPersistence(input)) as T;
    return this.lock(record.governance_id, async () => {
      await this.validateReferences(record);
      const recordHash = hashCanonical(record);
      const envelope: StoredGovernanceRecordV3<T> = { storage_version: 1, record_hash: recordHash, record_hmac: await this.sign(recordHash, record), record };
      const file = this.file(record.governance_id, record.kind, record.record_id);
      const existing = await this.read(record.governance_id, record.kind, record.record_id);
      if (existing) {
        if (existing.record_hash !== envelope.record_hash) throw new Error(`Conflicting governance record: ${record.record_id}`);
        return existing as StoredGovernanceRecordV3<T>;
      }
      await ensureDir(path.dirname(file));
      await fs.chmod(this.caseRoot(record.governance_id), 0o700).catch(() => {});
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await atomicWrite(file, JSON.stringify(envelope, null, 2));
      return envelope;
    });
  }

  async read(governanceId: string, kind: GovernanceRecordKindV3, recordId: string): Promise<StoredGovernanceRecordV3 | null> {
    safeId(governanceId); safeId(recordId); if (!GOVERNANCE_KINDS.includes(kind)) throw new Error('Invalid governance kind');
    const value = await readJson<unknown>(this.file(governanceId, kind, recordId));
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid governance envelope');
    const o = value as Record<string, unknown>;
    if (Object.keys(o).sort().join(',') !== 'record,record_hash,record_hmac,storage_version' || o.storage_version !== 1 || typeof o.record_hash !== 'string' || typeof o.record_hmac !== 'string') throw new Error('Invalid governance envelope');
    const record = validateGovernanceRecordV3(o.record);
    const expectedHash = hashCanonical(record);
    const expectedHmac = await this.sign(expectedHash, record);
    if (record.governance_id !== governanceId || record.kind !== kind || record.record_id !== recordId || expectedHash !== o.record_hash || !safeEqual(expectedHmac, o.record_hmac)) throw new Error('Governance record integrity check failed');
    return { storage_version: 1, record_hash: o.record_hash, record_hmac: o.record_hmac, record };
  }

  async list(governanceId: string, kind: GovernanceRecordKindV3): Promise<StoredGovernanceRecordV3[]> {
    safeId(governanceId); if (!GOVERNANCE_KINDS.includes(kind)) throw new Error('Invalid governance kind'); const dir = path.join(this.caseRoot(governanceId), 'records', kind);
    let names: string[]; try { names = await fs.readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const records = await Promise.all(names.filter((name) => name.endsWith('.json')).sort().map((name) => this.read(governanceId, kind, name.slice(0, -5))));
    return records.filter((value): value is StoredGovernanceRecordV3 => value !== null);
  }

  private async validateReferences(record: GovernanceRecordV3): Promise<void> {
    for (const reference of collectReferences(record)) {
      const target = await this.read(record.governance_id, reference.kind, reference.record_id);
      if (!target || target.record_hash !== reference.record_hash) throw new Error(`Missing or stale governance reference: ${reference.kind}/${reference.record_id}`);
    }
  }
  private caseRoot(id: string) { return path.join(this.root, safeId(id)); }
  private file(id: string, kind: GovernanceRecordKindV3, recordId: string) { return path.join(this.caseRoot(id), 'records', kind, `${safeId(recordId)}.json`); }
  private async sign(recordHash: string, record: GovernanceRecordV3): Promise<string> {
    const key = await this.key();
    return createHmac('sha256', key).update(canonical({ storage_version: 1, record_hash: recordHash, record })).digest('hex');
  }
  private async key(): Promise<Buffer> {
    const [projectRealPath, keyRealPath] = await Promise.all([fs.realpath(this.projectRoot), fs.realpath(this.controllerKeyPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new Error('Governance controller key is missing');
      throw error;
    })]);
    if (contains(projectRealPath, keyRealPath)) throw new Error('Governance controller key resolves inside the repository');
    const stat = await fs.lstat(this.controllerKeyPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new Error('Governance controller key is missing');
      throw error;
    });
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)) throw new Error('Governance controller key must be a regular 0600 file');
    if (process.getuid && stat.uid !== process.getuid()) throw new Error('Governance controller key must be owned by the current user');
    const key = await fs.readFile(this.controllerKeyPath);
    if (key.length < 32) throw new Error('Governance controller key must contain at least 32 bytes');
    return key;
  }
  private async lock<T>(governanceId: string, work: () => Promise<T>): Promise<T> {
    const root = this.caseRoot(governanceId);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await fs.chmod(root, 0o700).catch(() => {});
    const lock = path.join(root, '.governance.lock');
    const deadline = Date.now() + 5_000;
    while (true) {
      try { await fs.mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const stat = await fs.stat(lock).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 30_000) { await fs.rm(lock, { recursive: true, force: true }); continue; }
        if (Date.now() > deadline) throw new Error(`Governance lock is active: ${governanceId}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try { return await work(); }
    finally { await fs.rm(lock, { recursive: true, force: true }); }
  }
}

export function hashGovernanceRecordV3(value: GovernanceRecordV3): string { return hashCanonical(validateGovernanceRecordV3(value)); }
function hashCanonical(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function canonical(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; const o=value as Record<string,unknown>; return `{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`; }
function safeId(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error('Invalid governance id'); return value; }
function safeEqual(left: string, right: string): boolean { const a=Buffer.from(left,'hex'),b=Buffer.from(right,'hex');return a.length===32&&b.length===32&&timingSafeEqual(a,b); }
function contains(root: string, candidate: string): boolean { const relative=path.relative(root,path.resolve(candidate));return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative)); }
function collectReferences(value: unknown): GovernanceRefV3[] { const refs: GovernanceRefV3[]=[]; const walk=(v:unknown)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(walk);return;}const o=v as Record<string,unknown>;if(typeof o.kind==='string'&&typeof o.record_id==='string'&&typeof o.record_hash==='string'&&Object.keys(o).length===3)refs.push(o as unknown as GovernanceRefV3);else Object.values(o).forEach(walk)};walk(value);return refs; }
