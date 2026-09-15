# Validation Repair Progress Ledger

Task: audit and repair repository formatting, type-checking, linting, E2E
type-checking, accessibility, and related code-quality warnings.

Date: 2026-08-04
Branch: `master` (8 commits ahead of origin/master; large uncommitted
concurrent work present — website rename, icon regen, model binaries, docs —
owned by another agent and intentionally preserved).

## Canonical commands (discovered)

| Area | Command | CI? |
|------|---------|-----|
| Formatting | `just format-check` (cargo fmt check + `biome ci --formatter-enabled=true --linter-enabled=false .`) | cargo fmt in CI (ci.yml); no biome format gate in CI |
| TypeScript | `pnpm typecheck` (per-package `tsc --noEmit` + `pnpm typecheck:e2e`) | build.yml:87, ci.yml:104 |
| E2E types | `pnpm typecheck:e2e` (`tsc -p tests/e2e/tsconfig.json --noEmit`) | via `pnpm typecheck` |
| Lint | `pnpm lint` (`biome check .`) | build.yml:90, ci.yml:106 |
| CSS lint | `pnpm lint:css` / `lint:css:all` (stylelint) | not in CI |
| Accessibility | axe-core in Playwright E2E (`tests/e2e/a11y/`), `pnpm audit:tokens`, `pnpm audit:emoji`, `pnpm audit:a11y` (echo stub) | token+emoji in CI |
| Unit tests | `pnpm test` (ci-tools + vitest run) | ci.yml:112 |
| E2E | `pnpm test:e2e` (playwright) | ci.yml:156 (needs dev server + wasm; not run locally this session) |

## Progress

| Area | Command | Initial Result | Root Cause | Status | Verification |
|------|---------|---------------:|------------|--------|--------------|
| Formatting | `biome ci` format-only | 1 error | Import sort drift in `packages/home/src/NewDesignDialog.tsx` (organizeImports) | Fixed | biome ci format-only exit 0 |
| TypeScript | `pnpm typecheck` | 15/15 packages PASS | — | Done | — |
| E2E types | `pnpm typecheck:e2e` | 3 errors | Stale `simulateWorkerCrash: () => Promise<void>` casts in 2 crash specs; real signature takes `message?: string` | Fixed | `tsc -p tests/e2e` exit 0 |
| Lint | `pnpm lint` | 2 errors, 44 warn | Errors: organizeImports + `useExhaustiveDependencies` (`onCreate` missing from `handleCreate` deps — stale closure) in NewDesignDialog.tsx. 40 `noArrayIndexKey` documented-deferred; `useConst` + `useOptionalChain` + `useSemanticElements` new | Fixed | **exit 0, 0 errors, 0 warnings** |
| CSS lint | `pnpm lint:css` | 0 errors, 4 warn | Pre-existing BEM warnings in `packages/ui/src/components/components.css` (untouched) | Not in CI | exit 0 |
| Accessibility | biome a11y + axe E2E | 1 warn: `useSemanticElements` (`role="radio"` on button, NewDesignDialog.tsx:405) | — | Fixed | native radio group; home tests 138/138 pass |
| Warnings | build/test/compiler | 44 lint warnings (41 noArrayIndexKey + useConst + useOptionalChain + useSemanticElements) | see per-batch notes | Fixed | lint exit 0; full `pnpm test` running |

## Baseline details (2026-08-04)

- `pnpm typecheck`: all 15 packages pass; E2E typecheck fails 3 sites:
  - `tests/e2e/crash/privacy-network.spec.ts:99,138`
  - `tests/e2e/crash/screenshots.spec.ts:10`
  - root cause: window cast types `simulateWorkerCrash: () => Promise<void>` while
    the real dev hook (`packages/editor/src/crash/crashTestHooks.ts:17`) is
    `simulateWorkerCrash(message?: string): Promise<void>` and tests pass a message.
- `pnpm lint` (biome check .): exit 1, 2 errors + 44 warnings:
  - errors: `assist/source/organizeImports` (NewDesignDialog.tsx:1),
    `lint/correctness/useExhaustiveDependencies` (NewDesignDialog.tsx:150 —
    `onCreate` used at :183 but missing from the dep array; `handleTemplateSelect`
    already includes it, so this is a genuine stale-closure defect).
  - 40 `noArrayIndexKey` warnings — documented-deferred
    (`docs/audits/deferred-lint-debt.md`; master baseline 41, inventory refresh
    needed: current master has 40 sites; SelectionOverlay.tsx:856 and
    LayoutScoreSection.tsx:38 are not in the 2026-08-03 inventory — verify).
  - `style/useConst` (NewDesignDialog.tsx:71 — `lastCustomFrame` never reassigned;
    persistence write was removed but `let` + stale docstring remain).
  - `complexity/useOptionalChain` (Select.tsx:98 — `active && listbox && listbox.contains(active)`).
  - `a11y/useSemanticElements` (NewDesignDialog.tsx:405 — `role="radio"` on a
    `<button>`; the surrounding `fieldset`+`legend`+`radiogroup` exists, so
    native radios are the right fix).
- Formatting: `biome ci --formatter-enabled` fails only on the same
  organizeImports error (1 file).

## Fix batches (2026-08-04, all applied)

### Batch A — E2E type errors (blocking `pnpm typecheck`) — DONE
Fixed stale `__varveCrashTest` window-cast types to
`{ simulateWorkerCrash: (message?: string) => Promise<void> }` in
`privacy-network.spec.ts` (x2) and `screenshots.spec.ts` (x1) to match
`crashTestHooks.ts`. `pnpm typecheck` exit 0.

### Batch B — Lint errors in NewDesignDialog.tsx (blocking `pnpm lint`) — DONE
- organizeImports: applied biome safe fix.
- `useExhaustiveDependencies`: added `onCreate` to `handleCreate` deps (real
  stale-closure fix; `handleTemplateSelect` already included it).

### Batch C — A11y + warning fixes in NewDesignDialog.tsx — DONE
- `useSemanticElements` (`role="radio"` on button): converted to native
  `<input type="radio">` inside `<label>` cards within the existing
  `fieldset`/`legend`/`radiogroup` — native radios give arrow-key roving
  navigation and correct AT semantics (WCAG 2.2 radio pattern). CSS updated:
  `.new-design__start-card-input` sr-only clip + `.new-design__start-card:focus-within`
  replaces the old `:focus-visible` on the button.
- `useConst`: `let lastCustomFrame` → `const defaultCustomFrame` (renamed for
  accuracy; never reassigned) + corrected stale docstring.
- Home package tests: 138/138 pass (they already used `getByRole('radio')`).

### Batch D — useOptionalChain in Select.tsx — DONE
`active && listbox && listbox.contains(active)` →
`active && listbox?.contains(active)` (semantically identical). UI tests 399/399 pass.

### Batch E — noArrayIndexKey (41 sites) — DONE (was "documented deferred")
All 41 sites resolved in this session:
- **18 sites** converted to stable keys already in the data: finding
  `nodeId`+`category`+`message` (CodePanel audit), rule/check/issue
  code + nodeId composites (IntelligencePanel governance/debt/prototype/legacy
  audit + dismissal-key composite at :370), handle key (SelectionOverlay),
  `nodeId`+`fillIndex` (GradientHandleOverlay handles, PalettePreviewDialog
  mappings), `tick.x` (TimelineRuler), grid/label coordinates (CurveEditor),
  OCR word bounding box (OcrSection), `code`+`stateId`+`transitionId`
  (StateMachineSection), category+nodeIds+description (LayoutScoreSection),
  source+nodeId+category+message (PreflightWarnings), bin start value
  (IntelligencePanel histogram), `nodeIds.join(',')` (duplicate-structure groups).
- **23 sites** keep index keys behind a per-line `// biome-ignore
  lint/suspicious/noArrayIndexKey` comment with written rationale, because
  either (a) the `@varve/scene` model has no stable id on stops/fills/strokes/
  keyframes/path points (adding ids is a serialization-breaking change) and
  content keys would remount rows mid-drag, or (b) the list is positional
  (code lines, stateless strings/swatches where content keys collide).
  Full inventory: `docs/audits/deferred-lint-debt.md` (rewritten 2026-08-04).
- 3 transient unused-index-param errors from the key conversions were cleaned
  up (map signatures).

## Verification (incremental)

| Command | Result |
|---------|--------|
| `pnpm typecheck` (15 pkgs + E2E) | PASS (exit 0) at 00:30-01:00; **blocked after 01:27 by concurrent engine mockup WIP** (see below) |
| `pnpm lint` (biome check .) | PASS (exit 0, **0 errors 0 warnings**); blocked after 01:27 by concurrent WIP |
| `biome ci` format-only | PASS; blocked after 01:27 by concurrent WIP |
| `pnpm lint:css` | PASS (4 pre-existing warnings, components.css untouched) |
| `pnpm audit:tokens` | PASS (123 pairs, 3 themes) |
| `pnpm audit:emoji` | PASS (2681 files) |
| `pnpm audit:docs` | PASS (283 docs) |
| vitest: home (138), ui (399), editor targeted (135+29) | PASS |
| full `pnpm test` | 966 files / 12154 tests PASS; 8 failures all classified (below) |
| my 38 changed files (biome check + format-only) | PASS (post-01:29 re-verification) |

## Full-suite failures (8, all classified — none from this pass's changes)

| Test | Full run | In isolation | Class |
|------|----------|--------------|-------|
| `probe.test.tsx` (FloatingToolbar/__scratch__) | timeout | PASS | load-induced (see 2026-08-01 ledger) |
| `shaping.bench.test.ts` | 100ms threshold | PASS | timing under load |
| `canvas10k.bench.test.ts` | 500ms threshold | PASS | timing under load |
| `ShellHelp.integration.test.tsx` | 5s timeout | PASS | load-induced |
| `directPreviewDownscale.test.ts` | onnx worker missing | PASS | environment (wasm/model not built locally) |
| `FloatingToolbar.test.tsx` | Brush button missing | (file modified in tree) | **pre-existing + concurrent agent's uncommitted WIP** (documented 2026-08-01) |
| `useFlatTree.test.ts` | 50ms threshold | PASS | timing under load |
| `menuPerf.bench.test.ts` / `guides1k.bench.test.ts` | timing thresholds | PASS | timing under load |

## Concurrent-work blocker (01:27+)

`packages/engine/src/index.ts` (modified 01:29) and `packages/engine/src/mockup/`
(untracked, 01:27) — another agent's in-flight mockup/homography feature —
landed in the working tree AFTER this pass's gates went green. They introduce
8 typecheck errors (`mockup/homography.ts`, `mockup/quadWarp.ts`,
`mockup/__tests__/*`, incl. a broken `./homography` import from `__tests__/`)
plus lint/format errors in the same files. Left untouched per the
multi-agent coordination protocol (AGENTS.md). Root gates go red only on
those files; my 38 changed files pass. Action: the mockup author should run
`pnpm typecheck` + `pnpm lint` on their files before committing.

Remaining repo warning: Vite CJS Node API deprecation notice in test output
(dependency-level; requires a Vite major upgrade — out of scope).
