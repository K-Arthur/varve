#!/usr/bin/env python3
"""
Decompose pipeline divergence between the reference (rembg stretch + clamp),
Varve's current letterbox + min-max path, and a letterbox + clamp candidate.

Compares masks at pixel level (MAE and max absolute difference over the soft
mask, IoU at the 0.5 threshold) and writes a machine-readable JSON plus a
markdown table. Used by the BiRefNet parity audit; run after
run_reference.py has produced all three modes for the models of interest.

Usage:
    python3 scripts/bench/bgremove-reference/compare_modes.py \
        --reference-dir /path/to/reference-out \
        --output /path/to/divergence.json
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

MODES = ("rembg", "varve", "varve-clamp")


def load_gray(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("L"), dtype=np.float32)


def compare(a: np.ndarray, b: np.ndarray):
    diff = np.abs(a - b)
    mae = float(diff.mean() / 255.0)
    max_abs = float(diff.max() / 255.0)
    a_fg = a >= 128
    b_fg = b >= 128
    inter = float(np.logical_and(a_fg, b_fg).sum())
    union = float(np.logical_or(a_fg, b_fg).sum())
    iou = inter / union if union > 0 else 1.0
    return {"mae": round(mae, 5), "maxAbsDiff": round(max_abs, 4), "iou": round(iou, 5)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare reference pipeline modes")
    parser.add_argument("--reference-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    summary_path = args.reference_dir / "reference-summary.json"
    summary = json.loads(summary_path.read_text())
    rows = []
    for entry in summary["results"]:
        image = entry["image"]
        model = entry["model"]
        base = entry.get("rembg_mask")
        varve = entry.get("varve_mask")
        clamp = entry.get("varve-clamp_mask")
        if not (base and varve and clamp):
            continue
        base_mask = load_gray(args.reference_dir / Path(base).name)
        varve_mask = load_gray(args.reference_dir / Path(varve).name)
        clamp_mask = load_gray(args.reference_dir / Path(clamp).name)
        rows.append(
            {
                "image": image,
                "model": model,
                "rembgVsVarve": compare(base_mask, varve_mask),
                "rembgVsVarveClamp": compare(base_mask, clamp_mask),
                "varveVsVarveClamp": compare(varve_mask, clamp_mask),
            }
        )

    out = {
        "schemaVersion": 1,
        "note": (
            "rembgVsVarve measures total current-code divergence from the reference; "
            "rembgVsVarveClamp isolates the preprocessing (letterbox vs stretch) question; "
            "varveVsVarveClamp isolates the output normalisation (min-max vs clamp) question."
        ),
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2))

    lines = [
        "# Pipeline divergence vs rembg reference",
        "",
        "| Image | Model | rembg vs Varve (MAE / max) | rembg vs VarveClamp (MAE / max) | Varve vs VarveClamp (MAE) |",
        "|---|---|---:|---:|---:|",
    ]
    for row in rows:
        rv = row["rembgVsVarve"]
        rc = row["rembgVsVarveClamp"]
        vc = row["varveVsVarveClamp"]
        lines.append(
            f"| {row['image']} | {row['model']} | {rv['mae']} / {rv['maxAbsDiff']} | "
            f"{rc['mae']} / {rc['maxAbsDiff']} | {vc['mae']} |"
        )
    md = args.output.with_suffix(".md")
    md.write_text("\n".join(lines) + "\n")
    print(f"wrote {args.output} and {md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
