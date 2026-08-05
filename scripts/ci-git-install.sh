#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_SHA:?GITHUB_SHA must identify the exact commit under test}"
: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE must identify the checkout}"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
REAL_HOME="$HOME"
REAL_PREFIX="$(npm prefix -g)"
NODE_BIN="$(dirname "$(command -v node)")"
NPM_BIN="$(dirname "$(command -v npm)")"
GIT_BIN="$(dirname "$(command -v git)")"

snapshot_tree() {
  node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; const root=process.argv[1]; const rows=[]; function walk(p){for(const name of fs.readdirSync(p).sort()){const f=path.join(p,name); const s=fs.lstatSync(f); const rel=path.relative(root,f); if(s.isDirectory()){rows.push(`d ${rel} ${s.mode}`); walk(f);} else if(s.isSymbolicLink()) rows.push(`l ${rel} ${fs.readlinkSync(f)}`); else rows.push(`f ${rel} ${s.mode} ${s.size} ${crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")}`);}} walk(root); process.stdout.write(rows.join("\n"));' "$1"
}
snapshot_optional() { test -e "$1" && snapshot_tree "$1" || true; }
snapshot_profiles() {
  for profile in .zshrc .bashrc .bash_profile .profile; do
    if test -e "$1/$profile"; then shasum -a 256 "$1/$profile"; else printf 'absent %s\n' "$profile"; fi
  done
}

BEFORE_REAL_PROFILES="$(snapshot_profiles "$REAL_HOME")"
BEFORE_PREFIX="$(snapshot_tree "$REAL_PREFIX")"
BEFORE_CLAUDE="$(snapshot_optional "$REAL_HOME/.claude")"
BEFORE_CODEX="$(snapshot_optional "$REAL_HOME/.codex")"

export HOME="$SANDBOX/home"
export XDG_CONFIG_HOME="$SANDBOX/xdg-config"
export XDG_CACHE_HOME="$SANDBOX/xdg-cache"
export NPM_CONFIG_CACHE="$SANDBOX/npm-cache"
export NPM_CONFIG_USERCONFIG="$SANDBOX/npmrc"
export ORCH_FAKE_LOG="$HOME/fake-calls.jsonl"
export DOCTOR_FILE="$SANDBOX/doctor.json"
export STATUS_FILE="$SANDBOX/status.json"
TEMP_PREFIX="$SANDBOX/prefix"
FAKE_BIN="$SANDBOX/fake-bin"
PROJECT="$SANDBOX/project"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$NPM_CONFIG_CACHE" "$TEMP_PREFIX" "$FAKE_BIN" "$PROJECT"
SANDBOX_PROFILES="$(snapshot_profiles "$HOME")"

npm install -g "git+https://github.com/Thibault1818/ORCH.git#$GITHUB_SHA" --prefix "$TEMP_PREFIX"
export PATH="$FAKE_BIN:$TEMP_PREFIX/bin:$NODE_BIN:$NPM_BIN:$GIT_BIN:/usr/bin:/bin"
if command -v grok >/dev/null 2>&1 || command -v agy >/dev/null 2>&1 || command -v antigravity >/dev/null 2>&1; then
  printf 'Refusing to run with Grok or Antigravity available in sandbox PATH\n' >&2
  exit 1
fi

for alias in orch orchestry ao; do
  test -x "$TEMP_PREFIX/bin/$alias"
  "$alias" --version
  "$alias" --help >/dev/null
done

PACKAGE_ROOT="$(node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; process.stdout.write(path.dirname(path.dirname(fs.realpathSync(process.argv[1]))));' "$TEMP_PREFIX/bin/orch")"
export PACKAGE_ROOT
node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.env.PACKAGE_ROOT;
const sha = process.env.GITHUB_SHA;
const workspace = process.env.GITHUB_WORKSPACE;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.repository?.url !== 'git+https://github.com/Thibault1818/ORCH.git') throw new Error('Unexpected installed package provenance');
for (const file of ['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'npm-shrinkwrap.json']) {
  const installed = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  const committed = crypto.createHash('sha256').update(execFileSync('git', ['show', `${sha}:${file}`], { cwd: workspace })).digest('hex');
  if (installed !== committed) throw new Error(`Installed ${file} does not match GITHUB_SHA`);
}
const api = await import(pathToFileURL(path.join(root, 'dist/index.js')));
if (typeof api.WorkflowEngine !== 'function' || typeof api.hashCanonical !== 'function') throw new Error('External package API import failed');
NODE

cp "$GITHUB_WORKSPACE/test/fixtures/fake-workflow-cli.mjs" "$FAKE_BIN/codex"
cp "$GITHUB_WORKSPACE/test/fixtures/fake-workflow-cli.mjs" "$FAKE_BIN/claude"
chmod +x "$FAKE_BIN/codex" "$FAKE_BIN/claude"
: > "$ORCH_FAKE_LOG"

cat > "$PROJECT/package.json" <<'JSON'
{
  "name": "orch-ci-sandbox",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "node --test",
    "typecheck": "node --check check.js"
  }
}
JSON
cat > "$PROJECT/package-lock.json" <<'JSON'
{
  "name": "orch-ci-sandbox",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": { "": { "name": "orch-ci-sandbox", "version": "1.0.0" } }
}
JSON
cat > "$PROJECT/check.js" <<'JS'
export const deterministic = true;
JS

orch init "$PROJECT" --adapter codex

git -C "$PROJECT" init -b main
git -C "$PROJECT" config user.name "ORCH CI"
git -C "$PROJECT" config user.email "orch-ci@example.invalid"
git -C "$PROJECT" add .gitignore package.json package-lock.json check.js
git -C "$PROJECT" commit -m "Initialize deterministic fixture"

(
  cd "$PROJECT"
  if ! orch workflow doctor > "$DOCTOR_FILE"; then cat "$DOCTOR_FILE" >&2; exit 1; fi
  printf '%s\n' "PROMPT_SENTINEL_PLAN3" | orch workflow start --yes --mode direct --adviser none --max-adviser-calls 0 > "$SANDBOX/start.txt"
  if ! orch workflow status > "$STATUS_FILE"; then cat "$STATUS_FILE" >&2; exit 1; fi
)

node --input-type=module <<'NODE'
import fs from 'node:fs';

const calls = fs.readFileSync(process.env.ORCH_FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const invocations = calls.filter((call) => !call.argv.includes('--version') && !call.argv.includes('--help'));
if (invocations.length !== 3) throw new Error(`Expected three workflow model-boundary calls, got ${invocations.length}`);
const expected = [
  { command: 'codex', argv: ['exec', '--json', '--sandbox', 'read-only', '-c', 'model_reasoning_effort=high', '-'] },
  { command: 'claude', argv: ['--print', '--output-format', 'stream-json', '--max-turns', '50', '--verbose', '--model', 'opus', '--effort', 'high'] },
  { command: 'codex', argv: ['exec', '--json', '--sandbox', 'read-only', '-c', 'model_reasoning_effort=high', '-'] },
];
for (let index = 0; index < expected.length; index++) {
  if (invocations[index].command !== expected[index].command || JSON.stringify(invocations[index].argv) !== JSON.stringify(expected[index].argv)) throw new Error(`Unexpected ${['Supervisor', 'Implementer', 'Reviewer'][index]} invocation: ${JSON.stringify(invocations[index])}`);
}
for (const call of invocations) {
  if (!call.stdin.includes('PROMPT_SENTINEL_PLAN3')) throw new Error(`${call.command} prompt was not delivered on stdin`);
  if (call.argv.join(' ').includes('PROMPT_SENTINEL_PLAN3')) throw new Error(`${call.command} leaked the prompt sentinel into argv`);
}
if (calls.some((call) => call.command === 'grok' || call.command === 'agy' || call.command === 'antigravity')) throw new Error('Grok or Antigravity was invoked');
if (calls.some((call) => call.command === 'fable')) throw new Error('Adviser was invoked in direct mode');
const doctor = JSON.parse(fs.readFileSync(process.env.DOCTOR_FILE, 'utf8'));
if (!doctor.ready || doctor.discovered_checks.checks.length < 2) throw new Error('Workflow doctor did not validate trusted project checks');
const status = JSON.parse(fs.readFileSync(process.env.STATUS_FILE, 'utf8'));
if (status.phase !== 'done' || !/^wf_/.test(status.job_id)) throw new Error('Fake workflow did not complete deterministically');
NODE

orch setup >/dev/null
test ! -e "$HOME/.claude"
test ! -e "$HOME/.codex"
test "$SANDBOX_PROFILES" = "$(snapshot_profiles "$HOME")"
test "$BEFORE_REAL_PROFILES" = "$(snapshot_profiles "$REAL_HOME")"
test "$BEFORE_PREFIX" = "$(snapshot_tree "$REAL_PREFIX")"
test "$BEFORE_CLAUDE" = "$(snapshot_optional "$REAL_HOME/.claude")"
test "$BEFORE_CODEX" = "$(snapshot_optional "$REAL_HOME/.codex")"
