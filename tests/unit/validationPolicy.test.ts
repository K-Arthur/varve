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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../../scripts/quality/affected-plan.mjs';
import { auditImpactConfig } from '../../scripts/quality/audit-impact-config.mjs';
import { LANES } from '../../scripts/quality/validation-lanes.mjs';

const ROOT = process.cwd();

function pnpmLs() {
  const out = execSync('pnpm m ls --json --depth -1', { encoding: 'utf8' });
  return JSON.parse(out);
}

describe('validation infrastructure presence', () => {
  it('exposes the required commands in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    for (const script of [
      'verify:plan',
      'verify:quick',
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
    const hook = readFileSync(join(ROOT, '.github/hooks/pre-commit'), 'utf-8');
    expect(hook).not.toMatch(/vitest run(?! tests\/unit\/validationPolicy)/);
    expect(hook).not.toMatch(/playwright test/);
    expect(hook).not.toMatch(/cargo test --workspace/);
  });

  it('pre-push does not unconditionally force the full gate', () => {
    const hook = readFileSync(join(ROOT, '.github/hooks/pre-push'), 'utf-8');
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
