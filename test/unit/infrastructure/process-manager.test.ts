import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import * as childProcess from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawn: vi.fn(), spawnSync: vi.fn() };
});

describe('ProcessManager', () => {
  let manager: ProcessManager;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'orch-process-manager-'));
    manager = new ProcessManager(path.join(root, 'registry.json'));
    vi.clearAllMocks();
    vi.mocked(childProcess.spawnSync).mockReturnValue({ status: 0, stdout: '12345 Mon Jan  1 00:00:00 2024\n' } as ReturnType<typeof childProcess.spawnSync>);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe('spawn', () => {
    it('calls proc.unref() after detached spawn to allow parent exit', () => {
      const mockUnref = vi.fn();
      const mockProc = {
        pid: 12345,
        stdout: null,
        stderr: null,
        unref: mockUnref,
        once: vi.fn(),
      };
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as any);

      manager.spawn('echo', ['hello']);

      expect(mockUnref).toHaveBeenCalledOnce();
    });

    it('spawns with detached:true so process group kill works', () => {
      const mockProc = { pid: 12345, stdout: null, stderr: null, unref: vi.fn(), once: vi.fn() };
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as any);

      manager.spawn('echo', ['hello']);

      const spawnOpts = vi.mocked(childProcess.spawn).mock.calls[0][2];
      expect(spawnOpts?.detached).toBe(true);
    });

    it('does not allow callers to disable detached process groups', () => {
      const mockProc = { pid: 12345, stdout: null, stderr: null, unref: vi.fn(), once: vi.fn() };
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as any);
      manager.spawn('echo', ['hello'], { detached: false });
      expect(vi.mocked(childProcess.spawn).mock.calls[0][2]?.detached).toBe(true);
    });

    it('throws if process has no pid', () => {
      const mockProc = { pid: undefined, unref: vi.fn() };
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as any);

      expect(() => manager.spawn('bad-cmd', [])).toThrow('Failed to spawn process');
    });

    it('kills remaining process-group descendants when the leader closes', () => {
      const handlers: Record<string, () => void> = {};
      const mockProc = { pid: 12345, stdout: null, stderr: null, unref: vi.fn(), once: vi.fn((event: string, handler: () => void) => { handlers[event] = handler; }) };
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as any);
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      try {
        manager.spawn('echo', ['hello']);
        handlers.close?.();
        expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGKILL');
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  describe('kill ownership', () => {
    it('does not signal unknown PIDs', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      try {
        manager.kill(12345, 'SIGTERM');
        expect(killSpy).not.toHaveBeenCalled();
      } finally {
        killSpy.mockRestore();
      }
    });
  });
});
