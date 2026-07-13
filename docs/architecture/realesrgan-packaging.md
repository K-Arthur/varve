# Real-ESRGAN Packaging

Status: the official `realesr-general-x4v3` checkpoint is converted to ONNX,
checksum-pinned, bundled in the frontend, and enabled through the shared worker path.

## Shipped Artifact

| Field | Value |
|---|---|
| Model id | `upscale-realesr-general` |
| Architecture | `SRVGGNetCompact`, 32 convolution blocks, 4x scale |
| Upstream checkpoint | `realesr-general-x4v3.pth` |
| Upstream asset tag | `v0.2.5.0` in the Real-ESRGAN v0.3.0 release family |
| ONNX file | `apps/desktop/public/models/realesr-general-x4v3.onnx` |
| ONNX size | 4,866,438 bytes |
| SHA-256 | `856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7` |
| Tensor contract | float32 NCHW RGB, `[1,3,H,W]` to `[1,3,4H,4W]` |

The artifact is listed in `apps/desktop/public/models/manifest.json` and
`packages/engine/src/upscaleModels.ts`. It is copied into the Vite production
bundle used by both the browser development surface and the Tauri webview.

## Reproducible Conversion

The converter is self-contained for the exact compact architecture used by this
checkpoint. It downloads the official checkpoint unless `--checkpoint` is supplied,
exports ONNX opset 17, validates it with `onnx.checker`, and prints the final hash.

```bash
python scripts/convert_realesrgan_to_onnx.py \
  --output apps/desktop/public/models/realesr-general-x4v3.onnx
```

The converter contract test checks an 8x8 input produces a 32x32 output:

```bash
PYTHONDONTWRITEBYTECODE=1 python -m unittest scripts.tests.test_convert_realesrgan
```

## Runtime

`dispatchUpscale` tries the enhancement Web Worker first. The worker resolves the
bundled model through the shared model loader and runs ONNX Runtime Web WASM. The
inference adapter:

- normalizes RGB to float32 NCHW;
- uses 256-pixel tile cores with 32 pixels of context and writes only tile cores;
- validates the model's fixed 4x output contract;
- resamples and reattaches the source alpha channel;
- clears RGB for fully transparent output pixels; and
- checks cancellation between tiles.

The optional Rust ORT provider remains available as a native fallback when the
desktop app is compiled with the `ai` feature. It is not required by the shipped
frontend worker route.

## Verification

- The ONNX artifact passes `onnx.checker` and its input/output metadata was inspected.
- Unit tests cover NCHW packing, tile-core copy, dispatch, alpha behavior, manifest
  integrity, and the inspector's locked 4x AI control.
- A production Vite bundle was exercised in Chromium through the real editor UI. The
  generated layer was identified as a Real-ESRGAN `4x-ai` result and undo restored the
  source state.
- `cargo check -p strata-upscale --features ai` compile-verifies the optional native
  provider.

Official references:

- [Real-ESRGAN inference implementation](https://github.com/xinntao/Real-ESRGAN/blob/master/inference_realesrgan.py)
- [SRVGGNetCompact architecture](https://github.com/xinntao/Real-ESRGAN/blob/master/realesrgan/archs/srvgg_arch.py)
- [Real-ESRGAN releases](https://github.com/xinntao/Real-ESRGAN/releases)

## Remaining Platform Scope

There is no active standalone production web app or service worker in this workspace.
The bundled model is available from the Vite/Tauri frontend distribution, but an
offline second visit to a separately deployed web application is not claimed until
that target and its cache policy exist. Cross-platform runtime evidence is currently
Linux Chromium; macOS, Windows, Firefox, and WebKit still need their own packaged runs.
