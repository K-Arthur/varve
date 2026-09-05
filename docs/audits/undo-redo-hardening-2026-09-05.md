# Undo/redo hardening evidence — 2026-09-05

## Scope and baseline

Started from clean `master`, `a363c6432`. This is an ongoing audit, not a
certification of every mutation route. The previous
[mutation inventory](history-mutation-inventory-2026-08-05.md) and
[deterministic progress tracker](../plans/deterministic-undo-progress.md)
contain historical claims that require runtime verification.

## Findings

| Finding | Evidence | Status |
| --- | --- | --- |
| Different masks on divergent paths reuse one immutable asset ID | New `commitRasterMask.test.ts` regression fails with `mask-img-1` on both paths | Fresh payload identities implemented; direct regression passes |
| Apply captures a document before a dynamic import and later replaces current state | `useBackgroundRemoval.applyBackgroundRemovalPreview` | Reproduced lost unrelated edit; synchronous Apply and updater target guard implemented; regression passes |
| Navigation moves the branch before loading the restored document | `EditorHistorySession.undo`, `redo`, `checkout`, `undoToRevision` | Reproduced failed checkout moving the cursor; target load now precedes publication; regression passes |
| Watcher captures do not wait for attachment | `usePersistentHistory` document effect | Reproduced missing pre-attach edit; watcher now awaits attachment; regression passes |
| Async navigation applies without checking session identity | `usePersistentHistory` navigation callbacks | Reproduced late result applied to another document; session/generation guards implemented; regression passes |
| Persistent and fallback stacks both own editing state | `context.tsx` undo/redo callbacks and derived enabled state | Routing and genesis-boundary coverage needed |
| Effect Studio uses a global preview transaction | `EffectStudioSection.previewTreatment` / `cancelPreview` | Unrelated edits, Save and recovery isolation unverified |
| Website promises unlimited session undo | Getting-started first-project page; fallback stack is bounded | Copy correction prepared |

## Mutation coverage ledger

These categories are discovery groups, not a claim that all entry points have
been verified. Authored state must round-trip with its binary dependencies.

| Family | Production entry points / state | Required boundary | Evidence status |
| --- | --- | --- | --- |
| Background removal | Quick bar, inspector, subject picker, refinement, trimap; native raster mask assets | One accepted result, no inference on redo | Branch identity regression; real Quick UI traversal passes with exact pixels |
| Effects | EffectsSection, EffectStudioSection, smart filters, adjustment nodes, presets and batch routes | Discrete operation or complete gesture; preview cancelled without authoring | Static inspection begun; comprehensive runtime matrix outstanding |
| Geometry and graph edits | Editor commands, canvas tools, layers; nodes, children, references | Command or pointer gesture | Prior session tests exist; entry-point audit outstanding |
| Raster painting | Brush tools, tile Maps, content-addressed raster store | One stroke | Existing interleaved vector/raster and reload session tests; not yet rerun |
| Text | TextEditOverlay, inspector, rich runs | Typing burst and atomic IME composition | Prior coverage exists; real input routing unverified |
| Pages, frames and settings | Editor commands, grid and page controls | Authored change only | Outstanding |
| Components, styles, variables and bindings | Inspector, library and document operations | Coherent graph edit | Outstanding |
| Motion and prototyping | Motion/prototype providers, timeline commands | Authored keyframe/interaction changes only | Outstanding |
| Import, paste, image replacement and batches | File import, clipboard and async processing routes | Validated short commit after computation | Outstanding |
| Selection, camera and UI preferences | Selection/viewport contexts, panels | Intentionally outside document history | Tool-local paint selection has separate ownership; routing unverified |
| Export, downloads and external writes | Platform services | External side effects, not document undo | No changes proposed |

## Compatibility decision

Mask identity changes need no schema migration. Existing IDs remain readable;
new commits mint identities through the existing scene ID utility. The edit
revision remains metadata, not a cache or storage identity. Replay preserves
the committed ID and data URL. No new history stack or processing provider.

## Validation record

- Baseline `pnpm verify:plan`: no changed files.
- Direct mask regression before repair: 1 failed, 8 passed; alias reproduced.
- Direct mask regression in affected validation after repair: 9 passed.
- `pnpm verify:affected`: initial run superseded during repairs. Final scoped
  run passed changed-file checks, audits, E2E typechecking and direct tests;
  stopped at browser startup failure before AI Balanced processing. Three
  browser scenarios passed and three were skipped by serial-suite behavior.
  The failed and skipped scenarios are being rerun explicitly; remaining
  editor/desktop and website lanes are running separately.
- Real Quick browser traversal: isolated port 1437, 1 passed (43.6 s test,
  1.5 min including startup). Initial default-port run could not start because
  1420 was already occupied. Inspected `after-apply-ui.png`, `undo-0.png` and
  `redo-0.png` under `test-results/run-3194250-1437/` (background-removal
  traversal directory): original blue background restores, cutout returns,
  mask badge and controls appear. This used the browser Quick heuristic,
  not an AI model or native provider.
- Navigation, mask reload/branch restoration and React session isolation: 25 tests
  passed after repairs (23 session tests, 2 hook tests).
- `pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens`: passed; token
  audit reports 153 pairs across three themes.
- Native Tauri/model execution, memory budgets, complete mutation matrix,
  IndexedDB reload and broader fault scenarios remain unverified. Memory-store
  recreation verifies mask replay independent of the original session cache.

## Milestone commits and additional evidence

- `bbe203d27`: immutable mask identities and branch regression.
- `bf25fd1ae`: synchronous Apply boundary, shared capture/navigation queue,
  replay-before-cursor-publication, accurate navigation labels, switch guards,
  preview dismissal and delayed-attachment capture. Commit checkpoint: 26 tests
  passed; no hook bypasses.
- Extra Undo at genesis did **not** reproduce resurrection in the added
  EditorProvider test. Four transaction regression tests passed. The broader
  fallback-routing audit remains open; the hypothesis is not a confirmed bug.
- Editor typecheck passed after correcting the new fixture's ShapeNode narrowing.
- Architecture audit exited 0; 15 distinct cycles and zero layer violations.
  Existing hub import warnings remain. No baseline was reset.
- Browser mask tests: six of seven scenarios passed across bounded runs (Quick
  round-trip, Quick toolbar, disconnected subjects, AI Balanced surface, no
  crash, and Properties mask editing). AI Balanced UI success alone does not
  prove which model/provider ran. Quick is the separately verified real
  heuristic path.
- Panoramic failure remains: import the 3000 × 600 fixture, Remove background,
  Apply result. The alpha-mask layer badge and Edit mask control appear, but
  the canvas screenshot stays unchanged for 15 seconds. Evidence:
  `test-results/run-3229180-1440/` panoramic scenario directory. No baseline
  replacement or weakened assertion was used.
- Website: typecheck and 169 unit tests passed; both static builds completed.
  The browser suite passed 375/379. The corner-radius timeout passed on targeted
  rerun. Download dark remains unstable at 6357/6365 px page height; its page,
  shared layout and global CSS have no diff from the starting commit.
  Both background-removal mobile snapshots differ while that feature page is
  being edited concurrently. Those unrelated baselines are unchanged.
- The corrected getting-started history tip was captured and personally
  inspected in light and dark themes. Screenshots and capture script:
  `reports/undo-redo-hardening-2026-09-05/website-history-*.png`.

## Shared-worktree limits

Separate background-removal and effects work appeared during this run,
including new failing lifecycle tests, provider/renderer edits and marketing
copy changes. Those files are preserved. The second commit uses explicit paths
so other staged work is excluded. Package-suite output from this period is
worktree evidence, not certification of a frozen commit. The broad editor /
desktop run and diagnostic history benchmark are still in progress.

## Agent validation report — milestone, not final certification

```text
Changed scope: editor history/session wiring, mask commit IDs, regression tests,
  persistent-history docs and website getting-started history guidance.
Validation plan: editor + desktop affected closure; changed tests and background
  removal E2E; website unit/type/browser checks; docs/emoji. No full escalation.
Commands actually run:
  pnpm verify:plan
  pnpm verify:affected
  VARVE_E2E_PORT=1438 pnpm verify:affected
  pnpm exec vitest run packages/editor/src/backgroundRemoval/__tests__/commitRasterMask.test.ts
  pnpm exec vitest run packages/editor/src/context/useBackgroundRemoval.test.tsx
  pnpm exec vitest run packages/editor/src/context/usePersistentHistory.test.tsx
  pnpm exec vitest run packages/editor/src/history/__tests__/editorHistorySession.test.ts
  pnpm exec vitest run packages/editor/src/context/__tests__/transactionHistoryRegression.test.tsx
  pnpm exec vitest run packages/editor apps/desktop --maxWorkers=2
  pnpm --filter @varve/editor typecheck
  pnpm --filter @varve/desktop typecheck
  pnpm typecheck:e2e
  pnpm audit:docs
  pnpm audit:emoji
  pnpm audit:tokens
  node scripts/audit-architecture.mjs --ci
  pnpm --filter @varve/website typecheck
  pnpm test:website
  pnpm test:website:e2e
  pnpm exec playwright test -c playwright.website.config.ts --project=ghpages --workers=1 --grep 'all static-page buttons|download page dark'
  node reports/undo-redo-hardening-2026-09-05/website-review.mjs
  pnpm exec vitest bench packages/history/src/__benchmarks__/history.bench.ts --run --pool=forks --maxWorkers=1
Passed: direct repair tests; transaction regression; editor and E2E typechecks;
  docs/emoji/tokens; architecture; website type/unit/build; six mask UI scenarios;
  light/dark inspection of the corrected website guidance.
Skipped as unrelated: Rust/native suites and global canvas visual matrix;
  no Rust/native or shared renderer changes in these commits.
Escalations: none. Remaining failures and active checks are detailed above.
Full suite run: no
```

Browser command details: every app run used `pnpm exec playwright test
 tests/e2e/canvas/background-removal.spec.ts --project=chromium --reporter=list`.
Port / `--grep` pairs: 1437 / `restores exact canvas`; 1439 /
`Inspector — AI|No crash|large panoramic|Properties exposes`; 1440 /
`No crash|large panoramic|Properties exposes`; 1441 / `Properties exposes`.
The initial default-port invocation could not start because 1420 was occupied.

Final scoped review checkpoint: `pnpm verify:plan --staged` and
`pnpm verify:quick --staged` ran against a temporary index containing only the
three review files (the shared index was preserved). Four transaction tests
and all Tier 0 checks passed in 105.5 seconds. Desktop typecheck also passed.
