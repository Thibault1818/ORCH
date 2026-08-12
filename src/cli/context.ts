/**
 * CLI context — resolved project root and global flags.
 *
 * Validated at entry point before any command runs.
 */

import { externalOrchestryRoots, findProjectRoot } from '../infrastructure/storage/paths.js';

export interface CliContext {
  projectRoot: string;
  stateRoot?: string;
  workspaceRoot?: string;
  json: boolean;
  quiet: boolean;
  noColor: boolean;
  ascii: boolean;
}

export function createContext(opts: {
  json?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  ascii?: boolean;
}): CliContext {
  const noColor =
    opts.noColor ||
    'NO_COLOR' in process.env ||
    false;

  const ascii =
    opts.ascii ||
    process.env['TERM'] === 'dumb' ||
    false;

  const projectRoot = findProjectRoot();
  const roots = externalOrchestryRoots(projectRoot);
  return {
    projectRoot,
    ...roots,
    json: opts.json ?? false,
    quiet: opts.quiet ?? false,
    noColor,
    ascii,
  };
}
