#!/usr/bin/env node

/**
 * Architecture health check — automated guard against structural regressions.
 *
 * Checks hub-file line counts, import counts, COMPLEXITY comments, and
 * complexity baselines against known ceilings. Failures block the pre-commit
 * hook so agents can't silently grow unstable modules, add hub-file imports,
 * bloat complex files, or modify over-ceiling functions without a plan.
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
const ARCH_BASELINE_PATH = `${ROOT}.architecture-baseline.json`;
const args = process.argv.slice(2);
const STAGED = args.includes('--staged');
const UPDATE = args.includes('--update');

// ── Complexity ceilings (must match AGENTS.md) ──────────────────────────────
const COMPLEXITY_CEILINGS = {
  'packages/editor/src/context.tsx': 847,
  'packages/editor/src/CanvasArea.tsx': 630,
  'packages/editor/src/Shell.tsx': 48, // import count, not complexity
  'packages/engine/src/replay.ts': 50,
  'packages/scene/src/document.ts': 50,
  'packages/scene/src/masks.ts': 50,
  'packages/codegen/src/ir-converter.ts': 110,
};

const OVER_CEILING_FILES = [
  'packages/editor/src/context.tsx', // 1289 EditorProvider
  'packages/editor/src/CanvasArea.tsx', // 964 CanvasArea
  'packages/editor/src/Menubar.tsx', // 275 (component ceiling 200)
  'packages/engine/src/replay.ts', // 650
  'packages/scene/src/document.ts', // 404
  'packages/scene/src/masks.ts', // 358
  'packages/codegen/src/ir-converter.ts', // 302
  'packages/import/src/svg.ts', // 239
  'packages/scene/src/boolean.ts', // 212
  'packages/scene/src/version.ts', // 212
  'packages/codegen/src/svg.ts', // 252
  'packages/codegen/src/html.ts', // 177
  'packages/platform/src/web.ts', // 155
  'packages/platform/src/memory.ts', // 177
  'packages/editor/src/EffectsSection.tsx', // 264
  'packages/editor/src/components/LayersPanel/LayersTree.tsx', // 220
];

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

/**
 * Rough cyclomatic complexity estimate: count conditionals.
 * Not exact but good enough for regression detection in pre-commit.
 */

const stagedFiles = STAGED ? getStagedFiles() : null;
const updatedBaseline = { ...baseline, hub_files: { ...baseline.hub_files } };

// ── Check 1: Hub file budgets ───────────────────────────────────────────────
for (const [filePath, thresholds] of Object.entries(baseline.hub_files)) {
  if (STAGED && !stagedFiles.has(filePath)) continue;

  const absPath = `${ROOT}${filePath}`;
  const lines = countLines(absPath);
  const imports = countImports(absPath);

  if (lines < 0) {
    if (STAGED && !existsSync(absPath)) continue; // file was deleted
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
    errors.push(`LINES: ${filePath} — ${lines} lines exceeds ceiling ${maxLines}`);
    ok = false;
  }
  if (imports > maxImports) {
    errors.push(`IMPORTS: ${filePath} — ${imports} imports exceeds ceiling ${maxImports}`);
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

// ── Check 2: COMPLEXITY comments on over-ceiling files ──────────────────────
if (!UPDATE) {
  const filesToCheck = STAGED
    ? OVER_CEILING_FILES.filter((f) => stagedFiles.has(f))
    : OVER_CEILING_FILES;

  for (const filePath of filesToCheck) {
    const absPath = `${ROOT}${filePath}`;
    if (!existsSync(absPath)) continue;

    const content = readFileSync(absPath, 'utf-8');
    const firstLine = content.split('\n')[0] || '';

    if (!firstLine.includes('COMPLEXITY:')) {
      errors.push(
        `COMPLEXITY: ${filePath} is over ceiling but has no // COMPLEXITY: comment on line 1. ` +
          `Add: // COMPLEXITY: <current_complexity> — <plan_to_reduce>`,
      );
    }
  }

  // ── Check 3: Staged over-ceiling files must not INCREASE complexity ────────
  if (STAGED && existsSync(ARCH_BASELINE_PATH)) {
    const stagedFilesList = getStagedFiles();

    for (const filePath of OVER_CEILING_FILES) {
      if (!stagedFilesList.has(filePath)) continue;

      const absPath = `${ROOT}${filePath}`;
      if (!existsSync(absPath)) continue;

      // Rough check: count new branch additions in the diff
      const diff = execSync(`git diff --cached -- "${filePath}"`, { encoding: 'utf-8' });
      const addedLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
      const addedBranches = addedLines.filter(
        (l) => /\b(if|else if|catch|case )\b/.test(l) || /\?[^:]*:/.test(l),
      ).length;

      if (addedBranches > 10) {
        errors.push(
          `COMPLEXITY: ${filePath} is over ceiling — ${addedBranches} new branch constructs added. ` +
            `Extract new functionality to a new module instead.`,
        );
      }
    }
  }
}

// ── Check 4: Verify 70% rule for files approaching ceiling ─────────────────
if (!UPDATE && existsSync(ARCH_BASELINE_PATH)) {
  const archBaseline = JSON.parse(readFileSync(ARCH_BASELINE_PATH, 'utf-8'));
  const complexityData = archBaseline.complexity;
  if (complexityData) {
    for (const [filePath, data] of Object.entries(complexityData)) {
      if (STAGED && !stagedFiles.has(filePath)) continue;
      if (data.max_complexity && COMPLEXITY_CEILINGS[filePath]) {
        const ceiling = COMPLEXITY_CEILINGS[filePath];
        const ratio = data.max_complexity / ceiling;
        if (ratio >= 0.7 && ratio < 0.8) {
          console.log(
            `  ⚠ ${filePath}: ${data.max_complexity} / ${ceiling} (${Math.round(ratio * 100)}% of ceiling)`,
          );
        }
      }
    }
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
  console.error(
    '\nEither: 1) revert the increase, 2) add COMPLEXITY comment, or 3) update baseline with --update\n',
  );
  process.exit(1);
}

console.log('\naudit-health: ✓ health check passed');
