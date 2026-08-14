#!/usr/bin/env node

/**
 * Varve import-boundary enforcement.
 *
 * Trust separation in a monorepo is only real if client code cannot reach
 * another application's internals. These rules are checked statically over
 * every source file under apps (website + desktop src trees) and packages,
 * and over the workspace dependency edges in each package.json:
 *
 *   1. apps/website must not import from apps/desktop (or any other app).
 *   2. apps/desktop must not import from apps/website (or any other app).
 *   3. packages must not import from any apps — shared code is a leaf.
 *   4. No client code may import from apps/api or services — the reserved
 *      future backend location (see docs/security/trust-boundaries.md).
 *   5. No TypeScript code may import into apps/desktop/src-tauri (Rust surface).
 *
 * The same rules are enforced on the dependency graph: a package.json that
 * lists another app as a workspace dependency violates the boundary even if
 * no import statement does yet.
 *
 * Enforcement is intentionally dependency-free (regex over import/require
 * statements — the monorepo is small and the patterns are simple). It runs in
 * CI pipeline-validate and its regression tests live in
 * import-boundaries.test.mjs.
 *
 * Usage:
 *   node scripts/security/import-boundaries.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const ROOT = process.cwd();

const SOURCE_DIRS = ['apps/website/src', 'apps/desktop/src'];
const PACKAGE_GLOB = 'packages';

// Bare workspace specifier -> repo-relative directory (pnpm workspace).
// Any specifier not mapped here is a third-party dependency — allowed.
const WORKSPACE_ALIASES = new Map([
  ['@varve/shared', 'packages/shared'],
  ['@varve/engine', 'packages/engine'],
  ['@varve/scene', 'packages/scene'],
  ['@varve/ui', 'packages/ui'],
  ['@varve/editor', 'packages/editor'],
  ['@varve/codegen', 'packages/codegen'],
  ['@varve/prototype', 'packages/prototype'],
  ['@varve/import', 'packages/import'],
  ['@varve/platform', 'packages/platform'],
  ['@varve/ai', 'packages/ai'],
  ['@varve/collab', 'packages/collab'],
  ['@varve/compositor', 'packages/compositor'],
  ['@varve/crash', 'packages/crash'],
  ['@varve/help', 'packages/help'],
  ['@varve/home', 'packages/home'],
  ['@varve/layout', 'packages/layout'],
  ['@varve/print', 'packages/print'],
  ['@varve/tokens', 'packages/tokens'],
  ['@varve/history', 'packages/history'],
  ['@varve/cli', 'packages/cli'],
  ['@varve/website', 'apps/website'],
  ['@varve/desktop', 'apps/desktop'],
]);

// Reserved future-backend locations; importing them from client code must
// fail today, so a later backend cannot silently leak into clients.
const RESERVED_BACKEND = ['apps/api', 'services'];

const IMPORT_RE =
  /(?:import|export)\s+(?:[\w*{},\s$]+\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function zoneOf(repoRel) {
  if (repoRel.startsWith('apps/website/')) return 'website';
  if (repoRel.startsWith('apps/desktop/')) return 'desktop';
  if (repoRel.startsWith('apps/')) return 'other-app';
  if (repoRel.startsWith('packages/')) return 'package';
  return null;
}

function isReservedBackend(repoRel) {
  return RESERVED_BACKEND.some((prefix) => repoRel === prefix || repoRel.startsWith(`${prefix}/`));
}

function isTauriSurface(repoRel) {
  return repoRel.startsWith('apps/desktop/src-tauri');
}

/**
 * Resolve an import specifier from a source file to a repo-relative path.
 * Returns null for third-party packages (allowed) and unresolvable paths.
 */
export function resolveSpecifier(spec, fromFile, root = ROOT) {
  if (spec.startsWith('.')) {
    const target = resolve(dirname(fromFile), spec);
    const rel = relative(root, target);
    return rel.startsWith('..') ? null : rel;
  }
  const alias = WORKSPACE_ALIASES.get(spec);
  if (alias) return alias;
  // Scoped workspace packages not in the map resolve to packages/<name>.
  const scoped = spec.match(/^@varve\/([a-z-]+)(?:\/.*)?$/);
  if (scoped) {
    const dir = `packages/${scoped[1]}`;
    if (statSync(join(root, dir), { throwIfNoEntry: false })?.isDirectory()) return dir;
    return null;
  }
  // Relative-to-root imports (./apps/... style are not valid TS, but catch
  // anything that points into the tree anyway).
  if (spec.startsWith('apps/') || spec.startsWith('packages/') || spec.startsWith('services/')) {
    return spec;
  }
  return null;
}

export function auditFile(text, repoRelPath, root = ROOT) {
  const violations = [];
  const zone = zoneOf(repoRelPath);
  if (!zone) return violations;
  const fromFile = join(root, repoRelPath);
  const targets = [];
  IMPORT_RE.lastIndex = 0;
  for (let m = IMPORT_RE.exec(text); m !== null; m = IMPORT_RE.exec(text)) {
    const spec = m[1] ?? m[2];
    if (!spec || spec.startsWith('node:')) continue;
    const resolved = resolveSpecifier(spec, fromFile, root);
    if (!resolved) continue;
    targets.push({ spec, resolved, line: text.slice(0, m.index).split('\n').length });
  }
  for (const t of targets) {
    const targetZone = zoneOf(t.resolved);
    if (isTauriSurface(t.resolved)) {
      violations.push(
        `${repoRelPath}:${t.line} imports ${t.spec} (${t.resolved}) — Rust/Tauri surface must never be imported from TypeScript`,
      );
      continue;
    }
    if (isReservedBackend(t.resolved)) {
      violations.push(
        `${repoRelPath}:${t.line} imports ${t.spec} — the future backend location (${t.resolved}) is reserved; ` +
          'client code must never import server implementation',
      );
      continue;
    }
    if (zone === 'website' && (targetZone === 'desktop' || targetZone === 'other-app')) {
      violations.push(
        `${repoRelPath}:${t.line} imports ${t.spec} — apps/website must not import another application's internals`,
      );
    }
    if (zone === 'desktop' && (targetZone === 'website' || targetZone === 'other-app')) {
      violations.push(
        `${repoRelPath}:${t.line} imports ${t.spec} — apps/desktop must not import another application's internals`,
      );
    }
    if (
      zone === 'package' &&
      (targetZone === 'website' || targetZone === 'desktop' || targetZone === 'other-app')
    ) {
      violations.push(
        `${repoRelPath}:${t.line} imports ${t.spec} — packages must never import from apps (shared code is a leaf)`,
      );
    }
  }
  return violations;
}

function collectSourceFiles(dir, root = ROOT, acc = []) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.astro') continue;
      collectSourceFiles(`${dir}/${entry.name}`, root, acc);
    } else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry.name)) {
      acc.push(`${dir}/${entry.name}`);
    }
  }
  return acc;
}

function collectPackageDirs(root = ROOT) {
  const dirs = [];
  let entries;
  try {
    entries = readdirSync(join(root, PACKAGE_GLOB), { withFileTypes: true });
  } catch {
    return dirs;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) dirs.push(`${PACKAGE_GLOB}/${entry.name}`);
  }
  return dirs;
}

export function auditWorkspaceDeps(root = ROOT) {
  const violations = [];
  const manifests = [
    'apps/website/package.json',
    'apps/desktop/package.json',
    ...collectPackageDirs(root).map((d) => `${d}/package.json`),
  ];
  for (const manifest of manifests) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    } catch {
      continue;
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [name, version] of Object.entries(deps)) {
      if (!String(version).startsWith('workspace:')) continue;
      const target = WORKSPACE_ALIASES.get(name);
      if (!target) continue;
      if (target.startsWith('apps/')) {
        violations.push(
          `${manifest} depends on ${name} — an app may not depend on another app (use packages/shared instead)`,
        );
      }
    }
  }
  return violations;
}

export function auditRepo(root = ROOT) {
  const violations = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of collectSourceFiles(dir, root)) {
      const text = readFileSync(join(root, file), 'utf8');
      violations.push(...auditFile(text, normalize(file), root));
    }
  }
  violations.push(...auditWorkspaceDeps(root));
  return violations;
}

if (process.argv[1]?.endsWith('import-boundaries.mjs')) {
  const violations = auditRepo();
  if (violations.length > 0) {
    console.error('Import-boundary violations:');
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      'Client code must never import another application or the future backend. ' +
        'Move shared code into packages/ — see docs/security/trust-boundaries.md §Import boundaries.',
    );
    process.exit(1);
  }
  console.log('Import boundaries: OK (no cross-app or backend imports).');
}
