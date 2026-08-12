import { beforeEach, describe, expect, it, vi } from 'vitest';

const { commandRunMock, resolveExecutableMock } = vi.hoisted(() => ({
  commandRunMock: vi.fn(),
  resolveExecutableMock: vi.fn((command: string) => Promise.resolve({
    path: `/resolved/${command}`,
    realpath: `/resolved/${command}`,
    sha256: 'a'.repeat(64),
  })),
}));

vi.mock('../../../src/infrastructure/process/command-runner.js', () => ({
  CommandRunner: class {
    run = commandRunMock;
  },
  resolveExecutable: resolveExecutableMock,
  commandFailureMessage: () => 'command failed',
}));

import {
  discoverModelOptions,
  getFallbackModelOptions,
  parseGrokModels,
  parseLineModels,
} from '../../../src/infrastructure/models/model-discovery.js';

describe('model discovery parsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses grok models and marks the current default', () => {
    const output = `
You are logged in with grok.com.

Default model: grok-composer-2.5-fast

Available models:
  * grok-composer-2.5-fast (default)
  - grok-build
`;

    expect(parseGrokModels(output)).toEqual([
      { value: 'grok-composer-2.5-fast', label: 'Grok Composer 2.5 Fast', hint: 'current default' },
      { value: 'grok-build', label: 'Grok Build', hint: 'runtime' },
    ]);
  });

  it('parses one-model-per-line output and ignores helper text', () => {
    const output = `
Gemini 3.5 Flash (Medium)
No models available for a disabled provider
Use /help for usage
/tmp/cache/file
Claude Sonnet 4.6 (Thinking)
`;

    expect(parseLineModels(output, 'runtime')).toEqual([
      { value: 'Gemini 3.5 Flash (Medium)', label: 'Gemini 3.5 Flash (Medium)', hint: 'runtime' },
      { value: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)', hint: 'runtime' },
    ]);
  });

  it('keeps fallback model options for CLIs without runtime discovery', () => {
    expect(getFallbackModelOptions('codex').map((option) => option.value)).toContain('gpt-5.3-codex');
    expect(getFallbackModelOptions('unknown')).toEqual([
      { value: '', label: 'Default', hint: 'use adapter default' },
    ]);
  });

  it('discovers with a bounded pinned executable descriptor and no shell', async () => {
    commandRunMock.mockResolvedValue({ ok: true, stdout: 'provider/model\n' });

    await expect(discoverModelOptions('opencode')).resolves.toEqual([
      { value: '', label: 'Default', hint: 'use model configured in opencode' },
      { value: 'provider/model', label: 'Model', hint: 'runtime' },
    ]);
    expect(commandRunMock).toHaveBeenCalledWith(expect.objectContaining({
      executable: expect.objectContaining({ path: '/resolved/opencode', realpath: '/resolved/opencode' }),
      args: ['models'],
      timeoutMs: 15_000,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 256 * 1024,
    }));
    expect(commandRunMock.mock.calls[0]![0]).not.toHaveProperty('shell');
  });

  it('returns no discovered models when command execution fails', async () => {
    commandRunMock.mockResolvedValue({ ok: false, stdout: '', stderr: 'failed' });
    await expect(discoverModelOptions('pi')).resolves.toEqual([]);
  });
});
