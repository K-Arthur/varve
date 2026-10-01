# Fill System

Non-solid fills in the Inspector: gradient, image and pattern fills, plus
the multi-fill stack they share with solids. This document describes the
data model, the Inspector interaction model, renderer semantics, and the
search/verification history (2026-09-05) behind the current behaviour.

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

## Pattern repeat model (v2.32)

A pattern is **four distinct things**, and the model keeps them apart so a
change to one cannot silently be a change to another:

| Concept | Where it lives |
|---|---|
| Motif / source tile | `Document.patternDefinitions[id].source`: copied vector mini-scene, embedded raster asset, or procedural recipe; `previewSrc` is a cache |
| Repeat cell + arrangement | Definition `cell` and `repeat`; legacy inline fills still use `spacing`/`gapX`/`gapY`, `arrangement`, `rowShift`, mirror and phase fields |
| Placement of this fill | `PatternFillData.imageWidth`/`imageHeight`, `rotation`, `offsetX`/`offsetY`, `alignment`, and the fill's opacity |
| Reuse across objects | `PatternFillData.definitionId` references one document-level source; shared paints remain a separate fill-stack mechanism |

The Pattern Library in the Inspector can create a definition from selected
artwork (it copies the artwork and leaves the original in place), create a
procedural checker recipe, import a raster tile into the document asset store,
replace a definition source with an embedded raster tile, apply a definition,
edit shared cell/repeat settings, make one selected use unique, and export one
source cell or a rectangular repeat supertile as SVG. The supertile export
supports Grid and the conventional Half-drop/Brick settings, including mirror
parity; unsupported custom stagger fractions are refused. Replacing a shared
source changes all linked uses; make a fill unique first to isolate that
change. Raster definitions also provide seam inspection: a whole-pixel offset
preview cyclically moves existing texels across the tile edges. Applying it
stores a new embedded PNG and updates every linked use; make one fill unique
first to scope the change. This changes phase only and does not synthesize
missing edge content or enable wraparound painting. For vector definitions,
**Edit source motifs** opens a draft with the
repeated preview and per-root translation/rotation controls. Arrow keys nudge
the selected root motif; Done revision-checks and commits the new source and
preview as one history action, while Cancel discards only the draft. This is a
compact root-transform editor, not the full document canvas: nested children,
path points, text, paint, and raster pixels are not editable there. Clipboard
fragments carry the
definitions and assets they reference; paste remaps colliding IDs. Pattern
definitions are additive in schema 2.32, so older `tileSrc` fills migrate
without being rewritten.

One evaluator, `@varve/shared` `patternRepeat`, owns the geometry:
`p(i, j) = phase + i·u + j·v`, with `u = (tileW + gapX, columnShift·(tileH + gapY))`
and `v = (rowShift·(tileW + gapX), tileH + gapY)`. Grid defaults both shifts
to 0; half-drop defaults to a 0.5 vertical offset for odd columns; brick
defaults to a 0.5 horizontal offset for odd rows. The active Canvas2D replay
route delegates from `packages/engine/src/replay.ts` to
`packages/engine/src/patterns/replayPatternFill.ts`; the Inspector preview
(`PatternRepeatPreview.tsx`) uses the same evaluator. A browser pixel regression
found and now guards against a stale grid-only painter bypassing the evaluator.
Compiled vector source tiles include motif portions that cross the cell edge,
enumerated with the same repeat basis and mirror parity. Their SVG preview is a
derived cache, so a cell or repeat-lattice edit invalidates and rebuilds it;
raster source previews remain unchanged when only the arrangement changes.
Neighbor copies are visual only: the current source editor still selects and
transforms canonical root motifs, not individual ghost copies.
`patternCellAt` is
available as an inverse-mapping utility but is not wired to canvas hit testing
or a wraparound editing session yet. Legacy files that only carry a uniform `spacing`
resolve to the lattice they always had (`spacing` feeds both axes when
`gapX`/`gapY` are absent), so an old document renders identically.

### The repeat geometry must survive the engine wire

The Rust engine does not tile patterns — it is a pass-through for fills, and
the TypeScript replayer owns the lattice. That makes the **wire type** load
`IpcEnginePatternFillData` must carry `gapX`/`gapY`/`arrangement`/`rowShift`/`columnShift`/
`mirrorX`/`mirrorY`/`offsetX`/`offsetY`, or the browser's WASM IR path silently
renders a plain grid while the Inspector preview shows the arrangement. Every
new field is optional and skipped when absent, so pre-v2.32 IR stays
byte-identical. `crates/varve-bridge` tests
(`pattern_repeat_wire_tests`) pin both halves: present fields round-trip, and a
legacy pattern serializes without them. This was found by the browser spec
`tests/e2e/canvas/pattern-repeat.spec.ts`, not by a unit test.

Rules the evaluator enforces:

- Non-finite or non-positive tile dimensions and non-positive repeat periods
  are rejected (typed fallback) instead of looping forever.
- Fractional tile sizes, fractional/negative gaps, and negative origins are
  preserved exactly; no cell position is rounded independently, so no drift
  accumulates.
- A destination's instance walk is bounded (`PATTERN_MAX_INSTANCES`), so a
  sub-pixel period over a huge shape cannot launch an unbounded loop. When the
  renderer's explicit walk reaches that budget, it skips the partial field,
  paints a warning hatch, and logs one bounded diagnostic for the lattice.
- `offsetX`/`offsetY` are the lattice phase **inside the object's own
  coordinate space** (the object's bounds are the anchor), so the pattern
  follows the object and camera pan/zoom can never change authored phase.
  Document-origin (shared across adjacent objects) alignment is **not**
  implemented yet.

Rendering: a zero-gap lattice is a pure linear map of the tile, so it uses a
single `createPattern` fill — including the independent half-drop and brick
basis vectors — with no
per-tile overdraw. Non-zero gaps, mirroring, or a target without
`pattern.setTransform` use the explicit bounded walk (row-major, so overlapping
translucent tiles composite in a stable order). Mirrored copies get their own
scoped transform. If that walk would exceed `PATTERN_MAX_INSTANCES`, replay
does not draw an incomplete first portion: it displays an explicit warning
hatch and emits a bounded console diagnostic. The design still needs a more
efficient faithful dense-field path; users should increase tile size or reduce
the painted area before export.

## Procedural patterns (v2.32)

`PatternFillData.generator` is a `PatternGeneratorRecipe`
(`packages/engine/src/patterns/patternGenerators.ts`). **The recipe is the
editable source; `tileSrc` is a derived cache.** The Inspector regenerates the
bitmap when the recipe changes and writes both in one history entry, so:

- reopening a document never re-rolls the artwork;
- pan, zoom, backend switch, and export never re-roll the artwork;
- the same recipe + seed always produces the same tile.

Seeding is deterministic for **every** finite seed, including `0` (the old
`seed ? seededRandom(seed) : Math.random` excluded `0` and the raw LCG was
degenerate). Randomize picks one new seed and persists it.

Seamlessness is a property of the mathematics, not of the drawing calls. Each
generator is a pure periodic field `f(x, y)` over the tile, so
`f(x + W, y) = f(x, y)` and `f(x, y + H) = f(x, y)` by construction; the tile
is that field sampled on the pixel grid. Fixes relative to the previous
implementation:

- **Dots** sit on a jittered `n × n` lattice with wrapped neighbour
  contributions, so an edge dot appears whole on both sides instead of being
  clipped.
- **Crosshatch** draws two genuine 45° line families (the old code drew a
  non-parallel fan) repeating on the axes' gcd period.
- **Hex grid** places hexagon centres on a lattice whose rectangular period is
  exactly the tile, so it is genuinely seamless; a regular hex grid has an
  irrational period that no rectangular tile can reproduce, so the hexagons are
  stretched to the tile's aspect ratio (warned in the UI).
- **Stripes** are constrained to an angle that closes on the tile
  (`W·cosθ` and `H·sinθ` both integer multiples of the half-period); the
  nearest closing angle is used and the substitution is reported. For an exact
  arbitrary angle, rotate the **fill** (`rotation`) — that rotates the whole
  repeat lattice instead of breaking the tile.
- Tile sizes are bounded by a documented per-axis ceiling and a total pixel
  budget, scaled proportionally so aspect ratio survives.

A tile generated procedurally is still a raster; it is not an editable vector
motif, and the UI does not claim otherwise.

## Inspector interaction model

The Fill panel has exactly one creation affordance:

- **`+ Add fill`** opens a menu: Solid, Linear gradient, Radial gradient,
  Image, Pattern. Choosing an item **creates the fill immediately** — one
  click, no intervening state, no second "Add" button.
- An existing fill's **Fill type** select (a labelled control in the row's
  properties grid) converts that fill in place through a listbox (immediate
  document change + canvas repaint). Converting to Gradient seeds stop 0 from
  the current solid colour and stop 1 from a complementary-harmony
  derivation; converting back to Solid prefers the previously retained
  colour, then the gradient's first stop.

### Paint-row presentation (2026-09-16)

- The swatch is a pill that states the paint's value without opening a
  picker: `#RRGGBB` for solids, the paint type otherwise, and `Mixed` when
  the selection disagrees (also named in the swatch's accessible name; the
  type select shows the current type and a filled type icon).
- The fill colour/gradient popover owns a labelled **Blend mode** row under
  the picker (same option groups as Appearance), so a single normal fill
  reaches blend one click from the swatch. The labelled row select and the
  row-menu submenu write the same field.
- Fill edits made through the inspector, contextual toolbar, or gradient
  options enter a named history transaction, including keyboard-driven field
  changes; related document updates therefore undo as one user action instead
  of bypassing persistent history.
- Stacked fills and mixed selections move opacity onto the row's properties
  line so the value readout stays legible; uniform single fills keep it
  inline. Remove is disabled with a "last fill" badge on a single fill
  (removal is a silent no-op there) and direct otherwise.
- `canPaintFills()` (`packages/scene/src/fills.ts`) gates the section and
  the registry entry: groups and line/arrow primitives never paint fills, so
  the section hides and every fill operation skips those nodes instead of
  accumulating invisible state.

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

Pattern imports also capture their document, selected node IDs, fill index,
and source revision when the picker opens. The async result updates only those
still-matching inline pattern fills and merges into their current placement,
so a changed selection cannot redirect the file and newer phase/scale values
are retained. Library source replacement is bound to the definition ID and
revision; a newer shared edit invalidates the pending replacement. Changes to
pattern definitions and embedded assets invalidate the canvas engine-node
memo, because the resolved source is an input to scene-to-engine conversion
even when the node itself did not change.

## Renderer

| Fill | Canvas2D replay | Worker | WebGPU backend | Native/WASM |
|------|-----------------|--------|----------------|-------------|
| Solid | yes | yes | yes (rect/circle, no paint stack) | yes |
| Linear / Radial / Angular / Diamond gradient | yes (createConicGradient fallback where missing) | yes | batched Canvas2D fallback | yes |
| Image | yes (fit/crop/rotation/flip/tile) | yes (bitmap transport) | batched Canvas2D fallback | yes |
| Pattern | yes (shared lattice: grid/half-drop/brick, gaps, phase, mirror, rotation) | no — visible pattern fills deliberately fall back to the main thread (tiles are not part of the worker bitmap transfer) | batched Canvas2D fallback | yes |

Pattern fills use `createPattern` with a composed transform for a zero-gap
lattice (including a half-drop shear) and the bounded lattice walk otherwise.
The worker refusal is explicit, not silent: `sceneHasUnsupportedWorkerRasterResources`
in `packages/editor/src/render/sceneCompositing.ts` routes such scenes to the
main thread, so the pattern is never drawn with missing tiles.

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

### Embedded asset reference guard

Canonical document hashes replace embedded payloads with `asset:<id>`. That is
serialization syntax, not an image URL. `DocumentCodec` rehydrates the
reference to the document asset's data URL and restores `assetId`; the
scene-to-engine adapter performs the same inference for session, clipboard, or
recovery state that arrives without codec normalization. The engine registry
accepts the prefixed form as an alias for a registered handle, so an old
canonical reference cannot leave an image stuck on the grey placeholder.

If the matching entry is no longer in `Document.assets`, the id alone cannot
restore the pixels. The shared cache marks that reference as a typed missing
resource without sending `asset:<id>` to the browser; layer thumbnails and
Inspector swatches use a neutral missing state, and the Inspector's Replace
image action is the recovery path. A backup, recovery snapshot, archive, or
original source containing the bytes is required for the old pixels to return.

## Invariants / hygiene

- Fill edits must invalidate the affected object bounds; gradient cache
  keys include stops/rotation/transform/bounds/interpolation; image cache
  keys are the source identity (asset handle or raw source).
- No interaction unrelated to the fill (selection, pan, zoom, tool
  switch) may be required for a change to appear.

## Tests

- Shared geometry: `packages/shared/src/patternRepeat.test.ts` — lattice
  invariance, fractional/negative origins, negative-index mirror parity,
  bounded walks, inverse `patternCellAt`, cache signature.
- Engine unit: `packages/engine/src/replay-fill.test.ts` (gradient,
  image, pattern, empty-src transparency, cache).
- Engine repeat regression: `packages/engine/src/replay-pattern.test.ts`
  (fallback, rotation transform) and
  `packages/engine/src/replay-pattern-repeat.test.ts` (independent gaps,
  half-drop/brick row shift, the sheared `createPattern` fast path, mirroring,
  phase, balanced save/restore).
- Generator mathematics: `packages/engine/src/patterns/patternGenerators.field.test.ts`
  — per-tile periodicity at fractional and negative offsets, ink-per-period
  against the declared motif geometry (with a negative control that proves a
  clipped tile fails), stripe/diagonal directionality, seed-`0` determinism,
  angle constraint, and the tile-size budget.
- Engine IR regression: `packages/engine/src/patternConversion.test.ts`.
- Scene: `packages/scene/src/fills.test.ts` (constructor, legacy spacing
  mapping) and `packages/scene/src/__tests__/clone.test.ts` (tile-node
  reference remap / foreign-tile release).
- Inspector components: `ImageFillControls.test.tsx`,
  `PatternFillControls.test.tsx` (source reveal, axis-labelled gap/phase
  controls, mirror, generator recipe + derived tile, Randomize, detach).
- Playwright (real UI + canvas pixel sampling):
  `tests/e2e/canvas/fill-interaction.spec.ts` (7 specs, incl. /try demo
  parity) and `tests/e2e/canvas/fill-visuals.spec.ts` (screenshot
  evidence set).
- Paint-row contract: `packages/editor/src/components/Inspector/sections/__tests__/paintRows.test.tsx`
  (value pill, type menu, mixed naming, unpaintable-node exclusion,
  popover blend, stroke dash/per-side/arrowheads/memory) and the
  "Design tab paint rows" block in
  `tests/e2e/inspector/design-tab-audit.spec.ts` with screenshots under
  `reports/inspector-review/paint-rows/`.
- Research: `docs/research/inspector-fill-stroke-research-2026-09-16.md`.

## Known limitations

- On-canvas gradient handles (`GradientHandleOverlay.tsx`) exist but are
  not wired: the component derives geometry from the obsolete
  `node.x/y/w/h` shape and needs porting to `node.shape` + world
  transforms and integration into the overlay/pointer system.
- **Shared definition settings and per-fill placement are separate controls.**
  The Pattern Library edits the shared definition name, cell dimensions,
  gaps, arrangement, and mirror state. Fill placement remains independent.
  A shared page-origin mode is not implemented; phase is anchored to each
  object's own bounds, so adjacent objects cannot yet share one lattice origin.
- The shared evaluator currently supports grid, column-offset half-drop, and
  row-offset brick layouts, plus mirror flags. It does not implement a hex or
  general staggered lattice. Mirror and shifted repeats render in Varve, but
  PDF export warns and omits them; native SVG export currently supports only
  the linked grid subset described below.
- **Source editing and raster seam inspection have different limits.** The Pattern
  Library edits translation and rotation of top-level copied vector motifs in
  a cancelable draft, with a repeated preview and one shared-source history
  commit. It does not enter that source in the document canvas, edit nested
  nodes/path points/text/paint, or map direct clicks on neighbor ghosts back to
  their canonical roots. Raster seam inspection can offset embedded tiles by
  whole pixels (up to 16 megapixels) and save the cyclic shift as a new PNG;
  it reuses existing pixels and cannot repair a discontinuity by inventing
  edge content. There is no wraparound painting tool.
- **Source-tile, repeat-supertile, and applied-fill SVG are different outputs.**
  Export Tile writes one definition source cell into an SVG wrapper; current
  vector previews are embedded as a nested SVG image, not editable motif
  objects. Export Supertile writes a rectangular period for grid and the
  conventional half-drop/brick lattices, including the required alternating
  mirror period. Custom stagger fractions are rejected with an explanation
  when they do not match those built-in arrangements. Applied-fill SVG emits a reusable
  `userSpaceOnUse` `<pattern>` for linked definitions on closed shapes when
  the fill is the only visible fill, uses a grid repeat, has object-local
  phase, and uses supported embedded source content. Unsupported arrangement,
  source, stack, blend, or alignment cases go through the existing raster
  compositor at export resolution and report the reason. Direct codegen calls
  annotate unsupported pattern output rather than claiming vector fidelity.
- **PDF pattern support is intentionally limited and now resource-backed.**
  The desktop manifest builder resolves ordinary raster sources for standard
  PDF, PDF/X-1a, and PDF/X-4. `varve-print` tiles an axis-aligned grid with
  positive independent gaps. Standard PDF preserves tile alpha and fill
  opacity; PDF/X-4 preserves alpha and opacity; PDF/X-1a converts opaque RGB
  tile samples to CMYK. PDF/X-1a omits transparent tiles or non-opaque fills
  with an explicit warning. Shifted arrangements, mirrors, phase offsets,
  rotation, and negative gaps are omitted with a PDF warning rather than
  approximated. The print renderer also omits a fill when its estimated tile
  count exceeds 100,000. The Rust print renderer omits missing sources with a
  warning comment and never represents them as a gray rectangle. Before the
  editor invokes the PDF or PDF/X pipeline, it rejects any visible pattern
  fill with no resolved tile source and reports which source must be replaced
  or reimported; this prevents a valid-looking file with missing artwork.
  Resource detection is covered by `printImageManifest.test.ts`, the PDF/X
  export-service test, and `varve-print` pattern export tests.
- SVG node export emits a native `<pattern>` for the supported linked-grid
  subset above. Unsupported SVG cases use the export compositor's raster
  fallback with a fidelity warning. Other generated code targets continue to
  use their existing flattened/raster fallback; `buildFillSpec` has no vector
  pattern branch.
- The Canvas2D editor preview can show its translucent load-fallback grey
  while a tile decodes; a tile that fails to decode stays grey by design
  (`ImageLoadError` state). PDF/PDF-X export stops before writing when a
  visible tile source is missing. The lower-level Rust print renderer also
  omits a missing resource with a warning comment as a defensive fallback.
- A procedural tile is generated at its own resolution; scaling it up via
  `imageWidth`/`imageHeight` resamples the raster rather than regenerating at
  the higher resolution.

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

### Historical fix (2026-09-05)

Canonical `asset:<id>` references could cross a session or recovery boundary
into live image state. The browser then tried to decode the token as a URL,
while the canvas correctly showed its grey missing-resource placeholder. The
codec, render adapter, and resource registry now repair and resolve this form;
the editor E2E suite covers the visible pixels and screenshot evidence.
