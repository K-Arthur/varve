#!/usr/bin/env python3
"""
Dump real SAM2 decoder outputs for cross-language reconstruction parity.

The application (packages/engine/src/inference/models/sam2.ts
decodeSam2DecoderOutput) and this validator (mask_to_full_res) reconstruct the
source-resolution mask from the decoder's low-res logits in different orders.
Both are validated against source-space ground truth independently, but a
validator that reconstructs differently from production cannot certify that
production lands on the *same pixels* — so this script freezes one real model
run and lets the TypeScript side decode the identical bytes.

For each synthetic case it writes:

    <out>/<case>/logits.f32          float32 LE, [3, 256, 256] raw decoder masks
    <out>/<case>/ious.json           model-reported IoU per candidate
    <out>/<case>/geometry.json       letterbox + source geometry + ground truth
    <out>/<case>/reference_mask.pgm  this validator's reconstruction (P5, 0/255)
    <out>/<case>/gt_mask.pgm         ground-truth rectangle (P5, 0/255)

Usage:
    python dump_sam2_fixture.py --out /tmp/sam2-parity
    python dump_sam2_fixture.py --out /tmp/sam2-parity --cases wide,tall

Then run the TypeScript side:
    SAM2_REAL_PARITY_DIR=/tmp/sam2-parity npx vitest run \
        packages/engine/src/inference/models/sam2RealReconstructionParity.test.ts
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

try:
    import onnxruntime as ort
    from PIL import Image
except ImportError as e:  # pragma: no cover - environment guard
    print(f"ERROR: missing dependency ({e}). Run: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

from validate_sam2_pipeline import (  # noqa: E402 - sibling module
    encode_point,
    letterbox_preprocess,
    make_synthetic_image,
    mask_to_full_res,
    run_sam2,
)

CASES = {
    "square": (1024, 1024, 1),
    "wide": (1920, 1080, 2),
    "tall": (1080, 1920, 3),
    "panoramic": (4000, 800, 4),
}


def write_pgm(path: Path, mask_bool: np.ndarray) -> None:
    """Write a boolean mask as a binary PGM (P5) — trivial to parse anywhere."""
    height, width = mask_bool.shape
    payload = (mask_bool.astype(np.uint8)) * 255
    header = f"P5\n{width} {height}\n255\n".encode("ascii")
    path.write_bytes(header + payload.tobytes())


def dump_case(name: str, encoder, decoder, out_dir: Path) -> dict:
    width, height, seed = CASES[name]
    img, bbox = make_synthetic_image(width, height, seed=seed)
    tensor, offset_x, offset_y = letterbox_preprocess(img)

    cx_norm = (bbox[0] + bbox[2]) / 2 / width
    cy_norm = (bbox[1] + bbox[3]) / 2 / height
    px, py = encode_point(cx_norm, cy_norm, offset_x, offset_y)

    masks, ious = run_sam2(encoder, decoder, tensor, px, py)  # [3,256,256], [3]
    best_idx = int(np.argmax(ious))

    scale = min(1024 / width, 1024 / height)
    scaled_w, scaled_h = round(width * scale), round(height * scale)

    reference = mask_to_full_res(masks[best_idx], offset_x, offset_y, scaled_w, scaled_h, width, height)

    gt = np.zeros((height, width), dtype=bool)
    gt[bbox[1] : bbox[3], bbox[0] : bbox[2]] = True

    case_dir = out_dir / name
    case_dir.mkdir(parents=True, exist_ok=True)
    np.ascontiguousarray(masks.astype(np.float32)).tofile(case_dir / "logits.f32")
    (case_dir / "ious.json").write_text(json.dumps([float(v) for v in ious], indent=1))
    (case_dir / "geometry.json").write_text(
        json.dumps(
            {
                "case": name,
                "sourceWidth": width,
                "sourceHeight": height,
                "offsetX": offset_x,
                "offsetY": offset_y,
                "contentWidth": scaled_w,
                "contentHeight": scaled_h,
                "modelInputSize": 1024,
                "maskWidth": int(masks.shape[2]),
                "maskHeight": int(masks.shape[1]),
                "point": {"x": cx_norm, "y": cy_norm, "modelX": px, "modelY": py},
                "groundTruth": {"x0": bbox[0], "y0": bbox[1], "x1": bbox[2], "y1": bbox[3]},
                "bestIndex": best_idx,
                "modelIou": float(ious[best_idx]),
            },
            indent=1,
        )
    )
    write_pgm(case_dir / "reference_mask.pgm", reference)
    write_pgm(case_dir / "gt_mask.pgm", gt)

    ref_iou = float(np.logical_and(reference, gt).sum() / np.logical_or(reference, gt).sum())
    print(f"[{name}] wrote {case_dir} (validator IoU vs GT: {ref_iou:.3f})")
    return {"case": name, "validatorIou": ref_iou}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-dir", type=Path, default=Path(__file__).parent / "models")
    parser.add_argument("--out", type=Path, required=True, help="Output directory for fixtures")
    parser.add_argument(
        "--cases",
        type=str,
        default=",".join(CASES),
        help=f"Comma-separated subset of: {', '.join(CASES)}",
    )
    args = parser.parse_args()

    selected = [case.strip() for case in args.cases.split(",") if case.strip()]
    unknown = [case for case in selected if case not in CASES]
    if unknown:
        parser.error(f"unknown case(s): {', '.join(unknown)}")

    encoder = ort.InferenceSession(str(args.models_dir / "sam2_encoder.onnx"), providers=["CPUExecutionProvider"])
    decoder = ort.InferenceSession(str(args.models_dir / "sam2_decoder.onnx"), providers=["CPUExecutionProvider"])

    args.out.mkdir(parents=True, exist_ok=True)
    for case in selected:
        dump_case(case, encoder, decoder, args.out)
    print(f"fixtures written to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
