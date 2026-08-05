#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const command = path.basename(process.argv[1]);
const argv = process.argv.slice(2);
const log = process.env.ORCH_FAKE_LOG;
if (!log) process.exit(90);

function record(stdin = '') {
  fs.appendFileSync(log, `${JSON.stringify({ command, argv, cwd: process.cwd(), stdin })}\n`);
}

if (argv.includes('--version')) {
  record();
  console.log(`${command} fake-1.0`);
  process.exit(0);
}

if (argv.includes('--help')) {
  record();
  console.log(command === 'codex'
    ? 'exec resume --json --sandbox --model'
    : '--print --output-format --max-turns --model --effort --resume --bare --tools --disable-slash-commands --strict-mcp-config --mcp-config --no-session-persistence');
  process.exit(0);
}

const stdin = fs.readFileSync(0, 'utf8');
record(stdin);
const jobId = stdin.match(/"job_id":"([A-Za-z0-9._-]+)"/)?.[1];
if (!jobId) {
  console.error('Fake workflow CLI could not find job_id on stdin');
  process.exit(91);
}

if (command === 'claude') {
  const result = { job_id: jobId, status: 'completed', files_changed: [], commands_run: [], tests_reported: [], deviations: [], unresolved: [], summary: 'Deterministic fake implementation completed' };
  console.log(JSON.stringify({ type: 'result', result: JSON.stringify(result), session_id: 'claude-fake', usage: {} }));
  process.exit(0);
}

const postOpus = stdin.includes('"stage":"post_opus"');
const decision = {
  schema_version: 2,
  job_id: jobId,
  action: postOpus ? 'ACCEPT' : 'DISPATCH_OPUS',
  summary: postOpus ? 'Deterministic fake review accepted' : 'Deterministic fake dispatch',
  implementation_brief: postOpus ? null : 'Complete the deterministic no-change validation task',
  required_changes: [],
  risk_level: 'low',
  fable_query: null,
  reviewed_commit: postOpus ? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() : null,
  fable_advice_disposition: null,
  fable_error: null,
  fable_iteration_effect: null,
};
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'codex-fake' }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(decision) } }));
console.log(JSON.stringify({ type: 'turn.completed', usage: {} }));
