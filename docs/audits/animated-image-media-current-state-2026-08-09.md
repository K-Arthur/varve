# Animated Image / Media System — Current-State Audit (2026-08-09)

Pre-implementation audit for the animated-image timeline and animated raster
media pipeline. Research only; no code changed.

## 1. What exists today

### 1.1 Motion / timeline (the property-animation timeline)

- Playback clock: `packages/editor/src/timeline/TimelineEngine.ts` — RAF-driven,
  all times in **milliseconds**, delta clamped to 100 ms, driven through the
  coordinated editor frame scheduler (`performance/editorFrameRuntime.ts` →
  `requestEditorFrame(key, 'canvas', cb)`), not its own RAF. `seek()` is the
  authoritative scrub path.
- Time distribution: `TimelineEngine.onFrame(ms)` → `MotionFacade` →
  `MotionProvider` → `patch({ motion: { currentTime } })` on `EditorState`
  (React state, re-renders consumers at display rate during playback).
- Model: `packages/scene/src/motion-types.ts` — `Timeline { duration, tracks,
  markers }`, `AnimationTrack { nodeId, property, keyframes }`, keyframes are
  normalized `progress` 0–1 of timeline duration. `TimelineSampler.sampleTimelineAt(doc,
  timelineId, timeMs)` → per-node property overrides, applied in
  `CanvasArea.drawContent` (CanvasArea.tsx:1731-1746) and in video export
  (`motion/videoExportBridge.ts` `applyTimelineOverrides`).
- Stepping: fixed 100 ms (`TimelinePanel.tsx` handleStepForward/Backward,
  `TimelineRuler.tsx` Arrow keys). No FPS, no frame-based stepping anywhere in
  the playback path.
- No media concept: no clips, no time-varying image content. `AudioSyncTrack`
  is a Phase-5+ type-only stub. Onion skin quantizes time to 60 fps
  (`OnionSkinOverlay.tsx`) and re-samples the document at ±n·16.67 ms.
- Video export infra exists: `createVideoFrameRenderer` (OffscreenCanvas +
  `flattenVisibleNodesForVideo` + `sampleTimelineAt` + `buildIr` + `replayIr`)
  sampled at fps by `engine/src/videoExport.ts` (WebCodecs → mp4-muxer /
  webm-muxer; MediaRecorder + PNG-sequence fallbacks in `videoEncoder.ts`).

### 1.2 Scene / document model

- Single asset type `DocumentAsset` (`packages/scene/src/types.ts:573`):
  `{ id, storage: 'embedded', mimeType, dataUrl, naturalWidth, naturalHeight,
  byteLength, hash, metadata? }`. Content-addressed via `hashContent` (FNV-1a,
  16 hex); `findOrCreateEmbeddedAsset` dedups. Bytes live once in
  `Document.assets`; per-placement `ImageFillData.assetId` + fit/crop/rotation/
  flip on the fill (`types.ts:611`).
- Schema `CURRENT_DOCUMENT_VERSION = '2.18'`; migration pattern: new file
  `version-migrations-vNNN.ts`, `{from,to,migrate}` entry in `version.ts`,
  extend `SUPPORTED_VERSIONS`, pure + idempotent, set `formatVersion`.
- Undo = full immutable Document snapshot stack (`context/useHistory.ts`),
  `pushUndo` on every `updateDoc`; playback precedent: the motion tick uses
  `patch()` (state-only) and never touches the document — so playback must
  follow the same rule and will create no undo/autosave entries.
- Clipboard: `ClipboardData { nodes, assets, ... }`; paste merges asset tables
  by id (`insertImportedSubtree`, context.tsx:541-570). Assets are shared, not
  duplicated.

### 1.3 Raster / render pipeline

- `ImageCache` (`engine/src/imageCache.ts`): HTMLImageElement LRU, 200
  entries / 256 MiB default, byte-estimate = w·h·4, oversize rejection,
  `subscribe(src, cb)` / `subscribeGlobal(cb)`. Static only.
- `imageResourceRegistry.ts` (new): handle `asset-<hash>` → data URL,
  registered by `sceneToEngine.rewriteImageFillSource`. Render IR carries the
  short handle, not bytes. **No time-variance support.**
- Main-thread replay chokepoint: `resolveReplayImage(src, lookup, cache)`
  (`engine/src/mockup/warpReplay.ts:44`) — consulted by `paintImageFill`,
  `paintPatternFill`, `paintWarpedImage`, alphaMask path. A module-level
  `imageLookupForCurrentReplay` is set per `replayIr` call (worker path maps
  IR identities to worker-resident ImageBitmaps).
- Worker path: `collectImageBitmaps` (editor) keyed by IR identity →
  `reconcileImageBitmapMap`; re-post gated by `bitmapIsCurrent` =
  docVersion/camera/viewport/dpr — **time-blind**. `WorkerRenderCommand`
  already has an unused `renderRevision` field.
- Invalidation: doc-diff effect → `SubtreeIrCache.invalidate()` per change;
  motion playback re-enters via `motionStamp` in the redraw snapshot
  (`canvas/redrawCoordinator.ts`) → reason `'animation'` → content frame.
  Nodes in the active timeline have their per-node IR cache disabled
  (CanvasArea.tsx:1751-1764) — the precedent for animated-media nodes.
- Culling: `isWorldRectInViewport` / container-bounds culling exists
  (`canvas/cameraState.ts`, CanvasArea walk) — offscreen-ness is computable.
- Memory budgets: `canvas/memoryBudget.ts` (imageCache 256 MiB, worker bitmaps
  128 MiB, …); `RenderBitmapBudget` admission gate; `frameScheduler` has an
  unused `background` lane.
- Thumbnails: engine `thumbnail/service.ts` preloads image sources through the
  shared ImageCache (1500 ms timeout, 2048 px caps) — single frame at
  generation time; editor `thumbnail/` (doc thumbnails, version queue 120×90).

### 1.4 Import

- Entry points: Shell file picker, HTML5 drop, Tauri native drop
  (`platform.readFileBytes`), clipboard (navigator + captured DOM event +
  Tauri `read_clipboard_image_png`). All funnel into
  `ImportService.importFiles` (`@varve/import`).
- Detection: content sniffing `detectImageMime` (magic bytes) — not
  extension. Dimensions header-parsed only (`getImageDimensions`); no browser
  decode at import.
- **Animated GIF is deliberately rejected** at
  `packages/import/src/rasterInspection.ts:106-109` (`gifFrameCount(bytes) >
  1` → throw). `RasterInspection.animation` exists but only for GIF.
  APNG is sniffed as plain PNG; animated WebP as plain WebP (would import as
  frame 0 silently).
- Limits: 128 MiB encoded / 65 535 px/axis / 64 MiPixels; per-file failures
  don't abort batches.

### 1.5 Export

- Static raster: `exportNodeAsRaster` → `flattenSceneToEngine` +
  `preloadEngineImages` (`getImageCache().load(src)`) + `replayIr` →
  encodeRasterSurface. Single frame — whatever the cache serves.
- GIF: full TS encoder `engine/src/gifExport.ts` — `exportTimelineToGif(
  renderFrame, durationMs, { width, height, fps, repeat, signal })`; median-cut
  quantizer, LZW, transparency when alpha < 128, **no dithering**, `quality`
  option unused; ExportDialog button fixed at 10 fps, repeat 0.
- Video: `exportTimelineToVideo(..., renderFrame)` — 30 fps, WebCodecs +
  muxers; `videoExportBridge.renderFrame(timeMs)` samples the timeline
  deterministically. E2E-gated on VideoEncoder availability.
- No APNG / animated WebP export anywhere. `capabilities.ts` marks only `gif`
  as `animation: true`. No Rust-side raster encoding.

### 1.6 Toolchain (confirmed for decoder providers)

- Rust workspace has `image = "0.25"` (varve-bgremove, varve-upscale).
  Lockfile already contains `gif 0.14.2`, `png 0.18.1` (APNG built-in),
  `image-webp 0.2.4` — the latter exposes `WebPDecoder { is_animated,
  num_frames, loop_count, read_frame (composited full canvas), set_memory_limit,
  reset_animation }`. No new downloads needed for a native decoder.
- WASM: wasm-pack `--target web` → `apps/desktop/public/wasm/varve_wasm*`;
  existing glue pattern in `crates/varve-wasm` (JSON-string in/out today;
  `Uint8Array` transfer is available via js-sys for media bytes).
- WebKitGTK (desktop runtime): no `ImageDecoder`/`VideoFrame` — a native IPC
  or WASM fallback is mandatory. Chromium web path has `ImageDecoder` (GIF,
  WebP, AVIF; **not** APNG).

## 2. Gaps versus the target architecture

| Area | Today | Needed |
|---|---|---|
| Detection | GIF frame count only; APNG/WebP not detected | Content-level animation probe for GIF/APNG/WebP + static disambiguation |
| Asset model | `DocumentAsset` has no animation fields | Optional animation metadata on the asset (bytes stay authoritative) |
| Usage model | Fill has no media settings | Per-usage media settings (offset, in/out, rate, loop, poster) |
| Decoding | Browser `new Image()` → first frame only | Provider chain: ImageDecoder → native IPC → WASM → TS-GIF; shared compositor |
| Composition | None (no animated content) | Centralized disposal/blend/rect compositor; composited-frame checkpoints |
| Timing | Fixed 100 ms stepping | Cumulative per-frame timing table + O(log n) time→frame resolution |
| Playback | Motion clock only | One media clock slaved to motion; per-usage frame resolution; changed-frame invalidation |
| Cache | Static HTMLImageElement LRU | Byte-budgeted composited-frame cache (bitmap-owning, LRU, checkpoint support) |
| Rendering | Time-blind IR + worker re-post | Per-usage `frame` identity in IR, animated nodes excluded from IR cache, main-thread replay seam, worker gating conservative-first |
| Export | Frame 0 by accident | Deterministic poster policy; video export resolves media at sample time; GIF export of media with source timing |
| UI | — | Inspector animation section, timeline frame strip, frame stepping, layers badge |
| Schema | 2.18 | 2.19 additive migration (optional fields only) |

## 3. Constraints discovered (must not violate)

1. CanvasArea.tsx / Shell.tsx are over their import budgets — no new imports
   into them; wire through adapters (`packages/editor/src/media/`).
2. `replayIr` is the hot path (complexity 650, ceiling 200 per-function is
   exceeded at file level with documented exceptions) — the media seam must
   NOT add work per static image fill; keep it a no-op fast path.
3. Playback must never touch the document (no undo/autosave entries) — `patch()`
   only, matching the motion tick precedent.
4. Static image behavior must not regress: probe/decoder/cache work must be
   zero-cost for assets without animation metadata.
5. Migration must be additive + idempotent; old static documents must not grow
   animation structures; canonical hash (`canonical.ts` DOCUMENT_KEY_ORDER)
   must include new fields deterministically.
6. Schema 2.19 is the next free number (2.18 current; iccProfiles comment says
   "v2.19+" — verify before consuming).
7. Vitest default environment for engine tests is `node` — the compositor,
   resolver, probe, cache must be DOM-free (pure RGBA math); DOM providers
   gated by capability detection, unit-tested with fakes.
8. E2E on CachyOS must be isolated per agent (worktrees, ports, results dirs).
