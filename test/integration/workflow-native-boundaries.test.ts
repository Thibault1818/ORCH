import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { NativeFableWorkflowAdapter, NativeOpusWorkflowAdapter } from '../../src/infrastructure/workflow/native-adapters.js';
import type { IProcessManager, SpawnResult } from '../../src/infrastructure/process/process-manager.js';
import type { WorkflowPassportV1 } from '../../src/domain/workflow/state.js';

describe('native workflow process boundaries', () => {
  it('keeps prompts on stdin and separates Fable and Opus profiles', async () => {
    const pm = new FakeProcessManager(); const passport = samplePassport();
    const fable = new NativeFableWorkflowAdapter(pm);
    await fable.finalPrompt(passport, { job_id: 'wf_1', revision: 1, assumptions: [], acceptance_criteria: ['ok'], implementation_steps: ['edit'], risks: [], questions_requiring_human: [] }, [], { workspace: '/tmp/empty', model: 'fable-model', max_turns: 1, effort: 'low', timeout_ms: 1000, max_input_bytes: 10_000, max_output_bytes: 10_000 });
    const opus = new NativeOpusWorkflowAdapter(pm);
    pm.nextResult = JSON.stringify({ job_id: 'wf_1', status: 'completed', files_changed: [], commands_run: [], tests_reported: [], deviations: [], unresolved: [], summary: 'done' });
    await opus.execute(passport, 'secret prompt', '/tmp/worktree', null, 'new');
    expect(pm.calls[0]?.args).toEqual(expect.arrayContaining(['--model', 'fable-model', '--effort', 'low', '--max-turns', '1', '--tools', '']));
    expect(pm.calls[1]?.args).toEqual(expect.arrayContaining(['--model', 'opus-model', '--effort', 'high', '--max-turns', '17']));
    expect(pm.calls.flatMap((call) => call.args).join(' ')).not.toContain('secret prompt');
    expect(pm.calls[1]?.stdin).toContain('secret prompt');
  });
});

class FakeProcessManager implements IProcessManager {
  calls: Array<{ command: string; args: string[]; stdin: string }> = [];
  nextResult = 'Implement approved plan';
  isAlive() { return false; } kill() {} async killWithGrace() {}
  spawn(command: string, args: string[]): SpawnResult {
    const child = new EventEmitter() as SpawnResult['process']; const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr, pid: 42, kill: () => true, unref: () => child });
    const call = { command, args, stdin: '' }; this.calls.push(call); stdin.on('data', (chunk) => { call.stdin += chunk.toString(); });
    queueMicrotask(() => { stdout.end(`${JSON.stringify({ type: 'result', result: this.nextResult, session_id: 'fake', usage: {} })}\n`); child.emit('close', 0); });
    return { process: child, pid: 42 };
  }
}

function samplePassport(): WorkflowPassportV1 {
  const profiles = { fable: { model: 'fable-model', effort: 'low', max_turns: 1, timeout_ms: 1000, permission_mode: 'read_only' }, opus: { model: 'opus-model', effort: 'high', max_turns: 17, timeout_ms: 1000, permission_mode: 'worktree' }, codex: { model: 'codex-model', effort: 'medium', max_turns: 1, timeout_ms: 1000, permission_mode: 'read_only' } } as const;
  return { schema_version: 1, passport_revision: 1, job_id: 'wf_1', current_revision: 1, objective: 'test', current_phase: 'opus_execution', approved_plan_hash: 'a'.repeat(64), acceptance_criteria: ['ok'], mandatory_amendments: [], decisions: [], allowed_file_scope: [], required_checks: ['test'], current_blockers: [], next_action: 'run', artifacts: [], active_worktree: '/tmp/worktree', current_commit: null, session_references: { codex: null, fable: null, opus: null }, session_modes: { codex: 'none', fable: 'none', opus: 'none' }, rotation_history: [], config: { fable_pre_opus_cap: 2, fable_post_opus_per_iteration_cap: 1, fable_total_cap: 5, max_input_bytes: 10_000, max_output_bytes: 10_000, passport_max_bytes: 64_000, post_review: 'always', profiles } };
}
