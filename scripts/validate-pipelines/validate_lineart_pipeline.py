#!/usr/bin/env python3
"""
Real end-to-end validation of the line-art extraction pipeline against
the actual ONNX weights. Exercises the exact preprocessing/decoding
implemented in packages/engine/src/inference/models/lineArt.ts.

Session note (2026-07-21): this validation caught a real bug — decoding
did a straight resize from the model's padded square output back to the
original aspect ratio, stretching the letterbox padding into the image
and shifting real content. A horizontal test edge at a known row landed
49px off (4.5% of image height) with the naive resize vs 18px off (1.7%)
once the letterbox region is cropped out first. Also confirmed via direct
ONNX graph inspection that the model's actual output tensor is named
"output", not "data" as the first version of the calling code assumed —
that alone would have made the feature throw/crash on first real use.

Usage:
    python3 validate_lineart_pipeline.py --synthetic
        Deterministic edge-position regression test. Requires
        informative-drawings-line-art.onnx locally (see --model-path).

    python3 validate_lineart_pipeline.py --real-image path/to/photo.jpg \\
        --output /tmp/lineart.png
        Spot-check against a real photo; saves the result for visual
        inspection.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

try:
    import onnxruntime as ort
    from PIL import Image, ImageDraw
except ImportError as e:
    print(f"ERROR: missing dependency ({e}). Run: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

MODEL_INPUT_SIZE = 256
# Acceptance threshold: max acceptable edge-position error as a fraction
# of image height, with the letterbox crop applied.
MAX_EDGE_ERROR_FRACTION = 0.03


def letterbox_preprocess(img: "Image.Image", input_size: int = MODEL_INPUT_SIZE):
    w, h = img.size
    scale = min(input_size / w, input_size / h)
    scaled_w, scaled_h = round(w * scale), round(h * scale)
    offset_x = (input_size - scaled_w) / 2
    offset_y = (input_size - scaled_h) / 2
    canvas = Image.new("RGB", (input_size, input_size), (255, 255, 255))
    resized = img.resize((scaled_w, scaled_h), Image.BILINEAR)
    canvas.paste(resized, (round(offset_x), round(offset_y)))
    arr = np.asarray(canvas, dtype=np.float32) / 255.0  # [0,1], no mean/std subtract
    tensor = arr.transpose(2, 0, 1)[np.newaxis, ...].astype(np.float32)
    return tensor, offset_x, offset_y, scaled_w, scaled_h


def decode_with_letterbox_crop(output_hw, offset_x, offset_y, scaled_w, scaled_h, target_w, target_h):
    img = Image.fromarray((np.clip(output_hw, 0, 1) * 255).astype(np.uint8), "L")
    crop = img.crop((round(offset_x), round(offset_y), round(offset_x + scaled_w), round(offset_y + scaled_h)))
    return np.asarray(crop.resize((target_w, target_h), Image.BILINEAR))


def make_horizontal_bar_image(width, height):
    img = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    bar_y0, bar_y1 = int(height * 0.6), int(height * 0.65)
    draw.rectangle([0, bar_y0, width, bar_y1], fill=(0, 0, 0))
    return img, bar_y0, bar_y1


def run_synthetic_suite(model_path: Path) -> bool:
    sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name

    w, h = 1920, 1080
    img, bar_y0, bar_y1 = make_horizontal_bar_image(w, h)
    tensor, ox, oy, sw, sh = letterbox_preprocess(img)
    out = sess.run(None, {input_name: tensor})[0]
    out = out[0, 0] if out.ndim == 4 else out[0]

    decoded = decode_with_letterbox_crop(out, ox, oy, sw, sh, w, h)
    row_means = decoded.mean(axis=1)
    dark_row = int(np.argmin(row_means))
    expected_row = (bar_y0 + bar_y1) // 2
    error_fraction = abs(dark_row - expected_row) / h

    passed = error_fraction <= MAX_EDGE_ERROR_FRACTION
    status = "PASS" if passed else "FAIL"
    print(
        f"[{status}] wide 1920x1080 horizontal-edge position: "
        f"expected row {expected_row}, got {dark_row} "
        f"(error {error_fraction * 100:.1f}%, max {MAX_EDGE_ERROR_FRACTION * 100:.0f}%)"
    )
    return passed


def run_real_image(model_path: Path, image_path: Path, output_path: Path | None):
    sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name

    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    tensor, ox, oy, sw, sh = letterbox_preprocess(img)
    out = sess.run(None, {input_name: tensor})[0]
    out = out[0, 0] if out.ndim == 4 else out[0]

    decoded = decode_with_letterbox_crop(out, ox, oy, sw, sh, w, h)
    print(f"image: {image_path} ({w}x{h})")
    print(f"output stats: min={out.min():.3f} max={out.max():.3f} mean={out.mean():.3f}")
    if output_path:
        Image.fromarray(decoded, "L").save(output_path)
        print(f"saved: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model-path", type=Path,
                         default=Path(__file__).parent / "models" / "lineart.onnx")
    parser.add_argument("--synthetic", action="store_true")
    parser.add_argument("--real-image", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if not args.synthetic and not args.real_image:
        parser.error("pass --synthetic and/or --real-image")

    ok = True
    if args.synthetic:
        ok = run_synthetic_suite(args.model_path) and ok
    if args.real_image:
        run_real_image(args.model_path, args.real_image, args.output)

    sys.exit(0 if ok else 1)
