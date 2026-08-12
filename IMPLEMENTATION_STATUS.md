# Implementation Status

## Architecture

ORCH uses layered domain, application, infrastructure, and CLI/TUI modules. The dedicated workflow domain persists strict contracts, bounded versioned passports, semantic-role rosters, session modes, usage, immutable artifacts, and events in controller-owned external state. `WorkflowEngine` coordinates Supervisor, Implementer, optional Adviser, Reviewer, and Git ports independently from the generic goal state machine. Legacy Codex/Fable/Opus phase and action identifiers remain in schema-v2 wire state for compatibility.

The multi-provider branch adds a workflow-driver registry and a separate schema-v3 governance evidence layer. Governance v3 stores immutable binding snapshots, decomposition DAGs, exact candidate evidence, check bindings, independent review votes, quorum results, integration receipts, and human approvals. The generic orchestrator remains the parallel task scheduler. Executable tasks use isolated, no-hardlink Git clones outside the repository; shared workspace execution is rejected because it cannot defer changes for approval.

## Security Baseline

All production subprocesses route through `CommandRunner`; only `ProcessManager` calls Node's process API. Executables resolve to canonical paths with SHA-256 descriptors and are verified before and after execution. Agent and check commands run under a deny-default macOS `sandbox-exec` profile. The profile limits writes to the isolated clone, permits only explicitly hashed executables, denies direct network access, and exposes an HTTP CONNECT proxy that allows only explicit model endpoints. Configure endpoint additions as comma-separated `host:port` values in `ORCHESTRY_MODEL_ENDPOINTS`; additional executable paths use `ORCHESTRY_EXECUTABLE_ALLOWLIST` with the platform path delimiter.

Git uses isolated HOME/XDG configuration and disables system/global config, hooks, filters, fsmonitor, credential helpers, SSH helpers, external diff/text conversion, custom clone helpers, submodule checkout, and interactive prompts. Repository filter attributes are rejected before checkout. Workflow and generic task state live under a project-hash-specific external controller directory; isolated clones use a separate external root. Exact committed clone revisions are imported through temporary refs before merge.

Model review cannot merge. Generic tasks remain in `review` after sandboxed checks and preserve exact base, commit, diff, path, and target evidence; only explicit CLI/TUI approval can recheck and merge that evidence. Schema-v2 workflows stop at `awaiting_approval`; `orch workflow approve` requires an interactive exact-commit challenge and persists approval bound to the target branch, base commit, reviewed commit, diff hash, and check artifact hash. Approval and merge require owner-tagged process groups to be terminated. Real-project execution requires a fresh, controller-HMAC-signed `orch workflow doctor` attestation bound to the current endpoint, executable, and sandbox policy. Schema-v3 records are controller-HMAC-authenticated; governed merges recompute candidate and integration Git evidence, require exact candidate composition and human approval, and update the target ref by compare-and-swap from the recorded base commit.

## Verification

The final local verification passed typecheck, 2,192 tests with 2 skipped, distribution build, zero dependency vulnerabilities, `git diff --check`, real Git clone/import integration tests, governance race tests, migration recovery tests, durable cross-process ownership tests, and real macOS adversarial sandbox tests. The adversarial suite verifies filesystem escape denial, direct-network denial, unpinned executable denial, process persistence cleanup, active-process approval blocking, policy drift, and signed-attestation forgery rejection. No paid model call was made.

The real local doctor detects OpenCode 1.18.16 as compatible with the Implementer role. Codex, Claude, Grok, and Antigravity are not installed on this host and remain unavailable. No Ollama provider/model is currently visible through OpenCode.

## Upstream Reconciliation

The fork and upstream were fetched and compared before implementation. Changes restoring Cursor `--yolo`, shell convenience defaults, npm publishing, and other unsafe execution behavior were rejected. The later Pi terminal-failure fix was reviewed as safe but deferred because it is unrelated to this pipeline and changes a large adapter surface; no wholesale upstream merge was performed.

## Limitations

Native resume remains disabled until an installed CLI passes a documented end-to-end continuation probe. Grok Build cannot be enabled until the real Grok CLI proves stdin-only prompt transport and structured completion. Local models remain `transport_only` until tool use, context, reliability, resource use, and locality are behaviorally qualified.

Real-project mode currently requires macOS because `sandbox-exec` is the implemented containment backend. It fails closed on Linux and Windows until equivalent platform backends are implemented. Endpoint allowlisting uses a loopback controller proxy because macOS sandbox profiles cannot safely express dynamic DNS hostnames. Provider credentials still need to be supplied through each CLI's supported authenticated environment; the proxy does not store credentials.

The schema-v3 governance services and exact merge path are implemented and exported, but automatic materialization of a decomposition plan into parallel generic ORCH tasks and automatic collection of their branches into v3 candidate records is not yet wired into a single end-user CLI command. Until that scheduler bridge is implemented, use generic ORCH teams/tasks for parallel execution and the existing schema-v2 workflow for the fully automated single-Implementer path.
