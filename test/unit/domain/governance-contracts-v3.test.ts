import { describe, expect, it } from 'vitest';
import { validateBindingSnapshotV3, validateDecompositionPlanV3, validateGovernanceBranchV3, validateQuorumPolicyV3 } from '../../../src/domain/governance/contracts-v3.js';

const now = '2026-08-11T10:00:00.000Z';
const hash = 'a'.repeat(64);
const base = { schema_version: 3, governance_id: 'gov_1' };
const snapshot = { ...base, kind: 'binding_snapshot', record_id: 'bindings', bindings: [{ binding_id: 'planner', role: 'planner', principal_id: 'agent_1', adapter: 'codex', model: 'gpt' }], created_at: now } as const;

describe('governance v3 contracts', () => {
  it('validates strict binding snapshots and rejects unknown fields', () => {
    expect(validateBindingSnapshotV3(snapshot).bindings).toHaveLength(1);
    expect(() => validateBindingSnapshotV3({ ...snapshot, extra: true })).toThrow('unknown field');
  });
  it('validates decomposition DAGs and safe paths', () => {
    const plan = { ...base, kind:'decomposition_plan',record_id:'plan',binding_snapshot:{kind:'binding_snapshot',record_id:'bindings',record_hash:hash},objective:'build',base_commit:'a'.repeat(40),target_branch:'main',units:[{unit_id:'a',objective:'A',depends_on:[],owned_path_prefixes:['src/a'],acceptance_criteria:['ok'],required_check_ids:['test']},{unit_id:'b',objective:'B',depends_on:['a'],owned_path_prefixes:['src/b'],acceptance_criteria:['ok'],required_check_ids:['test']}],integration_check_ids:['test'],created_by_binding_id:'planner',created_at:now } as const;
    expect(validateDecompositionPlanV3(plan).units).toHaveLength(2);
    expect(() => validateDecompositionPlanV3({ ...plan, units: [{ ...plan.units[0], owned_path_prefixes: ['../secret'] }] })).toThrow('Unsafe');
    expect(() => validateDecompositionPlanV3({ ...plan, units: plan.units.map((u)=>({...u,depends_on:[u.unit_id==='a'?'b':'a']})) })).toThrow('cycle');
  });
  it('rejects impossible quorum policies', () => {
    const policy={...base,kind:'quorum_policy',record_id:'policy',binding_snapshot:{kind:'binding_snapshot',record_id:'bindings',record_hash:hash},applies_to:'candidate_evidence',eligible_reviewer_binding_ids:['reviewer'],minimum_approvals:2,maximum_rejections:0,require_distinct_principals:true,human_approval_required:true,created_by_binding_id:'planner',created_at:now} as const;
    expect(() => validateQuorumPolicyV3(policy)).toThrow('quorum');
  });
  it('rejects unsafe branch and ref syntax',()=>{expect(validateGovernanceBranchV3('feature/safe')).toBe('feature/safe');for(const value of ['-main','refs/heads/main','main..next','main.lock','main@{1}','main~1'])expect(()=>validateGovernanceBranchV3(value)).toThrow('branch')});
});
