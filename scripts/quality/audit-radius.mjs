#!/usr/bin/env node

/**
 * Verify that application and website chrome consume the semantic radius API.
 *
 * Document/artwork geometry is intentionally outside this audit. A raw 1px
 * radius is retained only for tiny decorative/precision marks; circles and
 * inherited/zero geometry are also explicit exceptions.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SOURCE_ROOTS = [
  'packages/ui/src',
  'packages/editor/src',
  'apps/desktop/src',
  'apps/website/src',
].map((relativePath) => path.join(ROOT, relativePath));
const SOURCE_EXTENSIONS = new Set(['.astro', '.css', '.ts', '.tsx']);
const TOKEN_DEFINITION_FILES = new Set([
  path.join(ROOT, 'packages/ui/src/tokens/tokens.css'),
  path.join(ROOT, 'packages/ui/scripts/generate-token-css.ts'),
]);

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'dist-pages', 'target'].includes(entry.name)) {
        files.push(...collectFiles(entryPath));
      }
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function isSemantic(value) {
  return (
    /var\(--(?:website-)?radius-[a-z-]+/.test(value) ||
    /var\(--skeleton-radius\)/.test(value) ||
    value === '0' ||
    value === '50%' ||
    value === 'inherit'
  );
}

function isIntentionalRaw(value) {
  return value === '1px' || value === '1px 1px 0 0' || value === '0 1px 1px 0';
}

const files = SOURCE_ROOTS.flatMap(collectFiles).sort();
const rawExceptions = [];
const violations = [];
const legacyConsumers = [];
let cssDeclarations = 0;
let inlineDeclarations = 0;
let utilityOccurrences = 0;

for (const filePath of files) {
  const source = readFileSync(filePath, 'utf8');
  const relativePath = path.relative(ROOT, filePath);

  for (const match of source.matchAll(/border-radius\s*:\s*([^;\n}]+)/g)) {
    cssDeclarations += 1;
    const value = match[1].trim();
    if (isSemantic(value)) continue;
    if (isIntentionalRaw(value)) {
      rawExceptions.push(`${relativePath}:${lineNumber(source, match.index)} ${value}`);
    } else {
      violations.push(`${relativePath}:${lineNumber(source, match.index)} ${value}`);
    }
  }

  for (const match of source.matchAll(/borderRadius\s*:\s*([^,;\n}]+)/g)) {
    inlineDeclarations += 1;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (isSemantic(value) || value === '50%' || value === '0') continue;
    if (isIntentionalRaw(value)) {
      rawExceptions.push(`${relativePath}:${lineNumber(source, match.index)} ${value}`);
    } else {
      violations.push(`${relativePath}:${lineNumber(source, match.index)} ${value}`);
    }
  }

  utilityOccurrences += (
    source.match(/\brounded-(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\])/g) ?? []
  ).length;

  if (!TOKEN_DEFINITION_FILES.has(filePath)) {
    for (const match of source.matchAll(/var\(--radius-(?:sm|md|lg|xl|2xl)(?:[,)]|\b)/g)) {
      legacyConsumers.push(`${relativePath}:${lineNumber(source, match.index)}`);
    }
  }
}

console.log(`Radius audit: ${files.length} active source files`);
console.log(`CSS border-radius declarations: ${cssDeclarations}`);
console.log(`Inline borderRadius declarations: ${inlineDeclarations}`);
console.log(`rounded-* utility occurrences: ${utilityOccurrences}`);
console.log(`Intentional raw geometry exceptions: ${rawExceptions.length}`);
for (const exception of rawExceptions) console.log(`  allowed ${exception}`);
console.log(`Legacy radius consumers: ${legacyConsumers.length}`);

if (violations.length > 0) {
  console.error('\nUnjustified raw radius values:');
  for (const violation of violations) console.error(`  ${violation}`);
}
if (legacyConsumers.length > 0) {
  console.error('\nLegacy radius consumers outside token definitions:');
  for (const consumer of legacyConsumers) console.error(`  ${consumer}`);
}

if (violations.length > 0 || legacyConsumers.length > 0) process.exitCode = 1;
