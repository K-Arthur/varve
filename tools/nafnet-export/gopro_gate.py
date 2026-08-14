"""GoPro test gate: reproduces the published NAFNet-GoPro-width64 PSNR on a
subset of the official evaluation set (LMDB pairs) and compares the ONNX
conversions against the trusted PyTorch reference.

Gates:
1. torch reference PSNR vs ground truth (published anchor: 33.7103 dB on
   the full 1111-image set; a subset should land within ~±0.5 dB).
2. ONNX (fp32/fp16) PSNR vs ground truth.
3. torch vs ONNX output PSNR (conversion fidelity).

Usage:
    python gopro_gate.py --checkpoint NAFNet-GoPro-width64.pth \
        --lmdb-root GoPro/test \
        --onnx model1.onnx --onnx model2.onnx \
        --input-name input --limit 24
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import lmdb
import numpy as np

from reference_infer import load_net, infer as ref_infer  # noqa: E402

PADDING = 16


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = ((a.astype(np.float64) - b.astype(np.float64)) ** 2).mean()
    return float(10 * np.log10(255.0**2 / max(mse, 1e-12)))


_LMDB_ENVS: dict[tuple[str, str], object] = {}


def _lmdb(root: Path, name: str):
    key = (str(root), name)
    if key not in _LMDB_ENVS:
        _LMDB_ENVS[key] = lmdb.open(str(root / name), readonly=True, lock=False, readahead=False)
    return _LMDB_ENVS[key]


def read_pair(lmdb_root: Path, key: str):
    env_in = _lmdb(lmdb_root, "input.lmdb")
    env_gt = _lmdb(lmdb_root, "target.lmdb")
    with env_in.begin() as tx_in, env_gt.begin() as tx_gt:
        buf_in = tx_in.get(key.encode())
        buf_gt = tx_gt.get(key.encode())
    img = cv2.imdecode(np.frombuffer(buf_in, np.uint8), cv2.IMREAD_COLOR)
    gt = cv2.imdecode(np.frombuffer(buf_gt, np.uint8), cv2.IMREAD_COLOR)
    return img, gt


def run_ort(model_path: str, img: np.ndarray, input_name: str):
    import onnxruntime as ort
    h, w = img.shape[:2]
    x = img.transpose(2, 0, 1).astype(np.float32) / 255.0
    pad_h = (PADDING - h % PADDING) % PADDING
    pad_w = (PADDING - w % PADDING) % PADDING
    if pad_h or pad_w:
        x = np.pad(x, ((0, 0), (0, pad_h), (0, pad_w)))
    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    out = sess.run(None, {input_name: x[None]})[0][0, :, :h, :w]
    return (np.clip(out.transpose(1, 2, 0), 0, 1) * 255.0).round().astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, type=Path)
    ap.add_argument("--lmdb-root", required=True, type=Path)
    ap.add_argument("--onnx", type=Path, nargs="+")
    ap.add_argument("--input-name", default="input")
    ap.add_argument("--limit", type=int, default=24)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--output", type=Path, default=Path("/tmp/opencode/gopro-gate-results.jsonl"))
    args = ap.parse_args()

    with open(args.lmdb_root / "input.lmdb" / "meta_info.txt") as f:
        keys = [line.split()[0].split(".")[0] for line in f if line.strip()]
    rng = np.random.default_rng(args.seed)
    chosen = rng.choice(keys, size=min(args.limit, len(keys)), replace=False)
    print(f"gates on {len(chosen)} images (seed {args.seed})", flush=True)

    net = load_net(args.checkpoint, 64, [1, 1, 1, 28], 1, [1, 1, 1, 1])

    results: dict[str, dict] = {}
    for onnx in args.onnx or []:
        results[onnx.name] = {}

    for key in chosen:
        img, gt = read_pair(args.lmdb_root, key)
        ref = ref_infer(net, img)
        row: dict = {"ref_gt": psnr(ref, gt)}
        for onnx in args.onnx or []:
            try:
                out = run_ort(str(onnx), img, args.input_name)
                row[f"{onnx.name}_gt"] = psnr(out, gt)
                row[f"{onnx.name}_vs_ref"] = psnr(ref, out)
            except Exception as e:  # noqa: BLE001
                row[f"{onnx.name}_error"] = str(e)[:120]
                print(f"  {onnx.name} FAILED on {key}: {e}", flush=True)
        print(f"{key}: ref={row['ref_gt']:.2f}dB", flush=True)
        with open(args.output, "a") as f:
            f.write(json.dumps({"key": key, **row}) + "\n")

    print("=== summary ===", flush=True)
    for onnx in args.onnx or []:
        pass
    refs = []
    for onnx in args.onnx or []:
        gts, vsref = [], []
        with open(args.output) as f:
            for line in f:
                row = json.loads(line)
                refs.append(row["ref_gt"])
                if f"{onnx.name}_gt" in row:
                    gts.append(row[f"{onnx.name}_gt"])
                    vsref.append(row[f"{onnx.name}_vs_ref"])
        a = np.array(gts)
        print(
            f"torch ref vs GT: mean={np.array(refs).mean():.2f} "
            f"(anchor 33.71) n={len(refs)}",
            flush=True,
        )
        if gts:
            print(
                f"ORT {onnx.name} vs GT: mean={a.mean():.2f} min={a.min():.2f} max={a.max():.2f}",
                flush=True,
            )
            print(
                f"torch vs ORT {onnx.name}: mean={np.array(vsref).mean():.2f} "
                f"min={np.array(vsref).min():.2f}",
                flush=True,
            )


if __name__ == "__main__":
    main()
