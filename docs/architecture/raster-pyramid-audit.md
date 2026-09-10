# Raster pyramid — repository audit & architecture map (2026-08-09)

Status: audit phase of the multi-resolution tiled-pyramid milestone. Read-only;
no code changed. Companion decision: `docs/adr/0214-multi-resolution-tiled-pyramid.md`.

## Executive summary

Varve's raster path is already tile-backed at the data model, already
dirty-tile-optimized at the renderer, and already byte-budgeted at every
intermediate. What does **not** exist is any level-of-detail: `paintRasterLayer`
always materializes a full-layer-sized surface and composites it with one
`drawImage`, regardless of how much of the layer is on screen or at what zoom.
The 2026-08-03 measurement in `docs/perf/raster-tiling-decision.md` shows the
frame budget is blown at 2048² (58.67 ms p95 vs 16.7 ms budget) and the
intermediate alone reaches 256 MiB at 8192² — larger than the entire 128 MiB
worker bitmap budget. Dirty-tile-only replay (the first approved step) is
shipped; visible-tile-only replay and multi-resolution pyramids remain
unimplemented and were previously not approved without further evidence. This
milestone supplies that evidence and, where the measurements justify it,
implements a spatial pyramid that extends — never replaces — the existing
retained-surface path.

## 1. Architecture map — complete raster flow

```text
Document raster source
  ├── paint layer tiles          scene: RasterLayerNode.tiles, 128×128 px,
  │                                Map<"col:row", {pixels, version}> (sparse)
  ├── raster mask assets         document: RasterMaskAsset (whole-PNG dataUrl,
  │                                immutable, content/source identity)
  └── embedded image assets      document: DocumentAsset (content-addressed
                                   asset-<hash> dataUrl, EXIF/ICC metadata)
        │
        ▼  sceneToEngine.ts (flattenSceneToEngine)
render IR
  ├── paint layer → Primitive{kind:'rasterLayer', width,height,pixelMode,
  │                             tiles: Record<"col:row",{pixels:number[],version}>,
  │                             layerId}                       ← TS-stub only;
  │                                                              Rust IR has no
  │                                                              raster variant
  └── image fills → FillIR Image {src: assetId handle}          ← Rust IR path
        │
        ▼  worker: renderWorker.ts replays IR on OffscreenCanvas
resident raster representation
  ├── RasterLayerCache: per-layer OffscreenCanvas surface (keyed by layerId,
  │     128 MiB LRU), dirty-tile-only putImageData uploads, clearRect for
  │     removed tiles
  ├── ImageCache: decoded fills (200 entries / 256 MiB LRU, main thread)
  └── ImageBitmap map: worker-side decoded fills (delta transport)
        │
        ▼  effective scale = camera zoom × DPR × node/ancestor transforms
viewport/LOD selection
  └── NONE today — the whole layer surface is always drawn at any zoom;
      SubtreeReplayCache only buckets IR reuse by (hash, zoom-bucket)
        │
        ▼  CanvasArea.drawContent → compositor.drawVectorItems → replayIr
Canvas2D / worker / compositor
  ├── main-thread Canvas2D replay (structural path, fallback)
  ├── worker OffscreenCanvas → transferToImageBitmap → main presents
  └── compositor: Canvas2D default; WebGPU opt-in (present is always 2D)
        │
        ▼
presentation
  └── presentWorkerFrame / cached-bitmap reprojection (workerBitmapDelta),
      partial-redraw clips when surface matches backing store
```

Edit flow (brush): dabs → `compositeDabOnNode` (scene, premultiplied alpha,
blend-aware, tile version +1) → document mutation → dirty region emits per-tile
`raster-tile` rects (`dirtyRegion.ts:283-297`) → partial redraw replays only
version-changed tiles via `RasterLayerCache` → LRU eviction bounds surfaces.

Undo/redo: document reference swap; no cache-version hooks — the tile version
deltas drive re-upload on the retained surface. The pyramid must follow the
same contract: derived state, invalidated by version deltas, never part of
history.

Export: `exportNodeAsRaster` replays the same IR onto an export OffscreenCanvas
at `scale × (dpi/96)` — single surface clamped to 16384 px / 32 Mi px with a
user warning; no tiled/streamed output. Print: PNG-in-PDF (or native PDF for
pure-vector subtrees); Rust embeds pixels at whatever resolution TS renders.

Save: full-JSON serialization of the document. **Gap: `serializeTiles` /
`deserializeTiles` exist but are not wired into `serializeDocument` — paint
layer tiles currently drop from saved documents** (tiles Map serializes as
`{}`). See finding F1.

## 2. Audit findings by subsystem

### 2.1 @varve/scene — authoritative source model

- `RasterLayerNode` (types.ts:1557-1576): `tiles: Map<string, RasterTile>`
  where `RasterTile = {pixels: Uint8ClampedArray (128×128×4), version: number}`.
  `TILE_SIZE = 128` (rasterLayer.ts:7). `pixelMode` flag on the node.
- Sparse: tiles allocated lazily on first write (`getOrCreateTile`,
  rasterLayer.ts:79-96). Empty layers hold zero tiles.
- Versioning: per-tile monotonic integer starting at 1, `version + 1` per write
  (rasterLayer.ts:458, :602; PaintTool.ts:384). Consumed by
  `changedRasterTileBounds` (dirtyRegion.ts:165-176), the IR content hash
  (`rasterLayerVersionSummary`, subtreeIrCache.ts:48-57), and
  `planTileUploads` (rasterLayerCache.ts:55-77). It is a cache-invalidation
  counter only.
- Tile coordinate helpers: `makeTileKey`/`parseTileKey` (`"col:row"`),
  `tileForPixel`, `tileBounds`, `tilesForBounds` (rasterLayer.ts:14-127).
  **Tile indices are non-negative** (floor of pixel/128). No negative
  coordinates anywhere in the model.
- Compositing ops: `compositeDabOnNode` (premultiplied alpha, 10 blend modes,
  alphaLock), `compositeSmudgeDabOnNode`; erase lives in the editor
  (`PaintTool.eraseDabOnNode`, alpha subtraction). No raster ops in the typed
  op pipeline; raster edits are `updateNode` transactions.
- Serialization gap (F1): `serializeTiles`/`deserializeTiles` (base64,
  rasterLayer.ts:156-176) are referenced only by tests. `serializeDocument`
  (version.ts:931-936) and `DocumentCodec.encode` do plain JSON.stringify —
  the tiles Map round-trips as `{}`. Paint pixels are dropped on save today.
  The canonical-digest path (`canonical.ts`) does handle the Map correctly.
- Raster masks are whole-PNG assets, not tiles: `RasterMaskAsset` in
  `Document.rasterMaskAssets`, caps 16384 px / 128 Mi-px / 128 MiB; brush-painted
  container masks capped at 2048 px in the editor.
- Embedded images: `Document.assets` with `id = asset-<fnv1a64(content)>`,
  `storage: 'embedded'`, full base64 dataUrl; `ImageFillData.src` rehydrated in
  memory from the asset on load. Non-destructive crop/rotation/flip/upscale.
- No mipmap/pyramid/LOD code anywhere in the package. New (uncommitted)
  `packages/scene/src/thumbnail/` is a document-domain source resolver only —
  no pixel work.
- Schema: `CURRENT_DOCUMENT_VERSION = '2.18'` (version.ts:9).

### 2.2 @varve/engine — replay and caches

- `replay.ts` is 3317 lines, `// COMPLEXITY: 650 cyclo`, with
  `paintRasterLayer` at :1986-2074. Drawing: `TILE = 128`; `cache.acquire(
  layerKey, width, height, tiles, TILE)` → dirty-tile upload path when the IR
  carries a `layerId`, else full per-frame rebuild (OffscreenCanvas + per-tile
  putImageData); then **one** `target.drawImage(surfaceCanvas, 0, 0, width,
  height)`. Transform/opacity/blend/mask/filter apply to the finished surface —
  no seams possible today; per-tile drawing would change this (brief §20).
- `RasterLayerCache` (rasterLayerCache.ts, 249 lines): module-level singleton
  per JS realm, keyed by `layerKey` = scene node id; `TileUploadPlan`
  (changed/removed/fullRebuild); `DEFAULT_LAYER_SURFACE_BUDGET_BYTES = 128 MiB`
  (:98) with LRU eviction that never evicts the just-served key; counters
  hits/misses/tilesUploaded/tilesSkipped exposed via `diagnostics`; `setBudget`
  exists but has **no production caller** (F2: not wired to memory presets or
  pressure profiles).
- `rasterSurface.ts`: `DEFAULT_RASTER_SURFACE_POLICY = {maxDimension: 16384,
  maxPixels: 33_554_432}` (32 Mi px = 128 MiB). OffscreenCanvas-first, HTML
  fallback, throws if neither.
- `imageCache.ts`: decoded-image cache, 200 entries / 256 MiB LRU, oversize
  rejection, promise dedup.
- `imageResourceRegistry.ts` (new, uncommitted): handle → loadable source
  name-resolution table; keeps multi-MB data URLs out of the IR.
- Frame/subtree caches: `FrameCache<K,V>` (3-frame sweep, frameCache.ts);
  `SubtreeReplayCache` (compositor/canvas2d/tileCache.ts) keyed
  `subtreeHash:cameraBucket` where `cameraBucket = z{zoom rounded 2dp}:t256` —
  replay-skip only, **not** a spatial tile cache; `SubtreeIrCache` (editor,
  500 entries / 50 MiB soft / 100 MiB hard).
- IR types: `Primitive{kind:'rasterLayer', ..., layerId?}` (types.ts:581-593);
  `layerId` documented as the persistent backing-surface key. `pixelMode` is
  carried in IR but **never consumed by replay** (F3).
- Tile transport to worker: `sceneToEngine.ts:253-274` converts
  `Uint8ClampedArray` to `number[]` via `Array.from` — **4× byte bloat** as JS
  numbers in the structured clone (F4). Tiles are not ImageBitmaps; only image
  fills travel as transferred bitmaps.
- Rust `varve-engine` IR has **no raster variant** — paint layers are
  TS-stub-only (F5); image fills pass as `src` descriptors.
- `rasterReplayMetrics.ts`: opt-in sink (null default), p50/p95 recorder
  (240-sample cap), trigger `evaluateRasterTrigger` (8 MiB intermediate / 0.2
  render share / 0.25 dirty share). Not wired into the editor.
- Bench corpus: no bench exercises `paintRasterLayer` directly; the
  reconstruction measurement lives in `scripts/perf/bench-raster-reconstruction.mjs`.

### 2.3 @varve/editor — worker, budgets, invalidation

- Render worker: `renderWorker.ts` replays IR on an OffscreenCanvas,
  `transferToImageBitmap()` back, latest-only with revision guards
  (`renderRevision`), 5-restart cap, non-retry on transferred/image commands.
  Admission: `RenderBitmapBudget` (128 MiB default; pending+inFlight+resident+
  canvas bytes; over-budget renders refused → main-thread fallback).
- WebKitGTK: worker now ACTIVE after capability-probe gating
  (`workerEligibility.ts`, `offscreenCapabilityProbe.ts`; 2026-08-07 doc);
  `performance.now()` quantized to 1 ms; 16384 px canvas cap.
- Dirty regions: per-tile `raster-tile` rects from tile-version diffs
  (dirtyRegion.ts:165-176, :283-297) → bounded greedy merge (8 rects / 24 px /
  1.5× amplification / 60% viewport fallback) → 40 px margin → prune gate
  (rectsIntersectAny at CanvasArea.tsx:1668) → partial clips (multi-rect or
  union; worker-cached frames force full redraw via `surfaceIsAuthoritative`).
- Adaptive profiles (adaptiveProfile.ts): quality/balanced/performance/
  constrained with hysteresis; performance tier disables the worker, scales
  render 0.75, cacheMultiplier 0.5; constrained 0.5 and partial redraw off.
  Frame budget derived from display refresh (frameBudget.ts).
- Scheduler lanes (frameScheduler.ts): input/canvas/ui/background, 8 ms
  work budget, 120 ms interaction settle before background; **the background
  lane has no production callers yet** — a natural home for pyramid
  generation.
- CanvasArea.tsx draw loop: 3366 lines; complexity 780 vs 630 ceiling (over
  budget per AGENTS.md table — **must not increase**); Shell.tsx imports 46/49.
  Hub-file import rules apply: new pyramid integration must live in thin
  modules, not new hub imports.
- Memory budgets (memoryBudget.ts): per-cache presets low/medium/high
  (subtreeIr 50 MiB, workerBitmap 128 MiB, imageCache 256 MiB default);
  `resolvePressureBudgets` ('normal'/'4gb'/'2gb') exists but is test-only (F6).
- Diagnostics: `?perf=1` handle, frame ring (120 frames), HUD with worker
  budget line, interaction traces, render-path attribution.

### 2.4 Export / print / save / import

- Export = same replay path at export resolution (`exportNodeAsRaster`),
  single surface, 16384 px / 32 Mi-px clamp with warning; tiled export helpers
  exist (`engine/src/export.ts`) but are unwired. Post-pipeline:
  resize→sharpen→colour→dither, tiled resampling parity-tested.
- Print: PNG-in-PDF fallback path; Rust `varve-print` embeds pixels as-is
  (DeviceRGB/CMYK + SMask), no resampling; `enforceDpi` is a preflight check.
- Save: full-JSON; embedded assets are base64 dataUrls; autosave 5 min /
  2 s idle. F1 above means paint pixels are dropped on save (import caps:
  128 MiB encoded / 64 Mi-px / 65535 px max dimension).
- Upscalers tile: native CPU 256-tiles with 16 px overlap; AI 256 core + 32
  padding; content-aware fill and denoise are whole-image. These tilers
  provide proven resampling precedents for the pyramid downsampler.

### 2.5 Rust crates

- `varve-core` Shape enum has no raster shape; `varve-engine` Primitive has no
  raster variant; `varve-wasm` same. Raster pixels never enter the native IR.
  Native value for pyramids is limited to a possible SIMD downsampler behind
  the same deterministic contract (brief §39) — not required for web parity.

### 2.6 Docs / decision state

- `docs/perf/raster-tiling-decision.md` (2026-08-03): trigger MET at 2048²;
  step 1 (dirty-tile-only replay) implemented with 73×-1572× measured speedups;
  **pyramids explicitly "not approved without further evidence"** (:147-150).
  This milestone is that further evidence + implementation.
- No ADR covers image mipmaps/pyramids. ADR-0203: 4 GB RAM target, budgets
  double as security bounds. ADR-0001: IR-replay chosen over pixel-push.

## 3. Measured problem

Existing measurements (decision doc :91-97, lower-bound Node model):
512² 1.58/4.35 ms p50/p95 · 1024² 5.93/10.57 · 2048² 28.57/58.67 (trigger met,
16 MiB intermediate) · 4096² 204.15/252.84 (64 MiB) · 8192² 855.57/968.37
(256 MiB — larger than the entire 128 MiB worker bitmap budget). Tile-replay is
94-99.8% of cost, so work is proportional to tiles touched, not pixels visible.

What the pyramid specifically targets (the "wasteful retained surface"):

1. At low zoom (e.g. 12.5%, fit-to-screen), a 4096² layer draws 1024 tiles
   (~64 MiB intermediate) to fill a few hundred screen pixels. Every pixel
   beyond ~1 per device pixel is dead weight.
2. At any zoom, the whole layer is materialized regardless of viewport
   coverage — a 16384² layer viewed at 100% pan costs the full 1 GiB surface
   budget even when 5% is visible.
3. Zoom-out on a dirty layer rebuilds the full surface per frame (dirty-tile
   path only skips *unchanged* tiles; low zoom has none unchanged in view).
4. `number[]` tile transport (F4) inflates IR structured clones 4×; at
   16384² that is ~1 GiB of JS numbers per worker dispatch.

Measurement gaps to close in the baseline pass (brief §2): browser figures at
zoom 1%-3200% per size, resident bytes, tiles drawn, source pixels touched,
worker transfer bytes, memory high-water, interaction latency, zoom/pan
responsiveness. Run the isolation protocol (brief §56) and record in
`docs/perf/raster-pyramid-baseline-2026-08-09.md`.

## 4. Findings table

| # | Finding | Impact on pyramid design |
|---|---------|--------------------------|
| F1 | Paint tiles dropped on save (serializeTiles unwired) | Pre-existing correctness gap; pyramid work must not entangle; note in docs, do not fix in this milestone unless trivial |
| F2 | RasterLayerCache budget not wired to memory presets | Pyramid residency must be wired to the resolver + pressure profiles from day one |
| F3 | `pixelMode` unused in replay | Pyramid must honor pixel-mode LOD policy (brief §19); currently no renderer consumes it |
| F4 | Tiles cross worker boundary as `number[]` (4× bloat) | Pyramid tile transport must use transferable buffers/ImageBitmap, not number arrays |
| F5 | Rust IR has no raster variant | Pyramid is a TS/webview concern; native provider optional later behind parity tests |
| F6 | Pressure profiles test-only | Pyramid scheduler must consume the existing resolver and prove constrained tiers work |
| F7 | Hub files over budget (CanvasArea 780/630, Shell 46/49) | No new imports in CanvasArea/Shell; integration via adapters (AGENTS.md rules) |
| F8 | Background scheduler lane unused | Use it for pyramid generation; it already respects interaction settle |

## 5. Design constraints derived from the audit

1. Source of truth: scene tiles (`Map<"col:row", {pixels, version}>`, 128 px,
   sparse, non-negative coords). Pyramid is derived, disposable, never
   serialized into the document.
2. Correctness identity for any derived tile must include: layerId +
   revision (tile-version tuple) + level + col/row + resampler version +
   pixel mode (brief §5).
3. Retained whole-layer surface stays the fast path for small layers and
   effect/blend/mask parity cases (brief §10, §21-23); pyramid is a second,
   adaptive path with a measured crossover.
4. Existing dirty-tile flow must remain untouched for small layers; pyramid
   invalidation is version-delta-driven, incremental, ancestor-only
   (brief §12), scheduled on the background lane (brief §33).
5. LOD from effective device-space scale (camera × DPR × node/world
   transforms), not raw zoom (brief §6, §29); hysteresis (brief §7);
   progressive refinement with coarser-ancestor fallback (brief §30).
6. All budgets routed through the existing resolver (brief §34-35); bounded
   queues, cancellation, latest-wins revision safety (brief §14, §31).
7. Export/print never consume display LOD (brief §43-44).
8. WebKitGTK stays first-class: probe-gated workers, 16384 px cap, no
   Chromium assumptions (brief §38).
9. Hot-path rule: any change inside `paintRasterLayer`/`replayIr` must be
   benchmarked before merge; no dispatch-table rewrites (AGENTS.md).

## 6. Reproduce

```bash
node scripts/perf/bench-raster-reconstruction.mjs      # existing lower-bound
git worktree list && git status                        # concurrency hygiene
pnpm test -- packages/engine/src/rasterLayerCache.test.ts  # current pins
```
