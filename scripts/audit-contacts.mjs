#!/usr/bin/env node
/**
 * Varve public-contact audit.
 *
 * Varve's public identity is seven `@varve.studio` role addresses. How mail
 * reaching that domain is routed afterwards is administrative configuration:
 * it belongs in the operator's own records, not in a public repository, a
 * built website, or an application binary.
 *
 * That property is easy to state and easy to break by accident — a debug
 * line, a copied support template, a doc example, or a well-meaning "these
 * forward to ..." comment. This audit fails the build instead.
 *
 * Four checks, each exit-failing:
 *   1. MAILBOX  — no consumer-mailbox address (gmail/outlook/yahoo/proton/...)
 *                 appears anywhere in the scanned surfaces.
 *   2. NAMING   — no `@strata.*` contact address survives in an active
 *                 surface; the product was renamed 2026-08-04.
 *   3. DOMAIN   — every Varve-looking role address uses exactly
 *                 `@varve.studio`, catching typos like `@varve.studio.com`
 *                 or `@varve.design` that would silently bounce.
 *   4. ROUTING  — no file claims a specific forwarding destination.
 *
 * Scans tracked source, docs, and (when present) the built website output,
 * so a leak that only appears after bundling is still caught.
 *
 * Run: `pnpm audit:contacts`. Also runs in `pnpm audit:artifacts`' sibling
 * position in CI and in the pre-commit staged-content scan.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('../', import.meta.url).pathname);

/** Built output is scanned too — a leak can appear only after bundling. */
const EXTRA_DIRS = ['apps/website/dist', 'apps/website/dist-pages', 'apps/desktop/dist'];

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  '.worktrees',
  'coverage',
  'test-results',
  'playwright-report',
  '.astro',
  '.vite',
]);

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.astro',
  '.svelte',
  '.vue',
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.toml',
  '.rs',
  '.html',
  '.css',
  '.svg',
  '.xml',
  '.desktop',
  '.plist',
  '.wxs',
  '.nsi',
  '.sh',
  '.ps1',
]);

/**
 * Historical subtrees, matching `audit-docs.mjs`'s existing policy: the
 * product was renamed 2026-08-04, and dated audits, plans, research, ADRs,
 * session history, licensing records, and the git-provenance report are
 * allowed to record the identities that were actually used at the time.
 *
 * Rewriting them would falsify the record. What matters is that no ACTIVE
 * surface — website, application, README, SECURITY.md, issue templates,
 * packaging metadata — carries a retired-brand or private address, and those
 * are all outside these paths.
 *
 * Note this exemption applies to NAMING only; a consumer mailbox or a
 * forwarding disclosure is a privacy leak wherever it appears, including in
 * a historical document.
 */
const HISTORICAL_NAMING_PREFIXES = [
  'docs/adr/',
  'docs/audits/',
  'docs/implementation/',
  'docs/implementation-memory/',
  'docs/perf/',
  'docs/plans/',
  'docs/research/',
  'docs/superpowers/',
  'docs/quality/',
  'docs/licensing/',
];

const HISTORICAL_NAMING_EXACT = [
  'docs/agents/session-history.md',
  // Records the historical "Strata Founder" / "Cascade Agent" git identities
  // that appear in real commit metadata and in .mailmap.
  'docs/development/provenance.md',
  'docs/privacy/crash-audit.md',
  'docs/CLA-DECISION-RECORD.md',
  'docs/CLA-MAINTAINER.md',
  'docs/ICLA.md',
  'docs/CCLA.md',
];

function isHistoricalForNaming(relPath) {
  if (HISTORICAL_NAMING_EXACT.includes(relPath)) return true;
  return HISTORICAL_NAMING_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

/**
 * Files allowed to mention a pattern, with the reason.
 *
 * Kept deliberately short. Each entry is a decision, not a convenience:
 * an allowlist that grows without justification defeats the audit.
 */
const ALLOW = [
  {
    // This file necessarily contains the patterns it searches for.
    path: 'scripts/audit-contacts.mjs',
    why: 'the audit itself',
  },
  {
    // Plants each violation class deliberately to prove the audit fails on
    // it. The synthetic addresses here are fixtures, not contact identities.
    path: 'scripts/audit-contacts.test.mjs',
    why: 'the audit test fixtures (synthetic addresses by design)',
  },
  {
    // Asserts the leak cannot happen; must name what it forbids.
    path: 'packages/shared/src/contact.test.ts',
    why: 'the regression test for this property',
  },
  {
    // Historical naming consultation: records that the social handle
    // "@varveapp" was available. A handle, not an address.
    path: 'docs/plans/archived/rename-strata-consultation.md',
    why: 'historical naming record (social handle, not an email)',
  },
];

/**
 * Two performance rules shape every pattern here, both learned the hard way
 * on this repository (a naive version took 74s and was useless in
 * pre-commit):
 *
 *  1. Never start a pattern with the local part (`[A-Za-z0-9._%+-]{1,64}@`).
 *     The engine then attempts a match at every character of every file;
 *     across ~4500 files that alone cost ~9s. Start at the literal `@` and
 *     recover the local part with a lookbehind, so the scan is driven by the
 *     rare character instead of the common one.
 *  2. Keep TLDs as `[A-Za-z]{2,24}`, never a letters-and-dots class like
 *     `[A-Za-z.]{2,}`, which backtracks badly through the long alphanumeric
 *     runs in lockfiles and minified bundles.
 */
const LOCAL_PART = '(?<=[A-Za-z0-9._%+-])';
const TLD = '[A-Za-z]{2,24}(?:\\.[A-Za-z]{2,24})?';

/** Consumer mailbox providers: never a public Varve identity. */
const CONSUMER_MAILBOX = new RegExp(
  `${LOCAL_PART}@(?:gmail|googlemail|outlook|hotmail|yahoo|ymail|proton|protonmail|icloud|aol|gmx|yandex|zoho|fastmail)\\.${TLD}`,
  'g',
);

/** A retired-brand contact address in an active surface. */
const STRATA_ADDRESS = new RegExp(`${LOCAL_PART}@strata\\.${TLD}`, 'g');

/**
 * A Varve-looking address whose domain is not exactly varve.studio.
 * `varve.studio.example` and `varve.design` both bounce silently.
 */
const WRONG_VARVE_DOMAIN = new RegExp(
  `(?:hello|support|feedback|security|privacy|press|partnerships|contact|info|admin)@(?!varve\\.studio\\b)varve\\.${TLD}`,
  'g',
);

/** Prose that documents a concrete forwarding destination. */
const ROUTING_DISCLOSURE =
  /forward(?:s|ed|ing)?\s{1,4}(?:to|→)\s{0,4}:?\s{0,4}[A-Za-z0-9._%+-]{1,64}@(?!varve\.studio)[A-Za-z0-9-]{1,63}\.[A-Za-z]{2,24}/gi;

const CHECKS = [
  {
    id: 'MAILBOX',
    re: CONSUMER_MAILBOX,
    message:
      'consumer mailbox address in a public surface — publish an @varve.studio role address instead',
  },
  {
    id: 'NAMING',
    re: STRATA_ADDRESS,
    message: 'retired-brand (@strata.*) contact address in an active surface',
    historicalExempt: true,
  },
  {
    id: 'DOMAIN',
    re: WRONG_VARVE_DOMAIN,
    message: 'role address on a domain other than varve.studio — mail to it will not be delivered',
  },
  {
    id: 'ROUTING',
    re: ROUTING_DISCLOSURE,
    message:
      'documents a specific forwarding destination — say "configured forwarding mailbox" instead',
  },
];

function allowedFor(relPath) {
  return ALLOW.find((entry) => entry.path === relPath);
}

/** Tracked files, so untracked scratch work never fails someone's commit. */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

async function walk(dir, acc) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, acc);
    } else if (entry.isFile()) {
      acc.push(relative(ROOT, full));
    }
  }
  return acc;
}

function isScannable(relPath) {
  const dot = relPath.lastIndexOf('.');
  if (dot === -1) return false;
  if (!TEXT_EXT.has(relPath.slice(dot).toLowerCase())) return false;
  try {
    // Skip anything large enough to be a bundled asset rather than source.
    return statSync(join(ROOT, relPath)).size <= 8 * 1024 * 1024;
  } catch {
    return false;
  }
}

function scan(relPath, violations) {
  let text;
  try {
    text = readFileSync(join(ROOT, relPath), 'utf8');
  } catch {
    return;
  }
  if (allowedFor(relPath)) return;
  const historical = isHistoricalForNaming(relPath);

  for (const check of CHECKS) {
    if (check.historicalExempt && historical) continue;
    check.re.lastIndex = 0;
    for (const match of text.matchAll(check.re)) {
      const line = text.slice(0, match.index).split('\n').length;
      violations.push({
        check: check.id,
        file: relPath,
        line,
        found: match[0],
        message: check.message,
      });
    }
  }
}

async function main() {
  const files = new Set(trackedFiles().filter(isScannable));

  for (const dir of EXTRA_DIRS) {
    if (!existsSync(join(ROOT, dir))) continue;
    for (const found of await walk(join(ROOT, dir), [])) {
      if (isScannable(found)) files.add(found);
    }
  }

  const violations = [];
  for (const file of files) scan(file, violations);

  if (violations.length > 0) {
    console.error('audit:contacts — FAILED\n');
    for (const v of violations) {
      console.error(`  [${v.check}] ${v.file}:${v.line}`);
      console.error(`      found: ${v.found}`);
      console.error(`      ${v.message}\n`);
    }
    console.error(
      `${violations.length} violation(s). Varve's public contact identity is` +
        ' seven @varve.studio role addresses; routing stays private.\n' +
        'See docs/development/email-routing.md.',
    );
    process.exit(1);
  }

  console.log(`audit:contacts — clean (scanned ${files.size} files).`);
}

main().catch((error) => {
  console.error(`audit:contacts — error: ${error.message}`);
  process.exit(1);
});
