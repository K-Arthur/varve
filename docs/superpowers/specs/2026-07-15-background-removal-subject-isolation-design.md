# Background Removal and Subject Isolation Design

**Date:** 2026-07-15
**Status:** Approved by user direction to proceed with the best modular, extensible, functional solution
**Scope:** Strata scene model, raster-mask rendering, offline inference, refinement tools, persistence, export, desktop/browser UI, and verification

## Approved Audit Corrections

The 2026-07-15 implementation audit was repeated against the active
`feature/subject-isolation` worktree before further code changes. The following
corrections are normative and override older wording in this document:

- The live legacy `ShapeNode.backgroundRemoval` field is a compatibility input
  only. Production commands, refinement, rendering, thumbnails, clipboard,
  persistence, and exports must read and write the native raster-mask contract.
  Encoding may migrate legacy data, but no new runtime state may be committed to
  the legacy field.
- Worker protocol safety precedes source-resolution inference. Every command,
  progress event, result, and error carries a request ID and worker generation.
  Cancelling or timing out active inference terminates and replaces that worker;
  abort listeners are removed when a request settles.
- Providers receive independent immutable pixel buffers. A worker transfer must
  never detach the source used by a later fallback. Timeouts abort provider work
  rather than merely rejecting the caller.
- Automatic cloud fallback is removed. Uploads are available only through an
  explicitly invoked, per-operation consent flow and are not required for any
  supported workflow.
- Natural, orientation-normalized source decoding and immutable request tokens
  are established before reconstruction. Quick and AI paths both produce masks
  in exact source-pixel space and multiply subject alpha by original source alpha.
- Inference workers exchange bounded raw single-channel alpha plus transform and
  provenance metadata. PNG encoding occurs once at the document asset boundary;
  the pipeline must not allocate multiple full-resolution RGBA intermediates.
- Runtime limits are platform-aware and fail with actionable messages. The
  portable document validator permits at most 16,384 pixels per dimension and
  134,217,728 mask pixels; the browser inference default is 67,108,864 pixels.
  Higher desktop limits require a measured memory budget and must not create a
  document the browser cannot safely inspect.
- Desktop releases bundle the accepted high-quality model. Browser builds use an
  explicit first-use download with checksum verification and persistent local
  caching, after which inference is fully offline. Quick heuristic removal remains
  available without a model.
- The primary bake-off candidate is the exact official MIT-tagged
  `ZhengPeng7/BiRefNet_lite-matting` checkpoint. BEN2 Base is the permissive ONNX
  challenger. U2-Net Light remains only if its packaged weight rights are cleared;
  BRIA RMBG models remain excluded without a commercial agreement.

## Outcome

Strata will isolate common foreground subjects offline, produce a source-resolution soft matte, and store that matte as an editable native raster-alpha mask. The source image remains unchanged. Users can disable, invert, refine, regenerate, reset, rasterize, replace the background, and export the isolated result.

The workflow must work from every exposed entry point. The Inspector is the canonical detailed surface; the selection quick bar and menu/action registry delegate to the same command service. Export preprocessing, batch processing, and future shortcuts must use the same request and commit contracts rather than duplicating inference logic.

## Audit Findings

Strata already contains a substantial prototype: Quick heuristic removal, ONNX Runtime Web providers, IndexedDB model storage, a native feature-gated ONNX path, cancellation UI, model consent, a mask brush, trimap editing, subject-component selection, batch/export hooks, Canvas2D alpha compositing, and inline JSON persistence.

The current prototype is not production-ready:

- it generates masks from placed shape dimensions, caps them to 2048 pixels, and persists the preview mask as the final mask;
- it stretches images and masks through different placement math, breaking fit, crop, and offsets;
- worker messages have no request ID, and cancelling a running worker can let a late result resolve a newer job;
- the transferred pixel buffer is detached before fallback providers reuse it;
- stale-result checks cover selection only, not document, source, crop, or request generation;
- brush and trimap tools treat world coordinates as mask pixels and ignore transforms, crop, zoom, flips, pressure, and coalesced events;
- the trimap solver does not inspect source colour despite claiming colour affinity;
- “Decontaminate” erodes alpha rather than suppressing edge colour spill;
- the generated mask is a second, image-only masking system beside Strata's native `Mask` model;
- replacement can retain a stale mask, thumbnails ignore it, SVG and PDF omit it, and package export does not extract/deduplicate it;
- current E2E coverage fails in Chromium and does not cover refinement, transforms, persistence, or export.

## Approaches Considered

### A. Harden `ShapeNode.backgroundRemoval`

This is the smallest patch. It could fix source dimensions, request IDs, and brush mapping quickly, but it preserves two incompatible mask systems and would duplicate mask controls, export handling, copy logic, and future selection integration. Rejected.

### B. Wrap every isolated image in a generated masked group

This reuses container masks but changes layer structure, breaks identity-sensitive workflows, complicates image replacement/copy, and exposes implementation artifacts to users. Rejected.

### C. Add raster sources to the native `Mask` system

This extends `Mask` so any eligible node can own a raster-alpha source in addition to the existing node and vector sources. A document-level immutable mask-asset table deduplicates PNG payloads and supports copy-on-write edits. Legacy `backgroundRemoval` data migrates into the native representation. Selected.

## Scene and Persistence Model

`Mask` becomes a source union with exactly one of:

- a child `sourceNodeId` for structural alpha/luminance masks;
- `vectorMask` for editable paths;
- `rasterMask` for a single-channel source-pixel matte.

A raster mask descriptor contains:

- `assetId`, decoded width and height, MIME type, and byte length;
- coordinate space (`source-image-pixels` for isolation masks);
- source fingerprint and source pixel revision;
- generation provenance: model ID/version/hash, runtime, method, timestamps, and calibrated quality signals;
- edit revision and stale reason;
- enabled, inverted, density, feather, contrast, edge shift, smoothing, and spill-suppression settings through native mask controls and a subject-isolation refinement block.

The document owns immutable `rasterMaskAssets`. Multiple duplicates may reference one asset. A brush edit creates a new asset only for the edited mask. Decode validates MIME, dimensions, byte length, data-URL length, and a fixed decoded-pixel ceiling before accepting a document. Version migration converts legacy `backgroundRemoval.maskDataUrl` entries; encoding writes only the new form.

Image replacement marks the mask stale and disabled until the user chooses Reset or Re-run. Crop and image placement do not mutate the source-space mask. Apply/Rasterize is explicit and creates a new embedded image while retaining an undoable route to the original through history.

## Canonical Pixel Mapping

One engine leaf module owns image placement math for render, hit/refinement mapping, crop, export, and thumbnails. It maps among:

1. source image pixels after orientation normalization;
2. image-fill local coordinates after fit/fill/scale/offset/crop;
3. node-local geometry;
4. world coordinates through nested transforms;
5. canvas coordinates through camera and device-pixel ratio.

Mask rendering and brush tools use the exact inverse mapping used by image rendering. Rotation, nested transforms, non-uniform scale, flips, unusual aspect ratios, and high DPI therefore cannot create a second interpretation of placement.

## Inference Architecture

All entry points call one `SubjectIsolationService` with an immutable request:

- request ID and generation;
- document ID/version;
- node ID;
- source asset fingerprint and pixel revision;
- placement/crop revision;
- oriented source dimensions;
- requested quality and runtime constraints.

The service owns bounds checking, decode/orientation normalization, preview inference, source-resolution reconstruction, progress, cancellation, stale-result rejection, telemetry, and cleanup. UI code never commits a provider result directly.

### Browser

An application-owned Worker loads ONNX Runtime Web. WebGPU is preferred only after capability and known-fixture self-tests; WASM SIMD is mandatory fallback. WebGL remains an opt-in diagnostic fallback because ONNX Runtime documents it as maintenance mode and it supports fewer operators. The worker protocol includes request IDs on every message and progress phase. Cancelling a running request terminates and replaces that worker before it accepts another request.

### Desktop

Tauri uses the same request/result schema. A bounded native ONNX Runtime task is preferred where the release includes the provider; CPU is universal fallback. Platform accelerators are optional and provider-ordered: CoreML on macOS, WinML/DirectML on Windows, and explicitly packaged OpenVINO/CUDA on supported Linux systems. Browser-worker inference remains available as a fallback only when it passes the same capability self-test.

### Model Decision

The primary candidate is an exact, checksum-pinned conversion of the official
MIT-tagged BiRefNet Lite Matting checkpoint (44.4M parameters). FP16 targets
tested WebGPU/native GPU paths; a calibrated UINT8 QDQ artifact may target
WASM/CPU only if boundary quality passes. BEN2 Base is the permissive,
publisher-supplied ONNX challenger, not the default due to its roughly 223 MB
download and higher startup cost. U2-Net Light may remain only as a tiny fallback
after packaged-weight rights are cleared. BRIA RMBG-2.0 is excluded without a
commercial agreement. MODNet may later be a portrait specialization but cannot
satisfy the general-subject objective.

No model is selected from a model card alone. The bake-off must compare raw masks and refined results on licensed portrait/hair, pet/fur, white-on-white product, dark-on-dark object, vehicle, multi-subject, boundary-touching, transparent, lace/wire, glass/shadow, panorama, and compressed-image fixtures. Record cold/warm load, inference time, peak memory, foreground retention, background leakage, boundary SAD/gradient/connectivity, and zoomed edge crops.

### Source-Resolution Matte

Automatic inference produces a soft preview matte plus exact preprocessing metadata. The final path reconstructs into oriented source pixel space, then refines only a bounded unknown edge band against original-resolution RGB and original alpha. It does not claim that simple interpolation recovers detail. Large-image tiling is limited to edge-band refinement with overlap; the global subject decision always comes from a whole-image pass.

The final alpha is `sourceAlpha * subjectAlpha`, so isolation never makes transparent source pixels more opaque. RGB spill suppression is a derived render/export operation and never mutates source pixels. Translucent glass, smoke, reflections, and soft shadows remain declared quality boundaries when the selected segmentation model cannot infer physical alpha.

## Refinement Workspace

The Inspector exposes the initial command and concise settings. `Edit Mask` enters a focused canvas mode with:

- Restore/Keep and Remove brushes;
- zoom-aware source-pixel radius, hardness, spacing, opacity, pen pressure, coalesced events, and touch-safe pointer capture;
- edge refinement, feather, contrast, shift edge, smoothing, and spill suppression;
- invert, disable/delete, reset, and re-run;
- checkerboard, overlay, black, white, mask-only, and high-contrast edge views;
- hold-to-show original and split before/after comparison;
- Apply/Done and Cancel with one undo entry per stroke or setting gesture.

An overlay adapter renders editor-only mask/trimap feedback without adding imports to `CanvasArea.tsx` or `Shell.tsx`; existing tool/context dependencies carry the state. Refinement state is persistent when committed and disposable while previewing.

## Product Surfaces and Access-Path Contract

Commands have distinct meanings:

- `Remove Background`: generate or regenerate an editable isolation mask;
- `Edit Mask`: enter manual/edge refinement;
- `Show Original`: temporary comparison only;
- `Disable Mask` / `Delete Mask`: reversible native mask operations;
- `Apply Mask`: explicit rasterization;
- `Replace Background`: add or choose content behind the isolated node without altering its mask;
- `Export Isolated Subject`: transparent raster export when supported.

Inspector, selection quick bar, menu/action registry, batch dialog, and export dialog all resolve to a shared command capability and service. Each access route gets an integration test that asserts the same state transition or a clear, accessible unavailable reason. No route may silently fall back from AI to Quick, silently upload, or bypass model-consent/runtime checks.

## Rendering, Thumbnails, and Export

Canvas2D, render worker, native/WASM bridge, SVG, raster export, and PDF flattening consume the same raster-mask descriptor and placement metadata. Layer thumbnails include the mask asset/edit revision in their cache key and render transparent checkerboard behind isolated pixels.

PNG and WebP preserve alpha. JPEG and other opaque targets require an explicit background colour. SVG emits an aligned image mask. PDF either emits a supported soft mask or deliberately flattens the masked subtree at the selected export DPI; it must never ignore the mask. Package export extracts and deduplicates mask assets with checksums and license/provenance metadata.

## Reliability and Resource Limits

- request/result IDs and full source revisions gate every commit;
- repeated activation coalesces or rejects predictably;
- hard cancellation replaces an active worker;
- switching/deleting/replacing/cropping cannot apply a stale result;
- provider fallbacks receive independent or shared immutable pixel buffers, never detached data;
- sessions, tensors, bitmaps, object URLs, GPU buffers, and workers have explicit lifecycle cleanup;
- decode and inference have configurable source-pixel, dimension, allocation, and model-size ceilings;
- unsuitable/low-information images return calibrated warnings and preserve the previous mask;
- corrupted model/image data reports actionable retry/fallback errors;
- no cloud provider participates unless the user explicitly configures and invokes it, and offline behavior remains complete.

## Verification

TDD is required for every behavior change. Verification layers are:

1. pure unit tests for preprocessing, orientation, placement transforms, reconstruction, interpolation, alpha composition, mask operations, edge-band refinement, and resource validation;
2. worker/native integration tests for request IDs, cancellation, stale results, fallback buffers, provider capability self-tests, cleanup, and numeric parity;
3. scene tests for migration, save/reload, copy/paste, duplication, crop/replacement staleness, and undo/redo;
4. renderer/export tests for Canvas2D, worker, SVG, PDF, package assets, thumbnails, effects, opacity, blend modes, clips, groups, and transforms;
5. Chromium E2E for every access route, apply/refine/reopen/export, real pointer events, and pixel inspection;
6. Firefox/WebKit WASM fallback tests and Tauri/WebDriver desktop tests where the environment supports them;
7. fixture-based visual regression with full mattes plus boundary crops, not one aggregate similarity score;
8. cold/warm inference, model-load, peak memory, responsiveness, and large-image performance ledgers.

Every architecture/system milestone runs the repository regression protocol and jcodemunch health triage. Canvas interaction changes are not accepted without a passing Playwright test.

## Quality Boundaries

The first production release prioritizes one dependable general-subject model plus strong manual refinement. It does not promise physically correct alpha for glass, smoke, translucent fabric, reflections, or motion-blurred semitransparency. Those cases receive explicit guidance and editable tools. Portrait-only routing, promptable SAM-style object picking, and video matting remain future extensions behind the same service and mask contracts.

## Primary Research Sources

- ONNX Runtime Web providers and operator support: https://onnxruntime.ai/docs/tutorials/web/
- ONNX Runtime worker/WebGPU flags: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- ONNX Runtime browser support matrix: https://onnxruntime.ai/docs/get-started/with-javascript/web.html
- Official BiRefNet Lite model card: https://huggingface.co/ZhengPeng7/BiRefNet_lite
- Official BiRefNet MIT code license: https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE
- BRIA RMBG-2.0 non-commercial terms: https://huggingface.co/briaai/RMBG-2.0
- Photoshop Refine Hair and Select and Mask: https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/make-improved-hair-selections.html
- Affinity selection refinement: https://affinity.help/photo2ipad/es.lproj/pages/Selections/selections_refine.html
- Canva background remover workflow: https://www.canva.com/learn/background-remover/
- PhotoRoom layered cutout workflow: https://help.photoroom.com/en/articles/12983525-how-skip-background-removal-works
- Pixelmator Pro background removal/mask workflow: https://support.apple.com/guide/pixelmator-pro/remove-or-hide-an-image-background-pix9c48d501c/mac
