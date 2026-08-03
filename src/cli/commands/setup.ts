import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

export function registerSetupCommand(program: Command): void {
  program.command('setup [integration]')
    .description('Show setup status or explicitly configure an integration')
    .option('--yes', 'Confirm the requested configuration change')
    .action(async (integration: string | undefined, options: { yes?: boolean }) => {
      if (!integration) {
        console.log('ORCH is installed. No user configuration was changed.');
        console.log('Optional: orch setup claude-integration');
        return;
      }
      if (integration !== 'claude-integration') throw new Error(`Unsupported integration: ${integration}`);
      const confirmed = options.yes === true || await confirm('Install the ORCH skill under ~/.claude/skills/orch?');
      if (!confirmed) {
        console.log('No changes made.');
        return;
      }
      const source = await skillSource();
      const destination = path.join(os.homedir(), '.claude', 'skills', 'orch', 'SKILL.md');
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fs.copyFile(source, destination);
      await fs.chmod(destination, 0o600).catch(() => {});
      console.log(`Installed Claude integration: ${destination}`);
    });
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(`${question} [y/N] `, resolve));
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function skillSource(): Promise<string> {
  const base = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(base, '..', 'skills', 'orch', 'SKILL.md'), path.resolve(base, '..', '..', '..', 'skills', 'orch', 'SKILL.md')];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* try source-tree layout */ }
  }
  throw new Error('Packaged Claude integration is missing');
}
