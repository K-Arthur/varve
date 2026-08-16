# Varve Brand Guide (v1.0 — SUPERSEDED)

> **Status: SUPERSEDED.** This is the v1.0 guide (last updated 2026-06-30,
> the date of the mark rework; the pre-rework originals that lived in
> `packages/ui/src/icons/_backup_2026-06-30/` were removed on 2026-08-16 and
> remain recoverable from git history). It describes the **pre-rework
> mark: four horizontal bands in the teal ramp with alternating offsets**,
> which is no longer the shipped brand.
>
> **Current guidance:** [docs/brand-guide.md](../brand-guide.md) — the
> shipped mark is three parallelogram layers (teal `#39D0C6`, sandstone
> `#E28C3C`, terracotta `#C54B3A`) with a consistent cascading tilt. Asset
> files are named `varve-wordmark*.svg` (the `strata-wordmark*.svg` names
> cited below exist only in the backup directory).
>
> Retained as a historical record of the v1.0 identity; do not use its
> specifications to build or judge current assets.

## Concept Statement

Varve means layers — literally, the plural of the Latin *stratum* ("a covering, a
layer," from PIE root *stere-* "to spread"). In geology, strata are the
sedimentary bands that record time, accumulation, and structure — older at the
bottom, newer at the top. In a design tool, the central organizational concept is
layers. The Varve mark makes this double meaning tangible: four horizontal bands
in the teal ramp, alternating offset like a geological cross-section, readable as
both *stratified rock* and *stacked layers in a design document*. The mark is not
a generic geometric shape — it is a distillation of what the product *is*:
layered, precise, structural, built up over time.

**Colour rationale:** The icon uses the teal ramp exclusively (steps 5–8),
anchoring the brand in the existing token system (ADR-0002). Teal has no major
design-tool association (unlike blue: Adobe, Linear, Penpot, Canva), reads as
"creative AND technical," and is contractually WCAG 2.2 AA across all three
themes. The warm light background (`--color-surface-app`, `#f5f7fa`)
differentiates Varve from the dark-square convention of nearly every competitor
dock icon.

---

## Construction Grid

The master mark is built on a 128×128 viewBox with the following geometry:

```
           ┌──────────────────────────────────────┐
           │                                      │
    ┌──────┤  Band 1  (teal-5, x=16, w=96)       │   y=26, h=16
    │      └──────────────────────────────────────┤
    ├─────────────────────────────────────────┐   │
    │  Band 2  (teal-6, x=0, w=108)          │   │   y=46, h=16
    └─────────────────────────────────────────┘   │
    ┌──────┐┌────────────────────────────────────┐ │
    │      │  Band 3  (teal-7, x=16, w=96)       │   y=66, h=16
    │      └──────────────────────────────────────┤
    ├─────────────────────────────────────────┐   │
    │  Band 4  (teal-8, x=0, w=108)          │   │   y=86, h=16
    └─────────────────────────────────────────┘   │
           │                                      │
           └──────────────────────────────────────┘
```

- **4 bands**, each 16px tall, 4px gap between
- **Alternating offsets:** bands 1 and 3 are inset 16px from left (14px margin on each side); bands 2 and 4 are left-aligned
- **Corner radius:** 2px on all bands (drops to imperceptible sub-pixel at ≤24px)
- **Total mark height:** 76px; vertically centred in 128px viewBox at y=26
- **Safe zone:** all content within inner 80% (102.4px) — no platform mask will clip the mark
- **Font:** "Varve" wordmark set in Geist Variable (--font-display), weight 600 (semibold), letter-spacing -0.03em

---

## Color Tokens

| Token | Value (hex) | Usage |
|---|---|---|
| `--color-accent-primary` | `#39d0c6` | Primary brand accent, mark band 2 |
| `--color-accent-default` | `#39d0c6` | Text on accent backgrounds |
| `--color-accent-teal` | `#39d0c6` | Codegen syntax highlighting, accent references |
| `--color-accent-subtle` | `#c7f4ee` (light) / `#0e3a39` (dark) / `#505050` (HC) | Subtle accent backgrounds |
| Band 1 (top) | `#52d1c5` (teal-5) | Lightest layer |
| Band 2 | `#39d0c6` (teal-6) | Accent layer |
| Band 3 | `#26a69e` (teal-7) | Mid-tone layer |
| Band 4 (bottom) | `#1d807b` (teal-8) | Darkest layer |
| Background (light) | `#f5f7fa` (neutral-2) | Light theme app icon bg |

All colour values are sRGB/linear. Themes: Light (default), Dark (`[data-theme="dark"]`), High-Contrast (`[data-theme="high-contrast"]`). See `packages/ui/src/tokens/color.ts` for the full 12-step ramps.

---

## Variant Matrix

| Variant | Mark | Wordmark | Lockups | Source File |
|---|---|---|---|---|
| Full colour | ✓ | ✓ | Horizontal, stacked | `packages/ui/src/icons/varve-icon.svg` |
| Inverted (dark bg) | ✓ | ✓ | Horizontal, stacked | `strata-wordmark-dark.svg` |
| Monochrome/symbolic | ✓ | ✓ | Horizontal | `varve-icon-symbolic.svg`, `strata-wordmark-mono.svg` |
| App icon (light bg) | ✓ | — | — | `varve-app-icon.svg` |
| Wordmark only | — | ✓ | — | `strata-wordmark-only.svg` |

---

## Clear-Space & Minimum-Size Rules

- **Clear space:** minimum 1× band height (16px @ 128px viewBox) around the mark on all sides
- **Minimum mark size:** 16px (the mark remains legible — 4 bands × 2px with 2px visible offset)
- **Minimum wordmark size:** "Varve" should never be rendered smaller than 10px cap height
- **Minimum horizontal lockup:** mark (16px) + wordmark (proportional) = 48px total width
- **Minimum stacked lockup:** mark (16px) + wordmark (proportional) = 16px total height

---

## Correct Usage

- Use the full-colour mark on light/neutral backgrounds for maximum brand recognition
- Use the inverted/white wordmark on dark backgrounds
- Use the monochrome/symbolic variant for single-colour contexts (menu icons, tray icons, Linux symbolic themes)
- Always maintain the aspect ratio and proportional spacing of the lockup
- Ensure sufficient contrast: the mark on any background should have ≥3:1 contrast ratio for UI elements
- For PWA maskable icons, the mark sits within the 40% radius safe zone — no clipping occurs

---

## Don'ts

- **Don't recolour** the bands outside the teal ramp (steps 5–8). The teal-to-deeper-teal gradient is the brand signature.
- **Don't add effects:** no drop shadows, gradients across bands, glows, outlines, filters, or 3D extrusion. The mark is intentionally flat.
- **Don't squash or stretch:** always maintain the 1:1 square aspect ratio for app icons and exact proportions for lockups.
- **Don't place on low-contrast backgrounds:** avoid mid-tone backgrounds that match the teal value. Use light (`#f5f7fa` or lighter) or dark (`#1e2532` or darker) backgrounds.
- **Don't rearrange the offset pattern:** the alternating left-right offset is structural. Inverting the order or centering all bands breaks the "strata" reading.
- **Don't substitute fonts:** the wordmark must use Geist Variable (weight 600). No other typeface.
- **Don't use emoji** anywhere in the brand system (§4.4). All icons are Lucide or the Varve SVGs.

---

## Asset Map

| File | Purpose |
|---|---|
| `packages/ui/src/icons/varve-icon.svg` | Master full-colour mark (transparent bg) |
| `packages/ui/src/icons/varve-icon-symbolic.svg` | Monochrome symbolic mark (Linux) |
| `packages/ui/src/icons/varve-app-icon.svg` | Full-colour app icon with light bg |
| `packages/ui/src/icons/varve-app-icon-dark.svg` | Full-colour app icon with dark bg |
| `packages/ui/src/icons/varve-icon-gradient.svg` | Mark only, per-layer gradients |
| `packages/ui/src/icons/strata-wordmark*.svg` | Wordmark lockups (legacy file names, kept) |
| `apps/desktop/public/icons/favicon.svg` | Web-served SVG icon (mark) |
| `apps/desktop/public/icons/icon-192.png` | PWA icon (192, any purpose) |
| `apps/desktop/public/icons/icon-512.png` | PWA icon (512, any purpose) |
| `apps/desktop/public/icons/icon-192-maskable.png` | PWA maskable icon (192) |
| `apps/desktop/public/icons/icon-512-maskable.png` | PWA maskable icon (512) |
| `apps/desktop/public/icons/apple-touch-icon.png` | Apple Touch icon (180) |
| `apps/desktop/src-tauri/icons/icon.ico` | Windows .ico (16–256) |
| `apps/desktop/src-tauri/icons/icon.icns` | macOS .icns (all sizes) |
| `apps/desktop/src-tauri/icons/icon.png` | Tauri app icon (512) |
| `apps/desktop/src-tauri/icons/32x32.png` | Tauri 32×32 icon |
| `apps/desktop/src-tauri/icons/64x64.png` | Tauri 64×64 icon |
| `apps/desktop/src-tauri/icons/128x128.png` | Tauri 128×128 icon |
| `apps/desktop/src-tauri/icons/128x128@2x.png` | Tauri 256×256 icon (macOS retina) |
| `apps/desktop/src-tauri/icons/256x256.png` | 256×256 PNG |
| `apps/desktop/src-tauri/icons/512x512.png` | 512×512 PNG |
| `apps/desktop/src-tauri/icons/hicolor/` | Linux hicolor tree (10 sizes + scalable + symbolic) |
| `apps/desktop/src-tauri/icons/AppList/` | Windows AppList targetsize PNGs |
| `apps/desktop/src-tauri/icons/Square*.png` | Windows tile assets |
| `apps/desktop/src-tauri/icons/StoreLogo.png` | Windows Store logo |
| `scripts/generate-icons.sh` | Deterministic build script |
| `apps/desktop/public/manifest.json` | PWA web manifest |
| `docs/brand/varve-brand-guide.md` | This document (superseded — see the status banner at the top) |

---

## Generation

All platform assets are generated from the master SVGs via:

```bash
just generate-icons
```

Requirements: `rsvg-convert` (librsvg), `magick` (ImageMagick 7), `python3`.
The script reads `packages/ui/src/icons/varve-app-icon.svg` and produces the
complete platform set deterministically.

---

*Varve Brand Guide v1.0 — Last updated 2026-06-30*
*Accent: teal #39d0c6 | Display font: Geist Variable | Body font: IBM Plex Sans Variable*
