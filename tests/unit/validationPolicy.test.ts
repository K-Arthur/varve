/**
 * Policy tests for the affected-validation system.
 *
 * These verify the INFRASTRUCTURE (not prose):
 *  - the planner exists and handles the documented fixture classes
 *  - impact config is not stale (glob matches, lane names)
 *  - AGENTS.md and docs reference affected validation
 *  - full gate remains available
 *  - every workspace package is discoverable
 *  - every declared validation lane resolves to a command
 *
 * The audit is intentionally semantic, not snapshot-based.
 */

import { execSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  loadPackages,
  toRepoRelativePath,
} from '../../scripts/quality/affected-plan.mjs';
import { auditImpactConfig } from '../../scripts/quality/audit-impact-config.mjs';
import {
  LANES,
  laneCommand,
  packageDirs,
  toWorkspaceRelativePath,
} from '../../scripts/quality/validation-lanes.mjs';
import { IMPACT_CONFIG } from '../../validation-impact.config.mjs';

const ROOT = process.cwd();

// Mirror what verify.mjs does before executing lanes: populate the shared
// package-dir map so laneCommand() can resolve js-unit:<pkg>/typecheck:<pkg>
// lanes to concrete commands.
for (const [name, p] of Object.entries(loadPackages())) {
  packageDirs[name] = p.dir;
}

function pnpmLs() {
  const out = execSync('pnpm m ls --json --depth -1', { encoding: 'utf8' });
  return JSON.parse(out);
}

// Reproduce verify.mjs's lane -> command resolution order so the executor's
// contract is tested without spawning anything.
function resolveLane(lane) {
  if (lane === 'format:touched' || lane === 'lint:touched') return 'biome (changed files)';
  if (lane.startsWith('js-unit:file:')) return 'vitest <file>';
  if (lane.startsWith('e2e:file:')) return 'playwright <file>';
  if (lane.startsWith('e2e:') && lane !== 'e2e:all' && lane !== 'e2e:visual')
    return 'playwright <domain paths>';
  if (lane.startsWith('bench:')) return 'pnpm bench:<domain>';
  return laneCommand(lane) ?? LANES[lane];
}

describe('validation infrastructure presence', () => {
  it('exposes the required commands in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    for (const script of [
      'verify:plan',
      'verify:quick',
      'verify:triage',
      'verify:affected',
      'verify:full',
      'e2e:visual',
    ]) {
      expect(pkg.scripts, `missing script ${script}`).toHaveProperty(script);
    }
  });

  it('keeps the full gate reachable via just', () => {
    const justfile = readFileSync(join(ROOT, 'justfile'), 'utf-8');
    expect(justfile).toMatch(/gate-full/);
  });

  it('AGENTS.md mandates affected-first validation', () => {
    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf-8');
    expect(agents).toMatch(/verify:plan/);
    expect(agents).toMatch(/affected-first|affected validation/i);
    expect(agents).toMatch(/Validation economy/i);
  });

  it('canonical strategy doc exists and documents tiers', () => {
    const doc = readFileSync(join(ROOT, 'docs/quality/validation-strategy.md'), 'utf-8');
    expect(doc).toMatch(/Tier 0/);
    expect(doc).toMatch(/Tier 5/);
    expect(doc).toMatch(/verify:affected/);
  });

  it('keeps triage useful when a later full gate is mandatory', () => {
    const verify = readFileSync(join(ROOT, 'scripts/quality/verify.mjs'), 'utf-8');
    expect(verify).toMatch(
      /mode === 'affected'\) \{\n\s*console\.log\('\\nEscalation to full gate/,
    );
    expect(verify).toMatch(/Final full gate required after triage\. Continuing/);
  });

  it('impact config parses and is not stale', () => {
    const { ok, errors } = auditImpactConfig();
    expect(errors, errors.join('\n')).toEqual([]);
    expect(ok).toBe(true);
  });

  it('every declared lane in the registry resolves to a command', () => {
    for (const [lane, cmd] of Object.entries(LANES)) {
      expect(cmd, `lane ${lane} has no command`).toBeTruthy();
    }
  });

  it('all workspace packages are discoverable', () => {
    const pkgs = pnpmLs()
      .map((p) => p.name)
      .filter(Boolean);
    const core = [
      '@varve/shared',
      '@varve/scene',
      '@varve/engine',
      '@varve/editor',
      '@varve/ui',
      '@varve/desktop',
      '@varve/website',
    ];
    for (const c of core) expect(pkgs).toContain(c);
  });

  it('pre-commit stays cheap (no full-suite commands)', () => {
    const hook = readFileSync(join(ROOT, '.githooks/pre-commit'), 'utf-8');
    expect(hook).not.toMatch(/vitest run(?! tests\/unit\/validationPolicy)/);
    expect(hook).not.toMatch(/playwright test/);
    expect(hook).not.toMatch(/cargo test --workspace/);
  });

  it('pre-push does not unconditionally force the full gate', () => {
    const hook = readFileSync(join(ROOT, '.githooks/pre-push'), 'utf-8');
    expect(hook).toMatch(/verify:affected|verify:quick/);
    expect(hook).toMatch(/VARVE_FULL_GATE/);
  });

  it('CI exposes a full-validation pathway', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toMatch(/workflow_dispatch/);
    expect(ci).toMatch(/schedule/);
  });

  it('worktrees are excluded from test discovery', () => {
    const vitest = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf-8');
    expect(vitest).toMatch(/\.worktrees/);
  });
});

describe('planner fixture classes', () => {
  it('uses shell-portable metadata commands on every runner', () => {
    const planner = readFileSync(join(ROOT, 'scripts/quality/affected-plan.mjs'), 'utf8');
    expect(planner).not.toContain('2>/dev/null');
    expect(planner).not.toMatch(/\|\s*tail\b/);
  });

  it('normalizes mixed Windows package-manager paths to POSIX repository paths', () => {
    const root = 'D:\\a\\varve\\varve';
    const pathApi = { relative: win32.relative, sep: win32.sep };

    expect(toRepoRelativePath(root, 'D:/a/varve/varve/packages/editor', pathApi)).toBe(
      'packages/editor',
    );
    expect(
      toRepoRelativePath(root, 'd:\\A\\VARVE\\VARVE\\crates\\varve-core\\Cargo.toml', pathApi),
    ).toBe('crates/varve-core/Cargo.toml');
  });

  it('leaf UI component -> UI tests + typecheck, no Rust', () => {
    const plan = buildPlan(['packages/ui/src/components/Select.tsx']);
    expect(plan.tiers[2]).toContain('js-unit:@varve/ui');
    expect(plan.tiers[2]).toContain('typecheck:@varve/ui');
    expect(plan.changed.rust).toHaveLength(0);
    expect(plan.full).toBe(false);
  });

  it('shared type change -> reverse dependents', () => {
    const plan = buildPlan(['packages/shared/src/product.ts']);
    const tier3 = [...plan.tiers[3], ...plan.tiers[2]];
    expect(tier3).toContain('js-unit:@varve/scene');
    expect(tier3).toContain('js-unit:@varve/ui');
  });

  it('Rust crate change -> crate tests + dependents', () => {
    const plan = buildPlan(['crates/varve-engine/src/lib.rs']);
    expect(plan.tiers[2]).toContain('rust-test:varve-engine');
    expect(plan.tiers[3].some((l) => l.startsWith('rust-test:'))).toBe(true);
  });

  it('canvas renderer -> renderer tests + canvas E2E + bench', () => {
    const plan = buildPlan(['packages/editor/src/canvas/cameraState.ts']);
    expect(plan.tiers[1]).toContain('typecheck:e2e');
    expect(plan.tiers[4]).toContain('e2e:canvas');
    expect(plan.tiers[4]).toContain('bench:render');
  });

  it('website-only change -> website lanes, no Rust/editor', () => {
    const plan = buildPlan(['apps/website/src/pages/product.astro']);
    expect(plan.tiers[4]).toContain('website-unit');
    expect(plan.changed.rust).toHaveLength(0);
    expect(plan.changed.js.some((f) => f.startsWith('packages/editor'))).toBe(false);
    expect(plan.full).toBe(false);
  });

  it('docs-only change -> docs audit, nothing heavy', () => {
    const plan = buildPlan(['docs/architecture/foo.md']);
    expect(plan.tiers[0]).toContain('audit:docs');
    expect(plan.full).toBe(false);
    expect(plan.tiers[2].length).toBe(0);
  });

  it('root vitest config -> escalates to full', () => {
    const plan = buildPlan(['vitest.config.ts']);
    expect(plan.full).toBe(true);
  });

  it('planner itself -> escalates', () => {
    const plan = buildPlan(['scripts/quality/affected-plan.mjs']);
    expect(plan.full).toBe(true);
  });

  it('no changes -> empty plan without crash', () => {
    const plan = buildPlan([]);
    expect(plan.stats.files).toBe(0);
    expect(plan.full).toBe(false);
  });

  it('deleted file -> treated as change that can break consumers', () => {
    const plan = buildPlan(['packages/shared/src/removed-util.ts']);
    expect(plan.stats.files).toBe(1);
    expect(plan.changed.js).toHaveLength(1);
    expect(plan.tiers[3].length).toBeGreaterThan(0);
  });

  it('new package file -> discovered without explicit mapping', () => {
    const plan = buildPlan(['packages/shared/src/brandNew.ts']);
    expect(plan.changed.js.some((f) => f.includes('brandNew.ts'))).toBe(true);
    expect(plan.tiers[2].some((l) => l.includes('@varve/shared'))).toBe(true);
  });

  it('lockfile change for high-risk dep -> escalates', () => {
    const plan = buildPlan(['pnpm-lock.yaml']);
    expect(plan.full).toBe(true);
  });

  it('serialization/schema change -> escalates to full', () => {
    const plan = buildPlan(['packages/scene/src/version-migrations-v220.ts']);
    expect(plan.full).toBe(true);
    const sync = buildPlan(['crates/varve-sync/src/lib.rs']);
    expect(sync.full).toBe(true);
  });
});

describe('planner lane -> command resolution (executor contract)', () => {
  const FIXTURES: Array<[string, string[]]> = [
    ['leaf UI component', ['packages/ui/src/components/Select.tsx']],
    ['shared type change', ['packages/shared/src/product.ts']],
    ['canvas renderer change', ['packages/editor/src/canvas/cameraState.ts']],
    ['settings change', ['packages/editor/src/components/Settings/SettingsDialog.tsx']],
    ['keyboard infra change', ['packages/editor/src/shortcuts/ShortcutManager.ts']],
    ['Rust crate change', ['crates/varve-core/src/geom.rs']],
    ['engine render change', ['crates/varve-engine/src/lib.rs']],
    ['website change', ['apps/website/src/pages/product.astro']],
    ['docs change', ['docs/architecture/foo.md']],
    ['model asset change', ['apps/desktop/public/models/catalog.json']],
    ['editor test file change', ['packages/editor/src/clipboard.test.ts']],
    ['canvas E2E spec change', ['tests/e2e/canvas/tools.spec.ts']],
  ];

  it('every lane the planner can emit resolves to an executable command', () => {
    for (const [label, files] of FIXTURES) {
      const plan = buildPlan(files);
      const lanes = [
        ...plan.tiers[0],
        ...plan.tiers[1],
        ...plan.tiers[2],
        ...plan.tiers[3],
        ...plan.tiers[4],
      ];
      expect(lanes.length, `${label}: expected some lanes`).toBeGreaterThan(0);
      for (const lane of lanes) {
        const cmd = resolveLane(lane);
        expect(cmd, `${label}: lane '${lane}' did not resolve to a command`).toBeTruthy();
        expect(cmd, `${label}: lane '${lane}' leaked a raw lane id to the shell`).not.toBe(lane);
        expect(cmd, `${label}: lane '${lane}' resolved to a placeholder path`).not.toMatch(
          /undefined/,
        );
      }
    }
  });

  it('package lanes resolve to the package directory, not a double path', () => {
    const plan = buildPlan(['packages/editor/src/context.tsx']);
    const editor = plan.tiers[2].find((l) => l === 'js-unit:@varve/editor');
    expect(editor).toBeTruthy();
    expect(laneCommand('js-unit:@varve/editor')).toMatch(/packages\/editor$/);
  });

  it('canonicalizes Windows workspace paths before resolving package lanes', () => {
    expect(
      toWorkspaceRelativePath('D:\\a\\varve\\varve', 'D:\\a\\varve\\varve\\packages\\editor'),
    ).toBe('packages/editor');
    expect(
      toWorkspaceRelativePath('D:/a/varve/varve', 'd:\\A\\VARVE\\VARVE\\packages\\editor'),
    ).toBe('packages/editor');
  });

  it('every e2e domain in the impact config resolves to real spec paths', () => {
    for (const [domain, globs] of Object.entries(IMPACT_CONFIG.e2eDomains)) {
      // The executor passes these paths to playwright; every domain must map
      // to at least one existing file or directory.
      for (const g of globs) {
        if (g.includes('*')) {
          expect(globSync(g), `domain ${domain}: ${g} matches nothing`).not.toHaveLength(0);
        } else {
          expect(existsSync(join(ROOT, g)), `domain ${domain}: ${g} does not exist`).toBe(true);
        }
      }
    }
  });
});

describe('planner validation budget and test-only changes', () => {
  it('validation budget metrics are computed for every plan', () => {
    const plan = buildPlan(['packages/editor/src/tools/select.ts']);
    expect(plan.stats.totalTestFiles).toBeGreaterThan(0);
    expect(plan.stats.selectedTestFiles).toBeGreaterThan(0);
    expect(plan.stats.selectedFraction).toBeGreaterThan(0);
    expect(plan.stats.selectedFraction).toBeLessThanOrEqual(1);
  });

  it('localized change does not trip the budget warning', () => {
    const plan = buildPlan(['packages/editor/src/components/Settings/SettingsDialog.tsx']);
    expect(plan.stats.selectedFraction).toBeLessThan(0.74);
  });

  it('test-only change -> changed test runs directly, no reverse-dependent fanout', () => {
    const plan = buildPlan(['packages/editor/src/clipboard.test.ts']);
    expect(plan.tiers[1]).toContain('js-unit:file:packages/editor/src/clipboard.test.ts');
    expect(plan.tiers[2]).not.toContain('js-unit:@varve/editor');
    expect(plan.tiers[3]).toHaveLength(0);
    expect(plan.full).toBe(false);
  });

  it('test-only change in a shared package does not fan out to dependents', () => {
    const plan = buildPlan(['packages/shared/src/product.test.ts']);
    expect(plan.tiers[1].some((l) => l.includes('product.test.ts'))).toBe(true);
    expect(plan.tiers[3]).toHaveLength(0);
    expect(plan.full).toBe(false);
  });

  it('direct E2E spec change runs that spec without selecting its whole domain', () => {
    const plan = buildPlan(['tests/e2e/canvas/tools.spec.ts']);
    expect(plan.tiers[1]).toContain('typecheck:e2e');
    expect(plan.tiers[1]).toContain('e2e:file:tests/e2e/canvas/tools.spec.ts');
    expect(plan.tiers[4]).not.toContain('e2e:canvas');
  });

  it('shared E2E helper change broadens to the complete browser suite', () => {
    const plan = buildPlan(['tests/e2e/shared.ts']);
    expect(plan.tiers[1]).toContain('typecheck:e2e');
    expect(plan.tiers[4]).toContain('e2e:all');
  });

  it('resolves the E2E compiler lane to the E2E tsconfig', () => {
    expect(resolveLane('typecheck:e2e')).toBe('pnpm typecheck:e2e');
  });
});
