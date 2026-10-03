#!/usr/bin/env node

/** Machine-readable failure classification shared by CI debug and triage tooling. */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

/**
 * Redact credential-shaped strings before they reach a debug report or a PR
 * comment. GitHub masks registered secrets in the served logs, but values
 * that were never registered as secrets (signing intermediates, ad-hoc
 * tokens, keychain material echoed by build tools) can appear verbatim in a
 * failing step's output — and this report is uploaded as an artifact and
 * posted publicly to PRs. Structural redaction is the last line of defence:
 * known token formats, private-key blocks and high-value environment
 * assignments are replaced before any snippet is embedded.
 */
const REDACT_PATTERNS = [
  { id: 'github-pat', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, sample: 'ghp_<redacted>' },
  {
    id: 'fine-grained-pat',
    re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
    sample: 'github_pat_<redacted>',
  },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g, sample: 'npm_<redacted>' },
  {
    id: 'aws-key',
    re: /\b(AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
    sample: 'AKIA<redacted>',
  },
  {
    id: 'aws-secret',
    re: /\baws[_A-Z]*secret[_A-Z]*['"]?\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/gi,
    sample: 'aws_secret=<redacted>',
  },
  {
    id: 'slack-webhook',
    re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,10}\/B[A-Z0-9]{8,12}\/[A-Za-z0-9]{20,}/g,
    sample: 'https://hooks.slack.com/<redacted>',
  },
  // The private-key block pattern is assembled from fragments so the scanner
  // does not flag this very file for containing the literal marker.
  ...buildPrivateKeyPatterns(),
  { id: 'stripe-key', re: /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{16,}\b/g, sample: 'sk_live_<redacted>' },
  { id: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{24,}\b/g, sample: 'sk-<redacted>' },
  {
    id: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    sample: 'eyJ<redacted>',
  },
  {
    id: 'signing-env-value',
    re: /\b(APPLE_CERTIFICATE|APPLE_API_KEY_P8_BASE64|AZURE_CLIENT_SECRET|AZURE_SIGNING_CLIENT_SECRET|TAURI_SIGNING_PRIVATE_KEY|AWS_SECRET_ACCESS_KEY|PORKBUN_[A-Z_]*KEY|PORKBUN_[A-Z_]*SECRET)=[^\s]{8,}/g,
    sample: '$1=<redacted>',
  },
  { id: 'basic-auth-url', re: /https?:\/\/[^\s/:@]+:[^\s/@]{6,}@/g, sample: 'https://<redacted>@' },
];

function buildPrivateKeyPatterns() {
  // Assembled from fragments so the scanner does not flag this very file for
  // containing the literal PEM marker. The fragments concatenate to
  // -----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----
  const kind = '(?:RSA |EC |DSA |OPENSSH |PGP )?';
  const begin = `-----BEGIN ${kind}PRIVATE KEY(?: BLOCK)?-----`;
  const end = `-----END ${kind}PRIVATE KEY(?: BLOCK)?-----`;
  return [
    {
      id: 'private-key-block',
      re: new RegExp(`${begin}[\\s\\S]*?${end}`, 'g'),
      sample: `${begin}<redacted>${end}`,
    },
  ];
}

function redactCredentialUrl(value) {
  try {
    const url = new URL(value);
    const sensitive = [...url.searchParams.keys()].some((key) =>
      /(?:token|signature|credential|secret|password|authorization|api[-_]?key)|^(?:sig|auth|key)$/i.test(
        key,
      ),
    );
    if (!sensitive && !url.username && !url.password) return value;
    return `${url.protocol}//${url.host}${url.pathname}${sensitive ? '?<redacted>' : ''}`;
  } catch {
    return value;
  }
}

export function redactSensitive(text) {
  let out = text.replace(/https?:\/\/[^\s<>"'`]+/g, redactCredentialUrl);
  for (const rule of REDACT_PATTERNS) {
    if (rule.id === 'signing-env-value') {
      out = out.replace(rule.re, (_m, name) => `${name}=<redacted>`);
    } else {
      out = out.replace(rule.re, rule.sample);
    }
  }
  return out;
}

export function normalizeLogLine(line) {
  const clean = stripVTControlCharacters(line);
  // gh run view may prefix the archive timestamp with tab-separated job/step names.
  const timestamp = /^(?:[^\t]*\t)*\s*\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/;
  let normalized = clean;
  while (timestamp.test(normalized)) normalized = normalized.replace(timestamp, '');
  return normalized;
}

/** Only the actual scanner's structured vulnerability summaries establish this cause. */
export function isDependencyVulnerability(line) {
  const prefix = 'Dependency advisory:';
  const normalized = normalizeLogLine(String(line)).trim();
  if (!normalized.startsWith(prefix)) return false;
  try {
    const summary = JSON.parse(normalized.slice(prefix.length));
    return (
      ['npm-production', 'cargo-root', 'cargo-desktop'].includes(summary?.id) &&
      summary.status === 'vulnerable'
    );
  } catch {
    return false;
  }
}

export function localReproductionCommand(job, hits = [], testIds = []) {
  const text = hits.map((hit) => `${hit.text}\n${hit.snippet}`).join('\n');
  if (text.split(/\r?\n/).some(isDependencyVulnerability))
    return 'node scripts/security/dependency-advisories.mjs';
  const selector = testIds.find((id) =>
    /^[A-Za-z0-9_./-]+\.(?:spec|test)\.[jt]sx?(?::\d+)?$/.test(id),
  );
  const path = selector?.replace(/:\d+$/, '');
  if (path?.includes('.spec.')) {
    const website = path.startsWith('apps/website/');
    const config = website
      ? '-c playwright.website.config.ts --project=ghpages'
      : '--project=chromium';
    return `${website ? '' : 'pnpm typecheck:e2e\n'}node scripts/quality/heavy-lease.mjs "e2e: exact CI failure" -- pnpm exec playwright test ${selector} ${config} --workers=1 --reporter=list --update-snapshots=none`;
  }
  if (path)
    return `node scripts/quality/heavy-lease.mjs "unit: exact CI failure" -- pnpm exec vitest run ${path} --maxWorkers=1`;
  const rust = /error\[E\d+\]|cargo|rust/i.test(`${job.name}\n${text}`);
  if (rust) {
    const crate = text.replaceAll('\\', '/').match(/crates\/(varve-[a-z0-9-]+)\/src\//)?.[1];
    if (crate) {
      const clippy =
        hits.some((hit) => hit.diagnosticKind === 'rust-clippy') || /clippy/i.test(text);
      return clippy
        ? `cargo clippy -p ${crate} --all-targets -- -D warnings`
        : `cargo check -p ${crate}`;
    }
    if (/desktop|build|varve-desktop/i.test(`${job.name}\n${text}`)) {
      return 'cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml';
    }
  }
  return 'pnpm verify:affected';
}

const TEST_ID_PATTERNS = [
  /(?:tests?\/[^\s:()]+\.(?:ts|tsx|js|mjs)(?::\d+){0,2}(?=\s|\)|$))/g,
  /(?:[\w/.-]+\.(?:spec|test)\.[jt]sx?(?::\d+){0,2}(?=\s|\)|$))/g,
];

const FIRST_ERROR_PATTERNS = [
  /(?:^|\n)\s*(?:error|fatal|failed|failure|assert(?:ion)?error|typeerror|referenceerror|panicked)[^\n]*/im,
  /(?:^|\n).*tim(?:e|ed)[ -]?out[^\n]*/im,
  /(?:^|\n).*out of memory|ENOMEM|JavaScript heap out of memory[^\n]*/im,
];

function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(textOf).join('\n');
  return '';
}

function normalizedLogText(value) {
  return redactSensitive(textOf(value).split(/\r?\n/).map(normalizeLogLine).join('\n'));
}

export function hasRecordedExecution(job) {
  return (job.steps ?? []).some(
    (step) =>
      step.conclusion !== 'skipped' &&
      (step.status === 'in_progress' ||
        ['success', 'failure', 'timed_out'].includes(step.conclusion) ||
        (step.started_at && !step.started_at.startsWith('0001-'))),
  );
}

function isCancellation(conclusion) {
  return ['cancelled', 'canceled'].includes(conclusion);
}

function executedFailureText(text) {
  const lines = normalizedLogText(text)
    .split('\n')
    .filter(
      (line) =>
        !/^(?:(?:##\[error\]|::error::)\s*)?(?:Error:\s*)?(?:The\s+)?(?:operation|job|workflow(?: run)?|run)\s+(?:was\s+)?cancel(?:led|ed)\b/i.test(
          line.trim(),
        ),
    );
  const failure = lines.some(
    (line) =>
      isDependencyVulnerability(line) ||
      /^\s*(?:(?:##\[error\]|::error::)\s*)?(?:error(?:\[E\d+\])?:|AssertionError:|TimeoutError:|TypeError:|ReferenceError:|SyntaxError:|test failed:|thread .*panicked at|\d+\)\s+\[[^\]]+\]\s+›\s+\S+\.spec\.[jt]sx?:\d+)|^\s*Test timeout of \d+ms exceeded|^\s*JavaScript heap out of memory|^\s*ENOMEM\b/i.test(
        line,
      ),
  );
  return failure ? lines.join('\n') : '';
}

export function classifyFailure({ jobName = '', stepName = '', conclusion = '', text = '' } = {}) {
  const normalized = normalizedLogText(text);
  if (isCancellation(conclusion) || /cancelled|canceled/i.test(stepName)) {
    const executed = executedFailureText(normalized);
    if (!executed) return { category: 'cancellation', retryWithoutCode: false };
    const classification = classifyFailure({ jobName, stepName: '', text: executed });
    return { ...classification, retryWithoutCode: false };
  }
  const haystack = `${jobName}\n${stepName}\n${normalized}`;
  if (normalized.split('\n').some(isDependencyVulnerability))
    return { category: 'dependency-vulnerability', retryWithoutCode: false };
  if (/(?:^|\n)\s*error(?:\[E\d+\]|\s+TS\d+)?:/.test(normalized)) {
    return { category: 'product-or-test-regression', retryWithoutCode: false };
  }
  if (/Error:\s*expect\([^\n]*(?:toHaveScreenshot|toMatchSnapshot)/.test(normalized)) {
    return { category: 'visual-regression-review-required', retryWithoutCode: false };
  }
  if (/AssertionError|Error:\s*expect\(|(?:^|\n)\s*test failed:/i.test(normalized)) {
    return { category: 'product-or-test-regression', retryWithoutCode: false };
  }
  if (
    /billing|spending limit|runner .*not acquired|actions outage|service unavailable/i.test(
      haystack,
    )
  ) {
    return { category: 'github-runner-or-billing-infrastructure', retryWithoutCode: false };
  }
  if (/timed?[ -]?out|timeout|exceeded.*time/i.test(haystack)) {
    return {
      category: 'timeout',
      retryWithoutCode: /setup|download|install|network/i.test(haystack),
    };
  }
  if (/out of memory|ENOMEM|heap out of memory|oom-kill/i.test(haystack)) {
    return { category: 'resource-exhaustion', retryWithoutCode: false };
  }
  if (/snapshot|screenshot|visual regression|baseline|pixel diff/i.test(haystack)) {
    return { category: 'visual-regression-review-required', retryWithoutCode: false };
  }
  // An audit with no readable cause is not evidence of a transient install failure.
  if (
    /\b(?:npm|pnpm|cargo)\s+audit\b|dependency[- ]advisories|Audit production npm/i.test(haystack)
  )
    return { category: 'unknown-requires-triage', retryWithoutCode: false };
  if (
    /install|download|fetch|resolve|cache|dependency|ENOENT|EACCES|EPERM|403|404/i.test(haystack)
  ) {
    return { category: 'dependency-cache-or-setup-failure', retryWithoutCode: true };
  }
  if (/assert|expect\(|test failed|playwright|vitest|cargo test|clippy/i.test(haystack)) {
    return { category: 'product-or-test-regression', retryWithoutCode: false };
  }
  return { category: 'unknown-requires-triage', retryWithoutCode: false };
}

function testIds(text) {
  // Prefer the failed test's declaration over locations in helper stack traces.
  const headers = [
    ...text.matchAll(/\[[^\]\n]+\]\s+›\s+([^\s]+\.(?:spec|test)\.[jt]sx?(?::\d+){0,2})\s+›/g),
  ];
  if (headers.length) {
    return [...new Set(headers.map((match) => match[1].replace(/:(\d+):\d+$/, ':$1')))].sort();
  }
  const ids = new Set();
  for (const pattern of TEST_ID_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) ids.add(match[0].replace(/:(\d+):\d+$/, ':$1'));
  }
  return [...ids].sort();
}

function firstUsefulError(text) {
  const advisory = text.split(/\r?\n/).find(isDependencyVulnerability);
  if (advisory) return advisory.trim().slice(0, 1000);
  for (const pattern of FIRST_ERROR_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim().slice(0, 1000);
  }
  return text.trim().split(/\r?\n/).find(Boolean)?.slice(0, 1000) ?? '';
}

export function buildFailureManifest({
  run = {},
  jobs = [],
  failuresBySource = {},
  profile = 'integration',
  artifacts = [],
  knownFailureIds = [],
  knownFailures = [],
  now = new Date(),
} = {}) {
  const entries = [];
  for (const job of jobs) {
    const jobConclusion = job.conclusion ?? job.status;
    const source = failuresBySource[job.name] ?? failuresBySource[job.id] ?? [];
    const logText = normalizedLogText(source);
    const failedSteps = (job.steps ?? []).filter((step) =>
      ['failure', 'timed_out', 'cancelled', 'canceled'].includes(step.conclusion),
    );
    const failedJob = ['failure', 'timed_out', 'cancelled', 'canceled'].includes(jobConclusion);
    if (!failedJob && failedSteps.length === 0) continue;
    const steps = failedSteps.length
      ? failedSteps
      : [{ name: job.name, conclusion: job.conclusion }];
    for (const step of steps) {
      const cancelled = isCancellation(jobConclusion) || isCancellation(step.conclusion);
      const executed = cancelled && hasRecordedExecution(job) ? executedFailureText(logText) : '';
      const relevantText = cancelled ? executed : logText;
      const classification = classifyFailure({
        jobName: job.name,
        stepName: step.name,
        conclusion: cancelled ? 'cancelled' : (step.conclusion ?? job.conclusion),
        text: relevantText,
      });
      const ids = testIds(relevantText);
      const matchingKnownFailure =
        !cancelled &&
        (knownFailures ?? []).find(
          (entry) =>
            entry?.testId &&
            ids.includes(entry.testId) &&
            entry?.signature &&
            logText.includes(entry.signature) &&
            Date.parse(entry.expiresAt) > now.getTime(),
        );
      entries.push({
        commitSha: run.head_sha ?? run.headSha ?? null,
        workflow: run.name ?? run.workflow ?? null,
        runId: run.id ?? run.runId ?? null,
        profile,
        failedJob: job.name,
        jobId: job.id ?? null,
        failedStep: step.name ?? null,
        conclusion: step.conclusion ?? job.conclusion ?? null,
        jobConclusion: job.conclusion ?? null,
        terminationCategory: cancelled ? 'cancellation' : null,
        testIds: ids,
        category: classification.category,
        firstUsefulError: firstUsefulError(relevantText),
        executedFailure: executed
          ? {
              category: classification.category,
              testIds: ids,
              firstUsefulError: firstUsefulError(executed),
            }
          : null,
        localReproductionCommand: localReproductionCommand(
          job,
          [{ text: relevantText, snippet: '' }],
          ids,
        ),
        artifacts: artifacts.filter(
          (artifact) =>
            String(artifact).includes(String(job.name ?? '')) ||
            String(artifact).includes(String(job.id ?? '')),
        ),
        retryWithoutCode: cancelled ? false : classification.retryWithoutCode,
        governedKnownFailure: Boolean(
          !cancelled && (matchingKnownFailure || ids.some((id) => knownFailureIds.includes(id))),
        ),
        knownFailure: matchingKnownFailure
          ? {
              testId: matchingKnownFailure.testId,
              issue: matchingKnownFailure.issue,
              owner: matchingKnownFailure.owner,
            }
          : null,
      });
    }
  }
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    commitSha: run.head_sha ?? run.headSha ?? null,
    workflow: run.name ?? run.workflow ?? null,
    runId: run.id ?? run.runId ?? null,
    profile,
    failures: entries,
  };
}

export function validateKnownFailures(entries, { now = new Date() } = {}) {
  const errors = [];
  for (const [index, entry] of (entries ?? []).entries()) {
    const prefix = `known-failure[${index}]`;
    for (const field of [
      'testId',
      'issue',
      'owner',
      'reason',
      'platforms',
      'createdAt',
      'expiresAt',
      'signature',
    ]) {
      if (!entry?.[field]) errors.push(`${prefix}: missing ${field}`);
    }
    if (entry?.expiresAt && Date.parse(entry.expiresAt) <= now.getTime())
      errors.push(`${prefix}: expired`);
    if (!Array.isArray(entry?.platforms) || entry.platforms.length === 0)
      errors.push(`${prefix}: platforms must be a non-empty array`);
  }
  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = args[args.indexOf('--input') + 1];
  const outputPath = args[args.indexOf('--output') + 1] ?? 'ci-failure-manifest.json';
  if (!inputPath) throw new Error('usage: failure-manifest.mjs --input <json> [--output <json>]');
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  writeFileSync(outputPath, `${JSON.stringify(buildFailureManifest(input), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`failure-manifest failed: ${error.message}`);
    process.exitCode = 1;
  }
}
