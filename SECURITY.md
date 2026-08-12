# Security Policy

## Supported Distribution

Only the secured fork at [Thibault1818/ORCH](https://github.com/Thibault1818/ORCH) is covered by this policy. It is a private/local package and is not published to npm. Install from the fork at an audited commit or tag; do not substitute the upstream npm package.

```bash
AUDITED_COMMIT_SHA="replace-with-the-reviewed-commit-sha"
npm install -g "git+https://github.com/Thibault1818/ORCH.git#$AUDITED_COMMIT_SHA" --prefix "$TEMP_PREFIX"
```

## Security Defaults

- Permission bypass and the shell adapter default to disabled.
- Dangerous execution requires both the corresponding config flag and `ORCHESTRY_ALLOW_DANGEROUS_EXECUTION=1`.
- Every enabled dedicated-workflow prompt is sent over stdin, excluded from child environments, and not persisted by default. Argv prompt transport is prohibited.
- Grok and Antigravity workflow bindings are disabled and fail closed because secure stdin prompt transport has not been proven; installation or `--help` output alone does not establish compatibility.
- Workflow start discovers or validates a meaningful trusted check before configuration can reach the engine. No Supervisor, Implementer, Adviser, or Reviewer LLM invocation occurs before that validation succeeds.
- Child environments are allowlisted; persisted data and terminal output are redacted.
- Worktree isolation, path containment, identifier validation, and symlink checks protect local state.
- Installation has no consumer lifecycle script and never modifies user configuration.
- Optional Claude integration requires `orch setup claude-integration` and explicit confirmation.
- ORCH does not install npm packages automatically or in the background. `orch update` only displays the secured fork's explicit update procedure.

These invariants are enforced by `test/security/security-regression.test.ts` and CI.

`orch workflow doctor` reports transport and per-role capability reasons rather than inferring safety from a fake CLI or advertised flags. Native resume is a separate limitation: advertised resume support remains disabled unless the installed CLI passes an end-to-end continuation probe and `ORCHESTRY_ENABLE_NATIVE_RESUME=1` is set; otherwise workflows use `passport_handoff`.

## Reporting

Do not open a public issue for a vulnerability. Use the fork's [private security advisory form](https://github.com/Thibault1818/ORCH/security/advisories/new) and include impact, reproduction steps, affected commit, OS, and Node.js version.

External agent CLI vulnerabilities remain the responsibility of their respective vendors.
