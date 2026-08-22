# Image enhancement implementation audit — 2026-08-22

This audit records the implementation state and the evidence available for the
Enhance workflow. “Contract validated” means the model artifact, tensor
contract, integrity, and runtime path were checked. It does not mean that the
model wins a task-quality comparison on every content class.

| Capability | Runtime path | Contract / safety evidence | Quality evidence | Status |
| --- | --- | --- | --- | --- |
| Auto / Recommended | Pure TypeScript analysis | Bounded Laplacian, blockiness, resolution, and pixel-art heuristics; no model load during planning | Unit coverage; conservative suppression on tiny images | Available |
| Denoise | Native-first tiled chain, worker fallback | SCUNet RGB contract; graph-safe dimensions are multiples of 64; alpha is preserved; edge-padding parity test | Design-content corpus and benchmark report; thin-line/text harm is documented | Available, task-specific |
| Deblur | Native-first NAFNet-GoPro chain, adaptive tiling | Pinned fp16 ONNX artifact; BGR adapter; explicit 0–1 strength validation; cancellation and tile policy | NAFNet parity and deblur benchmark are recorded in the benchmark report | Available, task-specific |
| JPEG artifact removal | None | Planner and dispatch both reject the operation; no unrelated checkpoint is substituted | No passing design-content model yet; FBCNN remains a candidate | Intentionally unavailable |
| General AI upscale | Native/worker Real-ESRGAN x4 | Bundled artifact and pinned hash; arbitrary requested scale is 4x inference followed by Lanczos downsample | Existing upscale validation and deterministic pipeline tests | Available |
| Anime / illustration AI upscale | Native/worker Real-ESRGAN anime 6B | Optional manifest entry with pinned hash, source/license, dynamic tensor contract, and dimension-sweep inference validation | Dedicated task-quality corpus benchmark remains pending; it is not claimed here | Available, optional |
| Pixel-art upscale | Deterministic CPU algorithms | Integer-scale algorithms avoid photographic AI and preserve hard edges | Algorithm/unit coverage | Available |

## Changes covered by this audit

- Restoration planning now carries the selected model ID into dispatch, maps
  planning failures to typed UI errors, and validates deblur strength before a
  provider can run.
- Tiled restoration now passes actual tile dimensions to the provider while
  keeping padded tensor dimensions separate. This prevents edge tiles from
  producing an `ImageData` whose byte length disagrees with its dimensions.
- Native SCUNet preprocessing repeats edge pixels to graph-safe dimensions and
  crops the model result back to the source size. It no longer resamples the
  source during padding, keeping native behavior aligned with the worker.
- The anime checkpoint is represented consistently in the model metadata,
  catalog, downloadable manifest, and illustration mode. Missing optional
  artifacts do not silently change the selected task.
- JPEG blockiness estimator (restorationAuto.ts) repaired: NaN at y=0 and
  rowStep structural bias fixed via per-axis accumulators. Two regression
  tests added.
- Deblur strength now user-controllable (Light/Medium/Strong/Maximum = 0.3/0.5/0.7/0.9)
  via `RestorationRequest.deblur.strength`, plumbbed through pipeline, context,
  dialog. Previously hardcoded at 0.7.
- Preview for denoise/deblur-only operations now persists (was cleared by
  `clearPreview` effect firing on `!usesUpscale`).
- Stale-result errors now surface as typed UI messages instead of silent return.
- Real per-stage progress data from `runRestoration.onStageChange` replaces
  fake tile-index-to-stage mapping.
- Native `cpu_upscale` now premultiplies alpha before resize and unpremultiplies
  after, fixing dark fringing at semi-transparent edges.
- Semi-transparent edge color test added to `varve-upscale` crate.

## Remaining gates

- Run the real-model anime task-quality corpus before making comparative claims
  about anime/illustration output.
- Add a validated JPEG-restoration model only after provenance, conversion,
  integrity, and design-content line/text preservation all pass.
- Full production model-backed E2E remains an escalation gate; this audit's
  default validation used mocked providers and deterministic unit contracts.
