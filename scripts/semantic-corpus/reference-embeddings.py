#!/usr/bin/env python3
"""Generate reference embedding fixtures for Varve's semantic similarity parity tests.

Runs the canonical Varve semantic preprocessing (scripts are mirrored from
packages/engine/src/semanticSimilarity/preprocess.ts — keep them in lockstep;
the parity test compares this output against the TypeScript implementation)
and computes embeddings with the official ONNX Runtime Python build, then
writes compact fixture files that the vitest parity test checks.

Usage:
    python3 -m venv /tmp/opencode/ort-venv
    /tmp/opencode/ort-venv/bin/pip install onnxruntime pillow
    VARVE_MODEL_CACHE=/tmp/opencode/models /tmp/opencode/ort-venv/bin/python \
        scripts/semantic-corpus/reference-embeddings.py

Output: packages/engine/src/semanticSimilarity/bench/__fixtures__/reference/*.json
Each fixture: { "modelId": ..., "spec": ..., "images": { "<imageId>": { "base64": ... } } }
"""

import base64
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
CORPUS = REPO / "tests" / "fixtures" / "semantic-corpus"
OUT_DIR = (
    REPO / "packages" / "engine" / "src" / "semanticSimilarity" / "bench" / "__fixtures__" / "reference"
)
MODEL_CACHE = Path(os.environ.get("VARVE_MODEL_CACHE", Path.home() / ".cache" / "varve" / "models"))

MODELS = {
    "siglip-base-patch16-224": {
        "file": "siglip-base-patch16-224.onnx",
        "input": "pixel_values",
        "output": "image_embeds",
        "constant_inputs": {"input_ids": np.zeros((1, 1), dtype=np.int64)},
        "policy": "letterbox",
        "size": 224,
        "mean": (0.5, 0.5, 0.5),
        "std": (0.5, 0.5, 0.5),
        "pad": (128, 128, 128),
    },
    "dinov2-small": {
        "file": "dinov2-small.onnx",
        "input": "pixel_values",
        "output": "last_hidden_state",
        "constant_inputs": {},
        "policy": "shorter-side-center-crop",
        "shortest_edge": 256,
        "crop_size": 224,
        "mean": (0.485, 0.456, 0.406),
        "std": (0.229, 0.224, 0.225),
        "pad": (128, 128, 128),
        "cls_token_index": 0,
    },
}


def round_half_up(value: float) -> int:
    """Mirror JS Math.round (half-up). Python's builtin round() is banker's
    rounding (half-to-even), which diverges from the TypeScript pipeline on
    e.g. portrait letterbox offsets (22.5 -> 22 vs 23) and shifts pixels."""
    return math.floor(value + 0.5)


def matte_to_opaque_rgb(rgba: np.ndarray) -> np.ndarray:
    """RGBA uint8 HxWx4 -> planar float64 RGB (R plane, G plane, B plane)."""
    h, w = rgba.shape[0], rgba.shape[1]
    alpha = (rgba[:, :, 3].astype(np.float64) / 255.0)[..., None]
    rgb = rgba[:, :, :3].astype(np.float64) * alpha + 128.0 * (1.0 - alpha)
    return np.stack([rgb[:, :, 0].ravel(), rgb[:, :, 1].ravel(), rgb[:, :, 2].ravel()])


def bilinear_resize(planes: np.ndarray, src_w: int, src_h: int, dst_w: int, dst_h: int) -> np.ndarray:
    """Mirror of resizeBilinearF64: half-pixel aligned, edge clamped, planar."""
    out = np.empty((3, dst_h * dst_w), dtype=np.float64)
    x_ratio = src_w / dst_w
    y_ratio = src_h / dst_h
    for y in range(dst_h):
        src_y = (y + 0.5) * y_ratio - 0.5
        y0 = max(0, math.floor(src_y))
        y1 = min(src_h - 1, y0 + 1)
        yf = max(0.0, min(1.0, src_y - y0))
        for x in range(dst_w):
            src_x = (x + 0.5) * x_ratio - 0.5
            x0 = max(0, math.floor(src_x))
            x1 = min(src_w - 1, x0 + 1)
            xf = max(0.0, min(1.0, src_x - x0))
            idx00 = y0 * src_w + x0
            idx01 = y0 * src_w + x1
            idx10 = y1 * src_w + x0
            idx11 = y1 * src_w + x1
            d = y * dst_w + x
            for c in range(3):
                top = planes[c, idx00] * (1 - xf) + planes[c, idx01] * xf
                bottom = planes[c, idx10] * (1 - xf) + planes[c, idx11] * xf
                out[c, d] = top * (1 - yf) + bottom * yf
    return out


def letterbox(planes: np.ndarray, src_w: int, src_h: int, size: int, pad) -> np.ndarray:
    scale = min(size / src_w, size / src_h)
    fit_w = max(1, round_half_up(src_w * scale))
    fit_h = max(1, round_half_up(src_h * scale))
    resized = bilinear_resize(planes, src_w, src_h, fit_w, fit_h)
    out = np.empty((3, size * size), dtype=np.float64)
    out[0, :] = pad[0]
    out[1, :] = pad[1]
    out[2, :] = pad[2]
    ox = round_half_up((size - fit_w) / 2)
    oy = round_half_up((size - fit_h) / 2)
    for c in range(3):
        for y in range(fit_h):
            src_row = y * fit_w
            dst_start = (oy + y) * size + ox
            out[c, dst_start : dst_start + fit_w] = resized[c, src_row : src_row + fit_w]
    return out


def shorter_side_center_crop(planes, src_w, src_h, shortest_edge, crop_size) -> np.ndarray:
    shortest = min(src_w, src_h)
    scale = shortest_edge / shortest
    resized_w = round_half_up(src_w * scale)
    resized_h = round_half_up(src_h * scale)
    resized = bilinear_resize(planes, src_w, src_h, resized_w, resized_h)
    ox = round_half_up((resized_w - crop_size) / 2)
    oy = round_half_up((resized_h - crop_size) / 2)
    out = np.empty((3, crop_size * crop_size), dtype=np.float64)
    for c in range(3):
        for y in range(crop_size):
            src_row = (oy + y) * resized_w + ox
            dst_start = y * crop_size
            out[c, dst_start : dst_start + crop_size] = resized[c, src_row : src_row + crop_size]
    return out


def pack_normalize(planes: np.ndarray, width: int, height: int, mean, std) -> np.ndarray:
    # explicit per-channel to keep identical semantics with the TS version
    tensor = np.empty((3, height, width), dtype=np.float32)
    for c in range(3):
        tensor[c] = (planes[c].reshape(height, width) / 255.0 - mean[c]) / std[c]
    return tensor


def preprocess(path: Path, spec: dict) -> np.ndarray:
    with Image.open(path) as im:
        rgba = np.array(im.convert("RGBA"), dtype=np.uint8)
    h, w = rgba.shape[0], rgba.shape[1]
    planes = matte_to_opaque_rgb(rgba)
    if spec["policy"] == "letterbox":
        planes = letterbox(planes, w, h, spec["size"], spec["pad"])
        tensor = pack_normalize(planes, spec["size"], spec["size"], spec["mean"], spec["std"])
    else:
        planes = shorter_side_center_crop(
            planes, w, h, spec["shortest_edge"], spec["crop_size"]
        )
        tensor = pack_normalize(
            planes, spec["crop_size"], spec["crop_size"], spec["mean"], spec["std"]
        )
    return tensor[None, ...]


def main() -> int:
    if not CORPUS.exists():
        print(f"corpus missing: {CORPUS} — run the corpus generator first", file=sys.stderr)
        return 1

    images = sorted(p for p in CORPUS.glob("*.png") if p.name != "manifest.json")
    if not images:
        print(f"no images in {CORPUS}", file=sys.stderr)
        return 1

    # Cap how many images get fixture vectors (the parity test re-runs the
    # TS pipeline for each; keep the committed fixture small).
    images = images[: int(os.environ.get("VARVE_REFERENCE_IMAGE_LIMIT", "24"))]

    for model_id, spec in MODELS.items():
        model_path = MODEL_CACHE / spec["file"]
        if not model_path.exists():
            print(f"model missing: {model_path}", file=sys.stderr)
            continue
        sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        outputs = {}
        for img in images:
            tensor = preprocess(img, spec)
            feed = {spec["input"]: tensor, **spec["constant_inputs"]}
            result = sess.run([spec["output"]], feed)[0]
            # DINOv2: CLS token at index 0. SigLIP: single pooled vector.
            vector = result[0, spec["cls_token_index"]] if spec.get("cls_token_index") is not None else result[0]
            norm = np.linalg.norm(vector)
            if norm > 0:
                vector = vector / norm
            outputs[img.stem] = {"base64": base64.b64encode(vector.astype("<f4").tobytes()).decode()}
            print(f"  {model_id}: {img.stem} dim={vector.shape[0]}")

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        fixture = {
            "modelId": model_id,
            "runtime": f"onnxruntime-python-{ort.__version__}",
            "images": outputs,
        }
        out_path = OUT_DIR / f"{model_id}.json"
        out_path.write_text(json.dumps(fixture, indent=1))
        print(f"wrote {out_path} ({len(outputs)} vectors)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
