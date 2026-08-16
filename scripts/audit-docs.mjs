#!/usr/bin/env node
/**
 * Varve documentation drift audit.
 *
 * Three checks, each exit-failing:
 *   1. NAMING  — current-state docs must not reference the retired product
 *                name "Strata" or dead paths (crates/strata-*, strata-app-icon.svg,
 *                strata_wasm_*, dev.strata.desktop, ...). Historical docs
 *                (dated audits/plans/perf/research/superpowers/implementation
 *                memory/session history/ADRs/CLA/licensing, and records moved
 *                to docs/historical/) are allowed to
 *                mention Strata — the product was renamed 2026-08-04 and
 *                legacy format identifiers (.strata extension, vnd.strata
 *                MIME, strata:* storage keys) are intentionally kept.
 *   2. INDEX    — docs/README.md must list every file in docs/adr/.
 *   3. LINKS    — every relative markdown link inside docs/** resolves to an
 *                existing file (anchors are checked against the target's
 *                headings when the target exists).
 *
 * Run: `pnpm audit:docs` or `just docs-check`.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('../', import.meta.url).pathname);
const DOCS = join(ROOT, 'docs');

// ---------------------------------------------------------------------------
// 1. Naming
// ---------------------------------------------------------------------------

// Historical subtrees/documents: allowed to mention "Strata".
const HISTORICAL_PREFIXES = [
  'docs/adr/',
  'docs/audits/',
  'docs/historical/', // dated point-in-time records moved out of docs/architecture/
  'docs/implementation/',
  'docs/implementation-memory/',
  'docs/perf/',
  'docs/plans/', // except the live operating guide, re-added below as CURRENT
  'docs/research/',
  'docs/superpowers/',
  'docs/quality/', // except tauri-command-audit.md
];
const HISTORICAL_EXACT = [
  'docs/agents/session-history.md',
  'docs/CLA-DECISION-RECORD.md',
  'docs/CLA-MAINTAINER.md',
  'docs/CLA.md',
  'docs/ICLA.md',
  'docs/CCLA.md',
  'docs/licensing/review.md',
  'docs/development/provenance.md', // records the historical "Strata Founder" git identity
  'docs/privacy/crash-audit.md', // intentionally enumerates live legacy "Strata" identifiers
  'docs/release/release-readiness-audit.md',
  'docs/audits/marketing-copy-review-2026-08-04.md', // dated review snapshot (moved from docs/release/ 2026-08-12)
  'docs/audits/marketing-copy-review-2026-08-10.md', // dated review snapshot
  'docs/brand/varve-brand-guide.md', // superseded v1.0 guide — describes the pre-rename asset names
];
// These are CURRENT docs despite living under plans/ (they are operating guides).
const CURRENT_EXACT = ['docs/plans/website-operations-guide.md'];

// Banned references in current-state docs. Each entry: [label, RegExp].
const BANNED = [
  ['retired product name "Strata"', /\bStrata\b/],
  ['dead crate path', /crates\/strata-/],
  [
    'dead crate name',
    /\bstrata-(core|engine|layout|sync|trace|print|upscale|bgremove|colour|bridge|wasm|desktop)\b/,
  ],
  [
    'dead crate path (snake_case)',
    /\bstrata_(core|engine|layout|sync|trace|print|upscale|bgremove|colour|bridge|wasm)\b/,
  ],
  ['dead wasm artifact', /\bstrata_wasm\b/],
  // Dead icon paths: the pre-rename icon sources under packages/ui/src/icons/
  // and public/icons/ are gone (backup copies only). The src-tauri/icons/
  // strata-icon.svg + strata-icon-source.png files are legitimately retained
  // (Tauri window icons still reference them), so those paths stay allowed.
  ['dead icon path', /(?:packages\/ui\/src\/icons|public\/icons)\/strata-|strata-app-icon/],
  ['dead wordmark filename', /strata-wordmark/],
  ['dead tooltip class', /\bstrata-tip\b/],
  ['dead app identifier', /\bdev\.strata\.desktop\b/],
  ['dead repo URL', /K-Arthur\/Strata\b|github\.com\/strata\/strata/],
  ['dead package name', /@strata\//],
];

function isHistorical(relPath) {
  if (CURRENT_EXACT.includes(relPath)) return false;
  if (HISTORICAL_EXACT.includes(relPath)) return true;
  return HISTORICAL_PREFIXES.some((p) => relPath.startsWith(p));
}

// ---------------------------------------------------------------------------
// 3. Link extraction
// ---------------------------------------------------------------------------
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') await walk(join(dir, e.name), out);
    } else if (e.isFile() && extname(e.name) === '.md') {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

async function headingIds(file) {
  try {
    const text = await readFile(file, 'utf8');
    const ids = new Set();
    for (const line of text.split('\n')) {
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m)
        ids.add(
          m[2]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
        );
    }
    return ids;
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const files = await walk(DOCS);
for (const extra of ['apps', 'tests']) {
  files.push(...(await walk(join(ROOT, extra))));
}
const violations = [];
let checked = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  const text = await readFile(file, 'utf8');

  // Check 1: naming
  if (!isHistorical(rel)) {
    for (const [label, re] of BANNED) {
      const m = text.match(re);
      if (m) {
        const lineNo = text.slice(0, m.index).split('\n').length;
        violations.push(`NAMING [${label}]: ${rel}:${lineNo}: ${m[0].slice(0, 80)}`);
      }
    }
  }

  // Check 3: links
  for (const m of text.matchAll(LINK_RE)) {
    const target = m[1];
    if (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:')
    )
      continue;
    if (target.startsWith('#')) continue; // same-file anchor
    if (target.startsWith('<') && target.endsWith('>')) continue; // auto-link
    const [pathPart, anchor] = target.split('#');
    if (!pathPart || pathPart.includes(' ')) continue; // not a file link we can resolve
    const resolved = resolve(dirname(file), decodeURIComponent(pathPart));
    try {
      const st = await stat(resolved);
      if (st.isDirectory()) {
        // Directory links are legitimate (e.g. "see src/ for all tests").
        checked++;
        continue;
      }
      if (st.isFile()) {
        if (anchor) {
          const ids = await headingIds(resolved);
          const id = anchor
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          if (id && !ids.has(id)) {
            violations.push(`ANCHOR: ${rel} -> ${pathPart}#${anchor} (no such heading)`);
          }
        }
      } else {
        violations.push(`DIRECTORY: ${rel} -> ${pathPart}`);
      }
    } catch {
      violations.push(`BROKEN: ${rel} -> ${pathPart}`);
    }
    checked++;
  }
}

// Check 2: ADR index
const adrFiles = (await readdir(join(DOCS, 'adr'))).filter((f) => f.endsWith('.md'));
const indexText = await readFile(join(DOCS, 'README.md'), 'utf8');
for (const f of adrFiles) {
  if (!indexText.includes(`adr/${f}`)) {
    violations.push(`INDEX: docs/README.md does not list docs/adr/${f}`);
  }
}

// Check 2b: the ADR index must not list the same file twice (duplicate rows
// drift silently — the presence check above cannot see them).
const indexLines = indexText.split('\n');
const seen = new Set();
for (const line of indexLines) {
  const m = line.match(/^\| `adr\/([0-9]{4}-[a-z0-9-]+\.md)` \|/);
  if (m) {
    if (seen.has(m[1])) {
      violations.push(`INDEX: docs/README.md lists adr/${m[1]} more than once`);
    }
    seen.add(m[1]);
  }
}

if (violations.length > 0) {
  console.error(`\x1b[31maudit:docs — ${violations.length} violation(s):\x1b[0m`);
  for (const v of violations.slice(0, 80)) console.error(`  ${v}`);
  if (violations.length > 80) console.error(`  … and ${violations.length - 80} more`);
  process.exit(1);
}
console.log(
  `audit:docs — clean (${files.length} docs, ${checked} links, ${adrFiles.length} ADRs indexed).`,
);
