# Illustration upscaler qualification audit

**Date:** 2026-09-30
**Scope:** the optional `upscale-realesrgan-anime` ONNX artifact and its
browser-WASM execution path.
**Decision:** the artifact is integrity- and tensor-contract-checked, but is not
qualified for artist-facing use. The UI keeps the mode unavailable pending
conversion provenance, converted-artifact distribution review, an artist-image
quality corpus, and broader runtime/memory validation.

## Artifact identity and source record

The downloaded artifact is 17,906,556 bytes. Its measured SHA-256 is
`2648cab4c4343541c1aa291c6754e9e8edbe7a813fffc2a677423dd12cb6b7f7`.
The checked-in manifest previously had a 63-character digest with a missing
`1`; the manifest's integrity-admission check therefore rejected the artifact.
The manifest and contract regression now use the measured 64-character digest.

The upstream [Real-ESRGAN model zoo](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/model_zoo.md)
describes `x4plus_anime_6B` as a 4× anime-oriented model. The upstream
[anime model guide](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/anime_model.md)
and [repository license](https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE)
describe the upstream checkpoint and repository license. The matching ONNX file
is present at the pinned [deepghs upload commit](https://huggingface.co/deepghs/imgutils-models/commit/35e0ed8f35ce0dbea674568161a48b31ba7d2a99).
That upload record does not identify the conversion toolchain or demonstrate
numerical parity. Upstream licensing does not by itself establish distribution
rights for the converted artifact. Both questions remain open; metadata now
states this rather than treating the source checkpoint license as complete
artifact provenance.

## Runtime smoke measurements

Measurements used `onnxruntime-web@1.27.0`, Node.js 22.23.2, WebAssembly with
one thread, on Linux x86_64 with an AMD Ryzen 3 5300U. They exercised the ONNX
artifact directly, not the full Varve browser UI, desktop/Tauri runtime, or a
hardware-accelerated provider.

| Input | Output | Session creation | Inference | Process memory observation |
|---|---:|---:|---:|---:|
| 128×96 synthetic thin-line crop | 512×384 | 612 ms | 10.154 s | Not recorded |
| 128×96 synthetic pixel-art crop | 512×384 | Reused | 10.922 s | Not recorded |
| 128×96 synthetic flat-logo crop | 512×384 | Reused | 11.522 s | Not recorded |
| 256×192 resized flat-logo crop | 1024×768 | Reused | 54.360 s | RSS after inference: 844,169,216 bytes |
| 320×320 synthetic tile stress input | 1280×1280 | 745 ms | 112.809 s | `VmHWM`: 1,458,688,000 bytes; RSS after inference: 1,457,868,800 bytes |

The 320×320 case matches the current worker's maximum padded tile (256-pixel
core plus 32-pixel padding on each edge). The input was resized from a synthetic
flat-logo fixture to exercise the memory/time bound; it is not image-quality
evidence. The 1.6 GB admission estimate leaves headroom above this one measured
tile peak. The full output image allocation is additional; for example, a
16,384×16,384 RGBA output alone is about 1 GiB before intermediate buffers,
source pixels, model state, and editor history.

The raw model output included values below 0 and above 1; the existing tile
copy path clamps channel values to `[0,1]`. Side-by-side crops against classical
Lanczos show visible edge and color differences on the synthetic thin-line and
pixel-art fixtures. They do not establish which result is preferable for
artists, and the mostly blank logo crop is not informative. The inspected
images are `/tmp/varve-anime-qual-thin-lines-comparison.png`,
`/tmp/varve-anime-qual-pixel-art-comparison.png`, and
`/tmp/varve-anime-qual-logo-flat-comparison.png`; these temporary files are not
product screenshots or a maintained benchmark corpus.

## Changes made from this evidence

- Corrected the manifest checksum and pinned the model source URL to the upload
  commit.
- Separated artifact identity, tensor-contract smoke, conversion provenance,
  distribution review, runtime resource cost, and artist-quality qualification.
- Changed the anime capability to `not-validated` / `experimental`, raised its
  measured tile memory estimate to 1.6 GB, and kept it out of the selectable
  enhancement path until its outstanding gates pass.
- Preserved the separately qualified general enhancement mode and the explicit
  classical resize option. The anime path never silently falls back to another
  model.
- Added manifest, planner, alpha-edge, and mode-availability regressions. The
  focused run passed 320 tests across four files:

  ```bash
  pnpm exec vitest run \
    packages/editor/src/components/Upscale/upscaleModeOptions.test.ts \
    packages/engine/src/restoration.test.ts \
    packages/engine/src/inference/__tests__/manifestContracts.test.ts \
    packages/engine/src/upscaleProviders/aiUpscale.test.ts \
    --maxWorkers=1
  ```

## Still unverified

No artist-quality corpus, conversion reproduction/parity, converted-file
redistribution review, whole-document peak memory, production-browser session,
native/Tauri inference, GPU provider, ARM device, physical tablet, or cross-OS
benchmark was completed in this audit. The synthetic crops do not justify a
quality claim. Re-enable the UI mode only after those relevant gates are
documented and measured independently.
