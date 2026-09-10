#!/usr/bin/env node
/**
 * Varve workspace-mode API audit.
 *
 * Ensures that:
 *   1. `setWorkspaceMode` (the old public API) is never called directly.
 *      Only `__setWorkspaceModeUnsafe` or `requestWorkspaceSwitch` may be used.
 *   2. `__setWorkspaceModeUnsafe` is only referenced in its allowed files:
 *      - context/types.ts   (type definition)
 *      - context.tsx         (implementation + requestWorkspaceSwitch)
 *      - workspace/useWorkspace.ts  (switcher module that brokers access)
 *
 * This enforces the rule that ALL workspace mode switches must go through
 * `requestWorkspaceSwitch` (or `useWorkspaceSwitcher`), never through the raw
 * setter.
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;

const SRC_EXT = new Set(['.ts', '.tsx']);

const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  'dist',
  '.next',
  '.git',
  'coverage',
  '.pnpm-store',
  '.tauri',
  'playwright-report',
  '.worktrees',
]);

// Files where __setWorkspaceModeUnsafe is ALLOWED (type def, impl, internal broker)
const ALLOWED_UNSAFE_FILES = new Set([
  'packages/editor/src/context/types.ts',
  'packages/editor/src/context.tsx',
  'packages/editor/src/workspace/useWorkspace.ts',
]);

// Pattern: bare `setWorkspaceMode(` — NOT preceded by `__` and NOT `requestWorkspaceSwitch`
const BARE_SET_RE = /(?<!__|requestWorkspace)setWorkspaceMode\s*\(/;

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(join(dir, e.name), out);
    } else if (e.isFile() && SRC_EXT.has(extname(e.name))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const files = await walk(ROOT);
const offenders = [];

for (const f of files) {
  const text = await readFile(f, 'utf8');
  const rel = relative(ROOT, f);
  const lines = text.split('\n');

  // Check 1: bare `setWorkspaceMode(` calls
  for (let i = 0; i < lines.length; i++) {
    if (BARE_SET_RE.test(lines[i])) {
      offenders.push(
        `BARE_SET: ${rel}:${i + 1}: Use requestWorkspaceSwitch instead of setWorkspaceMode. ${lines[i].trim().slice(0, 100)}`,
      );
    }
  }

  // Check 2: `__setWorkspaceModeUnsafe` restricted to allowed files
  if (text.includes('__setWorkspaceModeUnsafe') && !ALLOWED_UNSAFE_FILES.has(rel)) {
    offenders.push(
      `UNSAFE_SET: ${rel}: __setWorkspaceModeUnsafe is internal and may only be used in: ${[...ALLOWED_UNSAFE_FILES].join(', ')}`,
    );
  }
}

if (offenders.length > 0) {
  console.error(`\x1b[31maudit:workspace-api — ${offenders.length} violation(s):\x1b[0m`);
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`audit:workspace-api — clean (scanned ${files.length} files).`);
