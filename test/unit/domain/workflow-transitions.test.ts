import { describe, expect, it } from 'vitest';
import { canTransitionWorkflow, transitionWorkflow } from '../../../src/domain/workflow/transitions.js';

describe('workflow transitions v2', () => {
  it('models direct execution with optional advisory branch', () => { expect(canTransitionWorkflow('codex_pre_opus', 'opus_execution')).toBe(true); expect(canTransitionWorkflow('codex_pre_opus', 'fable_consultation')).toBe(true); expect(canTransitionWorkflow('codex_post_opus', 'verification')).toBe(true); expect(canTransitionWorkflow('done', 'opus_execution')).toBe(false); });
  it('rejects impossible shortcuts', () => { expect(() => transitionWorkflow('codex_pre_opus', 'done')).toThrow('Invalid workflow phase transition'); expect(canTransitionWorkflow('fable_consultation', 'merge_ready')).toBe(false); });
});
