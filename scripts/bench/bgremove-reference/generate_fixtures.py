#!/usr/bin/env python3
"""
Deterministic synthetic background-removal fixtures with exact ground truth.

Every fixture is procedurally generated with a fixed seed, so the expected
mask/alpha is known exactly (no manual annotation, no licensing issues). The
RGB image is the foreground composited over the background; the PNG alpha
channel is the ground-truth matte.

Classification:
  - binary fixtures: alpha is 0/255 (exact segmentation label)
  - `synth-glass.png`: genuine soft alpha matte (semi-transparent band) —
    may be scored with alpha SAD/MSE/gradient, never as a binary label only

Categories stress: fine structure (hair strands, spokes, fence grid), low
contrast, backlight, panorama/tall aspect ratios, tiny images, grayscale,
and translucent material.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RNG = np.random.default_rng(20260813)


def composite(fg_rgba: np.ndarray, bg_rgb: np.ndarray) -> np.ndarray:
    """RGBA output where RGB = fg over bg, A = fg alpha (0-255)."""
    a = fg_rgba[:, :, 3:4] / 255.0
    rgb = fg_rgba[:, :, :3] * a + bg_rgb * (1.0 - a)
    return np.dstack([rgb, fg_rgba[:, :, 3:4]])


def gradient_bg(w: int, h: int, c1=(40, 90, 160), c2=(220, 200, 170), noise=6.0) -> np.ndarray:
    t = np.linspace(0, 1, w, dtype=np.float32)[None, :, None]
    t2 = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    base = np.array(c1, dtype=np.float32) * (1 - t) + np.array(c2, dtype=np.float32) * t
    base = base * (1 - 0.35 * t2) + 40 * t2
    return np.clip(base + RNG.normal(0, noise, (h, w, 1)), 0, 255).astype(np.uint8)


def blob_mask(w: int, h: int, cx: float, cy: float, rx: float, ry: float) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w]
    return ((xx - cx) ** 2 / rx**2 + (yy - cy) ** 2 / ry**2) <= 1


def add_strands(mask: np.ndarray, rng: np.random.Generator, count: int, length: int):
    h, w = mask.shape
    img = Image.fromarray((mask * 255).astype(np.uint8), mode="L")
    draw = ImageDraw.Draw(img)
    for _ in range(count):
        x0 = int(rng.uniform(w * 0.15, w * 0.85))
        y0 = int(rng.uniform(h * 0.35, h * 0.55))
        theta = rng.uniform(-0.9, 0.9)
        end = (x0 + int(length * np.sin(theta)), y0 + int(length * np.cos(theta)))
        draw.line([(x0, y0), end], fill=255, width=1)
    return np.asarray(img) > 127


def fg_from_mask(mask: np.ndarray, color: tuple) -> np.ndarray:
    h, w = mask.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = color
    rgba[:, :, 3] = mask * 255
    return rgba


def gen_hair(w: int, h: int):
    bg = gradient_bg(w, h, (150, 180, 90), (30, 60, 20))
    m = blob_mask(w, h, w * 0.5, h * 0.48, w * 0.28, h * 0.34)
    m = add_strands(m, RNG, count=90, length=int(w * 0.45))
    fg = fg_from_mask(m, (190, 120, 60))
    return composite(fg, bg)


def gen_shapes(w: int, h: int):
    bg = gradient_bg(w, h, (200, 60, 40), (40, 20, 90))
    m = np.zeros((h, w), dtype=bool)
    # wheel with spokes (bicycle-spoke-like fine structure)
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy, r = w * 0.35, h * 0.45, h * 0.3
    ring = ((xx - cx) ** 2 + (yy - cy) ** 2) <= r**2
    m |= ring & (~(((xx - cx) ** 2 + (yy - cy) ** 2) <= (r * 0.82) ** 2))
    for k in range(12):
        a = k * np.pi / 6
        dx, dy = np.cos(a), np.sin(a)
        band = (xx - cx) * dx + (yy - cy) * dy
        m |= (band >= -1.2) & (band <= 1.2) & (ring | (((xx - cx) ** 2 + (yy - cy) ** 2) <= r**2))
    # fence grid at right
    fx0, fx1, fy0, fy1 = int(w * 0.62), w - 4, int(h * 0.15), int(h * 0.85)
    m[fy0:fy1, fx0 : fx0 + 3] = True
    m[fy0:fy1, fx1 - 3 : fx1] = True
    for x in range(fx0, fx1, 24):
        m[fy0:fy1, x : x + 2] = True
    for y in range(fy0, fy1, 36):
        m[y : y + 2, fx0:fx1] = True
    fg = fg_from_mask(m, (245, 220, 120))
    return composite(fg, bg)


def gen_glass(w: int, h: int):
    bg = gradient_bg(w, h, (30, 90, 160), (120, 200, 230))
    # translucent pane: alpha ramps across a band (genuine matte)
    a = np.zeros((h, w), dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    pane = (xx >= w * 0.22) & (xx <= w * 0.78) & (yy >= h * 0.2) & (yy <= h * 0.8)
    a[pane] = 0.35 + 0.4 * ((yy[pane] / h) - 0.3)
    a = np.clip(a, 0, 1)
    # hard edge for the pane frame
    a[(xx >= w * 0.22) & (xx <= w * 0.24) & (yy >= h * 0.2) & (yy <= h * 0.8)] = 1.0
    a[(xx >= w * 0.76) & (xx <= w * 0.78) & (yy >= h * 0.2) & (yy <= h * 0.8)] = 1.0
    a[(yy >= h * 0.2) & (yy <= h * 0.22) & (xx >= w * 0.22) & (xx <= w * 0.78)] = 1.0
    a[(yy >= h * 0.78) & (yy <= h * 0.8) & (xx >= w * 0.22) & (xx <= w * 0.78)] = 1.0
    # glass tint + highlight
    tint = np.zeros((h, w, 4), dtype=np.uint8)
    tint[:, :, 0] = 190
    tint[:, :, 1] = 230
    tint[:, :, 2] = 250
    tint[:, :, 3] = (a * 255).astype(np.uint8)
    return composite(tint, bg)


def gen_lowcontrast(w: int, h: int):
    bg = gradient_bg(w, h, (120, 90, 70), (150, 120, 95), noise=3.0)
    m = blob_mask(w, h, w * 0.5, h * 0.5, w * 0.3, h * 0.35)
    fg = fg_from_mask(m, (135, 100, 80))
    return composite(fg, bg)


def gen_subject(w: int, h: int, fg_color=(70, 130, 190)):
    bg = gradient_bg(w, h)
    m = blob_mask(w, h, w * 0.5, h * 0.48, w * 0.24, h * 0.3)
    fg = fg_from_mask(m, fg_color)
    return composite(fg, bg)


def gen_grayscale(w: int, h: int):
    bg = gradient_bg(w, h, (110, 110, 110), (60, 60, 60), noise=4.0)
    m = blob_mask(w, h, w * 0.5, h * 0.5, w * 0.26, h * 0.32)
    fg = fg_from_mask(m, (200, 200, 200))
    out = composite(fg, bg)
    out[:, :, :3] = np.mean(out[:, :, :3], axis=2, keepdims=True)
    return out


FIXTURES = [
    ("synth-hair.png", gen_hair, 640, 480, "fine-structure", "binary", "hair strands and flyaway lines over gradient background"),
    ("synth-shapes.png", gen_shapes, 800, 600, "fine-structure", "binary", "spoked wheel and fence grid — thin structure retention"),
    ("synth-glass.png", gen_glass, 512, 512, "translucency", "alpha", "semi-transparent pane with hard frame — genuine alpha matte"),
    ("synth-lowcontrast.png", gen_lowcontrast, 512, 512, "difficult-composition", "binary", "subject and background in the same colour family"),
    ("synth-subject-wide.png", gen_subject, 1280, 320, "aspect-ratio", "binary", "wide panorama — aspect-preserving handling"),
    ("synth-subject-tall.png", gen_subject, 320, 1280, "aspect-ratio", "binary", "tall crop — aspect-preserving handling"),
    ("synth-subject-tiny.png", gen_subject, 96, 64, "input-edge-case", "binary", "tiny image"),
    ("synth-grayscale.png", gen_grayscale, 512, 512, "input-edge-case", "binary", "grayscale input"),
]

MANIFEST = {
    "schemaVersion": 1,
    "license": "CC0-1.0 (procedurally generated, no borrowed pixels)",
    "source": "scripts/bench/bgremove-reference/generate_fixtures.py",
    "seed": 20260813,
    "note": "Binary fixtures carry an exact 0/255 label; synth-glass.png carries a genuine soft alpha matte.",
    "fixtures": [],
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate synthetic bg-removal fixtures")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, gen, w, h, category, label_class, description in FIXTURES:
        rgba = gen(w, h)
        out = args.output_dir / name
        Image.fromarray(rgba.astype(np.uint8)).save(out)
        MANIFEST["fixtures"].append(
            {
                "id": name.replace(".png", ""),
                "file": name,
                "width": w,
                "height": h,
                "category": category,
                "labelClass": label_class,
                "description": description,
            }
        )
    manifest_path = args.output_dir / "synthetic-manifest.json"
    manifest_path.write_text(__import__("json").dumps(MANIFEST, indent=2))
    print(f"generated {len(FIXTURES)} fixtures in {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
