import { describe, expect, it } from 'vitest';
import { CODEX_CLAUDE_OPUS_PRESET, presetToWorkflowConfig } from '../../../src/domain/workflow/presets.js';

describe('workflow launch presets', () => {
  it('accurately names the adaptive Codex and Claude Opus preset', () => {
    expect(CODEX_CLAUDE_OPUS_PRESET).toMatchObject({
      name: 'codex-claude-opus',
      supervisor: { adapter: 'codex', effort: 'high' },
      implementer: { adapter: 'claude', model: 'opus', effort: 'high' },
      adviser: null,
      reviewer: 'supervisor',
      mode: 'adaptive',
      max_adviser_calls: 0,
    });
  });

  it('maps preset roles onto existing engine profiles', () => {
    expect(presetToWorkflowConfig(CODEX_CLAUDE_OPUS_PRESET)).toMatchObject({
      fable_total_cap: 0,
      profiles: {
        codex: { effort: 'high', permission_mode: 'read_only' },
        opus: { model: 'opus', effort: 'high', permission_mode: 'worktree' },
      },
    });
  });
});
