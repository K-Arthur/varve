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
| Formatting | `just format-check` | 9 files | Format drift in `scripts/pin-github-actions.mjs` (tracked); rest untracked WIP (`scripts/perf/`, `inputDiagnostics.test.ts`) | Fixed (tracked) | biome ci pass on packages/apps/tests/scripts |
| TypeScript | `pnpm typecheck` | Pass | — | Done | All 15 packages pass |
| E2E types | `pnpm typecheck:e2e` | 1 error | Unused `Locator` import in `tests/e2e/canvas/input-navigation.spec.ts:1` | Fixed | `tsc -p tests/e2e` exit 0 |
| Lint | `pnpm lint` | 2 errors, 97 warn, 7 info | 2 errors = format drift in untracked WIP files (`scripts/perf/`, `scripts/pin-github-actions.test.mjs`); 84 tracked warnings | Tracked tree clean | `biome check packages apps tests scripts/*.mjs` exit 0; 46 remaining = documented-deferred `noArrayIndexKey` |
| CSS lint | `pnpm lint:css` | Pending | — | Not started | — |
| Accessibility | axe/E2E + audits | Pending | — | Not started | — |
| Warnings | build/test/compiler | Pending | — | Not started | — |

## Baseline notes

- `docs/audits/lint-baseline.json` records 164 warnings (2026-07-25).
- `docs/audits/deferred-lint-debt.md` documents 21 genuinely deferred warnings
  (noArrayIndexKey + useSemanticElements requiring model redesign).
