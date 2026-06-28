#!/usr/bin/env node
/**
 * Strata emoji-ban audit (Strata plan §4.4 / §7 gate).
 *
 * Zero emoji anywhere in source. This script scans all source files for emoji
 * (Extended_Pictographic, symbol ranges, regional-flag pairs) and exits non-zero
 * if any are found, printing the offending file + line. Excludes deps and build
 * output. SVG icons and animated-SVG spinners are the only permitted graphics.
 *
 * Run: `pnpm audit:emoji` (also wired into the Cascade Review `gates` recipe).
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
// Unicode property escape for pictographic + key symbol ranges used as UI glyphs.
const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\p{Extended_Pictographic}]/u;

const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.rs', '.css', '.html', '.md']);
const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  'dist',
  '.next',
  '.git',
  'coverage',
  '.pnpm-store',
  '.tauri',
]);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name), out);
    } else if (e.isFile() && SCAN_EXT.has(extname(e.name))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const files = await walk(ROOT);
const offenders = [];
for (const f of files) {
  const text = await readFile(f, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (EMOJI_RE.test(lines[i])) {
      offenders.push(`${relative(ROOT, f)}:${i + 1}: ${lines[i].trim().slice(0, 80)}`);
    }
  }
}

if (offenders.length > 0) {
  console.error(`\x1b[31maudit:emoji — ${offenders.length} file(s) contain emoji:\x1b[0m`);
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`audit:emoji — clean (scanned ${files.length} files).`);
