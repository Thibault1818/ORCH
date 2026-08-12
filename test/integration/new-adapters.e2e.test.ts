/**
 * Grok and Antigravity generic adapters — end-to-end through the Orchestrator.
 *
 * These tests use the real adapter classes, AdapterRegistry, Orchestrator,
 * task/agent/run services, and state machine. Generic execution must fail closed
 * before process creation because neither CLI has a proven stdin prompt transport.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IProcessManager } from '../../src/infrastructure/process/process-manager.js';
import { Orchestrator } from '../../src/application/orchestrator.js';
import { GrokAdapter } from '../../src/infrastructure/adapters/grok.js';
import { AntigravityAdapter } from '../../src/infrastructure/adapters/antigravity.js';
import { AdapterRegistry } from '../../src/infrastructure/adapters/registry.js';
import type { IAgentAdapter } from '../../src/infrastructure/adapters/interface.js';
import type { OrchestratorEvent } from '../../src/domain/events.js';
import {
  buildDeps,
  makeTask,
  makeAgent,
  createMockTaskStore,
  createMockAgentStore,
  createMockRunStore,
  createMockStateStore,
  cleanupOrch,
} from '../unit/application/helpers.js';

interface Harness {
  processManager: IProcessManager;
  taskStore: ReturnType<typeof createMockTaskStore>;
  agentStore: ReturnType<typeof createMockAgentStore>;
  runStore: ReturnType<typeof createMockRunStore>;
  events: OrchestratorEvent[];
  orch: Orchestrator;
}

async function buildHarness(adapterKind: 'grok' | 'antigravity', adapterFactory: (pm: IProcessManager) => IAgentAdapter): Promise<Harness> {
  const processManager: IProcessManager = {
    isAlive: vi.fn(() => false),
    kill: vi.fn(),
    killWithGrace: vi.fn(async () => {}),
    spawn: vi.fn(),
  };

  const agent = makeAgent({
    id: `agt_${adapterKind}`,
    name: `${adapterKind}-engineer`,
    adapter: adapterKind,
    status: 'idle',
    config: { approval_policy: 'auto', max_turns: 5 },
  });
  const task = makeTask({
    id: `tsk_${adapterKind}`,
    title: `Exercise ${adapterKind}`,
    status: 'todo',
  });

  const taskStore = createMockTaskStore([task]);
  const agentStore = createMockAgentStore([agent]);
  const runStore = createMockRunStore();
  const stateStore = createMockStateStore();

  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(adapterFactory(processManager));

  const deps = buildDeps({
    taskStore,
    agentStore,
    runStore,
    stateStore,
    processManager,
    adapterRegistry,
  });

  const events: OrchestratorEvent[] = [];
  deps.eventBus.onAny((e) => events.push(e));

  const orch = new Orchestrator(deps);
  await (orch as { loadState: () => Promise<void> }).loadState();

  return { processManager, taskStore, agentStore, runStore, events, orch };
}

describe('new adapters — e2e through Orchestrator', () => {
  it('fails Grok orchestration closed without spawning or exposing the prompt in argv', async () => {
    const h = await buildHarness('grok', (pm) => new GrokAdapter(pm));
    try {
      await (h.orch as { tick: () => Promise<void> }).tick();

      expect(h.processManager.spawn).not.toHaveBeenCalled();
      expect(JSON.stringify((h.processManager.spawn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('rendered prompt');
      expect((await h.taskStore.get('tsk_grok'))?.last_error).toMatchObject({
        phase: 'pre_run',
        message: expect.stringContaining('argv prompt transport is prohibited'),
      });
      expect(h.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'task:error', taskId: 'tsk_grok', phase: 'pre_run' }),
      ]));
    } finally {
      cleanupOrch(h.orch);
    }
  });

  it('fails Antigravity orchestration closed without spawning or exposing the prompt in argv', async () => {
    const h = await buildHarness('antigravity', (pm) => new AntigravityAdapter(pm));
    try {
      await (h.orch as { tick: () => Promise<void> }).tick();

      expect(h.processManager.spawn).not.toHaveBeenCalled();
      expect(JSON.stringify((h.processManager.spawn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('rendered prompt');
      expect((await h.taskStore.get('tsk_antigravity'))?.last_error).toMatchObject({
        phase: 'pre_run',
        message: expect.stringContaining('argv prompt transport is prohibited'),
      });
      expect(h.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'task:error', taskId: 'tsk_antigravity', phase: 'pre_run' }),
      ]));
    } finally {
      cleanupOrch(h.orch);
    }
  });
});
