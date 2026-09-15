#!/usr/bin/env python3
"""
Contact sheets for restore-reference runs: clean / degraded / restored /
difference crops at 100% for a fixture set, one sheet per (fixture,
recipe). Inspect these visually before trusting any metric.

Usage:
    python3 scripts/bench/restore-reference/make_contact_sheet.py \
        --fixtures-dir tests/fixtures/restore-corpus \
        --output-dir /tmp/restore-reference-out
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path_insert = None


def diff_heatmap(a, b):
    d = np.abs(a.astype(np.float32) - b.astype(np.float32)).max(axis=2)
    d = (d / max(1.0, d.max()) * 255).astype(np.uint8)
    return cv2.applyColorMap(d, cv2.COLORMAP_INFERNO)


def make_sheet(clean, degraded, restored_paths, out_path):
    rows = [np.hstack([clean, degraded])]
    for name, path in restored_paths:
        restored = cv2.imread(str(path), cv2.IMREAD_COLOR)
        diff = diff_heatmap(clean, restored)
        label = np.full((18, clean.shape[1] * 2, 3), 255, np.uint8)
        cv2.putText(label, f"{name} (restored | diff)", (6, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (30, 30, 30), 1, cv2.LINE_AA)
        rows.append(label)
        rows.append(np.hstack([restored, diff]))
    sheet = np.vstack(rows)
    cv2.imwrite(str(out_path), sheet)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures-dir", required=True, type=Path)
    ap.add_argument("--output-dir", required=True, type=Path)
    args = ap.parse_args()

    summaries = {}
    summary_path = args.output_dir / "summary.jsonl"
    if summary_path.exists():
        for line in summary_path.read_text().splitlines():
            row = json.loads(line)
            summaries.setdefault(row["fixture"], []).append(row)

    for fixture in sorted(args.fixtures_dir.glob("*")):
        if "--" in fixture.name or fixture.suffix.lower() not in (".png", ".jpg"):
            continue
        clean = cv2.imread(str(fixture), cv2.IMREAD_COLOR)
        if clean is None:
            continue
        for row in summaries.get(fixture.name, []):
            recipe = row["recipe"]
            degraded = cv2.imread(
                str(args.fixtures_dir / f"{fixture.stem}--{recipe}.png"), cv2.IMREAD_COLOR
            )
            if degraded is None:
                continue
            restored_paths = [
                (name, args.output_dir / f"{fixture.stem}--{recipe}--{name}.png")
                for name in ("nafnet-deblur", "scunet-denoise")
                if (args.output_dir / f"{fixture.stem}--{recipe}--{name}.png").exists()
            ]
            if not restored_paths:
                continue
            out = args.output_dir / f"sheet--{fixture.stem}--{recipe}.png"
            make_sheet(clean, degraded, restored_paths, out)
            print(f"wrote {out}")


if __name__ == "__main__":
    main()
