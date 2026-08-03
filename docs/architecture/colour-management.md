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

## Picker Workflow (2026-08-02 decisions)

The color picker (`packages/ui/src/components/ColorPicker/`) is a display layer
over the canonical `ManagedColor` model. The following rules keep the picker,
scene, renderer, undo history, and export pipeline synchronized:

### Authoring space — display mode never changes storage
Switching the picker between RGB/CMYK/Gray/Spot views is **display-only**:
no `onChange` is emitted and the stored color is untouched. Edits are stored
in the color's **native space** (a CMYK value stays CMYK when edited in RGB
view), except RGB values in CMYK/grayscale documents, which are authored in
the document working space (intentional document-level conversion). Naive
analytical CMYK is therefore never stored for an RGB document merely because
the user looked at CMYK fields.

### Conversion and profile policy
- Display conversions (CMYK↔RGB in the picker) are analytical and explicitly
  labeled: converted values show "Approximate conversion for <profile>" with
  the active document CMYK profile; native CMYK values show their profile.
- CMYK-mode documents tag newly authored CMYK values with the document
  working profile id so print intent survives in the data model.
- ICC-managed conversion stays in `strata-colour`/`strata-print` (PDF/X
  export, raster conversion). The picker never claims analytical output is
  color-managed.

### Precision and alpha
- Channels and alpha are bit-depth aware: float16/float32 documents show
  normalized alpha and emit without uint8 quantization.
- Alpha is preserved across mode switches and field edits. Hex entry follows
  one rule: `#RRGGBB` / `#RGB` keep the current alpha; `#RRGGBBAA` / `#RGBA`
  set it.
- Draft HSV state resyncs when the value changes externally (undo, redo,
  selection change, gradient-stop switch) but never fights the user's own
  drags (self-echo detection via `managedColorKey`).

### Undo grouping
A continuous pointer gesture inside the picker (2D area, hue, alpha slider)
is wrapped in `beginTransaction`/`commitTransaction` via
`onInteractionStart`/`onInteractionEnd`, producing exactly one undo entry per
gesture. Keyboard edits commit per keypress. Mode switches and open/close
produce no history. Empty transactions are suppressed by reference identity.

### Swatches and recent colors
- Document Colors: extracted from the open document's fills/strokes,
  deduplicated by canonical key, capped at 32, **snapshotted at open time**
  (the walk is O(nodes); refreshing per drag event is avoided).
- Recent Colors: session-backed (`strata:recent-colors`), capped at 16,
  recorded on dismissal of a committed edit only — never per preview event.
- Swatch selection re-enters the authoring-space rule, so native space
  identity is re-established on selection.

### Hex input
Supports `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, with or without the leading
`#`, case-insensitive, whitespace tolerated. Invalid input shows an inline
validated error (`role=status`, `aria-invalid`) and never corrupts the
document color; empty blurs are no-ops.

### Target resolution
The popover binds to the property at open time via its `onChange` closure
(fill index, stroke index, gradient stop, effect index). If the selection
changes while open, edits follow the new compatible selection (Figma-like
retargeting); the draft-sync rule above keeps the visible controls honest.
`onEditStart`/`onEditEnd` are passed through from inspector sections that own
transaction hooks (fill, stroke, effects, text span, adaptive contrast,
canvas background, settings, gradient, gradient-map, and adjustment editors).

### CMYK profile context
`InspectorColorPopover` reads the document `colorConfig.cmykProfile` via a
safe provider lookup and passes it to the picker, which displays the profile
name and labels converted values as approximate. Standalone renders fall
back to no profile.

### Gamut warning
`GamutWarning` is a heuristic (HSV thresholds + process-color allowlist), not
profile-based. It is intentionally conservative: pure process colors and
dark/desaturated colors are never flagged. It is a UX fallback, not a
colorimetric assertion — see the ICC path above for profile-truthful checks.

### Known limitations
- Document-level `switchColorMode` still uses analytical conversion
  (`scene/src/colorMode.ts`); profile-managed conversion is applied at
  print/export time. Converting an RGB document to CMYK mode reinterprets
  values analytically and is labeled accordingly in the picker.
- Per-run text color (`CharacterFormat.color`) remains a legacy RGBA tuple
  while node-level text fill is `ManagedColor`.
- Spot colors are identity-preserving in the model (name/tint/fallback) but
  the picker exposes only the bundled browser; library-backed spot color
  authoring is future work.
