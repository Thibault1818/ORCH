import type { CodexRolePort, FableRolePort, OpusRolePort } from '../../application/workflow/ports.js';
import type { SemanticRole } from '../../domain/workflow/roster.js';

export type WorkflowDriver = CodexRolePort | FableRolePort | OpusRolePort;

export class WorkflowDriverRegistry {
  private readonly drivers = new Map<string, WorkflowDriver>();

  register(adapter: string, role: 'supervisor' | 'reviewer', driver: CodexRolePort): this;
  register(adapter: string, role: 'implementer', driver: OpusRolePort): this;
  register(adapter: string, role: 'adviser', driver: FableRolePort): this;
  register(adapter: string, role: SemanticRole, driver: WorkflowDriver): this {
    const key = `${adapter}:${role}`;
    if (this.drivers.has(key)) throw new Error(`Workflow driver already registered: ${key}`);
    this.drivers.set(key, driver);
    return this;
  }

  get(adapter: string, role: 'supervisor' | 'reviewer'): CodexRolePort | undefined;
  get(adapter: string, role: 'implementer'): OpusRolePort | undefined;
  get(adapter: string, role: 'adviser'): FableRolePort | undefined;
  get(adapter: string, role: SemanticRole): WorkflowDriver | undefined {
    return this.drivers.get(`${adapter}:${role}`);
  }

  require(adapter: string, role: 'supervisor' | 'reviewer'): CodexRolePort;
  require(adapter: string, role: 'implementer'): OpusRolePort;
  require(adapter: string, role: 'adviser'): FableRolePort;
  require(adapter: string, role: SemanticRole): WorkflowDriver {
    const driver = this.drivers.get(`${adapter}:${role}`);
    if (!driver) throw new Error(`Unsupported ${role} binding: ${adapter}`);
    return driver;
  }
}
