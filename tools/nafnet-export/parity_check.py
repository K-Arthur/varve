"""Parity check: compare the trusted PyTorch reference output against
ONNX Runtime output for the same inputs (my conversion and the OpenCV
artifact). Metrics: max abs diff, mean abs diff, PSNR, and the fraction of
pixels differing by more than 1/255 (the clamp+round boundary).

Also prints the ONNX input/output contract for the record.
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

sys.path.insert(0, "/tmp/opencode/nafnet-work")
from reference_infer import load_net, infer as ref_infer  # noqa: E402




def run_ort(model_path: str, img_bgr: np.ndarray, pad: int):
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
    ap.add_argument("--checkpoint", required=True, type=Path)
    ap.add_argument("--onnx", required=True, type=Path, nargs="+")
    ap.add_argument("--input", required=True, type=Path, nargs="+")
    ap.add_argument("--width", type=int, default=64)
    args = ap.parse_args()

    net = load_net(
        args.checkpoint,
        width=args.width,
        enc_blk_nums=[1, 1, 1, 28],
        middle_blk_num=1,
        dec_blk_nums=[1, 1, 1, 1],
    )

    for onnx in args.onnx:
        sess = ort.InferenceSession(str(onnx), providers=["CPUExecutionProvider"])
        print(f"== {onnx.name} contract ==")
        for i in sess.get_inputs():
            print(f"  input {i.name}: {i.shape} {i.type}")
        for o in sess.get_outputs():
            print(f"  output {o.name}: {o.shape} {o.type}")

    for path in args.input:
        print(f"--- {path.name} ---")
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        ref = ref_infer(net, img)
        for onnx in args.onnx:
            out = run_ort(str(onnx), img, pad=16)
            compare(ref, out, f"  torch vs {onnx.stem}")
        if len(args.onnx) == 2:
            compare(run_ort(str(args.onnx[0]), img, 16), run_ort(str(args.onnx[1]), img, 16),
                    "  mine vs opencv")


if __name__ == "__main__":
    main()
