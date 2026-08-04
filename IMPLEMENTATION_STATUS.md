# Implementation Status

## Architecture

ORCH uses layered domain, application, infrastructure, and CLI/TUI modules. The dedicated workflow domain persists strict contracts, bounded versioned passports, session modes, usage, immutable artifacts, and events under `.orchestry/workflows/`. `WorkflowEngine` coordinates injected Codex, Fable, Opus, and Git ports independently from the generic goal state machine.

## Security Baseline

Dangerous permission bypass and shell execution are disabled by default and require config plus `ORCHESTRY_ALLOW_DANGEROUS_EXECUTION=1`. Prompt transport, restricted child environments, redaction, no-persistence defaults, path/symlink checks, lifecycle-free installation, private package metadata, and absence of background npm installs are protected by `test/security/security-regression.test.ts`.

## Verification

The workflow uses a schema-v2 direct Codex -> Opus -> Codex state machine. Deterministic fake adapters cover adaptive zero-Fable execution, direct mode, one optional advisory consultation, safe consultation fallback, direct correction cycles, phase-valid actions, restart recovery, stale commit/diff rejection, deterministic checks, and fail-closed merging. Native-boundary tests verify role-specific argv and stdin-only prompt transport. Legacy schema-v1 jobs remain inspectable but are blocked from unsafe resume. CI runs exact-commit Git installation in isolated prefixes on macOS and Linux with Node 20 and 24.

## Upstream Reconciliation

The fork and upstream were fetched and compared before implementation. Changes restoring Cursor `--yolo`, shell convenience defaults, npm publishing, and other unsafe execution behavior were rejected. The later Pi terminal-failure fix was reviewed as safe but deferred because it is unrelated to this pipeline and changes a large adapter surface; no wholesale upstream merge was performed.

## Limitation

Native resume remains disabled until an installed CLI passes a documented end-to-end continuation probe. `orch workflow doctor` reports detected versions/options and identifies `passport_handoff` honestly. A reserved but interrupted operation pauses for manual review rather than risking a duplicate paid call. `start` runs autonomously in the foreground after printing the recoverable job ID.
