import fs from 'node:fs/promises';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: vi.fn(async (request: { args: string[] }) => {
    await fs.writeFile(request.args.at(-1)!, 'edited', 'utf8');
    return { ok: true, exitCode: 0 };
  }),
  resolveExecutable: vi.fn(async () => ({ path: '/bin/vi', realpath: '/bin/vi', sha256: '0'.repeat(64) })),
}));

vi.mock('../../../src/infrastructure/process/command-runner.js', () => ({
  CommandRunner: class { run = mocks.run; },
  commandFailureMessage: () => 'editor failed',
  resolveExecutable: mocks.resolveExecutable,
}));

import { toEditorContent, fromEditorContent } from '../../../src/cli/editor.js';

describe('toEditorContent', () => {
  it('serializes title, priority, and description into YAML frontmatter + body', () => {
    const result = toEditorContent({
      title: 'My Task',
      priority: 2,
      description: 'Some desc',
    });
    expect(result).toContain('---');
    expect(result).toContain('title: My Task');
    expect(result).toContain('priority: 2');
    expect(result).toContain('Some desc');
  });

  it('handles missing description', () => {
    const result = toEditorContent({ title: 'T', priority: 1 });
    expect(result).toContain('title: T');
    expect(result).toContain('priority: 1');
  });
});

describe('fromEditorContent', () => {
  it('parses frontmatter with title and priority', () => {
    const content = '---\ntitle: Hello\npriority: 3\n---\nBody text';
    const parsed = fromEditorContent(content);
    expect(parsed.title).toBe('Hello');
    expect(parsed.priority).toBe(3);
    expect(parsed.description).toBe('Body text');
  });

  it('returns description only when no frontmatter', () => {
    const parsed = fromEditorContent('Just plain text');
    expect(parsed.title).toBeUndefined();
    expect(parsed.priority).toBeUndefined();
    expect(parsed.description).toBe('Just plain text');
  });

  it('parses snake_case frontmatter keys', () => {
    const content = '---\ntitle: Test\npriority: 2\nreview_criteria: check\n---\nDesc';
    const parsed = fromEditorContent(content);
    expect(parsed.title).toBe('Test');
    expect(parsed.priority).toBe(2);
    // review_criteria is not a known key, so it's ignored, but the regex should still match it
  });

  it('ignores invalid priority values', () => {
    const content = '---\ntitle: X\npriority: 99\n---\n';
    const parsed = fromEditorContent(content);
    expect(parsed.title).toBe('X');
    expect(parsed.priority).toBeUndefined();
  });

  it('handles empty content', () => {
    const parsed = fromEditorContent('');
    expect(parsed.description).toBeUndefined();
  });
});

describe('openInEditor temp directory cleanup', () => {
  it('runs the editor with inherited stdio through CommandRunner', async () => {
    const { openInEditor } = await import('../../../src/cli/editor.js');
    await expect(openInEditor('initial')).resolves.toBe('edited');
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ stdio: 'inherit' }));
  });
});
