"""Convert canonical Real-ESRGAN PyTorch weights to Varve's ONNX contract.

The model definitions and release URLs mirror the upstream v0.3.0 inference
script. Output is a dynamic-height/width NCHW float32 model with a fixed 4x
scale. This utility does not publish or enable the resulting artifact.

Usage:
    pip install torch onnx basicsr realesrgan
    python scripts/convert_realesrgan_to_onnx.py \
        --model realesr-general-x4v3 \
        --output apps/desktop/public/models
"""

from __future__ import annotations

import argparse
import hashlib
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


Architecture = Literal["rrdb-23", "rrdb-6", "srvgg-32"]


@dataclass(frozen=True)
class ModelSpec:
    architecture: Architecture
    release: str
    weight_url: str
    weight_filename: str
    output_filename: str


# Canonical variants from xinntao/Real-ESRGAN's v0.3.0 inference script.
MODEL_SPECS: dict[str, ModelSpec] = {
    "realesr-general-x4v3": ModelSpec(
        architecture="srvgg-32",
        release="v0.3.0 (asset tag v0.2.5.0)",
        weight_url=(
            "https://github.com/xinntao/Real-ESRGAN/releases/download/"
            "v0.2.5.0/realesr-general-x4v3.pth"
        ),
        weight_filename="realesr-general-x4v3.pth",
        output_filename="realesr-general-x4v3.onnx",
    ),
    "realesrgan-x4plus": ModelSpec(
        architecture="rrdb-23",
        release="v0.1.0",
        weight_url=(
            "https://github.com/xinntao/Real-ESRGAN/releases/download/"
            "v0.1.0/RealESRGAN_x4plus.pth"
        ),
        weight_filename="RealESRGAN_x4plus.pth",
        output_filename="realesrgan-x4plus.onnx",
    ),
    "realesrgan-x4plus-anime": ModelSpec(
        architecture="rrdb-6",
        release="v0.2.2.4",
        weight_url=(
            "https://github.com/xinntao/Real-ESRGAN/releases/download/"
            "v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
        ),
        weight_filename="RealESRGAN_x4plus_anime_6B.pth",
        output_filename="realesrgan-x4plus-anime.onnx",
    ),
}


def build_model(architecture: Architecture):
    """Construct the exact network used by the selected upstream weights."""
    if architecture == "srvgg-32":
        import torch.nn as nn
        from torch.nn import functional as functional

        class SRVGGNetCompact(nn.Module):
            """Exact compact architecture from Real-ESRGAN's upstream source."""

            def __init__(self):
                super().__init__()
                body: list[nn.Module] = [nn.Conv2d(3, 64, 3, 1, 1), nn.PReLU(64)]
                for _ in range(32):
                    body.extend((nn.Conv2d(64, 64, 3, 1, 1), nn.PReLU(64)))
                body.append(nn.Conv2d(64, 3 * 4 * 4, 3, 1, 1))
                self.body = nn.ModuleList(body)
                self.upsampler = nn.PixelShuffle(4)

            def forward(self, value):
                output = value
                for layer in self.body:
                    output = layer(output)
                output = self.upsampler(output)
                return output + functional.interpolate(value, scale_factor=4, mode="nearest")

        return SRVGGNetCompact()

    from basicsr.archs.rrdbnet_arch import RRDBNet

    return RRDBNet(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_block=23 if architecture == "rrdb-23" else 6,
        num_grow_ch=32,
        scale=4,
    )


def load_weights(model, spec: ModelSpec, weights_dir: Path) -> Path:
    """Download the canonical release checkpoint and load its network state."""
    import torch

    weights_dir.mkdir(parents=True, exist_ok=True)
    path = weights_dir / spec.weight_filename
    if not path.exists():
        print(f"Downloading official weights: {spec.weight_url}")
        urllib.request.urlretrieve(spec.weight_url, path)
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if isinstance(checkpoint, dict) and "params_ema" in checkpoint:
        state = checkpoint["params_ema"]
    elif isinstance(checkpoint, dict) and "params" in checkpoint:
        state = checkpoint["params"]
    else:
        state = checkpoint
    model.load_state_dict(state, strict=True)
    model.eval()
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def convert_model(model_name: str, output_dir: str, weights_dir: str | None) -> Path:
    """Load official weights, export ONNX, and validate the resulting graph."""
    import onnx
    import torch

    spec = MODEL_SPECS[model_name]
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    checkpoint_dir = Path(weights_dir) if weights_dir else destination / "source-weights"

    model = build_model(spec.architecture)
    checkpoint_path = load_weights(model, spec, checkpoint_dir)
    output_path = destination / spec.output_filename
    dummy_input = torch.zeros(1, 3, 64, 64, dtype=torch.float32)

    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {2: "input_height", 3: "input_width"},
            "output": {2: "output_height", 3: "output_width"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )

    graph = onnx.load(output_path)
    onnx.checker.check_model(graph)
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Source release: {spec.release}")
    print(f"Source weights: {checkpoint_path}")
    print(f"Converted: {output_path} ({size_mb:.1f} MB)")
    print(f"SHA-256: {sha256_file(output_path)}")
    print("Contract: float32 NCHW RGB input/output, fixed 4x scale")
    print("Next: run a live ORT golden before adding remoteUrl/sha256 or enabling UI")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        choices=sorted(MODEL_SPECS),
        default="realesr-general-x4v3",
        help="Canonical Real-ESRGAN variant to convert",
    )
    parser.add_argument(
        "--output",
        default="apps/desktop/public/models",
        help="Destination directory for the ONNX artifact",
    )
    parser.add_argument(
        "--weights-dir",
        default=None,
        help="Optional cache directory for upstream PyTorch checkpoints",
    )
    args = parser.parse_args()
    convert_model(args.model, args.output, args.weights_dir)


if __name__ == "__main__":
    main()
