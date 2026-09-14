# Image Trace System

Current state: 2026-09-14 (preview fidelity, provenance v2, preparation and
structure completion).

Image Trace converts a selected raster image into editable vector artwork.
Desktop builds run a native Rust engine; web builds use bounded TypeScript
fallbacks with honest capability gating. The feature is reachable from the
Object menu (Vectorize Image), the canvas and layers context menus, the
command palette (Ctrl+Alt+Shift+T), the Inspector Image & Vector section, and
the QuickBar.

## Pipeline overview

```
select image → open dialog → prepare (bounded) → preview (≤1024 px)
                                       ↓
                      provider chain (native → worker → direct → wasm)
                                       ↓
   preview: fitted display paths (same fit as insertion) → canvas
   apply:   re-run prepared source at ≤4096 px → insertTraceGroup
```

- **Preview** runs at ≤ 1024 px (`MAX_PREVIEW_DIM`), debounced 250 ms, with
  per-request cancellation and stale-response rejection
  (`VectorizationSession`). Preview payloads include the bounded source, the
  prepared raster, the raw result, and display geometry fitted exactly like
  insertion (`buildDisplayPaths`).
- **Apply** re-runs the same settings at ≤ 4096 px (`MAX_FINAL_DIM`) and
  commits one undoable `insertTraceGroup` (or `replaceTraceGroup` for
  re-traces).
- **Rendering rules**: the prepared/source raster is drawn through a bitmap
  canvas with `drawImage` — `putImageData` ignores the transform and
  `globalAlpha` per the canvas specification. Paths are traced with cubic
  handles using the renderer's offset semantics. Artwork paint never follows
  the UI theme; theme colors are chrome only.

## Preview modes and diagnostics

The dialog exposes Source / Prepared / Overlay / Vector views plus an anchor
overlay and a 1:1 zoom, all rendered from the existing preview payload (no
re-trace). Diagnostics report paths, points, holes, omitted holes, complexity,
the provider that actually produced the result, and the effective trace and
source dimensions. Downsampled previews are labeled; detail lost to
downsampling is never claimed to be recovered by matching a tolerance.

## Source preparation

Preparation is pure functions over ImageData applied before provider dispatch,
so every provider (native included) sees identical pixels:

- denoise (box blur), grayscale, contrast, brightness, invert
- fixed binarize using the **trace threshold** (not a hardcoded 128)
- adaptive Bradley–Roth threshold (local mean, window + sensitivity) for
  uneven scans
- explicit **border-connected near-white background removal**: only white
  pixels reachable from the image edge become transparent; enclosed white
  counters survive. This replaced a hidden "skip near-white buckets >40%"
  heuristic that could silently drop white artwork. Presets aimed at photos
  and pixel-art turn it off to preserve exact pixels.

## Provider chain and capability gating

`TRACE_PROVIDER_CHAIN` (`packages/engine/src/upscaleProviders/traceDispatch.ts`):

| Provider | Desktop (Tauri) | Web | Supports |
|---|---|---|---|
| native-trace | 1st | — | monochrome, grayscale, color, pixel-art, centerline; progress; cancellation; structure |
| worker-trace (TS) | fallback | 1st | monochrome, grayscale, color, pixel-art (no centerline); structure |
| direct-trace (TS) | fallback | 2nd | monochrome, grayscale, color, pixel-art (no centerline); structure |
| wasm-trace | fallback | 3rd | monochrome only |

`traceCapabilityReport(options)` returns `{ available, reason, providerIds }`;
the dialog uses it to disable centerline (with a reason) on web builds.
`dispatchTrace` attaches the winning `providerId` to the result, and
provenance records that id — the engine label is no longer guessed from the
environment. The native adapter translates the editor's two-dimensional mode
contract at the wire boundary: `pixel-art` becomes Rust's `pixel_art`,
grayscale is converted to Rec.709 luminance before encoding and receives its
bounded color count, and monochrome sends `0` so the native sanitizer does not
reinterpret the request. This preserves the TS and native meaning of grayscale
even though the Rust wire schema has no separate grayscale flag. For its supported
monochrome mode, the WASM facade passes corner angle, maximum fitting error and
source-pixel simplify tolerance to the same
Rust trace path as desktop; older generated artifacts fall back safely to
their legacy entry point.

## Native engine (crates/varve-trace)

- **Modes** (`TraceMode`): `Silhouette` (filled contours), `Centerline`
  (Zhang-Suen thinning → branch extraction → Bézier fitting), `PixelArt`
  (exact/near-exact color regions as pixel-aligned polygons).
- **Contours** (`contours.rs`): 4-connected components, unit boundary-edge
  chaining (mirrors the TS `traceMaskLoops`), cyclic collinear collapse,
  winding-number hole pairing with smallest-containing-outer ownership.
  Correct for 1px rings, nested holes, islands, and image-edge regions.
- **Hole pairing** is shared by silhouette, color, and pixel-art output:
  outers are sorted by true shoelace area (`sort_paths_by_area_desc` uses the
  polygon area, not a bounding-box sum), holes attach to the smallest
  containing outer, and unpaired holes are reported in `omittedHoles`.
- **Structure** (`Structure::Cutout` | `Stacked`) for multi-color modes:
  - `cutout`: abutting regions with evenodd holes attached.
  - `stacked`: back-to-front paint order; a hole is kept only when the pixel
    behind it is transparent or belongs to a color that emitted no paths
    (probed with even-odd point-in-polygon on the raw pixel loop). Regions
    that will be painted later cover their holes, removing the seam/speck
    failure mode without silently merging any region.
  - Monochrome ignores structure and always uses compound holes.
- **Quantization** (`quantize.rs`): median-cut in Oklab (Ottosson 2020).
  Pixel-art uses an exact-color palette with perceptual merging (≈ 0.05
  Oklab) and a median-cut fallback above 256 unique colors.
- **Preview/final resolution**: preview and memory-capped final rasters scale
  distance, area, and centerline-width settings into their prepared pixel
  space before dispatch. Stored settings remain source-pixel values, so a
  1-pixel error budget means the same source-space deviation at any safe
  tracing resolution.
- **Centerline loops**: an endpoint-free skeleton is walked with
  direction-preference so genuine closed loops are extracted as `closed: true`
  branches (excluding the repeated start point) and fitted as closed curves;
  insertion keeps them stroked, never filled. Mixed skeletons with endpoints
  keep the existing arm decomposition at junctions.
- **Cancellation**: `TraceCancellation` (Arc<AtomicBool>) polled inside
  assignment/contour/centerline loops; partial results are discarded.
- **Progress**: stage callbacks (`preprocessing/quantizing/segmenting/
  tracing/fitting/done`) — reported only between deterministic sections, so
  parallel scheduling never changes output.
- **Determinism**: scan-ordered seeds/edges, sorted palettes, no rayon in
  pixel-art; output is scheduling-independent.

## Native IPC (apps/desktop/src-tauri)

- `trace_image` / `trace_image_binary` — async commands; the engine runs on
  `spawn_blocking` so the UI thread never blocks.
- `begin_trace_job` / `cancel_trace` — single-job registry with an execution
  gate (one trace at a time; 4 GB tier).
- `trace:progress` events `{ jobId, stage, progress }`.
- `sanitize_trace_options` clamps all untrusted options. Limits: 128 MB input
  bytes, 64 MPixels decoded, 100 k paths, threshold 1–254, colors 0–64,
  corner angle 90–180, max error 0.01–10, simplify tolerance 0–10 source
  pixels, stroke width 0.5–100.
- Decode safety: dimension pre-check via `ImageReader::into_dimensions()`
  before full decode (decompression-bomb guard), u64 pixel math, format
  sniffing (extensions are never trusted).

## Wire contract

- Request: PNG bytes (raw binary body) + options header
  `x-varve-trace-options` (camelCase, serde `rename_all = "camelCase"` —
  snake_case keys are silently ignored). Includes `structure`
  (`cutout` | `stacked`), `compoundHoles`, and every fitting/prep-adjacent
  option; sanitized server-side.
- Response: `{ paths: BezierPath[], omittedHoles }` where
  `BezierPath = { points, closed, fill?, holes? }`; points may include
  `handle_in`/`handle_out` cubic offsets. Centerline paths are `closed: false`
  for arms and `closed: true` for loops, and carry `strokeWidth` at the
  RasterTracePath level.

## Scene integration

- `insertTraceGroup` places a group beside the source (single undo entry),
  mapping source pixels → document space (scale from image shape
  dimensions), retaining native cubic handles, with evenodd compound holes
  and `ManagedColor` fills.
- Centerline results become stroked paths (round caps/joins, per-path width,
  transparent fill). Mode decides fill vs stroke: closed centerline loops stay
  stroked instead of becoming filled blobs.
- `GroupNode.traceMetadata` (schema v2; v1 still loads) stores reproducible
  provenance: source node id, full option set, the **preparation stack**, the
  **provider id that produced the result**, effective trace and source
  dimensions, a source identity hash, engine label, stats, and timestamp — no
  raster bytes. It survives save/load and undo.
- **Edit Trace / re-trace**: context menus on trace groups restore stored
  settings (`settingsFromTraceMetadata`, including prep), warn when the
  source identity changed under the same node id, and Apply calls
  `replaceTraceGroup` (removes the old group, inserts at the same paint
  order, one undo entry).

## Color management

Palette extraction and region merging run in Oklab (perceptual); pixel
assignment uses Oklab distance. Inserted fills are sRGB `ManagedColor`
(`{ space: 'rgb', r, g, b, a }`). Source profiles are honored at decode by
the image pipeline; tracing itself operates on decoded RGBA. Fully
transparent pixels are excluded from palette extraction, so their RGB cannot
pollute the palette.

## Pixel-art specifics

- Nearest-neighbor downsampling (never bilinear) for previews and finals.
- Exact colors kept while within budget; near-equal colors merged
  perceptually; beyond 256 unique colors median-cut takes over.
- 4-connected regions (diagonally touching pixels stay separate), collinear
  collapse, unit-rect fallback for sub-pixel clusters, hole pairing.
- The pixel-art preset disables background removal so exact-color promises
  are not silently violated.

## Quality gates

- Rust unit tests: thresholding, quantization, components, contour/hole
  invariants, structure (stacked covered-hole dropping, transparency hole
  keeping), centerline closed loops, pixel-art, cancellation, determinism,
  degenerate inputs, wire compat (75 tests in varve-trace; 5 trace tests in
  the Tauri crate).
- TS engine tests: contour/hole goldens, output structure, no hidden white
  dropping, provider identity through dispatch.
- Editor tests: preview display-path fitting and canvas command streams,
  preparation (adaptive threshold, border-connected background removal),
  insert/stroke/metadata/re-trace, menu snapshots.
- E2E: `tests/e2e/canvas/image-trace.spec.ts` (menu trace + single undo,
  pixel-art preset, Edit Trace round trip, pixel-level preview hole/paint
  checks, theme independence, prep restore + provider reporting,
  cancel/resume, review screenshots).

## Known limitations

- Centerline is native-only; web builds disable it with an explanation. The
  TS fallback throws rather than substituting filled outlines.
- WASM provider remains monochrome-only.
- Pixel-art and previews/finals are downsampled above 4096 px; downsampling
  is disclosed and the effective resolution is recorded in provenance.
- Visible-appearance tracing (crop/mask/adjustment/effect compositing before
  trace) is not implemented — tracing always uses the source pixels. The
  dialog now states this when the source has appearance overrides.
- Abutting (`cutout`) color regions are simplified independently, so hairline
  seams remain possible at high simplification tolerances; `stacked` structure
  is the mitigation and shared-boundary (shared-chain) simplification remains
  future work.
- The TS fallback quantizer and the native quantizer are both Oklab
  median-cut but are separate implementations; cross-provider results are
  structurally equivalent, not pixel-identical.
- Export of traced results uses the standard SVG/PDF scene export — no
  trace-specific export paths exist.

## References

- ADR-0170 — decisions behind this system (with 2026-09-14 amendment).
- `crates/varve-trace/src/` — engine.
- `packages/engine/src/rasterTrace.ts`, `upscaleProviders/` — TS fallback +
  dispatch.
- `packages/editor/src/components/Vectorize/` — dialog/workflow.
- `packages/editor/src/logo/vectorization/` — settings, prep, preview,
  metadata.
- `packages/editor/src/imageOperations.ts` — insertion/re-trace ops.
- `docs/agents/trace-research-2026-09-13.md` — research record and failure
  modes.
- `docs/audits/image-trace-preview-fidelity-2026-09-14.md` — verified
  root causes and validation evidence.
