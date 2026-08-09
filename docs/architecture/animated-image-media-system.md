# Animated Image / Media System — Architecture

Status: accepted design (companion ADR: `docs/adr/0215-animated-image-media-system.md`).
Date: 2026-08-09. Current-state audit: `docs/audits/animated-image-media-current-state-2026-08-09.md`.

## 1. Principles

1. **Original encoded bytes are authoritative.** `Document.assets` keeps the
   exact imported file. Full RGBA frame sets are never serialized. Animation
   metadata is probed lazily at import and persisted as optional asset
   metadata; decoded/composited frames are disposable cache state.
2. **One deterministic pipeline.** For a fixed (document, media time, usage
   settings) the same composited frame is displayed — on canvas, in export, in
   video, on any provider. No browser `<img>` autoplay anywhere in the
   rendering path.
3. **Media time is a property of the editor clock, not of nodes.** One media
   clock (slaved to the motion timeline when it plays); every usage resolves
   its own frame from it. Playback never mutates the document.
4. **Composition semantics live in exactly one place** — the TS compositor —
   shared by canvas, thumbnails, export, and every decoder provider. Providers
   return source frames (rect + RGBA + timing + disposal/blend hints); only
   providers that cannot expose raw frames (WebP, ImageDecoder) may return
   pre-composited full canvases, which the compositor pastes verbatim.
5. **Static images must not regress.** All media machinery is zero-cost for
   assets without animation metadata: no probe cost at replay, no cache
   entries, no IR changes, no worker gating.

## 2. Data model (schema 2.19, additive)

### 2.1 Asset-level metadata (`DocumentAsset.animated?: AnimatedAssetMetadata`)

```ts
interface AnimatedAssetMetadata {
  kind: 'gif' | 'apng' | 'webp';
  frameCount: number;
  durationMs: number;            // sum of frame durations
  loopCount: number | 'infinite';
  width: number;                 // animation canvas, not per-frame rect
  height: number;
  frames: AnimatedFrameMetadata[];   // per-frame: durationMs, rect, blend, disposal
  posterFrame: number;           // 0 unless the user changes it (usage-level override)
  decoderVersion: number;        // bump when decode/compositor semantics change
  // source timing policy: durations preserved exactly from the container
  // (GIF centiseconds ×10, APNG num/den, WebP ms).
}
```

Persisted with the asset; validated by `validateDocumentAsset` (optional
field, additive). Source frames' rects/timing come from the container probe,
not the browser.

### 2.2 Usage-level media settings (`ImageFillData.media?: MediaFillSettings`)

```ts
interface MediaFillSettings {
  loopMode: 'source' | 'once' | 'loop' | 'pingpong';  // default 'source'
  rate: number;                    // playback speed multiplier, default 1
  startOffsetMs: number;           // global-time offset at which media time begins
  inPointMs: number;               // media-time in point (trim), default 0
  outPointMs: number;              // media-time out point, default durationMs
  posterFrame: number;             // static-export / thumbnail poster
}
```

Same node may also have ordinary motion tracks (position/opacity/…) — the
media frame is the image content inside the node; the node transform remains
an ordinary property. This is why multi-use of one asset with independent
phase is free: settings live on the fill.

### 2.3 Not in the model

- Playback state (current media time, playing/paused, resolved frame indices)
  is editor runtime state, never serialized, never undoable.
- Source frames are never document structures; no keyframes per media frame.

## 3. Module layout

```
packages/engine/src/media/          # DOM-free core (node-testable)
  types.ts          # metadata, settings, resolved-frame, cache keys, limits
  probe.ts          # GIF / APNG / WebP container probing (sync, bounded)
  tsGif.ts          # pure-TS GIF decoder (LZW) — web fallback + node goldens
  frameResolver.ts  # cumulative timing table, O(log n) time→frame
  compositor.ts     # disposal/blend/rect compositor (pure RGBA)
  playback.ts       # usage settings → frame index at global time (pure)
  frameCache.ts     # byte-budgeted LRU of composited frames (bitmap-owning)
  checkpoints.ts    # composited-frame checkpoint store (byte-budgeted)
  scheduler.ts      # decode/composite request dedup, cancellation, prefetch
  diagnostics.ts    # counters (off by default)
  providers/
    types.ts        # MediaDecoderProvider contract
    imageDecoderProvider.ts   # Chromium ImageDecoder (GIF/WebP/AVIF)
    nativeProvider.ts         # Tauri IPC → crates/varve-media
    wasmProvider.ts           # varve-wasm media bindings
    tsGifProvider.ts          # pure-TS GIF fallback
    dispatch.ts               # provider chain + capability detection
packages/editor/src/media/      # playback + UI wiring (thin adapters)
  mediaState.ts     # EditorState.media runtime shape
  MediaContext.tsx  # sub-context (onReady pattern): play/pause/seek/step
  mediaClock.ts     # RAF job (frameScheduler) advancing media time
  mediaRuntime.ts   # per-usage frame resolution + invalidation bookkeeping
  AnimatedImageCache.ts  # editor-side registry: assetId → session/cache
crates/varve-media/   # Rust decode core (gif/png+apng/image-webp), bounded
crates/varve-wasm/    # + media_* wasm-bindgen glue (same functions)
apps/desktop/src-tauri/  # + media_probe / media_decode_frames commands
```

Hub files (CanvasArea/Shell/context.tsx) get **no new imports**; the editor
media module is imported only by the small wiring sites that already exist
(CanvasArea draw path, MotionContext-like provider mount, inspector/timeline
components).

## 4. Decoder providers

```ts
interface MediaDecoderProvider {
  readonly id: string;
  probe(bytes, opts?): ProbeResult | null;       // sync, metadata only
  isAvailable(format: MediaFormat, signal?): Promise<boolean>;
  decodeFrames(bytes, opts: { start, end, maxWidth, maxHeight, signal })
    : Promise<DecodedSourceFrame[]>;
  close(): void;
}

interface DecodedSourceFrame {
  index: number;
  x: number; y: number; width: number; height: number;
  durationMs: number;
  blend: 'source' | 'over';
  disposal: 'none' | 'background' | 'previous';
  preComposited: boolean;          // WebP/ImageDecoder: full-canvas state
  rgba: Uint8Array;                // rect-sized RGBA
}
```

Chain (first available wins, ordered per runtime — same pattern as
`traceDispatch`):

| Runtime | Order |
|---|---|
| Tauri desktop (WebKitGTK) | native → wasm → ts-gif (gif only) |
| Chromium web | ImageDecoder → wasm → ts-gif (gif only) |
| tests (node) | ts-gif (gif), synthetic frames (apng/webp) |

Provider specifics:

- **native (Rust `varve-media`)** — `gif 0.14` (rects/disposal/delay/
  transparency/interlace), `png 0.18` APNG (`into_apng`: dispose/blend/offsets/
  delay num:den), `image-webp 0.2` (`read_frame`: pre-composited full canvas,
  `loop_count`, `num_frames`, memory limit). Sequential decode; bounded by
  the limits in §8. Exposed as `media_probe(bytes)` and
  `media_decode_frames(bytes, {start, end, ...})` Tauri commands (raw IPC
  binary channel like `trace_image_binary`) and identical wasm-bindgen
  functions.
- **ImageDecoder (Chromium)** — GIF/WebP/AVIF random access, pre-composited
  frames with `VideoFrame.duration` (µs). APNG unsupported → chain falls to
  wasm/ts-gif for APNG. Feature-detected per format; decoder closed on
  eviction of the session.
- **ts-gif** — ~200-line LZW GIF decoder (palette, transparency, interlace,
  GCE, Netscape loop). Used as web fallback and as the node-env golden path.

## 5. Time → frame

`frameResolver.buildTiming(frames) -> Float64Array` of cumulative offsets
(`cum[i]` = start of frame i in ms; `cum[n]` = durationMs). Zero-duration
frames collapse (a run of zero-duration frames resolves to the first
non-collapsed frame; a fully-empty animation resolves to 0). Lookup is binary
search (O(log n)) with exact boundary semantics: `t == cum[i]` → frame i;
`t >= durationMs` → last frame (loop boundary handled by playback layer).

`playback.resolveUsageFrame(settings, timing, globalTimeMs)`:
1. `elapsed = globalTimeMs - settings.startOffsetMs`
2. clamp/iterate through `inPointMs..outPointMs` per `loopMode` (once: clamp;
   loop: modulo; pingpong: triangle wave)
3. `scaled = elapsed × settings.rate`; frame = lookup(scaled)
   (reverse playback is expressed as rate < 0 through the same resolver)

Deterministic: same (time, settings, timing) ⇒ same frame, in canvas, export,
video, tests.

## 6. Composition

`compositor` composites over a canvas-sized RGBA buffer, per frame:

1. apply previous frame's disposal to the working buffer (none: keep;
   background: clear rect to transparent; previous: restore pre-frame state —
   implemented as a saved copy, only when a later 'previous' disposal exists)
2. paste/blend the frame rect (source: replace; over: alpha blend)
3. emit the composited frame (full canvas RGBA)

`compositeRange(state?, frames[], opts)` resumes from a prior composited
state (checkpoint) — used by the scheduler. `preComposited` frames paste the
full canvas (WebP / ImageDecoder), skipping steps 1–2.

Golden tests assert exact pixels for disposal/blend/delta sequences (§11).

## 7. Cache, checkpoints, scheduling

- **Frame cache** (`frameCache.ts`): LRU keyed by
  `(assetId, frameIndex, decoderVersion, maxWidth, maxHeight, colorPolicy)`;
  byte accounting = `width × height × 4` (+ bitmap promotion); budgets from
  `memoryBudget.ts` tiers (default 64 MiB media share; low-memory profiles
  reduce it and disable prefetch); eviction closes owned ImageBitmaps;
  `subscribe(key, cb)` drives re-render on arrival; over-budget single frames
  are served transiently (decode → present → release) rather than rejected.
- **Checkpoints** (`checkpoints.ts`): composited frames at a stride
  (default every 32 frames) stored under a shared byte budget (default 8 MiB),
  evictable, revision-keyed. Seeking to frame N starts from the nearest
  checkpoint ≤ N, then composites the tail.
- **Scheduler** (`scheduler.ts`): per-asset request dedup (two usages of the
  same asset+frame share one job), `AbortSignal` + generation tokens (a stale
  result can never install — latest request wins), prefetch of
  current/next/previous per playback direction, decode-on-demand elsewhere,
  cancellation of speculative work on seek, per-frame budget batching so a
  scrub never queues thousands of decodes.

## 8. Safety limits (all enforced before allocation)

| Limit | Value |
|---|---|
| encoded bytes | 128 MiB (existing import gate) |
| max dimension per axis | 65 535 px (existing) |
| pixels per frame | 64 MiPixels (existing) |
| max frames | 10 000 |
| estimated decoded bytes | 512 MiB (soft; checked pre-allocate) |
| min frame duration | 1 ms (GIF 10 ms centis, APNG min(1, num/den), WebP 1 ms) |
| metadata entries | bounded by frame cap |

Malformed containers (bad chunk lengths, truncated data, zero denominators,
overflowed durations, impossible dims, cyclic metadata) produce typed errors
at probe/decode time; the app shows one nonfatal missing-media state per
asset. No panics (Rust: no `unwrap` on untrusted data, `unsafe_code = deny`).

## 9. Rendering integration

- `sceneToEngine` gains an optional `mediaFrames?: Map<nodeId, number>`
  (per-usage resolved frame); animated fills emit `FillIR.image.frame`
  (default 0 = poster). Nodes whose fills reference animated assets are added
  to the IR-cache exclusion set (same mechanism as motion's `animatedNodeIds`),
  so their per-node IR rebuilds per frame without invalidating the whole
  scene.
- Main-thread replay seam: `resolveReplayImage` consults a new engine-level
  `mediaFrameLookup(src, frame)` hook before the static cache. CanvasArea
  installs it per draw (resolving via the frame cache); export paths install
  it with the poster frame; video export with the sampled time's frame. The
  hook is a no-op when no animated assets exist. This single seam covers
  `paintImageFill`, masks, warps, mockup snapshots, thumbnails.
- Invalidation: the media clock advances `EditorState.media.currentTime`
  (React state, like `motion.currentTime`); CanvasArea re-enters drawContent,
  recomputes per-usage frames, and bumps a `mediaStamp` **only when some
  resolved frame actually changed** (per-usage `lastPresentedFrameIndex`
  bookkeeping) — a node sitting on a 500 ms source frame does not invalidate
  every RAF. Decode completion triggers re-render via frame-cache
  subscription (existing `imageCacheStamp`-style path).
- Worker path: scenes containing animated fills fall back to the main-thread
  renderer initially (conservative; per-frame bitmap transport + budgets are
  a documented follow-up). No other worker behavior changes.
- Offscreen: usages whose node bounds are outside the viewport (existing
  culling) are skipped for decode/prefetch; logical time keeps advancing.

## 10. Playback / editor integration

- `EditorState.media = { currentTime, isPlaying, source: 'media' | 'motion' }`.
- Media clock: one RAF job via `requestEditorFrame(media, 'canvas', cb)` that
  advances `media.currentTime` (delta, clamped like TimelineEngine). When
  `motion.isPlaying`, media time is slaved to `motion.currentTime`
  (single authoritative clock — no second clock runs; scrubbing the timeline
  ruler scrubs media). Play in the inspector (any workspace) starts the media
  clock; motion-mode play keeps the existing motion clock and media follows.
- Frame stepping (inspector + timeline): Previous/Next Frame resolve actual
  frame boundaries from the timing table — never 100 ms steps. ArrowLeft/
  Right when the media strip is focused; Home/End; Space toggles play; Delete
  is reserved (no editable frames in v1); keyboard shortcuts do not fire when
  an input is focused (existing shortcut-guard pattern). ARIA labels:
  "Frame 12 of 48, duration 83 milliseconds" — announced on seek, not per
  playback frame.
- Frame strip: cells sized by duration (with a "uniform frames" toggle for
  dense animations); virtualized rows (cells are absolutely positioned divs —
  O(visible) DOM, not O(frameCount)); playhead overlay synced to media time;
  low-zoom aggregation of dense ticks; click/drag scrubs (latest request
  wins, cancel obsolete decodes).
- Layers panel: "Animated · N frames" badge on animated image rows; static
  rows unchanged. Asset browser/poster: first composited frame (or the usage
  poster) — thumbnails never animate.
- Reduced motion: passive previews stay static; explicit user Play still
  works (Varve convention).

## 11. Export

- **Static policy**: exporting an animated-image node to PNG/JPEG/WebP renders
  the poster frame (usage `posterFrame`, default 0) through the replay seam —
  deterministic, never "whatever is in the cache".
- **Video**: `videoExportBridge.renderFrame(timeMs)` additionally resolves
  media frames at `timeMs` (usage settings applied); video sampling stays a
  pure function of output timestamp. GIF export of timelines unchanged.
- **Media GIF export**: `exportMediaNodeToGif(doc, nodeId, opts)` encodes the
  node's animation with its source timing (per-frame durations, loop count),
  rendering each source frame through the compositor (already RGBA — palette
  quantize + LZW reuse `gifExport.ts` internals). APNG/animated-WebP export
  are documented follow-ups (browser `ImageEncoder` lacks them; a native
  encoder would be a new Rust crate — out of v1 scope).

## 12. Editable frame animation (converted), onion skin for media

Deliberately **out of v1 scope** (design reserved):

- Convert-to-editable-frame-animation: a `FrameAnimation` node whose frames
  reference raster assets + per-frame timing, joined by a disposal policy —
  content-addressed, single doc tree, one undo entry per edit. Deleting/
  duplicating/reordering/painting frames, per-frame duration editing, undo/
  redo/serialization, and onion skin over composited media frames follow that
  model; imported sources stay embedded until converted.
- Onion skin for media: reuses the existing motion onion-skin renderer with
  media-frame sampling (composited frames only).

## 13. Known limitations (v1)

1. Worker renderer excluded for scenes with animated fills (main-thread only).
2. No editable frame animation; no frame painting; no media onion skin.
3. No APNG/animated-WebP export; animated-AVIF import not claimed
   (ImageDecoder-only on Chromium; no native crate) — detected as AVIF static
   if encountered, with a nonfatal notice. AVIF animation is disabled at the
   import gate.
4. WebP decode comes pre-composited from the native decoder (no raw rects) —
   composition semantics are still centralized in TS (paste path).
5. Huge (>2048 px) animated images decode at full size; downscale decode is a
   follow-up (ImageDecoder `scaledWidth` on Chromium; `resize` in Rust).
