"""Export official NAFNet checkpoints to the Varve ONNX contract.

Contracts (shared by every NAFNet checkpoint in Varve):
- input:  [1,3,H,W] float32 in [0,1], BGR channel order, H/W any
  (the runtime pads to a multiple of 16 with zeros and crops back,
  mirroring the official check_image_size)
- output: [1,3,H,W] float32 in [0,1]
- opset 18 (onnxruntime-web 1.27 compatible)

The exported graph is the canonical NAFNet forward only; padding and
cropping stay in the runtime so one artifact serves any input size.

Modes:
- default: fp32 weights (large, external-data sidecar) — used for parity
- --fp16-boundary: fp16 internal weights wrapped with fp32 input/output
  Cast nodes; single-file embedding (save_as_external_data=False) is
  applied automatically. This is the shipped artifact form.

Usage:
    python export_nafnet_onnx.py \
        --checkpoint NAFNet-GoPro-width64.pth \
        --output nafnet-gopro-width64-fp32.onnx
    python export_nafnet_onnx.py \
        --checkpoint NAFNet-GoPro-width64.pth \
        --output nafnet-gopro-width64-fp16.onnx --fp16-boundary
"""

import argparse
import hashlib
import sys
from pathlib import Path

import torch

REF_REPO = Path(__file__).resolve().parent / ".nafnet-ref"
sys.path.insert(0, str(REF_REPO))
sys.path.insert(0, str(REF_REPO / "basicsr"))

from basicsr.models.archs.NAFNet_arch import NAFNet  # noqa: E402


def build_net(checkpoint: Path):
    net = NAFNet(
        img_channel=3,
        width=64,
        middle_blk_num=1,
        enc_blk_nums=[1, 1, 1, 28],
        dec_blk_nums=[1, 1, 1, 1],
    )
    ckpt = torch.load(checkpoint, map_location="cpu")
    state = ckpt.get("params", ckpt)
    net.load_state_dict(state)
    net.eval()
    return net


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--opset", type=int, default=18)
    ap.add_argument(
        "--fp16-boundary",
        action="store_true",
        help="fp16 internal weights with fp32 boundary + single-file embedding",
    )
    args = ap.parse_args()

    net = build_net(args.checkpoint)

    if args.fp16_boundary:
        net = net.half()

        class Boundary(torch.nn.Module):
            def __init__(self, inner):
                super().__init__()
                self.inner = inner

            def forward(self, x):
                return self.inner(x.half()).float()

        net = Boundary(net).eval()

    dummy = torch.randn(1, 3, 512, 512, dtype=torch.float32)
    torch.onnx.export(
        net,
        dummy,
        str(args.output),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {2: "H", 3: "W"}, "output": {2: "H", 3: "W"}},
        opset_version=args.opset,
        do_constant_folding=True,
    )
    if args.fp16_boundary:
        # Collapse the external-data sidecar into one embeddable file.
        import onnx

        model = onnx.load(str(args.output), load_external_data=True)
        onnx.save_model(model, str(args.output), save_as_external_data=False)

    sha = hashlib.sha256(args.output.read_bytes()).hexdigest()
    print(f"exported {args.output} ({args.output.stat().st_size} bytes)")
    print(f"sha256: {sha}")


if __name__ == "__main__":
    main()
