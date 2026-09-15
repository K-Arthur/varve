# NAFNet export — reproducible model conversion and parity gate

This directory converts official NAFNet checkpoints to Varve's ONNX contract
and proves parity with the trusted reference implementation. The shipped
Deblur model (`nafnet-deblur-gopro`) was produced and verified here; rerunning
these scripts must reproduce the same artifact and hashes.

## Provenance (shipped artifact)

| Field | Value |
|---|---|
| Model | NAFNet-GoPro-width64 (motion/defocus deblurring) |
| Source code | megvii-research/NAFNet @ `2b4af71` (MIT, c) 2022 megvii-model |
| Source checkpoint | `NAFNet-GoPro-width64.pth` |
| Checkpoint SHA-256 | `329d3ab4077b8d6b7ff61de376e483714667960bf85be027bf4335cda701196f` (identical on nyanko7 + mikestealth HF mirrors) |
| Published anchor | 33.7103 dB PSNR on the full GoPro test set (1111 images) |
| Architecture | NAFNet width64, enc `[1,1,1,28]`, middle 1, dec `[1,1,1,1]`, padder size 16 |
| Export tool | torch 2.13.0+cpu, torch.onnx.export, opset 18, dynamic HxW |
| Input contract | `[1,3,H,W]` float32 `[0,1]`, BGR channel order, H/W divisible by 16 |
| Output contract | `[1,3,H,W]` float32 `[0,1]`, BGR (runtime swaps back to RGBA) |
| Artifact | `nafnet-gopro-width64-fp16b-embed.onnx` — fp16 internal weights, fp32 boundary, single file |
| Artifact size | 138,050,767 bytes |
| Artifact SHA-256 | `e9b82a578b6ddf47a3f22118da65d13a4459b53e6c0e5fcf41f5615eadf92f5e` |
| Hosting | `https://github.com/K-Arthur/varve/releases/download/varve-models-v1/nafnet-gopro-width64-fp16b-embed.onnx` |
| License | MIT (megvii-model) — redistribution verified |

Why fp16: fp32 is 271 MB (external-data sidecar), int8 dynamic quantization
produces shape-dependent output corruption at non-16-multiple sizes (measured
21.7 dB vs fp32 at 624x400, deterministic but wrong), and the OpenCV-hosted
int8 export is a trace-unrolled graph with hardcoded shape constants that
crashes on 256x256 and 320x483 inputs. fp16 keeps bit-level sanity (65.2 dB
conversion fidelity on the GoPro subset) with a single-file 138 MB artifact.

Why BGR: the official implementation reads images through OpenCV (BGR) and
the network was trained on BGR tensors. Varve's runtime feeds BGR and swaps
the output planes back to RGBA (see `packages/engine/src/inference/models/
nafnet.ts`); the native Rust path mirrors this through `ImageModelSpec`
channel order.

## Reproduce

```bash
# 1. Clone the official implementation (pinned commit) next to this dir
git clone https://github.com/megvii-research/NAFNet.git tools/nafnet-export/.nafnet-ref
git -C tools/nafnet-export/.nafnet-ref checkout 2b4af71

# 2. Python env: torch (CPU ok), onnxruntime, onnx, numpy, opencv-python, lmdb
python -m venv .venv && .venv/bin/pip install torch onnxruntime onnx numpy opencv-python lmdb

# 3. Download the official checkpoint (any mirror pinned by the hash above)
curl -L -o NAFNet-GoPro-width64.pth \
  https://huggingface.co/nyanko7/nafnet-models/resolve/main/NAFNet-GoPro-width64.pth
sha256sum NAFNet-GoPro-width64.pth   # must equal the checkpoint hash above

# 4. Export (fp32 first, then wrap to fp16 with an fp32 boundary)
python tools/nafnet-export/export_nafnet_onnx.py \
  --checkpoint NAFNet-GoPro-width64.pth --output nafnet-gopro-width64-fp32.onnx
# then run the fp16 boundary export (see the script's docstring)

# 5. Parity vs the trusted reference on fixtures (real photos, text, gradients)
python tools/nafnet-export/reference_infer.py --checkpoint NAFNet-GoPro-width64.pth \
  --input fixtures/*.png --output-dir ref-output
python tools/nafnet-export/parity_check.py --checkpoint NAFNet-GoPro-width64.pth \
  --onnx nafnet-gopro-width64-fp32.onnx --input fixtures/*.png

# 6. Optional: GoPro test-set PSNR gate (official LMDB eval set)
python tools/nafnet-export/gopro_gate.py \
  --checkpoint NAFNet-GoPro-width64.pth --lmdb-root GoPro/test \
  --onnx nafnet-gopro-width64-fp32.onnx nafnet-gopro-width64-fp16b-embed.onnx \
  --limit 24
```

## Measured gate (2026-08-13, reproduced for the shipped artifact)

| Gate | Result | Tolerance |
|---|---|---|
| torch ref vs ORT fp32, real photos | 94-104 dB, max diff <= 1/255 | >= 60 dB |
| torch ref vs ORT fp32, GoPro subset (24 img) | 98.94 dB mean | >= 60 dB |
| torch ref vs ORT fp16, GoPro subset | 65.24 dB mean | >= 55 dB |
| torch ref vs GT, GoPro subset | 32.20 dB mean (subset of the 33.71 dB full-set anchor) | within ~1.5 dB of anchor |
| int8 QDQ conversion | REJECTED: 21.7 dB at 624x400 (shape-dependent corruption) | — |
| OpenCV int8 export | REJECTED: trace-unrolled graph crashes on 256x256 / 320x483 | — |

## Task-locking

This checkpoint is validated for **deblur only**. It is not advertised for
denoise or JPEG artifact removal; `RestorationCapability.task` gates every
operation in `packages/engine/src/restoration.ts`. On out-of-distribution
synthetic inputs the network is unstable (it hallucinates saturated colour on
adversarial patterns) — the same instability is visible in the torch
reference, so it is a model property, not a conversion defect. Users see
honest per-operation capability, and design-fidelity tests cover text,
edges, and logos separately (see `docs/quality/image-enhancement-benchmark.md`).
