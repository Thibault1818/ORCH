import { HardenedGit } from './chunk-47ZZP7VU.js';
import { Paths } from './chunk-ANGKUOFG.js';
import { ProcessManager } from './chunk-W5CCIQAE.js';
import { canTransition, isTerminal } from './chunk-F3DKF5JN.js';
export { Orchestrator, canTransition, isBlocked, isDispatchable, isTerminal, resolveFailureStatus } from './chunk-F3DKF5JN.js';
export { createTokenUsage } from './chunk-UG72A2JI.js';
import { InvalidArgumentsError, TaskNotFoundError, InvalidTransitionError, AgentNotFoundError, OrchestryError, TeamNotFoundError, GoalNotFoundError, GoalHasPendingTasksError } from './chunk-Z7JNYNWE.js';
export { AdapterErrorKind, AgentNotFoundError, ERROR_HINTS, GoalHasPendingTasksError, NotInitializedError, OrchestryError, TaskNotFoundError, WorkspaceError, classifyAdapterError } from './chunk-Z7JNYNWE.js';
import { GOAL_LEAD_LABEL, GOAL_REVIEW_LABEL, AUTONOMOUS_LABEL } from './chunk-LMCD6ZPU.js';
import { CommandRunner, resolveExecutable, commandFailureMessage } from './chunk-OBMT332P.js';
export { DEFAULT_WORKFLOW_CONFIG, LegacyWorkflowRoleResolver, WORKFLOW_SCHEMA_VERSION, WorkflowEngine, validateCheckResults, validateCodexDecision, validateFableAdvice, validateFableFallbackRecord, validateFableQuery, validateHumanApproval, validateOpusResult } from './chunk-VMAB2NQK.js';
export { discoverDeterministicChecks, validateDeterministicCheckCommands, validateExplicitChecks } from './chunk-D6YHC656.js';
export { ARTIFACT_FILES, ROLE_PERMISSIONS, SEMANTIC_ROLES, WORKFLOW_PHASE_TRANSITIONS, WorkflowArtifactStore, canTransitionWorkflow, createRosterSnapshot, hashCanonical, hashRosterAgent, hashRosterSnapshot, isTerminalWorkflowPhase, legacyRosterSnapshot, transitionWorkflow, validateRosterAgent, validateRosterSnapshot } from './chunk-77BIYQ4K.js';
export { AdapterRegistry } from './chunk-6DWHQPTE.js';
export { SkillLoader } from './chunk-Y5P4NXTL.js';
import { ensureDir, atomicWrite, readJson, readYaml, writeYaml, writeJson, listFiles, appendJsonl, readJsonl, readJsonlTail, closeAppendHandle, pathExists } from './chunk-54K3JU53.js';
import { sanitizeText, sanitizeForPersistence } from './chunk-RQZGDMFG.js';
import fs2, { mkdtemp, readFile, unlink, rm, mkdir } from 'fs/promises';
import { constants, createWriteStream, createReadStream, accessSync, statSync } from 'fs';
import path2, { join, isAbsolute, delimiter, resolve } from 'path';
import { nanoid } from 'nanoid';
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { homedir, tmpdir } from 'os';

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

// src/application/event-bus.ts
var EventBus = class {
  handlers = /* @__PURE__ */ new Map();
  wildcardHandlers = /* @__PURE__ */ new Set();
  maxListeners = 10;
  warnedTypes = /* @__PURE__ */ new Set();
  /**
   * Set the maximum number of listeners per event type before a warning is emitted.
   * Helps detect memory leaks from repeated subscriptions in watch mode.
   */
  setMaxListeners(n) {
    this.maxListeners = n;
  }
  getMaxListeners() {
    return this.maxListeners;
  }
  /**
   * Get the number of listeners for a specific event type.
   */
  listenerCount(type) {
    return this.handlers.get(type)?.size ?? 0;
  }
  /**
   * Subscribe to events of a specific type.
   * Returns an unsubscribe function.
   */
  on(type, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, /* @__PURE__ */ new Set());
    }
    const set = this.handlers.get(type);
    set.add(handler);
    if (this.maxListeners > 0 && set.size > this.maxListeners && !this.warnedTypes.has(type)) {
      this.warnedTypes.add(type);
      console.warn(
        `EventBus: possible memory leak detected. ${set.size} listeners added for "${type}". Use setMaxListeners() to increase limit if this is intentional.`
      );
    }
    return () => this.off(type, handler);
  }
  /**
   * Subscribe to an event type, auto-unsubscribe after first call.
   */
  once(type, handler) {
    const wrapper = (event) => {
      this.off(type, wrapper);
      handler(event);
    };
    return this.on(type, wrapper);
  }
  /**
   * Unsubscribe a handler from an event type.
   */
  off(type, handler) {
    this.handlers.get(type)?.delete(handler);
  }
  /**
   * Emit an event synchronously to all subscribed handlers.
   */
  emit(event) {
    const typed = this.handlers.get(event.type);
    if (typed) this.dispatchToSet(typed, event, "handler");
    this.dispatchToSet(this.wildcardHandlers, event, "wildcard handler");
  }
  dispatchToSet(handlers, event, label) {
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`EventBus ${label} error for "${event.type}":`, err);
      }
    }
  }
  /**
   * Subscribe to ALL events regardless of type.
   */
  onAny(handler) {
    this.wildcardHandlers.add(handler);
    if (this.maxListeners > 0 && this.wildcardHandlers.size > this.maxListeners && !this.warnedTypes.has("*")) {
      this.warnedTypes.add("*");
      console.warn(
        `EventBus: possible memory leak detected. ${this.wildcardHandlers.size} wildcard listeners added. Use setMaxListeners() to increase limit if this is intentional.`
      );
    }
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }
  /**
   * Remove all handlers.
   */
  clear() {
    this.handlers.clear();
    this.wildcardHandlers.clear();
    this.warnedTypes.clear();
  }
};

// src/application/agent-factory.ts
function isMcpSkill(skill) {
  return skill.includes(":");
}
function templateToAgentInput(template, adapter) {
  const model = resolveModel(adapter, template.tier);
  const skills = adapter === "claude" ? template.skills : template.skills.filter((s) => !isMcpSkill(s));
  return {
    name: template.name,
    adapter,
    model: model || void 0,
    role: template.role,
    skills,
    approval_policy: template.approval_policy
  };
}
var TaskService = class {
  constructor(taskStore, eventBus, config, paths, agentStore) {
    this.taskStore = taskStore;
    this.eventBus = eventBus;
    this.config = config;
    this.paths = paths;
    this.agentStore = agentStore;
  }
  taskStore;
  eventBus;
  config;
  paths;
  agentStore;
  async create(input) {
    if (!input.title.trim()) {
      throw new InvalidArgumentsError("Task title is required");
    }
    const priority = input.priority ?? this.config.defaults.task.priority;
    if (!Number.isInteger(priority) || priority < 1 || priority > 4) {
      throw new InvalidArgumentsError("Priority must be an integer between 1 and 4");
    }
    if (input.depends_on?.length) {
      const results = await Promise.all(
        input.depends_on.map(async (depId) => ({ depId, exists: !!await this.taskStore.get(depId) }))
      );
      const missing = results.filter((r) => !r.exists).map((r) => r.depId);
      if (missing.length > 0) {
        throw new InvalidArgumentsError(
          `Unknown depends_on task ID(s): ${missing.join(", ")}`
        );
      }
    }
    const assignee = await this.resolveAssignee(input.assignee);
    if (input.goalTaskRole !== void 0 && !["lead_analysis", "worker", "lead_review"].includes(input.goalTaskRole)) {
      throw new InvalidArgumentsError('Goal role must be "worker"');
    }
    if ((input.goalTaskRole === "lead_analysis" || input.goalTaskRole === "lead_review") && input.systemGenerated !== true) {
      throw new InvalidArgumentsError("Lead goal roles are internal orchestration roles and cannot be set manually");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const labels = input.labels ? [...input.labels] : [];
    if (input.goalTaskRole === "lead_analysis" && !labels.includes(GOAL_LEAD_LABEL)) {
      labels.push(GOAL_LEAD_LABEL);
    }
    if (input.goalTaskRole === "lead_review" && !labels.includes(GOAL_REVIEW_LABEL)) {
      labels.push(GOAL_REVIEW_LABEL);
    }
    const task = {
      id: `tsk_${nanoid(7)}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      status: "todo",
      priority,
      assignee,
      labels,
      depends_on: input.depends_on ?? [],
      created_at: now,
      updated_at: now,
      attempts: 0,
      max_attempts: input.max_attempts ?? this.config.defaults.task.max_attempts,
      workspace_mode: input.workspace_mode,
      review_criteria: input.review_criteria,
      scope: input.scope,
      goalId: input.goalId,
      goalTaskRole: input.goalTaskRole,
      goalCycle: input.goalCycle
    };
    if (input.attachments?.length && this.paths) {
      const attachmentNames = await this.copyAttachments(task.id, input.attachments);
      task.attachments = attachmentNames;
    }
    await this.taskStore.save(task);
    this.eventBus.emit({ type: "task:created", task });
    return task;
  }
  async list(filter) {
    return this.taskStore.list(filter);
  }
  async get(id2) {
    const task = await this.taskStore.get(id2);
    if (!task) throw new TaskNotFoundError(id2);
    return task;
  }
  async updateStatus(id2, newStatus) {
    const task = await this.get(id2);
    const oldStatus = task.status;
    if (!canTransition(oldStatus, newStatus)) {
      throw new InvalidTransitionError(id2, oldStatus, newStatus);
    }
    task.status = newStatus;
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    this.eventBus.emit({
      type: "task:status_changed",
      taskId: id2,
      from: oldStatus,
      to: newStatus
    });
    return task;
  }
  async assign(taskId, agentId) {
    const task = await this.get(taskId);
    task.assignee = await this.resolveAssignee(agentId);
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    this.eventBus.emit({
      type: "task:assigned",
      taskId,
      agentId
    });
    return task;
  }
  async cancel(id2) {
    const task = await this.get(id2);
    if (isTerminal(task.status)) {
      throw new InvalidTransitionError(id2, task.status, "cancelled");
    }
    return this.updateStatus(id2, "cancelled");
  }
  async retry(id2) {
    const task = await this.get(id2);
    if (task.status !== "failed" && task.status !== "cancelled") {
      throw new InvalidTransitionError(id2, task.status, "todo");
    }
    const oldStatus = task.status;
    task.status = "todo";
    task.attempts = 0;
    task.last_error = void 0;
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    this.eventBus.emit({
      type: "task:status_changed",
      taskId: id2,
      from: oldStatus,
      to: "todo"
    });
    return task;
  }
  async reject(id2, feedback) {
    const task = await this.get(id2);
    if (task.status !== "review") {
      throw new InvalidTransitionError(id2, task.status, "todo");
    }
    const oldStatus = task.status;
    task.status = "todo";
    task.attempts = 0;
    task.feedback = feedback;
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    this.eventBus.emit({
      type: "task:status_changed",
      taskId: id2,
      from: oldStatus,
      to: "todo"
    });
    return task;
  }
  async update(id2, fields) {
    const task = await this.get(id2);
    if (fields.title !== void 0) {
      if (!fields.title.trim()) throw new InvalidArgumentsError("Task title cannot be empty");
      task.title = fields.title.trim();
    }
    if (fields.description !== void 0) task.description = fields.description.trim();
    if (fields.priority !== void 0) {
      if (!Number.isInteger(fields.priority) || fields.priority < 1 || fields.priority > 4) {
        throw new InvalidArgumentsError("Priority must be an integer between 1 and 4");
      }
      task.priority = fields.priority;
    }
    if (fields.labels !== void 0) task.labels = fields.labels;
    if (fields.attachments?.length && this.paths) {
      const attachmentNames = await this.copyAttachments(id2, fields.attachments);
      task.attachments = [...task.attachments ?? [], ...attachmentNames];
    }
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    return task;
  }
  async delete(id2) {
    const task = await this.get(id2);
    if (task.status === "in_progress") {
      throw new InvalidArgumentsError("Cannot delete a running task. Cancel it first.");
    }
    await this.taskStore.delete(id2);
    if (this.paths) {
      const dir = this.paths.taskAttachmentsDir(id2);
      await fs2.rm(dir, { recursive: true, force: true });
    }
  }
  getAttachmentPath(taskId, filename) {
    if (!this.paths) {
      throw new InvalidArgumentsError("Paths not configured");
    }
    validateAttachmentName(filename);
    const dir = this.paths.taskAttachmentsDir(taskId);
    const resolved = path2.resolve(dir, filename);
    if (!isWithin(resolved, path2.resolve(dir))) {
      throw new InvalidArgumentsError(`Invalid attachment filename: ${filename}`);
    }
    return resolved;
  }
  async copyAttachments(taskId, sourcePaths) {
    if (!this.paths) return [];
    const dir = this.paths.taskAttachmentsDir(taskId);
    await ensureDir(dir);
    const paths = this.paths;
    const projectRoot = path2.resolve(paths.root, "..");
    const realProjectRoot = await fs2.realpath(projectRoot);
    const realStateRoot = await fs2.realpath(paths.root).catch(() => paths.root);
    const realDestDir = path2.resolve(dir);
    const destDirStat = await fs2.lstat(realDestDir);
    if (!destDirStat.isDirectory() || destDirStat.isSymbolicLink()) {
      throw new InvalidArgumentsError(`Attachment destination is not a safe directory: ${realDestDir}`);
    }
    const actualDestDir = await fs2.realpath(realDestDir);
    if (!isWithin(actualDestDir, realStateRoot)) {
      throw new InvalidArgumentsError(`Attachment destination escaped state directory: ${realDestDir}`);
    }
    const validated = await Promise.all(
      sourcePaths.map(async (srcPath) => {
        let handle;
        try {
          const stat = await fs2.lstat(srcPath);
          if (!stat.isFile()) throw new Error("not a regular file");
          const realSource = await fs2.realpath(srcPath);
          if (!isWithin(realSource, realProjectRoot) || isWithin(realSource, realStateRoot)) {
            throw new Error("outside project or inside .orchestry");
          }
          handle = await fs2.open(srcPath, constants.O_RDONLY | constants.O_NOFOLLOW);
          const openedStat = await handle.stat();
          if (!openedStat.isFile() || openedStat.dev !== stat.dev || openedStat.ino !== stat.ino) {
            throw new Error("source changed during validation");
          }
          const basename = path2.basename(srcPath);
          validateAttachmentName(basename);
          return { handle, basename };
        } catch {
          await handle?.close().catch(() => {
          });
          throw new InvalidArgumentsError(`Attachment file not allowed: ${srcPath}`);
        }
      })
    );
    try {
      const names = await Promise.all(
        validated.map(async ({ handle, basename }) => {
          const dest = path2.resolve(realDestDir, basename);
          if (!isWithin(dest, realDestDir)) {
            throw new InvalidArgumentsError(`Attachment destination escaped task directory: ${basename}`);
          }
          const currentDestDir = await fs2.realpath(realDestDir);
          if (currentDestDir !== actualDestDir) {
            throw new InvalidArgumentsError(`Attachment destination changed during copy: ${basename}`);
          }
          await copyFromHandle(handle, dest);
          await fs2.chmod(dest, 384).catch(() => {
          });
          return basename;
        })
      );
      return names;
    } finally {
      await Promise.all(validated.map(({ handle }) => handle.close().catch(() => {
      })));
    }
  }
  async incrementAttempts(id2) {
    const task = await this.get(id2);
    task.attempts += 1;
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    return task;
  }
  /**
   * Resolve an assignee value to an agent ID.
   * Accepts: agent ID (agt_xxx), agent name, or undefined.
   * Returns the agent ID if found, or undefined if input is undefined.
   * Throws InvalidArgumentsError if non-empty value matches no agent.
   */
  async resolveAssignee(assignee) {
    if (!assignee) return void 0;
    if (!this.agentStore) return assignee;
    if (assignee.startsWith("agt_")) {
      const agent = await this.agentStore.get(assignee);
      if (agent) return agent.id;
      throw new InvalidArgumentsError(
        `Unknown agent ID: "${assignee}". No agent with this ID exists.`
      );
    }
    const byName = await this.agentStore.getByName(assignee);
    if (byName) return byName.id;
    throw new InvalidArgumentsError(
      `Unknown agent: "${assignee}". Use an agent ID (agt_xxx) or an exact agent name.`
    );
  }
};
function validateAttachmentName(name) {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new InvalidArgumentsError(`Invalid attachment filename: ${name}`);
  }
}
function isWithin(child, parent) {
  const rel = path2.relative(parent, child);
  return rel === "" || !rel.startsWith("..") && !path2.isAbsolute(rel);
}
async function copyFromHandle(handle, dest) {
  const writer = createWriteStream(dest, { flags: "wx", mode: 384 });
  const reader = createReadStream("", { fd: handle.fd, autoClose: false, start: 0 });
  await new Promise((resolve2, reject) => {
    const fail = (err) => {
      reader.destroy();
      writer.destroy();
      reject(err);
    };
    reader.on("error", fail);
    writer.on("error", fail);
    writer.on("finish", resolve2);
    reader.pipe(writer);
  });
}
var AgentService = class {
  constructor(agentStore, stateStore, eventBus, config) {
    this.agentStore = agentStore;
    this.stateStore = stateStore;
    this.eventBus = eventBus;
    this.config = config;
  }
  agentStore;
  stateStore;
  eventBus;
  config;
  async create(input) {
    if (!input.name.trim()) {
      throw new InvalidArgumentsError("Agent name is required");
    }
    const existing = await this.agentStore.getByName(input.name);
    if (existing) {
      throw new InvalidArgumentsError(`Agent "${input.name}" already exists`);
    }
    const agent = {
      id: `agt_${nanoid(7)}`,
      name: input.name.trim(),
      adapter: input.adapter || this.config.defaults.agent.adapter,
      role: input.role,
      config: {
        command: input.command,
        model: input.model,
        effort: input.effort,
        approval_policy: input.approval_policy ?? this.config.defaults.agent.approval_policy,
        max_turns: input.max_turns ?? this.config.defaults.agent.max_turns,
        timeout_ms: input.timeout_ms ?? this.config.defaults.agent.timeout_ms,
        stall_timeout_ms: input.stall_timeout_ms ?? this.config.defaults.agent.stall_timeout_ms,
        env: input.env,
        system_prompt: input.system_prompt,
        workspace_mode: input.workspace_mode,
        skills: input.skills
      },
      status: "idle",
      stats: {
        tasks_completed: 0,
        tasks_failed: 0,
        total_runs: 0,
        total_runtime_ms: 0
      }
    };
    await this.agentStore.save(agent);
    return agent;
  }
  async list() {
    return this.agentStore.list();
  }
  async get(id2) {
    const agent = await this.agentStore.get(id2);
    if (!agent) throw new AgentNotFoundError(id2);
    return agent;
  }
  async remove(id2) {
    const agent = await this.get(id2);
    if (agent.status === "running") {
      const state = await this.stateStore.read();
      const isActuallyRunning = Object.values(state.running).some((e) => e.agent_id === id2);
      if (isActuallyRunning) {
        throw new InvalidArgumentsError("Cannot remove a running agent. Stop it first.");
      }
      agent.status = "idle";
      await this.agentStore.save(agent);
    }
    await this.agentStore.delete(id2);
  }
  async update(id2, fields) {
    const agent = await this.get(id2);
    if (fields.name !== void 0) {
      if (!fields.name.trim()) throw new InvalidArgumentsError("Agent name cannot be empty");
      const existing = await this.agentStore.getByName(fields.name.trim());
      if (existing && existing.id !== id2) {
        throw new InvalidArgumentsError(`Agent "${fields.name}" already exists`);
      }
      agent.name = fields.name.trim();
    }
    if (fields.adapter !== void 0) {
      const adapter = fields.adapter.trim();
      if (!adapter) throw new InvalidArgumentsError("Agent adapter cannot be empty");
      agent.adapter = adapter;
    }
    if (fields.role !== void 0) agent.role = fields.role || void 0;
    if (fields.model !== void 0) agent.config.model = fields.model || void 0;
    if (fields.effort !== void 0) agent.config.effort = fields.effort || void 0;
    if (fields.approval_policy !== void 0) agent.config.approval_policy = fields.approval_policy;
    await this.agentStore.save(agent);
    return agent;
  }
  async disable(id2) {
    return this.setStatus(id2, "disabled");
  }
  async enable(id2) {
    return this.setStatus(id2, "idle");
  }
  async setAutonomous(id2, enabled) {
    const agent = await this.get(id2);
    agent.autonomous = enabled;
    await this.agentStore.save(agent);
    this.eventBus.emit({ type: "agent:autonomous_toggled", agentId: id2, autonomous: enabled });
    return agent;
  }
  async setStatus(id2, status) {
    const agent = await this.get(id2);
    agent.status = status;
    await this.agentStore.save(agent);
    return agent;
  }
  async updateStats(id2, update) {
    const agent = await this.get(id2);
    Object.assign(agent.stats, update);
    await this.agentStore.save(agent);
    return agent;
  }
  /**
   * Find the best available agent for a task using scoring.
   *
   * Scoring:
   * - Explicit assignee match = 100
   * - Skill match with task labels = 50 per match
   * - Role match with task labels = 30
   * - Idle status bonus = 20
   * - Success rate bonus = 0–10 (scaled by completed / total)
   */
  async findBestAgent(task) {
    const agents = await this.agentStore.list();
    const available = agents.filter(
      (a) => a.status === "idle"
    );
    if (available.length === 0) return null;
    if (task.assignee) {
      const assigned = agents.find((a) => a.id === task.assignee || a.name === task.assignee);
      if (assigned && assigned.status === "idle") return assigned;
      return null;
    }
    const lowerLabels = task.labels?.length ? task.labels.map((l) => l.toLowerCase()) : void 0;
    const scored = available.map((agent) => {
      let score = 0;
      if (lowerLabels && agent.config.skills?.length) {
        const skillSet = new Set(agent.config.skills.map((s) => s.toLowerCase()));
        for (const label of lowerLabels) {
          if (skillSet.has(label)) {
            score += 50;
          }
        }
      }
      if (lowerLabels && agent.role) {
        const lowerRole = agent.role.toLowerCase();
        if (lowerLabels.some((l) => lowerRole.includes(l))) {
          score += 30;
        }
      }
      if (agent.status === "idle") {
        score += 20;
      }
      const totalTasks = agent.stats.tasks_completed + agent.stats.tasks_failed;
      if (totalTasks > 0) {
        score += Math.round(agent.stats.tasks_completed / totalTasks * 10);
      }
      return { agent, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.agent ?? null;
  }
};
var RunService = class {
  constructor(runStore, eventBus) {
    this.runStore = runStore;
    this.eventBus = eventBus;
  }
  runStore;
  eventBus;
  async create(params) {
    const run2 = {
      id: `run_${nanoid(7)}`,
      task_id: params.taskId,
      agent_id: params.agentId,
      attempt: params.attempt,
      status: "preparing",
      started_at: (/* @__PURE__ */ new Date()).toISOString(),
      workspace_path: params.workspacePath,
      prompt: params.persistPrompt ? params.prompt : "[redacted]"
    };
    await this.runStore.save(run2);
    return run2;
  }
  async get(id2) {
    return this.runStore.get(id2);
  }
  async start(id2, pid) {
    const run2 = await this.runStore.get(id2);
    if (!run2) throw new Error(`Run not found: ${id2}`);
    run2.status = "running";
    run2.pid = pid;
    await this.runStore.save(run2);
    this.eventBus.emit({
      type: "agent:started",
      agentId: run2.agent_id,
      taskId: run2.task_id,
      runId: id2
    });
    return run2;
  }
  async finish(id2, status, tokens, error, failure) {
    const run2 = await this.runStore.get(id2);
    if (!run2) throw new Error(`Run not found: ${id2}`);
    run2.status = status;
    run2.finished_at = (/* @__PURE__ */ new Date()).toISOString();
    run2.tokens = tokens;
    run2.error = error === void 0 ? void 0 : sanitizeText(error);
    run2.failure = failure;
    await this.runStore.save(run2);
    this.eventBus.emit({
      type: "agent:completed",
      runId: id2,
      agentId: run2.agent_id,
      success: status === "succeeded"
    });
    return run2;
  }
  async appendEvent(runId, event) {
    await this.runStore.appendEvent(runId, event);
  }
  async listAll() {
    return this.runStore.listAll();
  }
  async listForTask(taskId) {
    return this.runStore.listForTask(taskId);
  }
  async listForAgent(agentId) {
    return this.runStore.listForAgent(agentId);
  }
  async readEvents(runId) {
    return this.runStore.readEvents(runId);
  }
  async readEventsTail(runId, count) {
    return this.runStore.readEventsTail(runId, count);
  }
  /**
   * Get error and last N lines of output from the most recent failed run for a task.
   * Used to provide retry context so agents can learn from previous failures.
   */
  async getLastFailedRunContext(taskId) {
    const runs = await this.runStore.listForTask(taskId);
    const failedRun = runs.filter((r) => r.status === "failed").sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))[0];
    if (!failedRun) return null;
    const error = failedRun.error ?? "Unknown error";
    let output = "";
    try {
      const events = await this.runStore.readEventsTail(failedRun.id, 50);
      output = events.filter((e) => e.type === "agent_output" || e.type === "error").map((e) => typeof e.data === "string" ? e.data : JSON.stringify(e.data)).join("\n");
    } catch {
    }
    return { error, output };
  }
};

// src/domain/governance/contracts-v3.ts
var GOVERNANCE_SCHEMA_VERSION = 3;
var GOVERNANCE_KINDS = ["binding_snapshot", "decomposition_plan", "check_binding", "candidate_evidence", "review_vote", "quorum_policy", "quorum_result", "integration_receipt", "human_approval"];
var ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var HASH = /^[a-f0-9]{64}$/;
var COMMIT = /^[a-f0-9]{40,64}$/;
var MAX_ITEMS = 256;
var MAX_TEXT = 128e3;
function validateGovernanceRecordV3(value) {
  const o = record(value, "governance record");
  const kind = one(o.kind, GOVERNANCE_KINDS, "kind");
  if (kind === "binding_snapshot") return validateBindingSnapshotV3(o);
  if (kind === "decomposition_plan") return validateDecompositionPlanV3(o);
  if (kind === "check_binding") return validateCheckBindingV3(o);
  if (kind === "candidate_evidence") return validateCandidateEvidenceV3(o);
  if (kind === "review_vote") return validateReviewVoteV3(o);
  if (kind === "quorum_policy") return validateQuorumPolicyV3(o);
  if (kind === "quorum_result") return validateQuorumResultV3(o);
  if (kind === "integration_receipt") return validateIntegrationReceiptV3(o);
  return validateHumanApprovalV3(o);
}
function validateBindingSnapshotV3(value) {
  const o = exact(value, ["schema_version", "kind", "governance_id", "record_id", "bindings", "created_at"], "binding snapshot");
  base(o, "binding_snapshot");
  const bindings = unique(items(o.bindings, "bindings").map((v, i) => {
    const b = exact(v, ["binding_id", "role", "principal_id", "adapter", "model"], `bindings[${i}]`);
    return { binding_id: id(b.binding_id), role: one(b.role, ["planner", "candidate", "reviewer", "checker", "integrator"], "role"), principal_id: id(b.principal_id), adapter: id(b.adapter), model: short(b.model, "model", true) };
  }), (b) => b.binding_id, "binding IDs");
  if (!bindings.length) throw new Error("bindings must not be empty");
  return { ...base(o, "binding_snapshot"), bindings, created_at: timestamp(o.created_at) };
}
function validateDecompositionPlanV3(value) {
  const o = exact(value, ["schema_version", "kind", "governance_id", "record_id", "binding_snapshot", "objective", "base_commit", "target_branch", "units", "integration_check_ids", "created_by_binding_id", "created_at"], "decomposition plan");
  const units = unique(items(o.units, "units").map((v, i) => {
    const u = exact(v, ["unit_id", "objective", "depends_on", "owned_path_prefixes", "acceptance_criteria", "required_check_ids"], `units[${i}]`);
    const paths = unique(strings(u.owned_path_prefixes, "owned_path_prefixes").map(safePath), String, "owned paths");
    if (!paths.length) throw new Error("owned_path_prefixes must not be empty");
    return { unit_id: id(u.unit_id), objective: short(u.objective, "objective"), depends_on: unique(strings(u.depends_on, "depends_on").map(id), String, "dependencies"), owned_path_prefixes: paths, acceptance_criteria: strings(u.acceptance_criteria, "acceptance_criteria"), required_check_ids: unique(strings(u.required_check_ids, "required_check_ids").map(id), String, "check IDs") };
  }), (u) => u.unit_id, "unit IDs");
  if (!units.length) throw new Error("units must not be empty");
  validateDag(units);
  return { ...base(o, "decomposition_plan"), binding_snapshot: ref(o.binding_snapshot, "binding_snapshot"), objective: short(o.objective, "objective"), base_commit: commit(o.base_commit), target_branch: branch(o.target_branch), units, integration_check_ids: unique(strings(o.integration_check_ids, "integration_check_ids").map(id), String, "integration check IDs"), created_by_binding_id: id(o.created_by_binding_id), created_at: timestamp(o.created_at) };
}
function validateCheckBindingV3(value) {
  const o = exact(value, ["schema_version", "kind", "governance_id", "record_id", "binding_snapshot", "subject", "check_id", "command", "status", "output_hash", "executed_by_binding_id", "provenance", "started_at", "completed_at"], "check binding");
  const s = exact(o.subject, ["kind", "id", "commit"], "check subject");
  const p = exact(o.provenance, ["command_source", "execution_environment"], "check provenance");
  const started = timestamp(o.started_at);
  const completed = timestamp(o.completed_at);
  if (completed < started) throw new Error("completed_at precedes started_at");
  return { ...base(o, "check_binding"), binding_snapshot: ref(o.binding_snapshot, "binding_snapshot"), subject: { kind: one(s.kind, ["candidate", "integration"], "subject kind"), id: id(s.id), commit: commit(s.commit) }, check_id: id(o.check_id), command: short(o.command, "command"), status: one(o.status, ["passed", "failed"], "status"), output_hash: hash(o.output_hash), executed_by_binding_id: id(o.executed_by_binding_id), provenance: { command_source: one(p.command_source, ["trusted"], "command source"), execution_environment: one(p.execution_environment, ["sandboxed"], "execution environment") }, started_at: started, completed_at: completed };
}
function validateCandidateEvidenceV3(value) {
  const o = exact(value, ["schema_version", "kind", "governance_id", "record_id", "plan", "binding_snapshot", "unit_id", "candidate_id", "produced_by_binding_id", "base_commit", "commit", "diff_hash", "changed_paths", "check_bindings", "summary", "created_at"], "candidate evidence");
  const baseCommit = commit(o.base_commit), candidateCommit = commit(o.commit);
  if (baseCommit === candidateCommit) throw new Error("candidate commit must differ from base");
  return { ...base(o, "candidate_evidence"), plan: ref(o.plan, "decomposition_plan"), binding_snapshot: ref(o.binding_snapshot, "binding_snapshot"), unit_id: id(o.unit_id), candidate_id: id(o.candidate_id), produced_by_binding_id: id(o.produced_by_binding_id), base_commit: baseCommit, commit: candidateCommit, diff_hash: hash(o.diff_hash), changed_paths: unique(strings(o.changed_paths, "changed_paths").map(safePath), String, "changed paths"), check_bindings: refs(o.check_bindings, "check_binding"), summary: short(o.summary, "summary"), created_at: timestamp(o.created_at) };
}
function validateReviewVoteV3(value) {
  const o = exact(value, ["schema_version", "kind", "governance_id", "record_id", "binding_snapshot", "subject", "reviewer_binding_id", "decision", "reason", "cast_at"], "review vote");
  return { ...base(o, "review_vote"), binding_snapshot: ref(o.binding_snapshot, "binding_snapshot"), subject: subjectRef(o.subject), reviewer_binding_id: id(o.reviewer_binding_id), decision: one(o.decision, ["approve", "reject"], "decision"), reason: short(o.reason, "reason"), cast_at: timestamp(o.cast_at) };
}
function validateQuorumPolicyV3(value) {
  const o = exact(value, ["schema_version", "kind", "governance_id", "record_id", "binding_snapshot", "applies_to", "eligible_reviewer_binding_ids", "minimum_approvals", "maximum_rejections", "require_distinct_principals", "human_approval_required", "created_by_binding_id", "created_at"], "quorum policy");
  const eligible = unique(strings(o.eligible_reviewer_binding_ids, "eligible reviewers").map(id), String, "eligible reviewers");
  const minimum = integer(o.minimum_approvals, "minimum_approvals");
  if (!eligible.length || minimum < 1 || minimum > eligible.length) throw new Error("invalid quorum minimum");
  return { ...base(o, "quorum_policy"), binding_snapshot: ref(o.binding_snapshot, "binding_snapshot"), applies_to: one(o.applies_to, ["candidate_evidence", "integration_receipt"], "applies_to"), eligible_reviewer_binding_ids: eligible, minimum_approvals: minimum, maximum_rejections: integer(o.maximum_rejections, "maximum_rejections"), require_distinct_principals: bool(o.require_distinct_principals), human_approval_required: bool(o.human_approval_required), created_by_binding_id: id(o.created_by_binding_id), created_at: timestamp(o.created_at) };
}
function validateHumanApprovalV3(value) {
  const o = exact(value, ["schema_version", "kind", "governance_id", "record_id", "subject", "approved_by", "reason", "approved_at"], "human approval");
  return { ...base(o, "human_approval"), subject: subjectRef(o.subject), approved_by: short(o.approved_by, "approved_by"), reason: short(o.reason, "reason"), approved_at: timestamp(o.approved_at) };
}
function validateQuorumResultV3(value) {
  const o = exact(value, ["schema_version", "kind", "governance_id", "record_id", "policy", "subject", "votes", "human_approval", "approvals", "rejections", "satisfied", "evaluated_at"], "quorum result");
  const votes = refs(o.votes, "review_vote"), approvals = integer(o.approvals, "approvals"), rejections = integer(o.rejections, "rejections");
  if (approvals + rejections !== votes.length) throw new Error("quorum counts do not match votes");
  return { ...base(o, "quorum_result"), policy: ref(o.policy, "quorum_policy"), subject: subjectRef(o.subject), votes, human_approval: o.human_approval === null ? null : ref(o.human_approval, "human_approval"), approvals, rejections, satisfied: bool(o.satisfied), evaluated_at: timestamp(o.evaluated_at) };
}
function validateIntegrationReceiptV3(value) {
  const o = exact(value, ["schema_version", "kind", "governance_id", "record_id", "plan", "binding_snapshot", "integrated_by_binding_id", "target_branch", "base_commit", "candidates", "integrated_commit", "diff_hash", "check_bindings", "integrated_at"], "integration receipt");
  const candidates = items(o.candidates, "candidates").map((v, i) => {
    const c = exact(v, ["evidence", "quorum_result"], `candidates[${i}]`);
    return { evidence: ref(c.evidence, "candidate_evidence"), quorum_result: ref(c.quorum_result, "quorum_result") };
  });
  unique(candidates, (c) => c.evidence.record_id, "integration candidates");
  if (!candidates.length) throw new Error("integration candidates must not be empty");
  return { ...base(o, "integration_receipt"), plan: ref(o.plan, "decomposition_plan"), binding_snapshot: ref(o.binding_snapshot, "binding_snapshot"), integrated_by_binding_id: id(o.integrated_by_binding_id), target_branch: branch(o.target_branch), base_commit: commit(o.base_commit), candidates, integrated_commit: commit(o.integrated_commit), diff_hash: hash(o.diff_hash), check_bindings: refs(o.check_bindings, "check_binding"), integrated_at: timestamp(o.integrated_at) };
}
function base(o, kind) {
  if (o.schema_version !== 3 || o.kind !== kind) throw new Error(`Expected governance ${kind} schema v3`);
  return { schema_version: 3, kind, governance_id: id(o.governance_id), record_id: id(o.record_id) };
}
function ref(v, kind) {
  const o = exact(v, ["kind", "record_id", "record_hash"], "reference");
  if (o.kind !== kind) throw new Error(`Expected ${kind} reference`);
  return { kind, record_id: id(o.record_id), record_hash: hash(o.record_hash) };
}
function refs(v, k) {
  return unique(items(v, "references").map((x) => ref(x, k)), (x) => x.record_id, "references");
}
function subjectRef(v) {
  const o = record(v, "subject");
  return o.kind === "candidate_evidence" ? ref(o, "candidate_evidence") : ref(o, "integration_receipt");
}
function validateDag(units) {
  const ids = new Set(units.map((u) => u.unit_id));
  for (const u of units) for (const d of u.depends_on) if (!ids.has(d) || d === u.unit_id) throw new Error("Invalid unit dependency");
  const visiting = /* @__PURE__ */ new Set(), done = /* @__PURE__ */ new Set();
  const visit = (id2) => {
    if (visiting.has(id2)) throw new Error("Decomposition cycle");
    if (done.has(id2)) return;
    visiting.add(id2);
    for (const d of units.find((u) => u.unit_id === id2).depends_on) visit(d);
    visiting.delete(id2);
    done.add(id2);
  };
  for (const u of units) visit(u.unit_id);
}
function exact(v, keys, label) {
  const o = record(v, label), set = new Set(keys);
  for (const k of keys) if (!(k in o)) throw new Error(`${label} missing ${k}`);
  for (const k of Object.keys(o)) if (!set.has(k)) throw new Error(`${label} unknown field ${k}`);
  return o;
}
function record(v, label) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${label} must be an object`);
  return v;
}
function items(v, label) {
  if (!Array.isArray(v) || v.length > MAX_ITEMS) throw new Error(`${label} must be a bounded array`);
  return v;
}
function strings(v, label) {
  return items(v, label).map((x) => short(x, label, true));
}
function short(v, label, empty = false) {
  if (typeof v !== "string" || v.length > MAX_TEXT || !empty && !v.trim()) throw new Error(`${label} is invalid`);
  return v;
}
function id(v) {
  const s = short(v, "id");
  if (!ID.test(s)) throw new Error("Invalid id");
  return s;
}
function hash(v) {
  const s = short(v, "hash");
  if (!HASH.test(s)) throw new Error("Invalid SHA-256 hash");
  return s;
}
function commit(v) {
  const s = short(v, "commit");
  if (!COMMIT.test(s)) throw new Error("Invalid commit");
  return s;
}
function validateGovernanceBranchV3(v) {
  const s = short(v, "branch");
  if (s.length > 255 || s === "@" || s.startsWith("-") || s.startsWith("/") || s.startsWith("refs/") || s.endsWith("/") || s.endsWith(".") || s.includes("..") || s.includes("//") || s.includes("@{") || /[\\\x00-\x20~^:?*[\]]/.test(s) || s.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))) throw new Error("Invalid Git branch name");
  return s;
}
function branch(v) {
  return validateGovernanceBranchV3(v);
}
function timestamp(v) {
  const s = short(v, "timestamp");
  if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) throw new Error("Invalid canonical timestamp");
  return s;
}
function integer(v, label) {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${label} must be a nonnegative integer`);
  return v;
}
function bool(v) {
  if (typeof v !== "boolean") throw new Error("Expected boolean");
  return v;
}
function one(v, allowed, label) {
  if (typeof v !== "string" || !allowed.includes(v)) throw new Error(`Invalid ${label}`);
  return v;
}
function safePath(v) {
  if (v.startsWith("/") || v.includes("\\") || v.split("/").some((p) => !p || p === "." || p === "..")) throw new Error("Unsafe governance path");
  return v;
}
function unique(values, key, label) {
  const seen = /* @__PURE__ */ new Set();
  for (const v of values) {
    const k = key(v);
    if (seen.has(k)) throw new Error(`Duplicate ${label}`);
    seen.add(k);
  }
  return values;
}
var GovernanceStoreV3 = class {
  constructor(projectRoot, controllerKeyPath) {
    this.controllerKeyPath = controllerKeyPath;
    this.projectRoot = path2.resolve(projectRoot);
    this.root = path2.join(this.projectRoot, ".orchestry", "governance", "v3");
    if (!path2.isAbsolute(controllerKeyPath) || contains(this.projectRoot, controllerKeyPath)) throw new Error("Governance controller key must use an absolute path outside the repository");
  }
  controllerKeyPath;
  root;
  projectRoot;
  async put(input) {
    const record2 = validateGovernanceRecordV3(sanitizeForPersistence(input));
    return this.lock(record2.governance_id, async () => {
      await this.validateReferences(record2);
      const recordHash = hashCanonical2(record2);
      const envelope = { storage_version: 1, record_hash: recordHash, record_hmac: await this.sign(recordHash, record2), record: record2 };
      const file = this.file(record2.governance_id, record2.kind, record2.record_id);
      const existing = await this.read(record2.governance_id, record2.kind, record2.record_id);
      if (existing) {
        if (existing.record_hash !== envelope.record_hash) throw new Error(`Conflicting governance record: ${record2.record_id}`);
        return existing;
      }
      await ensureDir(path2.dirname(file));
      await fs2.chmod(this.caseRoot(record2.governance_id), 448).catch(() => {
      });
      await fs2.mkdir(path2.dirname(file), { recursive: true, mode: 448 });
      await atomicWrite(file, JSON.stringify(envelope, null, 2));
      return envelope;
    });
  }
  async read(governanceId, kind, recordId) {
    safeId(governanceId);
    safeId(recordId);
    if (!GOVERNANCE_KINDS.includes(kind)) throw new Error("Invalid governance kind");
    const value = await readJson(this.file(governanceId, kind, recordId));
    if (value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid governance envelope");
    const o = value;
    if (Object.keys(o).sort().join(",") !== "record,record_hash,record_hmac,storage_version" || o.storage_version !== 1 || typeof o.record_hash !== "string" || typeof o.record_hmac !== "string") throw new Error("Invalid governance envelope");
    const record2 = validateGovernanceRecordV3(o.record);
    const expectedHash = hashCanonical2(record2);
    const expectedHmac = await this.sign(expectedHash, record2);
    if (record2.governance_id !== governanceId || record2.kind !== kind || record2.record_id !== recordId || expectedHash !== o.record_hash || !safeEqual(expectedHmac, o.record_hmac)) throw new Error("Governance record integrity check failed");
    return { storage_version: 1, record_hash: o.record_hash, record_hmac: o.record_hmac, record: record2 };
  }
  async list(governanceId, kind) {
    safeId(governanceId);
    if (!GOVERNANCE_KINDS.includes(kind)) throw new Error("Invalid governance kind");
    const dir = path2.join(this.caseRoot(governanceId), "records", kind);
    let names;
    try {
      names = await fs2.readdir(dir);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const records = await Promise.all(names.filter((name) => name.endsWith(".json")).sort().map((name) => this.read(governanceId, kind, name.slice(0, -5))));
    return records.filter((value) => value !== null);
  }
  async validateReferences(record2) {
    for (const reference of collectReferences(record2)) {
      const target = await this.read(record2.governance_id, reference.kind, reference.record_id);
      if (!target || target.record_hash !== reference.record_hash) throw new Error(`Missing or stale governance reference: ${reference.kind}/${reference.record_id}`);
    }
  }
  caseRoot(id2) {
    return path2.join(this.root, safeId(id2));
  }
  file(id2, kind, recordId) {
    return path2.join(this.caseRoot(id2), "records", kind, `${safeId(recordId)}.json`);
  }
  async sign(recordHash, record2) {
    const key = await this.key();
    return createHmac("sha256", key).update(canonical({ storage_version: 1, record_hash: recordHash, record: record2 })).digest("hex");
  }
  async key() {
    const [projectRealPath, keyRealPath] = await Promise.all([fs2.realpath(this.projectRoot), fs2.realpath(this.controllerKeyPath).catch((error) => {
      if (error.code === "ENOENT") throw new Error("Governance controller key is missing");
      throw error;
    })]);
    if (contains(projectRealPath, keyRealPath)) throw new Error("Governance controller key resolves inside the repository");
    const stat = await fs2.lstat(this.controllerKeyPath).catch((error) => {
      if (error.code === "ENOENT") throw new Error("Governance controller key is missing");
      throw error;
    });
    if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== "win32" && (stat.mode & 511) !== 384) throw new Error("Governance controller key must be a regular 0600 file");
    if (process.getuid && stat.uid !== process.getuid()) throw new Error("Governance controller key must be owned by the current user");
    const key = await fs2.readFile(this.controllerKeyPath);
    if (key.length < 32) throw new Error("Governance controller key must contain at least 32 bytes");
    return key;
  }
  async lock(governanceId, work) {
    const root = this.caseRoot(governanceId);
    await fs2.mkdir(root, { recursive: true, mode: 448 });
    await fs2.chmod(root, 448).catch(() => {
    });
    const lock = path2.join(root, ".governance.lock");
    const deadline = Date.now() + 5e3;
    while (true) {
      try {
        await fs2.mkdir(lock, { mode: 448 });
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const stat = await fs2.stat(lock).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 3e4) {
          await fs2.rm(lock, { recursive: true, force: true });
          continue;
        }
        if (Date.now() > deadline) throw new Error(`Governance lock is active: ${governanceId}`);
        await new Promise((resolve2) => setTimeout(resolve2, 10));
      }
    }
    try {
      return await work();
    } finally {
      await fs2.rm(lock, { recursive: true, force: true });
    }
  }
};
function hashGovernanceRecordV3(value) {
  return hashCanonical2(validateGovernanceRecordV3(value));
}
function hashCanonical2(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
function safeId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("Invalid governance id");
  return value;
}
function safeEqual(left, right) {
  const a = Buffer.from(left, "hex"), b = Buffer.from(right, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}
function contains(root, candidate) {
  const relative = path2.relative(root, path2.resolve(candidate));
  return relative === "" || !relative.startsWith(`..${path2.sep}`) && relative !== ".." && !path2.isAbsolute(relative);
}
function collectReferences(value) {
  const refs2 = [];
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const o = v;
    if (typeof o.kind === "string" && typeof o.record_id === "string" && typeof o.record_hash === "string" && Object.keys(o).length === 3) refs2.push(o);
    else Object.values(o).forEach(walk);
  };
  walk(value);
  return refs2;
}

// src/application/governance/governance-service-v3.ts
var GovernanceServiceV3 = class {
  constructor(store, git) {
    this.store = store;
    this.git = git;
  }
  store;
  git;
  async savePlan(plan) {
    const snapshot = await this.required(plan.governance_id, plan.binding_snapshot);
    const bindings = snapshot.record.bindings;
    const planner = bindings.find((binding) => binding.binding_id === plan.created_by_binding_id);
    if (!planner || planner.role !== "planner") throw new Error("Decomposition plan creator is not the bound planner");
    assertNoParallelScopeOverlap(plan);
    return this.store.put(plan);
  }
  async saveCandidate(candidate) {
    const [planStored, snapshotStored] = await Promise.all([
      this.required(candidate.governance_id, candidate.plan),
      this.required(candidate.governance_id, candidate.binding_snapshot)
    ]);
    const plan = planStored.record;
    const snapshot = snapshotStored.record;
    if (candidate.plan.record_hash !== hashGovernanceRecordV3(plan) || candidate.binding_snapshot.record_hash !== hashGovernanceRecordV3(snapshot)) throw new Error("Candidate references stale governance inputs");
    if (!sameRef(candidate.binding_snapshot, plan.binding_snapshot)) throw new Error("Candidate binding snapshot does not match its plan");
    const unit = plan.units.find((item) => item.unit_id === candidate.unit_id);
    if (!unit || candidate.base_commit !== plan.base_commit) throw new Error("Candidate does not match its decomposition unit");
    const producer = snapshot.bindings.find((binding) => binding.binding_id === candidate.produced_by_binding_id);
    if (!producer || producer.role !== "candidate") throw new Error("Candidate producer is not a candidate binding");
    const outside = candidate.changed_paths.filter((file) => !unit.owned_path_prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)));
    if (outside.length) throw new Error(`Candidate changed paths outside owned scope: ${outside.join(", ")}`);
    const actual = await this.git.recompute(candidate.base_commit, candidate.commit);
    if (candidate.diff_hash !== actual.diff_hash || !sameOrdered(candidate.changed_paths, actual.changed_paths)) throw new Error("Candidate Git evidence does not match repository state");
    const checks = await Promise.all(candidate.check_bindings.map(async (reference) => (await this.required(candidate.governance_id, reference)).record));
    const checkIds = checks.map((check) => check.check_id);
    if (!sameSet(checkIds, unit.required_check_ids)) throw new Error("Candidate checks do not exactly cover required check IDs");
    for (const check of checks) {
      if (!sameRef(check.binding_snapshot, candidate.binding_snapshot) || !isTrustedCheck(check, snapshot) || check.status !== "passed" || check.subject.kind !== "candidate" || check.subject.id !== candidate.candidate_id || check.subject.commit !== candidate.commit) throw new Error("Candidate check is failed, untrusted, or bound to different evidence");
    }
    return this.store.put(candidate);
  }
  async saveReviewVote(vote) {
    const [snapshotStored, subjectStored] = await Promise.all([
      this.required(vote.governance_id, vote.binding_snapshot),
      this.required(vote.governance_id, vote.subject)
    ]);
    const snapshot = snapshotStored.record;
    const subject = subjectStored.record;
    if (!sameRef(vote.binding_snapshot, subject.binding_snapshot)) throw new Error("Review vote binding snapshot does not match its subject");
    const reviewer = snapshot.bindings.find((binding) => binding.binding_id === vote.reviewer_binding_id);
    if (!reviewer || reviewer.role !== "reviewer") throw new Error("Review vote is not from a reviewer binding");
    const authorId = subject.kind === "candidate_evidence" ? subject.produced_by_binding_id : subject.integrated_by_binding_id;
    const author = snapshot.bindings.find((binding) => binding.binding_id === authorId);
    if (!author || author.principal_id === reviewer.principal_id) throw new Error("Reviewer cannot review its own principal evidence");
    return this.store.put(vote);
  }
  async evaluateQuorum(input) {
    const [policyStored, subjectStored, ...voteStored] = await Promise.all([
      this.required(input.governance_id, input.policy),
      this.required(input.governance_id, input.subject),
      ...input.votes.map((vote) => this.required(input.governance_id, vote))
    ]);
    const policy = policyStored.record;
    if (policy.applies_to !== subjectStored.record.kind) throw new Error("Quorum policy does not apply to subject kind");
    const snapshot = (await this.required(input.governance_id, policy.binding_snapshot)).record;
    if (!sameRef(policy.binding_snapshot, subjectStored.record.binding_snapshot)) throw new Error("Quorum policy binding snapshot does not match its subject");
    const votes = voteStored.map((stored) => stored.record);
    const reviewers = /* @__PURE__ */ new Set();
    const principals = /* @__PURE__ */ new Set();
    for (const vote of votes) {
      if (!sameRef(vote.binding_snapshot, policy.binding_snapshot) || !sameRef(vote.subject, input.subject) || !policy.eligible_reviewer_binding_ids.includes(vote.reviewer_binding_id) || reviewers.has(vote.reviewer_binding_id)) throw new Error("Quorum contains duplicate, ineligible, or mismatched vote");
      reviewers.add(vote.reviewer_binding_id);
      const binding = snapshot.bindings.find((item) => item.binding_id === vote.reviewer_binding_id);
      if (!binding) throw new Error("Quorum reviewer binding is missing");
      if (policy.require_distinct_principals && principals.has(binding.principal_id)) throw new Error("Quorum reviewers must use distinct principals");
      principals.add(binding.principal_id);
    }
    let human = null;
    if (input.human_approval) {
      human = await this.required(input.governance_id, input.human_approval);
      if (!sameRef(human.record.subject, input.subject)) throw new Error("Human approval targets different evidence");
    }
    const approvals = votes.filter((vote) => vote.decision === "approve").length;
    const rejections = votes.length - approvals;
    const satisfied = approvals >= policy.minimum_approvals && rejections <= policy.maximum_rejections && (!policy.human_approval_required || human !== null);
    return this.store.put({ schema_version: 3, kind: "quorum_result", governance_id: input.governance_id, record_id: input.record_id, policy: input.policy, subject: input.subject, votes: input.votes, human_approval: input.human_approval ?? null, approvals, rejections, satisfied, evaluated_at: input.evaluated_at });
  }
  async saveIntegration(receipt) {
    const [planStored, snapshotStored] = await Promise.all([this.required(receipt.governance_id, receipt.plan), this.required(receipt.governance_id, receipt.binding_snapshot)]);
    const plan = planStored.record;
    const snapshot = snapshotStored.record;
    if (receipt.target_branch !== plan.target_branch || receipt.base_commit !== plan.base_commit) throw new Error("Integration does not match decomposition target");
    if (!sameRef(receipt.binding_snapshot, plan.binding_snapshot)) throw new Error("Integration binding snapshot does not match its plan");
    const integrator = snapshot.bindings.find((binding) => binding.binding_id === receipt.integrated_by_binding_id);
    if (!integrator || integrator.role !== "integrator") throw new Error("Integration actor is not the bound integrator");
    if (receipt.candidates.length !== plan.units.length) throw new Error("Integration must contain exactly one candidate per decomposition unit");
    const units = /* @__PURE__ */ new Set();
    const approvedPaths = /* @__PURE__ */ new Set();
    for (const item of receipt.candidates) {
      const [candidateStored, quorumStored] = await Promise.all([this.required(receipt.governance_id, item.evidence), this.required(receipt.governance_id, item.quorum_result)]);
      const candidate = candidateStored.record;
      const quorum = quorumStored.record;
      if (!quorum.satisfied || !sameRef(quorum.subject, item.evidence) || !sameRef(candidate.plan, receipt.plan) || !sameRef(candidate.binding_snapshot, receipt.binding_snapshot)) throw new Error("Integration candidate lacks matching plan, snapshot, and satisfied quorum");
      if (units.has(candidate.unit_id) || !plan.units.some((unit) => unit.unit_id === candidate.unit_id)) throw new Error("Integration has duplicate or unknown decomposition units");
      units.add(candidate.unit_id);
      for (const value of candidate.changed_paths) {
        if (approvedPaths.has(value)) throw new Error(`Integration candidates overlap changed path: ${value}`);
        approvedPaths.add(value);
      }
      const actualCandidate = await this.git.recompute(candidate.base_commit, candidate.commit);
      if (actualCandidate.diff_hash !== candidate.diff_hash || !sameOrdered(actualCandidate.changed_paths, candidate.changed_paths)) throw new Error("Integration candidate Git evidence is stale");
      await this.git.assertAncestor(candidate.commit, receipt.integrated_commit);
      await this.git.assertPathComposition(candidate.commit, receipt.integrated_commit, candidate.changed_paths);
    }
    const actual = await this.git.recompute(receipt.base_commit, receipt.integrated_commit);
    if (actual.diff_hash !== receipt.diff_hash) throw new Error("Integration Git evidence does not match repository state");
    const extra = actual.changed_paths.filter((value) => !approvedPaths.has(value));
    if (extra.length) throw new Error(`Integration contains unapproved changed paths: ${extra.join(", ")}`);
    const checks = await Promise.all(receipt.check_bindings.map(async (reference) => (await this.required(receipt.governance_id, reference)).record));
    if (!sameSet(checks.map((check) => check.check_id), plan.integration_check_ids) || checks.some((check) => !sameRef(check.binding_snapshot, receipt.binding_snapshot) || !isTrustedCheck(check, snapshot) || check.status !== "passed" || check.subject.kind !== "integration" || check.subject.id !== receipt.record_id || check.subject.commit !== receipt.integrated_commit)) throw new Error("Integration checks are incomplete, failed, untrusted, or stale");
    return this.store.put(receipt);
  }
  async required(governanceId, reference) {
    const stored = await this.store.read(governanceId, reference.kind, reference.record_id);
    if (!stored || stored.record_hash !== reference.record_hash) throw new Error(`Missing or stale governance reference: ${reference.kind}/${reference.record_id}`);
    return stored;
  }
};
function assertNoParallelScopeOverlap(plan) {
  const depends = new Map(plan.units.map((unit) => [unit.unit_id, new Set(unit.depends_on)]));
  const reaches = (from, target) => {
    const seen = /* @__PURE__ */ new Set();
    const stack = [...depends.get(from) ?? []];
    while (stack.length) {
      const next = stack.pop();
      if (next === target) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...depends.get(next) ?? []);
    }
    return false;
  };
  for (let i = 0; i < plan.units.length; i++) for (let j = i + 1; j < plan.units.length; j++) {
    const left = plan.units[i], right = plan.units[j];
    if (reaches(left.unit_id, right.unit_id) || reaches(right.unit_id, left.unit_id)) continue;
    const overlap = left.owned_path_prefixes.some((a) => right.owned_path_prefixes.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
    if (overlap) throw new Error(`Parallel decomposition scopes overlap: ${left.unit_id} and ${right.unit_id}`);
  }
}
function sameSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item));
}
function sameRef(left, right) {
  return left.kind === right.kind && left.record_id === right.record_id && left.record_hash === right.record_hash;
}
function sameOrdered(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
function isTrustedCheck(check, snapshot) {
  return check.provenance.command_source === "trusted" && check.provenance.execution_environment === "sandboxed" && snapshot.bindings.some((binding) => binding.binding_id === check.executed_by_binding_id && binding.role === "checker");
}

// src/application/governance/governed-merge-v3.ts
var GovernedMergeV3 = class {
  constructor(projectRoot, store, runner, evidence, quiescence, operationLock) {
    this.projectRoot = projectRoot;
    this.store = store;
    this.evidence = evidence;
    this.quiescence = quiescence;
    this.operationLock = operationLock;
    this.gitRunner = (async () => new HardenedGit(runner, await resolveExecutable("git")))();
  }
  projectRoot;
  store;
  evidence;
  quiescence;
  operationLock;
  gitRunner;
  async approve(input) {
    const lease = await this.operationLock.acquire(input.governance_id);
    try {
      await this.quiescence.assertQuiescent(input.governance_id);
      await lease.assertOwned();
      if (!input.approved_by.trim() || !input.reason.trim()) throw new Error("Human approval identity and reason are required");
      const integration = await this.store.read(input.governance_id, "integration_receipt", input.integration_record_id);
      if (!integration || integration.record_hash !== input.integration_record_hash) throw new Error("Human approval references stale integration evidence");
      return await this.store.put({ schema_version: 3, kind: "human_approval", governance_id: input.governance_id, record_id: input.record_id, subject: { kind: "integration_receipt", record_id: input.integration_record_id, record_hash: input.integration_record_hash }, approved_by: input.approved_by, reason: input.reason, approved_at: input.approved_at });
    } finally {
      await lease.release();
    }
  }
  async merge(input) {
    const lease = await this.operationLock.acquire(input.governance_id);
    try {
      await this.quiescence.assertQuiescent(input.governance_id);
      await lease.assertOwned();
      const [integrationStored, approvalStored] = await Promise.all([
        this.store.read(input.governance_id, "integration_receipt", input.integration_record_id),
        this.store.read(input.governance_id, "human_approval", input.approval_record_id)
      ]);
      if (!integrationStored || !approvalStored) throw new Error("Integration and human approval are required");
      const integration = integrationStored.record;
      const approval = approvalStored.record;
      if (approval.subject.kind !== "integration_receipt" || approval.subject.record_id !== integration.record_id || approval.subject.record_hash !== integrationStored.record_hash) throw new Error("Human approval targets different integration evidence");
      const planStored = await this.store.read(input.governance_id, "decomposition_plan", integration.plan.record_id);
      if (!planStored || planStored.record_hash !== integration.plan.record_hash) throw new Error("Integration plan evidence is stale");
      const plan = planStored.record;
      if (integration.base_commit !== plan.base_commit || integration.target_branch !== plan.target_branch) throw new Error("Integration does not match its governed plan");
      if (!sameRef2(integration.binding_snapshot, plan.binding_snapshot) || integration.candidates.length !== plan.units.length) throw new Error("Integration does not contain exactly one candidate per governed unit and snapshot");
      const snapshotStored = await this.store.read(input.governance_id, "binding_snapshot", integration.binding_snapshot.record_id);
      if (!snapshotStored || snapshotStored.record_hash !== integration.binding_snapshot.record_hash) throw new Error("Integration binding snapshot is stale");
      const snapshot = snapshotStored.record;
      const units = /* @__PURE__ */ new Set();
      const approvedPaths = /* @__PURE__ */ new Set();
      for (const item of integration.candidates) {
        const [candidateStored, quorumStored] = await Promise.all([
          this.store.read(input.governance_id, "candidate_evidence", item.evidence.record_id),
          this.store.read(input.governance_id, "quorum_result", item.quorum_result.record_id)
        ]);
        if (!candidateStored || candidateStored.record_hash !== item.evidence.record_hash || !quorumStored || quorumStored.record_hash !== item.quorum_result.record_hash) throw new Error("Integration candidate evidence is stale");
        const candidate2 = candidateStored.record;
        const quorum = quorumStored.record;
        if (!sameRef2(candidate2.plan, integration.plan) || !sameRef2(candidate2.binding_snapshot, integration.binding_snapshot) || units.has(candidate2.unit_id) || !plan.units.some((unit) => unit.unit_id === candidate2.unit_id)) throw new Error("Integration candidate plan, snapshot, or decomposition unit is invalid");
        units.add(candidate2.unit_id);
        for (const value of candidate2.changed_paths) {
          if (approvedPaths.has(value)) throw new Error(`Integration candidates overlap changed path: ${value}`);
          approvedPaths.add(value);
        }
        if (quorum.subject.kind !== "candidate_evidence" || quorum.subject.record_id !== candidate2.record_id || quorum.subject.record_hash !== candidateStored.record_hash) throw new Error("Integration candidate quorum targets different evidence");
        await this.revalidateQuorum(input.governance_id, candidate2, candidateStored.record_hash, quorum);
        const candidateActual = await this.evidence.recompute(candidate2.base_commit, candidate2.commit);
        if (candidateActual.diff_hash !== candidate2.diff_hash || !sameOrdered2(candidateActual.changed_paths, candidate2.changed_paths)) throw new Error("Integration candidate Git evidence is stale");
        await this.evidence.assertAncestor(candidate2.commit, integration.integrated_commit);
        await this.evidence.assertPathComposition(candidate2.commit, integration.integrated_commit, candidate2.changed_paths);
      }
      const checks = await Promise.all(integration.check_bindings.map(async (reference) => {
        const stored = await this.store.read(input.governance_id, "check_binding", reference.record_id);
        if (!stored || stored.record_hash !== reference.record_hash) throw new Error("Integration check evidence is stale");
        return stored.record;
      }));
      if (!sameSet2(checks.map((check) => check.check_id), plan.integration_check_ids) || checks.some((check) => !sameRef2(check.binding_snapshot, integration.binding_snapshot) || !isTrustedCheck2(check, snapshot) || check.status !== "passed" || check.subject.kind !== "integration" || check.subject.id !== integration.record_id || check.subject.commit !== integration.integrated_commit)) throw new Error("Integration checks are incomplete, failed, untrusted, or stale");
      const ref2 = `refs/heads/${integration.target_branch}`;
      const before = await this.git(["rev-parse", "--verify", ref2]);
      if (before.trim() !== integration.base_commit) throw new Error("Target branch changed after governance plan was created");
      const candidate = await this.git(["rev-parse", "--verify", "--end-of-options", `${integration.integrated_commit}^{commit}`]);
      if (candidate.trim() !== integration.integrated_commit) throw new Error("Integrated commit is unavailable");
      const actual = await this.evidence.recompute(integration.base_commit, integration.integrated_commit);
      const extra = actual.changed_paths.filter((value) => !approvedPaths.has(value));
      if (actual.diff_hash !== integration.diff_hash || extra.length) throw new Error("Final integration Git evidence contains a mismatch or unapproved changed paths");
      await lease.assertOwned();
      await this.git(["update-ref", "-m", `ORCH governance ${input.governance_id}`, ref2, integration.integrated_commit, integration.base_commit]);
      const after = await this.git(["rev-parse", "--verify", ref2]);
      if (after.trim() !== integration.integrated_commit) throw new Error("Guarded target update did not persist");
      return { merged: true, commit: integration.integrated_commit };
    } finally {
      await lease.release();
    }
  }
  async git(args) {
    return (await this.gitRunner).run(this.projectRoot, args);
  }
  async revalidateQuorum(governanceId, candidate, candidateHash, quorum) {
    const policyStored = await this.store.read(governanceId, "quorum_policy", quorum.policy.record_id);
    if (!policyStored || policyStored.record_hash !== quorum.policy.record_hash) throw new Error("Quorum policy evidence is stale");
    const policy = policyStored.record;
    if (policy.applies_to !== "candidate_evidence") throw new Error("Quorum policy does not apply to candidate evidence");
    if (!sameRef2(policy.binding_snapshot, candidate.binding_snapshot)) throw new Error("Quorum policy binding snapshot does not match candidate evidence");
    const snapshotStored = await this.store.read(governanceId, "binding_snapshot", policy.binding_snapshot.record_id);
    if (!snapshotStored || snapshotStored.record_hash !== policy.binding_snapshot.record_hash) throw new Error("Quorum binding snapshot is stale");
    const snapshot = snapshotStored.record;
    const author = snapshot.bindings.find((binding) => binding.binding_id === candidate.produced_by_binding_id);
    if (!author || author.role !== "candidate") throw new Error("Candidate author binding is missing or invalid");
    const reviewers = /* @__PURE__ */ new Set();
    const principals = /* @__PURE__ */ new Set();
    let approvals = 0;
    let rejections = 0;
    for (const reference of quorum.votes) {
      const voteStored = await this.store.read(governanceId, "review_vote", reference.record_id);
      if (!voteStored || voteStored.record_hash !== reference.record_hash) throw new Error("Quorum vote evidence is stale");
      const vote = voteStored.record;
      if (!sameRef2(vote.binding_snapshot, policy.binding_snapshot) || vote.subject.kind !== "candidate_evidence" || vote.subject.record_id !== candidate.record_id || vote.subject.record_hash !== candidateHash || !policy.eligible_reviewer_binding_ids.includes(vote.reviewer_binding_id) || reviewers.has(vote.reviewer_binding_id)) throw new Error("Quorum contains duplicate, ineligible, or mismatched vote");
      const reviewer = snapshot.bindings.find((binding) => binding.binding_id === vote.reviewer_binding_id);
      if (!reviewer || reviewer.role !== "reviewer" || reviewer.principal_id === author.principal_id) throw new Error("Quorum contains self-review or invalid reviewer");
      if (policy.require_distinct_principals && principals.has(reviewer.principal_id)) throw new Error("Quorum reviewers do not use distinct principals");
      reviewers.add(reviewer.binding_id);
      principals.add(reviewer.principal_id);
      if (vote.decision === "approve") approvals++;
      else rejections++;
    }
    let hasHumanApproval = false;
    if (quorum.human_approval) {
      const stored = await this.store.read(governanceId, "human_approval", quorum.human_approval.record_id);
      if (!stored || stored.record_hash !== quorum.human_approval.record_hash) throw new Error("Quorum human approval is stale");
      const human = stored.record;
      hasHumanApproval = human.subject.kind === "candidate_evidence" && human.subject.record_id === candidate.record_id && human.subject.record_hash === candidateHash;
    }
    const satisfied = approvals >= policy.minimum_approvals && rejections <= policy.maximum_rejections && (!policy.human_approval_required || hasHumanApproval);
    if (!satisfied || !quorum.satisfied || quorum.approvals !== approvals || quorum.rejections !== rejections) throw new Error("Integration candidate quorum is not satisfied");
  }
};
function sameSet2(left, right) {
  return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item));
}
function sameRef2(left, right) {
  return left.kind === right.kind && left.record_id === right.record_id && left.record_hash === right.record_hash;
}
function sameOrdered2(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function isTrustedCheck2(check, snapshot) {
  return check.provenance.command_source === "trusted" && check.provenance.execution_environment === "sandboxed" && snapshot.bindings.some((binding) => binding.binding_id === check.executed_by_binding_id && binding.role === "checker");
}
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
  const result = await commandRunner.run({
    executable: await pinnedExecutable(command),
    args,
    env: process.env,
    timeoutMs: EXEC_TIMEOUT_MS,
    maxStdoutBytes,
    maxStderrBytes: MAX_STDERR_BYTES
  });
  if (!result.ok) throw new Error(commandFailureMessage(result));
  return result;
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

// src/domain/global-config.ts
var DEFAULT_GLOBAL_CONFIG = {
  tui: {
    activity_filter: "all",
    notifications: { toast: true, bell: false }
  }
};
var IndexManager = class {
  indexPath;
  dir;
  ext;
  itemPath;
  fileFilter;
  readItemFn;
  /** Promise-chain mutex to serialize updateIndex read-modify-write cycles. */
  mutex = Promise.resolve();
  /** True while executing inside withMutex — prevents re-entrant deadlock. */
  insideMutex = false;
  constructor(config) {
    this.dir = config.dir;
    this.ext = config.ext;
    this.itemPath = config.itemPath;
    this.indexPath = path2.join(config.dir, "_index.json");
    this.fileFilter = config.fileFilter ?? (() => true);
    if (config.readItem) {
      this.readItemFn = config.readItem;
    } else if (config.ext === ".yml") {
      this.readItemFn = (fp) => readYaml(fp);
    } else {
      this.readItemFn = (fp) => readJson(fp);
    }
  }
  /**
   * Read the index file. Falls back to rebuilding from individual files
   * if the index is missing or corrupt.
   */
  async readIndex() {
    try {
      const entries = await readJson(this.indexPath);
      if (Array.isArray(entries)) return entries;
    } catch {
    }
    return this.rebuildIndex();
  }
  /**
   * Rebuild the index by reading all individual item files.
   * Used as fallback when _index.json is missing or corrupted.
   *
   * When called from outside the mutex (standalone), the write is serialized
   * through {@link withMutex} to prevent races with concurrent updateIndex.
   * When called from within the mutex (e.g. updateIndex → readIndex fallback),
   * it writes directly to avoid re-entrant deadlock.
   */
  async rebuildIndex() {
    await ensureDir(this.dir);
    const files = await listFiles(this.dir, this.ext);
    const results = await Promise.all(
      files.filter(this.fileFilter).map(async (file) => {
        const id2 = file.replace(this.ext, "");
        try {
          return await this.readItemFn(this.itemPath(id2));
        } catch {
          return null;
        }
      })
    );
    const items2 = [];
    for (const item of results) {
      if (item != null) items2.push(item);
    }
    if (this.insideMutex) {
      await this.writeIndexUnsafe(items2);
    } else {
      await this.withMutex(() => this.writeIndexUnsafe(items2));
    }
    return items2;
  }
  /**
   * Write the index file atomically.
   * Serialized through the mutex to prevent races with concurrent updateIndex.
   */
  async writeIndex(items2) {
    return this.withMutex(() => this.writeIndexUnsafe(items2));
  }
  /**
   * Apply a mutation to the index and write it back.
   *
   * Serialized through a promise-chain mutex to prevent TOCTOU races
   * where parallel callers could overwrite each other's changes
   * (e.g. two `orch task add` invocations losing data).
   */
  async updateIndex(fn) {
    return this.withMutex(async () => {
      const current = await this.readIndex();
      const updated = fn(current);
      await this.writeIndexUnsafe(updated);
    });
  }
  /** Internal write without mutex — called only from within withMutex. */
  async writeIndexUnsafe(items2) {
    await ensureDir(this.dir);
    await writeJson(this.indexPath, items2);
  }
  /** Promise-chain mutex: serializes all index-mutating operations. */
  withMutex(fn) {
    let release;
    const next = new Promise((resolve2) => {
      release = resolve2;
    });
    const prev = this.mutex;
    this.mutex = next;
    return prev.then(async () => {
      this.insideMutex = true;
      try {
        return await fn();
      } finally {
        this.insideMutex = false;
        release();
      }
    });
  }
};
var TaskStore = class {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.tasksDir,
      ext: ".yml",
      itemPath: (id2) => paths.taskPath(id2)
    });
  }
  paths;
  index;
  async list(filter) {
    const all = await this.index.readIndex();
    const tasks = all.filter(
      (task) => task !== null && (!filter?.status || task.status === filter.status) && (!filter?.goalId || task.goalId === filter.goalId)
    );
    return tasks.sort((a, b) => {
      const statusOrder = statusPriority(a.status) - statusPriority(b.status);
      if (statusOrder !== 0) return statusOrder;
      const bTime = b.updated_at ?? "";
      const aTime = a.updated_at ?? "";
      return bTime < aTime ? -1 : bTime > aTime ? 1 : 0;
    });
  }
  async get(id2) {
    return readYaml(this.paths.taskPath(id2));
  }
  async save(task) {
    await ensureDir(this.paths.tasksDir);
    await writeYaml(this.paths.taskPath(task.id), task);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((t) => t.id !== task.id);
      filtered.push(task);
      return filtered;
    });
  }
  async delete(id2) {
    try {
      await fs2.unlink(this.paths.taskPath(id2));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((t) => t.id !== id2));
  }
};
function statusPriority(status) {
  const order = {
    in_progress: 0,
    retrying: 1,
    review: 2,
    todo: 3,
    done: 4,
    failed: 5,
    cancelled: 6
  };
  return order[status];
}
var AgentStore = class {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.agentsDir,
      ext: ".yml",
      itemPath: (id2) => paths.agentPath(id2)
    });
  }
  paths;
  index;
  async list() {
    return this.index.readIndex();
  }
  async get(id2) {
    return readYaml(this.paths.agentPath(id2));
  }
  async getByName(name) {
    const agents = await this.list();
    return agents.find((a) => a.name === name) ?? null;
  }
  async save(agent) {
    await ensureDir(this.paths.agentsDir);
    await writeYaml(this.paths.agentPath(agent.id), agent);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((a) => a.id !== agent.id);
      filtered.push(agent);
      return filtered;
    });
  }
  async delete(id2) {
    try {
      await fs2.unlink(this.paths.agentPath(id2));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((a) => a.id !== id2));
  }
};
var RunStore = class {
  constructor(paths) {
    this.paths = paths;
  }
  paths;
  async save(run2) {
    await ensureDir(this.paths.runsDir);
    await writeJson(this.paths.runPath(run2.id), run2);
  }
  async get(id2) {
    return readJson(this.paths.runPath(id2));
  }
  async listAll() {
    return this.listFiltered(() => true);
  }
  async listForTask(taskId) {
    return this.listFiltered((run2) => run2.task_id === taskId);
  }
  async listForAgent(agentId) {
    return this.listFiltered((run2) => run2.agent_id === agentId);
  }
  async appendEvent(runId, event) {
    await ensureDir(this.paths.runsDir);
    await appendJsonl(this.paths.runEventsPath(runId), event);
  }
  async readEvents(runId) {
    return readJsonl(this.paths.runEventsPath(runId));
  }
  /**
   * Read the last N events for a run without loading the entire JSONL file.
   */
  async readEventsTail(runId, count) {
    return readJsonlTail(this.paths.runEventsPath(runId), count);
  }
  closeRunEvents(runId) {
    closeAppendHandle(this.paths.runEventsPath(runId));
  }
  async *streamEvents(runId, signal) {
    const filePath = this.paths.runEventsPath(runId);
    const deadline = Date.now() + 3e4;
    while (!signal?.aborted && Date.now() < deadline) {
      if (await pathExists(filePath)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (signal?.aborted || Date.now() >= deadline) return;
    const stream = createReadStream(filePath);
    const { readLines } = await import('./process-manager-DX4C5EFA.js');
    try {
      for await (const line of readLines(stream)) {
        if (signal?.aborted) break;
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch {
            process.stderr.write(`[RunStore] skipping corrupt JSONL line: ${sanitizeText(line).slice(0, 200)}
`);
          }
        }
      }
    } finally {
      stream.destroy();
    }
  }
  async listFiltered(predicate) {
    await ensureDir(this.paths.runsDir);
    const files = await listFiles(this.paths.runsDir, ".json");
    const BATCH = 64;
    const all = [];
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((file) => {
          const id2 = file.endsWith(".json") ? file.slice(0, -5) : file;
          return readJson(this.paths.runPath(id2));
        })
      );
      for (const run2 of results) {
        if (run2 !== null && predicate(run2)) all.push(run2);
      }
    }
    return all.sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
  }
};

// src/domain/state.ts
var DEFAULT_STATE = {
  version: 1,
  onboardingCompleted: false,
  running: {},
  claimed: /* @__PURE__ */ new Set(),
  retry_queue: [],
  stats: {
    total_runs: 0,
    total_tasks_completed: 0,
    total_tasks_failed: 0,
    total_tokens: { input: 0, output: 0, reasoning: 0, total: 0, cache_read: 0, cache_write: 0 },
    total_runtime_ms: 0
  }
};

// src/infrastructure/storage/state-migrations.ts
var STATE_SCHEMA_VERSION = 1;
function stateVersion(value) {
  const raw = object(value, "orchestrator state");
  if (raw.version === void 0 || raw.version === 0) return 0;
  if (raw.version === STATE_SCHEMA_VERSION) return STATE_SCHEMA_VERSION;
  if (Number.isSafeInteger(raw.version) && raw.version > STATE_SCHEMA_VERSION)
    throw new Error(`Unsupported future orchestrator state version: ${raw.version}`);
  throw new Error("Invalid orchestrator state version");
}
function migrateState(value) {
  const version = stateVersion(value);
  const raw = object(value, "orchestrator state");
  return validatePersistedState({ ...raw, version: STATE_SCHEMA_VERSION }, version === 0);
}
function validatePersistedState(value, legacy = false) {
  const raw = object(value, "orchestrator state");
  if (raw.version !== STATE_SCHEMA_VERSION)
    throw new Error(`Unsupported orchestrator state version: ${String(raw.version)}`);
  const defaults = structuredClone(DEFAULT_STATE);
  const runningRaw = optionalObject(raw.running, "running");
  const running = {};
  for (const [key, entry] of Object.entries(runningRaw)) {
    const item = object(entry, `running.${key}`);
    running[key] = {
      run_id: string(item.run_id, `running.${key}.run_id`),
      agent_id: string(item.agent_id, `running.${key}.agent_id`),
      task_id: string(item.task_id, `running.${key}.task_id`),
      pid: integer2(item.pid, `running.${key}.pid`, 1),
      started_at: string(item.started_at, `running.${key}.started_at`),
      last_event_at: string(item.last_event_at, `running.${key}.last_event_at`)
    };
  }
  const claimedRaw = optionalArray(raw.claimed);
  const claimed = claimedRaw.map((item, index) => string(item, `claimed[${index}]`));
  const retryRaw = optionalArray(raw.retry_queue);
  const retry_queue = retryRaw.map((entry, index) => {
    const item = object(entry, `retry_queue[${index}]`);
    return {
      task_id: string(item.task_id, `retry_queue[${index}].task_id`),
      attempt: integer2(item.attempt, `retry_queue[${index}].attempt`, 0),
      due_at: string(item.due_at, `retry_queue[${index}].due_at`),
      error: string(item.error, `retry_queue[${index}].error`)
    };
  });
  const statsRaw = optionalObject(raw.stats, "stats");
  const tokensRaw = optionalObject(statsRaw.total_tokens, "stats.total_tokens");
  const number = (value2, fallback, label) => value2 === void 0 ? fallback : integer2(value2, label, 0);
  const state = {
    version: STATE_SCHEMA_VERSION,
    onboardingCompleted: typeof raw.onboardingCompleted === "boolean" ? raw.onboardingCompleted : false,
    running,
    claimed,
    retry_queue,
    stats: {
      total_runs: number(statsRaw.total_runs, defaults.stats.total_runs, "stats.total_runs"),
      total_tasks_completed: number(
        statsRaw.total_tasks_completed,
        defaults.stats.total_tasks_completed,
        "stats.total_tasks_completed"
      ),
      total_tasks_failed: number(
        statsRaw.total_tasks_failed,
        defaults.stats.total_tasks_failed,
        "stats.total_tasks_failed"
      ),
      total_tokens: {
        input: number(tokensRaw.input, defaults.stats.total_tokens.input, "stats.total_tokens.input"),
        output: number(tokensRaw.output, defaults.stats.total_tokens.output, "stats.total_tokens.output"),
        reasoning: number(
          tokensRaw.reasoning,
          defaults.stats.total_tokens.reasoning,
          "stats.total_tokens.reasoning"
        ),
        total: number(tokensRaw.total, defaults.stats.total_tokens.total, "stats.total_tokens.total"),
        cache_read: number(
          tokensRaw.cache_read,
          defaults.stats.total_tokens.cache_read,
          "stats.total_tokens.cache_read"
        ),
        cache_write: number(
          tokensRaw.cache_write,
          defaults.stats.total_tokens.cache_write,
          "stats.total_tokens.cache_write"
        )
      },
      total_runtime_ms: number(
        statsRaw.total_runtime_ms,
        defaults.stats.total_runtime_ms,
        "stats.total_runtime_ms"
      )
    }
  };
  if (raw.pid !== void 0) state.pid = integer2(raw.pid, "pid", 1);
  if (raw.started_at !== void 0) state.started_at = string(raw.started_at, "started_at");
  return state;
}
function validateStateMigrationJournal(value) {
  const raw = object(value, "state migration journal");
  if (raw.schema_version !== 1 || raw.from_version !== 0 || raw.to_version !== 1)
    throw new Error("Invalid state migration journal");
  return {
    schema_version: 1,
    from_version: 0,
    to_version: 1,
    state: validatePersistedState(raw.state)
  };
}
function deserializeState(value) {
  return { ...value, claimed: new Set(value.claimed) };
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}
function optionalObject(value, label, legacy) {
  if (value === void 0 || value === null) return {};
  return object(value, label);
}
function optionalArray(value, label, legacy) {
  if (value === void 0 || value === null) return [];
  if (!Array.isArray(value)) return [];
  return value;
}
function string(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function integer2(value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${label} must be an integer >= ${minimum}`);
  return value;
}

// src/infrastructure/storage/state-store.ts
var StateStore = class {
  constructor(paths) {
    this.paths = paths;
  }
  paths;
  async read() {
    await this.recoverMigration();
    const raw = await readJson(this.paths.statePath);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const version = stateVersion(raw);
    const persisted = migrateState(raw);
    if (version === 0) await this.persistMigration(persisted);
    return deserializeState(persisted);
  }
  async write(state) {
    const serializable = validatePersistedState({ ...state, claimed: Array.from(state.claimed) });
    await writeJson(this.paths.statePath, serializable);
  }
  get migrationPath() {
    return path2.join(path2.dirname(this.paths.statePath), "state.migration.pending.json");
  }
  async persistMigration(state) {
    const journal = {
      schema_version: 1,
      from_version: 0,
      to_version: 1,
      state
    };
    await writeJson(this.migrationPath, journal);
    await writeJson(this.paths.statePath, state);
    await fs2.rm(this.migrationPath, { force: true });
  }
  async recoverMigration() {
    const rawJournal = await readJson(this.migrationPath);
    if (!rawJournal) return;
    const journal = validateStateMigrationJournal(rawJournal);
    const current = await readJson(this.paths.statePath);
    if (current) {
      const version = stateVersion(current);
      if (version === 1) {
        const validated = validatePersistedState(current);
        if (JSON.stringify(validated) !== JSON.stringify(journal.state))
          throw new Error("State migration journal conflicts with canonical state");
        await fs2.rm(this.migrationPath, { force: true });
        return;
      }
    }
    await writeJson(this.paths.statePath, journal.state);
    await fs2.rm(this.migrationPath, { force: true });
  }
};

// src/domain/config.ts
var DEFAULT_CONFIG = {
  project: {
    name: "my-project"
  },
  defaults: {
    agent: {
      adapter: "claude",
      approval_policy: "auto",
      max_turns: 50,
      timeout_ms: 36e5,
      stall_timeout_ms: 6e5,
      workspace_mode: "worktree"
    },
    task: {
      max_attempts: 3,
      priority: 3
    }
  },
  scheduling: {
    poll_interval_ms: 1e4,
    max_concurrent_agents: 6,
    retry_base_delay_ms: 1e4,
    retry_max_delay_ms: 3e5
  },
  execution: {
    security: {
      allow_permission_bypass: false,
      allow_shell_adapter: false,
      persist_prompts: false
    }
  }
};

// src/infrastructure/storage/config-store.ts
var FORBIDDEN_CONFIG_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
var ConfigStore = class {
  constructor(paths) {
    this.paths = paths;
  }
  paths;
  async read() {
    const config = await readYaml(this.paths.configPath);
    return normalizeConfig(deepMerge(
      DEFAULT_CONFIG,
      config ?? {}
    ));
  }
  async write(config) {
    await writeYaml(this.paths.configPath, config);
  }
  async get(keyPath) {
    const config = await this.read();
    return getByPath(config, keyPath);
  }
  async set(keyPath, value) {
    const config = await this.read();
    setByPath(config, keyPath, value);
    await this.write(config);
  }
};
function getByPath(obj, keyPath) {
  const keys = parseSafeKeyPath(keyPath, false);
  let current = obj;
  for (const key of keys) {
    if (current === null || current === void 0 || typeof current !== "object") {
      return void 0;
    }
    current = current[key];
  }
  return current;
}
function setByPath(obj, keyPath, value) {
  const keys = parseSafeKeyPath(keyPath, true);
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}
function parseSafeKeyPath(keyPath, shouldThrow) {
  const keys = keyPath.split(".");
  if (keys.some((key) => FORBIDDEN_CONFIG_KEYS.has(key))) {
    if (shouldThrow) throw new Error(`Unsafe config key path: ${keyPath}`);
    return [];
  }
  return keys;
}
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_CONFIG_KEYS.has(key)) continue;
    const sourceVal = source[key];
    const targetVal = result[key];
    if (sourceVal !== null && sourceVal !== void 0 && typeof sourceVal === "object" && !Array.isArray(sourceVal) && typeof targetVal === "object" && targetVal !== null && !Array.isArray(targetVal)) {
      result[key] = deepMerge(
        targetVal,
        sourceVal
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}
function normalizeConfig(config) {
  const security = config.execution?.security ?? {};
  return {
    ...config,
    execution: {
      ...config.execution ?? DEFAULT_CONFIG.execution,
      security: {
        ...DEFAULT_CONFIG.execution.security,
        ...security,
        allow_permission_bypass: security.allow_permission_bypass === true,
        allow_shell_adapter: security.allow_shell_adapter === true,
        persist_prompts: security.persist_prompts === true
      }
    }
  };
}
var GLOBAL_DIR = path2.join(homedir(), ".orchestry");
var GLOBAL_CONFIG_PATH = path2.join(GLOBAL_DIR, "global.yml");
var GlobalConfigStore = class {
  async read() {
    const data = await readYaml(GLOBAL_CONFIG_PATH);
    if (!data) return { ...DEFAULT_GLOBAL_CONFIG, tui: { ...DEFAULT_GLOBAL_CONFIG.tui, notifications: { ...DEFAULT_GLOBAL_CONFIG.tui.notifications } } };
    const tui = data.tui;
    const notif = tui?.notifications;
    const workflowLaunch = data.workflow_launch;
    return {
      tui: {
        activity_filter: tui?.activity_filter ?? DEFAULT_GLOBAL_CONFIG.tui.activity_filter,
        notifications: {
          toast: typeof notif?.toast === "boolean" ? notif.toast : DEFAULT_GLOBAL_CONFIG.tui.notifications.toast,
          bell: typeof notif?.bell === "boolean" ? notif.bell : DEFAULT_GLOBAL_CONFIG.tui.notifications.bell
        }
      },
      ...workflowLaunch ? { workflow_launch: workflowLaunch } : {}
    };
  }
  async write(config) {
    await mkdir(GLOBAL_DIR, { recursive: true });
    await writeYaml(GLOBAL_CONFIG_PATH, config);
  }
  async set(key, value) {
    const config = await this.read();
    config.tui[key] = value;
    await this.write(config);
  }
};
var ContextStore = class _ContextStore {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.contextDir,
      ext: ".json",
      itemPath: (key) => paths.contextPath(key),
      fileFilter: (f) => f !== "_index.json"
    });
  }
  paths;
  index;
  async get(key) {
    const entry = await readJson(this.paths.contextPath(key));
    if (!entry) return null;
    if (isExpired(entry)) {
      await this.delete(key);
      return null;
    }
    return entry;
  }
  /** Max TTL: 30 days in milliseconds */
  static MAX_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
  async set(key, value, ttlMs) {
    if (ttlMs !== void 0) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > _ContextStore.MAX_TTL_MS) {
        throw new Error(`TTL must be a positive number up to ${_ContextStore.MAX_TTL_MS}ms (30 days)`);
      }
    }
    await ensureDir(this.paths.contextDir);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = await readJson(this.paths.contextPath(key));
    const entry = {
      key,
      value,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      ttl_ms: ttlMs,
      expires_at: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : void 0
    };
    await writeJson(this.paths.contextPath(key), entry);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((e) => e.key !== key);
      filtered.push(entry);
      return filtered;
    });
  }
  async delete(key) {
    try {
      await fs2.unlink(this.paths.contextPath(key));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((e) => e.key !== key));
  }
  async list() {
    const entries = await this.index.readIndex();
    const expired = [];
    const valid = [];
    for (const entry of entries) {
      if (isExpired(entry)) {
        expired.push(entry);
      } else {
        valid.push(entry);
      }
    }
    if (expired.length > 0) {
      await Promise.all(expired.map((e) => this.deleteFile(e.key)));
      await this.index.writeIndex(valid);
    }
    return valid.sort((a, b) => a.key.localeCompare(b.key));
  }
  async getAll() {
    const entries = await this.list();
    const result = {};
    for (const entry of entries) {
      result[entry.key] = entry.value;
    }
    return result;
  }
  /** Delete just the file (no index update). Used by lazy expiry cleanup. */
  async deleteFile(key) {
    try {
      await fs2.unlink(this.paths.contextPath(key));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
};
function isExpired(entry) {
  if (!entry.expires_at) return false;
  return new Date(entry.expires_at).getTime() < Date.now();
}
var MessageStore = class {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.messagesDir,
      ext: ".json",
      itemPath: (id2) => paths.messagePath(id2),
      fileFilter: (fileName) => fileName !== "_index.json"
    });
  }
  paths;
  index;
  async save(message) {
    await ensureDir(this.paths.messagesDir);
    await writeJson(this.paths.messagePath(message.id), message);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((m) => m.id !== message.id);
      filtered.push(message);
      return filtered;
    });
  }
  async get(id2) {
    return readJson(this.paths.messagePath(id2));
  }
  async list() {
    const all = await this.index.readIndex();
    return all.filter((m) => m !== null).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async listPending(agentId) {
    const all = await this.list();
    const now = Date.now();
    return all.filter((m) => {
      if (m.status !== "pending") return false;
      if (m.expires_at && new Date(m.expires_at).getTime() < now) return false;
      return m.to_agent_id === agentId;
    });
  }
  async markDelivered(id2) {
    const msg = await this.get(id2);
    if (!msg) return;
    msg.status = "delivered";
    msg.delivered_at = (/* @__PURE__ */ new Date()).toISOString();
    await writeJson(this.paths.messagePath(id2), msg);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((m) => m.id !== id2);
      filtered.push(msg);
      return filtered;
    });
  }
  async delete(id2) {
    try {
      await fs2.unlink(this.paths.messagePath(id2));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((m) => m.id !== id2));
  }
  async purgeExpired() {
    const all = await this.list();
    const now = Date.now();
    const toDelete = all.filter((m) => {
      const isExpired2 = m.expires_at && new Date(m.expires_at).getTime() < now;
      const isOldDelivered = m.delivered_at && now - new Date(m.delivered_at).getTime() > 36e5;
      return isExpired2 || isOldDelivered;
    });
    const idsToDelete = new Set(toDelete.map((m) => m.id));
    await Promise.all(
      toDelete.map(async (m) => {
        try {
          await fs2.unlink(this.paths.messagePath(m.id));
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      })
    );
    await this.index.updateIndex((idx) => idx.filter((m) => !idsToDelete.has(m.id)));
    return toDelete.length;
  }
};

// src/domain/goal.ts
var TERMINAL_GOAL_STATUSES = /* @__PURE__ */ new Set(["achieved", "abandoned"]);
function isGoalTerminal(status) {
  return TERMINAL_GOAL_STATUSES.has(status);
}
var GOAL_STATUS_ORDER = {
  active: 0,
  paused: 1,
  achieved: 2,
  abandoned: 3
};
var GoalStore = class {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.goalsDir,
      ext: ".yml",
      itemPath: (id2) => paths.goalPath(id2)
    });
  }
  paths;
  index;
  async list(filter) {
    const all = await this.index.readIndex();
    const goals = all.filter(
      (goal) => goal !== null && (!filter?.status || goal.status === filter.status)
    );
    return goals.sort((a, b) => {
      const statusOrder = GOAL_STATUS_ORDER[a.status] - GOAL_STATUS_ORDER[b.status];
      if (statusOrder !== 0) return statusOrder;
      const bTime = b.updated_at ?? "";
      const aTime = a.updated_at ?? "";
      return bTime < aTime ? -1 : bTime > aTime ? 1 : 0;
    });
  }
  async get(id2) {
    return readYaml(this.paths.goalPath(id2));
  }
  async save(goal) {
    await ensureDir(this.paths.goalsDir);
    await writeYaml(this.paths.goalPath(goal.id), goal);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((g) => g.id !== goal.id);
      filtered.push(goal);
      return filtered;
    });
  }
  async delete(id2) {
    try {
      await fs2.unlink(this.paths.goalPath(id2));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((g) => g.id !== id2));
  }
};
var TeamStore = class {
  constructor(paths) {
    this.paths = paths;
  }
  paths;
  async save(team) {
    await ensureDir(this.paths.teamsDir);
    await writeYaml(this.paths.teamPath(team.id), team);
  }
  async get(id2) {
    return readYaml(this.paths.teamPath(id2));
  }
  async getByName(name) {
    const teams = await this.list();
    return teams.find((t) => t.name === name) ?? null;
  }
  async list() {
    await ensureDir(this.paths.teamsDir);
    const files = await listFiles(this.paths.teamsDir, ".yml");
    const results = await Promise.all(
      files.map((f) => readYaml(this.paths.teamPath(f.replace(".yml", ""))))
    );
    return results.filter((t) => t !== null);
  }
  async delete(id2) {
    try {
      await fs2.unlink(this.paths.teamPath(id2));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
};

// src/domain/message.ts
var MAX_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var DEFAULT_MESSAGE_TTL_MS = 24 * 60 * 60 * 1e3;

// src/application/message-service.ts
var MessageService = class {
  constructor(messageStore, agentStore, teamStore, eventBus) {
    this.messageStore = messageStore;
    this.agentStore = agentStore;
    this.teamStore = teamStore;
    this.eventBus = eventBus;
  }
  messageStore;
  agentStore;
  teamStore;
  eventBus;
  /**
   * Send a message. For broadcast, creates one message per recipient agent.
   * For 'lead' channel, resolves team lead and sends direct.
   */
  async send(input) {
    if (!input.body.trim()) throw new InvalidArgumentsError("Message body is required");
    const ttlMs = input.ttl_ms ?? DEFAULT_MESSAGE_TTL_MS;
    if (ttlMs <= 0 || ttlMs > MAX_MESSAGE_TTL_MS) {
      throw new InvalidArgumentsError(`TTL must be between 1ms and ${MAX_MESSAGE_TTL_MS}ms`);
    }
    const sender = await this.agentStore.get(input.from_agent_id);
    if (!sender && input.from_agent_id !== "cli") {
      throw new InvalidArgumentsError(`Sender agent not found: ${input.from_agent_id}`);
    }
    const now = /* @__PURE__ */ new Date();
    const baseMessage = {
      channel: input.channel,
      from_agent_id: input.from_agent_id,
      subject: (input.subject || "(no subject)").slice(0, 200),
      body: input.body.slice(0, 4e3),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      status: "pending",
      team_id: input.team_id,
      reply_to: input.reply_to
    };
    const messages = [];
    if (input.channel === "broadcast") {
      let agents = await this.agentStore.list();
      if (input.team_id) {
        const team = await this.teamStore.get(input.team_id);
        if (team) {
          const memberIds = new Set(team.members.map((m) => m.agent_id));
          agents = agents.filter((a) => memberIds.has(a.id));
        }
      }
      const recipients = agents.filter((a) => a.id !== input.from_agent_id && a.status !== "disabled");
      const broadcastMsgs = recipients.map((agent) => ({
        ...baseMessage,
        id: `msg_${nanoid(7)}`,
        to_agent_id: agent.id
      }));
      await Promise.all(broadcastMsgs.map((msg) => this.messageStore.save(msg)));
      for (const msg of broadcastMsgs) {
        messages.push(msg);
        this.emitSent(msg);
      }
    } else if (input.channel === "lead") {
      if (!input.team_id) throw new InvalidArgumentsError("team_id is required for lead channel");
      const team = await this.teamStore.get(input.team_id);
      if (!team) throw new InvalidArgumentsError(`Team not found: ${input.team_id}`);
      const msg = {
        ...baseMessage,
        id: `msg_${nanoid(7)}`,
        to_agent_id: team.lead_agent_id
      };
      await this.messageStore.save(msg);
      messages.push(msg);
      this.emitSent(msg);
    } else {
      if (!input.to_agent_id) throw new InvalidArgumentsError("to_agent_id is required for direct messages");
      const recipient = await this.agentStore.get(input.to_agent_id);
      if (!recipient) throw new InvalidArgumentsError(`Recipient agent not found: ${input.to_agent_id}`);
      const msg = {
        ...baseMessage,
        id: `msg_${nanoid(7)}`,
        to_agent_id: input.to_agent_id
      };
      await this.messageStore.save(msg);
      messages.push(msg);
      this.emitSent(msg);
    }
    return messages;
  }
  /**
   * Drain mailbox: fetch pending messages for an agent and mark them delivered.
   * Called by the orchestrator during dispatchTask.
   */
  async drainMailbox(agentId, taskId) {
    const pending = await this.messageStore.listPending(agentId);
    await Promise.all(pending.map((msg) => this.messageStore.markDelivered(msg.id)));
    for (const msg of pending) {
      this.eventBus.emit({
        type: "message:delivered",
        messageId: msg.id,
        toAgentId: agentId,
        taskId
      });
    }
    return pending;
  }
  async listAll() {
    return this.messageStore.list();
  }
  async listPendingForAgent(agentId) {
    return this.messageStore.listPending(agentId);
  }
  async listForAgent(agentId) {
    const all = await this.messageStore.list();
    return all.filter((m) => m.to_agent_id === agentId || m.from_agent_id === agentId);
  }
  async purgeExpired() {
    return this.messageStore.purgeExpired();
  }
  emitSent(msg) {
    this.eventBus.emit({
      type: "message:sent",
      messageId: msg.id,
      fromAgentId: msg.from_agent_id,
      toAgentId: msg.to_agent_id,
      channel: msg.channel
    });
  }
};
var VALID_TRANSITIONS = {
  active: ["paused", "achieved", "abandoned"],
  paused: ["active", "achieved", "abandoned"],
  achieved: [],
  abandoned: []
};
var GoalService = class {
  constructor(goalStore, eventBus, agentService, taskService, contextStore) {
    this.goalStore = goalStore;
    this.eventBus = eventBus;
    this.agentService = agentService;
    this.taskService = taskService;
    this.contextStore = contextStore;
  }
  goalStore;
  eventBus;
  agentService;
  taskService;
  contextStore;
  async create(input) {
    if (!input.title.trim()) {
      throw new InvalidArgumentsError("Goal title is required");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const goal = {
      id: `goal_${nanoid(7)}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      status: "active",
      assignee: input.assignee,
      orchestration: {
        enabled: true,
        phase: "needs_analysis",
        cycle: 1,
        lead_agent_id: input.assignee,
        last_transition_at: now
      },
      created_at: now,
      updated_at: now
    };
    await this.goalStore.save(goal);
    this.eventBus.emit({ type: "goal:created", goalId: goal.id, title: goal.title });
    if (goal.assignee) {
      await this.enableAutonomous(goal.assignee);
    }
    return goal;
  }
  async list(filter) {
    return this.goalStore.list(filter);
  }
  async get(id2) {
    const goal = await this.goalStore.get(id2);
    if (!goal) throw new GoalNotFoundError(id2);
    return goal;
  }
  async updateStatus(id2, newStatus, opts) {
    const goal = await this.get(id2);
    const oldStatus = goal.status;
    if (!VALID_TRANSITIONS[oldStatus].includes(newStatus)) {
      const err = new InvalidArgumentsError(`Cannot transition goal from '${oldStatus}' to '${newStatus}'`);
      await this.recordGoalFailure(goal, err.message, "status transition");
      throw err;
    }
    if (newStatus === "achieved" && this.taskService) {
      const childTasks = await this.taskService.list({ goalId: id2 });
      const pending = childTasks.filter(
        (t) => !isTerminal(t.status) && !t.labels?.includes(AUTONOMOUS_LABEL)
      );
      if (pending.length > 0) {
        if (opts?.force) {
          const cancellable = pending.filter((t) => t.status !== "in_progress");
          const running = pending.filter((t) => t.status === "in_progress");
          await Promise.all(
            cancellable.map((t) => this.taskService.cancel(t.id).catch(() => {
            }))
          );
          if (running.length > 0) {
            const summary = running.map((t) => `${t.id} (in_progress)`).join(", ");
            const err = new GoalHasPendingTasksError(id2, running.length, summary);
            await this.recordGoalFailure(goal, err.message, "force achieved blocked by running tasks");
            throw err;
          }
        } else {
          const summary = pending.map((t) => `${t.id} (${t.status})`).join(", ");
          const err = new GoalHasPendingTasksError(id2, pending.length, summary);
          await this.recordGoalFailure(goal, err.message, "achieved blocked by pending tasks");
          throw err;
        }
      }
    }
    goal.status = newStatus;
    const oldPhase = goal.orchestration?.phase;
    if (goal.orchestration) {
      if (newStatus === "paused") {
        goal.orchestration.phase = "paused";
      } else if (newStatus === "active" && oldStatus === "paused") {
        goal.orchestration.phase = "needs_analysis";
      } else if (isGoalTerminal(newStatus)) {
        goal.orchestration.phase = "closed";
      }
      goal.orchestration.last_transition_at = (/* @__PURE__ */ new Date()).toISOString();
    }
    goal.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.goalStore.save(goal);
    this.eventBus.emit({ type: "goal:status_changed", goalId: id2, from: oldStatus, to: newStatus });
    if (oldPhase && goal.orchestration && oldPhase !== goal.orchestration.phase) {
      this.eventBus.emit({
        type: "goal:phase_changed",
        goalId: id2,
        from: oldPhase,
        to: goal.orchestration.phase,
        cycle: goal.orchestration.cycle
      });
    }
    if (goal.assignee) {
      if (newStatus === "paused") {
        await this.maybeDisableAutonomous(goal.assignee);
        await this.cancelPendingAutonomousTasks(goal.assignee);
      } else if (newStatus === "active" && oldStatus === "paused") {
        await this.enableAutonomous(goal.assignee);
      } else if (isGoalTerminal(newStatus)) {
        await this.maybeDisableAutonomous(goal.assignee);
      }
    }
    return goal;
  }
  async update(id2, fields) {
    const goal = await this.get(id2);
    const oldAssignee = goal.assignee;
    if (fields.title !== void 0) {
      if (!fields.title.trim()) throw new InvalidArgumentsError("Goal title cannot be empty");
      goal.title = fields.title.trim();
    }
    if (fields.description !== void 0) goal.description = fields.description.trim();
    if (fields.assignee !== void 0) goal.assignee = fields.assignee || void 0;
    if (fields.assignee !== void 0 && goal.orchestration?.enabled) {
      goal.orchestration.lead_agent_id = goal.assignee;
      goal.orchestration.last_transition_at = (/* @__PURE__ */ new Date()).toISOString();
    }
    goal.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.goalStore.save(goal);
    this.eventBus.emit({ type: "goal:updated", goalId: id2 });
    const newAssignee = goal.assignee;
    if (newAssignee !== oldAssignee) {
      const ops = [];
      if (newAssignee) ops.push(this.enableAutonomous(newAssignee));
      if (oldAssignee) ops.push(this.maybeDisableAutonomous(oldAssignee));
      await Promise.all(ops);
    }
    return goal;
  }
  async delete(id2) {
    const goal = await this.get(id2);
    const { assignee } = goal;
    await this.goalStore.delete(id2);
    this.eventBus.emit({ type: "goal:deleted", goalId: id2 });
    if (assignee) {
      await this.maybeDisableAutonomous(assignee);
    }
  }
  async listTasksForGoal(goalId) {
    return this.taskService?.list({ goalId }) ?? [];
  }
  async getProgressReport(goalId) {
    if (!this.contextStore) return void 0;
    const entry = await this.contextStore.get(`${goalId}-progress`);
    return entry?.value;
  }
  /** Enable autonomous mode on an agent. */
  async enableAutonomous(agentId) {
    if (!this.agentService) return;
    try {
      await this.agentService.setAutonomous(agentId, true);
    } catch {
    }
  }
  async recordGoalFailure(goal, message, context) {
    const failure = {
      message: sanitizeText(message).slice(0, 1e3),
      phase: "goal",
      at: (/* @__PURE__ */ new Date()).toISOString(),
      context,
      goalId: goal.id,
      retryable: true
    };
    goal.last_error = failure;
    goal.updated_at = failure.at;
    await this.goalStore.save(goal).catch(() => {
    });
    this.eventBus.emit({
      type: "goal:error",
      goalId: goal.id,
      error: failure.message,
      phase: failure.phase,
      retryable: failure.retryable
    });
  }
  /** Check if an agent has at least one active goal. */
  async hasActiveGoalsForAgent(agentId) {
    const activeGoals = await this.goalStore.list({ status: "active" });
    return activeGoals.some((g) => g.assignee === agentId);
  }
  /** Cancel dispatchable (todo/retrying) autonomous tasks assigned to the agent. */
  async cancelPendingAutonomousTasks(agentId) {
    if (!this.taskService) return;
    try {
      const [todos, retrying] = await Promise.all([
        this.taskService.list({ status: "todo" }),
        this.taskService.list({ status: "retrying" })
      ]);
      const pending = [...todos, ...retrying].filter(
        (t) => t.assignee === agentId && t.labels?.includes(AUTONOMOUS_LABEL)
      );
      await Promise.all(pending.map((t) => this.taskService.cancel(t.id).catch(() => {
      })));
    } catch {
    }
  }
  /** Disable autonomous if agent has no other active goals. */
  async maybeDisableAutonomous(agentId) {
    if (!this.agentService) return;
    try {
      if (!await this.hasActiveGoalsForAgent(agentId)) {
        await this.agentService.setAutonomous(agentId, false);
      }
    } catch {
    }
  }
};

// src/domain/team.ts
var DEFAULT_TEAM_CONFIG = {
  auto_claim: true,
  message_ttl_ms: 24 * 60 * 60 * 1e3
};

// src/application/team-service.ts
var TeamService = class {
  constructor(teamStore, agentStore, taskStore, eventBus) {
    this.teamStore = teamStore;
    this.agentStore = agentStore;
    this.taskStore = taskStore;
    this.eventBus = eventBus;
  }
  teamStore;
  agentStore;
  taskStore;
  eventBus;
  async create(input) {
    if (!input.name.trim()) throw new InvalidArgumentsError("Team name is required");
    const lead = await this.agentStore.get(input.lead_agent_id);
    if (!lead) throw new InvalidArgumentsError(`Lead agent not found: ${input.lead_agent_id}`);
    const existing = await this.teamStore.getByName(input.name.trim());
    if (existing) throw new InvalidArgumentsError(`Team "${input.name}" already exists`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const leadMember = { agent_id: input.lead_agent_id, role: "lead", joined_at: now };
    const additionalMembers = [];
    for (const agentId of input.member_agent_ids ?? []) {
      if (agentId === input.lead_agent_id) continue;
      const agent = await this.agentStore.get(agentId);
      if (!agent) throw new InvalidArgumentsError(`Member agent not found: ${agentId}`);
      additionalMembers.push({ agent_id: agentId, role: "member", joined_at: now });
    }
    const team = {
      id: `team_${nanoid(7)}`,
      name: input.name.trim(),
      description: input.description,
      status: "active",
      members: [leadMember, ...additionalMembers],
      task_pool: [],
      lead_agent_id: input.lead_agent_id,
      created_at: now,
      updated_at: now,
      config: { ...DEFAULT_TEAM_CONFIG, ...input.config ?? {} }
    };
    await this.teamStore.save(team);
    this.eventBus.emit({ type: "team:created", teamId: team.id, name: team.name, leadAgentId: team.lead_agent_id });
    for (const member of additionalMembers) {
      this.eventBus.emit({ type: "team:member_joined", teamId: team.id, agentId: member.agent_id });
    }
    return team;
  }
  async get(id2) {
    const team = await this.teamStore.get(id2);
    if (!team) throw new TeamNotFoundError(id2);
    return team;
  }
  async list() {
    return this.teamStore.list();
  }
  async join(teamId, agentId) {
    const team = await this.get(teamId);
    if (team.members.some((m) => m.agent_id === agentId)) {
      throw new InvalidArgumentsError(`Agent ${agentId} is already a member of team ${teamId}`);
    }
    const agent = await this.agentStore.get(agentId);
    if (!agent) throw new InvalidArgumentsError(`Agent not found: ${agentId}`);
    team.members.push({ agent_id: agentId, role: "member", joined_at: (/* @__PURE__ */ new Date()).toISOString() });
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    this.eventBus.emit({ type: "team:member_joined", teamId, agentId });
    return team;
  }
  async leave(teamId, agentId) {
    const team = await this.get(teamId);
    if (agentId === team.lead_agent_id) {
      throw new InvalidArgumentsError("Lead cannot leave team. Disband the team or transfer lead first.");
    }
    team.members = team.members.filter((m) => m.agent_id !== agentId);
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    this.eventBus.emit({ type: "team:member_left", teamId, agentId });
    return team;
  }
  async addTask(teamId, taskId) {
    const team = await this.get(teamId);
    const task = await this.taskStore.get(taskId);
    if (!task) throw new InvalidArgumentsError(`Task not found: ${taskId}`);
    if (!team.task_pool.includes(taskId)) {
      team.task_pool.push(taskId);
      team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      await this.teamStore.save(team);
      this.eventBus.emit({ type: "team:task_added", teamId, taskId });
    }
    return team;
  }
  async removeTask(teamId, taskId) {
    const team = await this.get(teamId);
    team.task_pool = team.task_pool.filter((id2) => id2 !== taskId);
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    return team;
  }
  async setLead(teamId, agentId) {
    const team = await this.get(teamId);
    const member = team.members.find((m) => m.agent_id === agentId);
    if (!member) throw new InvalidArgumentsError(`Agent ${agentId} is not a member of team ${teamId}`);
    const currentLead = team.members.find((m) => m.agent_id === team.lead_agent_id);
    if (currentLead) currentLead.role = "member";
    member.role = "lead";
    team.lead_agent_id = agentId;
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    return team;
  }
  async disband(teamId) {
    const team = await this.get(teamId);
    team.status = "disbanded";
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    this.eventBus.emit({ type: "team:disbanded", teamId });
  }
  /**
   * Find the team an agent belongs to (if any).
   */
  async findTeamForAgent(agentId) {
    const teams = await this.teamStore.list();
    return teams.find((t) => t.status === "active" && t.members.some((m) => m.agent_id === agentId)) ?? null;
  }
};

// src/container.ts
async function buildLightContainer(context) {
  const externalRoots = context.stateRoot && context.workspaceRoot ? { stateRoot: context.stateRoot, workspaceRoot: context.workspaceRoot } : (await import('./paths-A3DU4YL7.js')).externalOrchestryRoots(context.projectRoot);
  context.stateRoot = externalRoots.stateRoot;
  context.workspaceRoot = externalRoots.workspaceRoot;
  const paths = new Paths(context.projectRoot, externalRoots.stateRoot, externalRoots.workspaceRoot);
  const configStore = new ConfigStore(paths);
  const globalConfigStore = new GlobalConfigStore();
  const [, config] = await Promise.all([
    paths.requireInit(),
    configStore.read()
  ]);
  const taskStore = new TaskStore(paths);
  const agentStore = new AgentStore(paths);
  const runStore = new RunStore(paths);
  const stateStore = new StateStore(paths);
  const contextStore = new ContextStore(paths);
  const messageStore = new MessageStore(paths);
  const goalStore = new GoalStore(paths);
  const teamStore = new TeamStore(paths);
  const eventBus = new EventBus();
  const taskService = new TaskService(taskStore, eventBus, config, paths, agentStore);
  const agentService = new AgentService(agentStore, stateStore, eventBus, config);
  const runService = new RunService(runStore, eventBus);
  const messageService = new MessageService(messageStore, agentStore, teamStore, eventBus);
  const goalService = new GoalService(goalStore, eventBus, agentService, taskService, contextStore);
  const teamService = new TeamService(teamStore, agentStore, taskStore, eventBus);
  return {
    context,
    paths,
    config,
    taskStore,
    agentStore,
    runStore,
    stateStore,
    configStore,
    globalConfigStore,
    globalConfig: DEFAULT_GLOBAL_CONFIG,
    contextStore,
    messageStore,
    goalStore,
    teamStore,
    eventBus,
    taskService,
    agentService,
    runService,
    messageService,
    goalService,
    teamService
  };
}
async function buildFullContainer(context) {
  const light = await buildLightContainer(context);
  const globalConfig = await light.globalConfigStore.read();
  light.globalConfig = globalConfig;
  const [
    { ProcessManager: ProcessManager2 },
    { CommandRunner: CommandRunner2, resolveExecutable: resolveExecutable2 },
    { AdapterRegistry: AdapterRegistry2 },
    { ClaudeAdapter },
    { CodexAdapter },
    { CursorAdapter },
    { ShellAdapter },
    { OpenCodeAdapter },
    { PiAdapter },
    { GrokAdapter },
    { AntigravityAdapter },
    { WorkspaceManager },
    { LiquidTemplateEngine },
    { SkillLoader: SkillLoader2 },
    { Orchestrator: Orchestrator2 },
    { DoctorService },
    { WorkflowArtifactStore: WorkflowArtifactStore2 },
    { WorkflowEngine: WorkflowEngine2 },
    { WorkflowSafeguards },
    { NativeWorkflowRoleResolver, NativeWorkflowGitGateway }
  ] = await Promise.all([
    import('./process-manager-DX4C5EFA.js'),
    import('./command-runner-AV42AFFS.js'),
    import('./registry-JXXRLJ5J.js'),
    import('./claude-EL2UUOW2.js'),
    import('./codex-6QLBPS27.js'),
    import('./cursor-Y53ETVVX.js'),
    import('./shell-NO6ZM425.js'),
    import('./opencode-5TSF6URM.js'),
    import('./pi-GCPIMQHV.js'),
    import('./grok-5PXP5JU5.js'),
    import('./antigravity-P7UECLLC.js'),
    import('./workspace-manager-SGCEFAO3.js'),
    import('./template-engine-CLAUG4MB.js'),
    import('./skill-loader-4GSQSW7Q.js'),
    import('./orchestrator-ESDZI3RM.js'),
    import('./doctor-service-Q3CPX6FZ.js'),
    import('./artifact-store-KVMQWB4I.js'),
    import('./engine-A3JKYRPC.js'),
    import('./safeguards-OYONLEGJ.js'),
    import('./native-adapters-Y7TD6IR5.js')
  ]);
  const processManager = new ProcessManager2(path2.join(light.paths.root, "process-groups.json"));
  const commandRunner2 = new CommandRunner2(processManager);
  const templateEngine = new LiquidTemplateEngine();
  const skillLoader = new SkillLoader2();
  const workspaceManager = new WorkspaceManager(
    context.projectRoot,
    light.paths.workspacesRoot,
    commandRunner2
  );
  const adapterRegistry = new AdapterRegistry2();
  adapterRegistry.register(new ClaudeAdapter(processManager, commandRunner2));
  adapterRegistry.register(new CodexAdapter(processManager, commandRunner2));
  adapterRegistry.register(new CursorAdapter(processManager, commandRunner2));
  adapterRegistry.register(new ShellAdapter(processManager, commandRunner2));
  adapterRegistry.register(new OpenCodeAdapter(processManager, commandRunner2));
  adapterRegistry.register(new PiAdapter(processManager, commandRunner2));
  adapterRegistry.register(new GrokAdapter(processManager, commandRunner2));
  adapterRegistry.register(new AntigravityAdapter(processManager, commandRunner2));
  const [gitExecutable, nodeExecutable, npmExecutable, npxExecutable] = await Promise.all([
    resolveExecutable2("git"),
    resolveExecutable2("node"),
    resolveExecutable2("npm"),
    resolveExecutable2("npx")
  ]);
  const doctorService = new DoctorService(adapterRegistry, commandRunner2, { git: gitExecutable, node: nodeExecutable }, context.projectRoot);
  const workflowStore = new WorkflowArtifactStore2(light.paths.root, { rootIsStateRoot: true });
  const workflowSafeguards = new WorkflowSafeguards(context.projectRoot, light.paths.root, light.paths.workspacesRoot, commandRunner2, processManager);
  const workflowEngine = new WorkflowEngine2(workflowStore, {
    roles: new NativeWorkflowRoleResolver(processManager, commandRunner2, workflowSafeguards),
    git: new NativeWorkflowGitGateway(context.projectRoot, commandRunner2, light.paths.workspacesRoot, gitExecutable, workflowSafeguards),
    safeguards: workflowSafeguards
  });
  const orchestrator = new Orchestrator2({
    taskStore: light.taskStore,
    agentStore: light.agentStore,
    runStore: light.runStore,
    stateStore: light.stateStore,
    adapterRegistry,
    workspaceManager,
    templateEngine,
    processManager,
    commandRunner: commandRunner2,
    reviewExecutables: { npm: npmExecutable, npx: npxExecutable, node: nodeExecutable },
    executionSafeguards: workflowSafeguards,
    eventBus: light.eventBus,
    taskService: light.taskService,
    agentService: light.agentService,
    runService: light.runService,
    contextStore: light.contextStore,
    messageService: light.messageService,
    goalStore: light.goalStore,
    skillLoader,
    config: light.config,
    projectRoot: context.projectRoot,
    lockPath: light.paths.lockPath
  });
  return {
    ...light,
    processManager,
    commandRunner: commandRunner2,
    adapterRegistry,
    templateEngine,
    skillLoader,
    doctorService,
    orchestrator,
    workflowStore,
    workflowEngine,
    workflowSafeguards
  };
}
async function buildContainer(context) {
  return buildFullContainer(context);
}

export { AGENT_SHOP_TEMPLATES, AgentService, EventBus, GOVERNANCE_KINDS, GOVERNANCE_SCHEMA_VERSION, GovernanceServiceV3, GovernanceStoreV3, GovernedMergeV3, MODEL_TIER_MAP, RunService, SUPPORTED_ADAPTERS, TaskService, assertNoParallelScopeOverlap, buildContainer, buildFullContainer, buildLightContainer, defaultModelForAdapter, detectClipboardType, getClipboardImage, getShopTemplateByKey, hashGovernanceRecordV3, isAdapterKind, isClipboardToolAvailable, isMcpSkill, isModelTier, resolveModel, templateToAgentInput, validateBindingSnapshotV3, validateCandidateEvidenceV3, validateCheckBindingV3, validateDecompositionPlanV3, validateGovernanceBranchV3, validateGovernanceRecordV3, validateHumanApprovalV3, validateIntegrationReceiptV3, validateQuorumPolicyV3, validateQuorumResultV3, validateReviewVoteV3 };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map