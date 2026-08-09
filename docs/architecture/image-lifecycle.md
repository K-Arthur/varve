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
  -> @varve/import metadata extraction (EXIF orientation, embedded ICC)
  -> DocumentAsset in @varve/scene (immutable embedded source bytes)
     + Document.iccProfiles (deduplicated profile payloads)
  -> ImageFillData.assetId (per-placement crop/fit/transform remains independent)
  -> DocumentCodec normalize / encode / decode
  -> sceneToEngine and render IR (short asset resource handle, not the payload)
  -> engine image resource registry (handle -> loadable source)
  -> @varve/engine ImageCache (shared HTMLImageElement decode, byte-bounded LRU,
     typed failure states)
  -> main-thread Canvas2D replay (loading vs failed placeholders)
       or missing-only ImageBitmap delta -> render worker retained source map
       (resident bytes accounted; admission includes residency)
  -> @varve/compositor (Canvas2D authoritative; WebGPU only for supported batches)
  -> export barrier (collect -> settle -> preflight -> render)
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
timing. EXIF orientation and embedded ICC profiles are extracted at ingestion
(`packages/import/src/metadata/`, 2026-08-09) and recorded on the asset's
normalized metadata; see [raster-assets.md](raster-assets.md) for the decode
invariant (decoded pixels are orientation-normalized; orientation drives
displayed dimensions only) and the ICC policy (extract + record, never
reinterpret invalid profiles).

## Cache and worker rules

- Identical cache requests share one pending load.
- A cancelled, cleared, or superseded token cannot repopulate the cache.
- The decoded cache is bounded by both entry count and estimated RGBA bytes.
- Oversized decodes may be used by the immediate caller but are not retained.
- Cache reset clears pending state and listeners before replacing the singleton.
- Cache failures are typed (`ImageLoadError`: missing/corrupt/unsupported/
  permission/unavailable/cors/unknown); remote failures are classified by
  bounded HTTP probes.
- Worker commands carry a full source manifest and only missing bitmap payloads.
- The worker closes resources removed from the manifest and retains unchanged
  resources by identity; resident source bytes are reported per frame and
  accounted by the host (admission includes residency).
- Masked fills are refused by worker collection: a frame never renders
  A-without-M; it falls back to the authoritative Canvas2D path.
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

Status key: DONE = resolved 2026-08-09 (raster asset architecture pass);
PARTIAL = foundation landed, product surface remains; OPEN = unchanged.

| Area | Current implementation | Problem | Severity | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| EXIF | Ingestion extracts orientation via bounded parser; asset metadata records it; displayed dimensions are orientation-aware | Mirrored orientations could drift across display/thumbnail/export; none were parsed at ingestion | High correctness | `packages/import/src/metadata/exif.ts`, `ingestionMetadata.test.ts` | DONE — decode invariant: browser decoders normalize; Varve never double-applies |
| ICC metadata | Ingestion extracts JPEG/PNG/WebP/TIFF profiles into a deduplicated `Document.iccProfiles` registry; assets reference by id with valid/invalid status | Raster assets stored no source profile | High print/colour | `packages/import/src/metadata/icc.ts`, scene `IccProfileEntry` | DONE (extraction + storage); conversion through the working space remains an explicit future phase with numeric fixtures |
| Large visible photo | Full browser decode | One source above budget is repeatedly decoded and has no viewport representation | High memory/performance | `packages/engine/src/imageCache.ts` | OPEN — raster-layer pyramid trigger measured at 2048² (ADR-0214); photo-fill pyramid deferred pending browser decode benchmarks |
| Worker IR identity | IR carries the short content-addressed asset handle; registry resolves to the loadable source | Embedded data URLs were structured-cloned even when bitmap transfer is a delta | High performance | `imageResourceRegistry.ts`, `sceneToEngine.ts`; measured 205x structured-clone reduction | DONE |
| Worker memory | Transfer/frame budgets exist; resident source bytes now reported + accounted; admission includes residency | Worker-retained image bytes were not a distinct diagnostic category | Medium-high | `renderBitmapBudget.ts`, `workerHost.ts` | DONE |
| Raster masks | Masked fills are collected (alphaMask) and refused by the worker (A-without-M fallback) | Worker resource collection ignored alpha-mask resources | High correctness | `collectImageBitmaps.ts` | DONE |
| Thumbnail | Multiple thumbnail converters | Some paths duplicate scene conversion and can request full-resolution decodes for tiny output | High drift/performance | editor thumbnail modules | OPEN — canonical conversion reuse; bounded preview representations deferred |
| Export preload | Structural export runs a collect → settle → preflight → render barrier with typed failures, timeout and cancellation | Some structural raster-flatten paths could replay before images load | High correctness | `export/resourceReadiness.ts`, `compositor.ts`, `SpecPanel/export.ts` | DONE |
| Loading/error UX | Typed failure model; placeholders distinguish loading from permanent failure; recovery hints per code | Loading, corrupt, missing, permission, and CORS failures were indistinguishable | Medium product correctness | `imageErrors.ts`, `imagePlaceholder.ts` | PARTIAL — canvas/export foundation landed; Inspector/relink UI flows remain |
| Adaptive quality | Profile fields and prefetch helpers exist | Decode quality and prefetch depth have no runtime consumer | Medium performance | `adaptiveProfile.ts`, `viewportPrefetch.ts` | OPEN — connect only after large-image browser benchmarks establish a benefit |
| Archives | Asset payloads are embedded and also emitted as files | Duplicate archive bytes; restore ignores separate files | Medium storage | archive builder/restorer | OPEN |
| Codegen URLs | Blob URL raster fallback | No disposer contract | Medium leak | `flattenForCodegen.ts` | OPEN |
| Workspace evidence | Shared state is architecturally correct | Photo/Draw/Print/Motion/Codegen lack representative raster E2E workloads | Medium regression risk | existing Playwright corpus | OPEN |

## Validation baseline

Before this pass, the JS render-path benchmark reported the following local
p50 values: 0.59 ms at 100 nodes, 4.51 ms at 1,000, 31.29 ms at 10,000, and
236.48 ms at 50,000. This benchmark measures JS dispatch, not browser decode or
raster paint. Image-specific browser latency and memory baselines remain a
required follow-up; no claim is made from the vector-only numbers.

Worker IR transport (2026-08-09, Node 26 structured-clone bench,
`packages/engine/src/bench/imageResourceTransport.bench.ts`): legacy IR
carrying a 2 MiB embedded data URL clones in 28.93 ms mean; the same scene
with resource handles clones in 0.14 ms (205x faster); 100 placements of one
asset clone in 1.12 ms. IR-size regression tests
(`packages/engine/src/bench/ir-size.test.ts`) pin the payload-free IR at
<1/1000th of the legacy serialized size.

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
