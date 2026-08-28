# Image Trace System

Current state: 2026-08-05 (Milestones 1–6 of the native trace program).

Image Trace converts a selected raster image into editable vector artwork.
Desktop builds run a native Rust engine; web builds use bounded TypeScript
fallbacks with honest capability gating. The feature is reachable from the
Object menu (Vectorize Image), the canvas and layers context menus, the
command palette (Ctrl+Alt+Shift+T), the Inspector Image & Vector section, and
the QuickBar.

## Pipeline overview

```
select image → open dialog → preview (bounded) → apply (full resolution)
   load source → bound → prepare → dispatchTrace → insertTraceGroup
                                             ↓
                          provider chain (native → worker → direct → wasm)
```

- **Preview** runs at ≤ 1024 px (`MAX_PREVIEW_DIM`), debounced 250 ms, with
  per-request cancellation and stale-response rejection
  (`VectorizationSession`).
- **Apply** re-runs the same settings at ≤ 4096 px (`MAX_FINAL_DIM`) and
  commits one undoable `insertTraceGroup` (or `replaceTraceGroup` for
  re-traces).

## Provider chain and capability gating

`TRACE_PROVIDER_CHAIN` (`packages/engine/src/upscaleProviders/traceDispatch.ts`):

| Provider | Desktop (Tauri) | Web | Supports |
|---|---|---|---|
| native-trace | 1st | — | monochrome, grayscale, color, pixel-art, centerline; progress; cancellation |
| worker-trace (TS) | fallback | 1st | monochrome, grayscale, color, pixel-art (no centerline) |
| direct-trace (TS) | fallback | 2nd | monochrome, grayscale, color, pixel-art (no centerline) |
| wasm-trace | fallback | 3rd | monochrome only |

`traceCapabilityReport(options)` returns `{ available, reason, providerIds }`;
the dialog uses it to disable centerline (with a reason) on web builds.
For its supported monochrome mode, the WASM facade passes corner angle,
maximum fitting error, and source-pixel simplify tolerance to the same Rust
trace path as desktop; older generated artifacts fall back safely to their
legacy entry point.

## Native engine (crates/varve-trace)

- **Modes** (`TraceMode`): `Silhouette` (filled contours), `Centerline`
  (Zhang-Suen thinning → branch extraction → Bézier fitting), `PixelArt`
  (exact/near-exact color regions as pixel-aligned polygons).
- **Contours** (`contours.rs`): 4-connected components, unit boundary-edge
  chaining (mirrors the TS `traceMaskToPaths`), cyclic collinear collapse,
  winding-number hole pairing. Correct for 1px rings, nested holes, islands,
  and image-edge regions.
- **Quantization** (`quantize.rs`): median-cut in Oklab (Ottosson 2020).
  Pixel-art uses an exact-color palette with perceptual merging (≈ 0.05
  Oklab) and a median-cut fallback above 256 unique colors.
- **Holes**: attached to the outer ring as `BezierPath.holes`
  (evenodd at insertion); unpaired holes are counted in `omittedHoles`.
- **Simplification and fitting**: `simplifyTolerance` is measured in decoded
  source pixels and is applied before cubic fitting for silhouette and
  centerline traces. Compound outers and holes are fitted independently;
  their cubic handle offsets travel through the native response and are scaled
  into document space without a second fit. Pixel-art deliberately bypasses
  RDP simplification and curve fitting to preserve the exact pixel grid.
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
  corner angle 90–180, max error 0.1–10, simplify tolerance 0–10 source
  pixels, stroke width 0.5–100.
- Decode safety: dimension pre-check via `ImageReader::into_dimensions()`
  before full decode (decompression-bomb guard), u64 pixel math, format
  sniffing (extensions are never trusted).

## Wire contract

- Request: PNG bytes (raw binary body) + options header
  `x-varve-trace-options` (camelCase, serde `rename_all = "camelCase"` —
  snake_case keys are silently ignored).
- Response: `{ paths: BezierPath[], omittedHoles }` where
  `BezierPath = { points, closed, fill?, holes? }`; points may include
  `handle_in`/`handle_out` cubic offsets. Centerline paths are `closed: false`
  and carry `strokeWidth` at the RasterTracePath level.

## Scene integration

- `insertTraceGroup` places a group beside the source (single undo entry),
  mapping source pixels → document space (scale from image shape
  dimensions), retaining native cubic handles, with evenodd compound holes
  and `ManagedColor` fills.
- Centerline results become open stroked paths (round caps/joins, per-path
  width, transparent fill).
- `GroupNode.traceMetadata` (schema 2.16) stores provenance:
  `{ schemaVersion: 1, sourceNodeId, mode, traceMode, options…, engine,
  stats, createdAt }` — no raster bytes, survives save/load and undo.
- **Edit Trace / re-trace**: context menus on trace groups restore stored
  settings (`settingsFromTraceMetadata`) and Apply calls
  `replaceTraceGroup` (removes the old group, inserts at the same paint
  order, one undo entry).

## Color management

Palette extraction and region merging run in Oklab (perceptual); pixel
assignment uses Oklab distance. Inserted fills are sRGB `ManagedColor`
(`{ space: 'rgb', r, g, b, a }`). Source profiles are honored at decode by
the image pipeline; tracing itself operates on decoded RGBA.

## Pixel-art specifics

- Nearest-neighbor downsampling (never bilinear) for previews and finals.
- Exact colors kept while within budget; near-equal colors merged
  perceptually; beyond 256 unique colors median-cut takes over.
- 4-connected regions (diagonally touching pixels stay separate), collinear
  collapse, unit-rect fallback for sub-pixel clusters, hole pairing.

## Quality gates

- Rust unit tests: thresholding, quantization, components, contour/hole
  invariants, pixel-art, cancellation, determinism, degenerate inputs,
  wire compat (66 tests in varve-trace; 4 trace tests in the Tauri crate).
- Contract goldens: donut holes (thick annulus), pixel-art corner-only
  polygons, exact palette, near-color merging.
- Editor: insert/stroke/metadata/re-trace tests, menu snapshots.
- E2E: `tests/e2e/canvas/image-trace.spec.ts` (menu trace + single undo,
  pixel-art preset via keyboard, Edit Trace re-open + replace, honest
  disabled state).

## Known limitations

- Centerline is native-only; web builds disable it with an explanation.
- WASM provider remains monochrome-only.
- Pixel-art on images > 4096 px is downsampled before tracing.
- Visible-appearance tracing (crop/mask/effects compositing before trace)
  is not implemented — tracing always uses the source pixels. (Deferred.)
- The TS fallback quantizer and the native quantizer are both Oklab
  median-cut but are separate implementations; cross-provider results are
  structurally equivalent, not pixel-identical.
- Export of traced results uses the standard SVG/PDF scene export — no
  trace-specific export paths exist.

## References

- ADR-0170 — decisions behind this system.
- `crates/varve-trace/src/` — engine.
- `packages/engine/src/rasterTrace.ts`, `upscaleProviders/` — TS fallback +
  dispatch.
- `packages/editor/src/components/Vectorize/` — dialog/workflow.
- `packages/editor/src/imageOperations.ts` — insertion/re-trace ops.
- `packages/editor/src/logo/vectorization/metadata.ts` — provenance helpers.
