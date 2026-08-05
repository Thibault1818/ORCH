import fs from 'node:fs/promises';
import path from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface CheckDiscoveryResult {
  package_manager: PackageManager | null;
  checks: string[];
}

interface PackageManifest {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

const SCRIPT_NAMES = ['test', 'typecheck', 'lint', 'check', 'build'] as const;
const LOCKFILES: Readonly<Record<PackageManager, readonly string[]>> = {
  npm: ['npm-shrinkwrap.json', 'package-lock.json'],
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  bun: ['bun.lock', 'bun.lockb'],
};
const SHELL_SYNTAX = /[;&|><`\n\r]|\$\(|\$\{|\|\||&&/;
const PLACEHOLDER = /(?:no test specified|not implemented|todo|placeholder)|^(?:true|false|:|exit(?:\s+0)?|echo(?:\s+.*)?)$/i;
const SAFE_TOKEN = /^[A-Za-z0-9_@%+.,:/=~-]+$/;

/** Inspect local manifests only. Discovery never starts a process. */
export async function discoverDeterministicChecks(projectRoot: string): Promise<CheckDiscoveryResult> {
  const [manifest, packageManager] = await Promise.all([readPackageManifest(projectRoot), detectPackageManager(projectRoot)]);
  if (!manifest || !packageManager) return { package_manager: packageManager, checks: [] };

  const checks = SCRIPT_NAMES.flatMap((name) => {
    const script = manifest.scripts?.[name];
    return typeof script === 'string' && isSafeMeaningfulScript(script)
      ? [`${packageManager} run ${name}`]
      : [];
  });
  return { package_manager: packageManager, checks };
}

/** Validate user-supplied checks without executing or probing any binary. */
export async function validateExplicitChecks(projectRoot: string, checks: readonly string[]): Promise<string[]> {
  const normalized = validateDeterministicCheckCommands(checks);
  if (normalized.length === 0) throw new Error('At least one meaningful deterministic check is required');

  const [manifest, packageManager] = await Promise.all([readPackageManifest(projectRoot), detectPackageManager(projectRoot)]);
  for (const command of normalized) {
    if (!isSafeCommand(command)) throw new Error(`Unsafe or unsupported deterministic check: ${command}`);
    if (validatePackageScriptCommand(command, manifest, packageManager)) continue;
    if (validateKnownToolCommand(command, manifest)) continue;
    throw new Error(`Deterministic check is not trusted by a local manifest: ${command}`);
  }
  return [...new Set(normalized)];
}

/** Reject shell syntax and commands outside the bounded deterministic grammar. */
export function validateDeterministicCheckCommands(checks: readonly string[]): string[] {
  const normalized = checks.map((check) => check.trim().replace(/\s+/g, ' ')).filter(Boolean);
  for (const command of normalized) {
    if (!isSafeCommand(command)) throw new Error(`Unsafe or unsupported deterministic check: ${command}`);
    if (!isMeaningfulCommand(command)) throw new Error(`No meaningful deterministic check was provided: ${command}`);
  }
  return [...new Set(normalized)];
}

export function isMeaningfulCommand(command: string): boolean {
  return /^(?:npm test|(?:npm|pnpm|yarn|bun) run (?:test|typecheck|lint|check|build))$|^(?:tsc --noEmit|vitest run(?: [A-Za-z0-9_@%+.,:/=~-]+)*|jest(?: [A-Za-z0-9_@%+.,:/=~-]+)*|eslint (?:[A-Za-z0-9_@%+.,:/=~-]+ ?)+|biome check(?: [A-Za-z0-9_@%+.,:/=~-]+)*)$/.test(command);
}

function validatePackageScriptCommand(command: string, manifest: PackageManifest | null, packageManager: PackageManager | null): boolean {
  if (!manifest || !packageManager) return false;
  const match = /^(?:(npm) test|(npm|pnpm|yarn|bun) run (test|typecheck|lint|check|build))$/.exec(command);
  const manager = match?.[1] ?? match?.[2];
  const scriptName = match?.[1] ? 'test' : match?.[3];
  if (!match || manager !== packageManager) return false;
  const script = manifest.scripts?.[scriptName!];
  return typeof script === 'string' && isSafeMeaningfulScript(script);
}

function validateKnownToolCommand(command: string, manifest: PackageManifest | null): boolean {
  if (!manifest) return false;
  const [tool, ...args] = command.split(/\s+/);
  if (!tool || !knownToolArguments(tool, args)) return false;
  const packageName = tool === 'tsc' ? 'typescript' : tool;
  return packageName in (manifest.devDependencies ?? {}) || packageName in (manifest.dependencies ?? {});
}

function knownToolArguments(tool: string, args: string[]): boolean {
  if (tool === 'tsc') return args.includes('--noEmit') && args.every((arg) => SAFE_TOKEN.test(arg));
  if (tool === 'vitest') return args[0] === 'run' && args.every((arg) => SAFE_TOKEN.test(arg));
  if (tool === 'jest') return !args.includes('--watch') && !args.includes('--watchAll') && args.every((arg) => SAFE_TOKEN.test(arg));
  if (tool === 'eslint') return args.length > 0 && !args.includes('--fix') && args.every((arg) => SAFE_TOKEN.test(arg));
  if (tool === 'biome') return args[0] === 'check' && !args.includes('--write') && args.every((arg) => SAFE_TOKEN.test(arg));
  return false;
}

function isSafeMeaningfulScript(script: string): boolean {
  const value = script.trim();
  return value.length > 0 && !SHELL_SYNTAX.test(value) && !PLACEHOLDER.test(value);
}

function isSafeCommand(command: string): boolean {
  return !SHELL_SYNTAX.test(command) && command.split(/\s+/).every((token) => SAFE_TOKEN.test(token));
}

async function detectPackageManager(projectRoot: string): Promise<PackageManager | null> {
  const present: PackageManager[] = [];
  for (const manager of Object.keys(LOCKFILES) as PackageManager[]) {
    if (await anyExists(projectRoot, LOCKFILES[manager])) present.push(manager);
  }
  return present.length === 1 ? present[0]! : null;
}

async function anyExists(projectRoot: string, filenames: readonly string[]): Promise<boolean> {
  const results = await Promise.all(filenames.map((filename) => fs.access(path.join(projectRoot, filename)).then(() => true, () => false)));
  return results.some(Boolean);
}

async function readPackageManifest(projectRoot: string): Promise<PackageManifest | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as PackageManifest : null;
  } catch {
    return null;
  }
}
