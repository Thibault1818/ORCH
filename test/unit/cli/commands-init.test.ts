/**
 * Tests for `orch init` command and `getDefaultAgents()`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// ── hoist mocks ──────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const ensureDir = vi.fn(async () => {});
  const pathExists = vi.fn(async () => false as boolean);
  const writeYaml = vi.fn(async () => {});
  const atomicWrite = vi.fn(async () => {});
  const agentPathFn = vi.fn((id: string) => `/mock/.orchestry/agents/${id}.yml`);

  const MockPaths = vi.fn(() => ({
    root: '/mock/.orchestry',
    tasksDir: '/mock/.orchestry/tasks',
    agentsDir: '/mock/.orchestry/agents',
    runsDir: '/mock/.orchestry/runs',
    templatesDir: '/mock/.orchestry/templates',
    logsDir: '/mock/.orchestry/logs',
    projectConfigRoot: '/mock/.orchestry',
    workspacesRoot: '/mock/.orchestry/workspaces',
    configPath: '/mock/.orchestry/config.yml',
    gitignorePath: '/mock/.orchestry/.gitignore',
    workspaceExcludePath: '/mock/.orchestry/.workspace-exclude',
    defaultTemplatePath: vi.fn(() => '/mock/.orchestry/templates/default.md'),
    agentPath: agentPathFn,
  }));

  const runCommand = vi.fn(async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }));
  const resolveExecutable = vi.fn(async (command: string) => ({
    path: `/bin/${command}`,
    realpath: `/bin/${command}`,
    sha256: '0'.repeat(64),
  }));

  return { ensureDir, pathExists, writeYaml, atomicWrite, agentPathFn, MockPaths, runCommand, resolveExecutable };
});

vi.mock('../../../src/infrastructure/storage/fs-utils.js', () => ({
  ensureDir: mocks.ensureDir,
  pathExists: mocks.pathExists,
  writeYaml: mocks.writeYaml,
  atomicWrite: mocks.atomicWrite,
}));

vi.mock('../../../src/infrastructure/storage/paths.js', () => ({
  Paths: mocks.MockPaths,
  externalOrchestryRoots: () => ({ stateRoot: '/mock/.orchestry', workspaceRoot: '/mock/.orchestry/workspaces' }),
}));

vi.mock('../../../src/infrastructure/process/command-runner.js', () => ({
  CommandRunner: class {
    run = mocks.runCommand;
  },
  resolveExecutable: mocks.resolveExecutable,
}));

vi.mock('../../../src/domain/config.js', () => ({
  DEFAULT_CONFIG: {
    project: { name: '' },
    defaults: {
      agent: { workspace_mode: 'worktree' },
      task: { max_attempts: 3 },
    },
    scheduling: { poll_interval_ms: 10000 },
  },
}));

vi.mock('../../../src/infrastructure/template/template-engine.js', () => ({
  DEFAULT_PROMPT_TEMPLATE: '# default template',
}));

// ── imports after mocks ──────────────────────────────────────────────────────
import { getDefaultAgents } from '../../../src/domain/default-agents.js';
import { registerInitCommand } from '../../../src/cli/commands/init.js';

// ─────────────────────────────────────────────────────────────────────────────
// getDefaultAgents() unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe('getDefaultAgents()', () => {
  it('returns exactly one agent', () => {
    expect(getDefaultAgents()).toHaveLength(1);
  });

  it('agent has id=agt_creator', () => {
    expect(getDefaultAgents()[0].id).toBe('agt_creator');
  });

  it('agent has name=Agent Creator', () => {
    expect(getDefaultAgents()[0].name).toBe('Agent Creator');
  });

  it('defaults to adapter=claude when no argument', () => {
    expect(getDefaultAgents()[0].adapter).toBe('claude');
  });

  it('uses provided adapter', () => {
    expect(getDefaultAgents('opencode')[0].adapter).toBe('opencode');
    expect(getDefaultAgents('codex')[0].adapter).toBe('codex');
    expect(getDefaultAgents('pi')[0].adapter).toBe('pi');
  });

  it('resolves model from adapter tier', () => {
    expect(getDefaultAgents('claude')[0].config.model).toBe('claude-sonnet-4-6');
    expect(getDefaultAgents('codex')[0].config.model).toBe('gpt-5.3-codex');
    expect(getDefaultAgents('pi')[0].config.model).toBe('openai-codex/gpt-5.5');
  });

  it('includes MCP skills for claude adapter', () => {
    expect(getDefaultAgents('claude')[0].config.skills).toEqual(['document-skills:skill-creator']);
  });

  it('excludes MCP skills for non-claude adapters', () => {
    expect(getDefaultAgents('opencode')[0].config.skills).toEqual([]);
    expect(getDefaultAgents('codex')[0].config.skills).toEqual([]);
    expect(getDefaultAgents('pi')[0].config.skills).toEqual([]);
  });

  it('agent has approval_policy=suggest', () => {
    expect(getDefaultAgents()[0].config.approval_policy).toBe('suggest');
  });

  it('agent has status=idle', () => {
    expect(getDefaultAgents()[0].status).toBe('idle');
  });

  it('agent stats are all zero', () => {
    expect(getDefaultAgents()[0].stats).toEqual({
      tasks_completed: 0,
      tasks_failed: 0,
      total_runs: 0,
      total_runtime_ms: 0,
    });
  });

  it('role does not mention AgentsOrchestryCLI (universal prompt)', () => {
    expect(getDefaultAgents()[0].role).not.toContain('AgentsOrchestryCLI');
  });

  it('agent has required fields: id, name, adapter, role, config, status, stats', () => {
    const agent = getDefaultAgents()[0];
    expect(agent.id).toBeDefined();
    expect(agent.name).toBeDefined();
    expect(agent.adapter).toBeDefined();
    expect(agent.role).toBeDefined();
    expect(agent.config).toBeDefined();
    expect(agent.status).toBeDefined();
    expect(agent.stats).toBeDefined();
  });

  it('role is a non-empty string', () => {
    const role = getDefaultAgents()[0].role;
    expect(typeof role).toBe('string');
    expect((role as string).length).toBeGreaterThan(0);
  });

  it('returns a new array on each call (no shared reference)', () => {
    const a = getDefaultAgents();
    const b = getDefaultAgents();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerInitCommand tests
// ─────────────────────────────────────────────────────────────────────────────
describe('init command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathExists.mockResolvedValue(false);
    mocks.runCommand.mockResolvedValue({ ok: true, stdout: '', stderr: '', exitCode: 0 });
    program = new Command();
    program.exitOverride();
    registerInitCommand(program);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(process, 'cwd').mockReturnValue('/mock');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls writeYaml for each default agent', async () => {
    await program.parseAsync(['init'], { from: 'user' });

    const agents = getDefaultAgents();
    for (const agent of agents) {
      expect(mocks.writeYaml).toHaveBeenCalledWith(
        expect.stringContaining(agent.id),
        expect.objectContaining({ id: agent.id }),
      );
    }
  });

  it('uses paths.agentPath(agent.id) for the write path', async () => {
    await program.parseAsync(['init'], { from: 'user' });

    expect(mocks.agentPathFn).toHaveBeenCalledWith('agt_creator');
    expect(mocks.writeYaml).toHaveBeenCalledWith(
      '/mock/.orchestry/agents/agt_creator.yml',
      expect.objectContaining({ id: 'agt_creator' }),
    );
  });

  it('all agent writeYaml calls are made', async () => {
    const agentPaths: string[] = [];
    mocks.writeYaml.mockImplementation(async (p: string) => { agentPaths.push(p); });

    await program.parseAsync(['init'], { from: 'user' });

    const agentWrites = agentPaths.filter((p) => p.includes('/agents/'));
    expect(agentWrites).toHaveLength(getDefaultAgents().length);
  });

  it('tree output contains agt_creator.yml', async () => {
    await program.parseAsync(['init'], { from: 'user' });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0] ?? ''))
      .join('\n');

    expect(output).toContain('agt_creator.yml');
  });

  it('tree output contains Agent Creator label', async () => {
    await program.parseAsync(['init'], { from: 'user' });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0] ?? ''))
      .join('\n');

    expect(output).toContain('Agent Creator');
  });

  it('skips init when .orchestry already exists (no writeYaml for agents)', async () => {
    mocks.pathExists.mockResolvedValue(true);
    await program.parseAsync(['init'], { from: 'user' });

    const agentWrites = mocks.writeYaml.mock.calls.filter(([p]) => String(p).includes('agents'));
    expect(agentWrites).toHaveLength(0);
  });

  it('does not call ensureDir when already initialized', async () => {
    mocks.pathExists.mockResolvedValue(true);
    await program.parseAsync(['init'], { from: 'user' });

    expect(mocks.ensureDir).not.toHaveBeenCalled();
  });

  it('sets project name from --name option', async () => {
    await program.parseAsync(['init', '--name', 'my-project'], { from: 'user' });

    expect(mocks.writeYaml).toHaveBeenCalledWith(
      '/mock/.orchestry/config.yml',
      expect.objectContaining({
        project: expect.objectContaining({ name: 'my-project' }),
      }),
    );
  });

  it('uses cwd basename as project name when --name omitted', async () => {
    await program.parseAsync(['init'], { from: 'user' });

    expect(mocks.writeYaml).toHaveBeenCalledWith(
      '/mock/.orchestry/config.yml',
      expect.objectContaining({
        project: expect.objectContaining({ name: 'mock' }),
      }),
    );
  });

  it('runs git init when not a git repo', async () => {
    mocks.runCommand.mockImplementation(async (request: { args: string[] }) => {
      return request.args[0] === 'rev-parse'
        ? { ok: false, stdout: '', stderr: 'not a git repo', exitCode: 128 }
        : { ok: true, stdout: '', stderr: '', exitCode: 0 };
    });

    await program.parseAsync(['init'], { from: 'user' });

    // Should have called git init
    expect(mocks.runCommand).toHaveBeenCalledWith(expect.objectContaining({
      executable: expect.objectContaining({ path: '/bin/git' }),
      args: ['init'],
      cwd: '/mock',
    }));
  });

  it('creates initial commit when repo has no commits', async () => {
    mocks.runCommand.mockImplementation(async (request: { args: string[] }) => {
      return request.args[0] === 'rev-parse' && request.args[1] === 'HEAD'
        ? { ok: false, stdout: '', stderr: 'no commits', exitCode: 128 }
        : { ok: true, stdout: '', stderr: '', exitCode: 0 };
    });

    await program.parseAsync(['init'], { from: 'user' });

    expect(mocks.runCommand).not.toHaveBeenCalledWith(expect.objectContaining({ args: ['add', '-A'] }));
    expect(mocks.runCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ['commit', '--allow-empty', '-m', 'Initial commit'],
      cwd: '/mock',
    }));
  });

  it('falls back to workspace_mode=shared when git is unavailable', async () => {
    // All git calls fail
    mocks.resolveExecutable.mockRejectedValue(new Error('git not found'));

    await program.parseAsync(['init'], { from: 'user' });

    expect(mocks.writeYaml).toHaveBeenCalledWith(
      '/mock/.orchestry/config.yml',
      expect.objectContaining({
        defaults: expect.objectContaining({
          agent: expect.objectContaining({ workspace_mode: 'shared' }),
        }),
      }),
    );
  });

  it('keeps workspace_mode=worktree when git is available', async () => {
    await program.parseAsync(['init'], { from: 'user' });

    expect(mocks.writeYaml).toHaveBeenCalledWith(
      '/mock/.orchestry/config.yml',
      expect.objectContaining({
        defaults: expect.objectContaining({
          agent: expect.objectContaining({ workspace_mode: 'worktree' }),
        }),
      }),
    );
  });

  it('skips ensureGitCommit when git is unavailable', async () => {
    mocks.resolveExecutable.mockRejectedValue(new Error('git not found'));

    await program.parseAsync(['init'], { from: 'user' });

    // Should not attempt git add or git commit
    const addCalls = mocks.runCommand.mock.calls.filter(([request]) => request.args[0] === 'add');
    expect(addCalls).toHaveLength(0);
  });
});
