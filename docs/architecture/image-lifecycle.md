# Image lifecycle architecture

**Updated:** 2026-08-08

This document records the verified raster/image lifecycle and its ownership
boundaries. It complements [image-geometry.md](image-geometry.md), which owns
crop and placement math, and [canvas2d-system.md](canvas2d-system.md), which
owns final display and export semantics.

## Canonical lifecycle

```text
File picker / drop / clipboard / foreign importer / generated result
  -> @varve/import byte inspection (signature, size, dimensions, pixel budget)
  -> DocumentAsset in @varve/scene (immutable embedded source bytes)
  -> ImageFillData.assetId (per-placement crop/fit/transform remains independent)
  -> DocumentCodec normalize / encode / decode
  -> sceneToEngine and render IR
  -> @varve/engine ImageCache (shared HTMLImageElement decode, byte-bounded LRU)
  -> main-thread Canvas2D replay
       or missing-only ImageBitmap delta -> render worker retained source map
  -> @varve/compositor (Canvas2D authoritative; WebGPU only for supported batches)
  -> visible canvas / raster export / derived operation
```

No workspace owns a separate loader or cache. Design, Photo, Draw, Print,
Motion, Logo, and Codegen share one document, asset table, engine facade, and
decoded cache. Workspace switching changes UI/tool configuration only.

## Representation and ownership

| Representation | Owner | Lifetime and invariant |
| --- | --- | --- |
| Encoded import bytes | `@varve/import` | Inspected before data-URL allocation; never trusted from extension alone. |
| Immutable embedded source | `Document.assets` in `@varve/scene` | Shared by `assetId`; original bytes are not modified by crop, transform, upscale, or masks. |
| Per-placement state | `ImageFillData` | Crop, fit, offsets, rotation, flips, and edit provenance are node/paint usage state. |
| Materialized `src` | `DocumentCodec` | Compatibility view of an embedded asset; stripped from encoded fills and rehydrated on decode. |
| Decoded display image | `@varve/engine` `ImageCache` | URL/data-URL keyed today; in-flight deduplicated, stale-token guarded, entry/byte bounded. |
| Worker bitmap | editor render worker | Main thread transfers only missing sources. Worker retains unchanged bitmaps and closes removed/replaced sources exactly once. |
| Returned worker frame | worker host / canvas owner | Latest-revision and viewport/DPR guarded; stale and replaced frames are closed. |
| WebGPU geometry | compositor | Optional acceleration. A batch falls back intact to Canvas2D when any item has unsupported paint or ordering semantics. |
| Derived raster result | operation-specific service plus scene asset API | Must register a new immutable asset and retain source provenance where the operation is non-destructive. |
| Thumbnail/export pixels | thumbnail/export service | Derived and disposable; never authoritative source data. |

Object URLs are not part of the normal image-ingestion path. Callers that use
them for downloads, print, or codegen fallback own revocation explicitly.

## Ingestion policy

The raster fallback accepts content-sniffed PNG, JPEG, WebP, AVIF, static GIF,
and BMP. TIFF dimensions can be inspected by lower-level helpers, but TIFF is
not claimed as a portable live decoder. Unknown signatures and zero/truncated
headers fail locally.

Before allocating a data URL or asking a browser decoder, import enforces:

- at most 128 MiB encoded bytes;
- positive dimensions no larger than 65,535 pixels per axis;
- at most 64 MiPixels (`width * height`, overflow-safe);
- a supported magic signature and parseable header.

Animated GIF is rejected with an actionable request to import a still frame.
This prevents accidental animation driven by browser-specific `HTMLImageElement`
timing. EXIF orientation normalization and ICC extraction are not yet connected
to ingestion; they remain explicit correctness gaps below.

## Cache and worker rules

- Identical cache requests share one pending load.
- A cancelled, cleared, or superseded token cannot repopulate the cache.
- The decoded cache is bounded by both entry count and estimated RGBA bytes.
- Oversized decodes may be used by the immediate caller but are not retained.
- Cache reset clears pending state and listeners before replacing the singleton.
- Worker commands carry a full source manifest and only missing bitmap payloads.
- The worker closes resources removed from the manifest and retains unchanged
  resources by identity.
- A worker generation that fails while image-dependent does not retry without
  resources; the editor falls back to Canvas2D.
- Canvas state restoration is protected with `try/finally` around worker replay.

## Quality and backend policy

Canvas2D is the correctness baseline. WebGPU currently accelerates only entire
batches of simple solid rects/circles with normal blending and no fill stack,
stroke, effect, or filter. Mixed batches stay entirely on Canvas2D so partitioning
cannot reorder artwork.

The portable working/display baseline remains sRGB. Import does not yet extract
source ICC profiles, and no wide-gamut image claim is made. Export renders from
document state at output resolution; interactive viewport DPR and zoom never
modify the original asset.

## Evidence-based gap table

| Area | Current implementation | Problem | Severity | Evidence | Proposed owner | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| EXIF | Engine metadata helpers exist | Not connected to ingestion; mirrored orientations can drift across display/thumbnail/export | High correctness | `packages/engine/src/metadata/exif.ts`, `packages/import/src/image.ts` | import + scene assets | Normalize once or persist an explicit canonical orientation with 1-8 fixtures. |
| ICC metadata | Document colours have managed profiles | Raster assets store no source profile | High print/colour | `DocumentAsset`, colour-management architecture | scene + colour + print | Extract profile metadata, convert through the existing ICC path, add numeric fixtures. |
| Large visible photo | Full browser decode | One source above budget is repeatedly decoded and has no viewport representation | High memory/performance | `packages/engine/src/imageCache.ts` | engine cache | Add measured display representations/leases; investigate resize decode or tiling only with evidence. |
| Worker IR identity | IR still carries full `src` | Embedded data URLs are structured-cloned even when bitmap transfer is a delta | High performance | `sceneToEngine`, `WorkerRenderCommand` | engine IR + editor render | Introduce a backward-compatible short resource handle derived from `assetId`. |
| Worker memory | Transfer and frame budgets exist | Worker-retained image bytes are not a distinct diagnostic category | Medium-high | `renderBitmapBudget.ts` | editor render | Account resident source bitmaps and include them in admission diagnostics. |
| Raster masks | Main path supports canonical mask assets | Worker eligibility/resource collection does not cover every canonical mask path | High correctness | `sceneCompositing.ts`, `collectImageBitmaps.ts` | editor render | Gate unsupported masks or transport them through the same manifest. |
| Thumbnail | Multiple thumbnail converters | Some paths duplicate scene conversion and can request full-resolution decodes for tiny output | High drift/performance | editor thumbnail modules | editor render/thumbnail | Reuse canonical scene conversion and add bounded preview representations. |
| Export preload | Whole-node raster export waits | Some structural raster-flatten paths can replay before images load | High correctness | export compositor/resource collector | editor export | Centralize required-resource collection and snapshot semantics. |
| Loading/error UX | Gray placeholder for missing image | Loading, corrupt, missing, permission, and CORS failures are indistinguishable | Medium product correctness | `replay.ts`, image inspector | editor UI + cache | Add typed failure state and accessible Retry/Replace/Remove recovery. |
| Adaptive quality | Profile fields and prefetch helpers exist | Decode quality and prefetch depth have no runtime consumer | Medium performance | `adaptiveProfile.ts`, `viewportPrefetch.ts` | editor canvas adapter | Connect only after large-image browser benchmarks establish a benefit. |
| Archives | Asset payloads are embedded and also emitted as files | Duplicate archive bytes; restore ignores separate files | Medium storage | archive builder/restorer | persistence | Choose one authoritative package representation and migrate compatibly. |
| Codegen URLs | Blob URL raster fallback | No disposer contract | Medium leak | `flattenForCodegen.ts` | codegen/export | Return an explicit disposable resource bundle or avoid object URLs. |
| Workspace evidence | Shared state is architecturally correct | Photo/Draw/Print/Motion/Codegen lack representative raster E2E workloads | Medium regression risk | existing Playwright corpus | editor E2E | Add generated large/reused/oriented fixtures and public-UI journeys. |

## Validation baseline

Before this pass, the JS render-path benchmark reported the following local
p50 values: 0.59 ms at 100 nodes, 4.51 ms at 1,000, 31.29 ms at 10,000, and
236.48 ms at 50,000. This benchmark measures JS dispatch, not browser decode or
raster paint. Image-specific browser latency and memory baselines remain a
required follow-up; no claim is made from the vector-only numbers.

## Extension rules

1. Add ingestion/metadata behavior behind `@varve/import`, not in `Shell` or
   `CanvasArea`.
2. Reuse `Document.assets`; do not add a feature-local authoritative image
   store or second cache.
3. Keep source data, per-placement state, decoded/display resources, worker/GPU
   resources, thumbnails, and export results as separate lifecycles.
4. New WebGPU image semantics require Canvas2D parity, explicit texture
   ownership, device-loss cleanup, and real hardware evidence.
5. Large-image tiling or pyramids require before/after measurements and must
   preserve the immutable original and existing document compatibility.
