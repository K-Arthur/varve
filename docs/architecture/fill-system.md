# Fill System

Non-solid fills in the Inspector: gradient, image and pattern fills, plus
the multi-fill stack they share with solids. This document describes the
data model, the Inspector interaction model, renderer semantics, and the
search/verification history (2026-08-27) behind the current behaviour.

## Model

- Nodes carry `fills: Fill[]` (paint order bottom→top). When present, it is
  authoritative over the legacy `fill: ManagedColor` field
  (`resolveNodeFills` in `packages/scene/src/fills.ts`).
- `Fill` is a discriminated union: `solid` (color), `gradient`
  (`GradientFill`), `image` (`ImageFillData`), `pattern`
  (`PatternFillData`); each carries `opacity`, `blendMode`, `visible`.
- Fill mutations go through the editor context (`updateSelectedFillAt`,
  `addSelectedFill`, `removeSelectedFillAt`, `reorderSelectedFill`,
  `updateSelectedFillGradientAt` in `packages/editor/src/context.tsx`) —
  immutable document snapshots, one undo entry per operation.
- Shared paints (`paintRefs` → document `paints`) are resolved at the
  scene→engine boundary in `packages/editor/src/render/sceneToEngine.ts`
  (`resolvePaintRefs`); the Inspector never edits resolves behind a ref
  it did not create.
- Each fill type keeps its own payload across type toggles (Solid →
  Gradient → Solid keeps the solid colour and the gradient), so switching
  types is non-destructive and deterministic.

## Inspector interaction model

The Fill panel has exactly one creation affordance:

- **`+ Add fill`** opens a menu: Solid, Linear gradient, Radial gradient,
  Image, Pattern. Choosing an item **creates the fill immediately** — one
  click, no intervening state, no second "Add" button.
- An existing fill's **Fill type combo** converts that fill in place
  (immediate document change + canvas repaint). Converting to Gradient
  seeds stop 0 from the current solid colour and stop 1 from a
  complementary-harmony derivation; converting back to Solid prefers the
  previously retained colour, then the gradient's first stop.

Historical note (why the old design was wrong): the panel used to render a
"New fill type" tab group *plus* a separate Add button. The tabs only set
pending state (they looked like commands but were not), and a sync effect
actively reverted the pending type to the current fill's type, so clicking
Gradient/Image/Pattern visibly did nothing and pressing Add then created a
fill of the *wrong* type (solid). Fixed 2026-08-27; the tab group and the
effect were both removed (`FillSection.tsx`).

### Empty-source fills are transparent

Image (src: '') and pattern (tileSrc: '') fills **paint nothing** until a
source is chosen (`replay.ts` `paintFill`). They no longer paint the grey
loading/error placeholder over the objects beneath them — placeholders
exist only for real sources that are actually loading or failed. The
Inspector pairs the transparent render with an explicit empty state
("No image selected — the fill is transparent until you choose one." +
Choose image / Choose tile) so the interaction reads as intentional.

### File picking

The file inputs in `ImageFillControls` / `PatternFillControls` bind their
`change` handler **natively on the input node** (ref + addEventListener).
React's root-delegated `onChange` silently loses the event when the
inspector re-keys the controls' subtree while the OS file dialog is open
(the node detaches while the dialog is still up); a native listener fires
even on a detached node.

## Renderer

| Fill | Canvas2D replay | Worker | WebGPU backend | Native/WASM |
|------|-----------------|--------|----------------|-------------|
| Solid | yes | yes | yes (rect/circle, no paint stack) | yes |
| Linear / Radial / Angular / Diamond gradient | yes (createConicGradient fallback where missing) | yes | batched Canvas2D fallback | yes |
| Image | yes (fit/crop/rotation/flip/tile) | yes (bitmap transport) | batched Canvas2D fallback | yes |
| Pattern | yes (tile, spacing, rotation, dimension guards) | yes | batched Canvas2D fallback | yes |

The GPU backend (`packages/compositor`) is deliberately fail-closed:
`isGpuBatchSupported` routes any item with fills/strokes/effects/filters to
the Canvas2D present backend so no fill semantics are silently dropped.

Empty-src image/pattern fills render transparent in every backend (the
guard is in `paintFill`, shared by all replay paths).

## Async resource lifecycle

- Image/pattern sources load through the engine `ImageCache`; completion
  notifies `CanvasArea` (`imageCache.subscribeGlobal`) which triggers a
  repaint — a loaded image/tile appears automatically, no selection/pan/
  zoom needed.
- Loading state: neutral grey (`#e8eaed`); permanent failure: darker grey
  (`#d5d8db`) for image fills; patterns fall back to a translucent grey
  while decoding and on invalid dimensions (tile size ≤ 0, step < 1).

## Invariants / hygiene

- Fill edits must invalidate the affected object bounds; gradient cache
  keys include stops/rotation/transform/bounds/interpolation; image cache
  keys are the source identity (asset handle or raw source).
- No interaction unrelated to the fill (selection, pan, zoom, tool
  switch) may be required for a change to appear.

## Tests

- Engine unit: `packages/engine/src/replay-fill.test.ts` (gradient,
  image, pattern, empty-src transparency, cache).
- Engine IR regression: `packages/engine/src/patternConversion.test.ts`.
- Inspector components: `ImageFillControls.test.tsx`,
  `PatternFillControls.test.tsx`.
- Playwright (real UI + canvas pixel sampling):
  `tests/e2e/canvas/fill-interaction.spec.ts` (7 specs, incl. /try demo
  parity) and `tests/e2e/canvas/fill-visuals.spec.ts` (screenshot
  evidence set).

## Known limitations

- On-canvas gradient handles (`GradientHandleOverlay.tsx`) exist but are
  not wired: the component derives geometry from the obsolete
  `node.x/y/w/h` shape and needs porting to `node.shape` + world
  transforms and integration into the overlay/pointer system.
- SVG patterns are not supported (arbitrary SVG is not accepted as a tile
  source beyond what `image/*` permits).
- A pattern tile can still show the translucent load-fallback grey for the
  duration of its decode (a normal first-frame loading state); a tile that
  fails to decode stays grey by design (`ImageLoadError` state).

### Historical fixes (2026-08-27)

Two failure modes previously left pattern fills (and occasionally image
fills) on the grey loading fallback even after the source had loaded:

1. **File-pick loss on inspector remount.** The change listener was
   re-attached per render with an effect cleanup, so an inspector subtree
   remount while the OS file dialog was open removed the listener and
   silently dropped the chosen file. Fixed with a node-bound native
   listener attached once per node lifetime (ref-forwarded handler), plus
   a document-capture fallback armed while a pick is pending.
2. **Thumbnail-cache eviction.** The Layers panel thumbnail renderer shared
   the engine's single render-critical `ImageCache`; its `loadAtSize`
   traffic could evict (LRU) a freshly loaded pattern tile between frames.
   Thumbnails now use their own bounded `ImageCache` instance
   (`thumbnailImageCache` in `useThumbnail.ts`), isolating their traffic
   from the render path.
