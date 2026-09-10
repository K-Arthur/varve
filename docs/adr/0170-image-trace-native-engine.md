# ADR-0170: Native Image Trace (Raster-to-Vector) Engine

- **Status:** Accepted
- Date: 2026-08-05
- Deciders: Architecture, Editor, Engine

## Context

Varve needs a first-class raster-to-vector trace feature: converting selected
raster images into editable vector artwork (logos, icons, line art,
signatures, pixel art, posterized photos). A substantial tracing stack
already existed — a Rust crate (`varve-trace`, contour + centerline +
quantization), WASM bindings, a TS fallback tracer, a four-tier provider
chain, and a Vectorize dialog — but production gaps kept the native engine
out of the default path:

- The Tauri `trace_image` command hardcoded `TraceMode::Silhouette`, ignored
  `maxPaths`/`alphaThreshold`/centerline options, ran synchronously on the
  main thread (UI freeze), and had no decode guards.
- The provider chain ordered worker → direct → wasm → **native**, so desktop
  traces ran the TS worker instead of the native engine.
- The TS tracer silently ignored `traceMode: 'centerline'` (emitting filled
  silhouettes instead of strokes).
- Silhouette contour extraction could not trace 1px-thick rings or nested
  holes (a solid annulus fragmented into 12 paths with 11 omitted holes).
- No pixel-art mode, no trace provenance, no re-trace workflow, no quality
  corpus, and no E2E coverage.

## Decision

Ship the native engine as the production trace path on desktop, keep honest
fallbacks on web, and close the lifecycle/UX gaps:

1. **Native first under Tauri.** `TRACE_PROVIDER_CHAIN` orders
   `native-trace → worker → direct → wasm` when `isTauriRuntime()`. The
   native path is the only one with cancellation, progress, centerline, and
   full option support.
2. **Async, cancellable, bounded native jobs.** `trace_image`/`trace_image_binary`
   are async commands running the engine on a blocking thread
   (`spawn_blocking`) with a single-job cancel registry
   (`begin_trace_job`/`cancel_trace`), a stage progress channel
   (`trace:progress`), and cancellation polled inside engine loops
   (`TraceCancellation`, an `Arc<AtomicBool>`). Untrusted input is clamped
   (`sanitize_trace_options`) and bounded: 128 MB byte cap, 64 MPixel decode
   cap, 100 k path cap, dimension pre-check before decode (decompression-bomb
   guard).
3. **Correct contour extraction.** Silhouette masks are traced with the shared
   boundary-edge chaining module (`contours`) — 4-connected components, unit
   edge chaining (mirroring the TS tracer), cyclic collinear collapse, and
   winding-number hole pairing — replacing the 8-directional path follower
   that failed on rings and holes.
4. **Explicit modes.** `silhouette` (filled), `centerline` (stroked
   skeletons via Zhang-Suen), and `pixel-art` (exact/near-exact color regions
   as hard-edged pixel-aligned polygons; nearest-neighbor scaling; median-cut
   fallback beyond 256 unique colors). TS fallbacks declare `centerline`
   unavailable rather than degrading silently.
5. **Trace provenance and re-trace.** `GroupNode.traceMetadata` (schema
   2.16) stores versioned, byte-free provenance (source node id, options,
   engine, result stats). "Edit Trace…" context-menu entries restore the
   dialog from metadata and replace the group in place (one undo entry).
6. **Web fallback stays honest.** Worker/direct (TS) and WASM providers keep
   the reduced feature set; `traceCapabilityReport` exposes per-mode
   availability so the UI can disable options with a reason.

## Consequences

- Desktop traces now run the native engine with progress and cancellation;
  the UI thread never blocks.
- Monochrome/color traces preserve holes; centerline output is genuinely
  stroked; pixel-art keeps hard pixel boundaries.
- Re-traces are discoverable and replace the prior result in place.
- Web builds lose centerline (unavailable, explained) but keep monochrome,
  grayscale, color, and pixel-art.
- IPC carries PNG bytes over the raw binary channel; only the small options
  header is JSON.

## References

- `docs/architecture/image-trace-system.md` — current-state system doc.
- `crates/varve-trace/` — engine (contours, pixel_art, centerline, bezier_fit,
  quantize, hierarchy).
- `apps/desktop/src-tauri/src/lib.rs` — `trace_image`, `trace_image_binary`,
  `begin_trace_job`, `cancel_trace`, `sanitize_trace_options`.
- `packages/engine/src/upscaleProviders/traceDispatch.ts` — provider chain
  and `traceCapabilityReport`.
- `packages/editor/src/components/Vectorize/` — dialog/workflow.
- `packages/editor/src/logo/vectorization/metadata.ts` — provenance helpers.
- `tests/e2e/canvas/image-trace.spec.ts` — E2E coverage.
