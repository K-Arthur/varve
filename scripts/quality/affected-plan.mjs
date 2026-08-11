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

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMPACT_CONFIG } from '../../validation-impact.config.mjs';

const ROOT = process.cwd();
const _PKGS = join(ROOT, 'packages');

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

function gitChangedFiles({ base, staged }) {
  if (staged) {
    return (run('git diff --cached --name-only --diff-filter=ACDMRTUXB') ?? '')
      .split('\n')
      .filter(Boolean);
  }
  if (base) {
    const out = run(`git diff --name-only --diff-filter=ACDMRTUXB ${base}...HEAD`);
    const untracked = (run('git ls-files --others --exclude-standard') ?? '')
      .split('\n')
      .filter(Boolean);
    return [...new Set([...(out ?? '').split('\n').filter(Boolean), ...untracked])];
  }
  // uncommitted (staged + unstaged + untracked)
  const stagedFiles = (run('git diff --cached --name-only --diff-filter=ACDMRTUXB') ?? '')
    .split('\n')
    .filter(Boolean);
  const unstagedFiles = (run('git diff --name-only --diff-filter=ACDMRTUXB') ?? '')
    .split('\n')
    .filter(Boolean);
  const untracked = (run('git ls-files --others --exclude-standard') ?? '')
    .split('\n')
    .filter(Boolean);
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
  const mergeBase = run('git merge-base HEAD origin/master 2>/dev/null');
  if (mergeBase) return mergeBase;
  const mergeBaseLocal = run('git merge-base HEAD master 2>/dev/null');
  if (mergeBaseLocal) return mergeBaseLocal;
  const firstCommit = run('git rev-list --max-parents=0 HEAD 2>/dev/null | tail -1');
  if (firstCommit) return firstCommit;
  return null;
}

/** Load pnpm workspace package map: name -> { dir, deps, devDeps } */
function loadPackages() {
  const _manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const out = run('pnpm m ls --json --depth -1 2>/dev/null');
  const pkgs = {};
  if (out) {
    for (const p of JSON.parse(out)) {
      if (!p.name) continue;
      const dir = p.path.replace(`${ROOT}/`, '');
      let manifest2 = null;
      try {
        manifest2 = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf-8'));
      } catch {}
      pkgs[p.name] = {
        dir,
        deps: new Set(Object.keys(manifest2?.dependencies ?? {})),
        devDeps: new Set(Object.keys(manifest2?.devDependencies ?? {})),
        tests: countTests(dir),
      };
    }
  }
  // apps (workspace members but not packages/*)
  for (const app of ['apps/desktop', 'apps/website', 'apps/web']) {
    if (!existsSync(join(ROOT, app, 'package.json'))) continue;
    const m = JSON.parse(readFileSync(join(ROOT, app, 'package.json'), 'utf-8'));
    pkgs[m.name] = {
      dir: app,
      deps: new Set(Object.keys(m.dependencies ?? {})),
      devDeps: new Set(Object.keys(m.devDependencies ?? {})),
      tests: countTests(app),
    };
  }
  return pkgs;
}

function countTests(dir) {
  const base = join(ROOT, dir);
  if (!existsSync(base)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.worktrees') continue;
        walk(p);
      } else if (/\.(test|spec)\.(ts|tsx)$/.test(e.name)) n++;
    }
  };
  walk(base);
  return n;
}

/** Load Cargo workspace: crate name -> { dir, deps } */
function loadCrates() {
  const out = run('cargo metadata --format-version 1 --no-deps 2>/dev/null');
  if (!out) return {};
  const { packages } = JSON.parse(out);
  const crates = {};
  for (const p of packages) {
    const dir = p.manifest_path.replace(`${ROOT}/`, '').replace('/Cargo.toml', '');
    crates[p.name] = {
      dir,
      deps: new Set(p.dependencies.map((d) => d.name)),
    };
  }
  return crates;
}

function matchesGlob(path, glob) {
  // simple glob: **/ prefix/suffix, * within segments
  const seg = glob.split('/');
  const pseg = path.split('/');
  if (seg.some((s) => s === '**')) {
    // anchor on first non-** segment
    const i = seg.findIndex((s) => s !== '**');
    if (i === -1) return true;
    const needle = seg.slice(i).filter((s) => s !== '**');
    if (needle.some((s) => s.includes('*'))) {
      // fall back to regex for wildcard segments
      const re = new RegExp(
        glob
          .replace(/\./g, '\\.')
          .replace(/\*\*\//g, '(?:.*/)?')
          .replace(/\*/g, '[^/]*'),
      );
      return re.test(path);
    }
    return pseg.join('/').endsWith(needle.join('/')) || pseg.join('/').includes(needle.join('/'));
  }
  const re = new RegExp(
    `^${glob.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`,
  );
  return re.test(path);
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
  };

  const changedPkgs = new Set();
  const changedCrates = new Set();
  const directTestFiles = new Set();
  const e2eDomains = new Set();
  const benchDomains = new Set();
  const audits = new Set();
  const riskFlags = [];

  const fullEscalation = IMPACT_CONFIG.fullEscalationPaths.some((g) =>
    files.some((f) => matchesGlob(f, g)),
  );
  const sharedContract = IMPACT_CONFIG.sharedContractPaths.some((g) =>
    files.some((f) => matchesGlob(f, g)),
  );

  for (const f of files) {
    if (f.startsWith('.worktrees/')) continue;
    const c = classifyFile(f, pkgs, crates);
    plan.changed[c.kind].push(f);
    if (c.kind === 'js') changedPkgs.add(c.name);
    if (c.kind === 'rust') changedCrates.add(c.name);
    if (c.kind === 'app') changedPkgs.add(c.name);

    // direct related test: source colocated test, or the test itself
    if (/\.(test|spec)\.(ts|tsx)$/.test(f)) {
      if (f.includes('/tests/e2e/')) {
        if (f.startsWith('apps/website/')) {
          plan.tiers[4].push('website-e2e');
        } else {
          const dom = e2eDomainFor(f);
          if (dom) e2eDomains.add(dom);
        }
      } else if (f.startsWith('tests/e2e/')) {
        const dom = e2eDomainFor(f);
        if (dom) e2eDomains.add(dom);
        directTestFiles.add(f);
      } else {
        directTestFiles.add(f);
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
          if (lane.startsWith('e2e:')) e2eDomains.add(lane.slice(4));
          else if (lane.startsWith('bench:')) benchDomains.add(lane.slice(6));
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
  for (const f of [...directTestFiles]) {
    if (f.startsWith('tests/e2e/')) continue;
    plan.tiers[1].push(`js-unit:file:${f}`);
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
  };

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
  }
  return lines.join('\n');
}

// ── main ───────────────────────────────────────────────────────────────────

export { buildPlan, defaultScope, formatPlan, gitBaseFor, gitChangedFiles };

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
