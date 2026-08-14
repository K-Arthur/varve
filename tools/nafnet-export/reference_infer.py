"""Trusted-reference inference for NAFNet checkpoints using the OFFICIAL
megvii-research/NAFNet implementation (pinned commit) and plain NAFNet
forward (canonical full-image inference; NAFNetLocal is a numerically
identical local-window repackaging used for training memory).

Input images are read with cv2 (BGR, uint8), converted to float32 / 255,
padded to a multiple of padder_size (16 for width64) with zeros, run
through the network, cropped back, and written as BGR PNG.
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import torch

REF_REPO = Path(__file__).resolve().parent / ".nafnet-ref"
sys.path.insert(0, str(REF_REPO))
sys.path.insert(0, str(REF_REPO / "basicsr"))

from basicsr.models.archs.NAFNet_arch import NAFNet  # noqa: E402


def load_net(checkpoint_path: Path, width: int, enc_blk_nums, middle_blk_num, dec_blk_nums):
    net = NAFNet(
        img_channel=3,
        width=width,
        middle_blk_num=middle_blk_num,
        enc_blk_nums=enc_blk_nums,
        dec_blk_nums=dec_blk_nums,
    )
    ckpt = torch.load(checkpoint_path, map_location="cpu")
    state = ckpt.get("params", ckpt)
    net.load_state_dict(state)
    net.eval()
    return net


def infer(net, img_bgr: np.ndarray) -> np.ndarray:
    """Official pipeline: BGR uint8 -> float [0,1] -> zero-pad to 16 -> crop back."""
    h, w = img_bgr.shape[:2]
    x = torch.from_numpy(img_bgr.transpose(2, 0, 1).astype(np.float32) / 255.0).unsqueeze(0)
    pad_h = (net.padder_size - h % net.padder_size) % net.padder_size
    pad_w = (net.padder_size - w % net.padder_size) % net.padder_size
    if pad_h or pad_w:
        x = torch.nn.functional.pad(x, (0, pad_w, 0, pad_h))
    with torch.no_grad():
        out = net(x)
    out = out[..., :h, :w]
    out = out.squeeze(0).permute(1, 2, 0).clamp(0, 1).numpy()
    return (out * 255.0).round().astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, type=Path)
    ap.add_argument("--input", required=True, type=Path, nargs="+")
    ap.add_argument("--output-dir", required=True, type=Path)
    ap.add_argument("--width", type=int, default=64)
    args = ap.parse_args()

    net = load_net(
        args.checkpoint,
        width=args.width,
        enc_blk_nums=[1, 1, 1, 28],
        middle_blk_num=1,
        dec_blk_nums=[1, 1, 1, 1],
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for path in args.input:
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        out = infer(net, img)
        out_path = args.output_dir / f"{path.stem}_ref.png"
        cv2.imwrite(str(out_path), out)
        print(f"{path.name}: {img.shape[1]}x{img.shape[0]} -> {out_path}")


if __name__ == "__main__":
    main()
