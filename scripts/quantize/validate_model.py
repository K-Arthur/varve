#!/usr/bin/env python3
"""
Quality validation for quantized ONNX models.

Runs inference on both FP32 and INT8 versions of a model with representative
inputs, then computes task-specific quality metrics. Rejects quantized
candidates that exceed acceptance thresholds.

Usage:
    python3 validate_model.py --model u2netp --input test-inputs/portrait.png
    python3 validate_model.py --model u2netp --synthetic
    python3 validate_model.py --all --synthetic
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

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
class QualityThresholds:
    """Acceptance thresholds for quantized model quality.

    Primary gates are MAE and PSNR on the raw model output (before any
    post-processing). IoU on binarized masks is informative but not a hard
    gate — near-zero outputs on non-semantic inputs produce degenerate IoU
    that doesn't reflect real-world quality.
    """

    max_mae: float = 0.05
    min_psnr_db: float = 25.0
    max_correlation_loss: float = 0.02
    max_nan_fraction: float = 0.0
    max_output_range_violation: float = 0.01
    min_nonzero_fraction_match: float = 0.95


MODEL_THRESHOLDS: dict[str, QualityThresholds] = {
    "u2netp": QualityThresholds(
        max_mae=0.05,
        min_psnr_db=25.0,
        max_correlation_loss=0.03,
    ),
    "realesr-general-x4v3": QualityThresholds(
        max_mae=0.08,
        min_psnr_db=22.0,
        max_correlation_loss=0.05,
    ),
}


@dataclass
class QualityMetrics:
    """Computed quality metrics for a single input."""

    input_name: str
    iou: float = 0.0
    mae: float = 0.0
    psnr_db: float = 0.0
    pearson_r: float = 0.0
    correlation_loss: float = 0.0
    nan_fraction: float = 0.0
    inf_fraction: float = 0.0
    output_range_violation: float = 0.0
    fp32_output_mean: float = 0.0
    int8_output_mean: float = 0.0
    fp32_latency_ms: float = 0.0
    int8_latency_ms: float = 0.0
    speedup: float = 1.0
    passed: bool = True
    failure_reasons: list[str] = field(default_factory=list)


@dataclass
class ValidationReport:
    """Full validation report for a model."""

    model_id: str
    fp32_model_path: str
    int8_model_path: str
    ort_version: str
    thresholds: dict
    metrics: list[dict] = field(default_factory=list)
    overall_passed: bool = True
    mean_mae: float = 0.0
    mean_psnr_db: float = 0.0
    mean_speedup: float = 1.0
    generation_timestamp: str = ""

    def __post_init__(self):
        if not self.generation_timestamp:
            self.generation_timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


def compute_iou(fp32_output: np.ndarray, int8_output: np.ndarray) -> float:
    """Intersection over Union for binary segmentation masks."""
    fp32_mask = fp32_output > 0.5
    int8_mask = int8_output > 0.5
    intersection = np.logical_and(fp32_mask, int8_mask).sum()
    union = np.logical_or(fp32_mask, int8_mask).sum()
    return float(intersection / max(union, 1))


def compute_mae(fp32_output: np.ndarray, int8_output: np.ndarray) -> float:
    """Mean Absolute Error normalized to [0, 1]."""
    return float(np.mean(np.abs(fp32_output - int8_output)))


def compute_psnr(fp32_output: np.ndarray, int8_output: np.ndarray) -> float:
    """Peak Signal-to-Noise Ratio in dB."""
    mse = np.mean((fp32_output - int8_output) ** 2)
    if mse == 0:
        return 100.0
    max_val = max(fp32_output.max(), int8_output.max(), 1.0)
    return float(10 * np.log10(max_val**2 / mse))


def compute_dice(fp32_output: np.ndarray, int8_output: np.ndarray) -> float:
    """Dice/F1 coefficient for binary masks."""
    fp32_mask = fp32_output > 0.5
    int8_mask = int8_output > 0.5
    intersection = np.logical_and(fp32_mask, int8_mask).sum()
    return float(2 * intersection / max(fp32_mask.sum() + int8_mask.sum(), 1))


def compute_pearson_r(fp32_output: np.ndarray, int8_output: np.ndarray) -> float:
    """Pearson correlation coefficient between FP32 and INT8 outputs."""
    fp = fp32_output.flatten()
    i8 = int8_output.flatten()
    if fp.std() < 1e-10:
        return 1.0 if i8.std() < 1e-10 else 0.0
    return float(np.corrcoef(fp, i8)[0, 1])


def check_output_health(output: np.ndarray) -> dict:
    """Check for NaN, Inf, and range violations."""
    total = max(output.size, 1)
    return {
        "nan_fraction": float(np.isnan(output).sum() / total),
        "inf_fraction": float(np.isinf(output).sum() / total),
        "output_range_violation": float(
            ((output < -0.01) | (output > 1.01)).sum() / total
        ),
    }


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------


def create_synthetic_input(
    model_id: str, size: int = 320
) -> tuple[np.ndarray, str]:
    """Generate a synthetic test input for a model."""
    rng = np.random.default_rng(42)

    if model_id == "u2netp":
        # Synthetic "portrait-like" input: central ellipse on gradient background
        img = np.zeros((1, 3, size, size), dtype=np.float32)
        # Background gradient
        for c in range(3):
            img[0, c] = np.linspace(0.2, 0.8, size)[None, :] * np.linspace(0.3, 0.9, size)[:, None]
        # Central "subject" (bright ellipse)
        y, x = np.ogrid[-size // 2 : size // 2, -size // 2 : size // 2]
        mask = (x**2 / (size // 3) ** 2 + y**2 / (size // 2.5) ** 2) < 1
        img[0, 0][mask] = 0.9
        img[0, 1][mask] = 0.7
        img[0, 2][mask] = 0.6
        return img, "synthetic_portrait"

    if model_id == "realesr-general-x4v3":
        # Real-ESRGAN: small input (e.g. 64x64) upscaled 4x
        small_size = 64
        img = rng.uniform(0.1, 0.9, (1, 3, small_size, small_size)).astype(np.float32)
        return img, "synthetic_upscale"

    # Default: random
    img = rng.uniform(0, 1, (1, 3, size, size)).astype(np.float32)
    return img, "synthetic_random"


def load_image_input(path: Path, model_id: str) -> tuple[np.ndarray, str]:
    """Load and preprocess an image file for model input."""
    from PIL import Image

    img = Image.open(path).convert("RGB")

    if model_id == "u2netp":
        img = img.resize((320, 320), Image.BILINEAR)
        arr = np.array(img).astype(np.float32) / 255.0
        # ImageNet normalization
        mean = np.array([0.485, 0.456, 0.406])
        std = np.array([0.229, 0.224, 0.225])
        arr = (arr - mean) / std
        # HWC -> NCHW
        arr = arr.transpose(2, 0, 1)[None, ...]
        return arr, path.stem

    if model_id == "realesr-general-x4v3":
        # Real-ESRGAN: keep original size (must be reasonable)
        w, h = img.size
        w = min(w, 256)
        h = min(h, 256)
        img = img.resize((w, h), Image.BILINEAR)
        arr = np.array(img).astype(np.float32) / 255.0
        arr = arr.transpose(2, 0, 1)[None, ...]
        return arr, path.stem

    # Default: 320x320
    img = img.resize((320, 320), Image.BILINEAR)
    arr = np.array(img).astype(np.float32) / 255.0
    arr = arr.transpose(2, 0, 1)[None, ...]
    return arr, path.stem


def run_inference(
    model_path: Path, input_tensor: np.ndarray, warmup: bool = True
) -> tuple[np.ndarray, float]:
    """Run ONNX inference and return (output, latency_ms)."""
    sess_opts = ort.SessionOptions()
    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_opts.intra_op_num_threads = 2

    session = ort.InferenceSession(
        str(model_path), sess_opts, providers=["CPUExecutionProvider"]
    )

    input_name = session.get_inputs()[0].name

    # Warmup
    if warmup:
        session.run(None, {input_name: input_tensor})

    # Timed run
    start = time.monotonic()
    result = session.run(None, {input_name: input_tensor})
    latency = (time.monotonic() - start) * 1000

    output = result[0].astype(np.float32)
    return output, latency


# ---------------------------------------------------------------------------
# Validation pipeline
# ---------------------------------------------------------------------------


def validate_model(
    model_id: str,
    input_paths: list[Path] | None = None,
    synthetic: bool = True,
) -> ValidationReport:
    """Run full quality validation for a quantized model."""
    fp32_path = MODELS_DIR / f"{model_id}.onnx"
    int8_path = QUANTIZED_DIR / f"{model_id}-int8.onnx"

    if not fp32_path.exists():
        raise FileNotFoundError(f"FP32 model not found: {fp32_path}")
    if not int8_path.exists():
        raise FileNotFoundError(
            f"INT8 model not found: {int8_path}\n"
            f"Run: python3 quantize_model.py --model {model_id}"
        )

    thresholds = MODEL_THRESHOLDS.get(model_id, QualityThresholds())
    report = ValidationReport(
        model_id=model_id,
        fp32_model_path=str(fp32_path.relative_to(REPO_ROOT)),
        int8_model_path=str(int8_path.relative_to(REPO_ROOT)),
        ort_version=ort.__version__,
        thresholds=asdict(thresholds),
    )

    # Build input set
    inputs: list[tuple[np.ndarray, str]] = []
    if input_paths:
        for p in input_paths:
            inputs.append(load_image_input(p, model_id))
    if synthetic or not inputs:
        # Multiple synthetic inputs for robustness
        for size in [320] if model_id == "u2netp" else [64]:
            inputs.append(create_synthetic_input(model_id, size))
        # Add a second synthetic with different seed
        rng = np.random.default_rng(123)
        if model_id == "u2netp":
            img = rng.uniform(0, 1, (1, 3, 320, 320)).astype(np.float32)
            inputs.append((img, "synthetic_random_123"))
        if model_id == "realesr-general-x4v3":
            img = rng.uniform(0.1, 0.9, (1, 3, 64, 64)).astype(np.float32)
            inputs.append((img, "synthetic_random_123"))

    all_metrics: list[QualityMetrics] = []

    for input_tensor, input_name in inputs:
        # Run FP32
        fp32_output, fp32_latency = run_inference(fp32_path, input_tensor)
        # Run INT8
        int8_output, int8_latency = run_inference(int8_path, input_tensor)

        # Compute metrics
        metrics = QualityMetrics(input_name=input_name)
        metrics.iou = compute_iou(fp32_output, int8_output)
        metrics.mae = compute_mae(fp32_output, int8_output)
        metrics.psnr_db = compute_psnr(fp32_output, int8_output)
        metrics.pearson_r = compute_pearson_r(fp32_output, int8_output)
        metrics.correlation_loss = 1.0 - metrics.pearson_r
        metrics.fp32_output_mean = float(fp32_output.mean())
        metrics.int8_output_mean = float(int8_output.mean())
        metrics.fp32_latency_ms = fp32_latency
        metrics.int8_latency_ms = int8_latency
        metrics.speedup = fp32_latency / max(int8_latency, 0.001)

        # Health checks
        health = check_output_health(int8_output)
        metrics.nan_fraction = health["nan_fraction"]
        metrics.inf_fraction = health["inf_fraction"]
        metrics.output_range_violation = health["output_range_violation"]

        # Check thresholds
        failures: list[str] = []
        if metrics.mae > thresholds.max_mae:
            failures.append(
                f"MAE {metrics.mae:.4f} > {thresholds.max_mae}"
            )
        if metrics.psnr_db < thresholds.min_psnr_db:
            failures.append(
                f"PSNR {metrics.psnr_db:.1f}dB < {thresholds.min_psnr_db}"
            )
        if metrics.correlation_loss > thresholds.max_correlation_loss:
            failures.append(
                f"Correlation loss {metrics.correlation_loss:.4f} > "
                f"{thresholds.max_correlation_loss}"
            )
        if metrics.nan_fraction > thresholds.max_nan_fraction:
            failures.append(
                f"NaN fraction {metrics.nan_fraction:.6f} > {thresholds.max_nan_fraction}"
            )
        if metrics.output_range_violation > thresholds.max_output_range_violation:
            failures.append(
                f"Range violation {metrics.output_range_violation:.4f} > "
                f"{thresholds.max_output_range_violation}"
            )

        metrics.failure_reasons = failures
        metrics.passed = len(failures) == 0
        all_metrics.append(metrics)

        status = "PASS" if metrics.passed else "FAIL"
        print(
            f"  [{status}] {input_name}: MAE={metrics.mae:.4f} "
            f"PSNR={metrics.psnr_db:.1f}dB r={metrics.pearson_r:.4f} "
            f"speedup={metrics.speedup:.2f}x"
        )
        if failures:
            for f in failures:
                print(f"         - {f}")

    # Aggregate
    report.metrics = [asdict(m) for m in all_metrics]
    report.mean_mae = float(np.mean([m.mae for m in all_metrics]))
    report.mean_psnr_db = float(np.mean([m.psnr_db for m in all_metrics]))
    report.mean_speedup = float(np.mean([m.speedup for m in all_metrics]))
    report.overall_passed = all(m.passed for m in all_metrics)

    # Write report
    report_path = QUANTIZED_DIR / f"{model_id}-validation-report.json"
    report_path.write_text(json.dumps(asdict(report), indent=2))
    print(f"\n  Report: {report_path.relative_to(REPO_ROOT)}")
    print(
        f"  Summary: mean_MAE={report.mean_mae:.4f} "
        f"mean_PSNR={report.mean_psnr_db:.1f}dB "
        f"mean_speedup={report.mean_speedup:.2f}x"
    )

    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Validate quantized ONNX model quality"
    )
    parser.add_argument(
        "--model",
        choices=list(MODEL_THRESHOLDS.keys()),
        help="Model ID to validate",
    )
    parser.add_argument("--all", action="store_true", help="Validate all models")
    parser.add_argument(
        "--input", type=Path, action="append", help="Input image path (repeatable)"
    )
    parser.add_argument(
        "--synthetic",
        action="store_true",
        default=False,
        help="Use synthetic test inputs",
    )

    args = parser.parse_args()
    if not args.model and not args.all:
        parser.error("Specify --model <id> or --all")

    models = list(MODEL_THRESHOLDS.keys()) if args.all else [args.model]

    all_passed = True
    for model_id in models:
        print(f"\n=== Validating {model_id} ===")
        try:
            report = validate_model(
                model_id,
                input_paths=args.input,
                synthetic=args.synthetic,
            )
            if not report.overall_passed:
                all_passed = False
        except FileNotFoundError as e:
            print(f"  SKIP: {e}")
            all_passed = False

    print("\n" + "=" * 60)
    if all_passed:
        print("ALL MODELS PASSED")
    else:
        print("SOME MODELS FAILED — see reports for details")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
