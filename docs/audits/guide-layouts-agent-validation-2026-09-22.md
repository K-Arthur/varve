# Guide Layouts Agent Validation Report — 2026-09-22

## Changed scope

Scene schema/migration, guide geometry and lifecycle ownership, page/master
inheritance, clipboard and Figma import, transformed rendering/snapping, the
Guide Layouts dialog and presets, action/menu/shortcut access, browser coverage,
product capture, and the Grid Systems/Canvas documentation and website pages.

## Validation plan

`pnpm verify:plan` selected tiers 0–4 and reported
`FULL-SUITE ESCALATION: YES` because the shared checkout contained 257 changed
files across the workspace. This was expected from the concurrent work already
present on `master`; unrelated changes were not staged or overwritten.

## Commands actually run

- `pnpm --filter @varve/scene typecheck` — passed.
- `pnpm --filter @varve/editor typecheck` — passed.
- `node_modules/.bin/vitest run --maxWorkers=1 packages/editor/src/components/GuideLayouts/guideLayoutPresets.test.ts packages/scene/src/pageLayout.test.ts packages/scene/src/version.test.ts packages/editor/src/clipboard.test.ts packages/import/src/figma.test.ts` — passed, 124 tests.
- `pnpm exec vitest run packages/scene/src/version.test.ts --maxWorkers=1` — passed, 66 tests.
- `node scripts/audit-architecture.mjs --ci` — completed successfully; the new lifecycle cycle was removed. Existing cycle/instability findings and hub-budget warnings remain in the shared baseline.
- `pnpm build:website && pnpm build:website:pages` — passed; Astro reported zero errors and six existing hints.
- `node scripts/quality/heavy-lease.mjs "website guide-layout documentation visuals" -- env VARVE_WEBSITE_E2E_PORT=4331 VARVE_WEBSITE_E2E_PORT_ROOT=4332 pnpm exec playwright test apps/website/tests/e2e/grid-docs.spec.ts apps/website/tests/e2e/canvas-feature.spec.ts --config=playwright.website.config.ts --project=ghpages --workers=1 --reporter=list` — passed, 5 tests.
- `node scripts/quality/heavy-lease.mjs "editor menu and keyboard guide-layout access" -- timeout 180s env VARVE_E2E_PORT=1491 VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/grid-system.spec.ts -g "opens Guide Layouts" --project=chromium --workers=1 --reporter=list` — passed, 1 test.
- Product capture through the heavy lease for `guide-layouts` — passed at 1440×900; the original-resolution image was inspected and the approved scene was synced to the manifest and website.
- `pnpm audit:docs` — passed.
- `pnpm audit:emoji` — passed.
- `pnpm audit:tokens` — contrast pairs passed (315/315); usage audit remains blocked by 22 pre-existing undefined Inspector references and four pre-existing fallback references in `packages/editor/src/components/Inspector/inspector.css`. No GuideLayouts token references were reported.
- `pnpm bench` — executed. Guide/editor/scene/import benchmarks completed, but the command exited non-zero on the pre-existing `packages/history/src/__benchmarks__/history.bench.ts` invalid-node fixture.
- `pnpm verify:full` with `VARVE_FULL_GATE_REASON="guide-layout document and clipboard schema migration, foundational snapping changes, and cross-package editor/website integration"` — executed as the requested escalation. The first run found and repaired the scene migration-test typing issue; it also reported unrelated shared-worktree lint, architecture-baseline, Inspector-token, and history-benchmark failures. The repaired scene typecheck and architecture audit were rerun afterward.

## Skipped or deferred as unrelated

- The complete `grid-system.spec.ts` file was not accepted as a pass: its cold-start first scenario exceeded the 180-second shared-machine timeout. The new menu/shortcut scenario passed independently.
- Broad affected E2E, native desktop GUI matrices, packaging/signing, and release checks were deferred by the commit checkpoint and remain CI/release work rather than guide-layout evidence.
- Unrelated dirty files in the shared checkout were preserved.

## Escalations

Git index writes and progressive commits required the approved Git escalation.
The full gate was explicitly escalated because the requested work changes the
document/clipboard schema, snapping foundations, and editor/website integration.

## Full-suite status

Attempted: yes. The guide-layout-specific typecheck, unit tests, architecture
audit, browser scenarios, website build/E2E, and capture review pass. The
repository-wide gate is not green because of unrelated pre-existing dirty
workspace failures listed above; no unrelated files were changed to mask them.
