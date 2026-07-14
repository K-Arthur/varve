# Colour Management Architecture

## Colour Representation

The document model uses `ManagedColor` (a discriminated union with 4 variants) as the
canonical colour type for all fills, strokes, effects, gradient stops, swatches, and
canvas backgrounds:

- `RgbColor` (`space: 'rgb'`) — 0-255 RGBA, optional ICC profile id
- `CmykColor` (`space: 'cmyk'`) — 0-255 CMYKA, optional ICC profile id
- `GrayColor` (`space: 'gray'`) — 0-255 grayscale, optional ICC profile id
- `SpotColorRef` (`space: 'spot'`) — named ink with tint and process fallback

**Location:** `packages/scene/src/colorManagement.ts`

## Document Colour Configuration

Every `Document` carries a `colorConfig?: ColorConfig` with:
- `mode`: `'rgb' | 'cmyk' | 'grayscale'`
- `rgbProfile` / `cmykProfile`: ICC profile references
- `displayProfile?`: for soft proofing
- `outputIntent?`: for print export (PDF/X)
- `blackGeneration`: black generation settings

Built-in profile registries are defined in `colorManagement.ts` (RGB: sRGB, Display P3,
Adobe RGB, ProPhoto; CMYK: Fogra39, Fogra51, GRACoL 2006, SWOP Coated/Uncoated,
Japan Color 2011).

## Colour Conversion Pipeline

### Analytical (browser) path
All browser-side rendering converts CMYK/Gray/Spot → sRGB via analytical formulas
in `packages/shared/src/colorConversion.ts`:
- `managedColorToRgba()` — all spaces → RGBA tuple
- `managedColorToCss()` — all spaces → `rgba()` CSS string
- `rgbToCmyk()` / `cmykToRgb()` — analytical (no ICC profile)

### ICC-aware (Rust/desktop) path
The `strata-print` crate provides full ICC-aware CMYK conversion:
- `rgb_to_cmyk_icc()` — sRGB→linear→XYZ(D50)→Lab→CMYK with GCR/TAC
- 4 rendering intents, black point compensation
- Profile-specific GCR (Fogra39=0.35, Gracol=0.25, SWOP=0.30)
- Profile-specific TAC (Fogra39=300%, Gracol=320%, SWOP=300%)

### Colour Mode Switching
`switchColorMode()` in `packages/scene/src/colorMode.ts` converts all document colours
between RGB/CMYK/Grayscale. Uses 0-255 scale consistently. Preserves alpha and
profile fields. Also converts `canvasBackground`.

Wired into the editor context at `context.tsx` with undo/redo support.

## Deployment-Target Capability Tiers

| Capability | Desktop (Tauri/Rust) | Browser |
|---|---|---|
| ICC-aware CMYK conversion | Full (via strata-print, lopdf) | Analytical only (no ICC) |
| PDF/X-1a, PDF/X-4 export | Full (Rust strata-print) | Not available — stub only |
| Font outlining | Full (ab_glyph) | Not available |
| Native print pipeline | Yes (CUPS/system print) | No (window.print() only) |
| Soft proofing | Analytical preview | Analytical preview |
| UI disclosure | N/A | PDF export shows "Requires desktop app" |
