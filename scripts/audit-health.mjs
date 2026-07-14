#!/usr/bin/env node

/**
 * Architecture health check — automated guard against structural regressions.
 *
 * Checks hub-file line counts and import counts against .health-baseline.json.
 * Failures block the pre-commit hook so agents can't silently grow unstable
 * modules, add hub-file imports, or bloat complex files.
 *
 * Usage:
 *   node scripts/audit-health.mjs              # full check, exits 1 on failure
 *   node scripts/audit-health.mjs --staged     # only check staged files
 *   node scripts/audit-health.mjs --update     # update baseline to current values
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const BASELINE_PATH = `${ROOT}.health-baseline.json`;
const args = process.argv.slice(2);
const STAGED = args.includes('--staged');
const UPDATE = args.includes('--update');

if (!existsSync(BASELINE_PATH)) {
  console.error('audit-health: no .health-baseline.json found. Run with --update to create one.');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
const errors = [];

function getStagedFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf-8' });
  return new Set(out.trim().split('\n').filter(Boolean));
}

function countImports(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const matches = content.match(/^import\s/gm);
    return matches ? matches.length : 0;
  } catch {
    return -1;
  }
}

function countLines(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return -1;
  }
}

const stagedFiles = STAGED ? getStagedFiles() : null;
const updatedBaseline = { ...baseline, hub_files: { ...baseline.hub_files } };

for (const [filePath, thresholds] of Object.entries(baseline.hub_files)) {
  if (STAGED && !stagedFiles.has(filePath)) continue;

  const absPath = `${ROOT}${filePath}`;
  const lines = countLines(absPath);
  const imports = countImports(absPath);

  if (lines < 0) {
    errors.push(`MISSING: ${filePath} — file not found`);
    continue;
  }

  if (UPDATE) {
    const lineBuffer = Math.max(100, Math.round(thresholds.lines * 0.1));
    const importBuffer = 3;
    updatedBaseline.hub_files[filePath] = {
      lines,
      imports,
      max_lines: lines + lineBuffer,
      max_imports: imports + importBuffer,
    };
    console.log(`  ✓ ${filePath}: ${lines} lines, ${imports} imports (baseline updated)`);
    continue;
  }

  const maxLines = thresholds.max_lines;
  const maxImports = thresholds.max_imports;
  let ok = true;

  if (lines > maxLines) {
    errors.push(
      `LINES: ${filePath} — ${lines} lines exceeds ceiling ${maxLines} (was ${thresholds.lines})`,
    );
    ok = false;
  }
  if (imports > maxImports) {
    errors.push(
      `IMPORTS: ${filePath} — ${imports} imports exceeds ceiling ${maxImports} (was ${thresholds.imports})`,
    );
    ok = false;
  }
  if (ok) {
    const lineDelta = lines - thresholds.lines;
    const impDelta = imports - thresholds.imports;
    const lineSig = lineDelta >= 0 ? '+' : '';
    const impSig = impDelta >= 0 ? '+' : '';
    console.log(
      `  ✓ ${filePath}: ${lines} lines (${lineSig}${lineDelta}), ${imports} imports (${impSig}${impDelta})`,
    );
  }
}

if (UPDATE) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(updatedBaseline, null, 2)}\n`);
  console.log('\naudit-health: baseline updated at .health-baseline.json');
  process.exit(0);
}

if (errors.length > 0) {
  console.error('\naudit-health: ❌ HEALTH CHECK FAILED');
  for (const err of errors) console.error(`  ${err}`);
  console.error('\nEither: 1) revert the increase, or 2) update baseline with --update\n');
  process.exit(1);
}

console.log('\naudit-health: ✓ health check passed');
