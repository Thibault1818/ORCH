/**
 * Workspace manager interface.
 */

import type { Agent } from '../../domain/agent.js';
import type { OrchestratorConfig } from '../../domain/config.js';
import type { Task } from '../../domain/task.js';
import type { MergeResult } from './merge-strategy.js';

export interface PrepareResult {
  path: string;
  branch?: string;
  baseCommit?: string;
  targetBranch?: string;
}

export interface WorkspaceEvidence {
  baseCommit: string;
  commit: string;
  diffHash: string;
  changedFiles: string[];
  targetBranch: string;
}

export interface IWorkspaceManager {
  prepare(task: Task, agent: Agent, config: OrchestratorConfig): Promise<PrepareResult>;
  inspect(branch: string): Promise<WorkspaceEvidence>;
  mergeBack(branch: string, expected: WorkspaceEvidence): Promise<MergeResult>;
  cleanup(taskId: string, branch?: string): Promise<void>;
  validate(workspacePath: string, projectRoot: string): void;
  /** Get files changed on a worktree branch relative to its merge-base. */
  getChangedFiles(branch: string): Promise<string[]>;
}
