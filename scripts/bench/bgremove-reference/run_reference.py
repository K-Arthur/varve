#!/usr/bin/env python3
"""
BiRefNet / segmentation reference inference harness.

Implements the rembg-faithful reference pipeline (stretch resize, model
normalisation, sigmoid where the graph does not bake it, bilinear restore,
clamp) for the exact checkpoints pinned in
apps/desktop/public/models/manifest.json, plus an exact mirror of Varve's
letterbox + min-max pipeline so divergence can be decomposed:

  - `rembg`       : what the model's reference tooling produces
  - `varve`       : letterbox input, min-max output normalisation (current code)
  - `varve-clamp` : letterbox input, clamp output (candidate postprocessing)

Outputs per (image, model, mode): a mask PNG at source resolution. RGBA
fixtures with a non-trivial alpha channel get their alpha extracted as a
ground-truth matte (`<stem>-ground-truth.png`). A machine-readable summary
(merged across runs, never overwritten wholesale) records every artifact.

Reproduction:
    python3 scripts/bench/bgremove-reference/run_reference.py \
        --models-dir /tmp/models \
        --images-dir tests/fixtures/bg-removal-corpus \
        --output-dir /tmp/reference-out \
        --models u2netp,isnet-general-use,birefnet-general-lite,birefnet-general
"""

import argparse
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

MODEL_SPECS = {
    "u2netp": {
        "input_size": 320,
        "mean": (0.485, 0.456, 0.406),
        "std": (0.229, 0.224, 0.225),
        "apply_sigmoid": False,
        "padding": (124, 116, 104),
    },
    "isnet-general-use": {
        "input_size": 1024,
        "mean": (0.5, 0.5, 0.5),
        "std": (1.0, 1.0, 1.0),
        "apply_sigmoid": False,
        "padding": (128, 128, 128),
    },
    "birefnet-general-lite": {
        "input_size": 1024,
        "mean": (0.485, 0.456, 0.406),
        "std": (0.229, 0.224, 0.225),
        "apply_sigmoid": True,
        "padding": (124, 116, 104),
    },
    "birefnet-general": {
        "input_size": 1024,
        "mean": (0.485, 0.456, 0.406),
        "std": (0.229, 0.224, 0.225),
        "apply_sigmoid": True,
        "padding": (124, 116, 104),
    },
}

# rembg asset file names (exact pins from the manifest)
MODEL_FILES = {
    "u2netp": "u2netp.onnx",
    "isnet-general-use": "isnet-general-use.onnx",
    "birefnet-general-lite": "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
    "birefnet-general": "BiRefNet-general-epoch_244.onnx",
}


def load_rgba(path: Path) -> np.ndarray:
    """RGBA uint8 HWC, EXIF orientation applied by PIL."""
    with Image.open(path) as im:
        return np.array(im.convert("RGBA"))


def preprocess_rembg(img_rgb: np.ndarray, spec) -> np.ndarray:
    """rembg-faithful: PIL BILINEAR stretch to (S, S), then /255 - mean / std."""
    s = spec["input_size"]
    im = Image.fromarray(img_rgb).resize((s, s), Image.BILINEAR)
    arr = np.array(im, dtype=np.float32) / 255.0
    arr -= np.array(spec["mean"], dtype=np.float32)
    arr /= np.array(spec["std"], dtype=np.float32)
    return np.transpose(arr, (2, 0, 1))[None, ...]


def preprocess_letterbox(img_rgb: np.ndarray, spec) -> tuple[np.ndarray, tuple]:
    """Varve-faithful: aspect-preserving letterbox into (S, S) with mean-colour pad.

    The content resize deliberately uses an antialiased filter (PIL LANCZOS):
    the Rust `image` crate's Triangle filter antialiases on downscale, while a
    plain bilinear sample (cv2 INTER_LINEAR) aliases thin structure away. The
    two must match at the noise floor, or sub-pixel lines flip model output.
    """
    s = spec["input_size"]
    h, w = img_rgb.shape[:2]
    scale = min(s / w, s / h)
    cw, ch = max(1, round(w * scale)), max(1, round(h * scale))
    ox, oy = (s - cw) // 2, (s - ch) // 2
    pad = np.array(spec["padding"], dtype=np.uint8)
    canvas = np.full((s, s, 3), pad, dtype=np.uint8)
    content = np.asarray(Image.fromarray(img_rgb).resize((cw, ch), Image.LANCZOS))
    canvas[oy : oy + ch, ox : ox + cw] = content
    arr = canvas.astype(np.float32) / 255.0
    arr -= np.array(spec["mean"], dtype=np.float32)
    arr /= np.array(spec["std"], dtype=np.float32)
    return np.transpose(arr, (2, 0, 1))[None, ...], (ox, oy, cw, ch, scale)


def postprocess_rembg(logits: np.ndarray, spec, dst_size: tuple) -> np.ndarray:
    """rembg-faithful: optional sigmoid, clip, cv2 bilinear to source size."""
    pred = logits[0, 0]
    if spec["apply_sigmoid"]:
        pred = 1.0 / (1.0 + np.exp(-pred))
    pred = np.clip(pred, 0.0, 1.0)
    w, h = dst_size
    return cv2.resize(pred, (w, h), interpolation=cv2.INTER_LINEAR)


def mask_from_letterbox(
    logits: np.ndarray, spec, box: tuple, dst_size: tuple, minmax: bool
) -> np.ndarray:
    """Varve-faithful output: crop content region from the model map, then
    bilinear to source size. `minmax=True` mirrors normalize_segmentation_output."""
    pred = logits[0, 0]
    if spec["apply_sigmoid"]:
        pred = 1.0 / (1.0 + np.exp(-pred))
    ox, oy, cw, ch, _ = box
    if minmax:
        lo, hi = float(pred.min()), float(pred.max())
        if hi - lo > 1e-7:
            pred = (pred - lo) / (hi - lo)
    crop = pred[oy : oy + ch, ox : ox + cw]
    w, h = dst_size
    out = cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)
    if minmax:
        out = np.clip(out, 0.0, 1.0)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Reference segmentation inference")
    parser.add_argument("--models-dir", required=True, type=Path)
    parser.add_argument("--images-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--models",
        default="u2netp,isnet-general-use,birefnet-general-lite",
        help="comma-separated model ids",
    )
    parser.add_argument(
        "--modes",
        default="rembg,varve,varve-clamp",
        help="comma-separated pipeline modes",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-run images already present in the summary (pipeline changed)",
    )
    args = parser.parse_args()

    import onnxruntime as ort

    for model_id in args.models.split(","):
        if model_id not in MODEL_SPECS:
            print(f"unknown model {model_id}", file=sys.stderr)
            return 2
        path = args.models_dir / MODEL_FILES[model_id]
        if not path.exists():
            print(f"model file missing: {path}", file=sys.stderr)
            return 2

    images = (
        sorted(args.images_dir.glob("*.jpg"))
        + sorted(args.images_dir.glob("*.jpeg"))
        + sorted(args.images_dir.glob("*.png"))
    )
    if not images:
        print(f"no images in {args.images_dir}", file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = args.output_dir / "reference-summary.json"
    if summary_path.exists():
        try:
            summary = json.loads(summary_path.read_text())
        except Exception:
            summary = {}
    else:
        summary = {}
    summary.setdefault("schemaVersion", 2)
    summary.setdefault("modes", args.modes.split(","))
    summary.setdefault("preprocessing", "rembg stretch and Varve letterbox, both PIL bilinear")
    summary.setdefault("models", MODEL_FILES)
    results = summary.setdefault("results", [])
    if args.force:
        keep: list[dict] = []
        for entry in results:
            if (entry.get("image"), entry.get("model")) in {
                (r["image"], r["model"]) for r in keep
            }:
                continue
            if (entry["image"], entry["model"]) in set(
                (im.name, model_id)
                for model_id in args.models.split(",")
                for im in images
            ):
                continue
            keep.append(entry)
        results.clear()
        results.extend(keep)
    seen = {(r["image"], r["model"]) for r in results}

    for model_id in args.models.split(","):
        spec = MODEL_SPECS[model_id]
        path = args.models_dir / MODEL_FILES[model_id]
        # Bounded thread pool and arena policy: large FP32 models are
        # memory-hungry; disabling the CPU arena avoids pre-growing a huge
        # reservation that can trip heuristic overcommit on shared machines.
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 4) // 2))
        opts.enable_cpu_mem_arena = False
        opts.enable_mem_pattern = False
        sess = ort.InferenceSession(
            str(path), sess_options=opts, providers=["CPUExecutionProvider"]
        )
        input_name = sess.get_inputs()[0].name
        for image_path in images:
            key = (image_path.name, model_id)
            if key in seen and not args.force:
                print(f"skip {model_id} {image_path.name} (already in summary)")
                continue
                continue
            rgba = load_rgba(image_path)
            img_rgb = rgba[:, :, :3]
            source_alpha = rgba[:, :, 3]
            h, w = img_rgb.shape[:2]
            print(f"[{model_id}] {image_path.name} {w}x{h}", flush=True)
            entry = {
                "image": image_path.name,
                "model": model_id,
                "maskW": w,
                "maskH": h,
            }
            has_alpha_target = image_path.suffix.lower() == ".png" and not np.all(
                source_alpha == 255
            )
            if has_alpha_target:
                target_path = args.output_dir / f"{image_path.stem}-ground-truth.png"
                Image.fromarray(source_alpha, mode="L").save(target_path)
                entry["groundTruthMask"] = str(target_path)
                entry["groundTruthClass"] = "alpha"
            for mode in args.modes.split(","):
                if mode == "rembg":
                    feed = preprocess_rembg(img_rgb, spec)
                    box = None
                elif mode in ("varve", "varve-clamp"):
                    feed, box = preprocess_letterbox(img_rgb, spec)
                else:
                    print(f"unknown mode {mode}", file=sys.stderr)
                    return 2
                logits = sess.run(None, {input_name: feed})[0]
                if mode == "rembg":
                    mask = postprocess_rembg(logits, spec, (w, h))
                else:
                    mask = mask_from_letterbox(logits, spec, box, (w, h), minmax=(mode == "varve"))
                mask_u8 = (mask * 255.0).round().clip(0, 255).astype(np.uint8)
                out_path = args.output_dir / f"{image_path.stem}-{model_id}-{mode}.png"
                Image.fromarray(mask_u8, mode="L").save(out_path)
                entry[f"{mode}_mask"] = str(out_path)
                entry[f"{mode}_fgRatio"] = round(float((mask > 0.5).mean()), 4)
                entry[f"{mode}_softRatio"] = round(
                    float(((mask > 0.03) & (mask < 0.97)).mean()), 4
                )
            results.append(entry)
            # Incremental write: a killed run (e.g. OOM on a shared machine)
            # must not discard completed entries.
            summary_path.write_text(json.dumps(summary, indent=2))

    summary_path.write_text(json.dumps(summary, indent=2))
    print(f"wrote {summary_path} ({len(results)} entries)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
