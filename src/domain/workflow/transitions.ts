export type WorkflowPhase = 'codex_pre_opus' | 'fable_consultation' | 'codex_after_fable' | 'opus_execution' | 'codex_post_opus' | 'verification' | 'merge_ready' | 'done' | 'blocked' | 'paused' | 'cancelled' | 'failed';

const ACTIVE: WorkflowPhase[] = ['codex_pre_opus', 'fable_consultation', 'codex_after_fable', 'opus_execution', 'codex_post_opus', 'verification', 'merge_ready'];

export const WORKFLOW_PHASE_TRANSITIONS: Readonly<Record<WorkflowPhase, readonly WorkflowPhase[]>> = {
  codex_pre_opus: ['fable_consultation', 'opus_execution', 'paused', 'cancelled', 'failed'],
  fable_consultation: ['codex_after_fable', 'opus_execution', 'paused', 'cancelled', 'failed'],
  codex_after_fable: ['opus_execution', 'verification', 'paused', 'cancelled', 'failed'],
  opus_execution: ['codex_post_opus', 'blocked', 'paused', 'cancelled', 'failed'],
  codex_post_opus: ['fable_consultation', 'opus_execution', 'verification', 'paused', 'cancelled', 'failed'],
  verification: ['merge_ready', 'blocked', 'paused', 'cancelled', 'failed'],
  merge_ready: ['done', 'blocked', 'paused', 'cancelled', 'failed'],
  done: [], blocked: [...ACTIVE, 'cancelled'], paused: [...ACTIVE, 'blocked', 'cancelled'], cancelled: [], failed: [],
};

export function canTransitionWorkflow(from: WorkflowPhase, to: WorkflowPhase): boolean { return WORKFLOW_PHASE_TRANSITIONS[from].includes(to); }
export function transitionWorkflow(from: WorkflowPhase, to: WorkflowPhase): WorkflowPhase { if (!canTransitionWorkflow(from, to)) throw new Error(`Invalid workflow phase transition: ${from} -> ${to}`); return to; }
export function isTerminalWorkflowPhase(phase: WorkflowPhase): boolean { return phase === 'done' || phase === 'cancelled' || phase === 'failed'; }
