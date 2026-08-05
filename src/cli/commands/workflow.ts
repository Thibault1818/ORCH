import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Command } from 'commander';
import type { Container } from '../../container.js';
import type { AdapterCapabilityDescriptor, WorkflowCapabilityRole } from '../../infrastructure/adapters/interface.js';
import { discoverDeterministicChecks } from '../../application/workflow/check-discovery.js';
import { validateExplicitChecks } from '../../application/workflow/check-discovery.js';
import { resolveWorkflowLaunch, resolveWorkflowPreset, workflowPresetNames, type WorkflowLaunchOverrides } from '../../application/workflow/launch-resolver.js';
import type { WorkflowLaunchPreset, WorkflowPresetAgent, WorkflowPresetEffort } from '../../domain/workflow/presets.js';
import { SEMANTIC_ROLES, type RosterAgent, type SemanticRole } from '../../domain/workflow/roster.js';
import type { WorkflowPassportV2 } from '../../domain/workflow/state.js';
import type { AgentUsage, WorkflowInvocationReceiptV2 } from '../../domain/workflow/state.js';
import { createReadlineWorkflowPrompt, runWorkflowWizard, type WorkflowCapabilities, type WorkflowPrompt } from '../workflow-wizard.js';

interface WorkflowCommandDependencies {
  detectCapabilities?: () => Promise<WorkflowCapabilities>;
  isTTY?: () => boolean;
  prompt?: WorkflowPrompt;
}

interface StartOptions {
  preset?: string;
  supervisor?: string;
  implementer?: string;
  adviser?: string;
  reviewer?: string;
  supervisorModel?: string;
  implementerModel?: string;
  adviserModel?: string;
  reviewerModel?: string;
  supervisorEffort?: string;
  implementerEffort?: string;
  adviserEffort?: string;
  reviewerEffort?: string;
  maxAdviserCalls?: string;
  mode?: string;
  check?: string[];
  allow?: string[];
  yes?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
}

export function registerWorkflowCommand(program: Command, container: Container, dependencies: WorkflowCommandDependencies = {}): void {
  const workflow = program.command('workflow').description('Recoverable semantic-role workflow');
  workflow.command('start <objective>')
    .description('Configure, preflight, and run a workflow')
    .option('--preset <name>', 'Workflow launch preset')
    .option('--supervisor <cli>', 'Supervisor CLI')
    .option('--implementer <cli>', 'Implementer CLI')
    .option('--adviser <cli>', 'Adviser CLI, or none')
    .option('--reviewer <cli>', 'Reviewer CLI, or supervisor')
    .option('--supervisor-model <model>', 'Supervisor model/profile')
    .option('--implementer-model <model>', 'Implementer model/profile')
    .option('--adviser-model <model>', 'Adviser model/profile')
    .option('--reviewer-model <model>', 'Reviewer model/profile')
    .option('--supervisor-effort <effort>', 'Supervisor effort: low, medium, or high')
    .option('--implementer-effort <effort>', 'Implementer effort: low, medium, or high')
    .option('--adviser-effort <effort>', 'Adviser effort: low, medium, or high')
    .option('--reviewer-effort <effort>', 'Reviewer effort: low, medium, or high')
    .option('--max-adviser-calls <count>', 'Maximum adviser calls: 0 or 1')
    .option('--mode <mode>', 'Workflow mode: adaptive or direct')
    .option('--check <command...>', 'Trusted deterministic checks')
    .option('--allow <path...>', 'Allowed file scope')
    .option('--yes', 'Accept resolved defaults without prompting')
    .option('--non-interactive', 'Disable interactive prompting')
    .option('--dry-run', 'Validate and print the launch without starting')
    .action(async (objective: string, options: StartOptions) => {
      const tty = dependencies.isTTY?.() ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
      if (!options.dryRun && !options.yes && (options.nonInteractive || !tty)) throw new Error('Noninteractive workflow start requires --yes');
      const detect = dependencies.detectCapabilities ?? defaultCapabilityDetector;
      const projectPresets = container.config.workflow_launch;
      const globalPresets = container.globalConfig?.workflow_launch;
      const checks = options.check !== undefined ? await validateExplicitChecks(container.context.projectRoot, options.check) : (await discoverDeterministicChecks(container.context.projectRoot)).checks;
      if (checks.length === 0) throw new Error('No meaningful deterministic check was found; configure an explicit trusted check before starting the workflow');
      const capabilities = await detect();
      validateRequestedCapabilities(options, capabilities);
      const basePreset = resolveWorkflowPreset(options.preset, projectPresets, globalPresets);
      const initial = await resolveWorkflowLaunch({ project_root: container.context.projectRoot, selected_preset: options.preset, project: projectPresets, global: globalPresets, explicit: explicitOverrides(options, basePreset), required_checks: checks });
      let selected = initial;
      const interactive = !options.yes && !options.nonInteractive && tty;
      if (interactive) {
        const ownedPrompt = dependencies.prompt ? null : createReadlineWorkflowPrompt();
        try {
          const wizard = await runWorkflowWizard({
            preset: initial.preset,
            preset_names: workflowPresetNames(projectPresets, globalPresets),
            presets: Object.fromEntries(workflowPresetNames(projectPresets, globalPresets).map((name) => [name, name === initial.preset.name ? initial.preset : resolveWorkflowPreset(name, projectPresets, globalPresets)])),
            capabilities,
            discovered_checks: initial.required_checks,
          }, dependencies.prompt ?? ownedPrompt!.prompt);
          selected = await resolveWorkflowLaunch({ project_root: container.context.projectRoot, selected_preset: wizard.preset, project: projectPresets, global: globalPresets, required_checks: wizard.checks, explicit: { mode: wizard.mode, supervisor: wizard.supervisor, implementer: wizard.implementer, adviser: wizard.adviser, reviewer: wizard.reviewer, max_adviser_calls: wizard.max_adviser_calls } });
        } finally {
          ownedPrompt?.close();
        }
      }
      validateLaunchCapabilities(selected.preset, capabilities);
      const summary = { objective, preset: selected.preset.name, mode: selected.mode, roster: selected.roster, checks: selected.required_checks, max_adviser_calls: selected.preset.max_adviser_calls, dry_run: Boolean(options.dryRun) };
      print(container, summary);
      if (options.dryRun) return;
      const id = await container.workflowEngine.start({ objective, mode: selected.mode, allowed_file_scope: options.allow, required_checks: selected.required_checks, config: { ...container.config.workflow, ...selected.config, profiles: { ...container.config.workflow?.profiles, ...selected.config.profiles } }, roster: selected.roster });
      console.log(id);
      const result = await container.workflowEngine.run(id);
      if (result.phase === 'failed') process.exitCode = 1;
    });

  workflow.command('status [job-id]').description('Show locally persisted workflow status (latest when omitted)').action(async (requested: string | undefined) => {
    const id = requested ?? (await container.workflowStore.listJobs())[0]?.job_id;
    if (!id) throw new Error('No workflows found');
    const [job, sessions, passport, receipts] = await Promise.all([container.workflowStore.readJob(id), container.workflowStore.readSessions(id), container.workflowStore.readPassport(id), container.workflowStore.readInvocationReceipts(id)]);
    if (!job || !sessions || !passport) throw new Error(`Workflow job not found: ${id}`);
    const initialRoster = passport.roster ?? legacySemanticRoster(passport.mode);
    const roster = passport.active_roster ?? initialRoster;
    const semanticReceipts = receipts.filter((receipt) => receipt.semantic_role !== undefined);
    const roleUsage = Object.fromEntries(SEMANTIC_ROLES.map((role) => [role, receiptUsage(semanticReceipts.filter((receipt) => receipt.semantic_role === role))]));
    const legacyReceipts = receipts.filter((receipt) => receipt.semantic_role === undefined);
    const legacyUsage = legacyReceipts.length || receipts.length === 0 ? { source: 'legacy_provider_buckets', metrics: sessions.usage } : null;
    const value = { job_id: id, mode: job.mode, initial_roster: initialRoster, initial_roster_hash: passport.roster_hash, active_roster: roster, active_roster_hash: passport.active_roster_hash ?? passport.roster_hash, roster_revision: passport.roster_revision ?? 1, binding_rotation_history: passport.binding_rotation_history ?? [], phase: job.phase, current_role: roleFor(job.phase, job.consultation_origin), usage: { semantic_roles: roleUsage, legacy_fallback: legacyUsage }, tokens: Object.values(roleUsage).reduce((sum, usage) => sum + usage.tokens, 0) + (legacyUsage ? Object.values(legacyUsage.metrics).reduce((sum, usage) => sum + usage.estimated_tokens, 0) : 0), remaining_adviser_budget: Math.max(0, passport.config.fable_total_cap - job.fable_calls), checks: passport.required_checks, blocker: job.blocker };
    print(container, value);
  });

  workflow.command('pause <job-id>').description('Pause a workflow').action(async (id: string) => { print(container, await container.workflowEngine.pause(id)); });
  workflow.command('resume <job-id>').description('Resume and run a workflow in the foreground').option('--retry-invocation', 'Explicitly retry an interrupted call with no durable result').requiredOption('--reason <reason>', 'Audit reason for resuming').action(async (id: string, options: { retryInvocation?: boolean; reason: string }) => { const result = await container.workflowEngine.resume(id, { retry_invocation: options.retryInvocation, reason: options.reason }); print(container, result); if (result.phase === 'failed') process.exitCode = 1; });
  workflow.command('session-rotate <job-id> <role>').description('Rotate a Supervisor or Implementer session').option('--reason <reason>', 'Audit reason', 'manual rotation').action(async (id: string, role: string, options: { reason: string }) => { const legacyRole = role === 'supervisor' ? 'codex' : role === 'implementer' ? 'opus' : role; if (legacyRole !== 'codex' && legacyRole !== 'opus') throw new Error('Role must be supervisor or implementer (legacy codex and opus identifiers are also accepted)'); await container.workflowEngine.rotateSession(id, legacyRole, options.reason); print(container, { job_id: id, role, rotated: true }); });
  workflow.command('binding-rotate <job-id> <role>').description('Rotate an active semantic-role binding at a paused boundary').requiredOption('--adapter <adapter>', 'Adapter binding').requiredOption('--model <model>', 'Model/profile').requiredOption('--effort <effort>', 'Effort: low, medium, or high').requiredOption('--reason <reason>', 'Nonempty audit reason').option('--max-turns <count>', 'Maximum turns').option('--timeout <milliseconds>', 'Timeout in milliseconds').action(async (id: string, rawRole: string, options: { adapter: string; model: string; effort: string; reason: string; maxTurns?: string; timeout?: string }) => {
    if (!SEMANTIC_ROLES.includes(rawRole as SemanticRole)) throw new Error(`Role must be one of: ${SEMANTIC_ROLES.join(', ')}`); if (!['low', 'medium', 'high'].includes(options.effort)) throw new Error('Effort must be low, medium, or high'); if (!options.reason.trim()) throw new Error('Binding rotation requires a nonempty reason');
    const passport = await container.workflowStore.readPassport(id); if (!passport) throw new Error(`Workflow job not found: ${id}`); const role = rawRole as SemanticRole; const current = bindingFor(passport.active_roster ?? passport.roster!, role); const maxTurns = positiveInteger(options.maxTurns, current?.profile.max_turns ?? 1, 'max-turns'); const timeout = positiveInteger(options.timeout, current?.profile.timeout_ms ?? 600_000, 'timeout'); const binding: RosterAgent = { adapter: options.adapter, profile: { name: current?.profile.name ?? role, model: options.model, effort: options.effort as RosterAgent['profile']['effort'], max_turns: maxTurns, timeout_ms: timeout } };
    await container.workflowEngine.rotateBinding(id, role, binding, options.reason); print(container, { job_id: id, role, rotated: true });
  });
  workflow.command('cancel <job-id>').description('Cancel a workflow').action(async (id: string) => { print(container, await container.workflowEngine.cancel(id)); });
  workflow.command('logs <job-id>').description('Show durable workflow events').option('--raw', 'Show raw event data').action(async (id: string, options: { raw?: boolean }) => { const events = await container.workflowStore.readEvents(id); if (container.context.json || options.raw) console.log(JSON.stringify(events, null, 2)); else for (const event of events) console.log(`${event.timestamp} ${event.type}${event.type === 'phase_changed' ? `: ${(event.data as { from?: string }).from} -> ${(event.data as { to?: string }).to}` : ''}`); });
  workflow.command('artifacts <job-id>').description('List canonical workflow artifacts').action(async (id: string) => { const passport = await container.workflowStore.readPassport(id); if (!passport) throw new Error(`Workflow job not found: ${id}`); const root = path.join(container.context.projectRoot, '.orchestry', 'workflows', id, 'artifacts'); const artifacts = passport.artifacts.map((item) => ({ ...item, path: path.join(root, item.filename) })); print(container, artifacts); });
  workflow.command('doctor').description('Check workflow CLIs and local launch readiness').action(async () => {
    const checks = await discoverDeterministicChecks(container.context.projectRoot);
    const node = { version: process.version, compatible: Number(process.versions.node.split('.')[0]) >= 20 };
    const git = await gitVersion();
    const capabilities = await (dependencies.detectCapabilities ?? defaultCapabilityDetector)();
    const preset = resolveWorkflowPreset(undefined, container.config.workflow_launch, container.globalConfig?.workflow_launch);
    const blockers = [...(checks.checks.length ? [] : ['No meaningful deterministic check was found']), ...(node.compatible ? [] : ['Node.js 20 or newer is required']), ...(git === 'unavailable' ? ['Git is unavailable'] : []), ...configuredPresetBlockers(preset, capabilities)];
    const descriptors = Object.fromEntries(Object.entries(capabilities).map(([name, item]) => [name, doctorDescriptor(item)]));
    if (blockers.length) process.exitCode = 1;
    print(container, { node, git, cli_descriptors: descriptors, discovered_checks: checks, evaluated_preset: preset.name, ready: blockers.length === 0, blockers, configuration: path.join(container.context.projectRoot, '.orchestry', 'config.yml') });
  });
}

function explicitOverrides(options: StartOptions, base: WorkflowLaunchPreset): WorkflowLaunchOverrides | undefined {
  const effort = (value: string | undefined, label: string): WorkflowPresetEffort | undefined => { if (value === undefined) return undefined; if (!['low', 'medium', 'high'].includes(value)) throw new Error(`${label} effort must be low, medium, or high`); return value as WorkflowPresetEffort; };
  const mode = options.mode === undefined ? undefined : options.mode === 'adaptive' || options.mode === 'direct' ? options.mode : fail('Mode must be adaptive or direct');
  const max = options.maxAdviserCalls === undefined ? undefined : options.maxAdviserCalls === '0' || options.maxAdviserCalls === '1' ? Number(options.maxAdviserCalls) as 0 | 1 : fail('Maximum adviser calls must be 0 or 1');
  const agent = (adapter: string | undefined, model: string | undefined, selectedEffort: WorkflowPresetEffort | undefined, fallback: WorkflowPresetAgent): WorkflowPresetAgent | undefined => adapter || model || selectedEffort ? { adapter: adapter ?? fallback.adapter, model: model ?? fallback.model, effort: selectedEffort ?? fallback.effort } : undefined;
  const adviserEffort = effort(options.adviserEffort, 'Adviser');
  const adviser = options.adviser === 'none' ? null : agent(options.adviser, options.adviserModel, adviserEffort, base.adviser ?? { adapter: 'fable', model: 'fable', effort: 'low' });
  const result: WorkflowLaunchOverrides = {};
  const supervisor = agent(options.supervisor, options.supervisorModel, effort(options.supervisorEffort, 'Supervisor'), base.supervisor);
  const implementer = agent(options.implementer, options.implementerModel, effort(options.implementerEffort, 'Implementer'), base.implementer);
  const reviewerEffort = effort(options.reviewerEffort, 'Reviewer');
  if (options.reviewer === 'supervisor' && (options.reviewerModel || reviewerEffort)) throw new Error('Reviewer model and effort require a dedicated Reviewer CLI');
  const reviewerFallback = base.reviewer === 'supervisor' ? base.supervisor : base.reviewer;
  const reviewer = options.reviewer === 'supervisor' ? 'supervisor' : agent(options.reviewer, options.reviewerModel, reviewerEffort, reviewerFallback);
  if (mode !== undefined) result.mode = mode;
  if (supervisor) result.supervisor = supervisor;
  if (implementer) result.implementer = implementer;
  if (adviser !== undefined) result.adviser = adviser;
  if (reviewer !== undefined) result.reviewer = reviewer;
  if (max !== undefined) result.max_adviser_calls = max;
  else if (adviser) result.max_adviser_calls = 1;
  return result;
}

function validateRequestedCapabilities(options: StartOptions, capabilities: WorkflowCapabilities): void {
  const requests: Array<[string, string | undefined, WorkflowCapabilityRole]> = [['Supervisor', options.supervisor, 'supervisor'], ['Implementer', options.implementer, 'implementer'], ['Adviser', options.adviser === 'none' ? undefined : options.adviser, 'adviser'], ['Reviewer', options.reviewer === 'supervisor' ? undefined : options.reviewer, 'reviewer']];
  for (const [label, adapter, role] of requests) {
    if (!adapter) continue;
    const descriptor = Object.values(capabilities).find((item) => item.adapter === adapter);
    const compatibility = descriptor?.role_compatibility[role];
    if (!descriptor?.installed || !compatibility?.compatible) throw new Error(`${label} CLI ${adapter} is incompatible: ${compatibility?.reasons.join('; ') || descriptor?.detail || 'CLI is not installed'}`);
  }
}

export function validateLaunchCapabilities(preset: { mode: string; supervisor: WorkflowPresetAgent; implementer: WorkflowPresetAgent; adviser: WorkflowPresetAgent | null; reviewer: 'supervisor' | WorkflowPresetAgent; max_adviser_calls: number }, capabilities: WorkflowCapabilities): void {
  const assignments: Array<[string, string, WorkflowCapabilityRole]> = [['Supervisor', preset.supervisor.adapter, 'supervisor'], ['Implementer', preset.implementer.adapter, 'implementer']];
  if (preset.adviser) assignments.push(['Adviser', preset.adviser.adapter, 'adviser']);
  assignments.push(['Reviewer', preset.reviewer === 'supervisor' ? preset.supervisor.adapter : preset.reviewer.adapter, 'reviewer']);
  if (preset.mode === 'direct' && preset.adviser) throw new Error('Direct mode cannot include an Adviser');
  if (!preset.adviser && preset.max_adviser_calls !== 0) throw new Error('Maximum adviser calls must be zero when Adviser is None');
  if (preset.adviser && preset.max_adviser_calls !== 1) throw new Error('Maximum adviser calls must be one when an Adviser is selected');
  for (const [label, adapter, role] of assignments) {
    const descriptor = Object.values(capabilities).find((item) => item.adapter === adapter);
    const compatibility = descriptor?.role_compatibility[role];
    if (!descriptor?.installed || !compatibility?.compatible) throw new Error(`${label} CLI ${adapter} is incompatible: ${compatibility?.reasons.join('; ') || descriptor?.detail || 'CLI is not installed'}`);
  }
}

function legacySemanticRoster(mode: string) { return { supervisor: { adapter: 'codex', profile: 'codex' }, implementer: { adapter: 'claude', profile: 'opus' }, adviser: mode === 'adaptive' ? { adapter: 'fable', profile: 'fable' } : null, reviewer: { same_as: 'supervisor' as const } }; }
function receiptUsage(receipts: WorkflowInvocationReceiptV2[]) { return receipts.reduce((total, receipt) => { const result = receipt.result && typeof receipt.result === 'object' ? receipt.result as { usage?: Partial<AgentUsage>; error?: unknown } : {}; const usage = result.usage ?? {}; const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) || Math.ceil(((usage.input_chars ?? 0) + (usage.output_chars ?? 0)) / 4); return { calls: total.calls + 1, tokens: total.tokens + tokens, duration_ms: total.duration_ms + (usage.duration_ms ?? 0), failures: total.failures + (result.error === undefined ? 0 : 1) }; }, { calls: 0, tokens: 0, duration_ms: 0, failures: 0 }); }
function doctorDescriptor(item: AdapterCapabilityDescriptor) { return { installed: item.installed, version: item.version, transport: item.transport, capabilities: { structured_output: item.structured_output, sandbox: item.sandbox, tools: item.tools, resume: item.resume }, compatibility: item.role_compatibility }; }
function configuredPresetBlockers(preset: WorkflowLaunchPreset, capabilities: WorkflowCapabilities): string[] {
  const assignments: Array<[string, string, WorkflowCapabilityRole]> = [['Supervisor', preset.supervisor.adapter, 'supervisor'], ['Implementer', preset.implementer.adapter, 'implementer'], ['Reviewer', preset.reviewer === 'supervisor' ? preset.supervisor.adapter : preset.reviewer.adapter, 'reviewer']];
  if (preset.adviser) assignments.push(['Adviser', preset.adviser.adapter, 'adviser']);
  return assignments.flatMap(([label, adapter, role]) => {
    const descriptor = Object.values(capabilities).find((item) => item.adapter === adapter);
    const compatibility = descriptor?.role_compatibility[role];
    return descriptor?.installed && compatibility?.compatible ? [] : [`Configured ${label} CLI ${adapter} is unavailable or incompatible: ${compatibility?.reasons.join('; ') || descriptor?.detail || 'CLI is not installed'}`];
  });
}
function roleFor(phase: string, consultationOrigin: string | null): string | null { if (phase === 'codex_post_opus' || (phase === 'codex_after_fable' && consultationOrigin === 'post_opus')) return 'reviewer'; if (phase.startsWith('codex')) return 'supervisor'; if (phase === 'fable_consultation') return 'adviser'; if (phase === 'opus_execution') return 'implementer'; if (phase === 'verification' || phase === 'merge_ready') return 'reviewer'; return null; }
function bindingFor(roster: NonNullable<WorkflowPassportV2['roster']>, role: SemanticRole): RosterAgent | null { if (role === 'adviser') return roster.adviser; if (role === 'reviewer') return 'same_as' in roster.reviewer ? roster.supervisor : roster.reviewer; return roster[role]; }
function positiveInteger(value: string | undefined, fallback: number, label: string): number { if (value === undefined) return fallback; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`); return parsed; }
function fail(message: string): never { throw new Error(message); }
function print(_container: Container, value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
async function defaultCapabilityDetector(): Promise<WorkflowCapabilities> { const { detectWorkflowCapabilities } = await import('../../infrastructure/workflow/native-adapters.js'); return detectWorkflowCapabilities(); }
async function gitVersion(): Promise<string> { try { return (await promisify(execFile)('git', ['--version'])).stdout.trim(); } catch { return 'unavailable'; } }
