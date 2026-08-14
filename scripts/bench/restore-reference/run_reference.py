#!/usr/bin/env python3
"""
Restore-reference harness: Varve-exact restoration pipelines through ONNX
Runtime with the exact preprocessing/postprocessing the TS runtime uses.

Pipelines mirrored here:
  - `nafnet-deblur`  : NAFNet-GoPro-width64 (BGR, pad to 16, fp16/fp32)
  - `scunet-denoise` : SCUNet color real PSNR (RGB, pad to 8, strength blend)

Each (fixture, pipeline) records: PSNR/SSIM vs ground truth, degradation
recipe, timing (session load excluded, inference only), and provider. A
JSONL summary is appended per run; the contact-sheet script turns the
outputs into visual comparison sheets.

Reproduction:
    python3 scripts/bench/restore-reference/run_reference.py \
        --models-dir /path/to/models \
        --fixtures-dir tests/fixtures/restore-corpus \
        --output-dir /tmp/restore-reference-out \
        --pipelines nafnet-deblur,scunet-denoise
"""

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from generate_fixtures import CORPUS_DIR, list_fixtures  # noqa: E402


def psnr(a, b):
    mse = ((a.astype(np.float64) - b.astype(np.float64)) ** 2).mean()
    return float(10 * np.log10(255.0**2 / max(mse, 1e-12)))


def ssim(a, b):
    from skimage.metrics import structural_similarity as _ssim
    return float(_ssim(a, b, channel_axis=2, data_range=255))


def scunet_denoise(onnx: str, img_bgr, strength: float, session=None):
    """Mirror of packages/engine/src/inference/models/scunet.ts +
    denoiseProviders: RGB planes, edge-clamp 8-pad, strength blend."""
    import onnxruntime as ort
    if session is None:
        session = ort.InferenceSession(onnx, providers=["CPUExecutionProvider"])
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    aw, ah = ((w + 7) // 8) * 8, ((h + 7) // 8) * 8
    x = np.zeros((3, ah, aw), np.float32)
    x[:, :h, :w] = rgb.transpose(2, 0, 1).astype(np.float32) / 255.0
    out = session.run(None, {"image": x[None]})[0][0, :, :h, :w]
    restored = (np.clip(out.transpose(1, 2, 0), 0, 1) * 255.0).round().astype(np.uint8)
    restored_bgr = cv2.cvtColor(restored, cv2.COLOR_RGB2BGR)
    blended = (
        img_bgr.astype(np.float32) * (1 - strength) + restored_bgr.astype(np.float32) * strength
    )
    return np.clip(blended, 0, 255).round().astype(np.uint8)


def nafnet_deblur(onnx: str, img_bgr, strength: float, session=None):
    """Mirror of packages/engine/src/inference/models/nafnet.ts: BGR
    planes, zero 16-pad, channel swap on output."""
    import onnxruntime as ort
    if session is None:
        session = ort.InferenceSession(onnx, providers=["CPUExecutionProvider"])
    h, w = img_bgr.shape[:2]
    x = img_bgr.transpose(2, 0, 1).astype(np.float32) / 255.0
    ph, pw = (16 - h % 16) % 16, (16 - w % 16) % 16
    if ph or pw:
        x = np.pad(x, ((0, 0), (0, ph), (0, pw)))
    out = session.run(None, {"input": x[None]})[0][0, :, :h, :w]
    restored = (np.clip(out.transpose(1, 2, 0), 0, 1) * 255.0).round().astype(np.uint8)
    blended = (
        img_bgr.astype(np.float32) * (1 - strength) + restored.astype(np.float32) * strength
    )
    return np.clip(blended, 0, 255).round().astype(np.uint8)


PIPELINES = {
    "nafnet-deblur": (nafnet_deblur, "nafnet-deblur-gopro-width64-fp16b-embed.onnx", 0.7),
    "scunet-denoise": (scunet_denoise, "scunet_color_real_psnr.onnx", 0.8),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models-dir", required=True, type=Path)
    ap.add_argument("--fixtures-dir", type=Path, default=CORPUS_DIR)
    ap.add_argument("--output-dir", required=True, type=Path)
    ap.add_argument("--pipelines", default="nafnet-deblur,scunet-denoise")
    args = ap.parse_args()

    import onnxruntime as ort

    sessions = {}
    pipelines = [p.strip() for p in args.pipelines.split(",") if p.strip()]
    for name in pipelines:
        fn, filename, strength = PIPELINES[name]
        path = args.models_dir / filename
        if not path.exists():
            raise SystemExit(f"model file not found: {path}")
        sessions[name] = (fn, ort.InferenceSession(str(path), providers=["CPUExecutionProvider"]), strength)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = args.output_dir / "summary.jsonl"

    for fixture in list_fixtures(args.fixtures_dir):
        gt = cv2.imread(str(fixture), cv2.IMREAD_COLOR)
        if gt is None:
            continue
        for recipe, degraded in generate_versions(fixture, gt):
            row = {
                "fixture": fixture.name,
                "recipe": recipe["name"],
                "recipeDetail": recipe,
                "degradedPsnr": round(psnr(degraded, gt), 2),
                "degradedSsim": round(ssim(degraded, gt), 4),
            }
            for name, (fn, session, strength) in sessions.items():
                t0 = time.perf_counter()
                out = fn(session, degraded, strength)
                elapsed = time.perf_counter() - t0
                out_path = args.output_dir / f"{fixture.stem}--{recipe['name']}--{name}.png"
                cv2.imwrite(str(out_path), out)
                row[name] = {
                    "psnr": round(psnr(out, gt), 2),
                    "ssim": round(ssim(out, gt), 4),
                    "inferenceMs": round(elapsed * 1000, 1),
                }
            with open(summary_path, "a") as f:
                f.write(json.dumps(row) + "\n")
            print(json.dumps(row), flush=True)


def generate_versions(fixture: Path, gt):
    """Deterministic degradation recipes; mirror of generate_fixtures.py."""
    from generate_fixtures import jpeg_deg, gaussian_noise, motion_blur
    import numpy as np

    recipes = [
        {"name": "jpeg-q60", "quality": 60},
        {"name": "jpeg-q30", "quality": 30},
        {"name": "jpeg-q20", "quality": 20},
        {"name": "gauss-sigma15", "sigma": 15, "seed": 3},
        {"name": "gauss-sigma35", "sigma": 35, "seed": 4},
        {"name": "motion-12px", "length": 12, "angle": 30, "seed": 5},
    ]
    out = []
    for r in recipes:
        if "quality" in r:
            degraded = jpeg_deg(gt, r["quality"])
        elif "sigma" in r:
            degraded = gaussian_noise(gt, r["sigma"], r["seed"])
        else:
            degraded = motion_blur(gt, r["length"], r["angle"], r["seed"])
        out.append((r, degraded))
    return out


if __name__ == "__main__":
    main()
