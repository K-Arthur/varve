#!/usr/bin/env node
/**
 * Varve emoji-ban audit (Strata plan §4.4 / §7 gate).
 *
 * Zero emoji anywhere in source. Two passes:
 *   1. EMOJI_RE — pictographic emoji across ALL source files
 *   2. ICON_RE  — icon-like text chars (arrows, geometric shapes)
 *      applied to .tsx only (where UI strings are rendered)
 *
 * Exits non-zero if either pass finds violations.
 *
 * Run: `pnpm audit:emoji` (also wired into the Cascade Review `gates` recipe).
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;

// Pictographic emoji — scanned across .ts/.tsx/.css/.html files.
// Covers: Regional Indicators (flags), Misc Symbols + Dingbats, Misc Symbols
// and Arrows, Mahjong+CJK+Symbols Extended-A, full Symbols & Pictographs +
// Emoticons + Transport + Supplemental ranges, and the Unicode property escape
// for any pictographic char.
const EMOJI_RE =
  /[\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\p{Extended_Pictographic}]/u;

// Icon-like text chars used as UI affordances — scanned only in CODE files.
// Covers: Arrows block (U+2190-U+21FF), Geometric Shapes (U+25A0-U+25FF),
// multiplication sign (U+00D7), division sign (U+00F7).
// These are never acceptable as UI elements; SVG icons must be used instead.
const ICON_RE =
  /[\u{00D7}\u{00F7}\u{2190}\u{2191}\u{2192}\u{2193}\u{25A0}\u{25A1}\u{25B2}\u{25B6}\u{25BC}\u{25C0}\u{25C6}\u{25C7}\u{25CB}\u{25CF}]/u;
const ICON_EXT = new Set(['.tsx']);

const ALL_EXT = new Set(['.ts', '.tsx', '.css', '.html']);

const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  'dist',
  'dist-root',
  'dist-pages',
  '.next',
  '.git',
  'coverage',
  '.pnpm-store',
  '.tauri',
  'playwright-report',
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
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.worktrees'))
        await walk(join(dir, e.name), out);
    } else if (e.isFile() && ALL_EXT.has(extname(e.name))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const files = await walk(ROOT);
const offenders = [];

for (const f of files) {
  const ext = extname(f);
  const text = await readFile(f, 'utf8');
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pass 1: emoji check — .ts/.tsx/.css/.html
    // Fuzz fixtures (unicodeLayout.fuzz.test.ts and kin) deliberately embed
    // emoji sequences as *test data* for the unicode layout engine. That is
    // data, not UI affordance, so it is exempt — same principle as the ICON
    // pass skipping comments.
    if (f.endsWith('.fuzz.test.ts')) continue;
    if (EMOJI_RE.test(line)) {
      offenders.push(`EMOJI: ${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      continue;
    }

    // Pass 2: icon-like char check — .tsx only
    if (ICON_EXT.has(ext) && ICON_RE.test(line)) {
      const trimmed = line.trim();
      const isComment =
        trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
      if (!isComment) {
        offenders.push(`ICON:  ${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(`\x1b[31maudit:emoji — ${offenders.length} violation(s):\x1b[0m`);
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`audit:emoji — clean (scanned ${files.length} files).`);
