#!/usr/bin/env node
/**
 * Token-usage audit — undefined custom-property references.
 *
 * A `var(--x)` reference to a property no stylesheet or runtime ever defines
 * silently falls back (to its literal fallback, or to nothing). That is the
 * mechanism by which the theme system degrades quietly:
 *
 *   - `var(--color-text-danger)` with no definition          -> color: unset
 *   - `var(--color-feedback-warning, #f57c00)`               -> a literal that
 *                                                               never follows the
 *                                                               theme
 *   - `var(--color-surface-raised, #ffffff)`                 -> a light-only
 *                                                               surface in dark mode
 *
 * The Inspector-scoped version of this rule (`audit-inspector-css.mjs`) proved
 * the approach; this is the repo-wide gate. `packages/ui/src/tokens/tokens.css`
 * is the declaration source and is never hand-edited, but definitions are
 * collected from every CSS/TS/TSX file so runtime-set properties
 * (`style.setProperty`, component override hooks) also count.
 *
 * Run: `pnpm audit:tokens:usage` (also run by `pnpm audit:tokens`).
 * Exit code is non-zero on any undefined reference outside ALLOWED.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['packages', 'apps'];
const SKIP = /node_modules|dist|\.worktrees|__goldens__|test-results|\.turbo|\.astro/;

/**
 * Undefined by design: each entry is a *consumer override hook* that a host or
 * runtime sets, with a fallback for the unset case. The reason is required so
 * the list cannot grow by accident.
 */
const ALLOWED = new Map([
  ['--keyboard-inset-bottom', 'set at runtime by packages/editor/src/canvas/keyboardInset.ts'],
  ['--skeleton-bg-color', 'ContentSkeleton consumer override hook (fallback is the token)'],
  ['--skeleton-shimmer-color', 'ContentSkeleton consumer override hook (fallback is the token)'],
  ['--loader-fade-in', 'RegionLoader consumer override hook (fallback is a duration)'],
  ['--loader-spin-duration', 'Spinner consumer override hook (fallback is a duration)'],
  ['--bento-gap', 'website bento-grid consumer override hook'],
  ['--bento-cols', 'website bento-grid consumer override hook'],
  ['--bento-span', 'website bento-grid consumer override hook'],
  ['--sel', 'set inline by website Hero.astro (per-phrase accent)'],
]);

/**
 * Comments and code samples mention `var(--x)` without referencing it. Skip
 * lines that are plainly not declarations: block-comment bodies, and the
 * parser-documentation comment in gridRenderer.ts.
 */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('*') || t.startsWith('/*') || t.startsWith('//');
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (SKIP.test(path)) continue;
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(join(ROOT, root)));
const cssFiles = files.filter((f) => f.endsWith('.css'));
const codeFiles = files.filter(
  (f) => /\.(ts|tsx|astro)$/.test(f) && !/\.test\./.test(f) && !/__tests__/.test(f),
);

const defined = new Set();
function collectDefinitions(file) {
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/(^|[;{\s,"'`])--([a-zA-Z0-9_-]+)\s*['"`]?\s*:/g)) {
      defined.add(`--${m[2]}`);
    }
    for (const m of line.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9_-]+)['"`]/g)) {
      defined.add(m[1]);
    }
    // `'--custom-prop': value` object keys and `--x, value` setProperty args
    for (const m of line.matchAll(/['"`](--[a-zA-Z0-9_-]+)['"`]\s*[,:)]/g)) {
      defined.add(m[1]);
    }
  }
}
for (const file of [...cssFiles, ...codeFiles]) collectDefinitions(file);

const unresolved = [];
const literalFallbacks = [];

for (const file of [...cssFiles, ...codeFiles]) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  text.split('\n').forEach((line, index) => {
    if (isCommentLine(line)) return;
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(,[^)]*)?\)/g)) {
      const name = m[1];
      const fallback = m[2]?.replace(/^,\s*/, '').trim();
      if (!defined.has(name)) {
        if (ALLOWED.has(name)) continue;
        unresolved.push({ rel, line: index + 1, name, text: line.trim().slice(0, 120) });
        continue;
      }
      // A literal fallback on a *defined* token is worse than useless: it can
      // only ever paint an unthemed value, and it hides the token's absence.
      const literal =
        /^#([0-9a-fA-F]{3,8})$/.test(fallback ?? '') ||
        /^rgba?\(/.test(fallback ?? '') ||
        /^hsla?\(/.test(fallback ?? '') ||
        /^oklch\(/.test(fallback ?? '') ||
        /^(white|black|red|green|blue|gray|grey|silver|maroon|olive|lime|aqua|teal|navy|fuchsia|purple|orange|yellow)$/.test(
          fallback ?? '',
        );
      if (literal) {
        literalFallbacks.push({
          rel,
          line: index + 1,
          name,
          fallback,
          text: line.trim().slice(0, 120),
        });
      }
    }
  });
}

for (const u of unresolved) {
  console.error(`undefined token  ${u.rel}:${u.line}  ${u.name}\n    ${u.text}`);
}
for (const f of literalFallbacks) {
  console.error(
    `literal fallback on defined token  ${f.rel}:${f.line}  var(${f.name}, ${f.fallback})\n    ${f.text}`,
  );
}

const allowed = [...ALLOWED.entries()].map(([k, v]) => `    ${k} — ${v}`).join('\n');
if (unresolved.length > 0 || literalFallbacks.length > 0) {
  console.error(
    `\naudit:tokens:usage — ${unresolved.length} undefined reference(s), ` +
      `${literalFallbacks.length} literal fallback(s) on defined tokens.`,
  );
  console.error(
    `Fix the reference, or add the name to ALLOWED in this script with a reason.\n` +
      `Currently allowed override hooks:\n${allowed}`,
  );
  process.exit(1);
}

console.log(
  `audit:tokens:usage — clean (${defined.size} custom properties defined; ` +
    `${ALLOWED.size} documented override hooks).`,
);
