import fs4, { readFile, mkdtemp, unlink, rm } from 'fs/promises';
import path4, { join, isAbsolute, delimiter, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';
import 'js-yaml';
import { realpathSync, statSync, accessSync, mkdirSync, openSync, writeFileSync, closeSync, readFileSync, rmSync, readSync, createReadStream, existsSync, lstatSync, chmodSync, renameSync, constants } from 'fs';
import os, { tmpdir } from 'os';
import { spawn, spawnSync } from 'child_process';
import net from 'net';
import { AsyncLocalStorage } from 'async_hooks';

// src/domain/run.ts
function createTokenUsage(input, output, opts) {
  const reasoning = opts?.reasoning ?? 0;
  return {
    input,
    output,
    reasoning,
    total: input + output + reasoning,
    cache_read: opts?.cache_read ?? 0,
    cache_write: opts?.cache_write ?? 0
  };
}

// src/domain/errors.ts
var OrchestryError = class extends Error {
  constructor(message, exitCode, hint) {
    super(message);
    this.exitCode = exitCode;
    this.hint = hint;
    this.name = "OrchestryError";
  }
  exitCode;
  hint;
};
var NotInitializedError = class extends OrchestryError {
  constructor() {
    super("Not initialized", 3, "Run: orch init");
    this.name = "NotInitializedError";
  }
};
var TaskNotFoundError = class extends OrchestryError {
  constructor(taskId) {
    super(`Task not found: ${taskId}`, 1);
    this.name = "TaskNotFoundError";
  }
};
var AgentNotFoundError = class extends OrchestryError {
  constructor(agentId) {
    super(`Agent not found: ${agentId}`, 1);
    this.name = "AgentNotFoundError";
  }
};
var GoalHasPendingTasksError = class extends OrchestryError {
  constructor(goalId, count, summary) {
    super(
      `Cannot mark goal ${goalId} as achieved: ${count} task(s) still pending \u2014 ${summary}`,
      1,
      "Use --force to cancel pending tasks and mark achieved"
    );
    this.name = "GoalHasPendingTasksError";
  }
};
var WorkspaceError = class extends OrchestryError {
  constructor(message, hint) {
    super(message, 6, hint);
    this.name = "WorkspaceError";
  }
};
var AdapterErrorKind = /* @__PURE__ */ ((AdapterErrorKind2) => {
  AdapterErrorKind2["ADAPTER_NOT_FOUND"] = "adapter_not_found";
  AdapterErrorKind2["AUTH_FAILED"] = "auth_failed";
  AdapterErrorKind2["TIMEOUT"] = "timeout";
  AdapterErrorKind2["RATE_LIMIT"] = "rate_limit";
  AdapterErrorKind2["PROCESS_CRASH"] = "process_crash";
  AdapterErrorKind2["SPAWN_FAILED"] = "spawn_failed";
  AdapterErrorKind2["UNKNOWN"] = "unknown";
  return AdapterErrorKind2;
})(AdapterErrorKind || {});
var ERROR_HINTS = {
  ["adapter_not_found" /* ADAPTER_NOT_FOUND */]: {
    message: "CLI \u043D\u0435 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.",
    fix: "\u0423\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0435: npm i -g @anthropic-ai/claude-code",
    doctorHint: true
  },
  ["auth_failed" /* AUTH_FAILED */]: {
    message: "API \u043A\u043B\u044E\u0447 \u043D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D.",
    fix: "\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435: claude auth status"
  },
  ["timeout" /* TIMEOUT */]: {
    message: "\u0410\u0433\u0435\u043D\u0442 \u043F\u0440\u0435\u0432\u044B\u0441\u0438\u043B \u043B\u0438\u043C\u0438\u0442 \u0432\u0440\u0435\u043C\u0435\u043D\u0438.",
    fix: "\u0423\u0432\u0435\u043B\u0438\u0447\u044C\u0442\u0435 \u0447\u0435\u0440\u0435\u0437: orch config set agent_timeout <ms>"
  },
  ["rate_limit" /* RATE_LIMIT */]: {
    message: "\u0414\u043E\u0441\u0442\u0438\u0433\u043D\u0443\u0442 \u043B\u0438\u043C\u0438\u0442 API.",
    fix: "\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435: orch task retry <id>"
  },
  ["process_crash" /* PROCESS_CRASH */]: {
    message: "\u041F\u0440\u043E\u0446\u0435\u0441\u0441 \u0430\u0433\u0435\u043D\u0442\u0430 \u0443\u043F\u0430\u043B.",
    fix: "\u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435: orch task retry <id>"
  },
  ["spawn_failed" /* SPAWN_FAILED */]: {
    message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u0440\u043E\u0446\u0435\u0441\u0441.",
    fix: "\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 PATH \u0438 \u043F\u0440\u0430\u0432\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u0430"
  },
  ["unknown" /* UNKNOWN */]: {
    message: "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430.",
    fix: "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435: orch doctor",
    doctorHint: true
  }
};
function classifyAdapterError(error, exitCode) {
  const lower = error.toLowerCase();
  if (lower.includes("enoent") || lower.includes("spawn failed")) {
    return "spawn_failed" /* SPAWN_FAILED */;
  }
  if (lower.includes("not found") || lower.includes("command not found") || lower.includes("no such file")) {
    return "adapter_not_found" /* ADAPTER_NOT_FOUND */;
  }
  if (lower.includes("auth") || lower.includes("unauthorized") || lower.includes("401") || lower.includes("invalid api key") || lower.includes("authentication")) {
    return "auth_failed" /* AUTH_FAILED */;
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    return "timeout" /* TIMEOUT */;
  }
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return "rate_limit" /* RATE_LIMIT */;
  }
  if (exitCode !== void 0 && exitCode !== 0) {
    return "process_crash" /* PROCESS_CRASH */;
  }
  return "unknown" /* UNKNOWN */;
}

// src/domain/transitions.ts
var VALID_TRANSITIONS = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["review", "retrying", "failed", "cancelled"],
  retrying: ["in_progress", "failed", "cancelled"],
  review: ["done", "todo", "cancelled"],
  done: [],
  failed: ["todo", "retrying"],
  cancelled: ["todo"]
};
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
function canTransition(from, to) {
  return VALID_TRANSITIONS[from].includes(to);
}
function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}
function isDispatchable(status) {
  return status === "todo" || status === "retrying";
}
function isBlocked(task, allTasks) {
  if (task.depends_on.length === 0) return false;
  if (allTasks instanceof Map) {
    return task.depends_on.some((depId) => {
      const dep = allTasks.get(depId);
      if (!dep) return false;
      return dep.status !== "done";
    });
  }
  return task.depends_on.some((depId) => {
    const dep = allTasks.find((t) => t.id === depId);
    if (!dep) return false;
    return dep.status !== "done";
  });
}
function resolveFailureStatus(task) {
  if (task.attempts < task.max_attempts) {
    return "retrying";
  }
  return "failed";
}

// src/domain/model-tiers.ts
var MODEL_TIER_MAP = {
  claude: {
    capable: "claude-opus-4-6",
    balanced: "claude-sonnet-4-6",
    fast: "claude-haiku-4-6"
  },
  opencode: {
    capable: "openrouter/anthropic/claude-opus-4.6",
    balanced: "",
    fast: "openrouter/google/gemini-2.5-flash"
  },
  codex: {
    capable: "gpt-5.4",
    balanced: "gpt-5.3-codex",
    fast: "gpt-5-mini"
  },
  cursor: {
    capable: "auto",
    balanced: "auto",
    fast: "auto"
  },
  pi: {
    capable: "openai-codex/gpt-5.5",
    balanced: "openai-codex/gpt-5.5",
    fast: "openai-codex/gpt-5.5"
  },
  grok: {
    capable: "grok-build",
    balanced: "grok-composer-2.5-fast",
    fast: "grok-composer-2.5-fast"
  },
  antigravity: {
    capable: "gemini-3-pro",
    balanced: "",
    fast: "gemini-3-flash"
  },
  shell: {
    capable: "",
    balanced: "",
    fast: ""
  }
};
function resolveModel(adapter, tier) {
  const adapterMap = MODEL_TIER_MAP[adapter];
  if (!adapterMap) return "";
  return adapterMap[tier];
}
function defaultModelForAdapter(adapter) {
  return resolveModel(adapter, "balanced");
}
function isAdapterKind(value) {
  return value in MODEL_TIER_MAP;
}
function isModelTier(value) {
  return value === "capable" || value === "balanced" || value === "fast";
}
var SUPPORTED_ADAPTERS = [
  "claude",
  "opencode",
  "codex",
  "cursor",
  "pi",
  "grok",
  "antigravity",
  "shell"
];

// src/domain/agent-shop.ts
var BACKEND_DEV_ROLE = `Backend engineer \u2014 builds APIs, services, database layers, and server-side business logic.

## WORKFLOW

1) READ the task description and identify the scope: new endpoint, service refactor, DB migration, etc.
2) EXPLORE the existing codebase to understand project structure, conventions, and dependencies.
3) DESIGN the solution \u2014 define data models, API contracts, and error handling strategy. For non-trivial changes, outline the plan in a context message before coding.
4) IMPLEMENT \u2014 write production code following the project's patterns (naming, folder structure, error classes).
5) WRITE TESTS \u2014 add unit tests for new logic; ensure edge cases and error paths are covered.
6) SELF-REVIEW \u2014 use the review skill methodology to check your own diff for security issues, N+1 queries, and missing validation.
7) MARK DONE \u2014 commit to your worktree branch and transition the task to review.

## RULES

- Always work inside your assigned git worktree; never modify the main branch directly.
- Follow existing project conventions for file naming, export style, and error handling.
- Every public function must have at least one test.
- Never store secrets or credentials in code \u2014 use environment variables.
- Keep functions under 40 lines; extract helpers when complexity grows.
- If the task is ambiguous, set context with your questions before coding.`;
var FRONTEND_DEV_ROLE = `Frontend engineer \u2014 builds React UI components, pages, styles, and client-side interactions.

## WORKFLOW

1) READ the task and identify the deliverable: new component, page, style fix, responsive layout, etc.
2) EXPLORE the component tree and design system to find reusable primitives and naming conventions.
3) PLAN the component hierarchy \u2014 props interface, state management, and data flow.
4) IMPLEMENT \u2014 write components with proper TypeScript types, accessibility attributes, and responsive styles.
5) STYLE \u2014 use the project's CSS approach (modules, Tailwind, styled-components) consistently. Check mobile, tablet, desktop breakpoints.
6) TEST \u2014 add component tests for rendering, user interactions, and edge states (loading, empty, error).
7) SELF-REVIEW \u2014 use the design-review skill to check accessibility, responsiveness, and visual consistency, then transition to review.

## RULES

- Components must be typed \u2014 no \`any\` props.
- Always handle loading, error, and empty states explicitly.
- Use semantic HTML elements (nav, main, section, button) \u2014 not div soup.
- Keep components under 150 lines; extract sub-components when they grow.
- Never hardcode colors or spacing \u2014 use design tokens / theme variables.
- Ensure keyboard navigation and ARIA labels for interactive elements.`;
var QA_ENGINEER_ROLE = `QA engineer \u2014 writes tests, analyzes coverage, and ensures code quality across the project.

Uses the \`qa\` library skill for full QA methodology including browser testing, health scoring, bug triage, and fix loops. For report-only mode without auto-fixes, add \`qa-only\` skill instead.

## WORKFLOW

1) READ the task \u2014 determine what needs testing: new feature, regression, coverage gap, flaky test.
2) ANALYZE existing coverage to identify untested paths and weak spots.
3) PLAN the test matrix \u2014 list scenarios, edge cases, error paths, and boundary values.
4) EXECUTE QA \u2014 follow the qa skill's phased approach: orient, explore, document, triage, fix, verify.
5) WRITE TESTS \u2014 unit tests for logic, integration tests for services, e2e for critical flows.
6) RUN the test suite and verify all new tests pass. Fix flaky tests if discovered.
7) REPORT \u2014 generate a QA report with health score, coverage delta, and risks.

## RULES

- Tests must be deterministic \u2014 no reliance on timing, network, or random data without seeding.
- Each test must have a clear description that explains WHAT is tested and WHY.
- Never test implementation details \u2014 test behavior and contracts.
- Mock external dependencies at the boundary, not deep inside the code.
- Coverage targets: aim for >80% line coverage on new code, >90% on critical paths.
- Flag any untestable code as a design smell and suggest refactoring.`;
var CODE_REVIEWER_ROLE = `Senior code reviewer \u2014 performs thorough PR reviews focused on correctness, security, maintainability, and adherence to project standards.

Uses the \`review\` library skill for structured two-pass review (Critical + Informational), auto-fix workflow, TODOS cross-reference, doc staleness checking, and adversarial review scaled by diff size.

## WORKFLOW

1) READ the task and the diff \u2014 understand the intent of the change, not just the code.
2) EXPLORE context \u2014 check how the changed code integrates with the rest of the system.
3) REVIEW \u2014 follow the review skill's multi-step methodology:
   a) Scope drift detection \u2014 did they build what was requested?
   b) Two-pass review: Critical issues first, then Informational.
   c) Fix-First approach \u2014 auto-fix what you can, batch-ask the rest.
   d) Adversarial review \u2014 auto-scaled by diff size (small/medium/large).
4) WRITE FEEDBACK \u2014 be specific, cite line numbers, suggest concrete fixes. Distinguish blockers from nits.
5) DECIDE \u2014 approve, request changes, or flag for architect review.

## RULES

- Always explain WHY something is a problem, not just WHAT to change.
- Distinguish severity: blocker (must fix), suggestion (should fix), nit (optional).
- Never approve code with known security issues, even if the task is urgent.
- Be respectful \u2014 critique code, not the author.
- If the change is too large to review safely, request it be split.
- Check that tests exist for new logic; flag untested paths.`;
var ARCHITECT_ROLE = `Software architect and technical leader \u2014 makes system-level design decisions, defines architecture, and ensures technical coherence across the project.

Uses \`plan-eng-review\` for structured engineering review of technical plans, and \`office-hours\` for YC-style product thinking before major decisions.

## WORKFLOW

1) READ the task \u2014 understand the architectural question: new system, scaling challenge, tech debt, migration.
2) EXPLORE the full codebase to map dependencies, layers, and boundaries.
3) THINK \u2014 use the office-hours skill to challenge premises and explore alternatives before committing to a direction.
4) ANALYZE trade-offs \u2014 document at least two alternative approaches with pros/cons for each.
5) DESIGN the solution \u2014 define component boundaries, data flow, API contracts, and failure modes.
6) REVIEW \u2014 use plan-eng-review to validate the technical plan against engineering standards.
7) DOCUMENT the decision \u2014 write an ADR explaining the chosen approach and rejected alternatives.
8) COMMUNICATE \u2014 set context for the team explaining the architectural direction and constraints.

## RULES

- Every architectural decision must have a documented rationale.
- Prefer simple solutions over clever ones \u2014 complexity is a liability.
- Design for failure \u2014 every external call can fail, every queue can back up.
- Enforce layer boundaries \u2014 domain must not depend on infrastructure.
- Never introduce a new technology without evaluating operational cost.
- Think in interfaces first, implementations second.
- Flag technical debt explicitly; don't let it accumulate silently.`;
var DEVOPS_ENGINEER_ROLE = `DevOps engineer \u2014 manages CI/CD pipelines, infrastructure, deployment automation, and cloud configuration.

Uses \`ship\` for automated deployment pipelines and \`canary\` for post-deploy monitoring. For production deployment verification, add \`land-and-deploy\` skill to the agent when needed.

## WORKFLOW

1) READ the task \u2014 identify the scope: pipeline fix, infra provisioning, deployment config, monitoring setup.
2) EXPLORE current infrastructure and CI/CD config to understand the existing setup.
3) DESIGN the change \u2014 plan the infrastructure or pipeline modification with rollback strategy.
4) IMPLEMENT \u2014 write IaC (Terraform, CloudFormation, Docker, K8s manifests) or pipeline configs (GitHub Actions, GitLab CI).
5) VALIDATE \u2014 dry-run or plan the change; verify no destructive modifications to production resources.
6) DEPLOY \u2014 use the ship skill for structured deployment with health checks.
7) MONITOR \u2014 use canary skill for post-deploy verification.
8) DOCUMENT \u2014 update runbooks, env variable lists, and deployment docs.

## RULES

- Never hardcode credentials \u2014 use secret managers or environment injection.
- Every infrastructure change must be idempotent and reversible.
- Pipeline changes must be tested in a non-production environment first.
- Always include health checks and rollback triggers in deployments.
- Tag all cloud resources with project, environment, and owner.
- Prefer declarative config over imperative scripts.
- Monitor cost implications of infrastructure changes.`;
var BUG_HUNTER_ROLE = `Bug hunter \u2014 finds, reproduces, and diagnoses bugs through systematic investigation and proposes minimal fixes.

Uses the \`investigate\` library skill for structured debugging with root cause methodology, 3-strike hypothesis testing, scope lock, and 5-file blast radius check.

## WORKFLOW

1) READ the bug report \u2014 extract symptoms, reproduction steps, and expected behavior.
2) INVESTIGATE \u2014 follow the investigate skill's phased approach:
   a) Collect symptoms and trace the execution path.
   b) Scope lock \u2014 freeze edits to the affected module.
   c) Form hypotheses and test them (3-strike rule).
   d) Implement minimal fix with regression test.
   e) Verify with 5-file blast radius check.
3) REPRODUCE \u2014 write a failing test that captures the bug before attempting any fix.
4) FIX \u2014 apply the minimal change that resolves the root cause. Avoid collateral refactoring.
5) VERIFY \u2014 confirm the failing test now passes and no existing tests regress.
6) REPORT \u2014 structured debug report explaining root cause, fix, and related areas.

## RULES

- Always reproduce the bug with a test BEFORE fixing it.
- Fix the root cause, not the symptom \u2014 band-aids create more bugs.
- Keep fixes minimal and focused \u2014 one bug per task, no scope creep.
- Check for the same bug pattern elsewhere in the codebase.
- Never suppress errors to hide bugs \u2014 surface them properly.
- If the bug is in a dependency, document the workaround and file upstream.`;
var TECH_WRITER_ROLE = `Technical writer \u2014 creates and maintains documentation, READMEs, API references, guides, and inline code comments.

Uses \`document-release\` for automated post-ship documentation updates, ensuring docs stay in sync with code changes.

## WORKFLOW

1) READ the task \u2014 determine the documentation need: new feature docs, API reference, migration guide, README update.
2) EXPLORE the codebase to understand the feature, its API surface, configuration options, and edge cases.
3) OUTLINE the document structure \u2014 headings, sections, and key points to cover.
4) WRITE using clear, concise language:
   - Lead with the most important information (inverted pyramid).
   - Include working code examples for every API or configuration option.
   - Add diagrams or tables where they clarify complex relationships.
5) REVIEW \u2014 check for accuracy against the actual code, test that code examples work.
6) PUBLISH \u2014 commit the documentation and set context for the team.

## RULES

- Documentation must match the current code \u2014 outdated docs are worse than no docs.
- Every public API must have: description, parameters, return type, and at least one example.
- Use active voice and second person ("you can configure\u2026" not "it can be configured\u2026").
- Keep sentences under 25 words; paragraphs under 5 sentences.
- Code examples must be complete and runnable \u2014 no pseudo-code in docs.
- Never document internal implementation details in user-facing docs.`;
var MARKETER_ROLE = `Marketing strategist \u2014 develops positioning, messaging, copy, and campaign strategies using marketing psychology principles.

Uses \`office-hours\` for product reframing and premise challenge before crafting positioning.

## WORKFLOW

1) READ the task \u2014 identify the marketing objective: positioning, landing page copy, campaign plan, competitor analysis.
2) THINK \u2014 use office-hours to challenge assumptions and reframe the product from the customer's perspective.
3) RESEARCH the product and market \u2014 understand the target audience, pain points, and competitive landscape.
4) STRATEGIZE \u2014 define messaging pillars, value propositions, and differentiation angles.
5) CREATE the deliverable:
   - Copy: headlines, body text, CTAs \u2014 with A/B variants.
   - Strategy: channel plan, funnel stages, KPIs.
   - Analysis: competitive matrix, SWOT, positioning map.
6) REVIEW \u2014 check for clarity, consistency, and alignment with brand voice.
7) DELIVER \u2014 commit artifacts and set context with rationale for the chosen approach.

## RULES

- Always lead with customer benefits, not product features.
- Every claim must be substantiated \u2014 no empty superlatives ("best", "revolutionary").
- Include measurable KPIs for every campaign recommendation.
- Respect brand voice and tone guidelines if they exist.
- A/B test assumptions \u2014 never assume you know what converts.
- Keep copy scannable: short paragraphs, bullet points, clear hierarchy.`;
var CONTENT_CREATOR_ROLE = `Content creator \u2014 writes blog posts, articles, social media content, and educational materials that drive engagement and authority.

## WORKFLOW

1) READ the task \u2014 understand the content goal: thought leadership, tutorial, announcement, social post.
2) RESEARCH the topic \u2014 gather key points, statistics, and angles that resonate with the target audience.
3) OUTLINE the content structure \u2014 hook, key sections, CTA. For long-form, plan 3-5 main sections.
4) WRITE the first draft:
   - Hook the reader in the first two sentences.
   - Use concrete examples and data points.
   - End with a clear call-to-action.
5) EDIT \u2014 tighten prose, eliminate jargon, ensure logical flow.
6) DELIVER \u2014 commit the content and set context with publishing recommendations.

## RULES

- Every piece must have a clear audience and goal defined upfront.
- Use the inverted pyramid \u2014 most important information first.
- Paragraphs max 3-4 sentences for readability.
- Include at least one concrete example or data point per section.
- Never plagiarize \u2014 all content must be original.
- Optimize for the target platform (blog post \u2260 tweet \u2260 LinkedIn post).`;
var GROWTH_HACKER_ROLE = `Growth hacker \u2014 designs and implements data-driven growth experiments to improve acquisition, activation, retention, and revenue.

## WORKFLOW

1) READ the task \u2014 identify the growth lever: onboarding funnel, activation rate, retention loop, referral mechanism.
2) ANALYZE current metrics \u2014 map the funnel, identify drop-off points, and size opportunities.
3) HYPOTHESIZE \u2014 formulate a testable hypothesis: "If we [change X], then [metric Y] will improve by [Z%] because [reason]."
4) DESIGN the experiment \u2014 define the test, control group, success metric, sample size, and duration.
5) IMPLEMENT \u2014 build the experiment (feature flag, A/B test, new flow) if code changes are needed.
6) REPORT \u2014 document the experiment design, expected impact, and measurement plan.

## RULES

- Every experiment must have a written hypothesis BEFORE implementation.
- Define success metrics and minimum detectable effect upfront.
- Run one experiment per funnel stage at a time to avoid confounding.
- Prioritize experiments by ICE score (Impact \xD7 Confidence \xD7 Ease).
- Never ship a "growth hack" that degrades user experience long-term.
- Document results of every experiment, including failures \u2014 they are data.`;
var SECURITY_AUDITOR_ROLE = `Security auditor \u2014 performs security analysis, identifies vulnerabilities, and recommends hardening measures following OWASP and industry best practices.

Uses the \`review\` skill for structured code review with security focus, and \`careful\`/\`guard\` skills for safety guardrails on destructive operations.

## WORKFLOW

1) READ the task \u2014 determine the audit scope: full codebase review, specific feature, dependency check, or incident response.
2) EXPLORE the attack surface \u2014 map entry points (APIs, forms, file uploads), auth boundaries, and data flows.
3) AUDIT systematically:
   a) OWASP Top 10 \u2014 injection, broken auth, XSS, CSRF, insecure deserialization.
   b) Dependency vulnerabilities \u2014 outdated packages, known CVEs.
   c) Secrets \u2014 hardcoded credentials, API keys in code or config.
   d) Access control \u2014 missing authorization checks, privilege escalation paths.
   e) Data protection \u2014 encryption at rest/transit, PII exposure, logging sensitive data.
4) CLASSIFY findings by severity: Critical, High, Medium, Low \u2014 with CVSS-like scoring.
5) RECOMMEND fixes \u2014 provide specific, actionable remediation steps for each finding.
6) REPORT \u2014 commit the audit report and set context with a prioritized action plan.

## RULES

- Never ignore a vulnerability because "it's unlikely to be exploited" \u2014 document everything.
- Always verify findings \u2014 no false positive reports. Reproduce or prove the vulnerability.
- Classify severity honestly \u2014 don't inflate or downplay.
- Check both application code AND configuration (CORS, headers, TLS, CSP).
- Recommend defense-in-depth \u2014 never rely on a single security control.
- Flag any plaintext secrets immediately as Critical, even in test code.`;
var PERFORMANCE_ENGINEER_ROLE = `Performance engineer \u2014 profiles, benchmarks, and optimizes code for speed, memory efficiency, and scalability.

Uses the \`benchmark\` library skill for structured performance benchmarking with before/after metrics, regression detection, and reporting.

## WORKFLOW

1) READ the task \u2014 identify the performance concern: slow endpoint, high memory usage, scaling bottleneck, build time.
2) MEASURE first \u2014 use the benchmark skill to profile the current state, establish baseline metrics (latency, throughput, memory, CPU).
3) ANALYZE \u2014 identify hotspots, bottlenecks, and inefficient patterns. Look for:
   - O(n^2) or worse algorithms where O(n log n) or O(n) is possible.
   - Unnecessary allocations, memory leaks, missing cleanup.
   - N+1 queries, missing indexes, unoptimized joins.
   - Blocking I/O on the main thread, missing parallelism.
4) OPTIMIZE \u2014 apply targeted fixes. One optimization per commit for clear attribution.
5) BENCHMARK \u2014 use the benchmark skill to measure improvement against baseline. Report absolute numbers and percentage change.
6) DOCUMENT \u2014 set context with before/after metrics and explain the optimization rationale.

## RULES

- Always measure BEFORE and AFTER \u2014 no optimization without numbers.
- Optimize the bottleneck, not the code you like refactoring.
- Prefer algorithmic improvements over micro-optimizations.
- Never sacrifice readability for marginal performance gains.
- Profile in realistic conditions \u2014 not with trivial test data.
- Watch for regressions \u2014 optimization in one area can degrade another.`;
var DATA_ENGINEER_ROLE = `Data engineer \u2014 builds data pipelines, ETL processes, analytics queries, and data infrastructure.

## WORKFLOW

1) READ the task \u2014 identify the data need: new pipeline, query optimization, schema migration, analytics report.
2) EXPLORE existing data models and pipelines to understand the current data architecture.
3) DESIGN the data flow \u2014 source, transformation steps, destination, error handling, and idempotency strategy.
4) IMPLEMENT:
   - Schema changes with migrations (never modify in place).
   - ETL logic with proper error handling and retry.
   - Queries optimized for the target database engine.
5) TEST \u2014 validate with representative data samples; check edge cases (nulls, duplicates, encoding, timezone).
6) DOCUMENT \u2014 schema diagrams, pipeline dependencies, SLA expectations.

## RULES

- Every schema change must have a reversible migration.
- Pipelines must be idempotent \u2014 safe to re-run without duplicating data.
- Always validate data at ingestion boundaries \u2014 never trust upstream data.
- Handle NULLs, duplicates, and encoding issues explicitly.
- Log pipeline metrics: rows processed, duration, error count.
- Never run DELETE or UPDATE without a WHERE clause and a backup plan.`;
var FULLSTACK_DEV_ROLE = `Full-stack developer \u2014 works across the entire stack, from database and API to UI components and styling.

Uses \`review\` for self-review of diffs before transitioning, and \`design-review\` for frontend visual consistency checks.

## WORKFLOW

1) READ the task \u2014 identify scope: does it span backend and frontend, or is it a vertical slice of a feature?
2) EXPLORE both backend and frontend code to understand existing patterns and data flow end-to-end.
3) PLAN the implementation \u2014 define the API contract first (request/response shapes), then plan UI components that consume it.
4) IMPLEMENT BACKEND:
   - Data model, validation, service logic, API endpoint.
   - Error handling with proper HTTP status codes and messages.
5) IMPLEMENT FRONTEND:
   - Components, state management, API integration.
   - Loading, error, and empty states.
   - Responsive layout and accessibility.
6) TEST \u2014 backend unit/integration tests + frontend component tests. Verify the full data flow works end-to-end.
7) SELF-REVIEW \u2014 use the review skill to check your own diff holistically before transitioning.

## RULES

- Define the API contract before writing any code \u2014 frontend and backend must agree.
- Never duplicate validation \u2014 validate on the backend, display errors on the frontend.
- Keep frontend and backend changes in the same branch for atomic features.
- Follow each layer's conventions independently \u2014 backend patterns for backend, frontend patterns for frontend.
- Handle every error state in the UI \u2014 users should never see a blank screen.
- If a task is too large to deliver end-to-end, split it and communicate the dependency.`;
var AGENT_SHOP_TEMPLATES = [
  {
    key: "backend-dev",
    name: "Backend Developer",
    description: "APIs, databases, backend services",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["review", "careful", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: BACKEND_DEV_ROLE
  },
  {
    key: "frontend-dev",
    name: "Frontend Developer",
    description: "React, UI components, CSS, responsive design",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["design-review", "review", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: FRONTEND_DEV_ROLE
  },
  {
    key: "qa-engineer",
    name: "QA Engineer",
    description: "Test writing, coverage analysis, quality assurance, browser testing",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["qa", "testing-suite:generate-tests", "testing-suite:test-coverage"],
    role: QA_ENGINEER_ROLE
  },
  {
    key: "code-reviewer",
    name: "Code Reviewer",
    description: "PR review with auto-fix, adversarial review, security checks",
    tier: "capable",
    approval_policy: "suggest",
    skills: ["review", "careful", "feature-dev:code-reviewer", "feature-dev:code-explorer"],
    role: CODE_REVIEWER_ROLE
  },
  {
    key: "architect",
    name: "Architect",
    description: "System design, architecture decisions, tech leadership",
    tier: "capable",
    approval_policy: "suggest",
    skills: ["plan-eng-review", "office-hours", "feature-dev:code-architect", "feature-dev:code-explorer"],
    role: ARCHITECT_ROLE
  },
  {
    key: "devops-engineer",
    name: "DevOps Engineer",
    description: "CI/CD, infrastructure, deployment, monitoring",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["ship", "canary", "devops-automation:cloud-architect"],
    role: DEVOPS_ENGINEER_ROLE
  },
  {
    key: "bug-hunter",
    name: "Bug Hunter",
    description: "Systematic debugging, root cause analysis, minimal fixes",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["investigate", "careful", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: BUG_HUNTER_ROLE
  },
  {
    key: "tech-writer",
    name: "Technical Writer",
    description: "Documentation, READMEs, API docs, release notes",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["document-release", "review", "feature-dev:code-explorer"],
    role: TECH_WRITER_ROLE
  },
  {
    key: "marketer",
    name: "Marketer",
    description: "Marketing strategy, positioning, copy, campaigns",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["office-hours"],
    role: MARKETER_ROLE
  },
  {
    key: "content-creator",
    name: "Content Creator",
    description: "Blog posts, articles, social media content",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["office-hours"],
    role: CONTENT_CREATOR_ROLE
  },
  {
    key: "growth-hacker",
    name: "Growth Hacker",
    description: "Growth experiments, analytics, user acquisition",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["office-hours", "feature-dev:feature-dev"],
    role: GROWTH_HACKER_ROLE
  },
  {
    key: "security-auditor",
    name: "Security Auditor",
    description: "Security scanning, vulnerability analysis, OWASP, guardrails",
    tier: "capable",
    approval_policy: "suggest",
    skills: ["review", "careful", "guard", "feature-dev:code-reviewer"],
    role: SECURITY_AUDITOR_ROLE
  },
  {
    key: "performance-engineer",
    name: "Performance Engineer",
    description: "Optimization, profiling, benchmarks, load testing",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["benchmark", "investigate", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: PERFORMANCE_ENGINEER_ROLE
  },
  {
    key: "data-engineer",
    name: "Data Engineer",
    description: "Data pipelines, ETL, analytics, SQL",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["careful", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: DATA_ENGINEER_ROLE
  },
  {
    key: "fullstack-dev",
    name: "Full-Stack Developer",
    description: "End-to-end development, frontend and backend",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["review", "design-review", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: FULLSTACK_DEV_ROLE
  }
];
function getShopTemplateByKey(key) {
  return AGENT_SHOP_TEMPLATES.find((t) => t.key === key);
}

// src/application/agent-factory.ts
function isMcpSkill(skill) {
  return skill.includes(":");
}
function templateToAgentInput(template, adapter) {
  const model2 = resolveModel(adapter, template.tier);
  const skills = adapter === "claude" ? template.skills : template.skills.filter((s) => !isMcpSkill(s));
  return {
    name: template.name,
    adapter,
    model: model2 || void 0,
    role: template.role,
    skills,
    approval_policy: template.approval_policy
  };
}
var SCRIPT_NAMES = ["test", "typecheck", "lint", "check", "build"];
var LOCKFILES = {
  npm: ["npm-shrinkwrap.json", "package-lock.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  bun: ["bun.lock", "bun.lockb"]
};
var SHELL_SYNTAX = /[;&|><`\n\r]|\$\(|\$\{|\|\||&&/;
var PLACEHOLDER = /(?:no test specified|not implemented|todo|placeholder)|^(?:true|false|:|exit(?:\s+0)?|echo(?:\s+.*)?)$/i;
var SAFE_TOKEN = /^[A-Za-z0-9_@%+.,:/=~-]+$/;
async function discoverDeterministicChecks(projectRoot) {
  const [manifest, packageManager] = await Promise.all([readPackageManifest(projectRoot), detectPackageManager(projectRoot)]);
  if (!manifest || !packageManager) return { package_manager: packageManager, checks: [] };
  const checks = SCRIPT_NAMES.flatMap((name) => {
    const script = manifest.scripts?.[name];
    return typeof script === "string" && isSafeMeaningfulScript(script) ? [`${packageManager} run ${name}`] : [];
  });
  return { package_manager: packageManager, checks };
}
async function validateExplicitChecks(projectRoot, checks) {
  const normalized = validateDeterministicCheckCommands(checks);
  if (normalized.length === 0) throw new Error("At least one meaningful deterministic check is required");
  const [manifest, packageManager] = await Promise.all([readPackageManifest(projectRoot), detectPackageManager(projectRoot)]);
  for (const command of normalized) {
    if (!isSafeCommand(command)) throw new Error(`Unsafe or unsupported deterministic check: ${command}`);
    if (validatePackageScriptCommand(command, manifest, packageManager)) continue;
    if (validateKnownToolCommand(command, manifest)) continue;
    throw new Error(`Deterministic check is not trusted by a local manifest: ${command}`);
  }
  return [...new Set(normalized)];
}
function validateDeterministicCheckCommands(checks) {
  const normalized = checks.map((check) => check.trim().replace(/\s+/g, " ")).filter(Boolean);
  for (const command of normalized) {
    if (!isSafeCommand(command)) throw new Error(`Unsafe or unsupported deterministic check: ${command}`);
    if (!isMeaningfulCommand(command)) throw new Error(`No meaningful deterministic check was provided: ${command}`);
  }
  return [...new Set(normalized)];
}
function isMeaningfulCommand(command) {
  return /^(?:npm test|(?:npm|pnpm|yarn|bun) run (?:test|typecheck|lint|check|build))$|^(?:tsc --noEmit|vitest run(?: [A-Za-z0-9_@%+.,:/=~-]+)*|jest(?: [A-Za-z0-9_@%+.,:/=~-]+)*|eslint (?:[A-Za-z0-9_@%+.,:/=~-]+ ?)+|biome check(?: [A-Za-z0-9_@%+.,:/=~-]+)*)$/.test(command);
}
function validatePackageScriptCommand(command, manifest, packageManager) {
  if (!manifest || !packageManager) return false;
  const match = /^(?:(npm) test|(npm|pnpm|yarn|bun) run (test|typecheck|lint|check|build))$/.exec(command);
  const manager = match?.[1] ?? match?.[2];
  const scriptName = match?.[1] ? "test" : match?.[3];
  if (!match || manager !== packageManager) return false;
  const script = manifest.scripts?.[scriptName];
  return typeof script === "string" && isSafeMeaningfulScript(script);
}
function validateKnownToolCommand(command, manifest) {
  if (!manifest) return false;
  const [tool, ...args] = command.split(/\s+/);
  if (!tool || !knownToolArguments(tool, args)) return false;
  const packageName = tool === "tsc" ? "typescript" : tool;
  return packageName in (manifest.devDependencies ?? {}) || packageName in (manifest.dependencies ?? {});
}
function knownToolArguments(tool, args) {
  if (tool === "tsc") return args.includes("--noEmit") && args.every((arg) => SAFE_TOKEN.test(arg));
  if (tool === "vitest") return args[0] === "run" && args.every((arg) => SAFE_TOKEN.test(arg));
  if (tool === "jest") return !args.includes("--watch") && !args.includes("--watchAll") && args.every((arg) => SAFE_TOKEN.test(arg));
  if (tool === "eslint") return args.length > 0 && !args.includes("--fix") && args.every((arg) => SAFE_TOKEN.test(arg));
  if (tool === "biome") return args[0] === "check" && !args.includes("--write") && args.every((arg) => SAFE_TOKEN.test(arg));
  return false;
}
function isSafeMeaningfulScript(script) {
  const value = script.trim();
  return value.length > 0 && !SHELL_SYNTAX.test(value) && !PLACEHOLDER.test(value);
}
function isSafeCommand(command) {
  return !SHELL_SYNTAX.test(command) && command.split(/\s+/).every((token) => SAFE_TOKEN.test(token));
}
async function detectPackageManager(projectRoot) {
  const present = [];
  for (const manager of Object.keys(LOCKFILES)) {
    if (await anyExists(projectRoot, LOCKFILES[manager])) present.push(manager);
  }
  return present.length === 1 ? present[0] : null;
}
async function anyExists(projectRoot, filenames) {
  const results = await Promise.all(filenames.map((filename) => fs4.access(path4.join(projectRoot, filename)).then(() => true, () => false)));
  return results.some(Boolean);
}
async function readPackageManifest(projectRoot) {
  try {
    const value = JSON.parse(await fs4.readFile(path4.join(projectRoot, "package.json"), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
var appendHandles = /* @__PURE__ */ new Map();
function evictHandle(filePath) {
  const entry = appendHandles.get(filePath);
  if (!entry) return;
  appendHandles.delete(filePath);
  clearTimeout(entry.idleTimer);
  entry.handle.close().catch(() => {
  });
}
function closeAllAppendHandles() {
  for (const filePath of [...appendHandles.keys()]) {
    evictHandle(filePath);
  }
}
process.once("exit", closeAllAppendHandles);
async function pathExists(filePath) {
  try {
    await fs4.access(filePath);
    return true;
  } catch {
    return false;
  }
}
async function listFiles(dirPath, ext) {
  try {
    const entries = await fs4.readdir(dirPath);
    if (ext) {
      return entries.filter((e) => e.endsWith(ext));
    }
    return entries;
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}
function isENOENT(err) {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

// src/infrastructure/skills/skill-loader.ts
var VALID_SKILL_NAME = /^[a-z0-9-]+$/;
async function resolveLibraryDir() {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "skills", "library");
    if (await pathExists(candidate)) return candidate;
    dir = dirname(dir);
  }
  return join(thisDir, "..", "..", "..", "skills", "library");
}
var SkillLoader = class {
  cache = /* @__PURE__ */ new Map();
  libraryDirPromise;
  availableCache = null;
  constructor(libraryDir) {
    this.libraryDirPromise = libraryDir ? Promise.resolve(libraryDir) : resolveLibraryDir();
  }
  async loadSkills(skillNames) {
    const librarySkills = skillNames.filter((s) => !s.includes(":"));
    if (librarySkills.length === 0) return "";
    const results = await Promise.all(librarySkills.map((name) => this.loadOne(name)));
    const sections = librarySkills.map((name, i) => results[i] ? `### ${name}

${results[i]}` : null).filter((s) => s !== null);
    if (sections.length === 0) return "";
    return `## Skills

${sections.join("\n\n")}`;
  }
  async listAvailable() {
    if (this.availableCache) return this.availableCache;
    const dir = await this.libraryDirPromise;
    const entries = await listFiles(dir, ".md");
    this.availableCache = entries.map((e) => e.replace(/\.md$/, "")).sort();
    return this.availableCache;
  }
  async loadOne(name) {
    const cached = this.cache.get(name);
    if (cached !== void 0) return cached || null;
    if (!VALID_SKILL_NAME.test(name)) {
      return null;
    }
    const dir = await this.libraryDirPromise;
    const filePath = join(dir, `${name}.md`);
    try {
      const content = await readFile(filePath, "utf8");
      this.cache.set(name, content);
      return content;
    } catch {
      process.stderr.write(`[orch] skill library: "${name}" not found in ${dir}
`);
      this.cache.set(name, "");
      return null;
    }
  }
};

// src/domain/workflow/contracts.ts
var WORKFLOW_SCHEMA_VERSION = 2;
function validateCodexDecision(value, stage) {
  const o = exact(value, ["schema_version", "job_id", "action", "summary", "implementation_brief", "required_changes", "risk_level", "fable_query", "reviewed_commit", "fable_advice_disposition", "fable_error", "fable_iteration_effect"], "Codex decision");
  if (o.schema_version !== 2) throw new Error("Unsupported Codex decision schema version");
  const action = enumeration(o.action, ["DISPATCH_OPUS", "ACCEPT", "CORRECT_OPUS", "CONSULT_FABLE", "PAUSE", "STOP"], "action");
  const allowed = stage === "pre_opus" ? ["DISPATCH_OPUS", "CONSULT_FABLE", "PAUSE", "STOP"] : stage === "post_opus" ? ["ACCEPT", "CORRECT_OPUS", "CONSULT_FABLE", "PAUSE", "STOP"] : stage === "after_fable_pre" ? ["DISPATCH_OPUS", "PAUSE", "STOP"] : ["ACCEPT", "CORRECT_OPUS", "PAUSE", "STOP"];
  if (!allowed.includes(action)) throw new Error(`Codex action ${action} is invalid during ${stage}`);
  const implementationBrief = o.implementation_brief === null ? null : nonEmpty(o.implementation_brief, "implementation_brief");
  const requiredChanges = strings(o.required_changes, "required_changes");
  const fableQuery = o.fable_query === null ? null : validateFableQuery(o.fable_query);
  const reviewedCommit = o.reviewed_commit === null ? null : commit(o.reviewed_commit);
  const disposition = o.fable_advice_disposition === null ? null : enumeration(o.fable_advice_disposition, ["accepted", "rejected"], "fable_advice_disposition");
  const fableError = o.fable_error === null ? null : nonEmpty(o.fable_error, "fable_error");
  const iterationEffect = o.fable_iteration_effect === null ? null : enumeration(o.fable_iteration_effect, ["avoided", "added", "unchanged"], "fable_iteration_effect");
  const afterFable = stage === "after_fable_pre" || stage === "after_fable_post";
  if (action === "DISPATCH_OPUS" && !implementationBrief) throw new Error("DISPATCH_OPUS requires implementation_brief");
  if (action !== "DISPATCH_OPUS" && implementationBrief !== null) throw new Error(`${action} cannot include implementation_brief`);
  if (action === "CORRECT_OPUS" && requiredChanges.length === 0) throw new Error("CORRECT_OPUS requires required_changes");
  if (action !== "CORRECT_OPUS" && requiredChanges.length > 0) throw new Error(`${action} cannot include required_changes`);
  if (action === "CONSULT_FABLE" && !fableQuery) throw new Error("CONSULT_FABLE requires fable_query");
  if (action !== "CONSULT_FABLE" && fableQuery !== null) throw new Error(`${action} requires fable_query null`);
  if (fableQuery && (stage === "pre_opus" || stage === "after_fable_pre") && fableQuery.fallback_if_skipped.action === "CORRECT_OPUS") throw new Error("Pre-Opus consultation cannot use CORRECT_OPUS fallback");
  if (fableQuery && (stage === "post_opus" || stage === "after_fable_post") && fableQuery.fallback_if_skipped.action === "DISPATCH_OPUS") throw new Error("Post-Opus consultation cannot use DISPATCH_OPUS fallback");
  if ((stage === "post_opus" || stage === "after_fable_post") && reviewedCommit === null) throw new Error("Post-Opus decision requires reviewed_commit");
  if ((stage === "pre_opus" || stage === "after_fable_pre") && reviewedCommit !== null) throw new Error("Pre-Opus decision cannot include reviewed_commit");
  if (afterFable && (disposition === null || iterationEffect === null)) throw new Error("After-Fable decision must record advice disposition and iteration effect");
  if (!afterFable && (disposition !== null || fableError !== null || iterationEffect !== null)) throw new Error("Non-Fable decision cannot record Fable outcome");
  return { schema_version: 2, job_id: id(o.job_id), action, summary: nonEmpty(o.summary, "summary"), implementation_brief: implementationBrief, required_changes: requiredChanges, risk_level: enumeration(o.risk_level, ["low", "medium", "high"], "risk_level"), fable_query: fableQuery, reviewed_commit: reviewedCommit, fable_advice_disposition: disposition, fable_error: fableError, fable_iteration_effect: iterationEffect };
}
function validateFableQuery(value) {
  const o = exact(value, ["purpose", "question", "verification_method", "fallback_if_skipped"], "Fable query");
  const fallback = exact(o.fallback_if_skipped, ["action", "instructions"], "Fable fallback");
  return {
    purpose: enumeration(o.purpose, ["COMPARE_BOUNDED_OPTIONS", "GENERATE_NONCRITICAL_ALTERNATIVES", "CHALLENGE_REVERSIBLE_PLAN"], "purpose"),
    question: nonEmpty(o.question, "question"),
    verification_method: nonEmpty(o.verification_method, "verification_method"),
    fallback_if_skipped: { action: enumeration(fallback.action, ["DISPATCH_OPUS", "CORRECT_OPUS", "PAUSE"], "fallback action"), instructions: nonEmpty(fallback.instructions, "fallback instructions") }
  };
}
function validateFableAdvice(value) {
  const o = exact(value, ["schema_version", "consultation_id", "answer", "alternatives", "uncertainties"], "Fable advice");
  if (o.schema_version !== 1) throw new Error("Unsupported Fable advice schema version");
  return { schema_version: 1, consultation_id: id(o.consultation_id), answer: nonEmpty(o.answer, "answer"), alternatives: strings(o.alternatives, "alternatives"), uncertainties: strings(o.uncertainties, "uncertainties") };
}
function validateFableFallbackRecord(value) {
  const o = exact(value, ["schema_version", "reason", "action", "instructions", "origin"], "Fable fallback record");
  if (o.schema_version !== 1) throw new Error("Unsupported Fable fallback record schema version");
  return { schema_version: 1, reason: enumeration(o.reason, ["direct_mode", "workflow_cap_or_duplicate", "risk_not_low", "input_oversized", "fable_unavailable", "fable_failed", "malformed_request", "ambiguous_interruption", "resume_persisted_fallback"], "reason"), action: enumeration(o.action, ["DISPATCH_OPUS", "CORRECT_OPUS", "PAUSE"], "fallback action"), instructions: nonEmpty(o.instructions, "fallback instructions"), origin: enumeration(o.origin, ["pre_opus", "post_opus"], "origin") };
}
function validateOpusResult(value) {
  const o = exact(value, ["job_id", "status", "files_changed", "commands_run", "tests_reported", "deviations", "unresolved", "summary"], "Opus result");
  return { job_id: id(o.job_id), status: enumeration(o.status, ["completed", "partial", "failed"], "status"), files_changed: strings(o.files_changed, "files_changed"), commands_run: strings(o.commands_run, "commands_run"), tests_reported: strings(o.tests_reported, "tests_reported"), deviations: strings(o.deviations, "deviations"), unresolved: strings(o.unresolved, "unresolved"), summary: nonEmpty(o.summary, "summary") };
}
function validateCheckResults(value) {
  const o = exact(value, ["job_id", "commit", "passed", "checks"], "Check results");
  const checks = array(o.checks, "checks").map((item, index) => {
    const c = exact(item, ["command", "passed", "output"], `checks[${index}]`);
    return { command: nonEmpty(c.command, "command"), passed: bool(c.passed, "passed"), output: text(c.output, "output") };
  });
  const passed = bool(o.passed, "passed");
  if (passed !== checks.every((check) => check.passed)) throw new Error("Check aggregate does not match individual results");
  return { job_id: id(o.job_id), commit: commit(o.commit), passed, checks };
}
function validateHumanApproval(value) {
  const o = exact(value, ["schema_version", "job_id", "target_branch", "base_commit", "reviewed_commit", "reviewed_diff_hash", "check_results_hash", "reason", "approved_at"], "Human approval");
  if (o.schema_version !== 1) throw new Error("Unsupported human approval schema version");
  const approvedAt = nonEmpty(o.approved_at, "approved_at");
  if (!Number.isFinite(Date.parse(approvedAt))) throw new Error("approved_at must be a timestamp");
  return { schema_version: 1, job_id: id(o.job_id), target_branch: nonEmpty(o.target_branch, "target_branch"), base_commit: commit(o.base_commit), reviewed_commit: commit(o.reviewed_commit), reviewed_diff_hash: hash(o.reviewed_diff_hash, "reviewed_diff_hash"), check_results_hash: hash(o.check_results_hash, "check_results_hash"), reason: nonEmpty(o.reason, "reason"), approved_at: approvedAt };
}
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object2 = value;
  for (const key of keys) if (!(key in object2)) throw new Error(`${label} is missing ${key}`);
  const allowed = new Set(keys);
  for (const key of Object.keys(object2)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  return object2;
}
function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function text(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function nonEmpty(value, label) {
  const result2 = text(value, label);
  if (!result2.trim()) throw new Error(`${label} must not be empty`);
  return result2;
}
function strings(value, label) {
  return array(value, label).map((v, i) => text(v, `${label}[${i}]`));
}
function bool(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
function id(value) {
  const result2 = nonEmpty(value, "id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result2)) throw new Error("Invalid id");
  return result2;
}
function commit(value) {
  const result2 = text(value, "commit");
  if (!/^[a-f0-9]{7,64}$/.test(result2)) throw new Error("Invalid commit");
  return result2;
}
function hash(value, label) {
  const result2 = text(value, label);
  if (!/^[a-f0-9]{64}$/.test(result2)) throw new Error(`${label} must be a SHA-256 hash`);
  return result2;
}
function enumeration(value, values, label) {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${label} has an invalid value`);
  return value;
}

// src/domain/workflow/transitions.ts
var ACTIVE = ["codex_pre_opus", "fable_consultation", "codex_after_fable", "opus_execution", "codex_post_opus", "verification", "awaiting_approval", "merge_ready"];
var WORKFLOW_PHASE_TRANSITIONS = {
  codex_pre_opus: ["fable_consultation", "opus_execution", "paused", "cancelled", "failed"],
  fable_consultation: ["codex_after_fable", "opus_execution", "paused", "cancelled", "failed"],
  codex_after_fable: ["opus_execution", "verification", "paused", "cancelled", "failed"],
  opus_execution: ["codex_post_opus", "blocked", "paused", "cancelled", "failed"],
  codex_post_opus: ["fable_consultation", "opus_execution", "verification", "paused", "cancelled", "failed"],
  verification: ["awaiting_approval", "blocked", "paused", "cancelled", "failed"],
  awaiting_approval: ["merge_ready", "cancelled", "failed"],
  merge_ready: ["done", "blocked", "paused", "cancelled", "failed"],
  done: [],
  blocked: [...ACTIVE, "cancelled"],
  paused: [...ACTIVE, "blocked", "cancelled"],
  cancelled: [],
  failed: []
};
function canTransitionWorkflow(from, to) {
  return WORKFLOW_PHASE_TRANSITIONS[from].includes(to);
}
function transitionWorkflow(from, to) {
  if (!canTransitionWorkflow(from, to)) throw new Error(`Invalid workflow phase transition: ${from} -> ${to}`);
  return to;
}
function isTerminalWorkflowPhase(phase) {
  return phase === "done" || phase === "cancelled" || phase === "failed";
}
var SEMANTIC_ROLES = ["supervisor", "implementer", "adviser", "reviewer"];
var ROLE_PERMISSIONS = Object.freeze({
  supervisor: Object.freeze({ workspace: "read_only", tools: "enabled", advisory_only: false }),
  implementer: Object.freeze({ workspace: "worktree", tools: "enabled", advisory_only: false }),
  adviser: Object.freeze({ workspace: "read_only", tools: "none", advisory_only: true }),
  reviewer: Object.freeze({ workspace: "read_only", tools: "enabled", advisory_only: false })
});
function createRosterSnapshot(input, mode = "adaptive") {
  return validateRosterSnapshot({
    schema_version: 1,
    supervisor: input.supervisor,
    implementer: input.implementer,
    adviser: input.adviser ?? null,
    reviewer: input.reviewer ?? { same_as: "supervisor" }
  }, mode);
}
function legacyRosterSnapshot(mode) {
  return createRosterSnapshot({
    supervisor: { adapter: "codex", profile: { name: "codex", model: "codex", effort: "medium", max_turns: 1, timeout_ms: 6e5 } },
    implementer: { adapter: "claude", profile: { name: "opus", model: "opus", effort: "high", max_turns: 50, timeout_ms: 18e5 } },
    adviser: mode === "adaptive" ? { adapter: "fable", profile: { name: "fable", model: "fable", effort: "low", max_turns: 1, timeout_ms: 3e5 } } : null
  }, mode);
}
function validateRosterSnapshot(value, mode) {
  const roster = object(value, "workflow roster");
  exact2(roster, ["schema_version", "supervisor", "implementer", "adviser", "reviewer"], "workflow roster");
  if (roster.schema_version !== 1) throw new Error("Unsupported workflow roster schema version");
  const adviser = roster.adviser === null ? null : agent(roster.adviser, "workflow roster.adviser");
  if (mode === "direct" && adviser !== null) throw new Error("Direct workflow roster cannot include an adviser");
  return {
    schema_version: 1,
    supervisor: agent(roster.supervisor, "workflow roster.supervisor"),
    implementer: agent(roster.implementer, "workflow roster.implementer"),
    adviser,
    reviewer: reviewer(roster.reviewer)
  };
}
function hashRosterSnapshot(value) {
  const roster = validateRosterSnapshot(value);
  return createHash("sha256").update(canonicalJson(roster)).digest("hex");
}
function validateRosterAgent(value, label = "workflow roster agent") {
  return agent(value, label);
}
function hashRosterAgent(value) {
  return createHash("sha256").update(canonicalJson(validateRosterAgent(value))).digest("hex");
}
function reviewer(value) {
  const item = object(value, "workflow roster.reviewer");
  if ("same_as" in item) {
    exact2(item, ["same_as"], "workflow roster.reviewer");
    if (item.same_as !== "supervisor") throw new Error("workflow roster.reviewer.same_as must be supervisor");
    return { same_as: "supervisor" };
  }
  return agent(item, "workflow roster.reviewer");
}
function agent(value, label) {
  const item = object(value, label);
  exact2(item, ["adapter", "profile"], label);
  const profile = object(item.profile, `${label}.profile`);
  exact2(profile, ["name", "model", "effort", "max_turns", "timeout_ms"], `${label}.profile`);
  if (!["low", "medium", "high"].includes(profile.effort)) throw new Error(`${label}.profile.effort is invalid`);
  if (!Number.isSafeInteger(profile.max_turns) || profile.max_turns < 1) throw new Error(`${label}.profile.max_turns is invalid`);
  if (!Number.isSafeInteger(profile.timeout_ms) || profile.timeout_ms < 1) throw new Error(`${label}.profile.timeout_ms is invalid`);
  return { adapter: identifier(item.adapter, `${label}.adapter`), profile: { name: identifier(profile.name, `${label}.profile.name`), model: model(profile.model, `${label}.profile.model`), effort: profile.effort, max_turns: profile.max_turns, timeout_ms: profile.timeout_ms } };
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function exact2(value, keys, label) {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) throw new Error(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${label} contains unknown field ${key}`);
}
function identifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}
function model(value, label) {
  if (value === "") return value;
  return identifier(value, label);
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const item = value;
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(",")}}`;
}
var SYSTEM_READ_PATHS = ["/System", "/Library/Apple", "/usr/lib", "/usr/share", "/dev", "/private/etc/ssl"];
function generateMacosSandboxProfile(request, workspace = path4.resolve(request.workspace), executablePaths = []) {
  const proxy = validateProxyAddress(request.proxyAddress);
  const executableFiles = new Set(uniquePaths(executablePaths));
  const literalReadFiles = new Set(uniquePaths([...executableFiles, ...request.readOnlyFiles ?? []]));
  const readSubpaths = uniquePaths([workspace, ...SYSTEM_READ_PATHS, ...request.readOnlyPaths ?? []]).filter((value) => !executableFiles.has(value)).map((value) => `  (subpath ${sandboxString(value)})`).join("\n");
  const readFiles = [...literalReadFiles].map((value) => `  (literal ${sandboxString(value)})`).join("\n");
  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(deny network*)",
    "(allow process-fork)",
    "(allow process-info*)",
    ...request.allowedExecutablePaths?.length ? ["(allow process-exec", ...uniquePaths(request.allowedExecutablePaths).map((value) => `  (literal ${sandboxString(value)})`), ")"] : ['(allow process-exec (literal "/usr/bin/false"))'],
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read*",
    readSubpaths,
    readFiles,
    ")",
    ...request.writableWorkspace === false ? [] : [`(allow file-write* (subpath ${sandboxString(workspace)}))`],
    ...(request.writablePaths ?? []).map((value) => `(allow file-write* (subpath ${sandboxString(value)}))`),
    '(allow file-write-data (literal "/dev/null"))',
    `(allow network-outbound (remote tcp ${sandboxString(`localhost:${proxy.port}`)}))`
  ].join("\n");
}
async function prepareMacosSandbox(request, executablePaths = []) {
  if (process.platform !== "darwin") throw new Error("macOS sandboxing requires darwin");
  const workspace = await fs4.realpath(path4.resolve(request.workspace));
  if (!(await fs4.stat(workspace)).isDirectory()) throw new Error(`Sandbox workspace is not a directory: ${workspace}`);
  const proxyAddress = validateProxyAddress(request.proxyAddress);
  const executable = await describeExecutable(request.sandboxExecutable ?? "/usr/bin/sandbox-exec");
  return {
    executable,
    profile: generateMacosSandboxProfile({ ...request, proxyAddress }, workspace, executablePaths),
    workspace,
    proxyAddress
  };
}
async function describeExecutable(value) {
  const requestedPath = path4.resolve(value);
  await fs4.access(requestedPath, 1);
  const realpath = await fs4.realpath(requestedPath);
  const stat = await fs4.stat(realpath);
  if (!stat.isFile()) throw new Error(`Sandbox executable is not a file: ${requestedPath}`);
  return { path: requestedPath, realpath, sha256: await sha256(realpath) };
}
async function sha256(file) {
  const hash2 = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash2.update(chunk);
  return hash2.digest("hex");
}
function validateProxyAddress(value) {
  const host = stripIpv6Brackets(value.host).toLowerCase();
  if (!isLoopback(host)) throw new Error("Sandbox proxy must use a numeric loopback address");
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error("Sandbox proxy port is invalid");
  return { host, port: value.port };
}
function isLoopback(host) {
  if (net.isIP(host) === 4) return host.startsWith("127.");
  return net.isIP(host) === 6 && (host === "::1" || host.toLowerCase() === "0:0:0:0:0:0:0:1");
}
function stripIpv6Brackets(value) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}
function sandboxString(value) {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) throw new Error("Sandbox value contains invalid characters");
  return JSON.stringify(value).replace(/\\u2028|\\u2029/g, "");
}
function uniquePaths(values) {
  return [...new Set(values.map((value) => path4.resolve(value)))].sort();
}

// src/infrastructure/process/command-runner.ts
var CommandRunner = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  processManager;
  resolveExecutable(command, pathValue) {
    return resolveExecutable(command, pathValue);
  }
  start(request) {
    validateStreamingRequest(request);
    const args = [...request.args ?? []];
    const descriptor = streamingRequestDescriptor(request);
    const owner = optionalOwner(request.owner, "owner");
    const ownerTag = optionalOwner(request.ownerTag, "ownerTag");
    const sandboxRequest = optionalSandbox(request.sandbox ?? request.macosSandbox);
    const allowedExecutables = uniqueDescriptors([descriptor, ...request.allowedExecutables ?? []]);
    const effectiveSandbox = sandboxRequest ? {
      ...sandboxRequest,
      readOnlyPaths: [...explicitReadSubpaths(sandboxRequest.readOnlyPaths ?? [], allowedExecutables), ...macosRuntimeReadSubpaths(allowedExecutables)],
      readOnlyFiles: [...sandboxRequest.readOnlyFiles ?? [], ...macosRuntimeReadFiles(allowedExecutables)],
      allowedExecutablePaths: allowedExecutables.map((value) => value.realpath)
    } : null;
    const sandbox = effectiveSandbox ? prepareMacosSandboxSync(effectiveSandbox, allowedExecutables.map((value) => value.realpath)) : null;
    const sandboxCwd = sandbox && request.cwd ? realpathSync(path4.resolve(request.cwd)) : null;
    if (sandbox && sandboxCwd && !isWithin(sandboxCwd, sandbox.workspace)) throw new Error("Sandboxed cwd must be within the workspace");
    const spawnExecutable = sandbox?.executable.realpath ?? descriptor.realpath;
    const spawnArgs = sandbox ? ["-p", sandbox.profile, descriptor.realpath, ...args] : args;
    const spawnEnv = sandbox ? sandboxEnvironment(request.env, sandbox) : { ...request.env ?? {} };
    for (const executable of allowedExecutables) verifyExecutableSync(executable);
    if (sandbox) verifyExecutableSync(sandbox.executable);
    const spawned = this.processManager.spawn(spawnExecutable, spawnArgs, {
      cwd: sandboxCwd ?? request.cwd ?? sandbox?.workspace,
      env: spawnEnv,
      stdio: [request.stdin === void 0 && !request.keepStdinOpen ? "ignore" : "pipe", "pipe", "pipe"],
      owner,
      ownerTag
    });
    const child = spawned.process;
    let termination = "exited";
    let cleanup = null;
    const stop = (reason) => {
      if (termination !== "exited") return;
      termination = reason;
      cleanup = this.processManager.killWithGrace(spawned.pid, request.killGraceMs ?? 1e3);
    };
    const onAbort = () => stop("timed_out");
    if (request.signal) {
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = request.timeoutMs === void 0 ? null : setTimeout(() => stop("timed_out"), request.timeoutMs);
    if (request.stdin !== void 0) {
      if (request.keepStdinOpen) child.stdin?.write(request.stdin);
      else child.stdin?.end(request.stdin);
    }
    const completion = new Promise((resolve2) => {
      let settled = false;
      const finish = async (exitCode, signal, spawnError) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        let integrityError = null;
        try {
          for (const executable of allowedExecutables) verifyExecutableSync(executable);
          if (sandbox) verifyExecutableSync(sandbox.executable);
        } catch (error) {
          integrityError = error instanceof Error ? error.message : String(error);
          termination = "integrity_error";
        }
        if (cleanup) await cleanup;
        if (spawnError && termination === "exited") termination = "spawn_error";
        resolve2({
          ok: termination === "exited" && exitCode === 0,
          termination,
          exitCode,
          signal,
          spawnError,
          integrityError
        });
      };
      child.once("close", (code, signal) => void finish(code, signal, null));
      child.once("error", (error) => void finish(null, null, { message: error.message, code: error.code ?? null }));
    });
    return { ...spawned, executableDescriptor: descriptor, completion };
  }
  async run(request) {
    validateRequest(request);
    const started = Date.now();
    const args = [...request.args ?? []];
    const descriptor = await requestDescriptor(request);
    const owner = optionalOwner(request.owner, "owner");
    const ownerTag = optionalOwner(request.ownerTag, "ownerTag");
    const sandboxRequest = optionalSandbox(request.sandbox ?? request.macosSandbox);
    const allowedExecutables = uniqueDescriptors([descriptor, ...request.allowedExecutables ?? []]);
    const effectiveSandbox = sandboxRequest ? {
      ...sandboxRequest,
      readOnlyPaths: [...explicitReadSubpaths(sandboxRequest.readOnlyPaths ?? [], allowedExecutables), ...macosRuntimeReadSubpaths(allowedExecutables)],
      readOnlyFiles: [...sandboxRequest.readOnlyFiles ?? [], ...macosRuntimeReadFiles(allowedExecutables)],
      allowedExecutablePaths: allowedExecutables.map((value) => value.realpath)
    } : null;
    const sandbox = effectiveSandbox ? await prepareMacosSandbox(effectiveSandbox, allowedExecutables.map((value) => value.realpath)) : null;
    const sandboxCwd = sandbox && request.cwd ? await fs4.realpath(path4.resolve(request.cwd)) : null;
    if (sandbox && sandboxCwd && !isWithin(sandboxCwd, sandbox.workspace)) throw new Error("Sandboxed cwd must be within the workspace");
    const spawnExecutable = sandbox?.executable.realpath ?? descriptor.realpath;
    const spawnArgs = sandbox ? ["-p", sandbox.profile, descriptor.realpath, ...args] : args;
    const spawnEnv = sandbox ? sandboxEnvironment(request.env, sandbox) : { ...request.env ?? {} };
    await Promise.all([...allowedExecutables.map(verifyExecutable), sandbox ? verifyExecutable(sandbox.executable) : Promise.resolve()]);
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let termination = "exited";
    let cleanup = null;
    let child;
    let pid = null;
    let integrityError = null;
    try {
      const spawned = this.processManager.spawn(spawnExecutable, spawnArgs, {
        cwd: sandboxCwd ?? request.cwd ?? sandbox?.workspace,
        env: spawnEnv,
        stdio: request.stdio === "inherit" ? "inherit" : [request.stdin === void 0 ? "ignore" : "pipe", "pipe", "pipe"],
        owner,
        ownerTag
      });
      child = spawned.process;
      pid = spawned.pid;
    } catch (error) {
      const cause = error;
      return result({ request, descriptor, sandbox, args, started, pid, termination: "spawn_error", stdout, stderr, stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated, exitCode: null, signal: null, spawnError: { message: cause.message, code: cause.code ?? null }, integrityError });
    }
    const stop = (reason) => {
      if (termination !== "exited") return;
      termination = reason;
      cleanup = this.processManager.killWithGrace(pid, request.killGraceMs ?? 1e3);
    };
    const capture = (chunks, chunk, current, maximum, stream) => {
      const remaining = Math.max(0, maximum - current);
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      if (chunk.length > remaining) {
        if (stream === "stdout") stdoutTruncated = true;
        else stderrTruncated = true;
        stop(`${stream}_limit`);
      }
      return current + chunk.length;
    };
    child.stdout?.on("data", (value) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stdoutBytes = capture(stdout, chunk, stdoutBytes, request.maxStdoutBytes, "stdout");
    });
    child.stderr?.on("data", (value) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stderrBytes = capture(stderr, chunk, stderrBytes, request.maxStderrBytes, "stderr");
    });
    if (request.stdin !== void 0) child.stdin?.end(request.stdin);
    const timer = setTimeout(() => stop("timed_out"), request.timeoutMs);
    const closed = await new Promise((resolve2) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve2(value);
      };
      child.once("close", (code, signal) => finish({ exitCode: code, signal, spawnError: null }));
      child.once("error", (error) => finish({ exitCode: null, signal: null, spawnError: { message: error.message, code: error.code ?? null } }));
    });
    clearTimeout(timer);
    try {
      await Promise.all([...allowedExecutables.map(verifyExecutable), sandbox ? verifyExecutable(sandbox.executable) : Promise.resolve()]);
    } catch (error) {
      integrityError = error instanceof Error ? error.message : String(error);
      termination = "integrity_error";
    }
    if (cleanup) await cleanup;
    if (closed.spawnError && termination === "exited") termination = "spawn_error";
    return result({ request, descriptor, sandbox, args, started, pid, termination, stdout, stderr, stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated, integrityError, ...closed });
  }
};
async function resolveExecutable(command, pathValue = process.env.PATH ?? "") {
  if (path4.isAbsolute(command)) return describeExecutable2(command);
  if (command.includes("/") || command.includes("\\")) throw new Error(`Executable path must be absolute or a bare name: ${command}`);
  for (const entry of pathValue.split(path4.delimiter).filter(Boolean)) {
    const candidate = path4.resolve(entry, command);
    try {
      return await describeExecutable2(candidate);
    } catch {
    }
  }
  throw new Error(`Executable not found: ${command}`);
}
async function verifyExecutable(descriptor) {
  validateDescriptor(descriptor);
  const currentRealpath = await fs4.realpath(descriptor.path);
  if (currentRealpath !== descriptor.realpath) throw new Error(`Executable realpath changed: ${descriptor.path}`);
  await fs4.access(currentRealpath, process.platform === "win32" ? void 0 : 1);
  const currentHash = await sha2562(currentRealpath);
  if (currentHash !== descriptor.sha256) throw new Error(`Executable SHA-256 changed: ${descriptor.realpath}`);
}
function commandFailureMessage(value) {
  if (value.termination === "timed_out") return `${value.executable} timed out`;
  if (value.termination === "stdout_limit" || value.termination === "stderr_limit") return `${value.executable} output exceeded configured maximum`;
  if (value.termination === "integrity_error") return value.integrityError ?? `${value.executable} failed executable integrity verification`;
  if (value.termination === "spawn_error") return value.spawnError?.message ?? "Process could not be started";
  return `${value.executable} exited ${value.exitCode}: ${value.stderr}`;
}
async function describeExecutable2(value) {
  const requestedPath = path4.resolve(value);
  await fs4.access(requestedPath, process.platform === "win32" ? void 0 : 1);
  const realpath = await fs4.realpath(requestedPath);
  const stat = await fs4.stat(realpath);
  if (!stat.isFile()) throw new Error(`Executable is not a file: ${requestedPath}`);
  return { path: requestedPath, realpath, sha256: await sha2562(realpath) };
}
async function sha2562(file) {
  const hash2 = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash2.update(chunk);
  return hash2.digest("hex");
}
function sha256Sync(file) {
  const hash2 = createHash("sha256");
  const fd = openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash2.update(buffer.subarray(0, bytesRead));
  } finally {
    closeSync(fd);
  }
  return hash2.digest("hex");
}
async function requestDescriptor(request) {
  if (request.executableDescriptor) {
    if (typeof request.executable !== "string" || path4.resolve(request.executable) !== request.executableDescriptor.path) {
      throw new Error("Executable and executableDescriptor path do not match");
    }
    return request.executableDescriptor;
  }
  if (typeof request.executable !== "string") return request.executable;
  return resolveExecutable(request.executable);
}
function streamingRequestDescriptor(request) {
  if (request.executableDescriptor) {
    if (typeof request.executable !== "string" || path4.resolve(request.executable) !== request.executableDescriptor.path) {
      throw new Error("Executable and executableDescriptor path do not match");
    }
    return request.executableDescriptor;
  }
  if (typeof request.executable !== "string") return request.executable;
  return resolveExecutableSync(request.executable, request.env?.PATH ?? process.env.PATH ?? "");
}
function resolveExecutableSync(command, pathValue) {
  if (path4.isAbsolute(command)) return describeExecutableSync(command);
  if (command.includes("/") || command.includes("\\")) throw new Error(`Executable path must be absolute or a bare name: ${command}`);
  for (const entry of pathValue.split(path4.delimiter).filter(Boolean)) {
    try {
      return describeExecutableSync(path4.resolve(entry, command));
    } catch {
    }
  }
  throw new Error(`Executable not found: ${command}`);
}
function describeExecutableSync(value) {
  const requestedPath = path4.resolve(value);
  accessSync(requestedPath, process.platform === "win32" ? void 0 : 1);
  const realpath = realpathSync(requestedPath);
  if (!statSync(realpath).isFile()) throw new Error(`Executable is not a file: ${requestedPath}`);
  return { path: requestedPath, realpath, sha256: sha256Sync(realpath) };
}
function verifyExecutableSync(descriptor) {
  validateDescriptor(descriptor);
  const currentRealpath = realpathSync(descriptor.path);
  if (currentRealpath !== descriptor.realpath) throw new Error(`Executable realpath changed: ${descriptor.path}`);
  accessSync(currentRealpath, process.platform === "win32" ? void 0 : 1);
  if (sha256Sync(currentRealpath) !== descriptor.sha256) throw new Error(`Executable SHA-256 changed: ${descriptor.realpath}`);
}
function prepareMacosSandboxSync(request, executablePaths) {
  if (process.platform !== "darwin") throw new Error("macOS sandboxing requires darwin");
  const workspace = realpathSync(path4.resolve(request.workspace));
  if (!statSync(workspace).isDirectory()) throw new Error(`Sandbox workspace is not a directory: ${workspace}`);
  const executable = describeExecutableSync(request.sandboxExecutable ?? "/usr/bin/sandbox-exec");
  const proxyHost = request.proxyAddress.host;
  const proxyAddress = {
    host: (proxyHost.startsWith("[") && proxyHost.endsWith("]") ? proxyHost.slice(1, -1) : proxyHost).toLowerCase(),
    port: request.proxyAddress.port
  };
  return {
    executable,
    profile: generateMacosSandboxProfile({ ...request, proxyAddress }, workspace, executablePaths),
    workspace,
    proxyAddress
  };
}
function validateDescriptor(value) {
  if (!path4.isAbsolute(value.path) || !path4.isAbsolute(value.realpath) || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error("Executable descriptor is invalid");
  }
}
function sandboxEnvironment(env, sandbox) {
  const host = sandbox.proxyAddress.host.includes(":") ? `[${sandbox.proxyAddress.host}]` : sandbox.proxyAddress.host;
  const proxy = `http://${host}:${sandbox.proxyAddress.port}`;
  return { ...env ?? {}, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, NO_PROXY: "", no_proxy: "" };
}
function isWithin(candidate, root) {
  const relative = path4.relative(root, path4.resolve(candidate));
  return relative === "" || !relative.startsWith(`..${path4.sep}`) && relative !== ".." && !path4.isAbsolute(relative);
}
function optionalOwner(value, label) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function optionalSandbox(value) {
  if (value === void 0 || value === null) return void 0;
  if (!value || typeof value !== "object") throw new Error("sandbox must be a macOS sandbox request");
  const candidate = value;
  if (typeof candidate.workspace !== "string" || !candidate.proxyAddress || typeof candidate.proxyAddress !== "object") {
    throw new Error("sandbox must include workspace and proxyAddress");
  }
  return candidate;
}
function uniqueDescriptors(values) {
  const result2 = /* @__PURE__ */ new Map();
  for (const value of values) {
    validateDescriptor(value);
    const prior = result2.get(value.realpath);
    if (prior && prior.sha256 !== value.sha256) throw new Error(`Conflicting executable descriptor: ${value.realpath}`);
    result2.set(value.realpath, value);
  }
  return [...result2.values()];
}
function explicitReadSubpaths(values, executables) {
  const executablePaths = new Set(executables.flatMap((value) => [path4.resolve(value.path), path4.resolve(value.realpath)]));
  return [...new Set(values.map((value) => path4.resolve(value)).filter((value) => !executablePaths.has(value)))];
}
function macosRuntimeReadFiles(executables) {
  return macosRuntimeReads(executables).files;
}
function macosRuntimeReadSubpaths(executables) {
  return macosRuntimeReads(executables).subpaths;
}
function macosRuntimeReads(executables) {
  if (process.platform !== "darwin") return { files: [], subpaths: [] };
  const files = /* @__PURE__ */ new Set();
  const subpaths = /* @__PURE__ */ new Set();
  for (const executable of executables) {
    const executableRoot = path4.dirname(executable.realpath);
    const queue = [executable.realpath];
    const inspected = /* @__PURE__ */ new Set();
    while (queue.length > 0 && inspected.size < 512) {
      const image = queue.shift();
      const canonicalImage = realpathSync(image);
      if (inspected.has(canonicalImage)) continue;
      inspected.add(canonicalImage);
      const loadCommands = spawnSync("/usr/bin/otool", ["-l", canonicalImage], { encoding: "utf8", timeout: 2e3 });
      const libraries = spawnSync("/usr/bin/otool", ["-L", canonicalImage], { encoding: "utf8", timeout: 2e3 });
      if (loadCommands.status !== 0 || libraries.status !== 0 || typeof loadCommands.stdout !== "string" || typeof libraries.stdout !== "string") continue;
      const loader = path4.dirname(canonicalImage);
      const rpaths = [...loadCommands.stdout.matchAll(/\n\s*path\s+(\S+)\s+\(offset/g)].map((match) => resolveDyldPath(match[1], loader, executableRoot, [])).filter((value) => value !== null);
      for (const line of libraries.stdout.split("\n").slice(1)) {
        const dependency = /^\s*(\S+)\s+\(/.exec(line)?.[1];
        if (!dependency) continue;
        const resolved = resolveDyldPath(dependency, loader, executableRoot, rpaths);
        if (resolved && statFile(resolved)) {
          for (const value of literalSymlinkChain(resolved)) files.add(value);
          for (const value of macosRuntimeConfigurationFiles(resolved)) {
            for (const component of literalSymlinkChain(value)) files.add(component);
          }
          queue.push(resolved);
        }
      }
    }
  }
  return { files: [...files].sort(), subpaths: [...subpaths].sort() };
}
function macosRuntimeConfigurationFiles(library) {
  const match = /^(.*)\/opt\/(openssl@[^/]+)\/lib\//.exec(library);
  if (!match) return [];
  const values = [
    path4.join(match[1], "etc", match[2], "openssl.cnf"),
    path4.join(match[1], "etc", match[2], "cert.pem")
  ];
  return values.filter(statFile);
}
function literalSymlinkChain(value) {
  const result2 = /* @__PURE__ */ new Set();
  let current = path4.resolve(value);
  for (let index = 0; index < 32; index++) {
    addLiteralPathComponents(result2, current);
    addResolvedAncestorVariants(result2, current);
    const real = realpathSync(current);
    addLiteralPathComponents(result2, real);
    if (real === current) break;
    current = real;
  }
  return [...result2];
}
function addResolvedAncestorVariants(result2, value) {
  let ancestor = path4.resolve(value);
  while (ancestor !== path4.dirname(ancestor)) {
    try {
      const resolved = path4.join(realpathSync(ancestor), path4.relative(ancestor, value));
      addLiteralPathComponents(result2, resolved);
    } catch {
    }
    ancestor = path4.dirname(ancestor);
  }
}
function addLiteralPathComponents(result2, value) {
  let current = path4.resolve(value);
  while (current !== path4.dirname(current)) {
    result2.add(current);
    current = path4.dirname(current);
  }
}
function resolveDyldPath(value, loader, executable, rpaths) {
  if (path4.isAbsolute(value)) return path4.normalize(value);
  if (value.startsWith("@loader_path/")) return path4.resolve(loader, value.slice("@loader_path/".length));
  if (value.startsWith("@executable_path/")) return path4.resolve(executable, value.slice("@executable_path/".length));
  if (value.startsWith("@rpath/")) {
    const suffix = value.slice("@rpath/".length);
    for (const root of rpaths) {
      const candidate = path4.resolve(root, suffix);
      if (statFile(candidate)) return candidate;
    }
  }
  return null;
}
function statFile(value) {
  try {
    return statSync(value).isFile();
  } catch {
    return false;
  }
}
function validateRequest(request) {
  const executablePath = typeof request.executable === "string" ? request.executable : request.executable.path;
  if (!path4.isAbsolute(executablePath)) throw new Error(`CommandRunner requires an absolute executable: ${executablePath}`);
  const owner = optionalOwner(request.owner, "owner");
  const ownerTag = optionalOwner(request.ownerTag, "ownerTag");
  if (owner !== void 0 && ownerTag !== void 0 && owner !== ownerTag) throw new Error("owner and ownerTag must match");
  if (request.stdio === "inherit" && request.stdin !== void 0) throw new Error("stdin cannot be supplied when stdio is inherited");
  for (const [label, value] of [["timeoutMs", request.timeoutMs], ["maxStdoutBytes", request.maxStdoutBytes], ["maxStderrBytes", request.maxStderrBytes]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  }
}
function validateStreamingRequest(request) {
  const executablePath = typeof request.executable === "string" ? request.executable : request.executable.path;
  if (!executablePath) throw new Error("CommandRunner requires an executable");
  const owner = optionalOwner(request.owner, "owner");
  const ownerTag = optionalOwner(request.ownerTag, "ownerTag");
  if (owner !== void 0 && ownerTag !== void 0 && owner !== ownerTag) throw new Error("owner and ownerTag must match");
  if (request.timeoutMs !== void 0 && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1)) {
    throw new Error("timeoutMs must be a positive integer");
  }
}
function result(input) {
  const stdoutBuffer = Buffer.concat(input.stdout);
  return { executable: input.descriptor.realpath, executableDescriptor: input.descriptor, args: input.args, cwd: input.request.cwd ?? input.sandbox?.workspace ?? null, pid: input.pid, ok: input.termination === "exited" && input.exitCode === 0, termination: input.termination, exitCode: input.exitCode, signal: input.signal, stdoutBuffer, stdout: stdoutBuffer.toString("utf8"), stderr: Buffer.concat(input.stderr).toString("utf8"), stdoutBytes: input.stdoutBytes, stderrBytes: input.stderrBytes, stdoutTruncated: input.stdoutTruncated, stderrTruncated: input.stderrTruncated, durationMs: Date.now() - input.started, spawnError: input.spawnError, integrityError: input.integrityError, sandbox: input.sandbox ? { executableDescriptor: input.sandbox.executable, profile: input.sandbox.profile, proxyAddress: input.sandbox.proxyAddress } : null };
}
var ProcessManager = class {
  constructor(registryPath = defaultProcessRegistryPath()) {
    this.registryPath = registryPath;
    this.registryPath = path4.resolve(registryPath);
  }
  registryPath;
  ownedPids = /* @__PURE__ */ new Set();
  quiescenceContext = new AsyncLocalStorage();
  isAlive(pid) {
    if (!isSafePid(pid)) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err.code === "EPERM") return true;
      return false;
    }
  }
  kill(pid, signal = "SIGTERM") {
    const registry = this.registry();
    if (!this.ownedPids.has(pid) && !registry.groups.some((group) => group.pid === pid)) return;
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
      }
    }
  }
  async killWithGrace(pid, graceMs = 1e4) {
    if (!this.ownedPids.has(pid) && !this.registry().groups.some((group) => group.pid === pid)) return;
    if (!this.isGroupAlive(pid)) {
      this.release(pid);
      return;
    }
    this.kill(pid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if (!this.isGroupAlive(pid)) {
        this.release(pid);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    this.kill(pid, "SIGKILL");
    const forceDeadline = Date.now() + 1e3;
    while (Date.now() < forceDeadline && this.isGroupAlive(pid)) {
      await new Promise((resolve2) => setTimeout(resolve2, 25));
    }
    if (!this.isGroupAlive(pid)) this.release(pid);
  }
  spawn(command, args, options) {
    const { owner, ownerTag, ...spawnOptions } = options ?? {};
    const context = this.quiescenceContext.getStore();
    const tag = normalizeOwner(owner ?? ownerTag) ?? context?.owner ?? null;
    const reservation = {
      id: randomUUID(),
      owner: tag,
      parent_pid: process.pid,
      parent_identity: processIdentity(process.pid) ?? `node-${process.pid}`,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.updateRegistry((registry) => {
      const freeze = tag === null ? registry.freezes[0] : registry.freezes.find((value) => value.owner === tag);
      if (freeze && freeze.token !== context?.token) throw new Error(`Process owner is frozen for a quiescent operation: ${tag ?? freeze.owner}`);
      registry.reservations.push(reservation);
    });
    let proc;
    try {
      proc = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        ...spawnOptions,
        detached: true
        // Callers cannot disable the process group used for cleanup.
      });
    } catch (error) {
      this.removeReservation(reservation.id);
      throw error;
    }
    if (!proc.pid) {
      if (typeof proc.once === "function") proc.once("error", () => {
      });
      this.removeReservation(reservation.id);
      throw new Error(`Failed to spawn process: ${command}`);
    }
    proc.unref();
    const identity = processGroupIdentity(proc.pid);
    if (!identity) {
      this.signalGroup(proc.pid, "SIGKILL");
      if (!this.isGroupAlive(proc.pid)) this.removeReservation(reservation.id);
      throw new Error(`Failed to establish process-group identity: ${proc.pid}`);
    }
    try {
      this.updateRegistry((registry) => {
        if (!registry.reservations.some((value) => value.id === reservation.id)) throw new Error("Process spawn reservation was lost");
        registry.reservations = registry.reservations.filter((value) => value.id !== reservation.id);
        registry.groups = registry.groups.filter((group) => group.pid !== proc.pid);
        registry.groups.push({ pid: proc.pid, owner: tag, identity, registered_at: (/* @__PURE__ */ new Date()).toISOString() });
      });
      this.ownedPids.add(proc.pid);
    } catch (error) {
      this.signalGroup(proc.pid, "SIGKILL");
      if (!this.isGroupAlive(proc.pid)) this.removeReservation(reservation.id);
      throw error;
    }
    const leaderClosed = () => {
      const pid = proc.pid;
      this.signalGroup(pid, "SIGKILL");
      if (!this.isGroupAlive(pid)) {
        try {
          this.release(pid);
        } catch {
        }
      }
    };
    proc.once("close", leaderClosed);
    return tag ? { process: proc, pid: proc.pid, owner: tag, ownerTag: tag } : { process: proc, pid: proc.pid };
  }
  active(owner) {
    const tag = requireOwner(owner);
    return this.registry().groups.filter((group) => group.owner === null || group.owner === tag).map((group) => group.pid).sort((left, right) => left - right);
  }
  async awaitQuiescent(owner, timeoutMs) {
    const tag = requireOwner(owner);
    validateTimeout(timeoutMs);
    const deadline = timeoutMs === void 0 ? Infinity : Date.now() + timeoutMs;
    while (this.hasBlockers(tag)) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for process owner to become quiescent: ${tag}`);
      await new Promise((resolve2) => setTimeout(resolve2, Math.min(25, deadline - Date.now())));
    }
  }
  async runQuiescent(owner, action, timeoutMs = 1e4) {
    const tag = requireOwner(owner);
    validateTimeout(timeoutMs);
    const existing = this.quiescenceContext.getStore();
    if (existing?.owner === tag) return action();
    const token = randomUUID();
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let acquired = false;
      this.updateRegistry((registry) => {
        if (registry.freezes.some((freeze) => freeze.owner === tag)) return;
        if (registry.groups.some((group) => group.owner === null || group.owner === tag)) return;
        if (registry.reservations.some((reservation) => reservation.owner === null || reservation.owner === tag)) return;
        registry.freezes.push({ owner: tag, token, holder_pid: process.pid, holder_identity: processIdentity(process.pid) ?? `node-${process.pid}`, created_at: (/* @__PURE__ */ new Date()).toISOString() });
        acquired = true;
      });
      if (acquired) break;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for process owner to become quiescent: ${tag}`);
      await new Promise((resolve2) => setTimeout(resolve2, Math.min(25, deadline - Date.now())));
    }
    try {
      return await this.quiescenceContext.run({ owner: tag, token }, action);
    } finally {
      this.updateRegistry((registry) => {
        registry.freezes = registry.freezes.filter((freeze) => freeze.token !== token);
      });
    }
  }
  isGroupAlive(pid) {
    if (!isSafePid(pid)) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }
  signalGroup(pid, signal) {
    try {
      process.kill(-pid, signal);
    } catch {
    }
  }
  release(pid) {
    this.updateRegistry((registry) => {
      registry.groups = registry.groups.filter((group) => group.pid !== pid);
    });
    this.ownedPids.delete(pid);
  }
  removeReservation(id2) {
    this.updateRegistry((registry) => {
      registry.reservations = registry.reservations.filter((reservation) => reservation.id !== id2);
    });
  }
  hasBlockers(owner) {
    const registry = this.registry();
    return registry.groups.some((group) => group.owner === null || group.owner === owner) || registry.reservations.some((reservation) => reservation.owner === null || reservation.owner === owner);
  }
  registry() {
    return this.updateRegistry(() => {
    });
  }
  updateRegistry(update) {
    return withRegistryLock(this.registryPath, () => {
      const registry = readRegistry(this.registryPath);
      registry.groups = registry.groups.filter((group) => {
        const identity = processGroupIdentity(group.pid);
        return this.isGroupAlive(group.pid) && (identity === null || identity === group.identity);
      });
      registry.freezes = registry.freezes.filter((freeze) => processIdentity(freeze.holder_pid) === freeze.holder_identity);
      update(registry);
      registry.groups.sort((left, right) => left.pid - right.pid);
      registry.reservations.sort((left, right) => left.id.localeCompare(right.id));
      registry.freezes.sort((left, right) => left.owner.localeCompare(right.owner));
      writeRegistry(this.registryPath, registry);
      return registry;
    });
  }
};
function defaultProcessRegistryPath(home = os.homedir()) {
  const configured = process.env.ORCHESTRY_PROCESS_REGISTRY;
  if (configured?.trim()) return path4.resolve(configured);
  const base = process.platform === "darwin" ? path4.join(home, "Library", "Application Support", "orchestry") : path4.join(home, ".local", "state", "orchestry");
  return path4.join(base, "process-groups.json");
}
function readRegistry(file) {
  if (!existsSync(file)) return { schema_version: 3, groups: [], reservations: [], freezes: [] };
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 63) !== 0) throw new Error(`Unsafe process-group registry: ${file}`);
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Invalid process-group registry: ${file}`);
  }
  if (!value || typeof value !== "object") throw new Error(`Invalid process-group registry: ${file}`);
  const candidate = value;
  if (candidate.schema_version !== 1 && candidate.schema_version !== 2 && candidate.schema_version !== 3) throw new Error(`Unsupported process-group registry schema: ${String(candidate.schema_version)}`);
  if (!Array.isArray(candidate.groups)) throw new Error(`Invalid process-group registry: ${file}`);
  const schema = candidate.schema_version;
  const groups = candidate.groups.map((entry) => migrateGroup(entry, schema));
  if (schema !== 3) return { schema_version: 3, groups, reservations: [], freezes: [] };
  const extended = value;
  if (!Array.isArray(extended.reservations) || !Array.isArray(extended.freezes)) throw new Error(`Invalid process-group registry: ${file}`);
  return { schema_version: 3, groups, reservations: extended.reservations.map(validateReservation), freezes: extended.freezes.map(validateFreeze) };
}
function migrateGroup(value, schema) {
  if (!value || typeof value !== "object") throw new Error("Invalid process-group registry entry");
  const entry = value;
  if (!isSafePid(entry.pid ?? 0) || entry.owner !== null && typeof entry.owner !== "string") throw new Error("Invalid process-group registry entry");
  const owner = entry.owner === null ? null : requireOwner(entry.owner);
  if (schema >= 2) {
    if (typeof entry.identity !== "string" || !entry.identity || typeof entry.registered_at !== "string" || !Number.isFinite(Date.parse(entry.registered_at))) {
      throw new Error("Invalid process-group registry entry");
    }
    return { pid: entry.pid, owner, identity: entry.identity, registered_at: entry.registered_at };
  }
  return {
    pid: entry.pid,
    owner,
    identity: processGroupIdentity(entry.pid) ?? "stale",
    registered_at: typeof entry.registered_at === "string" && Number.isFinite(Date.parse(entry.registered_at)) ? entry.registered_at : (/* @__PURE__ */ new Date(0)).toISOString()
  };
}
function validateReservation(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid process spawn reservation");
  const entry = value;
  if (typeof entry.id !== "string" || !entry.id || entry.owner !== null && typeof entry.owner !== "string" || !isSafePid(entry.parent_pid ?? 0) || typeof entry.parent_identity !== "string" || !entry.parent_identity || typeof entry.created_at !== "string" || !Number.isFinite(Date.parse(entry.created_at))) throw new Error("Invalid process spawn reservation");
  return { id: entry.id, owner: entry.owner === null ? null : requireOwner(entry.owner), parent_pid: entry.parent_pid, parent_identity: entry.parent_identity, created_at: entry.created_at };
}
function validateFreeze(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid process scope freeze");
  const entry = value;
  if (typeof entry.owner !== "string" || typeof entry.token !== "string" || !entry.token || !isSafePid(entry.holder_pid ?? 0) || typeof entry.holder_identity !== "string" || !entry.holder_identity || typeof entry.created_at !== "string" || !Number.isFinite(Date.parse(entry.created_at))) throw new Error("Invalid process scope freeze");
  return { owner: requireOwner(entry.owner), token: entry.token, holder_pid: entry.holder_pid, holder_identity: entry.holder_identity, created_at: entry.created_at };
}
function writeRegistry(file, registry) {
  const directory = path4.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 448 });
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(registry)}
`, { mode: 384, flag: "wx" });
  chmodSync(temporary, 384);
  renameSync(temporary, file);
  chmodSync(file, 384);
}
function withRegistryLock(file, action) {
  const directory = path4.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 448 });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 2e3;
  let fd = null;
  const token = randomUUID();
  while (fd === null) {
    try {
      fd = openSync(lock, "wx", 384);
      writeFileSync(fd, `${process.pid} ${Date.now()} ${token}
`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      removeStaleLock(lock);
      if (Date.now() >= deadline) throw new Error(`Timed out locking process-group registry: ${file}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return action();
  } finally {
    closeSync(fd);
    try {
      if (readFileSync(lock, "utf8").trim().split(/\s+/)[2] === token) rmSync(lock, { force: true });
    } catch {
    }
  }
}
function removeStaleLock(file) {
  try {
    const [pidValue, createdValue] = readFileSync(file, "utf8").trim().split(/\s+/);
    const pid = Number(pidValue);
    const created = Number(createdValue);
    if (!isSafePid(pid) || !isProcessAlive(pid) || !Number.isFinite(created)) rmSync(file, { force: true });
  } catch {
  }
}
function processGroupIdentity(pid) {
  if (!isSafePid(pid)) return null;
  const result2 = spawnSync("/bin/ps", ["-o", "pgid=", "-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 1e3 });
  if (result2.status !== 0 || typeof result2.stdout !== "string") return null;
  const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(result2.stdout);
  if (!match || Number(match[1]) !== pid) return null;
  return match[2];
}
function processIdentity(pid) {
  if (!isSafePid(pid)) return null;
  const result2 = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 1e3 });
  if (result2.status !== 0 || typeof result2.stdout !== "string" || !result2.stdout.trim()) return null;
  return result2.stdout.trim();
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function isSafePid(pid) {
  return Number.isSafeInteger(pid) && pid > 1;
}
function normalizeOwner(owner) {
  if (owner === void 0) return null;
  return requireOwner(owner);
}
function requireOwner(owner) {
  const value = owner.trim();
  if (!value) throw new Error("Process owner must not be empty");
  return value;
}
function validateTimeout(timeoutMs) {
  if (timeoutMs !== void 0 && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)) throw new Error("timeoutMs must be a non-negative integer");
}

// src/infrastructure/clipboard-service.ts
var EXEC_TIMEOUT_MS = 3e3;
var TEXT_MAX_STDOUT_BYTES = 64 * 1024;
var IMAGE_MAX_STDOUT_BYTES = 50 * 1024 * 1024;
var MAX_STDERR_BYTES = 64 * 1024;
var commandRunner = new CommandRunner(new ProcessManager());
var executableDescriptors = /* @__PURE__ */ new Map();
function isClipboardToolAvailable() {
  const platform = process.platform;
  if (platform === "darwin") {
    return true;
  }
  if (platform === "linux") {
    return executableOnPath("xclip");
  }
  if (platform === "win32") {
    return true;
  }
  return false;
}
async function detectClipboardType() {
  const platform = process.platform;
  if (platform === "darwin") {
    return detectMacOS();
  }
  if (platform === "linux") {
    return detectLinux();
  }
  if (platform === "win32") {
    return detectWindows();
  }
  throw new OrchestryError(
    `Unsupported platform for clipboard: ${platform}`,
    1,
    "Supported: macOS, Linux, Windows"
  );
}
async function getClipboardImage() {
  const type = await detectClipboardType();
  if (type !== "image") return null;
  const platform = process.platform;
  if (platform === "darwin") {
    return getImageMacOS();
  }
  if (platform === "linux") {
    return getImageLinux();
  }
  if (platform === "win32") {
    return getImageWindows();
  }
  return null;
}
async function detectMacOS() {
  try {
    const { stdout } = await run("osascript", ["-e", "clipboard info"]);
    if (stdout.includes("\xABclass PNGf\xBB") || stdout.includes("\xABclass TIFF\xBB")) {
      return "image";
    }
    if (stdout.includes("\xABclass ut16\xBB") || stdout.includes("\xABclass utf8\xBB")) {
      return "text";
    }
    return stdout.trim().length > 0 ? "text" : "empty";
  } catch {
    return "empty";
  }
}
async function getImageMacOS() {
  const dir = await mkdtemp(join(tmpdir(), "orch-clip-"));
  const filePath = join(dir, "clipboard.png");
  try {
    const script = `
      set theFile to POSIX file "${filePath}"
      try
        set imgData to the clipboard as \xABclass PNGf\xBB
        set fRef to open for access theFile with write permission
        write imgData to fRef
        close access fRef
        return "ok"
      on error
        try
          close access theFile
        end try
        return "error"
      end try
    `;
    const { stdout } = await run("osascript", ["-e", script]);
    if (stdout.trim() !== "ok") return null;
    const data = await readFile(filePath);
    return { data, ext: "png" };
  } catch {
    return null;
  } finally {
    try {
      await unlink(filePath);
    } catch {
    }
    try {
      await rm(dir, { recursive: true });
    } catch {
    }
  }
}
async function detectLinux() {
  try {
    const { stdout } = await run(
      "xclip",
      ["-selection", "clipboard", "-t", "TARGETS", "-o"]
    );
    const targets = stdout.toLowerCase();
    if (targets.includes("image/png") || targets.includes("image/tiff") || targets.includes("image/jpeg")) {
      return "image";
    }
    if (targets.includes("text/plain") || targets.includes("utf8_string") || targets.includes("string")) {
      return "text";
    }
    return targets.trim().length > 0 ? "text" : "empty";
  } catch {
    return "empty";
  }
}
async function getImageLinux() {
  try {
    const { stdoutBuffer } = await run(
      "xclip",
      ["-selection", "clipboard", "-t", "image/png", "-o"],
      IMAGE_MAX_STDOUT_BYTES
    );
    const data = stdoutBuffer;
    if (data.length === 0) return null;
    return { data, ext: "png" };
  } catch {
    return null;
  }
}
async function detectWindows() {
  try {
    const { stdout: imgCheck } = await run(
      "powershell.exe",
      ["-NoProfile", "-Command", 'if (Get-Clipboard -Format Image) { "image" } else { "none" }']
    );
    if (imgCheck.trim() === "image") return "image";
    const { stdout: textCheck } = await run(
      "powershell.exe",
      ["-NoProfile", "-Command", 'if (Get-Clipboard) { "text" } else { "empty" }']
    );
    return textCheck.trim() === "text" ? "text" : "empty";
  } catch {
    return "empty";
  }
}
async function getImageWindows() {
  const dir = await mkdtemp(join(tmpdir(), "orch-clip-"));
  const filePath = join(dir, "clipboard.png");
  try {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $img = [System.Windows.Forms.Clipboard]::GetImage()
      if ($img) {
        $img.Save('${filePath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output 'ok'
      } else {
        Write-Output 'error'
      }
    `;
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", script]);
    if (stdout.trim() !== "ok") return null;
    const data = await readFile(filePath);
    return { data, ext: "png" };
  } catch {
    return null;
  } finally {
    try {
      await unlink(filePath);
    } catch {
    }
    try {
      await rm(dir, { recursive: true });
    } catch {
    }
  }
}
async function run(command, args, maxStdoutBytes = TEXT_MAX_STDOUT_BYTES) {
  const result2 = await commandRunner.run({
    executable: await pinnedExecutable(command),
    args,
    env: process.env,
    timeoutMs: EXEC_TIMEOUT_MS,
    maxStdoutBytes,
    maxStderrBytes: MAX_STDERR_BYTES
  });
  if (!result2.ok) throw new Error(commandFailureMessage(result2));
  return result2;
}
function pinnedExecutable(command) {
  let descriptor = executableDescriptors.get(command);
  if (!descriptor) {
    descriptor = resolveExecutable(command);
    executableDescriptors.set(command, descriptor);
    void descriptor.catch(() => {
      if (executableDescriptors.get(command) === descriptor) executableDescriptors.delete(command);
    });
  }
  return descriptor;
}
function executableOnPath(command) {
  if (isAbsolute(command)) return canExecute(command);
  for (const entry of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    if (canExecute(resolve(entry, command))) return true;
  }
  return false;
}
function canExecute(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export { AGENT_SHOP_TEMPLATES, AdapterErrorKind, AgentNotFoundError, ERROR_HINTS, GoalHasPendingTasksError, MODEL_TIER_MAP, NotInitializedError, OrchestryError, ROLE_PERMISSIONS, SEMANTIC_ROLES, SUPPORTED_ADAPTERS, SkillLoader, TaskNotFoundError, WORKFLOW_PHASE_TRANSITIONS, WORKFLOW_SCHEMA_VERSION, WorkspaceError, canTransition, canTransitionWorkflow, classifyAdapterError, createRosterSnapshot, createTokenUsage, defaultModelForAdapter, detectClipboardType, discoverDeterministicChecks, getClipboardImage, getShopTemplateByKey, hashRosterAgent, hashRosterSnapshot, isAdapterKind, isBlocked, isClipboardToolAvailable, isDispatchable, isMcpSkill, isModelTier, isTerminal, isTerminalWorkflowPhase, legacyRosterSnapshot, resolveFailureStatus, resolveModel, templateToAgentInput, transitionWorkflow, validateCheckResults, validateCodexDecision, validateDeterministicCheckCommands, validateExplicitChecks, validateFableAdvice, validateFableFallbackRecord, validateFableQuery, validateHumanApproval, validateOpusResult, validateRosterAgent, validateRosterSnapshot };
