# Canvas fluidity and input latency — ownership record

**Started:** 2026-09-25
**Base:** `master` at `3d6095535d39b3e4b9674f149520d833396efaef`
**Coordinator:** canvas responsiveness task (single writer)

## Scope and boundaries

This task owns measured main-thread work on the pointer, hover, wheel, and
drag paths: the canvas cursor-position publication, hit-test document caches,
per-render document scans in Layers rows and canvas render setup, background
session/accent work that runs on every document change, their focused tests,
and the audit record `docs/audits/canvas-fluidity-2026-09-25.md`.

Expected edited paths:

- `packages/editor/src/canvas/inputPipeline.ts`, `canvas/cursorPosition.ts` (new),
  `canvas/renderPipeline.ts`, `CanvasArea.tsx` (no new imports)
- `packages/editor/src/StatusBar.tsx` (cursor readout only)
- `packages/editor/src/hooks/useCollabPresence.ts`
- `packages/editor/src/hitTest/HitTestEngine.ts`
- `packages/editor/src/components/LayersPanel/LayersRow.tsx`
- `packages/editor/src/intelligence/autoNamer.ts`
- `packages/editor/src/workspace/sessionBroker.ts` and its test
- `packages/editor/src/appearance/useDocumentAccent.ts`, `documentAccent.ts`
- `packages/scene/src/visibility.ts`
- debug consumers of the cursor position under `packages/editor/src/debug/`

Any additional file is recorded here before editing.

Added during the task (recorded after the fact; the profile attribution led to
each file):

- `packages/editor/src/canvas/canvasSurface.ts` and its test (geometry refresh)
- `packages/editor/src/canvas/dirtyRegion.ts`, `invalidationPlan.ts`,
  `CanvasNameLabels.tsx`, `nameLabelPolicy.ts`, `renderDocumentFacts.ts` (new)
- `packages/editor/src/scene/parentIndexCache.ts`, `selectionArrangement.ts`,
  `world.ts`, and `scene/__tests__/committedParentIndex.test.ts` (new)
- `packages/editor/src/components/CanvasAccessibilityTree.tsx`,
  `components/Inspector/inspectorContext.ts`, `components/Minimap/minimapLayout.ts`,
  `components/StatusBar/CursorPositionReadout.tsx` (new)
- `packages/editor/src/render/sceneCompositing.ts`, `render/perspectiveImage.ts`
- `packages/editor/src/context/types.ts` (deprecation notes only)
- `packages/scene/src/editorSceneScope.ts` and its test
- `packages/shared/src/viewport.ts`, `index.ts`, `viewportProjector.test.ts` (new)
- `packages/history/src/diff.ts`, `__tests__/lcsBounds.test.ts` (new)
- `packages/editor/src/hitTest/__tests__/fontRevisionCache.test.ts` (new)
- `packages/editor/src/canvas/partialPaint.ts`, `dirtyQuery.ts`, and their tests
  (device-pixel clip snapping)
- `packages/editor/src/context.tsx` (one line in `commitPreparedFragment`'s
  state updater; no import or branch added) and `context.import.test.tsx`.
  The E2E lanes showed this task exposing a latent paste bug there, so the fix
  belongs to this task even though `context.tsx` was out of scope at start.
- `packages/editor/src/components/PerspectiveOverlay.tsx` and a new
  `PerspectiveOverlay.test.tsx` (Escape lost when the overlay re-subscribed
  mid-dispatch; exposed by this task's timing changes).
- `tests/e2e/canvas/responsive-geometry.spec.ts` (new regression test for a
  resize during a drag) and `tests/e2e/canvas/variable-font-axes.spec.ts`
  (its drag no longer leaves the canvas; no assertion changed).

## Existing work to preserve

At start, a plugin-system task had unstaged edits in `Shell.tsx`,
`Menubar.tsx`, `SettingsContext.tsx`, `SettingsDialog.tsx`, Inspector plugin
sections, menu definitions, website pages and docs, plus many untracked plugin
files. A token-sync task had **staged** edits under `TokenSync/`, `tokenSync/`,
`packages/scene/src/tokens/`, and `packages/tokens/`. None belongs to this task.
`Shell.tsx` and `context.tsx` were deliberately left alone at start:
`Shell.tsx` was dirty in another task, and `context.tsx` is at its import
ceiling. (`context.tsx` later received the one-line paste fix recorded above,
with no import change.)

Update (2026-09-25, afternoon): the plugin task committed its `Shell.tsx`,
`Menubar.tsx`, and Settings work (`0de427aa4`..`db9ec37e0`). `Shell.tsx` still
passes `state.cursorPos` to `useCollabPresence`; the hook now ignores a null
value in favor of the cursor store, so no Shell edit is required here.

No branch switch, stash, reset, clean, broad `git add`, or full-index commit is
authorized. Commits use `git commit -- <owned paths>` so the other task's
staged index entries remain staged and untouched. Browser work uses isolated
ports (1447 dev, 1448/1449 preview) and the heavy-task lease.
