#!/usr/bin/env node
/**
 * validate-license-boundary.mjs
 *
 * Enforces the mixed-license model:
 * - Open crates carry `license = "MIT OR Apache-2.0"` in Cargo.toml
 * - FSL crates carry `license.workspace = true` (→ FSL-1.1-MIT)
 * - No open crate depends (directly) on an FSL crate
 * - TypeScript packages carry FSL-1.1-MIT
 *
 * Exit 0 = all checks pass, exit 1 = violation found.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

const OPEN_CRATES = [
  'varve-core',
  'varve-colour',
  'varve-trace',
  'varve-layout',
  'varve-media',
  'varve-effects',
  'varve-upscale',
  'varve-bgremove',
];

const FSL_CRATES = ['varve-engine', 'varve-print', 'varve-bridge', 'varve-wasm', 'varve-sync'];

const OPEN_SET = new Set(OPEN_CRATES);
const FSL_SET = new Set(FSL_CRATES);
const _ALL_CRATES = new Set([...OPEN_CRATES, ...FSL_CRATES]);

let violations = 0;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  violations++;
}

function pass(msg) {
  console.log(`  OK: ${msg}`);
}

function parseCargoToml(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*=\s*(.+)$/);
    if (m) {
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      result[m[1]] = val;
    }
  }
  return result;
}

function parseDependencies(text) {
  const deps = [];
  let inDeps = false;
  let section = '';
  for (const line of text.split('\n')) {
    const sectionMatch = line.match(/^\[(.+)\]/);
    if (sectionMatch) {
      section = sectionMatch[1];
      inDeps = section === 'dependencies' || section.startsWith('dependencies.');
      continue;
    }
    if (inDeps) {
      const m = line.match(/^([\w-]+)\s*=\s*\{.*path\s*=\s*"([^"]+)"/);
      if (m) {
        deps.push({ name: m[1], path: m[2] });
      }
    }
  }
  return deps;
}

// --- Check Rust crates ---
console.log('\n=== Rust crate license checks ===');

for (const crate of [...OPEN_CRATES, ...FSL_CRATES]) {
  const cargoPath = join(ROOT, 'crates', crate, 'Cargo.toml');
  if (!existsSync(cargoPath)) {
    fail(`${crate}: Cargo.toml not found`);
    continue;
  }
  const text = readFileSync(cargoPath, 'utf-8');
  const pkg = parseCargoToml(text);

  if (OPEN_SET.has(crate)) {
    if (pkg.license === 'MIT OR Apache-2.0') {
      pass(`${crate}: license = "MIT OR Apache-2.0"`);
    } else {
      fail(`${crate}: expected "MIT OR Apache-2.0", got "${pkg.license ?? '(missing)'}"`);
    }
  } else if (FSL_SET.has(crate)) {
    if (pkg['license.workspace'] === 'true' || text.includes('license.workspace = true')) {
      pass(`${crate}: license.workspace = true (FSL-1.1-MIT)`);
    } else {
      fail(`${crate}: expected license.workspace = true, got "${pkg.license ?? '(missing)'}"`);
    }
  }
}

// --- Check open crate dependencies don't point to FSL crates ---
console.log('\n=== Open crate dependency direction ===');

for (const crate of OPEN_CRATES) {
  const cargoPath = join(ROOT, 'crates', crate, 'Cargo.toml');
  if (!existsSync(cargoPath)) continue;
  const text = readFileSync(cargoPath, 'utf-8');
  const deps = parseDependencies(text);

  for (const dep of deps) {
    // Resolve path dep relative to the crate directory
    const depCargoPath = resolve(join(ROOT, 'crates', crate), dep.path, 'Cargo.toml');
    if (existsSync(depCargoPath)) {
      const depText = readFileSync(depCargoPath, 'utf-8');
      const depPkg = parseCargoToml(depText);
      if (FSL_SET.has(depPkg.name)) {
        fail(`${crate}: depends on FSL crate ${depPkg.name} (${dep.path})`);
      } else if (OPEN_SET.has(depPkg.name)) {
        pass(`${crate}: depends on open crate ${depPkg.name}`);
      }
    }
  }
}

// --- Check workspace license ---
console.log('\n=== Workspace license ===');
const wsCargoPath = join(ROOT, 'Cargo.toml');
const wsText = readFileSync(wsCargoPath, 'utf-8');
const wsPkg = parseCargoToml(wsText);
if (wsPkg.license === 'FSL-1.1-MIT') {
  pass(`workspace: license = "FSL-1.1-MIT"`);
} else {
  fail(`workspace: expected FSL-1.1-MIT, got "${wsPkg.license}"`);
}

// --- Check TypeScript packages ---
console.log('\n=== TypeScript package license checks ===');

function checkPackageJson(dir) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  if (pkg.license !== 'FSL-1.1-MIT') {
    fail(`${pkgPath}: expected "FSL-1.1-MIT", got "${pkg.license}"`);
  } else {
    pass(`${pkg.name ?? pkgPath}: license = "FSL-1.1-MIT"`);
  }
}

// Root
checkPackageJson(ROOT);

// packages/
const pkgsDir = join(ROOT, 'packages');
if (existsSync(pkgsDir)) {
  for (const d of readdirSync(pkgsDir)) {
    checkPackageJson(join(pkgsDir, d));
  }
}

// apps/
const appsDir = join(ROOT, 'apps');
if (existsSync(appsDir)) {
  for (const d of readdirSync(appsDir)) {
    checkPackageJson(join(appsDir, d));
  }
}

// apps/desktop/public/wasm/
const wasmPkg = join(ROOT, 'apps', 'desktop', 'public', 'wasm', 'package.json');
if (existsSync(wasmPkg)) {
  checkPackageJson(join(ROOT, 'apps', 'desktop', 'public', 'wasm'));
}

// --- Summary ---
console.log(`\n${violations === 0 ? 'PASS' : 'FAIL'}: ${violations} violation(s) found.`);
process.exit(violations === 0 ? 0 : 1);
