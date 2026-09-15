#!/usr/bin/env python3
"""
Visual comparison report (contact sheets) for background-removal runs.

For every corpus fixture with a ground-truth matte, renders a sheet:
    Source | Ground truth | native mask | rembg reference | error heatmap
plus composite strips of the native cutout over white, black, and a
checkerboard, and a side-by-side per-model row when multiple models exist.

Run after run_reference.py and the native bgremove_bench; BiRefNet rows are
included automatically once their masks exist.

Usage:
    python3 scripts/bench/bgremove-reference/make_contact_sheet.py \
        --corpus tests/fixtures/bg-removal-corpus \
        --reference-dir /path/to/reference-out \
        --native-dir /path/to/native-out \
        --output-dir /path/to/visual-report
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

MODELS = ["u2netp", "isnet-general-use", "birefnet-general-lite", "birefnet-general"]
PAD = 8
HEADER = 22
TILE = 200


def checkerboard(w: int, h: int, cell=12, c1=200, c2=150) -> np.ndarray:
    idx = np.indices((h, w)).sum(axis=0) // cell
    return np.where(idx % 2 == 0, c1, c2).astype(np.uint8)


def composite(source_rgb: np.ndarray, mask: np.ndarray, bg) -> np.ndarray:
    a = (mask[..., None].astype(np.float32) / 255.0)
    return (source_rgb.astype(np.float32) * a + bg.astype(np.float32) * (1 - a)).astype(np.uint8)


def heatmap(gt: np.ndarray, pred: np.ndarray) -> np.ndarray:
    diff = np.abs(gt.astype(np.float32) - pred.astype(np.float32)) / 255.0
    heat = np.zeros((*diff.shape, 3), dtype=np.uint8)
    heat[..., 0] = 0
    heat[..., 1] = 0
    heat[..., 2] = (diff * 255).clip(0, 255)
    return heat


def fit(tile: np.ndarray, size: int) -> np.ndarray:
    im = Image.fromarray(tile)
    im.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size), (32, 32, 32))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    return np.asarray(canvas)


def label(draw: ImageDraw.ImageDraw, text: str, width: int):
    draw.text((PAD, 3), text, fill=(235, 235, 235))


def main() -> int:
    parser = argparse.ArgumentParser(description="Render bg-removal contact sheets")
    parser.add_argument("--corpus", required=True, type=Path)
    parser.add_argument("--reference-dir", required=True, type=Path)
    parser.add_argument("--native-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    fixtures = []
    manifest_path = args.corpus / "synthetic" / "synthetic-manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for f in manifest["fixtures"]:
            fixtures.append((f["id"], args.corpus / "synthetic" / f["file"], f["labelClass"]))
    for jpg in sorted(args.corpus.glob("*.jpg")):
        fixtures.append((jpg.stem, jpg, "binary"))
    if not fixtures:
        print("no fixtures found", file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    index = ["# Background-removal visual report", "", "| Fixture | Sheet |", "|---|---|"]

    for fixture_id, fixture_path, label_class in fixtures:
        source_rgba = np.asarray(Image.open(fixture_path).convert("RGBA"))
        source_rgb = source_rgba[:, :, :3]
        gt = source_rgba[:, :, 3]
        if not np.any(gt > 0):
            continue
        has_gt = np.any(gt != 255) if label_class == "alpha" else True

        native_masks = {}
        for model in MODELS:
            p = args.native_dir / f"{fixture_id}-{model}-mask.png"
            if p.exists():
                native_masks[model] = np.asarray(Image.open(p).convert("L"))

        columns = [
            ("source", fit(source_rgb, TILE)),
            ("ground-truth", fit(np.dstack([gt, gt, gt]), TILE)),
        ]
        for model in MODELS:
            if model in native_masks:
                mask_tile = np.dstack([native_masks[model]] * 3)
                columns.append((f"native {model}", fit(mask_tile, TILE)))
            ref = args.reference_dir / f"{fixture_id}-{model}-rembg.png"
            if ref.exists():
                ref_mask = np.asarray(Image.open(ref).convert("L"))
                columns.append((f"rembg {model}", fit(np.dstack([ref_mask] * 3), TILE)))

        heat = None
        if has_gt and native_masks:
            first = next(iter(native_masks.values()))
            if first.shape == gt.shape:
                heat = heatmap(gt, first)
        if heat is not None:
            columns.append(("error heatmap", fit(heat, TILE)))

        cols = min(5, len(columns))
        rows = (len(columns) + cols - 1) // cols
        sheet_w = cols * (TILE + PAD) + PAD
        sheet_h = HEADER + rows * (TILE + PAD) + PAD
        sheet = Image.new("RGB", (sheet_w, sheet_h), (24, 24, 24))
        draw = ImageDraw.Draw(sheet)
        label(draw, f"{fixture_id} ({label_class})", sheet_w)

        for idx, (name, tile) in enumerate(columns):
            x = PAD + (idx % cols) * (TILE + PAD)
            y = HEADER + (idx // cols) * (TILE + PAD)
            sheet.paste(Image.fromarray(tile), (x, y))
            draw.text((x, y + TILE + 2), name, fill=(200, 200, 200))

        # Composite strip: native cutout over white / black / checkerboard.
        if native_masks:
            first_model = next(iter(native_masks))
            m = native_masks[first_model]
            if m.shape[:2] == source_rgb.shape[:2]:
                strip = np.hstack(
                    [
                        composite(source_rgb, m, np.full_like(source_rgb, 255)),
                        composite(source_rgb, m, np.zeros_like(source_rgb)),
                        composite(source_rgb, m, np.dstack([checkerboard(m.shape[1], m.shape[0])] * 3)),
                    ]
                )
                sheet_full = Image.new("RGB", (sheet_w, sheet_h + TILE + PAD + HEADER), (24, 24, 24))
                sheet_full.paste(sheet, (0, 0))
                d2 = ImageDraw.Draw(sheet_full)
                label(d2, f"{fixture_id} — native {first_model} composites: white | black | checkerboard", sheet_w)
                d2.text((PAD, sheet_h + HEADER - 18), "white | black | checkerboard", fill=(200, 200, 200))
                strip_im = Image.fromarray(strip)
                strip_im.thumbnail((sheet_w - 2 * PAD, TILE))
                sheet_full.paste(strip_im, (PAD, sheet_h + HEADER))
                sheet = sheet_full

        out_path = args.output_dir / f"{fixture_id}-sheet.png"
        sheet.save(out_path)
        index.append(f"| {fixture_id} | {out_path.name} |")

    (args.output_dir / "index.md").write_text("\n".join(index) + "\n")
    print(f"wrote {len(fixtures)} sheets to {args.output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
