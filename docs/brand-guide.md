# Strata Brand Guide

## Concept & Critique
The previous Strata logo relied on a literal interpretation of "layers": a stack of teal rectangles. While this loosely communicated "layers," it failed fundamentally as a brand mark:
1. **Lack of distinctiveness:** The stacked horizontal lines perfectly mirrored common "Align Left" or "List" UI icons. 
2. **Monochrome collapse:** The previous icon relied entirely on a color ramp to communicate depth. In a single-color context (like a macOS menu bar or Linux symbolic theme), it lost all meaning.
3. **Cool-toned similarity:** The teal palette matched incumbents like Figma, Canva, and Penpot without offering an ownable alternative.

**The New Concept: The Geologic 'S'**
Strata's meaning ("geological layers") maps perfectly to design tools. The new mark embraces this by layering three 45-degree offset bands. These angled bands interlock dynamically to form a powerful, geometric "S" in the negative space and overall outline. 
- **Monochrome Strength:** The 8px negative space gaps are baked into the geometry. The "S" and the layered depth remain 100% visible and striking even in pure black or pure white.
- **Dimensionality:** The alternating offset of the bands creates an illusion of three-dimensional stacked layers.

## Construction & Grid
- **Master Grid:** 128x128 bounding box.
- **Safe Zone:** The mark fits entirely within a 96x88 box centered at (64, 64). There is a minimum 16px safe zone on all edges, strictly adhering to Apple HIG squircle masks, Android adaptive icons, and PWA maskable boundaries. No elements bleed out.
- **Optical Sizes:** 
  - **Base (128+):** 3 bands, 24px height, 8px gaps.
  - **Symbolic (16px):** Purpose-built variant snapped directly to the 16x16 pixel grid. Bands are 3px tall with 1px gaps, ensuring razor-sharp rendering on Linux top bars and small UI surfaces.

## Color Tokens & Rationale
We have intentionally shifted the brand colors away from the "default framework blue/teal" of incumbents, aligning deeply with the literal meaning of "Strata"—the earth. We paired warm sedimentary tones with our existing crisp UI teal.

* **Layer 1 (Top):** Crisp Teal (`#39D0C6`) — Ties the brand mark seamlessly to our UI token accent, representing the "digital" or sky/water layer.
* **Layer 2 (Middle):** Sandstone (`#E28C3C`) — A warm ochre providing high contrast and representing middle earth strata.
* **Layer 3 (Bottom):** Deep Terracotta (`#C54B3A`) — A grounded, rich red-clay base.
* **Text (Light Theme):** Deep Slate (`#10151F`)
* **Text (Dark Theme):** Cloud (`#F8FAFC`)

## Usage Rules & Don'ts
* **DO** use the monochrome (`strata-wordmark-mono.svg`) version when placing on busy backgrounds or within colored banners.
* **DO** respect the clear space. The built-in SVGs have correct bounding boxes.
* **DON'T** recolor the layers outside of the established tokens.
* **DON'T** squash or stretch the logo.
* **DON'T** type out "Strata" next to the logo in a fallback font. Always use the provided vector wordmarks which have text converted to outlines.
* **DON'T** apply drop shadows to the logo mark; the depth is already established by the geometry.

## Asset Deliverables
The complete ladder of assets is managed deterministically via `build_logo.js`.
* **Core SVGs:** `packages/ui/src/icons/`
* **Desktop Assets:** `apps/desktop/src-tauri/icons/` (.icns, .ico, PNG ladder, Windows Tiles, Linux Hicolor hierarchy)
* **Web Assets:** `apps/desktop/public/icons/` (apple-touch, favicons, maskable PWA icons)
* **Symbolic:** `strata-icon-symbolic.svg` conforms to freedesktop conventions (single path, 16px, recolorable).