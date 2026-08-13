# Raster asset architecture

**Updated:** 2026-08-13

This document records the canonical raster asset architecture introduced to
resolve Varve's raster pipeline gaps (EXIF/ICC ingestion, resource identity,
IR payload size, worker residency, export readiness, typed failures). It
extends [image-lifecycle.md](image-lifecycle.md) (ownership boundaries),
[image-geometry.md](image-geometry.md) (crop/placement math), and
[canvas2d-system.md](canvas2d-system.md) (display/export semantics).

## The lifecycle

```text
file / external source
        ↓
@varve/import inspection + metadata extraction (EXIF, ICC, dimensions)
        ↓
Document.assets (content-addressed) + Document.iccProfiles (deduped)
        ↓
ImageFillData.assetId + normalized metadata (orientation, pixel dims)
        ↓
sceneToEngine: short resource handle in render IR (registry maps handle → src)
        ↓
ImageCache (typed load states, shared decode, byte-bounded ownership)
        ↓
main-thread Canvas2D replay            render worker (resident source map,
  (placeholder: loading vs failed)      byte-budgeted admission, set deltas)
        ↓
structural compositor → export barrier (settle → preflight → replay)
        ↓
encoded output
```

## Canonical resource identity

A raster asset is identified by its content-addressed `assetId`
(`asset-<hash>`, 22 chars). The same id is used as:

- the scene's asset-table key (`Document.assets`),
- the per-placement reference (`ImageFillData.assetId`),
- the render IR identity (image fill `src`),
- the worker manifest key,
- the resource-registry key (handle → loadable source).

Requirements met: deterministic, short, non-sensitive, stable across
save/reopen (content-addressed), collision-resistant, independent of memory
location and traversal order, usable as a cache key, portable across
main/worker boundaries. No cryptographic hashing on the render path — the
sync non-cryptographic `hashContent` lane runs at ingestion only.

### Engine resource registry

`packages/engine/src/imageResourceRegistry.ts` maps handles to loadable
sources. `sceneToEngine` registers every asset it emits (idempotent;
identical content always maps to the identical source). Replay and worker
collection resolve handles before cache access; legacy raw sources
(data:/blob:/http/https/proxy URLs) pass through untouched, so old documents
never touch the registry. An unregistered handle-shaped identity is a
*missing resource* (typed `missing`), never a cache miss.

### IR payload guarantee

Render IR carries `asset-<hash>` instead of the multi-megabyte base64
payload. Measured on this machine (Node 26, vitest bench):

| Transport | Mean structured-clone time |
|---|---|
| Legacy IR with 2 MiB embedded data URL | 28.93 ms |
| Handle IR, one photo | 0.14 ms (205x faster) |
| Handle IR, 100 placements of one asset | 1.12 ms |

The regression test (`packages/engine/src/bench/ir-size.test.ts`) asserts
the payload never appears in serialized IR and that handle IR is at least
100x smaller than the equivalent data-URL IR.

## Ingestion metadata

`packages/import/src/metadata/` extracts, at ingestion, without trusting
offsets or sizes:

- **EXIF orientation** — JPEG APP1 + TIFF, both endiannesses, bounded IFD
  walks (512 entries), chained-pointer cycle guards, segment caps. Any
  malformed input returns orientation 1 (no transform); it never throws.
  All 8 orientations verified against deterministic binary fixtures.
- **ICC profiles** — JPEG APP2 chunked reconstruction (sequence validated,
  duplicates/missing/out-of-range rejected), PNG iCCP (bounded inflate via
  fflate), WebP ICCP, TIFF tag 34675. Profiles are structurally validated
  (size field, `acsp` signature, 16 MiB cap). Invalid profiles are recorded
  as explicitly `invalid` — never reinterpreted as a different profile.

Normalized metadata lands on `DocumentAsset.metadata` (orientation, stored
pixel dimensions, ICC status/description) with the profile payload stored
once in `Document.iccProfiles` and referenced by id — identical profiles
share one entry across documents of assets.

**Decode invariant:** browser decoders (HTMLImageElement, drawImage,
createImageBitmap from an element) apply EXIF orientation, so Varve treats
the decoded representation as orientation-normalized and never applies the
transform itself. `metadata.orientation` is used for *displayed dimensions*
(swap for orientations 5-8): placement, node sizing, crop, and hit testing
all see the oriented size, matching the decoded pixels. Export re-encodes
already-oriented pixels, so orientation is applied exactly once end to end.

**Colour policy (honest):** ingestion *records* source profiles but does not
transform pixels — the working/display space remains sRGB (consistent with
Varve's colour architecture). No Adobe RGB / Display P3 / CMYK claims are
made until a genuine conversion pipeline with numeric fixtures exists.
`iccStatus: 'invalid'` is surfaced to print/preflight so a malformed
profile warns instead of silently mis-colour-managing.

## Export barrier

`packages/editor/src/export/resourceReadiness.ts` is the single dependency
collector for export: image fills, pattern tiles, node alpha masks, and
warped-image primitives are collected from the *flattened engine scene*
(the same traversal shape the worker bitmap collector uses), handles are
resolved, and settlement is awaited with a bounded timeout (15 s default)
and cancellation:

```text
freeze export snapshot (flattenSceneToEngine)
        ↓
collect required resources
        ↓
settle: loaded | failed | pending(timeout)
        ↓
preflight classification (typed failures)
        ↓
render
```

**Collection completeness (2026-08-10):** two resource classes were
previously invisible to every collector:

- **Table cell content** — rich scene content compiled into `TableShape`
  cells (`TableCellIR.content`) carries image fills that no collector
  walked. A worker frame rendered those cells as permanent gray
  placeholders (the cached worker frame never invalidated), and a
  single-shot export could bake the placeholder silently. The shared
  engine walker `walkTableCellContents` (depth-capped, iterative) is now
  used by `imageSrcsFromIr`, `irHasUnsupportedWorkerMasks`, and
  `collectEngineImageResources`, so worker transport, the worker mask
  gate, and the export barrier all see cell images (and masked cell
  images refuse the worker path — never A-without-M).
- **Frame-level native raster masks** — `sceneToEngine` now propagates a
  frame's `mask.rasterMask` data URL onto the flattened engine node's
  `alphaMask` (structural replay still applies the mask; the engine rect
  path ignores it). Preflight therefore sees a frame mask that is still
  decoding instead of structural export replay silently skipping it.

The superseded standalone `resourceCollector.ts` (ExportManifest, no
masks/tables/handles) was removed; `collectEngineImageResources` is the one
collector.

Policy:
- permanent failures (missing/corrupt/unsupported/CORS) are reported with
  the typed code and a matching recovery hint — never silently omitted;
- raster export proceeds with explicit warnings (documented
  continue-with-placeholder policy); structural compositor rasterization
  (SVG/PDF) fails the export clearly;
- pending resources on timeout are reported as transient — export never
  waits forever, and a timeout is never mislabeled as a corrupt asset;
- `ExportService` surfaces typed `resourceFailures` per file for dialogs.

## Worker residency

The render worker retains decoded source bitmaps by identity across frames
(missing-only delta transport). Residency is now explicit:

- the worker reports its resident `imageMap` bytes on every frame;
- the host accounts `residentSourceBytes` + peak and releases it on worker
  teardown — accounting never outlives the bitmaps;
- admission control includes residency: pending + in-flight + resident
  source + retained frame + worker canvas + new transfer must fit the
  budget, or the render is refused and falls back to main-thread Canvas2D;
- residency set deltas (`sourceAdds` / `sourceRemoves` / `sourceReuses`)
  feed diagnostics alongside `residentSourceBytes` / peak /
  `admissionRejections` (via `getBitmapBudgetState` on the registered host);
  `render.worker` interaction spans now carry the resident-source bytes and
  count plus the set-delta counters directly;
- masked fills are refused by the worker collection (never A-without-M).

## At-size representations (viewport-sufficient worker transport)

Measured on Chromium (2026-08-10, `tests/e2e/canvas/large-image-decode.bench.spec.ts`,
synthetic incompressible fixtures):

| Fixture | Encoded | Full decode | `createImageBitmap` 2048-px resize | Memory fraction |
|---|---|---|---|---|
| 12 MP JPEG | 5.3 MB | ~0.8-1.1 s | ~2.3-3.4 s | 0.26 |
| 24 MP JPEG | 10.5 MB | ~0.9-1.2 s | ~3.0-3.1 s | 0.12 |
| 48 MP JPEG | 20.9 MB | ~2.2-3.3 s | ~4.3-5.6 s | 0.066 |
| 48 MP PNG | 106 MB | ~11-18 s | ~7.2-14.7 s | 0.066 |

`createImageBitmap` resize is **not** a decode-latency win in Chromium
(JPEG 0.3-0.6x — the browser decodes full resolution then resamples); it is
a 15x *memory/transfer* win. The scaled-decode API (`ImageDecoder` with
`desiredWidth`) that would also cut latency is not available in the tested
Chromium build, so no latency lever exists via current browser APIs.

Implementation, conservative by the evidence:

- `ImageCache` gains at-size entries keyed `src@<maxDim>` for inline
  (`data:`/`blob:`) sources only. The full-size entry is never touched —
  export and main-thread replay keep the authoritative full-resolution
  decode, so preview resolution never reduces export quality.
- `loadAtSize` decodes with exact aspect- and orientation-preserving target
  dims when the source's displayed dims are known (from
  `ImageFillData.imageWidth/imageHeight`, which are already
  orientation-normalized); sources that fit the cap fall back to the
  full-size element under the at-size key (no upscale, no extra decode).
  Failures flow through the same typed classifier. Eviction and `clear()`
  close retained ImageBitmaps; `close()` is a no-op on detached bitmaps, so
  double-close paths are harmless. A cancelled, cleared, superseded, or
  synchronously replaced decode cannot repopulate the cache: if its late
  result is an ImageBitmap, the stale completion closes it exactly once.
  Results rejected for exceeding the cache budget are returned to the
  immediate caller but are not cache-owned, so the cache does not close them.
- `collectImageBitmaps` accepts `maxSourceDim` — a power-of-two,
  camera-derived cap (`workerSourceCapFor`: viewport max dim x DPR x
  max(zoom, 1) x 1.25, clamped to [2048, 8192]) — and uses the at-size
  entry when the source exceeds the cap, cloning it for transfer so the
  cache keeps ownership of its copy. Until the preview settles, the frame
  falls back to the main-thread full-res path (never a gray worker frame).
- Zoom hysteresis is structural: powers of two mean a representation only
  changes at 2x zoom steps, and raising the cap loads a new entry whose
  cache-stamp notification re-renders the frame sharper.

Result: a 48 MP photo (192 MB RGBA) previously blew the 128 MB worker
admission budget and permanently fell back to the main thread; it now
transfers as a ~12.7 MB viewport-sufficient bitmap while the full decode
remains available for export and deep-zoom re-requests.

### Thumbnail decode policy

Canonical thumbnails use the same at-size cache mechanism. The requested
representation is capped to the thumbnail's physical output long edge
(including thumbnail DPR), and the resulting image is supplied to `replayIr`
through its existing image lookup hook. This prevents a 256–512 px thumbnail
from forcing a full embedded photo decode when inline `data:`/`blob:` input and
`createImageBitmap` resizing are available. The full source remains the
authoritative cache entry for Canvas2D replay and export.

The Layers Panel's 28×28 node-preview profile follows the same rule through
`packages/editor/src/components/LayersPanel/useThumbnail.ts`, including its
raster-mask input. Its node-local thumbnail cache remains separate display
state keyed by document/node visual identity; it does not become an image
source cache or alter asset ownership.

Remote sources continue through the full HTML-image load because browser
portable scaled decode is unavailable for those URLs in the current contract.
When `createImageBitmap` is unavailable, `loadAtSize` deliberately falls back
to the full HTML-image loader so older WebKit/WebViews retain correct
thumbnail behavior; at-size selection is an optimization, never a correctness
requirement.

## Typed failures

`ImageLoadError` codes: `missing`, `corrupt`, `unsupported`, `permission`,
`unavailable`, `cors`, `admission`, `cancelled`, `unknown`. Inline failures
are classified by MIME; remote failures by bounded HTTP probes (404/410 →
missing, 401/403 → permission, 5xx → unavailable, 2xx-but-undecodable →
corrupt, CORS-failed probe → cors). Placeholders distinguish loading from
permanent failure while preserving node geometry.

## WebGPU

Image rendering remains disabled in WebGPU. Canvas2D is the authoritative
path; WebGPU accelerates only whole batches of simple solid shapes with
normal blending. Readiness gates (texture ownership, upload dedup, device
loss, parity fixtures, hardware validation) remain unmet; see the lifecycle
doc's extension rules.

## Deferred (measured, not implemented)

- Photo-fill tiling/pyramids: the raster-layer pyramid trigger is met at
  2048² layers (ADR-0214) but photo fills replay as a single blit; a
  pyramid only pays off when full decode is the bottleneck. The IR
  transport and at-size representation work above remove the per-frame and
  transport cost; decode latency itself remains browser-bound (measured:
  `createImageBitmap` resize does not speed up Chromium JPEG decode, and
  `ImageDecoder` scaled decode is unavailable in the tested build). A
  pyramid for photo fills should be revisited when scaled-decode APIs
  ship or real-hardware benchmarks show decode-bound pan/zoom.
- Source-ICC → working-space conversion: profile extraction is wired;
  numeric colour fixtures and a conversion pipeline are a separate phase.
