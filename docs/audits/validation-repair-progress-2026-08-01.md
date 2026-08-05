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

---

# Session 2026-08-03 — revalidation pass on `master`

Branch: `master` @ `23e04b75`. Only untracked file was `.boot-check.tmp.mjs`
(transient external boot-check artifact; added to `.gitignore` so `biome ci`
and git status stop tripping on it).

## Baseline (2026-08-03)

| Area | Command | Initial Result | Root Cause | Status | Verification |
|------|---------|---------------:|------------|--------|--------------|
| Formatting | `just format-check` | 2 errors | `.boot-check.tmp.mjs` untracked temp artifact | Fixed (gitignore) | biome ci + cargo fmt pass |
| TypeScript | `pnpm typecheck` | 15/15 pkgs pass | — | Pass | exit 0 |
| E2E types | `pnpm typecheck:e2e` | 2 errors | `next[0].tag` under `noUncheckedIndexedAccess`; `(string\|null)[]` vs `string[]` | Fixed | exit 0 |
| Lint | `pnpm lint` | 0 errors, 57 warn, 7 info | 46 deferred `noArrayIndexKey` + 6 a11y + 5 useOptionalChain + 4 useLiteralKeys + 3 useTemplate | 46→41 deferred; all other 16 resolved | exit 0, 41 deferred |
| Accessibility | a11y lint warnings | 6 | ShortcutPalette listbox rows (4), DisclosureSection context menu (1), ExportPackageSection pre aria-label (1) | Fixed | lint clean; unit tests pass |
| Warnings | build/test/compiler | none beyond lint | — | — | — |

## Fixes applied (2026-08-03)

- **E2E types**: `focus-order.spec.ts:175` — `next[0]` possibly undefined
  (`noUncheckedIndexedAccess`) → `toBeDefined()` + `next[0]?.tag`;
  `keyboard-nav.spec.ts:37` — `selectedNodeIds` filters nulls with a type
  predicate.
- **A11y — ShortcutPalette (4 warnings)**: option rows are intentionally not
  tab stops (WAI-ARIA combobox + `aria-activedescendant`; Enter/Alt+Enter/
  Alt+Backspace handled at dialog level). Added narrow per-site
  `biome-ignore lint/a11y` with justification. Covered by existing
  `ShortcutPalette.test.tsx` keyboard tests (arrows + Enter, Alt+Enter remap).
- **A11y — DisclosureSection (1 warning)**: "Hide section" context menu moved
  from the static `<section>` onto the native trigger `<button>` (also
  unblocks native context menus on fields inside the section), with
  `aria-haspopup="menu"`, keyboard trigger (`ContextMenu` key / `Shift+F10`),
  focus of the menu item when keyboard-opened, and focus restoration to the
  trigger on Escape/hide.
- **A11y — ExportPackageSection (1 warning)**: `<pre aria-label>` → added
  `role="region"` so the accessible name is valid (labelled landmark).
- **useOptionalChain ×5**: `useIconAssets.ts` (`children ?? []`),
  `descriptor.ts` ×2, `Menu.tsx`, `Toolbar.tsx` — manual equivalent fixes.
- **useLiteralKeys ×4 / useTemplate ×3**: test files + `logoPackageExport.ts`
  hex builders.
- **noArrayIndexKey 46→41**: fixed 5 sites with natural stable keys
  (`AuditKeyboardNav` shortcut keys, `DocumentPanel` axis angle,
  `SnapGuidesOverlay` axis+position ×3). Remaining 41 documented in
  `docs/audits/deferred-lint-debt.md` (rewritten with current inventory:
  reorderable model lists needing stable IDs, positional/line-numbered lists
  where index is identity, grouped findings with composite keys).
- **Follow-up (0fadfd13)**: biome-ignore comments must name the exact rules
  and sit directly above the flagged line — the group-level `lint/a11y` form
  did not suppress `useFocusableInteractive`/`useKeyWithClickEvents`.
  ExportPackageSection: `role="region"` on `<pre>` trips
  `useSemanticElements`; the tree is plain text read in document order after
  the visible Output label, so the redundant landmark was removed instead.

## Commits (master, 2026-08-03)

| Hash | Summary |
|------|---------|
| `299f77bd` | fix(e2e): resolve strict-null type errors in a11y specs (+ ignore `.boot-check.tmp.mjs`) |
| `d6215aa7` | fix(a11y): keyboard-operable inspector context menu, labelled preview, palette listbox suppressions |
| `a360af4b` | fix(lint): resolve useOptionalChain, useLiteralKeys, useTemplate and stable-key warnings |
| `34acea3c` | docs: refresh deferred lint debt inventory and validation repair progress |
| `0fadfd13` | fix(a11y): correct listbox suppression syntax; drop redundant pre landmark |

## Final verification (2026-08-03)

| Command | Result |
|---------|--------|
| `pnpm typecheck` (15 pkgs + E2E) | PASS (exit 0) |
| `pnpm typecheck:e2e` | PASS (exit 0) |
| `pnpm lint` (biome check .) | PASS (exit 0, 41 documented-deferred `noArrayIndexKey`) |
| `just format-check` | PASS (cargo fmt + biome ci) |
| Targeted vitest (ShortcutPalette, Menu, Toolbar, logo, gradient, scene presets, controls, icons, sections) | 16 files / 198 tests PASS |
| `pnpm audit:tokens` / `pnpm audit:emoji` | PASS |
| Full `pnpm test` | 8 failures, all load/concurrency-induced (see below) |
| Playwright E2E discovery | PASS |

Full-suite note: the shared run reported 8 failures in 6 files. All were
environmental or concurrent-work related, none caused by these changes:
- 3 `ShortcutPalette.test.tsx` 5s timeouts (tests took 11-30s under load
  avg 41 + concurrent vitest runs) — pass 17/17 in isolation.
- 3 `.bench.test.ts` timing-threshold failures (cacheSystem, menuPerf,
  shaping: e.g. 1010ms > 500ms) — pass 26/26 in isolation.
- 1 `FloatingToolbar.test.tsx` "Brush" failure — pre-existing; concurrent
  agent has an uncommitted WIP fix in the working tree (not touched).
- 1 `__probe2__.test.tsx` — concurrent agent's untracked debug probe.

## Remaining

- 41 `noArrayIndexKey` warnings — documented deferred
  (`docs/audits/deferred-lint-debt.md`); need stable IDs in the `@varve/scene`
  data model or per-site suppression for positional lists.
- `lint:css` — 4 pre-existing BEM warnings in
  `packages/ui/src/components/components.css` (not in CI).
- Full Playwright E2E run not executed locally (needs `dev` server + wasm);
  CI runs `playwright test --project=chromium`.

