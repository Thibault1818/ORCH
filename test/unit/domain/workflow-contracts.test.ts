import { describe, expect, it } from 'vitest';
import { validateCodexPlanReview, validateCodexSynthesis, validateFablePlan, validateOpusResult } from '../../../src/domain/workflow/contracts.js';

describe('workflow contracts', () => {
  it('requires the exact Fable plan fields', () => {
    expect(validateFablePlan({ job_id: 'wf_1', revision: 1, assumptions: [], acceptance_criteria: ['passes'], implementation_steps: ['build'], risks: [], questions_requiring_human: [] }).revision).toBe(1);
    expect(() => validateFablePlan({ job_id: 'wf_1', revision: 1, assumptions: [], acceptance_criteria: [], implementation_steps: [], risks: [], questions_requiring_human: [], prose: 'extra' })).toThrow('unknown field prose');
  });

  it('supports all required Opus statuses and rejects malformed output', () => {
    for (const status of ['completed', 'partial', 'failed'] as const) expect(validateOpusResult({ job_id: 'wf_1', status, files_changed: [], commands_run: [], tests_reported: [], deviations: [], unresolved: [], summary: status }).status).toBe(status);
    expect(() => validateOpusResult({ job_id: 'wf_1', status: 'done' })).toThrow();
  });

  it('validates APPLY_AND_GO and rejects unsafe synthesis', () => {
    expect(validateCodexPlanReview({ job_id: 'wf_1', revision: 1, verdict: 'APPLY_AND_GO', summary: 'bounded', required_changes: ['rename'], requires_re_review: false, risk_level: 'low', reason: 'safe', acceptance_criteria: [] }).verdict).toBe('APPLY_AND_GO');
    expect(() => validateCodexPlanReview({ job_id: 'wf_1', revision: 1, verdict: 'APPLY_AND_GO', summary: 'empty', required_changes: [], requires_re_review: false, risk_level: 'low', reason: 'unsafe', acceptance_criteria: [] })).toThrow('requires required_changes');
    expect(() => validateCodexSynthesis({ job_id: 'wf_1', reviewed_commit: 'abcdef1', verdict: 'REVISE', merge_allowed: true, evidence: [], summary: 'x', required_changes: ['fix'], requires_re_review: true, risk_level: 'high', reason: 'x' })).toThrow('requires GO');
  });
});
