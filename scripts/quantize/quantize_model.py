#!/usr/bin/env python3
"""
INT8 dynamic quantization pipeline for Varve's bundled ONNX models.

Produces validated, provenance-annotated INT8 artifacts from canonical FP32
sources. Never overwrites the original model. Each generated artifact carries
a machine-readable report with source hash, ORT version, quantization config,
and validation results.

Usage:
    python3 quantize_model.py --model u2netp --weight-type QInt8 --per-channel
    python3 quantize_model.py --model realesr-general-x4v3 --weight-type QUInt8
    python3 quantize_model.py --all

Research basis:
    - ONNX Runtime Quantization: https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
    - Dynamic quantization: weights pre-quantized to INT8, activations quantized
      at runtime. Best for Conv/MatMul-heavy models (u2netp, Real-ESRGAN).
    - QInt8 vs QUInt8: QInt8 (symmetric) typically better for weights centered
      around zero; QUInt8 (asymmetric) for non-negative distributions.
    - Per-channel quantization: per-output-channel scales reduce error vs
      per-tensor for Conv layers with diverse weight ranges.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np
import onnx
from onnx import shape_inference

try:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.shape_inference import quant_pre_process
except ImportError as e:
    print(
        f"ERROR: onnxruntime.quantization unavailable: {e}\n"
        "Install with: pip install onnxruntime>=1.27",
        file=sys.stderr,
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MODELS_DIR = REPO_ROOT / "apps" / "desktop" / "public" / "models"
OUTPUT_DIR = REPO_ROOT / "apps" / "desktop" / "public" / "models" / "quantized"
REPORT_DIR = REPO_ROOT / "apps" / "desktop" / "public" / "models" / "quantized"

WeightType = Literal["QInt8", "QUInt8"]


@dataclass
class QuantizationConfig:
    """Configuration for a single quantization run."""

    model_id: str
    source_filename: str
    weight_type: WeightType = "QInt8"
    per_channel: bool = True
    reduce_range: bool = False
    nodes_to_exclude: list[str] = field(default_factory=list)
    op_types_to_quantize: list[str] | None = None
    extra_options: dict = field(default_factory=dict)


@dataclass
class QuantizationReport:
    """Machine-readable provenance and validation report."""

    model_id: str
    source_filename: str
    output_filename: str
    source_sha256: str
    output_sha256: str
    source_size_bytes: int
    output_size_bytes: int
    compression_ratio: float
    weight_type: str
    per_channel: bool
    reduce_range: bool
    ort_version: str
    onnx_version: str
    opset_version: int
    ir_version: int
    quantized_node_count: int
    excluded_nodes: list[str]
    validation_passed: bool
    validation_details: dict = field(default_factory=dict)
    generation_timestamp: str = ""
    duration_seconds: float = 0.0

    def __post_init__(self):
        if not self.generation_timestamp:
            self.generation_timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------


def sha256_file(path: Path) -> str:
    """Compute SHA-256 hex digest of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def get_ort_version() -> str:
    """Get the installed ONNX Runtime version."""
    import onnxruntime

    return onnxruntime.__version__


def quantize_model(
    config: QuantizationConfig, output_dir: Path = OUTPUT_DIR
) -> QuantizationReport:
    """
    Run the full quantization pipeline for a single model.

    Steps:
    1. Load and validate the source ONNX graph.
    2. Pre-process for quantization (shape inference).
    3. Run dynamic quantization with the specified config.
    4. Validate the output graph.
    5. Generate provenance report.
    """
    import onnxruntime

    source_path = MODELS_DIR / config.source_filename
    if not source_path.exists():
        raise FileNotFoundError(f"Source model not found: {source_path}")

    source_sha = sha256_file(source_path)
    source_size = source_path.stat().st_size

    # Output naming: {model_id}-int8.onnx
    output_filename = f"{config.model_id}-int8.onnx"
    output_path = output_dir / output_filename
    output_dir.mkdir(parents=True, exist_ok=True)

    # Pre-process: run shape inference so ORT quantizer can resolve dynamic dims
    preprocessed_path = output_dir / f"{config.model_id}-preprocessed.onnx"
    print(f"  Pre-processing {config.source_filename} (shape inference)...")
    quant_pre_process(
        str(source_path),
        str(preprocessed_path),
        auto_merge=True,
        save_as_external_data=False,
        skip_symbolic_shape=True,
    )

    # Map config to ORT types
    weight_type = (
        QuantType.QInt8 if config.weight_type == "QInt8" else QuantType.QUInt8
    )

    # Build extra options
    extra_options: dict = dict(config.extra_options)
    if config.op_types_to_quantize:
        extra_options["OpTypesToQuantize"] = config.op_types_to_quantize

    print(
        f"  Quantizing: weight_type={config.weight_type}, "
        f"per_channel={config.per_channel}, reduce_range={config.reduce_range}"
    )

    start = time.monotonic()

    quantize_dynamic(
        model_input=str(preprocessed_path),
        model_output=str(output_path),
        weight_type=weight_type,
        per_channel=config.per_channel,
        reduce_range=config.reduce_range,
        nodes_to_exclude=config.nodes_to_exclude or None,
        extra_options=extra_options,
    )

    duration = time.monotonic() - start

    # Clean up preprocessed intermediate
    preprocessed_path.unlink(missing_ok=True)

    # Validate output
    print(f"  Validating output graph...")
    output_model = onnx.load(str(output_path))
    onnx.checker.check_model(output_model)

    # Count quantized nodes (DequantizeLinear / QuantizeLinear)
    quantized_nodes = [
        n for n in output_model.graph.node
        if n.op_type in ("QuantizeLinear", "DequantizeLinear")
    ]

    output_sha = sha256_file(output_path)
    output_size = output_path.stat().st_size

    # Get opset from the model
    opset_version = 1
    for opset in output_model.opset_import:
        if opset.domain in ("", "ai.onnx"):
            opset_version = opset.version
            break

    report = QuantizationReport(
        model_id=config.model_id,
        source_filename=config.source_filename,
        output_filename=output_filename,
        source_sha256=source_sha,
        output_sha256=output_sha,
        source_size_bytes=source_size,
        output_size_bytes=output_size,
        compression_ratio=round(source_size / max(output_size, 1), 3),
        weight_type=config.weight_type,
        per_channel=config.per_channel,
        reduce_range=config.reduce_range,
        ort_version=get_ort_version(),
        onnx_version=onnx.__version__,
        opset_version=opset_version,
        ir_version=output_model.ir_version,
        quantized_node_count=len(quantized_nodes),
        excluded_nodes=config.nodes_to_exclude,
        validation_passed=True,
        validation_details={
            "output_graph_valid": True,
            "node_count": len(output_model.graph.node),
            "initializer_count": len(output_model.graph.initializer),
        },
        duration_seconds=round(duration, 2),
    )

    # Write report alongside the model
    report_path = output_dir / f"{config.model_id}-int8-report.json"
    report_path.write_text(json.dumps(asdict(report), indent=2))

    print(
        f"  Done: {source_size:,} -> {output_size:,} bytes "
        f"({report.compression_ratio:.1f}x) in {duration:.1f}s"
    )
    print(f"  Report: {report_path.relative_to(REPO_ROOT)}")

    return report


# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

# Default quantization configs per model. These are the recommended settings
# after experimentation — see docs/audits/ for per-model quality/perf results.
MODEL_CONFIGS: dict[str, QuantizationConfig] = {
    "u2netp": QuantizationConfig(
        model_id="u2netp",
        source_filename="u2netp.onnx",
        weight_type="QInt8",
        per_channel=True,
        reduce_range=False,
        # Conv_787's weight tensor spans ~5 orders of magnitude across output
        # channels (widest channel [-5.57, 0.10], narrowest [-9e-5, 1e-6]).
        # Quantizing it alone — with everything else quantized normally —
        # reproduces the full quality-validation failure (corr -0.004, MAE
        # 0.42, PSNR 3.8dB on synthetic_portrait); excluding only this one
        # node restores correlation to 0.9999 against the FP32 baseline.
        # Bisected empirically: see the quantization quality investigation
        # (2026-08-24) for the node-by-node search that isolated it.
        nodes_to_exclude=["Conv_787"],
        op_types_to_quantize=["Conv", "MatMul", "Gemm"],
    ),
    "realesr-general-x4v3": QuantizationConfig(
        model_id="realesr-general-x4v3",
        source_filename="realesr-general-x4v3.onnx",
        weight_type="QInt8",
        per_channel=True,
        reduce_range=False,
        # Real-ESRGAN: Conv + PRelu. PRelu has a learnable slope — quantize Conv only.
        nodes_to_exclude=[],
        op_types_to_quantize=["Conv", "MatMul", "Gemm"],
    ),
}


def quantize_all(output_dir: Path = OUTPUT_DIR) -> list[QuantizationReport]:
    """Quantize all registered models."""
    reports = []
    for model_id, config in MODEL_CONFIGS.items():
        print(f"\n=== Quantizing {model_id} ===")
        report = quantize_model(config, output_dir=output_dir)
        reports.append(report)
    return reports


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="INT8 dynamic quantization for Varve ONNX models",
        epilog="Example: python3 quantize_model.py --model u2netp --weight-type QInt8 --per-channel",
    )
    parser.add_argument(
        "--model",
        choices=list(MODEL_CONFIGS.keys()),
        help="Model ID to quantize (default: --all)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Quantize all registered models",
    )
    parser.add_argument(
        "--weight-type",
        choices=["QInt8", "QUInt8"],
        default="QInt8",
        help="Weight quantization type (default: QInt8)",
    )
    parser.add_argument(
        "--per-channel",
        action="store_true",
        default=True,
        help="Per-channel quantization (default: True)",
    )
    parser.add_argument(
        "--per-tensor",
        action="store_true",
        help="Override to per-tensor quantization",
    )
    parser.add_argument(
        "--reduce-range",
        action="store_true",
        help="Use reduced-range INT8 (for older CPUs without VNNI)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="Output directory for quantized models",
    )

    args = parser.parse_args()

    if not args.model and not args.all:
        parser.error("Specify --model <id> or --all")

    output_dir = args.output_dir

    if args.all:
        reports = quantize_all(output_dir=output_dir)
    else:
        config = MODEL_CONFIGS[args.model]
        # Override with CLI args
        config.weight_type = args.weight_type
        config.per_channel = not args.per_tensor
        config.reduce_range = args.reduce_range
        reports = [quantize_model(config, output_dir=output_dir)]

    # Summary
    print("\n" + "=" * 60)
    print("QUANTIZATION SUMMARY")
    print("=" * 60)
    for r in reports:
        status = "PASS" if r.validation_passed else "FAIL"
        print(
            f"  [{status}] {r.model_id}: {r.source_size_bytes:,} -> "
            f"{r.output_size_bytes:,} bytes ({r.compression_ratio:.1f}x) "
            f"weight={r.weight_type} per_channel={r.per_channel}"
        )

    # Exit non-zero if any failed
    if not all(r.validation_passed for r in reports):
        sys.exit(1)


if __name__ == "__main__":
    main()
