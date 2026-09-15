#!/usr/bin/env node
/**
 * One-time migration of the Varve website from the legacy light-only
 * --color-neutral-* / --color-teal-* ramp (defined in Layout.astro) to the
 * semantic tokens in src/styles/theme.css.
 *
 * Ordered, context-aware replacements; then reports anything left over.
 * Usage: node scripts/migrate-colors.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const write = process.argv.includes('--write');

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.astro')) files.push(full);
  }
}
walk(root);

// Ordered: more specific patterns first.
const RULES = [
  // Gradient with legacy tints.
  [
    /linear-gradient\(135deg, var\(--color-teal-50\) 0%, white 100%\)/g,
    'linear-gradient(135deg, var(--surface-accent-soft) 0%, var(--surface-card) 100%)',
  ],
  // Status badge backgrounds + their paired white text.
  [/background: var\(--color-teal-600\)/g, 'background: var(--status-built)'],
  [/background: var\(--color-terracotta-400\)/g, 'background: var(--status-partial)'],
  [/background: var\(--color-sandstone-400\)/g, 'background: var(--status-dev)'],
  [/background: var\(--color-terracotta-50\)/g, 'background: var(--surface-warning)'],
  [/background: var\(--color-teal-50\)/g, 'background: var(--surface-accent-soft)'],
  [/border: 1px solid var\(--color-teal-200\)/g, 'border: 1px solid var(--border-accent)'],
  [
    /border[a-z-]*: [^;]*var\(--color-teal-100\)/g,
    (m) => m.replace('var(--color-teal-100)', 'var(--border-accent)'),
  ],
  [
    /border: 1px solid var\(--color-terracotta-200, #fecaca\)/g,
    'border: 1px solid var(--border-warning)',
  ],
  [/border: 1px solid var\(--color-sandstone-400\)/g, 'border: 1px solid var(--border-warning)'],
  [/border: 1px solid var\(--color-terracotta-400\)/g, 'border: 1px solid var(--border-warning)'],
  [/border: 1px solid var\(--color-teal-400\)/g, 'border: 1px solid var(--border-accent)'],
  [/border-color: var\(--color-sandstone-400\)/g, 'border-color: var(--border-warning)'],
  [/border-color: var\(--color-terracotta-400\)/g, 'border-color: var(--border-warning)'],
  [/border-color: var\(--color-teal-400\)/g, 'border-color: var(--border-accent)'],
  [/background: var\(--color-sandstone-100\)/g, 'background: var(--surface-warning)'],
  [/background: var\(--color-sandstone-50\)/g, 'background: var(--surface-warning)'],
  [/color: var\(--color-sandstone-700\)/g, 'color: var(--text-warning)'],
  [/color: var\(--color-teal-800\)/g, 'color: var(--text-link)'],
  [/color: var\(--color-teal-700\)/g, 'color: var(--text-link-hover)'],
  [/color: var\(--color-teal-400\)/g, 'color: var(--text-link-hover)'],
  [/color: var\(--color-teal-600\)/g, 'color: var(--text-link)'],
  [/color: var\(--color-teal-500\)/g, 'color: var(--text-link)'],
  [/color: white/g, 'color: var(--text-on-status)'],
  [/color: #16a34a/g, 'color: var(--text-success)'],
  [/color: #dc2626/g, 'color: var(--text-danger)'],
  // Code blocks.
  [/background: var\(--color-neutral-900\)/g, 'background: var(--surface-code)'],
  [/color: var\(--color-neutral-100\)/g, 'color: var(--text-code)'],
  [/color: var\(--color-neutral-300\)/g, 'color: var(--text-footer-link)'],
  [/color: var\(--color-neutral-400\)/g, 'color: var(--text-muted)'],
  [/color: var\(--color-neutral-500\)/g, 'color: var(--text-muted)'],
  [/color: var\(--color-neutral-600\)/g, 'color: var(--text-secondary)'],
  [/color: var\(--color-neutral-700\)/g, 'color: var(--text-secondary)'],
  [/color: var\(--color-neutral-900\)/g, 'color: var(--text-primary)'],
  // Neutral backgrounds and borders.
  [/background: var\(--color-neutral-100\)/g, 'background: var(--surface-muted)'],
  [/background: var\(--color-neutral-200\)/g, 'background: var(--surface-muted)'],
  [/background: var\(--color-neutral-50\)/g, 'background: var(--surface-sunken)'],
  [/background: white/g, 'background: var(--surface-card)'],
  [
    /border[a-z-]*: [^;]*var\(--color-neutral-200\)/g,
    (m) => m.replace('var(--color-neutral-200)', 'var(--border-default)'),
  ],
  [/var\(--color-neutral-200\)/g, 'var(--border-default)'],
];

let changed = 0;
let leftover = 0;
for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  for (const [pattern, replacement] of RULES) {
    src = src.replace(pattern, replacement);
  }
  if (src !== before) {
    changed++;
    if (write) fs.writeFileSync(file, src);
    else console.log('WOULD CHANGE', path.relative(root, file));
  }
  const leftovers = src.match(/var\(--color-(neutral|teal|terracotta|sandstone)[^)]*\)/g);
  if (leftovers) {
    leftover += leftovers.length;
    console.log('LEFTOVER', path.relative(root, file), leftovers.join(', '));
  }
}
console.log(`\n${changed} file(s) would change. ${leftover} leftover legacy token reference(s).`);
