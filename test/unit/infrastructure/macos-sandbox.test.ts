import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateMacosSandboxProfile } from '../../../src/infrastructure/security/macos-sandbox.js';

describe('macOS sandbox executable reads', () => {
  it('grants literal executable reads without inferred parent or brew-prefix subpaths', () => {
    const executable = '/opt/homebrew/Cellar/node/22.1.0/bin/node';
    const profile = generateMacosSandboxProfile({
      workspace: '/tmp/orch-workspace',
      proxyAddress: { host: '127.0.0.1', port: 4321 },
      readOnlyPaths: [executable, '/tmp/explicit-runtime'],
      readOnlyFiles: ['/opt/homebrew/Cellar/node/22.1.0/lib/libnode.dylib'],
      allowedExecutablePaths: [executable],
    }, '/tmp/orch-workspace', [executable]);

    expect(profile).toContain(`(literal ${JSON.stringify(executable)})`);
    expect(profile).toContain('(subpath "/tmp/explicit-runtime")');
    expect(profile).toContain('(literal "/opt/homebrew/Cellar/node/22.1.0/lib/libnode.dylib")');
    expect(profile).not.toContain(`(subpath ${JSON.stringify(executable)})`);
    expect(profile).not.toContain(`(subpath ${JSON.stringify(path.dirname(executable))})`);
    expect(profile).not.toContain('(subpath "/opt/homebrew")');
    expect(profile).not.toContain('(subpath "/opt/homebrew/Cellar")');
  });

  it('does not grant sibling credential or executable reads', () => {
    const profile = generateMacosSandboxProfile({
      workspace: '/tmp/orch-workspace',
      proxyAddress: { host: '127.0.0.1', port: 4321 },
      allowedExecutablePaths: ['/Users/example/tools/agent'],
    }, '/tmp/orch-workspace', ['/Users/example/tools/agent']);

    expect(profile).toContain('(literal "/Users/example/tools/agent")');
    expect(profile).not.toContain('(subpath "/Users/example/tools")');
    expect(profile).not.toContain('/Users/example/.aws');
    expect(profile).not.toContain('/Users/example/.config');
  });
});
