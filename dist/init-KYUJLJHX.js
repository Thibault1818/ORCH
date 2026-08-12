#!/usr/bin/env node
import {c as c$3,b as b$1,a as a$3}from'./chunk-DZK72HOZ.js';import {a as a$1}from'./chunk-ZGLWHEVK.js';import {f as f$1}from'./chunk-OLORWT4P.js';import'./chunk-NWIHKQJ6.js';import {k as k$1,j as j$2,q,i}from'./chunk-64WUDYEM.js';import {c as c$1,b}from'./chunk-JCDFROIG.js';import {k,j as j$1,c as c$2,a as a$2}from'./chunk-7V36EAEJ.js';import'./chunk-EULHBRCW.js';import'./chunk-BPWQ434U.js';import {c,f as f$2}from'./chunk-UQEE676R.js';import {a}from'./chunk-CDVPC44Y.js';import g from'path';import f from'fs/promises';import L from'readline';var O=`Agent architect \u2014 designs and creates AI agents for the orchestrator via \`orch agent add\`.

## CREATION PROCESS

1) ANALYZE \u2014 determine: agent function, required skills, adapter, team interactions.

2) WRITE THE ROLE \u2014 this is the most important part. A good role includes:
   - Identity and specialization (who you are)
   - Concrete workflow (numbered steps)
   - Which skills to invoke (\`/skill-name\`)
   - Rules and constraints
   Do NOT include CLI documentation or goal-mode instructions \u2014 these are already injected by the system prompt template.

3) CHOOSE CONFIGURATION:
   - adapter: \`claude\` (AI tasks), \`shell\` (bash scripts), \`codex\` (OpenAI Codex), \`pi\` (Pi coding agent RPC), \`cursor\` (Cursor IDE), \`opencode\` (OpenCode \u2014 multi-provider), \`grok\` (Grok CLI), \`antigravity\` (Google Antigravity CLI)
   - model: choose based on task complexity \u2014 use the \`capable\` tier for architecture/review, \`balanced\` for routine work, \`fast\` for simple/templated tasks. Model names vary by adapter.
   - approval_policy: \`auto\` (no confirmation) / \`suggest\` (proposes actions) / \`manual\` (human approval)
   - max_turns: 50 (default), up to 100 for complex tasks

4) CREATE:
   \`orch agent add "<name>" --adapter <adapter> --model <model> --skills "<skills>" --role "<role>" --approval-policy auto\`

## SKILL TYPES

There are two types of skills:

**Library skills** \u2014 ORCH loads Markdown content and injects it into the agent's system prompt. Works with ALL adapters (claude, opencode, codex, pi, cursor, grok, antigravity, shell). Use plain names without colons:

| Category | Skills |
|----------|--------|
| Code Review & QA | review, qa, qa-only, investigate |
| Planning | plan-ceo-review, plan-eng-review, plan-design-review, autoplan, office-hours |
| Design | design-consultation, design-review |
| Shipping | ship, land-and-deploy, canary, document-release |
| Infrastructure | browse, benchmark, setup-deploy, setup-browser-cookies |
| Safety | careful, freeze, unfreeze, guard |
| Cross-AI | codex |
| Meta | upgrade, retro |

**Claude Code MCP skills** \u2014 handled natively by Claude CLI. Use \`package:skill-name\` format (with colon):

Development: feature-dev:feature-dev, feature-dev:code-explorer, feature-dev:code-architect, feature-dev:code-reviewer
Testing: testing-suite:generate-tests, testing-suite:test-coverage, testing-suite:e2e-setup, testing-suite:test-quality-analyzer
Frontend: frontend-design:frontend-design, document-skills:frontend-design
Documents: document-skills:pdf, document-skills:xlsx, document-skills:docx, document-skills:pptx
Marketing: marketing-psychology, product-manager-toolkit
DevOps: devops-automation:cloud-architect

You can mix both types: \`--skills "review,feature-dev:code-explorer,investigate"\`

## ANTI-PATTERNS

- Never create agents without skills \u2014 they cannot be auto-matched to tasks.
- Never write generic roles like "helper" \u2014 be specific about actions and tools.
- Never use opus for simple tasks \u2014 it is expensive; use sonnet or haiku.
- Never assign more than 3-4 skills per agent \u2014 create specialized agents instead.
- Never use the -e/--edit flag in automated mode \u2014 it opens an interactive editor.
- Always specify --role when calling \`orch agent add\`.

After creation \u2014 \`orch context set agent-<name> "<capabilities>"\`.`;function I(o="claude"){let t=a$3(o,"balanced");return [{id:"agt_creator",name:"Agent Creator",adapter:o,role:O,config:{model:t||void 0,approval_policy:"suggest",max_turns:50,timeout_ms:36e5,stall_timeout_ms:3e5,skills:o==="claude"?["document-skills:skill-creator"]:[]},status:"idle",stats:{tasks_completed:0,tasks_failed:0,total_runs:0,total_runtime_ms:0}}]}var N=new c(new a);async function S(o={}){let t=g.resolve(o.target??process.cwd());o.target&&await f.mkdir(t,{recursive:true});let r=c$1(t),e=new b(t,r.stateRoot,r.workspaceRoot);if(await k(e.projectConfigRoot)){k$1("Already initialized");return}let n=o.adapter??await j();await Promise.all([j$1(e.tasksDir),j$1(e.agentsDir),j$1(e.goalsDir),j$1(e.runsDir),j$1(e.templatesDir),j$1(e.logsDir),j$1(e.projectConfigRoot),j$1(e.workspacesRoot)]);let l=await M(t),i=structuredClone(a$1);i.project.name=o.name??g.basename(t),i.defaults.agent.adapter=n,l||(i.defaults.agent.workspace_mode="shared");let $=["# Runtime state","state.json","*.lock","","# Logs and runs","runs/","logs/","","# Agent workspaces","workspaces/"].join(`
`)+`
`,D=[".orchestry","node_modules",".env",".env.*","dist","build",".next","__pycache__","*.pyc",".venv"].join(`
`)+`
`,h=I(n);await Promise.all([c$2(e.configPath,i),a$2(e.gitignorePath,$),a$2(e.workspaceExcludePath,D),a$2(e.defaultTemplatePath(),f$1),...h.map(c=>c$2(e.agentPath(c.id),c))]),await G(t),l&&await z(t),console.log(),j$2("initialized"),console.log(),console.log(`  Created ${q(".orchestry/")}`),console.log(`  ${q("\u251C\u2500\u2500")} config.yml`),console.log(`  ${q("\u251C\u2500\u2500")} tasks/`),console.log(`  ${q("\u251C\u2500\u2500")} agents/`);for(let c of h)console.log(`  ${q("\u2502   \u2514\u2500\u2500")} ${c.id}.yml ${q(`(${c.name})`)}`);console.log(`  ${q("\u251C\u2500\u2500")} templates/default.md`),console.log(`  ${q("\u2514\u2500\u2500")} .gitignore`),console.log();}async function j(){let t=(await Promise.all(c$3.filter(e=>e!=="shell").map(async e=>{let n=e==="cursor"?["cursor-agent"]:e==="antigravity"?["agy"]:[e];for(let l of n)try{let i=await u(l,["--version"],void 0,5e3);if(i.ok)return {name:e,ok:!0,version:i.stdout.trim().split(`
`)[0]}}catch{}return {name:e,ok:false}}))).filter(e=>e.ok);if(t.length===0)return console.log(`  ${q("No AI adapters detected \u2014 defaulting to claude")}`),"claude";if(t.length===1)return console.log(`  ${q(`Detected: ${t[0].name}`)} ${q(t[0].version?`(${t[0].version})`:"")}`),t[0].name;if(!process.stdout.isTTY||!process.stdin.isTTY)return t[0].name;console.log(),console.log("  Available adapters:");for(let e=0;e<t.length;e++){let n=t[e];console.log(`    ${e+1}) ${n.name} ${q(n.version??"")}`);}console.log();let r=L.createInterface({input:process.stdin,output:process.stdout});try{let e=await new Promise(l=>{r.question(`  Choose default adapter [1-${t.length}]: `,l);}),n=parseInt(e,10)-1;return n>=0&&n<t.length?t[n].name:t[0].name}finally{r.close();}}async function M(o){try{if((await u("git",["rev-parse","--is-inside-work-tree"],o)).ok)return !0}catch{}try{return (await u("git",["init"],o)).ok}catch{return  false}}async function z(o){try{if((await u("git",["rev-parse","HEAD"],o)).ok)return}catch{}await u("git",["commit","--allow-empty","-m","Initial commit"],o).catch(()=>{});}async function u(o,t,r,e=3e4){let n=await f$2(o);return N.run({executable:n,args:t,cwd:r,env:process.env,timeoutMs:e,maxStdoutBytes:1024*1024,maxStderrBytes:1024*1024})}async function G(o){let t=g.join(o,".gitignore");try{let r=await f.readFile(t,"utf-8");if(r.split(`
`).some(n=>n.trim()===".orchestry"))return;let e=r.endsWith(`
`)?"":`
`;await f.appendFile(t,`${e}
# Orchestry state
.orchestry
`);}catch{await a$2(t,`# Orchestry state
.orchestry
`);}}function oe(o){o.command("init [target]").description("Initialize .orchestry/ in the current directory").option("--name <name>","Project name").option("--adapter <adapter>","Default agent adapter (claude, opencode, codex, cursor, pi, grok, antigravity, shell)").action(async(t,r)=>{if(r.adapter&&!b$1(r.adapter)){i(`Unknown adapter "${r.adapter}"`,`Supported: ${c$3.join(", ")}`),process.exitCode=2;return}await S({...r,target:t}),console.log(`  Next: ${q('orch task add "Create backend agent" --assignee agt_creator')}`),console.log();});}export{oe as registerInitCommand,S as runInit};