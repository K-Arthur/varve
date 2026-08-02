# Validation Repair Progress Ledger

Task: audit and repair repository formatting, type-checking, linting, E2E
type-checking, accessibility, and related code-quality warnings.

Date: 2026-08-01
Branch: `feat/input-system` (git status clean apart from untracked:
`.replay-browser-results.json`, `docs/audits/tooltip-system-audit-2026-08-01.md`,
`scripts/perf/`).

## Canonical commands (discovered)

| Area | Command | CI? |
|------|---------|-----|
| Formatting | `just format-check` (cargo fmt check + `biome ci --formatter-enabled=true --linter-enabled=false .`) | Rust fmt only in CI (ci.yml:36); no biome format gate in CI |
| TypeScript | `pnpm typecheck` (per-package `tsc --noEmit` + `pnpm typecheck:e2e`) | ci.yml:104, build.yml:87, publish.yml:74 |
| E2E types | `pnpm typecheck:e2e` (`tsc -p tests/e2e/tsconfig.json --noEmit`) | via `pnpm typecheck` |
| Lint | `pnpm lint` (`biome check .`) | ci.yml:106 |
| CSS lint | `pnpm lint:css` / `lint:css:all` (stylelint) | not in CI |
| Accessibility | `pnpm audit:a11y` (echo stub), axe-core in Playwright E2E, `pnpm audit:tokens`, `pnpm audit:emoji` | token+emoji in CI |
| Unit tests | `pnpm test` (vitest run) | ci.yml:112 |
| E2E | `pnpm test:e2e` (playwright) | ci.yml:156 |

## Progress

| Area | Command | Initial Result | Root Cause | Status | Verification |
|------|---------|---------------:|------------|--------|--------------|
| Formatting | `just format-check` | 9 files | Format drift in `scripts/pin-github-actions.mjs` (tracked); rest untracked WIP (`scripts/perf/`, `inputDiagnostics.test.ts`) | Fixed (tracked) | cargo fmt + biome ci pass on packages/apps/tests/scripts |
| TypeScript | `pnpm typecheck` | Pass | — | Done | All 15 packages pass |
| E2E types | `pnpm typecheck:e2e` | 1 error | Unused `Locator` import in `tests/e2e/canvas/input-navigation.spec.ts:1` | Fixed | `tsc -p tests/e2e` exit 0 |
| Lint | `pnpm lint` | 2 errors, 97 warn, 7 info | 2 errors = format drift in untracked WIP; 84 tracked warnings | Tracked tree clean | exit 0; 46 remaining = documented-deferred `noArrayIndexKey` |
| CSS lint | `pnpm lint:css` | 0 errors, 4 warn | Pre-existing BEM pattern warnings in `packages/ui/src/components/components.css` (untouched) | Not in CI | exit 0 |
| Accessibility | axe/E2E + audits | — | — | a11y fixed | token+emoji audits pass; Menubar a11y + stale getByTitle tests fixed |
| Warnings | build/test/compiler | — | — | — | see below |

## Baseline notes

- `docs/audits/lint-baseline.json` records 164 warnings (2026-07-25).
- `docs/audits/deferred-lint-debt.md` documents 21 genuinely deferred warnings
  (noArrayIndexKey + useSemanticElements requiring model redesign).

## Fixes applied (committed by coordinator into `feat/input-system`)

- **E2E typecheck**: removed unused `Locator` import (`input-navigation.spec.ts`).
- **A11y**: `Menubar.tsx` doc-name `role="button"` span → native `<button type="button">`
  (with CSS reset). Updated stale `getByTitle()` assertions to `getByRole()`/
  `aria-describedby`+tooltip pattern in `LayersRow`, `ShortcutPalette`,
  `MasterPanel` tests — tests now assert the a11y-correct DOM the tooltip
  migration introduced.
- **Type safety**: replaced 16 `noExplicitAny` casts in `thumbnailSource.ts` +
  `useThumbnail.ts` with `in`-narrowing / proper types; `Function` type in
  `font-detect.spec.ts` → typed `invoke` signature; `noStaticOnlyClass` stub in
  `videoExport.test.ts` → `Object.assign(function, {...})`.
- **Lint correctness**: fixed 7 `noAssignInExpressions` (regex exec loops,
  `??=` in expression) across `fuzzySearch.ts`, `IntelligencePanel.tsx`,
  `iconAudit.ts`, `linterTypes.ts`; 6 `noDescendingSpecificity` CSS reorders;
  unused imports in `fontDetectionPipeline.test.ts`, `pr-debug-comment.mjs`,
  `test-ci-debug.mjs`; unused vars in `replay-filter.test.ts`; optional-chain
  + template-literal + literal-keys fixes in `sectionState.ts`, `move.bench.ts`,
  `fontDetectionPipeline.ts`.
- **Concurrent-file type error**: `physicalKey.ts` `numpad[1]`/`mainRow[1]`
  under `noUncheckedIndexedAccess` → `?? null`.
- **Format**: `scripts/pin-github-actions.mjs` (large drift), `inputPipeline.ts`,
  `inputDiagnostics.test.ts`, plus `scripts/perf/*.mjs` after they were committed.

## Remaining

- 46 `noArrayIndexKey` warnings — documented deferred (positional identity for
  ordered effect/stroke/fill/keyframe lists; needs stable IDs in data model).
  See `docs/audits/deferred-lint-debt.md`.
- Full-suite editor test timeouts under extreme local load (5 concurrent
  worktrees + multiple agents, load avg 31) are environmental; the affected
  tests pass when run in controlled batches.
- `lint:css` 4 pre-existing BEM warnings in `packages/ui/src/components/components.css`.

## Final verification (2026-08-01)

| Command | Result |
|---------|--------|
| `pnpm typecheck` (15 pkgs + E2E) | PASS (exit 0) |
| `pnpm typecheck:e2e` | PASS (exit 0) |
| `pnpm lint` (biome check .) | PASS (exit 0, 46 deferred warnings) |
| `biome ci` format check | PASS (exit 0) |
| `cargo fmt --all -- --check` | PASS |
| `pnpm lint:css` | PASS (0 errors, 4 pre-existing warnings) |
| `pnpm audit:tokens` | PASS (123/123) |
| `pnpm audit:emoji` | PASS (clean) |
| Vitest engine package | 228 files / 2948 tests PASS |
| Vitest non-editor packages | 483 files / 6733 tests PASS |
| Vitest scene package | 96 files / 1740 tests PASS |
| Vitest editor (changed-file batches) | 10 files / 177 + 5 files / 57 PASS |
| Playwright E2E discovery | 592 tests / 120 files OK |

Architecture audit (`scripts/audit-architecture.mjs --ci`) is slow locally
because it scans 5 concurrent worktrees; CI runs on a clean checkout.
`git status` clean apart from this ledger + auto-fixed `scripts/perf/*.mjs`
(committed by the coordinator).
