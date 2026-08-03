#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const command = path.basename(process.argv[1]);
const argv = process.argv.slice(2);
const home = process.env.HOME;
if (!home) process.exit(90);
const root = path.join(home, '.orch-fake');
fs.mkdirSync(root, { recursive: true });
if (argv.includes('--version')) { fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({ command, argv, cwd: process.cwd(), stdin: '', env: Object.keys(process.env).sort() }) + '\n'); console.log(`${command} fake-1.0`); process.exit(0); }
if (argv.includes('--help')) {
  fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({ command, argv, cwd: process.cwd(), stdin: '', env: Object.keys(process.env).sort() }) + '\n');
  console.log(command === 'codex' ? 'exec resume --json --sandbox --model' : '--print --output-format --max-turns --model --effort --resume --bare --tools --disable-slash-commands --strict-mcp-config --mcp-config --no-session-persistence');
  process.exit(0);
}
const stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({ command, argv, cwd: process.cwd(), stdin, env: Object.keys(process.env).sort() }) + '\n');
const scenarioPath = path.join(root, 'scenario.json');
const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
const response = scenario.responses.shift();
fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
if (!response) { console.error('No scripted response'); process.exit(91); }
if (response.sleep_ms) await new Promise((resolve) => setTimeout(resolve, response.sleep_ms));
if (response.exit_code) { console.error(response.stderr ?? 'scripted failure'); process.exit(response.exit_code); }
if (command === 'codex') {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: response.session_id ?? 'codex-fake' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: response.text } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: response.usage ?? {} }));
} else {
  console.log(JSON.stringify({ type: 'result', result: response.text, session_id: response.session_id ?? 'claude-fake', usage: response.usage ?? {} }));
}
