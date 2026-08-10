# Varve Brand Guide

## 1. Concept Statement

"Varve" is the plural of the Latin *stratum* ("a spread layer"), the dominant association being geological cross-sections — layered rock exposed at the surface, each band a distinct age and composition. This maps directly to the design-tool concept of *document layers*.

The mark shows **three parallelogram strata planes** all tilted in the same direction, each cascading 8 px to the right of the one above it. The consistent tilt reads as unified geological layering (not a list or alignment guide); the rightward cascade reads as depth and directionality — layers exposed progressively as you dig. The combined silhouette is a staircase, not a rectangle, making it immediately distinct at every size.

**Brand Colors:**
- Layer 1 (top): #39D0C6 (teal)
- Layer 2 (middle): #E28C3C (sandstone/orange)
- Layer 3 (bottom): #C54B3A (terracotta/red)

These three distinct colors represent the geological strata concept - each layer has its own identity while being part of a unified whole.

**Color Palette:**
- Teal: #39D0C6 (primary accent)
- Sandstone: #E28C3C (secondary accent)
- Terracotta: #C54B3A (tertiary accent)
- Neutral dark: #10151F (text, dark backgrounds)
- Neutral light: #f5f7fa (light backgrounds)

On dark backgrounds (#10151F) all three brand colors pass 3:1 contrast. On
light backgrounds (#f5f7fa) only terracotta passes 3:1; teal (1.8:1) and
sandstone (2.9:1) are below the WCAG threshold and are used as decorative
layers there — do not set text or essential UI in teal/sandstone on light
surfaces (see the contrast table in §4).

---

## 2. Critique of Previous Mark

| Issue | Old mark | New mark |
|---|---|---|
| Tilt direction | Alternating `/\` — reads as a zigzag / hamburger menu | Consistent `///` — reads as directional strata |
| Mono legibility | Colour-ramp was the only layer separator; all same fill → flat bars | Cascade geometry carries the layer reading; tonal greyscale is a bonus |
| Safe-zone | `rect x="0"` bled to canvas edge in hicolor app icon | All content within 20 px margin (15.6 %) |
| Symbolic format | 128 px viewBox, flat rects, `x=0` bleeding, `fill="#000000"` hardcoded | 16×16 viewBox, parallelogram shape, `fill="currentColor"` for GTK recolouring |
| Mark inconsistency | Three different geometries across files (4-bar rects, 3-bar rects, parallelograms) | One geometry — identical paths scaled across all files |
| Stacked lockup clipping | Oversized viewBox padding; text near edge | Viewbox cropped to content; 21 px verified clear-space between mark and text |

---

## 3. Construction Grid

**Canvas:** 128 × 128 px, unit `U = 8 px`

```
Layer 1 (surface):  M20,26 H84 L92,46 H28 Z
Layer 2 (mid):      M28,54 H92 L100,74 H36 Z   ← cascade +8px (= 1U) right
Layer 3 (deep):     M36,82 H100 L108,102 H44 Z  ← cascade +8px (= 1U) right
```

**Key property:** shear = cascade = 8 px, so the bottom-right corner of each layer shares the same x-coordinate as the top-right of the next layer. This produces two clean diagonal axes running through all three layers — the layers feel unified, not scattered.

**Content bounds:** x = [20, 108], y = [26, 102]  
**Margins:** 20 px left, 20 px right, 26 px top/bottom — well inside Apple squircle / Android maskable / PWA safe zones.

**App icon (1024 px master):** all coordinates × 8:
```
Layer 1: M160,208 H672 L736,368 H224 Z
Layer 2: M224,432 H736 L800,592 H288 Z
Layer 3: M288,656 H800 L864,816 H352 Z
```
Content bounds x = [160, 864], y = [208, 816] — inside the 80 % safe zone [102, 922].

**Optical-size variant (≤ 24 px — symbolic):** parallelogram form retained but drawn on a 16 × 16 grid:
```
M1,2 H8 L10,5 H3 Z   M3,7 H10 L12,10 H5 Z   M5,12 H12 L14,15 H7 Z
```
Same cascade-right direction; all within 16 × 16 bounds.

---

## 4. Colour Tokens & Rationale

The three brand colours map to geological depth. All three pass **≥ 3:1
contrast** against `#10151F` (dark), so the mark needs no dark-mode variant
of its own. On `#f5f7fa` (light) only terracotta reaches 3:1; teal and
sandstone are below threshold there and function as decorative layers only.

| Token | Hex | Role | Contrast on dark | Contrast on light |
|---|---|---|---|---|
| `--color-brand-teal` | `#39D0C6` | Surface layer / UI accent | 8.2 : 1 ✓ | 1.8 : 1 (decorative ✓) |
| `--color-brand-sandstone` | `#E28C3C` | Mid layer | 6.7 : 1 ✓ | 2.9 : 1 (decorative ✓) |
| `--color-brand-terracotta` | `#C54B3A` | Deep layer | 3.2 : 1 ✓ | 4.1 : 1 ✓ |
| `--color-text-primary` | `#10151F` | Wordmark (light bg) | — | — |
| `--color-surface-app` | `#F8FAFC` | Wordmark (dark bg) | — | — |

**Greyscale equivalents (mono variant):**  
Teal → `#878787` (lum 52.7 %), Sandstone → `#6B6B6B` (lum 42.2 %), Terracotta → `#313131` (lum 19.4 %)

**Why not all-warm?** A pure amber/sienna/umber palette was tested. The umber (#6E3020, lum 4.7 %) was nearly invisible on `#10151F` (1.5:1 contrast — failed). The current teal/sandstone/terracotta set is already in the design-system tokens and passes on both surfaces.

---

## 5. Lockup Specifications

### Horizontal wordmark (`varve-wordmark.svg`)
- **ViewBox:** `0 14 272 100` — crops 14 px top/bottom from the 128 px coordinate space, leaving 12 px breathing room above/below mark
- **Mark centre y:** 64 (in original coords) → 50 in viewport
- **Text baseline y:** 80 → 66 in viewport; cap-height top → 31 in viewport
- **Gap mark→text:** 26.6 px (≈ 0.75× cap-height) — tight, connected feel
- **Text right:** 270.14 px within 272 px ✓

### Stacked lockup (`varve-wordmark-stacked.svg`)
- **ViewBox:** `0 14 156 164`
- **Mark centred:** `translate(14,0)` → geometric centre x = 78; text centre x ≈ 78.4 ✓
- **Gap mark-bottom → text-cap:** 21 px (≈ 2.5 U)
- **Text baseline:** y = 158; no descenders in "Varve" ✓

### Clear-space rule
Minimum clear-space = **1× the height of the mark** (76 px at 128-px scale) on all four sides of the mark-only asset. For lockups, use the lockup bounding box.

### Minimum sizes
| Use | Minimum |
|---|---|
| Mark only (colour) | 24 × 24 px |
| Mark only (mono / symbolic) | 16 × 16 px |
| Horizontal lockup | 160 px wide |
| Stacked lockup | 80 px wide |

---

## 6. Gradient Variants

Two distinct gradient styles exist as named variants. Neither replaces the solid-colour lockups — they are supplemental for marketing and launch contexts.

### Per-layer gradients
Each layer renders a **diagonal linear gradient within its own colour family** (upper-left lighter → lower-right darker), following the shear direction of the parallelogram. The three colour identities stay visually distinct.

| Token | Light stop | Dark stop |
|---|---|---|
| Teal (Layer 1) | `#52D8CE` | `#2BADA3` |
| Sandstone (Layer 2) | `#EEA860` | `#C0702A` |
| Terracotta (Layer 3) | `#D46050` | `#A03030` |

Gradient coordinates use `gradientUnits="userSpaceOnUse"` pinned to each layer's upper-left → lower-right corner so the gradient tracks the shear exactly.

### Cross-mark gradient (sweep)
A **single diagonal gradient** sweeps teal → sandstone → terracotta across all three layers simultaneously, treating the whole mark as one unified form. Used exclusively in the on-black variants — the drama of the sweep reads better against dark fields.

| Stop | Colour |
|---|---|
| 0 % | `#39D0C6` |
| 50 % | `#E28C3C` |
| 100 % | `#C54B3A` |

---

## 7. Variant Matrix

| Variant | File | Background | Mark colours | Text |
|---|---|---|---|---|
| Full colour (light) | `varve-wordmark.svg` | Transparent | Teal/Sandstone/Terracotta flat | `#10151F` |
| Full colour (dark) | `varve-wordmark-dark.svg` | Transparent | Teal/Sandstone/Terracotta flat | `#F8FAFC` |
| Monochrome | `varve-wordmark-mono.svg` | Transparent | `#878787` / `#6B6B6B` / `#313131` | `#10151F` |
| Stacked (light) | `varve-wordmark-stacked.svg` | Transparent | Teal/Sandstone/Terracotta flat | `#10151F` |
| Mark only | `varve-icon.svg` | Transparent | Teal/Sandstone/Terracotta flat | — |
| App icon (light) | `varve-app-icon.svg` | `#FAFAF8` rounded-rect | Flat | — |
| App icon (dark) | `varve-app-icon-dark.svg` | `#0D0F14` rounded-rect | Cross-mark sweep | — |
| Symbolic (system) | `varve-icon-symbolic.svg` | Transparent | `currentColor` | — |
| Per-layer gradient — mark | `varve-icon-gradient.svg` | Transparent | Per-layer gradient | — |
| Per-layer gradient — horizontal | `varve-wordmark-gradient.svg` | Transparent | Per-layer gradient | `#10151F` |
| Per-layer gradient — stacked | `varve-wordmark-stacked-gradient.svg` | Transparent | Per-layer gradient | `#10151F` |
| On black — horizontal | `varve-wordmark-on-black.svg` | `#000000` | Cross-mark sweep | `#FFFFFF` |
| On black — stacked | `varve-wordmark-stacked-on-black.svg` | `#000000` | Cross-mark sweep | `#FFFFFF` |

---

## 8. Don'ts

- **Don't recolour** the three mark layers outside the three brand tokens.
- **Don't alternate** the tilt direction of the layers — the old `/\/` zig-zag was the specific failure being fixed.
- **Don't clip** the mark inside a rectangle that cuts the staircase silhouette.
- **Don't use live `<text>`** in distributed wordmarks — all text must be outlined paths.
- **Don't apply effects** (drop shadows, glows, gradients) outside the defined gradient variants — the depth is geometric.
- **Don't place** the terracotta layer on a background darker than `#10151F` without testing 3:1 contrast.
- **Don't squash or stretch** — the shear angle is load-bearing (shear ≠ cascade breaks the staircase).
- **Don't use the symbolic** in colour contexts — it's single-colour only by design.

---

## 9. Asset Locations

```
packages/ui/src/icons/
  varve-icon.svg                        ← master mark (no bg), flat colour
  varve-app-icon.svg                    ← 1024×1024 master with light bg (source for build)
  varve-app-icon-dark.svg               ← 1024×1024 master with dark bg, cross-sweep gradient
  varve-icon-symbolic.svg               ← 16×16 freedesktop symbolic, currentColor
  varve-wordmark.svg                    ← horizontal lockup (light bg, flat colour)
  varve-wordmark-dark.svg               ← horizontal lockup (dark text on transparent)
  varve-wordmark-mono.svg               ← monochrome lockup
  varve-wordmark-stacked.svg            ← stacked lockup (light bg, flat colour)
  varve-wordmark-only.svg               ← text paths only (no mark)
  varve-icon-gradient.svg               ← mark only, per-layer gradients
  varve-wordmark-gradient.svg           ← horizontal lockup, per-layer gradients
  varve-wordmark-stacked-gradient.svg   ← stacked lockup, per-layer gradients
  varve-wordmark-on-black.svg           ← horizontal lockup, #000 bg, cross-sweep gradient
  varve-wordmark-stacked-on-black.svg   ← stacked lockup, #000 bg, cross-sweep gradient
  _backup_2026-06-30/                    ← originals before this rework

apps/desktop/src-tauri/icons/
  strata.svg                        ← mark + bg (Tauri window icon; filename retained from the pre-rename era)
  strata-icon.svg                   ← mark only (filename retained)
  icon.icns / icon.ico / *.png      ← generated by build-icons.sh
  hicolor/scalable/apps/dev.varve.desktop.svg
  hicolor/symbolic/apps/dev.varve.desktop-symbolic.svg
  hicolor/{16,22,24,32,48,64,96,128,256,512,1024}x*/apps/dev.varve.desktop.png

apps/desktop/public/icons/
  varve-icon.svg
  favicon.ico / favicon.svg
  apple-touch-icon.png               ← 180×180
  icon-192.png / icon-512.png        ← PWA standard
  icon-maskable-192.png / icon-maskable-512.png  ← PWA maskable
```

**Build command** (regenerates all platform PNGs, `.icns`, `.ico`, web favicons from **`varve-app-icon.svg` only**):
```bash
just generate-icons
# equivalent: bash apps/desktop/build-icons.sh
```
Requires: `rsvg-convert` (librsvg), `magick` (ImageMagick ≥ 7), Tauri CLI in `apps/desktop/node_modules/.bin/tauri`.

**Do not** use `varve-icon.svg` (mark-only) for OS launcher / taskbar / dock icons — that skips the app-icon plate. Mark SVGs are for in-app chrome and favicons only.

**Linux Wayland / KDE (`tauri:dev`):** after generating icons, install the FreeDesktop identity locally:
```bash
just install-dev-icons
```
This installs `~/.local/share/applications/dev.varve.desktop.desktop` + hicolor icons so Plasma resolves the Varve icon instead of the Wayland logo.
