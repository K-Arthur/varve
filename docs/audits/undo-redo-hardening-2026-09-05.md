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
| Persistent and fallback stacks both own editing state | `context.tsx` undo/redo callbacks and derived enabled state | Extra Undo at genesis regression passes; broader routing ownership unverified |
| Effect Studio uses a global preview transaction | `EffectStudioSection.previewTreatment` / `cancelPreview` | Unrelated edits, Save and recovery isolation unverified |
| Website promises unlimited session undo | Getting-started first-project page; fallback stack is bounded | Corrected and visually inspected in both themes |

## Mutation coverage ledger

These categories are discovery groups, not a claim that all entry points have
been verified. Authored state must round-trip with its binary dependencies.

| Family | Production entry points / state | Required boundary | Evidence status |
| --- | --- | --- | --- |
| Background removal | Quick bar, inspector, subject picker, refinement, trimap; native raster mask assets | One accepted result, no inference on redo | Branch identity regression; real Quick UI traversal passes with exact pixels |
| Effects | EffectsSection, EffectStudioSection, smart filters, adjustment nodes, presets and batch routes | Discrete operation or complete gesture; preview cancelled without authoring | Static inspection begun; comprehensive runtime matrix outstanding |
| Geometry and graph edits | Editor commands, canvas tools, layers; nodes, children, references | Command or pointer gesture | Prior session tests exist; entry-point audit outstanding |
| Raster painting | Brush tools, tile Maps, content-addressed raster store | One stroke | Interleaved vector/raster and memory-store reload session tests pass; browser reload outstanding |
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
- `6137c03fb`: serialized branch switching through the persistent-history
  restoration boundary, saved-state dirty markers, and history-panel routing.
  Commit checkpoint: 35 focused history tests passed.
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
desktop run completed with 657 passing files, one skipped file and three
failing files (6,504 passed, eight failed, one skipped tests). All eight
failures were in the three concurrently edited background-removal files;
their targeted rerun passed all 46 tests. The diagnostic history benchmark
was attempted but produced no completed timing samples.

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
  VARVE_E2E_PORT=1450 pnpm exec playwright test tests/e2e/canvas/background-removal.spec.ts --project=chromium --grep 'saved mask history' --reporter=list --workers=1
  VARVE_E2E_PORT=1451 pnpm exec playwright test tests/e2e/canvas/history-panel.spec.ts --project=chromium --grep 'checkpoint and branch|navigating a step' --reporter=list --workers=1
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


## Branch-switch follow-up

Two additional regressions reproduce branch switching publishing an unreadable
head and stale Undo availability at genesis (23 existing tests passed, two new
tests failed; all 25 pass after repair). Branch switching now joins the capture/navigation queue, loads
the target before publishing it, and updates availability and labels. This
covers session navigation; branch metadata operations and merge scheduling
remain a separate review item.

The website guidance and genesis-boundary evidence were committed as
`b12be110f`. A fresh real Quick-removal pixel round-trip passed on the current
worktree using port 1444 (one test, 2.2 minutes including startup). Apply,
Undo and Redo screenshots were personally inspected and retained outside the
shared Playwright output directory:
`reports/undo-redo-hardening-2026-09-05/canvas/`. The before/after buffers match
exactly across two cycles. This is heuristic processing, not native or AI
provider certification.

The three background-removal files that failed during the broad package run
were rerun against the concurrent session's latest changes: all 46 tests pass.
Command: `pnpm exec vitest run
packages/editor/src/backgroundRemoval/SubjectIsolationService.test.ts
packages/editor/src/context/useBackgroundRemoval.test.tsx
packages/editor/src/components/SelectionQuickBar/quickBarActions.test.ts
--maxWorkers=2`. This closes all eight failures observed in the completed broad package run.

History benchmark fixture construction now batches the flat node fixture and
its preset edits, avoiding repeated whole-document operation replay before
timing begins. A small reference fixture verifies canonical equivalence with
the operation pipeline. History/CLI affected tests pass (199 tests, 15 files),
as do both typechecks. The diagnostic benchmark does not establish editor
Undo latency, low-memory budgets or native performance.


History panel source inspection found two UI entry points discarding restored
documents: step clicks and branch switches called the storage session directly
and refreshed only panel metadata. Both now route through the editor's
restoration hook, which applies document/selection/derived UI state and guards
against a result arriving after a document switch. Browser coverage now checks
layer restoration, not only movement of the HEAD marker. The saved-mask reload
scenario also passes in the isolated validation copy and compares canvas pixel
hashes after a forced full redraw.


## Dirty-state restoration

A provider regression reproduced Undo after Save leaving the document and tab
clean (one failed, four passed). Restoration now retains the last observed
clean document reference, compares canonical authored state, updates both
dirty flags, and increments the recovery revision. Redo to that saved content
returns both flags to clean. The combined provider/hook rerun passes all ten
tests, including the four navigation/document-switch races. This marker is
local to the current editing session; it does not add persisted schema fields.

The shared-tree editor typecheck reported three concurrent errors in
`commitRasterMask.ts`, `ExportDialog.tsx` and `TableAppearanceSection.tsx`;
none involved the history changes. A later browser run was disrupted by
concurrent minimap changes. To obtain stable evidence, validation continues
in a separate local copy of `master`, with only the history changes applied.
Development and commits remain in the user's `master` worktree; no feature
branch was created.

The saved-mask reload test confirms that the saved cutout reopens from Home,
Undo restores the blue source and Redo restores the cutout. Its initial
assertion about the status label was incorrect: the loaded app displays “Not
saved”, although saving before reload had succeeded. The test now asserts the
successful save before reload and uses a canvas pixel hash after each history
operation. That label behavior is recorded separately from mask/history
persistence.

Benchmark labels now match their actual workloads: disjoint edits affect
different nodes, and conflicts assign different values to the same property.
All edit fixtures are prepared outside timed hash/diff/merge measurements.
Earlier diagnostic runs were stopped without completed results while these
fixture issues were corrected; no speedup is claimed from those runs.
