# Image and Vector Enhancement

Status: conventional CPU enlargement, bundled Real-ESRGAN 4x AI enlargement,
monochrome/grayscale/color tracing with compound holes, and worker-first dispatch ship
on the shared Vite + Tauri webview surface. U2-Net Light is bundled for balanced AI
background removal; checksum-pinned BiRefNet Lite is downloadable for high quality.

Accessed and reviewed: 2026-07-13.

## Repository reality

The requested two-application deployment description does not match this workspace. `apps/desktop` is the only editor in `pnpm-workspace.yaml`; it runs in a Vite browser surface and in a Tauri 2 webview. `apps/web/package.json` is an inactive scaffold. There is no production standalone browser application, service worker, browser asset cache, or COOP/COEP hosting configuration to verify.

| Surface | Production compute | Packaging and offline result | Evidence |
|---|---|---|---|
| Vite browser surface | Web Worker, then direct TypeScript CPU fallback | Real-ESRGAN and U2-Net Light are bundled; BiRefNet Lite is an explicit download | Unit tests and production-bundle Chromium E2E |
| Tauri webview | Same worker-first frontend dispatch | Models in `frontendDist`; optional native ORT fallback behind `ai` feature | Typecheck, Rust tests, production frontend bundle |
| Native prototypes | `upscale_image` and `trace_image` Tauri commands | Internal `varve-upscale` and `varve-trace` crates | Source and crate tests; excluded from default dispatch |
| Real-ESRGAN | ONNX Runtime Web WASM in the enhancement worker | Official x4v3 checkpoint converted, bundled, and checksum-pinned | ONNX validation, unit tests, production Chromium E2E |
| Standalone web app | Not present | Offline second visit, quota, and cache behavior cannot be claimed | Workspace and app audit |

Native routing stays behind the worker in the default provider chain. Nearest-neighbor
upscale has a shared TS/Rust golden; bilinear/bicubic still differ (`image` crate
filters vs hand-rolled TS kernels). The Rust tracer still selects light pixels and can
flip Y relative to the production dark-foreground canvas tracer.

## Capability map

| Area | Original state | Shipped state |
|---|---|---|
| Raster representation | Imported rasters were image-filled `ShapeNode`s | Reused unchanged |
| Raster enlargement | Export sizing only; no editable result workflow | 2x, 3x, or 4x nearest, bilinear, or bicubic output in a derived image layer |
| Advanced filter API | None | Lanczos-3 is implemented and benchmarked but omitted from UI because it is too slow for routine interactive use |
| Alpha handling | No enlargement contract | Bilinear, bicubic, and Lanczos sample premultiplied color; bilinear clamps coordinates before border weights |
| Raster tracing | Unwired native experiment | Monochrome + grayscale + color (median-cut palette) contour tracing with compound holes |
| Hole handling | Not represented by the scene path model | `holes` + `fillRule: evenodd` on path shapes; SVG `fill-rule`; donut fixtures |
| Scene integration | No apply command | Source retained; derived output inserted beside it under the same parent and selected |
| Undo and persistence | No workflow | One immutable document mutation using ordinary scene nodes and the existing codec |
| Export | Shape paths could be unsupported or clipped | SVG path data with multi-subpath holes, path/group-aware view boxes, image decode preloading, and CSS URL escaping |
| UI reachability | Background removal existed but was not mounted | Image and Vector plus Background Removal appear for compatible image selections |
| Cancellation and staleness | No image-enhancement job | Worker-first jobs, abort signaling, deselection/unmount cleanup, and immutable source-node identity guards |
| Vector enlargement | Geometry was already resolution independent | No misleading vector upscale command; traced paths use normal transforms and SVG export |
| AI upscale UI | Claimed or stubbed | `AI detail (Real-ESRGAN, 4x)` is reachable for image selections and locks scale to the model contract |
| AI background removal | Quick heuristic plus incomplete AI routes | Balanced uses bundled U2-Net Light; High Quality uses downloadable BiRefNet Lite; AI failures never silently become Quick results |

## Data flow

1. The inspector enables controls only for a selected image-filled `ShapeNode`.
2. `EditorProvider` loads the source through `ImageCache` and uses its natural pixel dimensions, avoiding accidental downsampling to placed scene dimensions.
3. `dispatchUpscale` or `dispatchTrace` selects a Web Worker when available. Conventional
   operations can fall back to direct CPU processing; AI requests require a real AI provider.
4. Transferable pixel buffers keep the browser UI responsive. Abort rejects the host job and stale worker results are ignored; the current synchronous worker kernel itself finishes its active loop.
5. Apply requires the same selected immutable source node, so source edits, removal, deselection, and replacement invalidate the result.
6. `insertDerivedImageShape` or `insertTraceGroup` creates ordinary scene nodes beside the source using world-bounds-aware placement (paths may carry `holes`/`fillRule` and palette fills).
7. `updateDoc` records one undo snapshot and selects the generated output.
8. Existing rendering, Layers, autosave, document encoding, and export consume the generated nodes.

The workflow is non-destructive. It does not mutate or replace the imported source.

## Research decisions

- [Adobe Illustrator Image Trace](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/image-trace-panel-options.html) exposes threshold, path fidelity, corners, and noise-area concepts. Varve ships threshold, minimum area, and color/grayscale palette modes with compound-path holes.
- [Adobe Photoshop resampling options](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/resize-adjust-resolution/resampling-options.html) distinguishes nearest-neighbor hard edges from smoother photographic interpolation. Varve names the methods explicitly and does not call conventional resampling AI.
- [Adobe InDesign effective resolution guidance](https://helpx.adobe.com/indesign/desktop/troubleshoot/file-and-output-issues/pixelated-graphics.html) separates display proxies from final output and uses effective PPI at placed size. Varve does not yet expose physical-size controls because placed-image PPI is not modeled.
- [Sketch import and export guidance](https://www.sketch.com/docs/designing/importing-and-exporting/) notes that vector paths scale without quality loss. Vector scaling stays in geometry and export, not raster reconstruction.
- [Affinity Photo image sizing](https://s3-eu-west-1.amazonaws.com/affinity-docs/help/photo/en-US.lproj/pages/SizeTransform/imageSize.html) distinguishes metadata scaling from pixel resampling. This workflow changes pixels only and does not claim to preserve DPI metadata.
- [Canva Image Upscaler](https://www.canva.com/features/image-upscaler/) markets a model-backed one-click workflow. Varve exposes AI detail only for its live, model-backed Real-ESRGAN route.
- [Inkscape tracing guidance](https://inkscape.org/en/doc/tutorials/tracing/tutorial-tracing.html) describes Potrace-derived monochrome tracing and simplification. Varve filters small components, simplifies contours, and caps retained paths without adopting Potrace's GPL implementation.
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) supports WASM execution in workers. Varve uses that path for its bundled Real-ESRGAN and U2-Net Light models.
- [rembg U2-Net](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net.py), [BiRefNet](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/birefnet_general.py), and [base session](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/base.py) define the shipped background-model contracts: ImageNet normalization, model-specific sigmoid handling, min/max mask normalization, and soft-mask resizing. The TypeScript worker, direct ONNX path, and optional Rust provider follow those contracts.
- [MDN SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) documents the secure cross-origin isolation requirement. The worker path transfers ordinary `ArrayBuffer`s and does not require shared memory.
- [Tauri frontend distribution](https://v2.tauri.app/reference/config/#frontenddist) embeds the Vite output consumed by the webview. The bundled model files are part of that frontend output.

## Limits and safeguards

- Output allocation defaults to 64 megapixels and rejects invalid dimensions before allocation.
- Tracing defaults to 1,000 retained paths, filters components before contour generation, and bounds the retained array while scanning.
- Compound holes use evenodd fills; unpaired holes (no outer) remain diagnostic `omittedHoles`.
- Natural source pixels are processed. Image-fill crop, tile, mask, color profile, HDR, CMYK, gamma, EXIF, and DPI metadata are not preserved by Canvas `ImageData`.
- Worker cancellation releases the UI and suppresses stale apply, but it does not cooperatively interrupt the currently running synchronous kernel.
- Color tracing is palette-filled region tracing. It does not provide centerline strokes, Bezier fitting, or a live comparison preview.
- Lanczos-3 is API-only because the measured direct CPU cost is unsuitable for the current inspector workflow.
- BiRefNet Lite is a 224 MB explicit download rather than a bundled startup cost. Its
  model tensor contract and checksum were verified; a full live high-quality inference
  remains a heavier platform-matrix test.
- AI requests fail with actionable errors when model loading or inference fails. Quick
  remains an explicit user choice and is never labeled as AI output.

## Performance baseline

Direct CPU measurements on this CachyOS/Arch Linux host under Node 26, using the synthetic opaque-square fixture in `imageEnhancement.bench.test.ts`:

| Operation | Observed time |
|---|---:|
| Bilinear 64x64 to 128x128 | 23.9 ms |
| Bilinear 256x256 to 512x512 | 127.5 ms |
| Bicubic 64x64 to 128x128 | 101.6 ms |
| Bicubic 256x256 to 512x512 | 320.1 ms |
| Lanczos-3 64x64 to 128x128 | 249.0 ms |
| Lanczos-3 256x256 to 512x512 | 2,309.5 ms |
| Monochrome trace 512x512 | 298.5 ms |

These are local regression signals, not product promises. Browser scheduling, worker startup, real artwork, component count, memory pressure, and other hardware will change results.

## Verification

```bash
pnpm vitest run packages/engine/src/imageEnhancement.test.ts packages/engine/src/rasterTrace.test.ts packages/engine/src/upscaleGoldenParity.test.ts packages/engine/src/traceContractGolden.test.ts
pnpm vitest run packages/engine/src/upscaleProviders/dispatch.test.ts
pnpm vitest run packages/editor/src/imageOperations*.test.ts packages/editor/src/components/Inspector/sections/__tests__/ImageEnhancementSection.test.tsx
pnpm vitest run packages/codegen/src/svg-path.test.ts
cargo test -p varve-upscale nearest_golden
cargo check -p varve-upscale --features ai
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --features ai
npx playwright test tests/e2e/canvas/image-enhancement.spec.ts --project=chromium --reporter=list
```

## Prioritized backlog

| Priority | Severity | Deferred item | Concrete next step |
|---|---|---|---|
| P0 | Parity | Native upscale/trace routing | Add bilinear/bicubic + dark-foreground/Y-up trace goldens; then put native first in dispatch |
| P0 | AI quality | Cross-platform AI runtime matrix | Run packaged Tauri inference on Linux, macOS, and Windows and production web builds in Chromium, Firefox, and WebKit |
| P1 | Cancellation | Cooperative worker cancellation and progress | Chunk kernels or use cancellable WASM/native jobs with progress messages |
| P1 | Trace quality | Bezier fitting, corners, centerline, white-removal presets | Define presets against licensed fixtures and add SVG visual goldens |
| P1 | Asset model | Large data URL avoidance and deduplication | Add content-addressed native storage and future browser OPFS/IndexedDB adapter |
| P2 | Print and color | Effective PPI, physical size, profiles, gamma, HDR/CMYK, metadata | Extend asset metadata and color-managed processing before physical controls |
| P2 | Platform | Standalone web and packaged desktop offline tests | Restore a real web target or remove two-target product claims; add installer inventory and offline tests |
| P2 | UX | Preview, comparison loupe, richer errors | Build after worker progress provides stable behavior |
| P2 | Browser offline | Service worker and persistent model cache | Add an active standalone web target and verify offline second-visit behavior and quota errors |

## Requirements-to-evidence matrix

| Requirement | Implementation | Evidence | Coverage label |
|---|---|---|---|
| Scale and validation | `imageEnhancement.ts` | dimension, method, and 64 MP tests | Directly executed |
| Alpha-safe output | `imageEnhancement.ts` | transparent-fringe and border-clamp tests | Directly executed |
| Nearest TS/Rust parity | `upscaleGoldenParity.test.ts` + varve-upscale | shared 2x2 to 4x4 golden | Directly executed |
| Responsive browser path | `upscaleProviders/` | provider dispatch tests and Chromium workflow | Directly executed, worker-first |
| Editable trace geometry | `rasterTrace.ts`, `imageOperations.ts` | contour, color, hole, placement, and scene tests | Directly executed |
| Compound holes | `pathCompound.ts`, SVG export, Rust `Shape::Path` | donut + SVG fill-rule tests | Directly executed |
| Non-destructive apply | `context.tsx` | immutable insertion tests and Chromium undo journey | Directly executed |
| Stale result protection | `context.tsx` | source identity, selection, and abort guards | Statically verified |
| SVG and raster export | `codegen`, `SpecPanel/export.ts` | path/group bounds, hole subpaths, CSS escaping | Directly executed |
| Reachable controls | `ImageEnhancementSection.tsx`, `PropertiesPanel.tsx` | RTL labels/dispatch plus Chromium E2E | Directly executed |
| Offline conventional path | Worker/direct CPU modules | dependency and call-path inspection | Statically verified |
| Native prototypes | Rust crates and Tauri commands | crate/command tests; not production-dispatched | Directly tested |
| Real-ESRGAN | Bundled ONNX + worker adapter + optional Rust provider | hash/manifest checks, tensor-contract tests, converter test, production Chromium E2E | Directly executed on Linux Chromium |
| AI background removal | Bundled U2-Net Light + downloadable BiRefNet Lite | hash/manifest checks, strict dispatch tests, production Chromium balanced-tier E2E | Balanced directly executed; quality contract verified |
| AI honesty | Strict dispatch and frontend result guards | provider mismatch tests, batch/export failure tests | Directly executed |
| Tauri inclusion | Shared frontend in `frontendDist` | typecheck and Vite production bundle | Directly built; installer not observed |
| Standalone browser offline | Target absent | workspace/app/config audit | Unverified and not claimable |
| OS/browser matrix | Standard Canvas and Worker design | Linux Chromium only | Inferred outside observed environment |
