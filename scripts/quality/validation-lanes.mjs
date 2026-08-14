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

export const LANES = {
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

  // ── Tier 1: direct related tests ─────────────────────────────────────
  'js-unit:all': 'pnpm exec vitest run',
  'typecheck:all': 'pnpm typecheck',

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
  if (lane.startsWith('js-unit:') && !lane.endsWith(':all')) {
    const name = lane.slice('js-unit:'.length);
    ensurePackageDirs();
    const dir = pkgDir || packageDirs[name];
    return dir ? `pnpm exec vitest run ${dir}` : undefined;
  }
  if (lane.startsWith('typecheck:') && !lane.endsWith(':all')) {
    const name = lane.slice('typecheck:'.length);
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
      packageDirs[p.name] = p.path.startsWith(`${ROOT}/`) ? p.path.slice(ROOT.length + 1) : p.path;
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
