# Layers Panel — Current State & Roadmap

**Last updated: 2026-07-06 (Session — evidence-based fixes pass)**

This doc previously claimed "ALL PHASES COMPLETE, no remaining work." That
was inaccurate: a full audit found the Layers Panel already had a mature,
mostly-working implementation, but with several real bugs (including one
that made mouse drag-and-drop reordering silently non-functional) and a few
built-but-never-wired features. This revision reflects what's actually true
today and what's genuinely still open.

## What's real and already working

- **Scene model**: 6-kind node union (Shape/Text/Group/Frame/Adjustment/Path),
  Pages as a separate top-level structure, a real component/instance system
  with baseline-diff override detection + sync status, real fractional
  indexing (`fractional-indexing` npm package) for future CRDT sync.
- **Tree UI**: virtualized (`@tanstack/react-virtual`, dynamic row measurement),
  `@dnd-kit`-backed reorder + reparent-into-container with auto-expand/
  auto-scroll, APG `role=tree`/`treeitem` markup, multi-select (range/toggle/
  all), type-ahead, inline rename with Tab-cycle, a 7-color label system,
  name+kind+attribute filtering, AND-term search, bulk lock/hide/color-tag,
  motion/keyframe indicators, real system-clipboard copy/cut/paste.
- **Data-layer perf**: 10k-node benchmarks for flatten/search/spatial-index/
  parent-lookup, all comfortably sub-250ms (`__benchmarks__/layers10k.bench.test.ts`).

## Fixed this session

1. **Multi-select drag now moves the whole selection**, not just the row
   under the pointer (matches Figma/Sketch/Illustrator). New pure functions
   `resolveDragMoveIds`/`computeMultiMoveSteps` in `LayersTree.tsx`, unit
   tested directly; wrapped in `beginTransaction`/`commitTransaction` for a
   single undo step per multi-drag.
2. **Critical fix: `rowRefs` was declared but never populated.**
   `handleDragOver`'s drop-zone computation depended on
   `rowRefs.current.get(overId)` for the row's bounding rect; since nothing
   ever called `.set()` on that map, this always returned `undefined` and the
   function exited immediately — `dropIndicator` never got set, and
   `handleDragEnd`'s reparent logic (gated on a non-null `dropIndicator`)
   never ran. **Mouse drag-and-drop reordering did not work in the shipped
   app**, despite extensive supporting logic (auto-scroll, auto-expand, cycle
   guards) built around it. Fixed by populating the map from
   `SortableVirtualRow`'s wrapper ref callback.
3. **Real roving tabindex.** Rows now get `tabIndex={focused ? 0 : -1}`
   (previously hardcoded `-1` on every row with only the tree container
   focusable); the container is `tabIndex={-1}`; a new effect moves actual
   DOM focus to the newly-focused row when the user is already navigating
   inside the tree. Confirmed via research (GitHub's own tree-view
   engineering work) that roving tabindex is the more robust pattern versus
   `aria-activedescendant`, particularly for VoiceOver.
4. **`layerBulkOperations.test.ts` now tests real code.** The file tested
   hand-copied local reimplementations of the bulk-select/lock/visibility/
   color-tag logic, not the actual `context.tsx` implementations — a bug in
   the real code would have passed this suite. Extracted the real logic into
   `layerBulkOperations.ts` (pure functions), wired `context.tsx` to call it,
   and rewrote the tests against the real exports.
5. **Thumbnail LRU cache wired in.** `thumbnailCache.ts`'s `ThumbnailCache`
   was fully built and unit-tested but never imported by `useThumbnail.ts` —
   every row re-rendered its 28×28 canvas from scratch on every mount,
   including every virtualizer scroll-in. Now backed by a shared
   `sharedThumbnailCache` singleton; also fixes a related staleness bug
   where a fill-color change without an id/kind change didn't invalidate the
   thumbnail (the cache key now correctly encodes fill).
6. **`getKeyframeCount` memoized per document.** Was called fresh per row on
   every render, scanning every track in every timeline each time; now
   precomputed once per document reference into a `Map`.
7. **Search index patched incrementally**, not rebuilt from scratch on every
   document mutation. This required also fixing a latent bug in
   `useFlatTree.ts`'s hook: its "fast path" cache check only compared
   `doc`/`expanded`, silently ignoring `filterSpec`/`matchedIds`/
   `activePageId` — meaning toggling a filter chip or switching pages with
   the document otherwise unchanged could return stale cached tree entries.
   Both gaps fixed together and covered by regression tests
   (`useFlatTree.test.ts`, `layerSearchIndex.test.ts`).
8. **`PageStrip.tsx` (orphaned duplicate) deleted.** It lived in
   `LayersPanel/`, had real thumbnails + drag-reorder, and was fully unit
   tested — but was never mounted anywhere; the actual page switcher was a
   separate, less-capable `PageNav.tsx`. Ported `PageStrip`'s drag-reorder
   (via `@dnd-kit`, a new `computeReorderedPageIds` pure function) into the
   live `PageNav.tsx` and deleted the orphan. Did **not** port `PageStrip`'s
   "Rename page" menu item — it was a dead stub (called `onSetActivePage`
   instead of an actual rename), so porting it would have reintroduced a bug
   under the guise of a feature.
9. **Presence indicators wired in** (`usePresence` hook in `presenceStore.ts`,
   consumed by `LayersRow`/`LayersTree`). `PresenceIndicator`/`presenceStore`
   were fully built and tested but never imported anywhere; this makes them
   render if/when a real presence backend populates the store. No backend
   exists yet (see below).
10. **"Publish to Library" context-menu entry point.** `packages/scene/src/library.ts`
    had a full versioned publish/install data model with zero UI. Added a
    minimal, real entry point: right-click a component's master frame →
    "Publish to Library" builds a `LibraryPackage` (via the existing
    `publishComponentToLibrary`/`createLibraryPackage` functions) and copies
    it to the clipboard as JSON. Deliberately not a full library-management
    panel — see roadmap below.
11. **Isolation/focus mode (panel-scoped).** Right-click a container →
    "Isolate" shows only that subtree in the tree (via a new `isolatedNodeId`
    editor-state field and a `flattenTree` parameter), with a breadcrumb
    header and Escape-to-exit. Deliberately does **not** touch canvas-side
    selection or rendering — see roadmap below.

## Fixed in a follow-up multi-agent code review pass

An `xhigh`-effort, 10-angle automated review of the diff above (before commit)
surfaced several real bugs the manual pass missed, all fixed:

- **Cross-document thumbnail cache collisions.** Node ids are per-document
  sequential counters starting at `n1`, so two open documents/tabs routinely
  have colliding ids; the shared `sharedThumbnailCache` singleton had no
  document-scoping, so switching tabs could show a different document's stale
  thumbnail. Fixed by threading `docId` into `thumbnailCacheKey` end-to-end
  (it was added to the key function but never actually passed from
  `LayersRow`/`useThumbnail` on the first pass — caught by a second reviewer
  agent tracing the call chain).
- **Thumbnail cache key ignored geometry.** Only `fill` was hashed; resizing
  an ellipse or reshaping a path without touching its fill left a stale
  cached thumbnail indefinitely (previously masked by every mount doing a
  full re-render). Now hashes `shape` too.
- **`presenceStore.setPresence` mutated its array in place**, which — now
  that `presences` is wired into the `React.memo`-wrapped `LayersRow` — could
  silently skip a re-render when a second collaborator's presence landed on
  an already-present node. Now always produces a new array.
- **Canceling an inline rename while isolated also exited isolation mode**:
  the rename `<input>`'s Escape handler didn't stop propagation, so the
  keydown bubbled to the tree's own Escape-exits-isolation handler. Fixed
  with `stopPropagation()`.
- **"Publish to Library" was gated on `state.selection` instead of the
  right-clicked node**, so right-clicking a valid component master that
  happened to be part of an existing multi-selection incorrectly disabled
  the action. Now gated on `contextMenu.id`.
- **Clipboard write failures were reported as success** ("package copied to
  clipboard" even when `navigator.clipboard.writeText` rejected or wasn't
  available). Now the announcement reflects the actual outcome.
- **Isolating a node while a filter/search matched nothing inside it blanked
  the entire tree**, including the isolated node's own row — contradicting
  isolation's whole purpose of staying anchored. The isolated root is now
  pinned (always shown) regardless of filter match; only its descendants are
  still filtered normally.
- **Roving-tabindex focus effect re-ran on every unrelated document edit**
  (rename/recolor/etc. elsewhere in the tree), not just on real focus
  movement, because it depended on the whole `entries` array reference
  rather than the specific focused node id.

**Noted but not fixed this pass** (real, lower-severity, or requiring larger
follow-up work):
- Long keyboard jumps (Home/End on very large documents) can leave real DOM
  focus one row behind the visual highlight, since the virtualizer mounts
  the target row asynchronously and the focus-follow effect has no retry.
- The search-index incremental-update machinery runs its diff+patch on every
  document edit regardless of whether search is active, and duplicates an
  `O(n)` `computeDocumentDiff` scan `useFlatTree` already does separately —
  a real inefficiency, but restructuring either hook to share one diff
  result is a bigger change than fits this pass.
- `usePresence`'s "re-render on any change anywhere" design, combined with
  `SortableVirtualRow` not being memoized, means one collaborator's presence
  update re-renders every visible row — moot until a real collaboration
  backend exists to trigger it at all.
- `layerBulkOperations.ts`'s three `find*Ids` functions (and its three
  `bulk*Doc` setters) are near-identical copies differing only in predicate/
  field; a generic `findMatchingIds`/`bulkSetNodeFieldDoc` would remove the
  duplication.
- `useFlatTree`'s "did anything relevant change" fast-path check is
  duplicated across two call sites and six separate refs — structurally the
  same shape as the bug this pass just fixed, so the next new filter
  dimension could just as easily reintroduce it.

## Roadmap — explicitly deferred, with rationale

- **Canvas-side isolation enforcement.** Today's isolation mode only filters
  the *panel* tree; the canvas still lets you select/edit objects outside the
  isolated subtree. Real enforcement means either restricting hit-testing in
  `SelectTool.ts` or dimming non-subtree content in the render path
  (`CanvasArea.tsx`/`sceneCompositing.ts`) — both are broader, higher-risk
  surfaces than the Layers Panel and deserve their own co-designed pass
  rather than a rushed partial guard bolted onto this one.
- **Full Library management panel.** The publish entry point above proves
  the data layer end-to-end, but there's no install/browse/version-update UI
  yet (`installLibrary`, `hasLibraryUpdates`, `listLibraryComponents` are all
  unused by any component). A real "Library" panel is a separate,
  panel-sized feature.
- **Real-time collaboration backend.** `presenceStore`/`PresenceIndicator`
  are now wired into the rows, but there is still no networked presence
  source (no CRDT/Yjs/websocket) populating the store — it's client-only
  scaffolding for a future sync phase.
- **Consuming `order` for actual paint order.** Every mutating op already
  writes a `fractional-indexing` `order` string per node, but paint order is
  still determined by array position (`children`/`rootChildren`), per
  `document.ts`'s own comment that this is deferred to a Phase-2 CRDT sync
  layer. Not touched here — it's sync-architecture scope, not a panel fix.
- **Cross-page drag-and-drop in the tree.** `useFlatTree` only ever flattens
  the *active* page's content, by design — dragging a layer directly from one
  page to another isn't possible from the panel. Making multiple pages
  simultaneously drop-targetable is a real UX question (should another
  page's content be visible while you're on a different page?) that needs a
  product decision, not a silent architecture change.
- **Rust engine hierarchy mirror.** `strata-bridge`'s `SceneNode` only
  represents flat shape primitives — it never sees groups, frames,
  components, or pages as such; something upstream flattens the rich
  `@varve/scene` `Document` before it reaches the native renderer. This
  affects native-render/export fidelity for complex hierarchies, not the
  Layers Panel UI itself; out of scope here.

## Test strategy note

Every fix above followed TDD: a test was written (or an existing test was
shown to pass against a hand-reimplemented stand-in rather than real code,
per #4) before the corresponding fix landed. New/changed test files:
`dragMove.test.ts`, `keyframeCounts.test.ts`, `libraryPublish.test.ts`,
`useThumbnail.test.ts`, plus extensions to `useFlatTree.test.ts`,
`layerSearchIndex.test.ts`, `layerBulkOperations.test.ts`, `LayersRow.test.tsx`,
`__tests__/PresenceIndicator.test.tsx`, and `PageNav.test.tsx`.
Q