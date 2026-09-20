#!/usr/bin/env node
/**
 * Inspector CSS discipline audit.
 *
 * The Inspector panel owns ~7k lines of hand-maintained CSS across one large
 * stylesheet and twenty satellite files. Two failure classes are invisible to
 * every existing gate (Biome, stylelint, audit:tokens, audit:radius):
 *
 *   1. `var(--x)` references to custom properties that no stylesheet or
 *      runtime style ever defines. The declaration silently falls back
 *      (or to nothing), so a theme bug ships looking like a design choice.
 *   2. raw `letter-spacing` values and raw durations in transition/animation
 *      shorthands, which bypass the token tier and the reduced-motion
 *      override.
 *
 * Errors block; raw colour literals and raw geometry are reported as
 * warnings with counts (debt inventory, not a gate) until their migration
 * slices land.
 *
 * Exceptions: append `/* audit-inspector-css: allow <reason> *\/` to the
 * declaration or the offending line.
 *
 * Evidence: docs/audits/inspector-design-tab-audit-2026-09-19.md (AUD-004,
 * AUD-005, AUD-006); docs/design-system/inspector-spec.md §9.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const INSPECTOR_ROOT = join(ROOT, 'packages/editor/src/components/Inspector');
const DEFINITION_ROOTS = [
  'packages/ui/src',
  'packages/editor/src',
  'apps/desktop/src',
  'packages/home/src',
];
const ALLOW_MARKER = 'audit-inspector-css: allow';

function walk(dir, predicate, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__snapshots__') continue;
      walk(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

const isCss = (file) => file.endsWith('.css');
const isScript = (file) => file.endsWith('.ts') || file.endsWith('.tsx');

/** Every custom property defined by any stylesheet or runtime style writer. */
function collectDefinedProperties() {
  const defined = new Set();
  for (const root of DEFINITION_ROOTS) {
    for (const file of walk(join(ROOT, root), (f) => isCss(f) || isScript(f))) {
      const text = readFileSync(file, 'utf8');
      if (file.endsWith('.css')) {
        for (const match of text.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) {
          defined.add(match[1]);
        }
      } else {
        for (const match of text.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9_-]+)/g)) {
          defined.add(match[1]);
        }
        for (const match of text.matchAll(/['"`](--[a-zA-Z0-9_-]+)['"`]\s*:/g)) {
          defined.add(match[1]);
        }
      }
    }
  }
  return defined;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

const errors = [];
const warnings = [];
const defined = collectDefinedProperties();
const inspectorCssFiles = walk(INSPECTOR_ROOT, isCss);

const RAW_TIME = /(?<![\w-])(\d+(?:\.\d+)?)(ms|s)\b/g;
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;

for (const file of inspectorCssFiles) {
  const raw = readFileSync(file, 'utf8');
  const stripped = stripComments(raw);
  const rel = relative(ROOT, file);
  let colourCount = 0;

  // E1 — undefined custom property references.
  for (const match of stripped.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
    const name = match[1];
    if (defined.has(name)) continue;
    const line = lineAt(stripped, match.index ?? 0);
    const context = raw.split('\n')[line - 1] ?? '';
    if (context.includes(ALLOW_MARKER)) continue;
    errors.push(`${rel}:${line} undefined custom property ${name}`);
  }

  // E2 — literal letter-spacing.
  for (const match of stripped.matchAll(/letter-spacing\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim();
    if (value.startsWith('var(--tracking-')) continue;
    /* Keywords that mean "no tracking": the absence of a value is not an
     * arbitrary literal, and resetting an inherited tracking is the one
     * legitimate reason to write it. */
    if (/^(inherit|initial|unset|revert|normal|0)$/.test(value)) continue;
    const line = lineAt(stripped, match.index ?? 0);
    const context = raw.split('\n')[line - 1] ?? '';
    if (context.includes(ALLOW_MARKER)) continue;
    errors.push(`${rel}:${line} literal letter-spacing "${value}"`);
  }

  // E3 — raw time literals inside transition/animation declarations.
  for (const match of stripped.matchAll(
    /(^|[;{])\s*(transition|animation)(-[a-z]+)?\s*:\s*([^;}]*)/gm,
  )) {
    const value = match[4] ?? '';
    for (const time of value.matchAll(RAW_TIME)) {
      const absolute = (match.index ?? 0) + match[0].indexOf(value) + (time.index ?? 0);
      const line = lineAt(stripped, absolute);
      const context = raw.split('\n')[line - 1] ?? '';
      if (context.includes(ALLOW_MARKER)) continue;
      errors.push(`${rel}:${line} raw duration "${time[0]}" in ${match[2]} declaration`);
    }
  }

  // W1 — raw colour literals (debt inventory).
  for (const _ of stripped.matchAll(RAW_COLOUR)) colourCount += 1;
  if (colourCount > 0) {
    warnings.push(`${rel}: ${colourCount} raw colour literal(s)`);
  }

  // E4 — raw font-size literals. The panel's type ramp lives in tokens
  // (--insp-label-size/--insp-value-size and the --font-size-* ramp); a raw
  // literal is by definition off the ramp. (pass-2 spec §6, R10)
  for (const match of stripped.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim();
    if (value.startsWith('var(')) continue;
    if (/^(inherit|initial|unset|revert)$/.test(value)) continue;
    const line = lineAt(stripped, match.index ?? 0);
    const context = raw.split('\n')[line - 1] ?? '';
    if (context.includes(ALLOW_MARKER)) continue;
    errors.push(`${rel}:${line} raw font-size "${value}"`);
  }

  // E5 — case transforms. The panel's hierarchy is carried by size, weight,
  // and color — not by block capitals. Research (GOV.UK content guidance,
  // British Dyslexia Association style guide) documents all-caps as a
  // legibility and accessibility cost, and the measured Design tab set every
  // field label and section title in caps (pass-3 audit IA-028). A future
  // uppercase role must be an explicit, annotated exception.
  for (const match of stripped.matchAll(/text-transform\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim();
    if (value !== 'uppercase') continue;
    const line = lineAt(stripped, match.index ?? 0);
    const context = raw.split('\n')[line - 1] ?? '';
    if (context.includes(ALLOW_MARKER)) continue;
    errors.push(`${rel}:${line} text-transform: uppercase (block capitals)`);
  }
  for (const match of stripped.matchAll(/font-variant-caps\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim();
    if (value === 'normal') continue;
    const line = lineAt(stripped, match.index ?? 0);
    const context = raw.split('\n')[line - 1] ?? '';
    if (context.includes(ALLOW_MARKER)) continue;
    errors.push(`${rel}:${line} font-variant-caps: ${value}`);
  }

  // W2 — raw numeric line-height (debt inventory). Unitless ratios bypass
  // the type ramp's line-height tokens; reported per file as a count.
  let lineHeightCount = 0;
  for (const match of stripped.matchAll(/line-height\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim();
    if (value.startsWith('var(')) continue;
    if (/^(inherit|initial|unset|revert|normal)$/.test(value)) continue;
    lineHeightCount += 1;
  }
  if (lineHeightCount > 0) {
    warnings.push(`${rel}: ${lineHeightCount} raw line-height value(s)`);
  }

  // W4 — bespoke grid tracks (trend inventory). The field grammar is
  // FieldRow / InspectorFieldGroup / paint-row (spec §2); every additional
  // grid-template-columns declaration is a candidate to fold back in.
  const gridCount = [...stripped.matchAll(/grid-template-columns\s*:/g)].length;
  if (gridCount > 0) {
    warnings.push(`${rel}: ${gridCount} grid-template-columns declaration(s)`);
  }
}

// W3 — icon-size drift in Inspector TSX (trend inventory). Sanctioned steps
// are 12 / 14 / 16 (spec §1.2); anything else — especially em-relative
// sizes, which compound with font size and produced the measured 9-15px
// census — is reported as a distinct-value summary.
{
  const inspectorTsxFiles = walk(INSPECTOR_ROOT, (f) => f.endsWith('.tsx'));
  const dist = new Map();
  for (const file of inspectorTsxFiles) {
    const raw = readFileSync(file, 'utf8');
    const stripped = stripComments(raw);
    for (const match of stripped.matchAll(/\bsize\s*=\s*("([^"]*)"|\{(\d+)\})/g)) {
      const value = match[2] ?? match[3] ?? '';
      if (!value) continue;
      if (/^(12|14|16)$/.test(value)) continue;
      if (/^(xs|sm|md|lg|xl)$/.test(value)) continue; // kit enum steps
      // Only icon components: `size=` also appears on non-icon props
      // (spacing presets, avatars) that are not part of this contract.
      const lineStart = raw.lastIndexOf('\n', match.index ?? 0) + 1;
      const lineEnd = raw.indexOf('\n', match.index ?? 0);
      const line = raw.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      if (!/(<Icon|<SolidIcon|<TablerIcon|Icon name=)/.test(line)) continue;
      if (line.includes(ALLOW_MARKER)) continue;
      const key = `${value}`;
      dist.set(key, (dist.get(key) ?? 0) + 1);
    }
  }
  if (dist.size > 0) {
    const summary = [...dist.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `${v}x${n}`)
      .join(', ');
    warnings.push(`inspector TSX icon sizes off-step (12/14/16): ${summary}`);
  }
}

if (warnings.length > 0) {
  console.log('audit:inspector-css — warnings (debt inventory, non-blocking):');
  for (const warning of warnings) console.log(`  WARN  ${warning}`);
}

if (errors.length > 0) {
  console.error('audit:inspector-css — FAILED');
  for (const error of errors) console.error(`  ERROR ${error}`);
  console.error(
    `\n${errors.length} violation(s). Fix the value or annotate the line with "${ALLOW_MARKER} <reason>".`,
  );
  process.exit(1);
}

console.log(
  `audit:inspector-css — clean (${inspectorCssFiles.length} stylesheets; undefined-reference, letter-spacing, raw-duration, raw-font-size, and block-capitals rules).`,
);
