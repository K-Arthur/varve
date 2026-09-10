# DDColor ONNX Export — Reproducible Conversion Recipe

This directory documents the reproducible conversion of the official DDColor
weights to ONNX format for use in Varve's colorization pipeline.

## Source

- **Paper**: "DDColor: Towards Photo-Realistic Image Colorization via Dual
  Decoders" (Kang, Yang, Ouyang, Ren, Li, Xie; ICCV 2023).
  https://arxiv.org/abs/2212.11613
- **Code**: https://github.com/piddnad/DDColor — Apache-2.0 license.
- **Weights**:
  - DDColor-L (ConvNeXt-large): https://huggingface.co/piddnad/ddcolor_modelscope
  - DDColor-T (ConvNeXt-tiny): https://huggingface.co/piddnad/ddcolor_paper_tiny
  - Both Apache-2.0 licensed.

## Pinned Versions

| Component | Version / Commit |
|-----------|-----------------|
| DDColor repo | `piddnad/DDColor@master` (pin commit at build time) |
| Python | 3.10.x |
| PyTorch | 2.1.x |
| ONNX | 1.14.x |
| ONNX Runtime | 1.17.x (must match Varve's runtime) |
| onnxsim | 0.4.x |
| Opset | 12 |

## Conversion Steps

1. Clone `https://github.com/piddnad/DDColor` at the pinned commit.
2. Download the `.pth` checkpoint from the HuggingFace repo (Apache-2.0).
3. Verify the checkpoint SHA-256: compute it locally (`sha256sum`) and record
   it in the [Record](#record) table below — the table is the intended place
   for the pinned values; no `checksums.txt` is kept in this directory.
4. Run the official export script:

   ```bash
   # DDColor-Tiny (256x256 input)
   python scripts/export_onnx.py \
     --model_path pretrain/ddcolor_paper_tiny.pth \
     --model_size tiny \
     --input_size 256 \
     --export_path ddcolor-tiny.onnx \
     --opset 12

   # DDColor-Large (512x512 input)
   python scripts/export_onnx.py \
     --model_path pretrain/ddcolor_modelscope.pth \
     --model_size large \
     --input_size 512 \
     --export_path ddcolor.onnx \
     --opset 12
   ```

5. The export script runs `onnx.checker.check_model`, shape inference,
   symbolic shape inference, and `onnxsim.simplify` automatically.

## Expected Output

| Model | Input | Output | Size (approx) |
|-------|-------|--------|--------------|
| ddcolor-tiny | `[1, 3, 256, 256]` float32 RGB [0,1] | `[1, 2, 256, 256]` a*b* | ~50 MB |
| ddcolor | `[1, 3, 512, 512]` float32 RGB [0,1] | `[1, 2, 512, 512]` a*b* | ~156 MB |

- Input name: `input`, Output name: `output`.
- Normalization: none (RGB divided by 255 in preprocessing).
- Padding: gray (128, 128, 128) for letterboxing.

## Post-Export Verification

1. `onnx.checker.check_model` — graph validity.
2. ONNX Runtime smoke inference with a random tensor, confirm output shape.
3. Numerical comparison: run the same image through the PyTorch model and the
   ONNX model, confirm a*b* MAE < 1e-3.

## Record

| Field | ddcolor-tiny | ddcolor |
|-------|-------------|---------|
| Source weight SHA-256 | *(pin at build)* | *(pin at build)* |
| Exported ONNX SHA-256 | *(pin at build)* | *(pin at build)* |
| Export date | *(fill)* | *(fill)* |
| Exported by | *(fill)* | *(fill)* |

## License & Redistribution

DDColor code and weights are Apache-2.0. The exported ONNX artifact is a
derivative work and may be redistributed under Apache-2.0 with attribution.
See `LICENSE` in the DDColor repo.

## Why Not a Community ONNX Upload

The HuggingFace community upload `Diogo122333/ddcolor-512-fp16-v6.onnx` was
evaluated and rejected: it has no model card, no stated license, no provenance,
and no conversion script. Per Varve's acquisition policy we do not ship
untrusted third-party binaries. This recipe produces a verifiable artifact from
the official Apache-2.0 source instead.
