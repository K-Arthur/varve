#!/usr/bin/env python3
"""
Deterministic degradation + fixture generation for the restore corpus.

Every recipe records its parameters so a run is reproducible; seeds are
fixed. The corpus is license-safe: everything is generated from code or
ships in the repository (tests/fixtures).

Recipes: JPEG (quality, subsampling, repeat), Gaussian noise (sigma, seed),
motion blur (length, angle, seed). Outputs go to the fixtures dir as
`<stem>--<recipe>.png` beside the clean source.
"""

import io
import sys
from pathlib import Path

import cv2
import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
CORPUS_DIR = REPO_ROOT / "tests/fixtures" / "restore-corpus"


def jpeg_deg(img_bgr, quality, subsampling=1, repeat=1):
    from PIL import Image
    img = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    for _ in range(repeat):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, subsampling=subsampling)
        img = Image.open(buf).convert("RGB")
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def gaussian_noise(img_bgr, sigma, seed):
    rng = np.random.default_rng(seed)
    return np.clip(
        img_bgr.astype(np.float32) + rng.normal(0, sigma, img_bgr.shape), 0, 255
    ).round().astype(np.uint8)


def motion_blur(img_bgr, length, angle, seed):
    rng = np.random.default_rng(seed)
    kernel = np.zeros((length, length), np.float32)
    import math
    cx, cy = length // 2, length // 2
    rad = math.radians(angle)
    for i in range(length):
        x = int(cx + math.cos(rad) * (i - cx))
        y = int(cy + math.sin(rad) * (i - cy))
        if 0 <= x < length and 0 <= y < length:
            kernel[y, x] = 1.0
    kernel /= max(1.0, kernel.sum())
    blurred = cv2.filter2D(img_bgr, -1, kernel)
    return np.clip(blurred, 0, 255).round().astype(np.uint8)


def generate_synthetic_fixtures():
    """Design-app fixtures generated from code (license-safe)."""
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    h, w = 384, 512

    img = np.full((h, w, 3), 245, np.uint8)
    for i, t in enumerate(["Varve Design Suite", "Denoise Deblur Deblock", "ENHANCE 2026"]):
        cv2.putText(
            img, t, (24, 60 + i * 70), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (20, 20, 20), 2,
            cv2.LINE_AA,
        )
    cv2.putText(img, "1px thin line detail:", (24, 300), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                (0, 0, 0), 1, cv2.LINE_AA)
    img[310, :] = 0
    img[:, 24] = 0
    cv2.imwrite(str(CORPUS_DIR / "text-heavy.png"), img)

    img2 = np.full((h, w, 3), 255, np.uint8)
    cv2.rectangle(img2, (40, 40), (200, 200), (20, 90, 220), -1)
    cv2.circle(img2, (360, 120), 60, (220, 60, 40), -1)
    cv2.rectangle(img2, (60, 250), (450, 260), (30, 30, 30), -1)
    cv2.imwrite(str(CORPUS_DIR / "logo-flat.png"), img2)

    yy, xx = np.mgrid[0:h, 0:w]
    grad = np.stack(
        [(xx / w * 255).astype(np.uint8), (yy / h * 255).astype(np.uint8),
         (((xx + yy) / (w + h)) * 255).astype(np.uint8)],
        axis=2,
    )
    cv2.imwrite(str(CORPUS_DIR / "gradient.png"), grad)

    p = np.full((h, w, 3), 255, np.uint8)
    for x in range(0, w, 4):
        if (x // 4) % 3 != 1:
            p[:, x] = 0
    cv2.imwrite(str(CORPUS_DIR / "thin-lines.png"), p)

    ui = np.full((h, w, 3), 240, np.uint8)
    cv2.rectangle(ui, (20, 20), (w - 20, 120), (255, 255, 255), -1)
    for i in range(3):
        cv2.rectangle(ui, (40, 40 + i * 30), (180, 60 + i * 30), (210, 210, 215), -1)
        cv2.putText(ui, f"Button {i + 1}", (50, 56 + i * 30), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (40, 40, 40), 1, cv2.LINE_AA)
    cv2.putText(ui, "Unsaved changes", (220, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                (180, 60, 40), 1, cv2.LINE_AA)
    cv2.imwrite(str(CORPUS_DIR / "ui-screenshot.png"), ui)

    # Pixel-art-like blocky content (must not be routed through photo models).
    pa = np.zeros((h, w, 3), np.uint8)
    for by in range(0, h, 16):
        for bx in range(0, w, 16):
            v = (bx // 16 + by // 16) % 3
            pa[by:by + 16, bx:bx + 16] = [(60, 40, 200), (240, 240, 240), (30, 180, 90)][v]
    cv2.imwrite(str(CORPUS_DIR / "pixel-art.png"), pa)


def copy_repo_photos():
    for name in ("human", "cat"):
        src = REPO_ROOT / "tests/fixtures/bg-removal-corpus" / f"{name}.jpg"
        if src.exists():
            import shutil
            shutil.copy(src, CORPUS_DIR / f"photo-{name}.jpg")


def list_fixtures(fixtures_dir=CORPUS_DIR):
    return sorted(
        p
        for p in Path(fixtures_dir).glob("*")
        if p.suffix.lower() in (".png", ".jpg") and "--" not in p.name
    )


def generate_degradations(fixtures_dir=CORPUS_DIR):
    for fixture in list_fixtures(fixtures_dir):
        gt = cv2.imread(str(fixture), cv2.IMREAD_COLOR)
        if gt is None:
            continue
        for recipe, degraded in [
            ("jpeg-q60", jpeg_deg(gt, 60)),
            ("jpeg-q30", jpeg_deg(gt, 30)),
            ("jpeg-q20", jpeg_deg(gt, 20)),
            ("gauss-sigma15", gaussian_noise(gt, 15, 3)),
            ("gauss-sigma35", gaussian_noise(gt, 35, 4)),
            ("motion-12px", motion_blur(gt, 12, 30, 5)),
        ]:
            out = Path(fixtures_dir) / f"{fixture.stem}--{recipe}.png"
            cv2.imwrite(str(out), degraded)


if __name__ == "__main__":
    generate_synthetic_fixtures()
    copy_repo_photos()
    generate_degradations()
    print(f"corpus ready in {CORPUS_DIR}")
