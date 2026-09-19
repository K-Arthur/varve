#!/usr/bin/env node
/**
 * Interface spacing discipline audit.
 *
 * Varve has one canonical spacing system: the `--space-*` ladder and its
 * semantic roles, generated from `packages/ui/src/tokens/spacing.ts`. The
 * system is documented in `docs/architecture/spacing-system.md`.
 *
 * This gate exists because a raw length in a spacing property is invisible to
 * every other check: Biome, stylelint, `audit:tokens`, and `audit:radius` all
 * pass, the build passes, and the only symptom is that two panels that should
 * share a rhythm slowly stop matching. That is exactly how the editor's legacy
 * dialog/panel blocks accumulated ~500 one-off values while the rest of the
 * application used the ladder.
 *
 * What is blocked: a raw length (px/rem/pt) in a spacing property.
 * What is allowed without annotation:
 *   - a `var(--...)` reference (the token system itself),
 *   - keywords (`0`, `auto`, `inherit`, `unset`, `revert`, `normal`),
 *   - percentages, `em`/`ch`/`ex`, `env()` (safe areas) — these are relative
 *     to the element's own type or to a platform inset, not to the ladder,
 *   - `calc()`/`min()`/`max()`/`clamp()` that reference a `var()`,
 *   - values covered by the recorded baseline (existing debt; the ratchet
 *     only turns one way — inflating a baseline bucket fails).
 *
 * Physical `top`/`right`/`bottom`/`left` are deliberately out of scope:
 * overlay and canvas geometry is functional geometry, not rhythm.
 *
 * Exceptions: annotate the declaration (or the line above it) with
 * `/* audit-spacing: allow <reason> *\/` (CSS) or
 * `// audit-spacing: allow <reason>` (TSX).
 *
 * Usage:
 *   node scripts/quality/audit-spacing.mjs             # check (fail on drift)
 *   node scripts/quality/audit-spacing.mjs --report     # inventory only
 *   node scripts/quality/audit-spacing.mjs --update     # rewrite the baseline
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, '.spacing-baseline.json');
const ALLOW_MARKER = 'audit-spacing: allow';

const SOURCE_ROOTS = [
  'packages/ui/src',
  'packages/editor/src',
  'packages/home/src',
  'packages/help/src',
];

/**
 * Stylesheet files are interface styles by definition. Inline style objects
 * live in `.tsx`; `.ts` is excluded because spacing-shaped numbers in plain
 * modules are document geometry, layout algorithms, or pointer thresholds
 * (`scene/`, `layout/`, `tools/`) that must never consume interface tokens.
 * Stories and tests are excluded: they are fixtures, not shipped chrome.
 */
function isScanned(file) {
  if (file.endsWith('.css')) return true;
  if (!file.endsWith('.tsx')) return false;
  return !/(\.stories\.tsx|\.test\.tsx|__tests__|__benchmarks__)/.test(file);
}

const SPACING_LONGHANDS = [
  'padding',
  'padding-inline',
  'padding-block',
  'padding-inline-start',
  'padding-inline-end',
  'padding-block-start',
  'padding-block-end',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-inline',
  'margin-block',
  'margin-inline-start',
  'margin-inline-end',
  'margin-block-start',
  'margin-block-end',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
  'inset',
  'inset-inline',
  'inset-block',
  'inset-inline-start',
  'inset-inline-end',
  'inset-block-start',
  'inset-block-end',
  'border-spacing',
  'text-indent',
  'scroll-margin',
  'scroll-padding',
];

function camelCase(property) {
  return property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

const CSS_PROPERTY_RE = new RegExp(
  `(?:^|[;{\\s])(${SPACING_LONGHANDS.join('|')})\\s*:\\s*([^;}]+)`,
  'g',
);
const TSX_PROPERTY_RE = new RegExp(
  `\\b(${SPACING_LONGHANDS.map(camelCase).join('|')})\\s*:\\s*(['"\`]?)([^,;}\\n]*)\\2`,
  'g',
);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['node_modules', 'dist', 'dist-pages', '__snapshots__', 'target'].includes(entry)) {
        continue;
      }
      walk(full, out);
    } else if (isScanned(full)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * A value is acceptable when it is expressed through the token system, is a
 * keyword, or is relative to the element's own content/type rather than to the
 * interface rhythm.
 */
function isAllowedValue(value) {
  const v = value.trim().toLowerCase();
  if (v.length === 0) return true;
  if (
    /^(0|auto|inherit|initial|unset|revert|normal|none|max-content|min-content|fit-content)$/.test(
      v,
    )
  ) {
    return true;
  }
  if (v.includes('var(--')) return true;
  /**
   * `margin: -1px` is never rhythm. It is one of exactly two recipes:
   * the visually-hidden pattern (`width/height: 1px` + clip, used for live
   * regions and headings) or collapsing a doubled 1px border between
   * adjacent controls. Both are functional geometry; a negative margin used
   * to *patch* layout is any other value and stays blocked.
   */
  if (v === '-1px') return true;
  if (/(%|\bem\b|\bch\b|\bex\b|\brem\)|env\(|fr\b)/.test(v)) {
    // rem is allowed only inside a relative function, never bare.
    if (!/(^|[\s(])\d*\.?\d+rem(\s|$)/.test(v)) return true;
  }
  if (/\b(calc|min|max|clamp)\(/.test(v) && v.includes('var(--')) return true;
  return false;
}

const mode = process.argv.includes('--update')
  ? 'update'
  : process.argv.includes('--report')
    ? 'report'
    : 'check';

const buckets = new Map();
const annotated = [];
const files = SOURCE_ROOTS.flatMap((root) => walk(join(ROOT, root)));

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const stripped = stripComments(raw);
  const isTsx = file.endsWith('.tsx');
  const re = isTsx ? TSX_PROPERTY_RE : CSS_PROPERTY_RE;
  const rel = relative(ROOT, file);
  const lines = raw.split('\n');

  for (const match of stripped.matchAll(re)) {
    const property = match[1];
    // For TSX the value is capture group 3 (quotes in group 2).
    const value = (isTsx ? match[3] : (match[2] ?? '')).trim();
    if (isAllowedValue(value)) continue;
    const line = lineAt(stripped, match.index ?? 0);
    const context = `${lines[line - 1] ?? ''} ${lines[line - 2] ?? ''}`;
    if (context.includes(ALLOW_MARKER)) {
      annotated.push(`${rel}:${line} ${property}: ${value}`);
      continue;
    }
    const key = `${rel}|${property}|${value}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { version: 1, buckets: {} };

if (mode === 'update') {
  const sorted = Object.fromEntries([...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ version: 1, note: 'Interface spacing debt. This file may only shrink: migrate a value to --space-* and regenerate with --update.', buckets: sorted }, null, 2)}\n`,
  );
  console.log(
    `audit-spacing — wrote baseline: ${Object.keys(sorted).length} raw-value bucket(s), ${[...buckets.values()].reduce((a, b) => a + b, 0)} declaration(s).`,
  );
  process.exit(0);
}

const violations = [];
for (const [key, count] of buckets) {
  const allowed = baseline.buckets[key];
  if (allowed === undefined) {
    violations.push({ key, count, allowed: 0, kind: 'new' });
  } else if (count > allowed) {
    violations.push({ key, count, allowed, kind: 'inflated' });
  }
}

const totalDeclarations = [...buckets.values()].reduce((a, b) => a + b, 0);
const totalBuckets = buckets.size;

if (mode === 'report' || violations.length === 0) {
  console.log(
    `audit-spacing — ${totalDeclarations} raw declaration(s) in ${totalBuckets} bucket(s) across ${files.length} file(s).`,
  );
  if (annotated.length > 0) {
    for (const item of annotated) console.log(`  allow  ${item}`);
  }
  if (mode === 'report') {
    const byFile = new Map();
    for (const [key, count] of buckets) {
      const file = key.split('|')[0];
      byFile.set(file, (byFile.get(file) ?? 0) + count);
    }
    console.log('\nRaw interface spacing by file:');
    for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(String(count).padStart(5), file);
    }
  }
  if (violations.length === 0) process.exit(0);
}

console.error('audit-spacing — FAILED');
for (const violation of violations) {
  const [file, property, value] = violation.key.split('|');
  const detail =
    violation.kind === 'new'
      ? 'new raw value (no baseline bucket)'
      : `baseline allows ${violation.allowed}, found ${violation.count}`;
  console.error(`  ERROR ${file} — ${property}: ${value} — ${detail}`);
}
console.error(
  `\n${violations.length} drift(s). Use a --space-* token, or annotate with "${ALLOW_MARKER} <reason>".`,
);
console.error(
  'Intentional one-off geometry is recorded in .spacing-baseline.json; it may only shrink.',
);
process.exit(1);
