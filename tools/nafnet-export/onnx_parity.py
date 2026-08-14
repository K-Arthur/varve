"""Compare an ONNX model's output against cached trusted-reference PNGs
(produced by reference_infer.py). Lean: no torch in this process."""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort



def run_ort(model_path: str, img_bgr: np.ndarray, pad: int):
    h, w = img_bgr.shape[:2]
    x = img_bgr.transpose(2, 0, 1).astype(np.float32) / 255.0
    pad_h = (pad - h % pad) % pad
    pad_w = (pad - w % pad) % pad
    if pad_h or pad_w:
        x = np.pad(x, ((0, 0), (0, pad_h), (0, pad_w)))
    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    out = sess.run(None, {"lq": x[None]})[0][0, :, :h, :w]
    return (np.clip(out.transpose(1, 2, 0), 0, 1) * 255.0).round().astype(np.uint8)


def run_ort_fp32(model_path: str, img_bgr: np.ndarray, pad: int):
    h, w = img_bgr.shape[:2]
    x = img_bgr.transpose(2, 0, 1).astype(np.float32) / 255.0
    pad_h = (pad - h % pad) % pad
    pad_w = (pad - w % pad) % pad
    if pad_h or pad_w:
        x = np.pad(x, ((0, 0), (0, pad_h), (0, pad_w)))
    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    out = sess.run(None, {"input": x[None]})[0][0, :, :h, :w]
    return (np.clip(out.transpose(1, 2, 0), 0, 1) * 255.0).round().astype(np.uint8)


def compare(a: np.ndarray, b: np.ndarray, label: str):
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    diff = np.abs(a - b)
    mse = (diff**2).mean()
    psnr = 10 * np.log10(255.0**2 / max(mse, 1e-12))
    over = (diff > 1.0).mean() * 100
    print(
        f"{label}: max={diff.max():.3f} mean={diff.mean():.4f} "
        f"psnr={psnr:.2f}dB >1/255 pixels={over:.4f}%"
    )
    return psnr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True, type=Path)
    ap.add_argument("--input-name", default="lq")
    ap.add_argument("--ref-dir", required=True, type=Path)
    ap.add_argument("--input", required=True, type=Path, nargs="+")
    args = ap.parse_args()

    for path in args.input:
        ref = cv2.imread(str(args.ref_dir / f"{path.stem}_ref.png"), cv2.IMREAD_COLOR)
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if args.input_name == "lq":
            out = run_ort(str(args.onnx), img, 16)
        else:
            out = run_ort_fp32(str(args.onnx), img, 16)
        compare(ref, out, f"{path.name}: torch-ref vs {args.onnx.stem}")
        cv2.imwrite(str(args.ref_dir / f"{path.stem}_{args.onnx.stem}.png"), out)


if __name__ == "__main__":
    main()
