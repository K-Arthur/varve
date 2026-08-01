#!/usr/bin/env node
/**
 * Comprehensive architecture health audit for Strata.
 *
 * Checks:
 *   1. Dependency cycles (via madge)
 *   2. Module instability (Ce/Ca ratio)
 *   3. Cyclomatic complexity (via TS compiler API)
 *   4. Dead code / unused exports (via ts-prune)
 *   5. Layer boundary violations
 *   6. Hub-file import/line budgets (extends audit-health.mjs)
 *   7. Code duplication (via jscpd)
 *
 * Usage:
 *   node scripts/audit-architecture.mjs                  # full check
 *   node scripts/audit-architecture.mjs --cycles         # cycles only
 *   node scripts/audit-architecture.mjs --complexity     # complexity only
 *   node scripts/audit-architecture.mjs --dead-code      # dead code only
 *   node scripts/audit-architecture.mjs --layers         # layer violations only
 *   node scripts/audit-architecture.mjs --summary        # summary JSON
 *   node scripts/audit-architecture.mjs --update         # update baseline
 *   node scripts/audit-architecture.mjs --ci             # CI mode (fail on new issues)
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BASELINE_PATH = `${ROOT}.architecture-baseline.json`;
const args = process.argv.slice(2);
const RUN_ALL = args.length === 0 || args.includes('--all') || args.includes('--ci');
const RUN_CYCLES = RUN_ALL || args.includes('--cycles');
const RUN_COMPLEXITY = RUN_ALL || args.includes('--complexity');
const RUN_DEAD_CODE = RUN_ALL || args.includes('--dead-code');
const RUN_LAYERS = RUN_ALL || args.includes('--layers');
const RUN_SUMMARY = args.includes('--summary');
const UPDATE = args.includes('--update');
const CI_MODE = args.includes('--ci');

const require = createRequire(import.meta.url);

const errors = [];
const _warnings = [];

// ── Package map ──────────────────────────────────────────────────────
const PACKAGES = {
  shared: { path: 'packages/shared', entry: 'src/index.ts', layer: 1 },
  engine: { path: 'packages/engine', entry: 'src/index.ts', layer: 2 },
  scene: { path: 'packages/scene', entry: 'src/index.ts', layer: 3 },
  ui: { path: 'packages/ui', entry: 'src/index.ts', layer: 4 },
  compositor: { path: 'packages/compositor', entry: 'src/index.ts', layer: 3 },
  import: { path: 'packages/import', entry: 'src/index.ts', layer: 3 },
  prototype: { path: 'packages/prototype', entry: 'src/index.ts', layer: 3 },
  codegen: { path: 'packages/codegen', entry: 'src/index.ts', layer: 3 },
  layout: { path: 'packages/layout', entry: 'src/index.ts', layer: 3 },
  // The platform facade has no workspace dependencies and is consumed by the
  // engine for runtime capability detection, so it belongs with foundations.
  platform: { path: 'packages/platform', entry: 'src/index.ts', layer: 1 },
  help: { path: 'packages/help', entry: 'src/index.ts', layer: 3 },
  ai: { path: 'packages/ai', entry: 'src/index.ts', layer: 4 },
  collab: { path: 'packages/collab', entry: 'src/index.ts', layer: 4 },
  print: { path: 'packages/print', entry: 'src/index.ts', layer: 3 },
  home: { path: 'packages/home', entry: 'src/index.ts', layer: 5 },
  editor: { path: 'packages/editor', entry: 'src/index.ts', layer: 5 },
};

// ── Helpers ───────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, ...opts });
  } catch (e) {
    return e.stdout || '';
  }
}

function countLines(filePath) {
  try {
    const c = readFileSync(filePath, 'utf-8');
    return c.split('\n').length;
  } catch {
    return -1;
  }
}

function countImports(filePath) {
  try {
    const c = readFileSync(filePath, 'utf-8');
    const m = c.match(/^import\s/gm);
    return m ? m.length : 0;
  } catch {
    return -1;
  }
}

function formatBytes(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

// ── 1. Dependency Cycles ──────────────────────────────────────────────
async function checkCycles() {
  console.log('\n═══ 1. Dependency Cycles ═══');
  const results = {};

  for (const [name, pkg] of Object.entries(PACKAGES)) {
    const entryPath = `${ROOT}${pkg.path}/${pkg.entry}`;
    if (!existsSync(entryPath)) {
      console.log(`  ⏭ ${name}: no entry at ${pkg.entry}`);
      continue;
    }
    const out = run(
      `npx madge --circular --extensions ts,tsx --ts-config tsconfig.base.json --json --no-color --no-spinner "${entryPath}"`,
      { timeout: 120000 },
    );
    try {
      const cycles = JSON.parse(out.trim());
      if (Array.isArray(cycles) && cycles.length > 0) {
        const unique = new Set(cycles.map((c) => c.sort().join(' → ')));
        results[name] = { count: unique.size, cycles: [...unique] };
        console.log(`  ✖ ${name}: ${unique.size} cycle(s)`);
        for (const c of [...unique].slice(0, 5)) {
          console.log(`      ${c}`);
        }
        if (unique.size > 5) console.log(`      … and ${unique.size - 5} more`);
      } else {
        results[name] = { count: 0, cycles: [] };
        console.log(`  ✓ ${name}: clean`);
      }
    } catch {
      console.log(`  ⚠ ${name}: madge parse error`);
      results[name] = { count: -1, cycles: [] };
    }
  }

  return results;
}

// ── 2. Module Instability ─────────────────────────────────────────────
async function checkInstability() {
  console.log('\n═══ 2. Module Instability (I > 0.9) ═══');
  const results = {};

  for (const [name, pkg] of Object.entries(PACKAGES)) {
    const entryPath = `${ROOT}${pkg.path}/${pkg.entry}`;
    if (!existsSync(entryPath)) continue;

    const baseDir = path.dirname(entryPath);
    // Get module dependency graph via madge JSON
    const out = run(
      `npx madge --json --extensions ts,tsx --ts-config tsconfig.base.json --no-color --no-spinner "${entryPath}"`,
      { timeout: 120000 },
    );

    try {
      const graph = JSON.parse(out.trim());
      const unstable = [];

      for (const [mod, deps] of Object.entries(graph)) {
        // Count afferent couplings (Ca) — modules that depend on this one
        let ca = 0;
        for (const [otherMod, otherDeps] of Object.entries(graph)) {
          if (otherMod !== mod && otherDeps.includes(mod)) ca++;
        }
        // Count efferent couplings (Ce) — this module's outgoing deps within package
        const ce = deps.filter((d) => {
          const abs = path.resolve(baseDir, d);
          return abs.startsWith(baseDir);
        }).length;

        if (ce + ca > 0) {
          const instab = ce / (ce + ca);
          if (instab > 0.9) {
            unstable.push({ module: mod, instability: instab.toFixed(3), ce, ca });
          }
        }
      }

      if (unstable.length > 0) {
        results[name] = unstable;
        console.log(`  ✖ ${name}: ${unstable.length} unstable module(s)`);
        unstable.slice(0, 8).forEach((u) => {
          console.log(`    I=${u.instability}  Ce=${u.ce} Ca=${u.ca}  ${u.module}`);
        });
        if (unstable.length > 8) console.log(`    … and ${unstable.length - 8} more`);
      } else {
        results[name] = [];
        console.log(`  ✓ ${name}: all stable`);
      }
    } catch (e) {
      console.log(`  ⚠ ${name}: instability parse error: ${e.message}`);
      results[name] = [];
    }
  }

  return results;
}

// ── 3. Cyclomatic Complexity ─────────────────────────────────────────
async function checkComplexity() {
  console.log('\n═══ 3. Cyclomatic Complexity ═══');

  const ts = require('typescript');

  function computeComplexity(sourceFile) {
    let complexity = 0;
    function visit(node) {
      switch (node.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.CaseClause:
        case ts.SyntaxKind.CatchClause:
        case ts.SyntaxKind.ConditionalExpression:
          complexity++;
          break;
        case ts.SyntaxKind.BinaryExpression:
          if (
            node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          ) {
            complexity++;
          }
          break;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return complexity + 1; // +1 for the base path
  }

  const results = {};

  for (const [name, pkg] of Object.entries(PACKAGES)) {
    const srcDir = `${ROOT}${pkg.path}/src`;
    if (!existsSync(srcDir)) continue;

    const allFiles = [];
    function walk(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('__') && entry.name !== 'node_modules') {
          walk(p);
        } else if (
          entry.isFile() &&
          /\.(ts|tsx)$/.test(entry.name) &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx') &&
          !entry.name.endsWith('.d.ts') &&
          !entry.name.endsWith('.spec.ts')
        ) {
          allFiles.push(p);
        }
      }
    }
    walk(srcDir);

    const program = ts.createProgram(allFiles, { noEmit: true, skipLibCheck: true });
    const _checker = program.getTypeChecker();
    const fileComplexities = [];

    for (const file of allFiles) {
      const sourceFile = program.getSourceFile(file);
      if (!sourceFile) continue;
      const relativePath = path.relative(srcDir, file);
      // Skip test files
      if (relativePath.includes('__tests__') || relativePath.includes('.test.')) continue;

      const total = computeComplexity(sourceFile);
      fileComplexities.push({ file: relativePath, complexity: total });
    }

    fileComplexities.sort((a, b) => b.complexity - a.complexity);

    const avg =
      fileComplexities.reduce((s, f) => s + f.complexity, 0) / (fileComplexities.length || 1);
    const top5 = fileComplexities.slice(0, 5);

    results[name] = {
      files: fileComplexities.length,
      average: avg,
      max: fileComplexities.length > 0 ? fileComplexities[0].complexity : 0,
      top5,
    };

    console.log(
      `  ${name}: avg ${avg.toFixed(1)}, max ${results[name].max}, files ${fileComplexities.length}`,
    );
    top5.forEach((f) => {
      console.log(`    ${f.complexity}  ${f.file}`);
    });
  }

  return results;
}

// ── 4. Dead Code / Unused Exports ─────────────────────────────────────
async function checkDeadCode() {
  console.log('\n═══ 4. Dead Code / Unused Exports ═══');

  const results = {};

  for (const [name, pkg] of Object.entries(PACKAGES)) {
    const pkgDir = `${ROOT}${pkg.path}`;
    const tsconfigPath = `${pkgDir}/tsconfig.json`;
    if (!existsSync(tsconfigPath)) {
      console.log(`  ⏭ ${name}: no tsconfig.json`);
      continue;
    }

    // Use relative path from ROOT; npx ts-prune resolves extends relative to -p location
    const relTsconfig = `${pkg.path}/tsconfig.json`;
    const out = run(
      `npx ts-prune -p "${relTsconfig}" -e "(node_modules|__tests__|.test.|.d.ts|.spec.)" 2>/dev/null`,
      { timeout: 60000 },
    );

    const lines = out
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    const unused = [];

    for (const line of lines) {
      // Format: "path/file.ts:1 - someExport"  or "path/file.ts:1: someExport"
      const match = line.match(/^(.+?\.(?:ts|tsx)):\d+(?::| - ) (.+)$/);
      if (match) {
        const filePath = match[1];
        const symbol = match[2];
        if (filePath.includes('node_modules')) continue;
        unused.push({ file: filePath, symbol });
      }
    }

    if (unused.length > 0) {
      results[name] = unused;
      console.log(`  ✖ ${name}: ${unused.length} unused export(s)`);
      unused.slice(0, 10).forEach((u) => {
        console.log(`    ${u.file}: ${u.symbol}`);
      });
      if (unused.length > 10) console.log(`    … and ${unused.length - 10} more`);
    } else {
      results[name] = [];
      console.log(`  ✓ ${name}: clean`);
    }
  }

  return results;
}

// ── 5. Layer Boundary Violations ──────────────────────────────────────
async function checkLayers() {
  console.log('\n═══ 5. Layer Boundary Violations ═══');

  // Allowed layer dependencies: lower layers can't import higher layers
  const _layerNames = {
    1: 'shared',
    2: 'engine',
    3: 'scene/compositor/import/prototype/codegen/layout/platform/help/print',
    4: 'ui/ai/collab',
    5: 'editor/home',
  };

  const packageJsonCache = {};
  function getPackageDeps(pkgName) {
    if (packageJsonCache[pkgName]) return packageJsonCache[pkgName];
    const pkgPath = `${ROOT}${PACKAGES[pkgName]?.path}/package.json`;
    try {
      const json = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...json.dependencies, ...json.devDependencies };
      const wsDeps = Object.entries(allDeps)
        .filter(([, v]) => v.startsWith('workspace:'))
        .map(([k]) => k);
      packageJsonCache[pkgName] = wsDeps;
      return wsDeps;
    } catch {
      return [];
    }
  }

  const violations = [];

  for (const [name, pkg] of Object.entries(PACKAGES)) {
    const myLayer = pkg.layer;
    const deps = getPackageDeps(name);

    for (const dep of deps) {
      const depPkgName = dep.replace('@strata/', '');
      const depPkg = PACKAGES[depPkgName];
      if (!depPkg) continue;

      const depLayer = depPkg.layer;
      if (depLayer > myLayer) {
        violations.push({
          from: name,
          to: depPkgName,
          fromLayer: myLayer,
          toLayer: depLayer,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.log(`  ✖ ${violations.length} layer violation(s):`);
    violations.forEach((v) => {
      console.log(`    ${v.from} (L${v.fromLayer}) → ${v.to} (L${v.toLayer}) [higher layer!]`);
    });
  } else {
    console.log('  ✓ No layer violations');
  }

  return violations;
}

// ── 5b. Scene Type-Only Edge Ratchet ────────────────────────────────────
// A handful of packages/scene files (and one in editor) have an import that's
// only harmless because it's type-only (erased at compile time under
// verbatimModuleSyntax) -- full classification in docs/quality/cycles.md and
// docs/quality/scene-cycle-report.md. madge (checkCycles above) can't tell
// type-only from value edges at all, so the general cycle ratchet can't catch
// "an already-allowlisted cycle's type-only edge quietly became a real value
// edge." This is that narrower, sharper check: these specific edges must stay
// type-only, full stop, or an allowlisted harmless cycle becomes a real one.
const TYPE_ONLY_EDGES = [
  { file: 'packages/scene/src/adjustmentScope.ts', from: './document' },
  { file: 'packages/scene/src/bindings.ts', from: './types' },
  { file: 'packages/scene/src/component-sync.ts', from: './document' },
  { file: 'packages/scene/src/component-sync.ts', from: './types' },
  { file: 'packages/scene/src/typography.ts', from: './document' },
  { file: 'packages/scene/src/typography.ts', from: './types' },
  { file: 'packages/scene/src/suppressions.ts', from: './auditFinding' },
];

function checkTypeOnlyEdges() {
  console.log('\n═══ 5b. Scene Type-Only Edge Ratchet ═══');
  const violations = [];
  for (const { file, from } of TYPE_ONLY_EDGES) {
    const absPath = `${ROOT}${file}`;
    if (!existsSync(absPath)) continue;
    const src = readFileSync(absPath, 'utf-8');
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Matches both `import type { X } from '...'` and `import { X, type Y } from '...'`.
    const importRe = new RegExp(
      `import\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"]${escaped}['"]`,
      'g',
    );
    let found = false;
    for (const match of src.matchAll(importRe)) {
      found = true;
      if (match[1]) continue; // whole `import type {...}` statement -- fine
      const specifiers = match[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const valueSpecifiers = specifiers.filter((s) => !/^type\s/.test(s));
      if (valueSpecifiers.length > 0) {
        violations.push(
          `${file}: import from '${from}' has a real value specifier ` +
            `(${valueSpecifiers.join(', ')}) — this edge must stay type-only or it turns an ` +
            `allowlisted cycle into a real one (see docs/quality/cycles.md)`,
        );
      }
    }
    if (!found) {
      console.log(
        `  ⚠ ${file}: no import from '${from}' found — the edge may have been removed; ` +
          `update TYPE_ONLY_EDGES in this script`,
      );
    }
  }
  if (violations.length > 0) {
    console.log(`  ✖ ${violations.length} violation(s):`);
    for (const v of violations) console.log(`    ${v}`);
  } else {
    console.log('  ✓ all known type-only edges are still type-only');
  }
  return violations;
}

// ── 6. Hub File Budget Check ──────────────────────────────────────────
async function checkHubFiles() {
  console.log('\n═══ 6. Hub File Budget ═══');

  const hubFiles = {
    'packages/editor/src/Shell.tsx': { maxImports: 49 },
    'packages/editor/src/CanvasArea.tsx': { maxImports: 42 },
    'packages/editor/src/Menubar.tsx': { maxImports: 14 },
    'packages/home/src/HomeShell.tsx': { maxImports: 34 },
    'packages/editor/src/context.tsx': { maxImports: 65 },
  };

  const results = {};
  for (const [filePath, limits] of Object.entries(hubFiles)) {
    const absPath = `${ROOT}${filePath}`;
    const lines = countLines(absPath);
    const imports = countImports(absPath);

    const lineStatus = lines >= 0 ? `${lines} lines` : 'MISSING';
    const impStatus = imports >= 0 ? `${imports} imports` : 'MISSING';
    const impFlag = imports > limits.maxImports ? ' ⚠ OVER BUDGET' : '';
    console.log(`  ${filePath}: ${lineStatus}, ${impStatus}${impFlag}`);

    results[filePath] = { lines, imports, overBudget: imports > limits.maxImports };
  }

  return results;
}

// ── 7. Size Stats ────────────────────────────────────────────────────
async function checkSize() {
  console.log('\n═══ 7. Source Size Stats ═══');

  const results = {};
  for (const [name, pkg] of Object.entries(PACKAGES)) {
    const srcDir = `${ROOT}${pkg.path}/src`;
    if (!existsSync(srcDir)) continue;

    let totalBytes = 0;
    let totalLines = 0;
    let fileCount = 0;

    function walk(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          walk(p);
        } else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
          const stat = statSync(p);
          totalBytes += stat.size;
          totalLines += readFileSync(p, 'utf-8').split('\n').length;
          fileCount++;
        }
      }
    }
    walk(srcDir);
    results[name] = { files: fileCount, lines: totalLines, bytes: formatBytes(totalBytes) };
    console.log(
      `  ${name}: ${fileCount} files, ${totalLines.toLocaleString()} lines, ${results[name].bytes}`,
    );
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  Strata Architecture Health Audit');
  console.log(`  ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  console.log('══════════════════════════════════════════════════\n');

  const cycles = RUN_CYCLES ? await checkCycles() : {};
  const instability = RUN_CYCLES ? await checkInstability() : {};
  const complexity = RUN_COMPLEXITY ? await checkComplexity() : {};
  const deadCode = RUN_DEAD_CODE ? await checkDeadCode() : {};
  const violations = RUN_LAYERS ? await checkLayers() : [];
  const typeOnlyEdgeViolations = checkTypeOnlyEdges();
  errors.push(...typeOnlyEdgeViolations);
  const hubFiles = await checkHubFiles();
  const size = await checkSize();

  // ── Summary ──────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('══════════════════════════════════════════════════\n');

  let totalCycles = 0;
  for (const [name, data] of Object.entries(cycles)) {
    if (data.count > 0) console.log(`  ✖ Cycles (${name}): ${data.count}`);
    else if (data.count === 0) console.log(`  ✓ Cycles (${name}): clean`);
    else console.log(`  ⚠ Cycles (${name}): N/A`);
    if (data.count > 0) totalCycles += data.count;
  }
  console.log(`  Total distinct cycles: ${totalCycles}`);

  let totalUnstable = 0;
  for (const [name, data] of Object.entries(instability)) {
    if (data.length > 0) {
      console.log(`  ✖ Unstable modules (${name}): ${data.length}`);
      totalUnstable += data.length;
    } else {
      console.log(`  ✓ Unstable modules (${name}): clean`);
    }
  }

  for (const [name, data] of Object.entries(complexity)) {
    if (data.top5 && data.top5.length > 0) {
      console.log(
        `  Complexity (${name}): avg ${data.average.toFixed(1)}, max ${data.max} (files: ${data.files})`,
      );
    }
  }

  for (const [name, data] of Object.entries(deadCode)) {
    if (data.length > 0) {
      console.log(`  ✖ Unused exports (${name}): ${data.length}`);
    }
  }

  if (violations.length > 0) {
    console.log(`  ✖ Layer violations: ${violations.length}`);
  } else {
    console.log('  ✓ Layer violations: none');
  }

  for (const [filePath, data] of Object.entries(hubFiles)) {
    if (data.overBudget) {
      console.log(`  ✖ Budget over (${filePath}): imports=${data.imports}`);
    }
  }

  // ── Output as JSON for CI ───────────────────────────────────────
  const report = {
    timestamp: new Date().toISOString(),
    cycles,
    instability,
    complexity,
    deadCode,
    layerViolations: violations,
    hubFiles,
    size,
    summary: {
      totalCycles,
      totalUnstable,
      totalLayerViolations: violations.length,
      packages: Object.keys(PACKAGES).length,
    },
  };

  if (RUN_SUMMARY) {
    console.log(`\n${JSON.stringify(report, null, 2)}`);
  }

  // ── Baseline update ──────────────────────────────────────────────
  if (UPDATE) {
    const baseline = {
      version: new Date().toISOString().slice(0, 10),
      cycles,
      layerViolations: violations.map((v) => `${v.from}→${v.to}`),
      hubFiles,
      complexity: Object.fromEntries(
        Object.entries(complexity).map(([k, v]) => [
          k,
          { average: v.average, max: v.max, files: v.files },
        ]),
      ),
      global: {
        max_cycles: totalCycles + 2, // buffer
        max_unstable: totalUnstable + 5,
        max_layer_violations: violations.length,
        max_unused_exports: Object.values(deadCode).reduce((s, a) => s + a.length, 0) + 10,
      },
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`\naudit-architecture: baseline written to .architecture-baseline.json`);
  }

  // ── CI mode ─────────────────────────────────────────────────────
  if (CI_MODE && existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));

    // Check cycles by identity, not count. A count-only ratchet lets you fix
    // N allowlisted cycles and introduce N different (possibly worse, e.g.
    // value-only) cycles in the same package with no signal — see
    // docs/quality/cycles.md. Every cycle not already in the baseline's
    // per-package allowlist fails the build; cycles that disappear are
    // reported so the allowlist can be shrunk with --update.
    if (baseline.cycles) {
      for (const [name, bData] of Object.entries(baseline.cycles)) {
        const cData = cycles[name];
        if (!cData) continue;
        const allowed = new Set(bData.cycles || []);
        const current = new Set(cData.cycles || []);
        const newCycles = [...current].filter((c) => !allowed.has(c));
        const fixedCycles = [...allowed].filter((c) => !current.has(c));
        if (newCycles.length > 0) {
          errors.push(
            `CYCLE REGRESSION: ${name} — ${newCycles.length} new cycle(s) not in allowlist:\n` +
              newCycles.map((c) => `        + ${c}`).join('\n'),
          );
        }
        if (fixedCycles.length > 0) {
          console.log(
            `  ℹ ${name}: ${fixedCycles.length} allowlisted cycle(s) no longer present — ` +
              `run --update to shrink the allowlist:`,
          );
          for (const c of fixedCycles) console.log(`        - ${c}`);
        }
      }
    }

    // Check global thresholds
    if (baseline.global) {
      if (totalCycles > baseline.global.max_cycles) {
        errors.push(
          `CYCLE LIMIT: ${totalCycles} > ${baseline.global.max_cycles} (baseline max_cycles)`,
        );
      }
      if (violations.length > baseline.global.max_layer_violations) {
        errors.push(
          `LAYER VIOLATIONS: ${violations.length} > ${baseline.global.max_layer_violations}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error('\n❌ ARCHITECTURE AUDIT FAILED:');
    for (const err of errors) console.error(`  ${err}`);
    process.exit(1);
  }

  console.log('\n✓ Architecture audit complete');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
