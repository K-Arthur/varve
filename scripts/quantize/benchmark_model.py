#!/usr/bin/env python3
"""
Performance benchmark: FP32 vs INT8 quantized ONNX models.

Measures cold-start, warm-start, and steady-state latency under identical
conditions. Uses realistic image-like inputs (not noise) so the model
actually exercises its compute path.

Usage:
    python3 benchmark_model.py --model u2netp
    python3 benchmark_model.py --all
    python3 benchmark_model.py --model u2netp --input-size 320 --iterations 50
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

try:
    import onnxruntime as ort
except ImportError:
    print("ERROR: onnxruntime not installed", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MODELS_DIR = REPO_ROOT / "apps" / "desktop" / "public" / "models"
QUANTIZED_DIR = MODELS_DIR / "quantized"


@dataclass
class BenchmarkResult:
    """Result for a single model/precision."""

    model_id: str
    precision: str
    model_path: str
    model_size_bytes: int
    input_size: int
    iterations: int
    cold_start_ms: float = 0.0
    warm_start_ms: float = 0.0
    steady_state_p50_ms: float = 0.0
    steady_state_p95_ms: float = 0.0
    steady_state_p99_ms: float = 0.0
    steady_state_mean_ms: float = 0.0
    steady_state_stdev_ms: float = 0.0
    steady_state_min_ms: float = 0.0
    steady_state_max_ms: float = 0.0
    throughput_fps: float = 0.0
    session_creation_ms: float = 0.0


@dataclass
class BenchmarkReport:
    """Full benchmark report."""

    model_id: str
    input_size: int
    iterations: int
    ort_version: str
    providers: list[str]
    results: list[dict] = field(default_factory=list)
    speedup_mean: float = 1.0
    speedup_p50: float = 1.0
    winner: str = "tie"
    generation_timestamp: str = ""

    def __post_init__(self):
        if not self.generation_timestamp:
            self.generation_timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Input generation
# ---------------------------------------------------------------------------


def generate_realistic_input(model_id: str, size: int) -> np.ndarray:
    """
    Generate a realistic image-like input that exercises the model's
    compute path. Uses structured content (gradients, shapes, texture)
    rather than uniform noise.
    """
    rng = np.random.default_rng(12345)

    if model_id in ("u2netp", "u2netp-int8"):
        # U2-Net: 320x320, ImageNet-normalized. Create a portrait-like scene.
        img = np.zeros((1, 3, size, size), dtype=np.float32)
        # Background: smooth gradient
        x = np.linspace(0, 1, size)
        y = np.linspace(0, 1, size)
        xx, yy = np.meshgrid(x, y)
        img[0, 0] = 0.3 + 0.2 * xx + 0.1 * yy
        img[0, 1] = 0.25 + 0.15 * xx + 0.1 * yy
        img[0, 2] = 0.35 + 0.1 * xx + 0.05 * yy
        # Foreground subject: central ellipse with texture
        cy, cx = size // 2, size // 2
        Y, X = np.ogrid[-cy:size - cy, -cx:size - cx]
        mask = (X ** 2 / (size // 3) ** 2 + Y ** 2 / (size // 2.5) ** 2) < 1
        # Subject: warm skin-like tone with some texture
        noise = rng.uniform(-0.05, 0.05, (size, size)).astype(np.float32)
        img[0, 0][mask] = 0.82 + noise[mask]
        img[0, 1][mask] = 0.65 + noise[mask]
        img[0, 2][mask] = 0.55 + noise[mask]
        # Add some fine detail (hair-like texture at edges)
        edge_mask = (
            (X ** 2 / (size // 2.8) ** 2 + Y ** 2 / (size // 2.3) ** 2) < 1
        ) & ~mask
        img[0, 0][edge_mask] = 0.45 + rng.uniform(-0.1, 0.1, edge_mask.sum()).astype(np.float32)
        img[0, 1][edge_mask] = 0.40 + rng.uniform(-0.1, 0.1, edge_mask.sum()).astype(np.float32)
        img[0, 2][edge_mask] = 0.35 + rng.uniform(-0.1, 0.1, edge_mask.sum()).astype(np.float32)
        # ImageNet normalization
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        for c in range(3):
            img[0, c] = (img[0, c] - mean[c]) / std[c]
        return img

    if model_id in ("realesr-general-x4v3",):
        # Real-ESRGAN: variable input, normalize to [0, 1]
        small_size = size
        img = rng.uniform(0.1, 0.9, (1, 3, small_size, small_size)).astype(np.float32)
        # Add some structure
        for c in range(3):
            img[0, c] += 0.1 * np.sin(np.linspace(0, 4 * np.pi, small_size))[None, :]
        return np.clip(img, 0, 1).astype(np.float32)

    # Default: structured random
    img = rng.uniform(0.1, 0.9, (1, 3, size, size)).astype(np.float32)
    return img


# ---------------------------------------------------------------------------
# Benchmark
# ---------------------------------------------------------------------------


def benchmark_model(
    model_path: Path,
    model_id: str,
    precision: str,
    input_size: int,
    iterations: int,
) -> BenchmarkResult:
    """Run a full benchmark for one model."""
    result = BenchmarkResult(
        model_id=model_id,
        precision=precision,
        model_path=str(model_path.relative_to(REPO_ROOT)),
        model_size_bytes=model_path.stat().st_size,
        input_size=input_size,
        iterations=iterations,
    )

    input_tensor = generate_realistic_input(model_id, input_size)
    sess_opts = ort.SessionOptions()
    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_opts.intra_op_num_threads = 2

    # --- Cold start: session creation + first inference ---
    cold_start = time.monotonic()
    session = ort.InferenceSession(
        str(model_path), sess_opts, providers=["CPUExecutionProvider"]
    )
    input_name = session.get_inputs()[0].name
    first_output = session.run(None, {input_name: input_tensor})
    cold_end = time.monotonic()
    result.cold_start_ms = (cold_end - cold_start) * 1000

    # --- Warm start: second inference (session exists) ---
    warm_start = time.monotonic()
    session.run(None, {input_name: input_tensor})
    warm_end = time.monotonic()
    result.warm_start_ms = (warm_end - warm_start) * 1000

    # --- Steady state: N iterations ---
    latencies = []
    for _ in range(iterations):
        t0 = time.monotonic()
        session.run(None, {input_name: input_tensor})
        t1 = time.monotonic()
        latencies.append((t1 - t0) * 1000)

    result.steady_state_p50_ms = statistics.median(latencies)
    result.steady_state_p95_ms = float(np.percentile(latencies, 95))
    result.steady_state_p99_ms = float(np.percentile(latencies, 99))
    result.steady_state_mean_ms = statistics.mean(latencies)
    result.steady_state_stdev_ms = statistics.stdev(latencies) if len(latencies) > 1 else 0
    result.steady_state_min_ms = min(latencies)
    result.steady_state_max_ms = max(latencies)
    result.throughput_fps = 1000.0 / max(result.steady_state_mean_ms, 0.001)

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def run_benchmark(
    model_id: str,
    input_size: int = 320,
    iterations: int = 50,
) -> BenchmarkReport:
    """Benchmark FP32 vs INT8 for a model."""
    fp32_path = MODELS_DIR / f"{model_id}.onnx"
    int8_path = QUANTIZED_DIR / f"{model_id}-int8.onnx"

    if not fp32_path.exists():
        raise FileNotFoundError(f"FP32 model not found: {fp32_path}")

    report = BenchmarkReport(
        model_id=model_id,
        input_size=input_size,
        iterations=iterations,
        ort_version=ort.__version__,
        providers=ort.get_available_providers(),
    )

    print(f"\nBenchmarking FP32: {fp32_path.name}")
    fp32_result = benchmark_model(fp32_path, model_id, "fp32", input_size, iterations)
    report.results.append(asdict(fp32_result))
    print(f"  Cold start: {fp32_result.cold_start_ms:.1f} ms")
    print(f"  Warm start: {fp32_result.warm_start_ms:.1f} ms")
    print(f"  Steady p50: {fp32_result.steady_state_p50_ms:.1f} ms")
    print(f"  Steady p95: {fp32_result.steady_state_p95_ms:.1f} ms")
    print(f"  Steady mean: {fp32_result.steady_state_mean_ms:.1f} ms")
    print(f"  Throughput: {fp32_result.throughput_fps:.1f} FPS")

    if int8_path.exists():
        print(f"\nBenchmarking INT8: {int8_path.name}")
        int8_result = benchmark_model(int8_path, f"{model_id}-int8", "int8", input_size, iterations)
        report.results.append(asdict(int8_result))
        print(f"  Cold start: {int8_result.cold_start_ms:.1f} ms")
        print(f"  Warm start: {int8_result.warm_start_ms:.1f} ms")
        print(f"  Steady p50: {int8_result.steady_state_p50_ms:.1f} ms")
        print(f"  Steady p95: {int8_result.steady_state_p95_ms:.1f} ms")
        print(f"  Steady mean: {int8_result.steady_state_mean_ms:.1f} ms")
        print(f"  Throughput: {int8_result.throughput_fps:.1f} FPS")

        # Compute speedup
        report.speedup_mean = fp32_result.steady_state_mean_ms / max(int8_result.steady_state_mean_ms, 0.001)
        report.speedup_p50 = fp32_result.steady_state_p50_ms / max(int8_result.steady_state_p50_ms, 0.001)
        report.winner = "int8" if report.speedup_mean > 1.05 else ("fp32" if report.speedup_mean < 0.95 else "tie")

        print(f"\n  Speedup (mean): {report.speedup_mean:.2f}x")
        print(f"  Speedup (p50): {report.speedup_p50:.2f}x")
        print(f"  Winner: {report.winner}")
    else:
        print(f"\n  INT8 model not found at {int8_path} — skipping")

    # Write report
    report_path = QUANTIZED_DIR / f"{model_id}-benchmark.json"
    report_path.write_text(json.dumps(asdict(report), indent=2))
    print(f"\n  Report: {report_path.relative_to(REPO_ROOT)}")

    return report


def main():
    parser = argparse.ArgumentParser(description="Benchmark FP32 vs INT8 ONNX models")
    parser.add_argument("--model", help="Model ID (e.g. u2netp)")
    parser.add_argument("--all", action="store_true", help="Benchmark all models")
    parser.add_argument("--input-size", type=int, default=320, help="Input size (default: 320)")
    parser.add_argument("--iterations", type=int, default=50, help="Steady-state iterations (default: 50)")

    args = parser.parse_args()
    if not args.model and not args.all:
        parser.error("Specify --model <id> or --all")

    models = ["u2netp", "realesr-general-x4v3"] if args.all else [args.model]

    for model_id in models:
        # Real-ESRGAN uses smaller input (64x64) since it's an upscaler
        input_size = 64 if "realesr" in model_id else args.input_size
        run_benchmark(model_id, input_size=input_size, iterations=args.iterations)


if __name__ == "__main__":
    main()
