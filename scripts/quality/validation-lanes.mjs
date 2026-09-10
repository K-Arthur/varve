/**
 * Validation lane registry — the canonical mapping from lane id to the
 * shell command(s) that execute it.
 *
 * The planner (scripts/quality/affected-plan.mjs) selects lanes; this
 * module is the single place that resolves a lane to commands. The
 * policy test (tests/unit/validationPolicy.test.ts) asserts every lane
 * referenced by validation-impact.config.mjs exists here.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function canonicalPath(value) {
  return String(value).replaceAll('\\', '/');
}

export function toWorkspaceRelativePath(rootValue, filePath) {
  const root = canonicalPath(rootValue).replace(/\/+$/, '');
  const path = canonicalPath(filePath);
  const prefix = `${root}/`;
  if (path.toLowerCase().startsWith(prefix.toLowerCase())) {
    return path.slice(prefix.length);
  }
  return path;
}

export const LANES = {
  // ── Push-history policy (dependency-free, exact-ref validation) ────────
  'history:secrets': 'node scripts/quality/history-policy.mjs --secrets',
  'history:policy': 'node scripts/quality/history-policy.mjs --metadata',
  'format:changed': 'biome format <net-changed-files>',
  'lint:changed': 'biome check <net-changed-files>',
  'pipeline-validate': 'node scripts/quality/ci-plan.mjs --validate-output',
  'workflow-validate': 'node scripts/validate-workflows.mjs',
  'action-pins': 'node scripts/pin-github-actions.mjs --check',
  'security-policy': 'node scripts/security/workflow-policy.mjs',
  'release-version': 'node scripts/release/version.mjs verify',
  'product-truth': 'node scripts/release/verify-product-truth.mjs',

  // ── Tier 0: changed-file checks ──────────────────────────────────────
  'format:touched': 'biome format --staged --no-errors-on-unmatched',
  'lint:touched': 'biome check --staged --no-errors-on-unmatched',
  'lint:all': 'biome check .',
  'audit:docs': 'pnpm audit:docs',
  'audit:emoji': 'pnpm audit:emoji',
  'audit:tokens': 'pnpm audit:tokens',
  'audit:health': 'node scripts/audit-health.mjs',
  'audit:architecture': 'node scripts/audit-architecture.mjs --ci',
  'audit:typecheck-regression': 'node scripts/audit-typecheck-regression.mjs',
  'cargo-fmt': 'cargo fmt --all -- --check',

  // ── Tier 1: direct related tests ─────────────────────────────────────
  'js-unit:all': 'pnpm exec vitest run',
  'typecheck:all': 'pnpm typecheck',
  'typecheck:e2e': 'pnpm typecheck:e2e',

  // ── Tier 2/3: package-scoped (filled in dynamically per package) ─────
  // js-unit:<pkg>        -> vitest run packages/<dir>
  // typecheck:<pkg>      -> pnpm --filter <name> typecheck
  // rust-test:<crate>    -> cargo test -p <crate>
  // rust-clippy:<crate>  -> cargo clippy -p <crate> --all-targets -- -D warnings

  // ── Tier 4: domain integration ───────────────────────────────────────
  'e2e:visual': 'pnpm e2e:visual',
  'e2e:all': 'pnpm e2e:all',
  'desktop-native': 'pnpm test:desktop:native',
  'website-unit': 'pnpm test:website',
  'website-e2e': 'pnpm test:website:e2e',
  'bench:render': 'pnpm bench:canvas',
  wasm: 'just wasm-check',
  models: 'node scripts/models/validate-manifest.mjs',
  'ci-tools': 'pnpm test:ci:tools',
  policy: 'pnpm exec vitest run tests/unit/validationPolicy.test.ts',
};

/** Bench domain → exact bench script (risk-triggered only). */
export const BENCH_LANES = {
  render: 'pnpm bench:canvas',
  table: 'pnpm bench:table',
  'table-layout': 'pnpm bench:table-layout',
};

/** Heavy lanes: guarded by the heavy-task lease (see verify.mjs). */
export const HEAVY_LANES = new Set([
  'js-unit:all',
  'typecheck:all',
  'e2e:visual',
  'e2e:all',
  'desktop-native',
  'website-e2e',
  'rust-test:all',
  'rust-clippy:all',
  'bench:render',
  'bench:table',
  'bench:table-layout',
  'wasm',
  'full',
]);

export function laneCommand(lane, pkgDir) {
  if (lane === 'typecheck:e2e') return LANES[lane];
  if (lane.startsWith('js-unit:') && !lane.endsWith(':all')) {
    const name = lane.slice('js-unit:'.length);
    ensurePackageDirs();
    const dir = pkgDir || packageDirs[name];
    return dir ? `pnpm exec vitest run ${dir}` : undefined;
  }
  if (lane.startsWith('typecheck:') && !lane.endsWith(':all')) {
    const name = lane.slice('typecheck:'.length);
    if (!pkgDir && !packageDirs[name]) return null;
    return `pnpm --filter ${name} typecheck`;
  }
  if (lane.startsWith('rust-test:') && !lane.endsWith(':all')) {
    return `cargo test -p ${lane.slice('rust-test:'.length)}`;
  }
  if (lane.startsWith('rust-clippy:') && !lane.endsWith(':all')) {
    return `cargo clippy -p ${lane.slice('rust-clippy:'.length)} --all-targets -- -D warnings`;
  }
  return LANES[lane];
}

/**
 * Array form of the registry.  New orchestration code must use this instead
 * of passing a lane-derived string through a shell.  laneCommand remains as a
 * compatibility/display API for the older affected executor and its tests.
 */
export function laneArgv(lane, { files = [], pkgDir } = {}) {
  if (lane === 'history:secrets')
    return ['node', 'scripts/quality/history-policy.mjs', '--secrets'];
  if (lane === 'history:policy')
    return ['node', 'scripts/quality/history-policy.mjs', '--metadata'];
  if (lane === 'pipeline-validate')
    return ['node', 'scripts/quality/ci-plan.mjs', '--validate-output'];
  if (lane === 'workflow-validate') return ['node', 'scripts/validate-workflows.mjs'];
  if (lane === 'action-pins') return ['node', 'scripts/pin-github-actions.mjs', '--check'];
  if (lane === 'security-policy') return ['node', 'scripts/security/workflow-policy.mjs'];
  if (lane === 'release-version') return ['node', 'scripts/release/version.mjs', 'verify'];
  if (lane === 'product-truth') return ['node', 'scripts/release/verify-product-truth.mjs'];
  if (lane === 'typecheck:e2e') return ['pnpm', 'typecheck:e2e'];
  if (lane === 'format:changed') return ['biome', 'format', ...files];
  if (lane === 'lint:changed') return ['biome', 'check', ...files];
  if (lane.startsWith('js-unit:file:')) {
    return ['pnpm', 'exec', 'vitest', 'run', lane.slice('js-unit:file:'.length)];
  }
  if (lane.startsWith('e2e:file:')) {
    return ['pnpm', 'exec', 'playwright', 'test', lane.slice('e2e:file:'.length)];
  }
  if (lane.startsWith('js-unit:') && !lane.endsWith(':all')) {
    const name = lane.slice('js-unit:'.length);
    ensurePackageDirs();
    const dir = pkgDir || packageDirs[name];
    return dir ? ['pnpm', 'exec', 'vitest', 'run', dir] : null;
  }
  if (lane.startsWith('typecheck:') && !lane.endsWith(':all')) {
    const name = lane.slice('typecheck:'.length);
    if (!pkgDir && !packageDirs[name]) return null;
    return ['pnpm', '--filter', name, 'typecheck'];
  }
  if (lane.startsWith('rust-test:') && !lane.endsWith(':all')) {
    return ['cargo', 'test', '-p', lane.slice('rust-test:'.length)];
  }
  if (lane.startsWith('rust-clippy:') && !lane.endsWith(':all')) {
    return [
      'cargo',
      'clippy',
      '-p',
      lane.slice('rust-clippy:'.length),
      '--all-targets',
      '--',
      '-D',
      'warnings',
    ];
  }
  const staticArgv = {
    policy: ['pnpm', 'exec', 'vitest', 'run', 'tests/unit/validationPolicy.test.ts'],
    'typecheck:e2e': ['pnpm', 'typecheck:e2e'],
    'js-unit:all': ['pnpm', 'exec', 'vitest', 'run'],
    'typecheck:all': ['pnpm', 'typecheck'],
    'rust-test:all': ['cargo', 'test', '--workspace', '--all-targets'],
    'rust-clippy:all': ['cargo', 'clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'],
    'cargo-fmt': ['cargo', 'fmt', '--all', '--', '--check'],
    'workflow-validate': ['node', 'scripts/validate-workflows.mjs'],
    'action-pins': ['node', 'scripts/pin-github-actions.mjs', '--check'],
    'security-policy': ['node', 'scripts/security/workflow-policy.mjs'],
    'release-version': ['node', 'scripts/release/version.mjs', 'verify'],
    'product-truth': ['node', 'scripts/release/verify-product-truth.mjs'],
    'e2e:all': ['pnpm', 'exec', 'playwright', 'test'],
    'e2e:visual': [
      'pnpm',
      'exec',
      'playwright',
      'test',
      '--project=chromium-visual-1x',
      '--project=chromium-visual-2x',
    ],
    'desktop-native': ['pnpm', 'test:desktop:native'],
    'website-unit': ['pnpm', 'test:website'],
    'website-e2e': ['pnpm', 'test:website:e2e'],
    'bench:render': ['pnpm', 'bench:canvas'],
    'bench:table': ['pnpm', 'bench:table'],
    'bench:table-layout': ['pnpm', 'bench:table-layout'],
    wasm: ['just', 'wasm-check'],
    models: ['node', 'scripts/models/validate-manifest.mjs'],
    'ci-tools': ['pnpm', 'test:ci:tools'],
    'audit:docs': ['pnpm', 'audit:docs'],
    'audit:emoji': ['pnpm', 'audit:emoji'],
    'audit:tokens': ['pnpm', 'audit:tokens'],
    'audit:health': ['node', 'scripts/audit-health.mjs'],
    'audit:architecture': ['node', 'scripts/audit-architecture.mjs', '--ci'],
    'audit:typecheck-regression': ['node', 'scripts/audit-typecheck-regression.mjs'],
    'lint:all': ['biome', 'check', '.'],
  };
  return staticArgv[lane] ?? null;
}

export const packageDirs = {};

let packageDirsLoaded = false;

/**
 * Lazily resolve workspace package name -> workspace-relative directory
 * (mirrors the planner's `pnpm m ls --json` enumeration so the runner and
 * the planner agree on package-scoped lanes).
 */
function ensurePackageDirs() {
  if (packageDirsLoaded) return;
  packageDirsLoaded = true;
  try {
    const out = execSync('pnpm m ls --json --depth -1', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const p of JSON.parse(out)) {
      if (!p.name || !p.path) continue;
      packageDirs[p.name] = toWorkspaceRelativePath(ROOT, p.path);
    }
  } catch {
    // Fall back to the workspace apps when pnpm listing is unavailable.
    for (const app of ['apps/desktop', 'apps/website']) {
      const manifestPath = join(ROOT, app, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (m.name) packageDirs[m.name] = app;
    }
  }
}
