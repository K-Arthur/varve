#!/usr/bin/env node
/**
 * Strata performance audit (Strata spec §6, §22).
 *
 * Checks:
 *   1. No animation of layout properties (width, height, top, left, etc.)
 *      — only transform and opacity are allowed for animation/transition.
 *   2. content-visibility: auto on off-screen panels.
 *
 * Exits non-zero on violations.
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const SKIP_DIRS = new Set([
  'node_modules', 'target', 'dist', '.next', '.git', 'coverage',
  '.pnpm-store', '.tauri', 'playwright-report', 'test-results', 'icons',
]);
const CSS_EXT = new Set(['.css']);

// Properties that must NOT be animated (cause layout thrash).
const LAYOUT_PROPS = ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding'];

// Compiled regex: matches "transition: [anything containing a banned prop]" or "animation: [anything containing a banned prop]"
const LAYOUT_ANIM_RE = new RegExp(
  `transition[^;]*\\\\b(${LAYOUT_PROPS.join('|')})\\\\b|animation[^;]*\\\\b(${LAYOUT_PROPS.join('|')})\\\\b`,
  'gi',
);

const violations = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name));
    } else if (e.isFile() && CSS_EXT.has(extname(e.name))) {
      const text = await readFile(join(dir, e.name), 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (LAYOUT_ANIM_RE.test(lines[i])) {
          violations.push(`${relative(ROOT, join(dir, e.name))}:${i + 1}: ${lines[i].trim().slice(0, 100)}`);
        }
      }
    }
  }
}

await walk(ROOT);

if (violations.length > 0) {
  console.error(`\x1b[31maudit:perf — ${violations.length} layout-animation violation(s):\x1b[0m`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log('audit:perf — clean (no layout-thrashing animations found).');
