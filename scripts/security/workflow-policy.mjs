#!/usr/bin/env node

/**
 * Varve workflow security policy — structural, YAML-aware audit.
 *
 * This module encodes the repository's CI privilege-boundary invariants as
 * machine-checkable rules (see docs/security/security-hardening.md §CI
 * permission matrix). validate-workflows.mjs runs it over every workflow on
 * commit/PR; the tests in workflow-policy.test.mjs prove each rule with
 * synthetic fixtures.
 *
 * The rules, briefly:
 *   1. No pull_request_target triggers (fork-privilege escalation).
 *   2. No `secrets: inherit` (unreviewed secret propagation).
 *   3. Production signing secrets are referenced ONLY by release.yml, and in
 *      release.yml only by signing-preflight presence checks or steps gated
 *      on a signed-mode condition.
 *   4. No non-GITHUB_TOKEN secrets in any workflow that can run on a
 *      pull_request (forked code must never see repo secrets).
 *   5. id-token: write only where attestation/pages needs it.
 *   6. attestations: write only on the release verify job.
 *   7. actions: write never.
 *   8. pages: write only on the website-deploy deploy job.
 *   9. contents: write only on the release draft/publish jobs and the
 *      manual-dispatch visual-baselines workflow.
 *   10. issues/pull-requests write only on the ci.yml jobs that post debug
 *       comments.
 *   11. Signing credentials are never persisted through $GITHUB_ENV.
 *   12. release.yml publish requires the release-publish environment and the
 *       publish=yes dispatch input; website deploy requires github-pages.
 *   13. Tag provenance: release.yml preflight verifies the tag points at a
 *       commit reachable from the default branch.
 *   14. Every workflow declares explicit permissions (workflow or job level).
 *   15. Website-deploy checkouts persist no credentials.
 *   16. Backend/service and DNS credential classes are referenced by NO
 *       workflow (they have no legitimate consumer today; a future
 *       backend-deploy workflow must extend the explicit allowlist, never
 *       the deny rule).
 *   17. `permissions: write-all` is never acceptable.
 */

import { load } from 'js-yaml';

const SIGNING_SECRETS = [
  'APPLE_CERTIFICATE',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_SIGNING_IDENTITY',
  'APPLE_API_ISSUER',
  'APPLE_API_KEY',
  'APPLE_API_KEY_P8_BASE64',
  'APPLE_ID',
  'APPLE_PASSWORD',
  'APPLE_TEAM_ID',
  'AZURE_SIGNING_CLIENT_ID',
  'AZURE_SIGNING_CLIENT_SECRET',
  'AZURE_SIGNING_TENANT_ID',
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  'TAURI_UPDATER_PRIVATE_KEY',
  'TAURI_UPDATER_PRIVATE_KEY_PASSWORD',
  'WINDOWS_SIGNING_PRIVATE_KEY',
];

// Production secrets that belong to NO workflow in this repository today.
// The website and desktop clients have no backend; signing and DNS classes
// are separately denied. When a real backend arrives, extend this rule with
// an explicit per-workflow allowlist (e.g. backend-deploy.yml may reference
// the BACKEND_* family) — never loosen the denial for every workflow.
const BACKEND_SECRET_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'DATABASE_PASSWORD',
  'DATABASE_USER',
  'REDIS_URL',
  'REDIS_PASSWORD',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SMTP_PASSWORD',
  'SMTP_USER',
  'WEBHOOK_SECRET',
  'JWT_SIGNING_SECRET',
  'JWT_PRIVATE_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'SENDGRID_API_KEY',
  'EMAIL_PROVIDER_API_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
  'GITHUB_PAT',
];

const BACKEND_SECRET_PREFIXES = [
  'DATABASE_',
  'REDIS_',
  'STRIPE_',
  'OPENAI_',
  'ANTHROPIC_',
  'SMTP_',
  'WEBHOOK_',
  'JWT_',
  'AWS_',
  'GCP_',
  'SENDGRID_',
  'OBJECT_STORAGE_',
];

const DNS_SECRET_NAMES = ['PORKBUN_API_KEY', 'PORKBUN_API_SECRET', 'PORKBUN_SECRET_API_KEY'];

const DNS_SECRET_PREFIXES = ['PORKBUN_'];

// The signing-step exception flag for the client environment guard: it may
// only ever be set inside release.yml (the Tauri build step that holds
// signing credentials in its process environment). The canary, by contrast,
// is deliberately settable in any client build workflow — the artifact scan
// asserts its value never reaches the output.
const SIGNING_STEP_ALLOWED_FLAG = 'VARVE_SIGNING_STEP_ALLOWED';

const SIGNING_REF = new RegExp(`\\$\\{\\{ secrets\\.(${SIGNING_SECRETS.join('|')})\\s*\\}\\}`);
const ANY_SECRET_REF = /\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g;

function triggersOn(triggerName, on) {
  if (!on || typeof on !== 'object') return false;
  if (on[triggerName] !== undefined) return true;
  if (Array.isArray(on)) return on.includes(triggerName);
  return false;
}

function jobEntries(doc) {
  const jobs = doc.jobs ?? {};
  return Object.entries(jobs);
}

function findInValue(value, re) {
  const hits = [];
  if (typeof value === 'string') {
    // exec() only advances lastIndex on global regexes; clone non-global
    // patterns so the loop cannot spin forever on a first-match.
    const g = re.global ? re : new RegExp(re.source, `${re.flags}g`);
    g.lastIndex = 0;
    for (;;) {
      const m = g.exec(value);
      if (m === null) break;
      hits.push(m);
    }
    return hits;
  }
  if (Array.isArray(value)) {
    for (const item of value) hits.push(...findInValue(item, re));
    return hits;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) hits.push(...findInValue(v, re));
  }
  return hits;
}

function walkSteps(job) {
  const steps = [];
  for (const step of job.steps ?? []) {
    if (step && typeof step === 'object') steps.push(step);
  }
  return steps;
}

export function auditWorkflow(doc, filename) {
  const errors = [];
  const base = filename.split('/').pop();

  // 16. `on:` must contain only known trigger keys. A top-level key
  // mis-indented under `on:` (e.g. a `permissions:` block) parses silently —
  // js-yaml yields `on: null` and the triggers land inside the misplaced key,
  // and GitHub rejects the workflow before any job starts. Detect both
  // symptoms: an absent `on` document and trigger keys nested under any
  // non-`on` top-level key.
  const KNOWN_TRIGGERS = [
    'push',
    'pull_request',
    'pull_request_target',
    'workflow_dispatch',
    'schedule',
    'workflow_run',
    'workflow_call',
    'repository_dispatch',
  ];
  const triggerIn = (obj) =>
    obj && typeof obj === 'object' && !Array.isArray(obj)
      ? Object.keys(obj).filter((k) => KNOWN_TRIGGERS.includes(k))
      : [];
  if (!doc.on || typeof doc.on !== 'object') {
    const swallowedBy = Object.entries(doc)
      .filter(([k]) => k !== 'on')
      .map(([k, v]) => ({ key: k, triggers: triggerIn(v) }))
      .filter((x) => x.triggers.length > 0);
    if (swallowedBy.length > 0) {
      errors.push(
        `${base}: triggers are nested under "${swallowedBy[0].key}" instead of on: — ` +
          'the workflow will fail before any job starts; check top-level key indentation',
      );
    } else {
      errors.push(`${base}: no on: triggers found — the workflow cannot run`);
    }
  } else {
    const badKeys = Object.keys(doc.on).filter((k) => !KNOWN_TRIGGERS.includes(k));
    if (badKeys.length > 0) {
      errors.push(
        `${base}: on: contains unknown key(s) ${badKeys.join(', ')} — the workflow ` +
          'will fail before any job starts; check top-level key indentation',
      );
    }
  }

  // 1. pull_request_target is never acceptable in this repository.
  if (triggersOn('pull_request_target', doc.on)) {
    errors.push(`${base}: pull_request_target trigger — fork-privilege escalation risk`);
  }

  const prCapable = triggersOn('pull_request', doc.on) || triggersOn('pull_request_target', doc.on);

  // 2. secrets: inherit is a blanket secret grant.
  const walkObjects = (value, fn) => {
    if (Array.isArray(value)) {
      for (const item of value) walkObjects(item, fn);
      return;
    }
    if (value && typeof value === 'object') {
      fn(value);
      for (const v of Object.values(value)) walkObjects(v, fn);
    }
  };
  walkObjects(doc, (node) => {
    if (node.secrets === 'inherit') {
      errors.push(`${base}: a step uses \`secrets: inherit\` — unreviewed secret propagation`);
    }
  });

  const signingRefs = findInValue(doc, SIGNING_REF);

  // 3. Signing secrets live only in release.yml, gated on signed mode.
  if (signingRefs.length > 0 && base !== 'release.yml') {
    errors.push(
      `${base}: references production signing secrets (${[
        ...new Set(signingRefs.map((m) => m[1])),
      ].join(', ')}) — signing material must never enter this workflow`,
    );
  }

  if (base === 'release.yml') {
    for (const [name, job] of jobEntries(doc)) {
      if (typeof job !== 'object' || job === null) continue;
      const refs = findInValue(job, SIGNING_REF);
      if (refs.length === 0) continue;
      if (name === 'signing-preflight') continue; // presence booleans only
      const steps = walkSteps(job);
      for (const step of steps) {
        const stepText = JSON.stringify(step);
        if (SIGNING_REF.test(stepText)) {
          const ifCond = step.if ?? '';
          if (!/signed/.test(String(ifCond))) {
            errors.push(
              `${base}: ${name} job step "${step.name ?? '(unnamed)'}" references signing ` +
                "secrets without a signed-mode gate (if: ... == 'signed')",
            );
          }
        }
      }
      // GITHUB_ENV persistence of signing material is forbidden outright.
      for (const step of steps) {
        const run = String(step.run ?? '');
        const stepText = JSON.stringify(step);
        if (run.includes('$GITHUB_ENV') && /APPLE_|AZURE_|TAURI_/.test(stepText)) {
          errors.push(
            `${base}: ${name} job step "${step.name ?? '(unnamed)'}" writes signing ` +
              'material to $GITHUB_ENV — pass secrets to the exact step that needs them',
          );
        }
      }
    }
  }

  // 4. PR-capable workflows may reference only the default GITHUB_TOKEN.
  if (prCapable) {
    for (const [name, job] of jobEntries(doc)) {
      if (typeof job !== 'object' || job === null) continue;
      const refs = findInValue(job, ANY_SECRET_REF);
      const foreign = [...new Set(refs.map((m) => m[1]))].filter((s) => s !== 'GITHUB_TOKEN');
      if (foreign.length > 0) {
        errors.push(
          `${base}: ${name} job references non-default secrets (${foreign.join(', ')}) ` +
            'from a pull_request-capable workflow — forked code must never see repo secrets',
        );
      }
    }
  }

  // 16. Backend/service and DNS credential classes have no legitimate
  // consumer in any workflow today. Unlike the signing rule (which has an
  // explicit home in release.yml), there is no allowlist yet: a future
  // backend-deploy workflow must extend the allowlist below, not weaken the
  // denial. Applies to `secrets.` and `vars.` (DNS class) references.
  const backendHits = new Set();
  const dnsHits = new Set();
  const walkAll = (value, path) => {
    if (typeof value === 'string') {
      const secretRefs = [...value.matchAll(/\$\{\{\s*(?:secrets|vars)\.([A-Za-z0-9_]+)\s*\}\}/g)];
      for (const m of secretRefs) {
        const name = m[1];
        const isBackend =
          BACKEND_SECRET_NAMES.includes(name) ||
          BACKEND_SECRET_PREFIXES.some((p) => name.startsWith(p));
        const isDns =
          DNS_SECRET_NAMES.includes(name) || DNS_SECRET_PREFIXES.some((p) => name.startsWith(p));
        if (isBackend) backendHits.add(name);
        if (isDns) dnsHits.add(name);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) walkAll(value[i], `${path}[${i}]`);
      return;
    }
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) walkAll(value[k], `${path}.${k}`);
    }
  };
  walkAll(doc, '$');
  if (backendHits.size > 0) {
    errors.push(
      `${base}: references backend/service credentials ([${[...backendHits].join(', ')}]) — ` +
        'no workflow in this repository may consume backend secrets; they belong to a future ' +
        'backend-deploy workflow with its own environment',
    );
  }
  if (dnsHits.size > 0) {
    errors.push(
      `${base}: references DNS/registrar credentials ([${[...dnsHits].join(', ')}]) — ` +
        'Porkbun credentials must stay out of application, website and CI workflows entirely',
    );
  }

  // Client environment guard flags: the signing-step exception is consumed
  // only by the release pipeline — a client build workflow that sets it
  // would disable the guard's signing deny-list.
  {
    const flagRefs = findInValue(doc, new RegExp(`\\b${SIGNING_STEP_ALLOWED_FLAG}\\b`));
    if (base !== 'release.yml' && flagRefs.length > 0) {
      errors.push(
        `${base}: sets ${SIGNING_STEP_ALLOWED_FLAG} — this client-env guard flag may only be used inside release.yml`,
      );
    }
  }

  // 17. write-all permission grant is never acceptable.
  if (doc.permissions === 'write-all') {
    errors.push(`${base}: workflow-level permissions: write-all — never acceptable`);
  }
  for (const [name, job] of jobEntries(doc)) {
    if (typeof job !== 'object' || job === null) continue;
    if (job.permissions === 'write-all') {
      errors.push(`${base}: ${name} grants permissions: write-all — never acceptable`);
    }
  }

  // 5-7. Elevated token scopes are whitelisted per workflow/job.
  const allowedIdToken = new Set(['website-deploy.yml:deploy', 'release.yml:verify']);
  const allowedAttestations = new Set(['release.yml:verify']);
  const allowedContentsWrite = new Set([
    'release.yml:draft',
    'release.yml:publish',
    'visual-baselines.yml:__workflow__',
  ]);
  const allowedIssuesWrite = new Set([
    'ci.yml:rust',
    'ci.yml:js',
    'ci.yml:e2e',
    'ci.yml:desktop-e2e',
  ]);
  const allowedPagesWrite = new Set(['website-deploy.yml:deploy']);

  const collectPerms = (job, name) => {
    if (job.permissions && typeof job.permissions === 'object') {
      return { perms: job.permissions, scope: `${base}:${name}` };
    }
    if (doc.permissions && typeof doc.permissions === 'object') {
      // Workflow-level permissions apply to every job in the run.
      return { perms: doc.permissions, scope: `${base}:__workflow__` };
    }
    return null;
  };

  for (const [name, job] of jobEntries(doc)) {
    if (typeof job !== 'object' || job === null) continue;
    const p = collectPerms(job, name);
    if (!p) continue;
    for (const [scope, value] of Object.entries(p.perms)) {
      if (value !== 'write') continue;
      const where = p.scope;
      if (scope === 'id-token' && !allowedIdToken.has(where)) {
        errors.push(`${base}: ${name} grants id-token: write without a whitelisted need`);
      }
      if (scope === 'attestations' && !allowedAttestations.has(where)) {
        errors.push(`${base}: ${name} grants attestations: write outside the release verify job`);
      }
      if (scope === 'actions' && value === 'write') {
        errors.push(`${base}: ${name} grants actions: write — never required`);
      }
      if (scope === 'contents' && !allowedContentsWrite.has(where)) {
        errors.push(
          `${base}: ${name} grants contents: write — allowed only on release draft/publish ` +
            'and manual visual-baselines',
        );
      }
      if (scope === 'pages' && !allowedPagesWrite.has(where)) {
        errors.push(`${base}: ${name} grants pages: write outside the website deploy job`);
      }
      if ((scope === 'issues' || scope === 'pull-requests') && !allowedIssuesWrite.has(where)) {
        errors.push(
          `${base}: ${name} grants ${scope}: write — allowed only on ci.yml debug-comment jobs`,
        );
      }
    }
  }

  // 12. Environment + dispatch gates on the publication paths.
  if (base === 'release.yml') {
    const publishJob = doc.jobs?.publish;
    if (!publishJob || typeof publishJob !== 'object') {
      errors.push('release.yml: missing publish job — publication path must exist explicitly');
    } else {
      const envName = publishJob.environment?.name ?? publishJob.environment;
      if (envName !== 'release-publish') {
        errors.push(
          'release.yml: publish job must declare environment: release-publish (required reviewers)',
        );
      }
      const ifCond = String(publishJob.if ?? '');
      if (!ifCond.includes("publish == 'yes'") && !ifCond.includes("publish == 'yes'")) {
        errors.push(
          "release.yml: publish job must be gated on the explicit dispatch input publish == 'yes'",
        );
      }
    }
    const deployJob = doc.jobs?.deploy;
    if (deployJob && typeof deployJob === 'object') {
      const envName = deployJob.environment?.name ?? deployJob.environment;
      if (envName !== 'github-pages') {
        errors.push('release.yml: deploy job must declare environment: github-pages');
      }
    }
  }

  if (base === 'website-deploy.yml') {
    const deployJob = doc.jobs?.deploy;
    if (!deployJob || typeof deployJob !== 'object') {
      errors.push('website-deploy.yml: missing deploy job');
    } else {
      const envName = deployJob.environment?.name ?? deployJob.environment;
      if (envName !== 'github-pages') {
        errors.push('website-deploy.yml: deploy job must declare environment: github-pages');
      }
    }
    // 15. Website checkouts never need push credentials.
    for (const [name, job] of jobEntries(doc)) {
      if (typeof job !== 'object' || job === null) continue;
      for (const step of walkSteps(job)) {
        const uses = String(step.uses ?? '');
        if (uses.startsWith('actions/checkout')) {
          const persist = step.with?.['persist-credentials'] ?? step.with?.persistCredentials;
          if (persist !== false) {
            errors.push(
              `website-deploy.yml: ${name} checkout must set persist-credentials: false ` +
                '(the Pages deploy never pushes)',
            );
          }
        }
      }
    }
  }

  // 13. Tag provenance gate exists in the release preflight.
  if (base === 'release.yml') {
    const preflight = doc.jobs?.preflight;
    const steps = preflight && typeof preflight === 'object' ? walkSteps(preflight) : [];
    const hasProvenance = steps.some(
      (s) =>
        String(s.run ?? '').includes('merge-base --is-ancestor') &&
        String(s.run ?? '').includes('origin/'),
    );
    if (!hasProvenance) {
      errors.push(
        'release.yml: preflight must verify the tag points at a commit reachable from the ' +
          'default branch (merge-base --is-ancestor against origin/<default>) — a manual ' +
          'dispatch tag must not release arbitrary code',
      );
    }
  }

  // 14. Explicit permissions on every workflow.
  const jobs = jobEntries(doc);
  if (!doc.permissions) {
    const allJobsHavePerms = jobs.every(
      ([, job]) => job && typeof job === 'object' && job.permissions,
    );
    if (!allJobsHavePerms) {
      errors.push(
        `${base}: no permissions block — every workflow must declare explicit least-privilege ` +
          'permissions (workflow-level or on every job)',
      );
    }
  }

  return errors;
}

export function auditWorkflowYaml(text, filename) {
  // `json: true` makes js-yaml silently accept duplicate mapping keys. That
  // is unsafe for workflows: a second `env`, `permissions`, or `jobs` block
  // can replace the first one while the file still looks valid in review.
  const doc = load(text);
  if (!doc || typeof doc !== 'object') {
    return [`${filename}: YAML parsed to a non-object document`];
  }
  return auditWorkflow(doc, filename);
}

// CLI: audit every workflow under .github/workflows and exit non-zero on any
// violation. Mirrors validate-workflows.mjs usage.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv[1] === import.meta.filename ?? process.argv[1]?.endsWith('workflow-policy.mjs')) {
  const dir = join(process.cwd(), '.github/workflows');
  let failed = false;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    const violations = auditWorkflowYaml(text, file);
    for (const v of violations) {
      failed = true;
      console.error(`  [policy] ${v}`);
    }
  }
  if (failed) {
    console.error('Workflow security policy violations found.');
    process.exit(1);
  }
  console.log('Workflow security policy: OK.');
}
