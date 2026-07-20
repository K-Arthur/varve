#!/usr/bin/env node
/**
 * Typecheck regression gate.
 *
 * Runs workspace typecheck, captures the set of failing source files,
 * compares against a baseline, and exits non-zero if new failures appeared
 * or if the total error count grew beyond the baselined ceiling.
 *
 * Baseline file: .typecheck-baseline.json
 * Update:        node scripts/audit-typecheck-regression.mjs --update
 *
 * Usage in CI / pre-commit:
 *   node scripts/audit-typecheck-regression.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BASELINE_PATH = resolve(ROOT, '.typecheck-baseline.json');
const UPDATE = process.argv.includes('--update');

const SEPARATOR = '---ERROR_SEPARATOR---';

function collectErrors() {
  let raw;
  try {
    raw = execSync('pnpm -r --filter "./packages/*" typecheck', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    raw = e.stdout ?? '';
  }
  raw = raw.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    '',
  );

  const errors = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^(.+?\.(?:ts|tsx))\(\d+,\d+\):\s*error TS\d+:/);
    if (m) errors.push(m[1]);
  }
  return { errors: [...new Set(errors)], raw };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
}

const result = collectErrors();
const { errors } = result;

if (UPDATE) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ errors, updatedAt: new Date().toISOString() }, null, 2),
  );
  console.log(`Baseline updated: ${errors.length} failing files`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.log('No baseline found. Run with --update to create one.');
  process.exit(1);
}

const newErrors = errors.filter((f) => !baseline.errors.includes(f));
const fixedErrors = baseline.errors.filter((f) => !errors.includes(f));

let failed = false;

if (newErrors.length > 0) {
  console.error(`\n✖ ${newErrors.length} NEW typecheck error(s) detected (not in baseline):`);
  for (const f of newErrors) console.error(`   ${f}`);
  failed = true;
}

if (errors.length > baseline.errors.length) {
  console.error(`\n✖ Error count grew: ${baseline.errors.length} → ${errors.length} failing files`);
  failed = true;
}

if (fixedErrors.length > 0) {
  console.log(`\n✓ ${fixedErrors.length} previously failing file(s) now pass:`);
  for (const f of fixedErrors) console.log(`   ${f}`);
}

if (!failed) {
  console.log(
    `\n✓ Typecheck regression gate passed (${errors.length} files, baseline ${baseline.errors.length})`,
  );
  process.exit(0);
} else {
  console.error(
    '\n  Run `node scripts/audit-typecheck-regression.mjs --update` after fixing intentional changes.',
  );
  process.exit(1);
}
