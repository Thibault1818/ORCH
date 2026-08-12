import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const {
  commandRunMock,
  resolveExecutableMock,
  accessSyncMock,
  statSyncMock,
  mkdtempMock,
  readFileMock,
  unlinkMock,
  rmMock,
} = vi.hoisted(() => ({
  commandRunMock: vi.fn(),
  resolveExecutableMock: vi.fn((command: string) => Promise.resolve({
    path: `/resolved/${command}`,
    realpath: `/resolved/${command}`,
    sha256: 'a'.repeat(64),
  })),
  accessSyncMock: vi.fn(),
  statSyncMock: vi.fn(() => ({ isFile: () => true })),
  mkdtempMock: vi.fn(),
  readFileMock: vi.fn(),
  unlinkMock: vi.fn().mockResolvedValue(undefined),
  rmMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  accessSync: accessSyncMock,
  statSync: statSyncMock,
}));

vi.mock('../../../src/infrastructure/process/command-runner.js', () => ({
  CommandRunner: class {
    run = commandRunMock;
  },
  resolveExecutable: resolveExecutableMock,
  commandFailureMessage: () => 'command failed',
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: mkdtempMock,
  readFile: readFileMock,
  unlink: unlinkMock,
  rm: rmMock,
}));

function commandResult(stdout: string | Buffer, ok = true) {
  const stdoutBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  return { ok, stdout: stdoutBuffer.toString('utf8'), stdoutBuffer };
}

function mockCommandResolve(stdout: string | Buffer): void {
  commandRunMock.mockResolvedValue(commandResult(stdout));
}

function mockCommandReject(): void {
  commandRunMock.mockRejectedValue(new Error('command failed'));
}

function mockCommandSequence(results: Array<{ stdout: string | Buffer } | { error: true }>): void {
  for (const entry of results) {
    if ('error' in entry) commandRunMock.mockRejectedValueOnce(new Error('failed'));
    else commandRunMock.mockResolvedValueOnce(commandResult(entry.stdout));
  }
}

describe('clipboard-service', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    accessSyncMock.mockImplementation(() => undefined);
    statSyncMock.mockReturnValue({ isFile: () => true });
    mkdtempMock.mockResolvedValue('/tmp/orch-clip-test');
    readFileMock.mockResolvedValue(Buffer.from('fake-png'));
    unlinkMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('isClipboardToolAvailable', () => {
    it('returns true on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(true);
    });

    it('returns true on linux when xclip is installed', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(true);
      expect(commandRunMock).not.toHaveBeenCalled();
    });

    it('returns false on linux when xclip is missing', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      accessSyncMock.mockImplementation(() => { throw new Error('not found'); });
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(false);
    });

    it('returns true on windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(true);
    });

    it('returns false on unsupported platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(false);
    });
  });

  describe('detectClipboardType', () => {
    describe('macOS', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
      });

      it('detects PNG image', async () => {
        mockCommandResolve('«class PNGf», 12345\n«class ut16», 0');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('image');
      });

      it('detects TIFF image', async () => {
        mockCommandResolve('«class TIFF», 12345');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('image');
      });

      it('detects text (ut16)', async () => {
        mockCommandResolve('«class ut16», 42');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('text');
      });

      it('detects text (utf8)', async () => {
        mockCommandResolve('«class utf8», 42');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('text');
      });

      it('returns empty on error', async () => {
        mockCommandReject();
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('empty');
      });

      it('returns empty for empty clipboard', async () => {
        mockCommandResolve('');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('empty');
      });
    });

    describe('linux', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
      });

      it('detects image/png', async () => {
        mockCommandResolve('TARGETS\nimage/png\ntext/plain');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('image');
      });

      it('detects text/plain', async () => {
        mockCommandResolve('TARGETS\ntext/plain\nUTF8_STRING');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('text');
      });

      it('returns empty on error', async () => {
        mockCommandReject();
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('empty');
      });
    });

    describe('windows', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
      });

      it('detects image', async () => {
        mockCommandResolve('image');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('image');
      });

      it('detects text', async () => {
        mockCommandSequence([{ stdout: 'none' }, { stdout: 'text' }]);
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('text');
      });

      it('returns empty on error', async () => {
        mockCommandReject();
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('empty');
      });
    });

    it('throws on unsupported platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
      await expect(detectClipboardType()).rejects.toThrow('Unsupported platform');
    });
  });

  describe('getClipboardImage', () => {
    it('returns null when clipboard has text', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      mockCommandResolve('«class ut16», 42');
      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(await getClipboardImage()).toBeNull();
    });

    it('returns null when clipboard is empty', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      mockCommandResolve('');
      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(await getClipboardImage()).toBeNull();
    });

    it('extracts image on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const pngData = Buffer.from('fake-png-data');

      mockCommandSequence([
        { stdout: '«class PNGf», 12345' },  // detect
        { stdout: 'ok' },                    // osascript write PNG
      ]);
      readFileMock.mockResolvedValue(pngData);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();

      expect(result).not.toBeNull();
      expect(result!.ext).toBe('png');
      expect(result!.data).toEqual(pngData);
    });

    it('extracts image on linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const pngData = Buffer.from('fake-png-data');

      mockCommandSequence([
        { stdout: 'TARGETS\nimage/png' },  // detect
        { stdout: pngData },               // xclip -o image data
      ]);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();

      expect(result).not.toBeNull();
      expect(result!.ext).toBe('png');
      expect(result!.data).toEqual(pngData);
      expect(commandRunMock).toHaveBeenLastCalledWith(expect.objectContaining({
        executable: expect.objectContaining({ path: '/resolved/xclip', realpath: '/resolved/xclip' }),
        args: ['-selection', 'clipboard', '-t', 'image/png', '-o'],
        timeoutMs: 3_000,
        maxStdoutBytes: 50 * 1024 * 1024,
        maxStderrBytes: 64 * 1024,
      }));
    });

    it('returns null on macOS when osascript returns error string', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockCommandSequence([
        { stdout: '«class PNGf», 12345' },  // detect
        { stdout: 'error' },                 // osascript failed
      ]);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();
      expect(result).toBeNull();
    });

    it('returns null on linux when xclip returns empty buffer', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockCommandSequence([
        { stdout: 'TARGETS\nimage/png' },
        { stdout: Buffer.alloc(0) },
      ]);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();
      expect(result).toBeNull();
    });

    it('cleans up temp files on macOS even on error', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockCommandSequence([
        { stdout: '«class PNGf», 12345' },  // detect
        { error: true },                      // osascript throws
      ]);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();
      expect(result).toBeNull();
      expect(rmMock).toHaveBeenCalledWith('/tmp/orch-clip-test', { recursive: true });
    });

    it('uses a bounded pinned descriptor without a shell', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      mockCommandResolve('«class ut16», 42');

      const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
      await detectClipboardType();

      expect(commandRunMock).toHaveBeenCalledWith(expect.objectContaining({
        executable: expect.objectContaining({ path: '/resolved/osascript', realpath: '/resolved/osascript' }),
        args: ['-e', 'clipboard info'],
        timeoutMs: 3_000,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 64 * 1024,
      }));
      expect(commandRunMock.mock.calls[0]![0]).not.toHaveProperty('shell');
    });
  });
});
