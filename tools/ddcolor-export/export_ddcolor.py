#!/usr/bin/env python
"""Reproducible DDColor -> ONNX export with self-verification.

Pin a checkout of piddnad/DDColor at the revision recorded in this
directory's README, then run this script. Matches the official
scripts/export_onnx.py model construction and export settings; adds a hard
verification step:

  1. ONNX checker + shape inference
  2. ONNX Runtime CPU smoke inference
  3. Numerical parity against the PyTorch model (max abs diff, MAE)
  4. SHA-256 and byte size of the resulting artifact

Usage:
  python export_ddcolor.py --model_size tiny --input_size 256 \
      --checkpoint .../ddcolor_paper_tiny.bin \
      --ddcolor_repo /path/to/DDColor \
      --output .../ddcolor-tiny.onnx
"""

import argparse
import hashlib
import json
import os
import sys
import time

import numpy as np
import torch


def build_model(model_size: str, input_size: int, repo_root: str):
    sys.path.insert(0, repo_root)
    from basicsr.archs.ddcolor_arch import DDColor

    encoder_name = "convnext-t" if model_size == "tiny" else "convnext-l"
    return DDColor(
        encoder_name=encoder_name,
        decoder_name="MultiScaleColorDecoder",
        input_size=[input_size, input_size],
        num_output_channels=2,
        last_norm="Spectral",
        do_normalize=False,
        num_queries=100,
        num_scales=3,
        dec_layers=9,
    )


def load_state_dict(path: str):
    state = torch.load(path, map_location="cpu", weights_only=True)
    if isinstance(state, dict) and "params" in state and isinstance(state["params"], dict):
        return state["params"]
    return state


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_size", choices=["tiny", "large"], required=True)
    parser.add_argument("--input_size", type=int, required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--ddcolor_repo",
        required=True,
        help="Path to a checkout of piddnad/DDColor at the pinned commit.",
    )
    args = parser.parse_args()

    started = time.time()
    model = build_model(args.model_size, args.input_size, args.ddcolor_repo)
    state = load_state_dict(args.checkpoint)
    missing, unexpected = model.load_state_dict(state, strict=False)
    model.eval()
    parameter_count = sum(p.numel() for p in model.parameters())

    dummy = torch.rand(1, 3, args.input_size, args.input_size, dtype=torch.float32)
    with torch.no_grad():
        torch_output = model(dummy).numpy()

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    torch.onnx.export(
        model,
        dummy,
        args.output,
        opset_version=12,
        input_names=["input"],
        output_names=["output"],
    )

    import onnx

    graph = onnx.load(args.output)
    onnx.checker.check_model(graph)
    onnx.save(onnx.shape_inference.infer_shapes(graph), args.output)

    import onnxruntime as ort

    session = ort.InferenceSession(args.output, providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(20260913)
    sample = rng.random((1, 3, args.input_size, args.input_size), dtype=np.float32)
    ort_output = session.run(["output"], {"input": sample})[0]
    with torch.no_grad():
        torch_sample = model(torch.from_numpy(sample)).numpy()
    difference = np.abs(ort_output - torch_sample)

    summary = {
        "modelSize": args.model_size,
        "inputSize": args.input_size,
        "onnxPath": args.output,
        "onnxBytes": os.path.getsize(args.output),
        "onnxSha256": sha256_file(args.output),
        "checkpointSha256": sha256_file(args.checkpoint),
        "parameterCount": int(parameter_count),
        "missingKeys": len(missing),
        "unexpectedKeys": len(unexpected),
        "missingSample": list(missing)[:10],
        "unexpectedSample": list(unexpected)[:10],
        "torchOutputShape": list(torch_output.shape),
        "ortOutputShape": list(ort_output.shape),
        "parityMaxAbsDiff": float(difference.max()),
        "parityMeanAbsDiff": float(difference.mean()),
        "elapsedSeconds": round(time.time() - started, 1),
    }
    print(json.dumps(summary, indent=2))
    with open(f"{args.output}.export.json", "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)


if __name__ == "__main__":
    main()
