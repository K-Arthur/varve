#!/usr/bin/env python3
"""
Real end-to-end validation of the SAM2 "Select Subject" pipeline against
the actual ONNX weights — not mocked tensors. Exercises the exact
preprocessing (letterbox resize into the fixed 1024x1024 encoder input)
and prompt encoding (point/box -> pixel coordinates, mask_input/
has_mask_input always present) implemented in
packages/engine/src/inference/models/sam2.ts, so a regression in either
file is caught by running actual inference, not just checking tensor
shapes.

Session note (2026-07-21): this validation is what caught a real,
severe bug — the original prompt encoding mapped normalized coordinates
directly to 1024-space (`x_norm * 1024`) with no awareness that the
image itself gets letterboxed (scaled to fit + centered + padded) for
any non-square source. On a synthetic 1920x1080 test image with a known
subject, that produced mask-vs-ground-truth IoU of 0.002 while the model
*confidently* reported 0.98 IoU for the wrong region — a silent-wrong-
answer failure, not a crash. The fix (threading the encoder's letterbox
offset through to prompt encoding) brought that to 0.69 IoU on the same
synthetic case, and produces a visually correct mask on a real photo
(see docs/testing/sam2-lineart-validation-2026-07-21.md).

Usage:
    python3 validate_sam2_pipeline.py --synthetic
        Deterministic synthetic ground-truth tests (square + wide + tall
        images with a known-position colored square subject). Fails the
        process (non-zero exit) if mask-vs-ground-truth IoU regresses
        below the recorded thresholds. Requires the encoder/decoder ONNX
        files to be present locally (see --models-dir); does not download
        them automatically to avoid an unreviewed network dependency in
        CI — run download_models.py first, or point --models-dir at an
        existing copy.

    python3 validate_sam2_pipeline.py --real-image path/to/photo.jpg \\
        --point 0.4,0.5 --output /tmp/overlay.png
        Spot-check against a real photo: runs a point prompt, prints
        coverage/centroid sanity stats, and saves a red-mask overlay for
        visual inspection. Not part of the automated gate (no ground
        truth for arbitrary photos) — a manual verification tool.
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

SAM2_INPUT_SIZE = 1024
MASK_INPUT_SIZE = 256
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Acceptance thresholds for the synthetic ground-truth tests. A regression
# in prompt encoding, letterbox handling, or mask decoding will drop these.
MIN_IOU_SQUARE = 0.90
MIN_IOU_NON_SQUARE = 0.50


def letterbox_preprocess(img: "Image.Image", input_size: int = SAM2_INPUT_SIZE):
    """Matches packages/engine/src/inference/inferenceWorker.ts exactly:
    scale to fit within input_size x input_size, center, pad black."""
    w, h = img.size
    scale = min(input_size / w, input_size / h)
    scaled_w, scaled_h = round(w * scale), round(h * scale)
    offset_x = (input_size - scaled_w) / 2
    offset_y = (input_size - scaled_h) / 2

    canvas = Image.new("RGB", (input_size, input_size), (0, 0, 0))
    resized = img.resize((scaled_w, scaled_h), Image.BILINEAR)
    canvas.paste(resized, (round(offset_x), round(offset_y)))

    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    arr = (arr - MEAN) / STD
    tensor = arr.transpose(2, 0, 1)[np.newaxis, ...].astype(np.float32)
    return tensor, offset_x, offset_y


def encode_point(x_norm: float, y_norm: float, offset_x: float, offset_y: float):
    """Matches encodeSam2Prompts in sam2.ts: map normalized 0-1 coordinates
    (relative to the *original* image) into 1024-space accounting for the
    letterbox offset — NOT a naive `x_norm * 1024`."""
    scaled_w = SAM2_INPUT_SIZE - 2 * offset_x
    scaled_h = SAM2_INPUT_SIZE - 2 * offset_y
    return offset_x + x_norm * scaled_w, offset_y + y_norm * scaled_h


def run_sam2(encoder, decoder, image_tensor, point_x, point_y):
    enc_out = encoder.run(None, {"image": image_tensor})
    enc_outs = dict(zip([o.name for o in encoder.get_outputs()], enc_out))

    point_coords = np.array([[[point_x, point_y]]], dtype=np.float32)
    point_labels = np.array([[1]], dtype=np.float32)
    mask_input = np.zeros((1, 1, MASK_INPUT_SIZE, MASK_INPUT_SIZE), dtype=np.float32)
    has_mask_input = np.array([0], dtype=np.float32)

    dec_out = decoder.run(
        None,
        {
            "image_embed": enc_outs["image_embed"],
            "high_res_feats_0": enc_outs["high_res_feats_0"],
            "high_res_feats_1": enc_outs["high_res_feats_1"],
            "point_coords": point_coords,
            "point_labels": point_labels,
            "mask_input": mask_input,
            "has_mask_input": has_mask_input,
        },
    )
    dec_outs = dict(zip([o.name for o in decoder.get_outputs()], dec_out))
    return dec_outs["masks"][0], dec_outs["iou_predictions"][0]  # [3,H,W], [3]


def mask_to_full_res(mask_logits_hw, offset_x, offset_y, scaled_w, scaled_h, target_w, target_h):
    """Upscale the decoder's low-res mask to 1024-space, crop out the
    letterbox padding, then resize to the original image dimensions."""
    mask_h, mask_w = mask_logits_hw.shape
    ys = (np.arange(SAM2_INPUT_SIZE) * mask_h / SAM2_INPUT_SIZE).astype(int).clip(0, mask_h - 1)
    xs = (np.arange(SAM2_INPUT_SIZE) * mask_w / SAM2_INPUT_SIZE).astype(int).clip(0, mask_w - 1)
    upscaled = mask_logits_hw[ys][:, xs]
    binary = (upscaled > 0).astype(np.uint8) * 255
    crop = Image.fromarray(binary, "L").crop(
        (round(offset_x), round(offset_y), round(offset_x + scaled_w), round(offset_y + scaled_h))
    )
    return np.asarray(crop.resize((target_w, target_h), Image.NEAREST)) > 0


def make_synthetic_image(width, height, seed):
    rng = np.random.RandomState(seed)
    bg = rng.randint(100, 156, size=(height, width, 3), dtype=np.uint8)
    img = Image.fromarray(bg, "RGB")
    draw = ImageDraw.Draw(img)
    side = int(min(width, height) * 0.3)
    x0, y0 = int(width * 0.15), int(height * 0.15)
    x1, y1 = x0 + side, y0 + side
    draw.rectangle([x0, y0, x1, y1], fill=(220, 30, 30))
    return img, (x0, y0, x1, y1)


def iou_vs_bbox(mask_bool, bbox, w, h):
    gt = np.zeros((h, w), dtype=bool)
    gt[bbox[1] : bbox[3], bbox[0] : bbox[2]] = True
    intersection = np.logical_and(mask_bool, gt).sum()
    union = np.logical_or(mask_bool, gt).sum()
    return intersection / union if union > 0 else 0.0


def run_synthetic_suite(models_dir: Path) -> bool:
    encoder = ort.InferenceSession(str(models_dir / "sam2_encoder.onnx"), providers=["CPUExecutionProvider"])
    decoder = ort.InferenceSession(str(models_dir / "sam2_decoder.onnx"), providers=["CPUExecutionProvider"])

    cases = [
        ("square 1024x1024", 1024, 1024, 1, MIN_IOU_SQUARE),
        ("wide 1920x1080", 1920, 1080, 2, MIN_IOU_NON_SQUARE),
        ("tall 1080x1920", 1080, 1920, 3, MIN_IOU_NON_SQUARE),
    ]
    all_passed = True
    for label, w, h, seed, min_iou in cases:
        img, bbox = make_synthetic_image(w, h, seed=seed)
        tensor, ox, oy = letterbox_preprocess(img)
        cx_norm = (bbox[0] + bbox[2]) / 2 / w
        cy_norm = (bbox[1] + bbox[3]) / 2 / h
        px, py = encode_point(cx_norm, cy_norm, ox, oy)

        masks, ious = run_sam2(encoder, decoder, tensor, px, py)
        best_idx = int(np.argmax(ious))
        scale = min(SAM2_INPUT_SIZE / w, SAM2_INPUT_SIZE / h)
        scaled_w, scaled_h = round(w * scale), round(h * scale)
        mask_bool = mask_to_full_res(masks[best_idx], ox, oy, scaled_w, scaled_h, w, h)
        iou = iou_vs_bbox(mask_bool, bbox, w, h)

        passed = iou >= min_iou
        all_passed = all_passed and passed
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {label}: mask-vs-ground-truth IoU={iou:.3f} (min {min_iou}), model-reported confidence={ious[best_idx]:.3f}")

    return all_passed


def run_real_image(models_dir: Path, image_path: Path, point: tuple[float, float], output_path: Path | None):
    encoder = ort.InferenceSession(str(models_dir / "sam2_encoder.onnx"), providers=["CPUExecutionProvider"])
    decoder = ort.InferenceSession(str(models_dir / "sam2_decoder.onnx"), providers=["CPUExecutionProvider"])

    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    tensor, ox, oy = letterbox_preprocess(img)
    px, py = encode_point(point[0], point[1], ox, oy)

    masks, ious = run_sam2(encoder, decoder, tensor, px, py)
    best_idx = int(np.argmax(ious))
    scale = min(SAM2_INPUT_SIZE / w, SAM2_INPUT_SIZE / h)
    scaled_w, scaled_h = round(w * scale), round(h * scale)
    mask_bool = mask_to_full_res(masks[best_idx], ox, oy, scaled_w, scaled_h, w, h)

    coverage = mask_bool.sum() / mask_bool.size * 100
    ys_idx, xs_idx = np.where(mask_bool)
    centroid = (xs_idx.mean() / w, ys_idx.mean() / h) if len(xs_idx) else (float("nan"),) * 2

    print(f"image: {image_path} ({w}x{h})")
    print(f"prompt point (normalized): {point}")
    print(f"model-reported confidence: {ious[best_idx]:.3f}")
    print(f"mask coverage: {coverage:.1f}% of image")
    print(f"mask centroid (normalized): ({centroid[0]:.3f}, {centroid[1]:.3f})")

    if output_path:
        arr = np.asarray(img).copy()
        arr[mask_bool] = (arr[mask_bool] * 0.3 + np.array([255, 0, 0]) * 0.7).astype(np.uint8)
        Image.fromarray(arr).save(output_path)
        print(f"saved overlay: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models-dir", type=Path, default=Path(__file__).parent / "models",
                         help="Directory containing sam2_encoder.onnx and sam2_decoder.onnx")
    parser.add_argument("--synthetic", action="store_true", help="Run the synthetic ground-truth regression suite")
    parser.add_argument("--real-image", type=Path, help="Path to a real photo for a manual spot-check")
    parser.add_argument("--point", type=str, default="0.5,0.5", help="Normalized x,y prompt point for --real-image")
    parser.add_argument("--output", type=Path, help="Where to save the mask overlay for --real-image")
    args = parser.parse_args()

    if not args.synthetic and not args.real_image:
        parser.error("pass --synthetic and/or --real-image")

    ok = True
    if args.synthetic:
        ok = run_synthetic_suite(args.models_dir) and ok
    if args.real_image:
        point = tuple(float(v) for v in args.point.split(","))
        run_real_image(args.models_dir, args.real_image, point, args.output)

    sys.exit(0 if ok else 1)
