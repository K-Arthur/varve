#!/usr/bin/env node
/**
 * Interface sizing discipline audit.
 *
 * Varve has one canonical interface sizing system (see
 * `docs/architecture/interface-sizing-system.md`):
 *
 *   - typography: semantic `--type-*` roles resolved from the stable rem
 *     primitives in `packages/ui/src/tokens/typography.ts`;
 *   - control geometry: the five-step ladder in
 *     `packages/ui/src/tokens/sizing.ts` (24/28/32/40/48);
 *   - native form controls: one reset in `apps/desktop/src/global.css` that
 *     assigns the interface-control role instead of the browser's
 *     13.3333px Arial default.
 *
 * This gate exists because each of those three contracts can be violated
 * without any other check noticing. Biome, stylelint, `audit:spacing`,
 * `audit:tokens`, and the build all pass while:
 *
 *   - a component hardcodes `font-size: 13px` and drifts off the type ramp
 *     (the audit that motivated this gate found nine near-identical sizes,
 *     four of them within 1.5px of each other);
 *   - a control sizes itself with `height: var(--space-6)` — a *spacing*
 *     token, which resolved to 22.4px at a narrow window and 29.6px at 1920,
 *     so the status bar's targets shrank below the WCAG 2.5.8 floor;
 *   - a close affordance invents its own geometry, which produced eight
 *     different close-button sizes across three visual treatments.
 *
 * Rules:
 *   1. `font-size` must resolve through the token system (`var(--type-*)`,
 *      `var(--font-size-*)`), be a keyword, or be relative to the element's
 *      own type (`em`, `%`). Raw px/rem is blocked, with a one-way ratchet
 *      baseline for existing debt.
 *   2. An interactive control must not take its block size from the spacing
 *      ladder. `height|min-height|block-size|min-block-size: var(--space-N)`
 *      is flagged when the block looks interactive (`cursor: pointer`, or a
 *      control-shaped selector). Ratcheted.
 *   3. Close affordances must not declare their own box geometry; they use
 *      the shared `.varve-close` contract or a component-tier token.
 *      Ratcheted.
 *   4. The native form-control reset must exist. Hard failure, no ratchet:
 *      without it every control that forgets its own font declaration
 *      silently renders the UA default face and size.
 *
 * Exceptions: annotate the declaration (or the line above) with
 * `/* audit-interface-sizing: allow <reason> *\/`.
 *
 * Usage:
 *   node scripts/quality/audit-interface-sizing.mjs            # check
 *   node scripts/quality/audit-interface-sizing.mjs --report   # inventory
 *   node scripts/quality/audit-interface-sizing.mjs --update   # rewrite baseline
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, '.interface-sizing-baseline.json');
const ALLOW_MARKER = 'audit-interface-sizing: allow';
const NATIVE_RESET_PATH = 'apps/desktop/src/global.css';

const SOURCE_ROOTS = [
  'packages/ui/src',
  'packages/editor/src',
  'packages/home/src',
  'packages/help/src',
  'apps/desktop/src',
];

/** Canvas overlay/rendering code owns functional geometry, not chrome. */
const EXCLUDED_PATH_RE =
  /(packages\/editor\/src\/canvas\/|packages\/engine\/|packages\/compositor\/|__snapshots__|\.stories\.|\.test\.|__tests__)/;

const SIZE_PROPERTIES = ['height', 'min-height', 'block-size', 'min-block-size', 'max-height'];
const CLOSE_SELECTOR_RE = /(?:^|[.\s])[\w-]*(?:close|dismiss)[\w-]*(?:__|\b)/i;
const CONTROL_SELECTOR_RE =
  /\b(btn|button|input|select|tab|toggle|close|chip|badge|field|menu|row|toolbar|control|stepper|switch|checkbox|radio)\b/i;

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
      if (['node_modules', 'dist', 'dist-pages', 'target'].includes(entry)) continue;
      walk(full, out);
    } else if (full.endsWith('.css')) {
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

/** Acceptable font-size values: token-resolved, keyword, or element-relative. */
function isAllowedFontSize(value) {
  const v = value.trim().toLowerCase();
  if (v.length === 0) return true;
  if (v.includes('var(--')) return true;
  if (/^(inherit|initial|unset|revert|normal|smaller|larger)$/.test(v)) return true;
  // `em`/`%` are relative to the element's own type, which is the type ramp's
  // job to set — not a raw interface size.
  if (/^\d*\.?\d+(em|%)$/.test(v)) return true;
  if (/\b(calc|min|max|clamp)\(/.test(v) && v.includes('var(--')) return true;
  return false;
}

/**
 * A spacing token in a block-size property is only suspicious when the block
 * is a control. Decorative dots, skeleton lines, and separators legitimately
 * take their size from the spacing ladder.
 */
function blockLooksInteractive(block, selector) {
  if (/cursor\s*:\s*(pointer|text)/.test(block)) return true;
  return CONTROL_SELECTOR_RE.test(selector);
}

const mode = process.argv.includes('--update')
  ? 'update'
  : process.argv.includes('--report')
    ? 'report'
    : 'check';

const files = SOURCE_ROOTS.flatMap((root) => walk(join(ROOT, root))).filter(
  (file) => !EXCLUDED_PATH_RE.test(relative(ROOT, file)),
);

const buckets = new Map();
const annotated = [];
const hardFailures = [];

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const stripped = stripComments(raw);
  const rel = relative(ROOT, file);
  const lines = raw.split('\n');

  // Rule 1 — raw interface font sizes.
  for (const match of stripped.matchAll(/(?:^|[;{\s])font-size\s*:\s*([^;}]+)/g)) {
    const value = (match[1] ?? '').trim();
    if (isAllowedFontSize(value)) continue;
    const line = lineAt(stripped, match.index ?? 0);
    const context = `${lines[line - 1] ?? ''} ${lines[line - 2] ?? ''}`;
    if (context.includes(ALLOW_MARKER)) {
      annotated.push(`${rel}:${line} font-size: ${value}`);
      continue;
    }
    const key = `${rel}|font-size|${value}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  // Rules 2 and 3 — block-level geometry.
  for (const block of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (block[1] ?? '').trim();
    const body = block[2] ?? '';
    if (!selector || selector.startsWith('@')) continue;
    const interactive = blockLooksInteractive(body, selector);
    const closeAffordance = CLOSE_SELECTOR_RE.test(selector);

    for (const prop of SIZE_PROPERTIES) {
      const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'g');
      for (const match of body.matchAll(re)) {
        const value = (match[1] ?? '').trim();
        const offset = (block.index ?? 0) + block[0].indexOf(body) + (match.index ?? 0);
        const line = lineAt(stripped, offset);
        const context = `${lines[line - 1] ?? ''} ${lines[line - 2] ?? ''}`;
        const isSpacingToken = /var\(--space-[4-9]\)/.test(value);
        const isRawBox = /^\d+(\.\d+)?(px|rem)$/.test(value);

        if (isSpacingToken && interactive) {
          if (context.includes(ALLOW_MARKER)) {
            annotated.push(`${rel}:${line} ${prop}: ${value} (spacing token on a control)`);
            continue;
          }
          const key = `${rel}|spacing-token-control-size|${prop}`;
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
        if (isRawBox && closeAffordance) {
          if (context.includes(ALLOW_MARKER)) {
            annotated.push(`${rel}:${line} ${prop}: ${value} (close geometry)`);
            continue;
          }
          const key = `${rel}|close-affordance-box|${prop}`;
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
      }
    }
  }
}

// Rule 4 — the native form-control reset. Hard failure: this is the single
// contract that keeps the UA's 13.3333px Arial out of every control.
{
  const resetPath = join(ROOT, NATIVE_RESET_PATH);
  const resetSource = existsSync(resetPath) ? readFileSync(resetPath, 'utf8') : '';
  const normalised = resetSource.replace(/\s+/g, ' ');
  const declaresRole =
    /button,\s*input,\s*optgroup,\s*select,\s*textarea\s*\{/.test(normalised) &&
    normalised.includes('font-size: var(--type-interface-control-size)');
  if (!declaresRole) {
    hardFailures.push(
      `${NATIVE_RESET_PATH}: missing the native form-control reset that assigns the interface-control role ` +
        '(button, input, optgroup, select, textarea { font-family/font-size/font-weight/line-height }). ' +
        'Without it every control falls back to the UA 13.3333px default face.',
    );
  }
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { version: 1, buckets: {} };

if (mode === 'update') {
  const sorted = Object.fromEntries([...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        version: 1,
        note: 'Interface sizing debt. This file may only shrink: migrate the value to a --type-*/--font-size-* role or a --component-* tier and regenerate with --update.',
        buckets: sorted,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `audit-interface-sizing — wrote baseline: ${Object.keys(sorted).length} bucket(s), ${[...buckets.values()].reduce((a, b) => a + b, 0)} declaration(s).`,
  );
  process.exit(0);
}

const violations = [];
for (const [key, count] of buckets) {
  const allowed = baseline.buckets[key];
  if (allowed === undefined) violations.push({ key, count, allowed: 0, kind: 'new' });
  else if (count > allowed) violations.push({ key, count, allowed, kind: 'inflated' });
}

const totalDeclarations = [...buckets.values()].reduce((a, b) => a + b, 0);

if (mode === 'report' || (violations.length === 0 && hardFailures.length === 0)) {
  console.log(
    `audit-interface-sizing — ${totalDeclarations} ratcheted declaration(s) in ${buckets.size} bucket(s) across ${files.length} file(s); native-control reset present.`,
  );
  for (const item of annotated) console.log(`  allow  ${item}`);
  if (mode === 'report') {
    for (const [key, count] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${String(count).padStart(4)}  ${key}`);
    }
  }
  process.exit(0);
}

console.error('audit-interface-sizing — FAILED\n');
for (const failure of hardFailures) console.error(`  [contract] ${failure}\n`);
for (const violation of violations) {
  const [file, rule, value] = violation.key.split('|');
  console.error(
    `  [${violation.kind}] ${file}: ${rule} ${value} (found ${violation.count}, allowed ${violation.allowed})`,
  );
}
console.error(
  `\n${violations.length} ratchet violation(s). Migrate to the canonical role/tier, or annotate an intentional exception with "${ALLOW_MARKER} <reason>".`,
);
console.error('Regenerate the baseline only after the remaining values are audited: --update');
process.exit(1);
