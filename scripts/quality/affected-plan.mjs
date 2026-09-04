#!/usr/bin/env node
/**
 * Varve affected-validation planner.
 *
 * Inspects repository changes (worktree, staged, or between two refs),
 * classifies impact by package/crate/dependency graph, and emits a
 * validation plan with explicit tiers, lanes, skipped domains, and
 * full-suite escalation decisions.
 *
 * Usage:
 *   pnpm verify:plan                      # uncommitted changes (staged+unstaged)
 *   pnpm verify:plan --staged             # staged changes only
 *   pnpm verify:plan --since origin/master
 *   pnpm verify:plan --json               # machine-readable plan
 *   pnpm verify:plan --no-reverse         # skip reverse-dependent closure
 *   node scripts/quality/affected-plan.mjs --help
 *
 * Exit codes: 0 = plan computed (even if empty), 1 = hard error.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { IMPACT_CONFIG } from '../../validation-impact.config.mjs';

const ROOT = process.cwd();
const _PKGS = join(ROOT, 'packages');

/**
 * Convert an absolute workspace path reported by pnpm/Cargo to the planner's
 * repository-relative POSIX form. Git paths and impact globs use `/` on every
 * runner, while package managers return the host-native separator on Windows.
 */
function toRepoRelativePath(rootValue, filePath, pathApi = { relative, sep }) {
  const root = String(rootValue).replaceAll('\\', '/').replace(/\/+$/, '');
  const path = String(filePath).replaceAll('\\', '/');
  const prefix = `${root}/`;
  if (path.toLowerCase().startsWith(prefix.toLowerCase())) {
    return path.slice(prefix.length);
  }
  return pathApi.relative(rootValue, filePath).split(pathApi.sep).join('/');
}

function repoRelativePath(filePath) {
  return toRepoRelativePath(ROOT, filePath);
}

// ── helpers ────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], ...opts })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function runGit(args, { raw = false, ...opts } = {}) {
  try {
    const output = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...opts,
    });
    return raw ? output : output.trim();
  } catch {
    return null;
  }
}

function gitPaths(args) {
  return (runGit([...args, '-z'], { raw: true }) ?? '').split('\0').filter(Boolean);
}

function resolvedCommit(ref) {
  return runGit(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
}

function gitChangedFiles({ base, staged }) {
  if (staged) {
    return gitPaths(['diff', '--cached', '--name-only', '--diff-filter=ACDMRTUXB']);
  }
  if (base) {
    const resolvedBase = resolvedCommit(base);
    const out = resolvedBase
      ? gitPaths(['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${resolvedBase}...HEAD`])
      : [];
    const untracked = gitPaths(['ls-files', '--others', '--exclude-standard']);
    return [...new Set([...out, ...untracked])];
  }
  // uncommitted (staged + unstaged + untracked)
  const stagedFiles = gitPaths(['diff', '--cached', '--name-only', '--diff-filter=ACDMRTUXB']);
  const unstagedFiles = gitPaths(['diff', '--name-only', '--diff-filter=ACDMRTUXB']);
  const untracked = gitPaths(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...stagedFiles, ...unstagedFiles, ...untracked])];
}

/**
 * Default base resolution: uncommitted changes when present (the agent's
 * current work), otherwise the merge-base against origin/master (or the
 * nearest available ref) so branch-scope work still gets a plan.
 */
function defaultScope() {
  const uncommitted = gitChangedFiles({ base: null, staged: false });
  if (uncommitted.length) return { files: uncommitted, base: null };
  const base = gitBaseFor({ since: null });
  if (!base) return { files: uncommitted, base: null };
  return { files: gitChangedFiles({ base, staged: false }), base };
}

function gitBaseFor({ since }) {
  if (since) return since;
  const mergeBase = runGit(['merge-base', 'HEAD', 'origin/master']);
  if (mergeBase) return mergeBase;
  const mergeBaseLocal = runGit(['merge-base', 'HEAD', 'master']);
  if (mergeBaseLocal) return mergeBaseLocal;
  const firstCommit = (runGit(['rev-list', '--max-parents=0', 'HEAD']) ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1);
  if (firstCommit) return firstCommit;
  return null;
}

/** Load pnpm workspace package map: name -> { dir, deps, devDeps } (cached per process) */
const _PKGS_CACHE = new Map();
function loadPackages() {
  if (_PKGS_CACHE.has('pkgs')) return _PKGS_CACHE.get('pkgs');
  const pkgs = {};
  // The plan job runs before dependency installation.  Discover manifests
  // directly first so CI classification does not depend on `pnpm m ls`, a
  // command that is both expensive and sensitive to a partially installed
  // workspace.  pnpm remains a fallback for unusual workspace layouts.
  const dirs = [];
  if (existsSync(_PKGS)) {
    for (const entry of readdirSync(_PKGS, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`packages/${entry.name}`);
    }
  }
  dirs.push('apps/desktop', 'apps/website', 'apps/web');
  for (const dir of dirs) {
    const manifestPath = join(ROOT, dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    let manifest2;
    try {
      manifest2 = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (!manifest2.name) continue;
    pkgs[manifest2.name] = {
      dir,
      deps: new Set(Object.keys(manifest2.dependencies ?? {})),
      devDeps: new Set(Object.keys(manifest2.devDependencies ?? {})),
      tests: countTests(dir),
    };
  }
  if (Object.keys(pkgs).length === 0) {
    const out = run('pnpm m ls --json --depth -1');
    if (out) {
      for (const p of JSON.parse(out)) {
        if (!p.name || !p.path) continue;
        const dir = repoRelativePath(p.path);
        pkgs[p.name] = { dir, deps: new Set(), devDeps: new Set(), tests: countTests(dir) };
      }
    }
  }
  _PKGS_CACHE.set('pkgs', pkgs);
  return pkgs;
}

const _TEST_COUNT_CACHE = new Map();

function countTests(dir) {
  if (_TEST_COUNT_CACHE.has(dir)) return _TEST_COUNT_CACHE.get(dir);
  const base = join(ROOT, dir);
  if (!existsSync(base)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (
          e.name === 'node_modules' ||
          e.name === 'dist' ||
          e.name === '.worktrees' ||
          e.name === 'target'
        ) {
          continue;
        }
        walk(p);
      } else if (/\.(test|spec)\.(ts|tsx)$/.test(e.name)) n++;
    }
  };
  walk(base);
  _TEST_COUNT_CACHE.set(dir, n);
  return n;
}

/** Load Cargo workspace: crate name -> { dir, deps } (cached per process) */
const _CRATES_CACHE = new Map();
function loadCrates() {
  if (_CRATES_CACHE.has('crates')) return _CRATES_CACHE.get('crates');
  const crates = {};
  const candidates = [];
  const cratesRoot = join(ROOT, 'crates');
  if (existsSync(cratesRoot)) {
    for (const entry of readdirSync(cratesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(`crates/${entry.name}`);
    }
  }
  candidates.push('apps/desktop/src-tauri');
  for (const dir of candidates) {
    const manifestPath = join(ROOT, dir, 'Cargo.toml');
    if (!existsSync(manifestPath)) continue;
    const source = readFileSync(manifestPath, 'utf8');
    const packageSection = source.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';
    const name = packageSection.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];
    if (!name) continue;
    const deps = new Set();
    const depsSection = source.match(/\[dependencies\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';
    for (const match of depsSection.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)) deps.add(match[1]);
    crates[name] = { dir, deps };
  }
  _CRATES_CACHE.set('crates', crates);
  return crates;
}

function matchesGlob(path, glob) {
  // Segment-aware glob: `*` stays within one path segment, while `**` spans
  // zero or more segments. Keeping matching out of RegExp also ensures that
  // path/config data can never become executable regular-expression syntax.
  const patternSegments = glob.split('/');
  const pathSegments = path.split('/');

  function matchSegment(value, pattern) {
    let valueIndex = 0;
    let patternIndex = 0;
    let starIndex = -1;
    let starValueIndex = 0;
    while (valueIndex < value.length) {
      if (patternIndex < pattern.length && pattern[patternIndex] === value[valueIndex]) {
        patternIndex += 1;
        valueIndex += 1;
      } else if (patternIndex < pattern.length && pattern[patternIndex] === '*') {
        starIndex = patternIndex;
        starValueIndex = valueIndex;
        patternIndex += 1;
      } else if (starIndex !== -1) {
        patternIndex = starIndex + 1;
        starValueIndex += 1;
        valueIndex = starValueIndex;
      } else {
        return false;
      }
    }
    while (patternIndex < pattern.length && pattern[patternIndex] === '*') patternIndex += 1;
    return patternIndex === pattern.length;
  }

  function matchSegments(patternIndex, pathIndex) {
    if (patternIndex === patternSegments.length) return pathIndex === pathSegments.length;
    if (patternSegments[patternIndex] === '**') {
      return (
        matchSegments(patternIndex + 1, pathIndex) ||
        (pathIndex < pathSegments.length && matchSegments(patternIndex, pathIndex + 1))
      );
    }
    return (
      pathIndex < pathSegments.length &&
      matchSegment(pathSegments[pathIndex], patternSegments[patternIndex]) &&
      matchSegments(patternIndex + 1, pathIndex + 1)
    );
  }

  return matchSegments(0, 0);
}

// ── classification ─────────────────────────────────────────────────────────

function classifyFile(path, pkgs, crates) {
  if (path.startsWith('packages/')) {
    const dir = path.split('/').slice(0, 2).join('/');
    for (const [name, p] of Object.entries(pkgs)) {
      if (p.dir === dir) return { kind: 'js', name, dir };
    }
  }
  if (path.startsWith('apps/')) {
    const dir = path.split('/').slice(0, 2).join('/');
    for (const [name, p] of Object.entries(pkgs)) {
      if (p.dir === dir) return { kind: 'js', name, dir };
    }
    return { kind: 'app', name: dir };
  }
  if (path.startsWith('crates/')) {
    const dir = path.split('/').slice(0, 2).join('/');
    for (const [name, c] of Object.entries(crates)) {
      if (c.dir === dir) return { kind: 'rust', name, dir };
    }
    return { kind: 'crate', name: dir };
  }
  return { kind: 'other', name: null };
}

function reverseDependents(pkgName, pkgs) {
  const direct = [];
  for (const [name, p] of Object.entries(pkgs)) {
    if (name === pkgName) continue;
    if (p.deps.has(pkgName) || p.devDeps.has(pkgName)) direct.push(name);
  }
  // transitive
  const seen = new Set([pkgName, ...direct]);
  const queue = [...direct];
  const transitive = new Set();
  while (queue.length) {
    const n = queue.shift();
    for (const [name, p] of Object.entries(pkgs)) {
      if (seen.has(name)) continue;
      if (p.deps.has(n) || p.devDeps.has(n)) {
        seen.add(name);
        transitive.add(name);
        queue.push(name);
      }
    }
  }
  return { direct, transitive: [...transitive] };
}

function crateReverseDependents(crateName, crates) {
  const direct = [];
  for (const [name, c] of Object.entries(crates)) {
    if (name === crateName) continue;
    if (c.deps.has(crateName)) direct.push(name);
  }
  const seen = new Set([crateName, ...direct]);
  const queue = [...direct];
  const transitive = new Set();
  while (queue.length) {
    const n = queue.shift();
    for (const [name, c] of Object.entries(crates)) {
      if (seen.has(name)) continue;
      if (c.deps.has(n)) {
        seen.add(name);
        transitive.add(name);
        queue.push(name);
      }
    }
  }
  return { direct, transitive: [...transitive] };
}

/** E2E domain for a changed test spec path. */
function e2eDomainFor(path) {
  const m = path.match(/^tests\/e2e\/([^/]+)\//);
  if (m) return m[1];
  if (path.startsWith('tests/e2e/') && /\.spec\.ts$/.test(path)) {
    return 'loose'; // top-level spec files: run individually
  }
  return null;
}

// ── plan construction ──────────────────────────────────────────────────────

function buildPlan(files, { includeReverse = true } = {}) {
  const pkgs = loadPackages();
  const crates = loadCrates();
  const plan = {
    tiers: { 0: [], 1: [], 2: [], 3: [], 4: [] },
    skipped: [],
    full: false,
    reasons: [],
    changed: { js: [], rust: [], other: [], app: [] },
    directTestFiles: [],
    directE2eFiles: [],
  };

  const changedPkgs = new Set();
  const changedCrates = new Set();
  const directTestFiles = new Set();
  const directE2eFiles = new Set();
  const e2eDomains = new Set();
  const benchDomains = new Set();
  const audits = new Set();
  const riskFlags = [];
  let e2eTypecheckRequired = files.some(
    (f) =>
      (f.startsWith('tests/e2e/') && /\.(ts|tsx|json)$/.test(f)) || f === 'playwright.config.ts',
  );

  const fullEscalation = IMPACT_CONFIG.fullEscalationPaths.some((g) =>
    files.some((f) => matchesGlob(f, g)),
  );
  const sharedContract = IMPACT_CONFIG.sharedContractPaths.some((g) =>
    files.some((f) => !/\.(test|spec)\.(ts|tsx)$/.test(f) && matchesGlob(f, g)),
  );

  for (const f of files) {
    if (f.startsWith('.worktrees/')) continue;
    const c = classifyFile(f, pkgs, crates);
    plan.changed[c.kind].push(f);
    const isTestFile = /\.(test|spec)\.(ts|tsx)$/.test(f);
    if (c.kind === 'js' && !isTestFile) changedPkgs.add(c.name);
    if (c.kind === 'rust') changedCrates.add(c.name);
    if (c.kind === 'app') changedPkgs.add(c.name);

    // direct related test: source colocated test, or the test itself
    if (/\.(test|spec)\.(ts|tsx)$/.test(f)) {
      if (f.startsWith('tests/e2e/')) {
        // A changed Playwright spec proves only its own declared workflow.
        // Keep it at Tier 1 instead of expanding to every spec in its
        // directory; renderer, config, and helper changes below retain
        // their domain/full-suite blast radius.
        directE2eFiles.add(f);
      } else if (f.includes('/tests/e2e/')) {
        if (f.startsWith('apps/website/')) plan.tiers[4].push('website-e2e');
        else {
          const dom = e2eDomainFor(f);
          if (dom) e2eDomains.add(dom);
        }
      } else {
        directTestFiles.add(f);
      }
    } else if (f.startsWith('tests/e2e/')) {
      // Shared E2E infrastructure can affect every browser workflow. A
      // domain-local helper is narrower, but still affects every spec in
      // that domain. This prevents a helper edit being mislabeled as a
      // direct-spec-only change.
      if (
        f === 'tests/e2e/shared.ts' ||
        f.startsWith('tests/e2e/helpers/') ||
        f.startsWith('tests/e2e/fixtures/')
      ) {
        e2eDomains.add('all');
      } else {
        const dom = e2eDomainFor(f);
        if (dom && dom !== 'loose') e2eDomains.add(dom);
      }
    } else if (c.kind === 'js' && !f.startsWith('tests/')) {
      // source file: sibling test file, or package tests
      const base = f.replace(/\.(ts|tsx)$/, '');
      const dir = base.split('/').slice(0, -1).join('/');
      const candidates = [
        `${base}.test.ts`,
        `${base}.test.tsx`,
        `${base}.spec.ts`,
        `${base}.spec.tsx`,
        `${dir}/__tests__/${base.split('/').pop()}.test.ts`,
        `${dir}/__tests__/${base.split('/').pop()}.test.tsx`,
      ];
      for (const cand of candidates) {
        if (existsSync(join(ROOT, cand))) directTestFiles.add(cand);
      }
    }

    // impact rules
    for (const rule of IMPACT_CONFIG.impactRules) {
      if (rule.paths.some((g) => matchesGlob(f, g))) {
        for (const lane of rule.require) {
          if (lane.startsWith('e2e:')) {
            e2eTypecheckRequired = true;
            e2eDomains.add(lane.slice(4));
          } else if (lane.startsWith('bench:')) benchDomains.add(lane.slice(6));
          else if (lane.startsWith('audit:')) audits.add(lane);
          else if (
            lane === 'policy' ||
            lane === 'ci-tools' ||
            lane === 'wasm' ||
            lane === 'models' ||
            lane === 'desktop-native' ||
            lane === 'website-unit' ||
            lane === 'website-e2e'
          ) {
            plan.tiers[4].push(lane);
          } else {
            riskFlags.push({ lane, rule: rule.id, path: f });
          }
        }
      }
    }
  }

  // Tier 0: always cheap checks on touched files
  plan.tiers[0].push('format:touched', 'lint:touched', 'audit:emoji');

  // dependency-upgrade risk
  for (const f of files) {
    if (f === 'pnpm-lock.yaml' || f === 'package.json') {
      for (const rule of IMPACT_CONFIG.dependencyUpgradeRules) {
        for (const p of rule.packages) {
          const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf-8');
          if (lock.includes(`'${p}'@`) || lock.includes(`/${p}@`) || lock.includes(` ${p}@`)) {
            riskFlags.push({ lane: `dep:${p}`, rule: `dependency-upgrade:${rule.risk}`, path: f });
            break;
          }
        }
      }
    }
  }

  // Tier 1: direct related test files
  // Playwright discovers TypeScript tests at runtime, so it does not catch
  // every source-level type error before opening a browser. Keep the E2E
  // compiler check in front of the exact changed spec (or the broadened
  // shared-harness suite) to make feedback both earlier and cheaper.
  if (e2eTypecheckRequired) plan.tiers[1].push('typecheck:e2e');
  for (const f of [...directTestFiles]) {
    if (f.startsWith('tests/e2e/')) continue;
    plan.tiers[1].push(`js-unit:file:${f}`);
  }
  for (const f of [...directE2eFiles]) {
    plan.tiers[1].push(`e2e:file:${f}`);
  }

  // Tier 2: changed packages
  for (const name of changedPkgs) {
    const p = pkgs[name];
    if (!p) continue;
    if (p.tests > 0) plan.tiers[2].push(`js-unit:${name}`);
    plan.tiers[2].push(`typecheck:${name}`);
  }

  // Tier 3: reverse dependents (only when public surface may have changed)
  if (includeReverse && !plan.full) {
    const dependents = new Set();
    for (const name of changedPkgs) {
      if (!pkgs[name]) continue;
      const rd = reverseDependents(name, pkgs);
      for (const d of [...rd.direct, ...rd.transitive]) dependents.add(d);
    }
    for (const d of dependents) {
      const p = pkgs[d];
      if (!p) continue;
      if (p.tests > 0) plan.tiers[3].push(`js-unit:${d}`);
      plan.tiers[3].push(`typecheck:${d}`);
    }
  }

  // Rust tiers
  for (const name of changedCrates) {
    const c = crates[name];
    if (!c) continue;
    plan.tiers[2].push(`rust-test:${name}`);
    plan.tiers[2].push(`rust-clippy:${name}`);
    const rd = crateReverseDependents(name, crates);
    for (const d of rd.direct) {
      plan.tiers[3].push(`rust-test:${d}`);
    }
    for (const d of rd.transitive) {
      plan.tiers[3].push(`rust-test:${d}`);
    }
  }

  // Tier 4: e2e domains
  for (const dom of e2eDomains) {
    if (dom === 'loose') continue;
    plan.tiers[4].push(`e2e:${dom}`);
  }
  for (const dom of benchDomains) {
    plan.tiers[4].push(`bench:${dom}`);
  }

  // audits triggered by config
  for (const a of audits) plan.tiers[0].push(a);
  if (files.some((f) => f.startsWith('docs/')) && !audits.has('audit:docs'))
    plan.tiers[0].push('audit:docs');

  // dedupe: keep each lane at its lowest tier
  const seen = new Set();
  for (let t = 0; t <= 4; t++) {
    const kept = [];
    for (const lane of plan.tiers[t]) {
      if (seen.has(lane)) continue;
      seen.add(lane);
      kept.push(lane);
    }
    plan.tiers[t] = kept;
  }

  // full escalation
  if (fullEscalation) {
    plan.full = true;
    plan.reasons.push(
      'workspace/toolchain/validation-infrastructure change — selection logic or every package contract may be affected',
    );
  } else if (sharedContract && plan.tiers[3].length === 0) {
    plan.full = true;
    plan.reasons.push(
      'shared contract surface changed (serialization, platform facade, engine IR) — reverse dependent closure computed, but full gate is safer',
    );
  }
  if (riskFlags.some((r) => r.rule.startsWith('dependency-upgrade:high'))) {
    plan.full = true;
    plan.reasons.push('high-risk dependency upgrade (framework/runtime/toolchain)');
  }

  // skip explanations
  if (plan.changed.rust.length === 0 && !plan.full) {
    plan.skipped.push('Rust workspace tests — no Rust/native dependency affected');
  }
  if (
    plan.changed.app.filter((f) => f.startsWith('apps/website')).length === 0 &&
    !plan.changed.js.some((f) => f.startsWith('apps/website'))
  ) {
    plan.skipped.push('website E2E — website unaffected');
  }
  if (![...e2eDomains].includes('visual') && !plan.full) {
    plan.skipped.push('full visual suite — no global rendering surface affected');
  }

  plan.stats = {
    files: files.length,
    jsPackages: [...changedPkgs],
    rustCrates: [...changedCrates],
    reverseDependents: includeReverse
      ? plan.tiers[3].filter((l) => l.startsWith('js-unit:')).length
      : 0,
    totalTestFiles: 0,
    selectedTestFiles: 0,
    selectedFraction: 0,
  };

  // Validation budget (soft metric): fraction of repository test files the
  // plan selects. A high fraction is an architectural signal (over-coupled
  // packages, overly broad impact rules, a shared utility becoming a
  // dependency hub), not a hard CI blocker across heterogeneous machines.
  plan.stats.totalTestFiles =
    Object.values(pkgs).reduce((n, p) => n + p.tests, 0) +
    countTests('tests/unit') +
    countTests('tests/e2e');
  const pkgDirByName = new Map(Object.entries(pkgs).map(([n, p]) => [n, p.dir]));
  let selectedTestFiles = 0;
  for (let t = 0; t <= 4; t++) {
    for (const lane of plan.tiers[t]) {
      if (lane.startsWith('js-unit:file:')) selectedTestFiles += 1;
      else if (lane.startsWith('e2e:file:')) selectedTestFiles += 1;
      else if (lane.startsWith('js-unit:')) {
        const name = lane.slice('js-unit:'.length);
        const dir = pkgDirByName.get(name);
        if (dir) selectedTestFiles += countTests(dir);
      } else if (lane.startsWith('e2e:')) {
        const dom = lane.slice('e2e:'.length);
        if (dom === 'all') selectedTestFiles += countTests('tests/e2e');
        else if (dom === 'visual') selectedTestFiles += countTests('tests/e2e/visual');
        else selectedTestFiles += countTests(`tests/e2e/${dom}`);
      } else if (lane === 'website-unit') {
        selectedTestFiles += countTests('apps/website/src/test');
      } else if (lane === 'website-e2e') {
        selectedTestFiles += countTests('apps/website/e2e') + countTests('apps/website/tests');
      }
    }
  }
  plan.stats.selectedTestFiles = selectedTestFiles;
  plan.stats.selectedFraction = plan.stats.totalTestFiles
    ? selectedTestFiles / plan.stats.totalTestFiles
    : 0;

  plan.directTestFiles = [...directTestFiles].sort();
  plan.directE2eFiles = [...directE2eFiles].sort();
  plan.e2eDomains = [...e2eDomains].sort();
  plan.benchDomains = [...benchDomains].sort();
  plan.riskFlags = riskFlags;
  plan.globalImpact = plan.full;
  plan.integrationRequired =
    plan.full || plan.tiers[2].length > 0 || plan.tiers[3].length > 0 || plan.tiers[4].length > 0;
  plan.releaseCandidateRequired =
    plan.full || plan.tiers[4].length > 0 || plan.changed.rust.length > 0;

  return plan;
}

// ── output ─────────────────────────────────────────────────────────────────

function formatPlan(plan, opts) {
  if (opts.json) {
    return JSON.stringify({ plan, opts }, null, 2);
  }
  const lines = [];
  lines.push(`Changed files: ${plan.stats.files}`);
  if (plan.stats.jsPackages.length) {
    lines.push(`Affected JS packages: ${plan.stats.jsPackages.join(', ')}`);
  }
  if (plan.stats.rustCrates.length) {
    lines.push(`Affected Rust crates: ${plan.stats.rustCrates.join(', ')}`);
  }
  if (plan.stats.jsPackages.length === 0 && plan.stats.rustCrates.length === 0) {
    lines.push('Affected packages/crates: none');
  }
  lines.push('');
  lines.push('Validation plan:');
  for (let t = 0; t <= 4; t++) {
    const lanes = plan.tiers[t];
    if (!lanes.length) continue;
    lines.push(`Tier ${t}`);
    for (const l of lanes) lines.push(`  ${l}`);
  }
  if (plan.full) {
    lines.push('');
    lines.push('FULL-SUITE ESCALATION: YES');
    for (const r of plan.reasons) lines.push(`  reason: ${r}`);
  } else {
    lines.push('');
    lines.push('Full-suite escalation: NO');
    if (plan.skipped.length) {
      lines.push('Skipped (deliberate):');
      for (const s of plan.skipped) lines.push(`  ${s}`);
    }
    if (plan.stats.selectedFraction > 0.74) {
      lines.push('');
      lines.push(
        `WARNING: affected selection covers ${(plan.stats.selectedFraction * 100).toFixed(0)}% ` +
          `of repository test files (${plan.stats.selectedTestFiles}/${plan.stats.totalTestFiles}).`,
      );
      lines.push(
        '  Investigate: is a package too highly coupled? Are impact rules too broad? ' +
          'Did a shared utility become a dependency hub?',
      );
    }
  }
  return lines.join('\n');
}

// ── main ───────────────────────────────────────────────────────────────────

export {
  buildPlan,
  defaultScope,
  formatPlan,
  gitBaseFor,
  gitChangedFiles,
  loadPackages,
  toRepoRelativePath,
};

export function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    staged: args.includes('--staged'),
    json: args.includes('--json'),
    noReverse: args.includes('--no-reverse'),
    since: null,
  };
  const sinceIdx = args.indexOf('--since');
  if (sinceIdx !== -1) opts.since = args[sinceIdx + 1];
  return opts;
}

export function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: pnpm verify:plan [--staged] [--since <ref>] [--json] [--no-reverse]`);
    process.exit(0);
  }
  const opts = parseArgs(['node', 'x', ...args]);
  let files;
  let base;
  if (opts.since) {
    base = opts.since;
    files = gitChangedFiles({ base, staged: false });
  } else if (opts.staged) {
    files = gitChangedFiles({ base: null, staged: true });
  } else {
    ({ files, base } = defaultScope());
  }
  if (!files.length) {
    console.log('No changed files detected.');
    process.exit(0);
  }
  const plan = buildPlan(files, { includeReverse: !opts.noReverse });
  console.log(formatPlan(plan, opts));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
