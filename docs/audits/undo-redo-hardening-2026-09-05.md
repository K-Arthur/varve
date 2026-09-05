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
