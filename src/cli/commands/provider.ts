import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Command } from 'commander';
import type { Container } from '../../container.js';
import { discoverModelOptions } from '../../infrastructure/models/model-discovery.js';
import { atomicWrite, ensureDir } from '../../infrastructure/storage/fs-utils.js';

export function registerProviderCommand(program: Command, container: Container): void {
  const provider = program.command('provider').description('Discover and qualify workflow providers');

  provider.command('list').description('List OpenCode models visible to ORCH').action(async () => {
    const models = (await discoverModelOptions('opencode')).filter((model) => model.value.includes('/'));
    print({ adapter: 'opencode', models, local_candidates: models.filter((model) => isLocalProvider(model.value)) });
  });

  provider.command('qualify <adapter>').description('Record transport qualification for an exact model')
    .requiredOption('--model <provider/model>', 'Exact provider/model identifier')
    .action(async (adapter: string, options: { model: string }) => {
      if (adapter !== 'opencode') throw new Error('Initial provider qualification supports opencode only');
      if (!options.model.includes('/')) throw new Error('Qualification requires an exact provider/model');
      const models = await discoverModelOptions('opencode');
      if (!models.some((model) => model.value === options.model)) throw new Error(`OpenCode model is not available: ${options.model}`);
      const record = {
        schema_version: 1,
        adapter,
        model: options.model,
        locality: isLocalProvider(options.model) ? 'local_candidate' : 'remote_or_unknown',
        level: 'transport_only',
        eligible_roles: [] as string[],
        evidence: ['model_discovered'],
        limitations: ['No model call was made', 'Tool use, context size, isolation, and coding reliability remain unverified'],
        qualified_at: new Date().toISOString(),
      };
      const dir = path.join(container.context.projectRoot, '.orchestry', 'providers');
      await ensureDir(dir);
      await atomicWrite(path.join(dir, `${safe(options.model)}.json`), JSON.stringify(record, null, 2));
      print(record);
    });
}

function isLocalProvider(model: string): boolean {
  return /^(?:ollama|lmstudio|llamacpp|llama-cpp|local)\//i.test(model);
}
function safe(value: string): string { return `${value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`; }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
