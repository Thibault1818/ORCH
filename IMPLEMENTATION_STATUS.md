# Implementation Status

## Architecture

ORCH uses layered domain, application, infrastructure, and CLI/TUI modules. The dedicated workflow domain persists strict contracts, bounded versioned passports, semantic-role rosters, session modes, usage, immutable artifacts, and events under `.orchestry/workflows/`. `WorkflowEngine` coordinates Supervisor, Implementer, optional Adviser, Reviewer, and Git ports independently from the generic goal state machine. Legacy Codex/Fable/Opus phase and action identifiers remain in schema-v2 wire state for compatibility.

## Security Baseline

Dangerous permission bypass and shell execution are disabled by default and require config plus `ORCHESTRY_ALLOW_DANGEROUS_EXECUTION=1`. All enabled workflow prompts use stdin only. Grok and Antigravity are incompatible and fail closed because secure stdin transport is unproven. Check discovery and explicit-check validation complete before the engine starts, so no LLM is invoked before a meaningful trusted check is validated. Restricted child environments, redaction, no-persistence defaults, path/symlink checks, lifecycle-free installation, private package metadata, and absence of background npm installs are protected by `test/security/security-regression.test.ts`.

## Verification

The workflow uses a schema-v2 Supervisor -> Implementer -> Reviewer state machine, with an optional Adviser. Deterministic test doubles cover the default adaptive direct path (Adviser `None`, maximum `0`), direct mode, an optional bounded consultation, persisted fallback routing, correction cycles, phase-valid wire actions, immutable rosters and audited paused-boundary rotations, monotonic revisions, journal recovery, completed-effect replay, ambiguous-effect blocking, stale commit/diff rejection, deterministic checks, and fail-closed merging. Native-boundary tests verify role-specific argv and stdin-only prompt transport; no security claim depends on a fake CLI. Legacy schema-v1 jobs remain inspectable but are blocked from unsafe resume. CI runs exact-commit Git installation in isolated prefixes on macOS and Linux with Node 20 and 24.

## Upstream Reconciliation

The fork and upstream were fetched and compared before implementation. Changes restoring Cursor `--yolo`, shell convenience defaults, npm publishing, and other unsafe execution behavior were rejected. The later Pi terminal-failure fix was reviewed as safe but deferred because it is unrelated to this pipeline and changes a large adapter surface; no wholesale upstream merge was performed.

## Limitation

Native resume remains disabled until an installed CLI passes a documented end-to-end continuation probe. `orch workflow doctor` reports detected versions, transport, structured output, sandbox/tool/resume capabilities, per-role compatibility reasons, discovered checks, and launch blockers; it identifies `passport_handoff` honestly. Model invocations, checks, and merge attempts use durable receipts; ambiguous external effects block permanently rather than risk duplication. `start` discovers checks before its TTY wizard, prints the resolved roster/check summary, and runs in the foreground after printing the recoverable job ID.
