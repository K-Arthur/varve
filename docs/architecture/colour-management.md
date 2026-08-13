# Colour Management Architecture

## Colour Representation

The canonical document value is distinct from every render or export surface.
See the [quantization-boundary inventory](../audits/color-quantization-boundary-inventory.md)
for the current audit and the remaining precision leaks. In particular,
`managedColorToRgba()` is an explicit RGBA8 display adapter; it is not a safe
working-space representation for gradients, effects, proofing, or document
edits.

The document model uses `ManagedColor` (an eight-variant discriminated union) as the
canonical colour type for all fills, strokes, effects, gradient stops, swatches, and
canvas backgrounds:

- `RgbColor` (`space: 'rgb'`) — bit-depth-scaled RGBA, optional ICC profile id
- `CmykColor` (`space: 'cmyk'`) — bit-depth-scaled CMYKA, optional ICC profile id
- `GrayColor` (`space: 'gray'`) — bit-depth-scaled grayscale, optional ICC profile id
- `SpotColorRef` (`space: 'spot'`) — named ink with tint and process fallback
- `LabColor` / `LchColor` — float-valued authoring spaces with bit-depth-scaled alpha
- `RegistrationColor` — all-plates registration ink
- `UnresolvedColor` — retained source plus display-only fallback

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

### Working precision and display precision

`managedColorToNormalized()` is the working-space adapter. It reads the
tagged channels directly, including uint16 and float channels, and produces a
normalized floating-point encoded-sRGB value without passing through RGBA8.
`managedColorToRgba()` remains available for explicit display/legacy API
boundaries only.

Gradient interpolation has the same split: the working path retains
fractional channels through stop normalization and interpolation, then the
Canvas2D adapter formats the result as a CSS gradient stop. Canvas2D is still a
display surface and cannot prove document precision; the source `ManagedColor`
and the engine IR remain authoritative.

Effect parameters follow the same rule. Color-bearing effect inputs are
normalized from their tagged model before entering a display-only `ImageData`
pass. The current backdrop/effect surface is still RGBA8, so it is documented
as a preview boundary rather than claimed as a high-precision effect surface.

Soft proofing accepts both the legacy RGBA8 provider and an optional normalized
provider. The editor prefers the normalized provider when the runtime offers
one, and falls back to the legacy provider only as an explicit preview
degradation. Neither path writes proofed values back to the document.

### Typed raster working buffers

Raster code must carry a `PixelBufferDescriptor` alongside its storage. The
engine allocator now provides the following explicit mappings:

| Format | Storage | Channel range |
| --- | --- | --- |
| `rgba8` | `Uint8Array` | 0–255 integer |
| `rgba16` | `Uint16Array` | 0–65535 integer |
| `rgba16f` | packed IEEE-754 half floats in `Uint16Array` | normalized working values |
| `rgba32f` | `Float32Array` | normalized working values |

`allocatePixelBuffer()` rejects invalid dimensions and enforces a default
512 MiB byte budget. Format, color encoding, and alpha mode remain metadata;
they are not inferred from the typed array. Half-float conversion helpers are
explicit and tested, including negative and fractional values. Browser
`ImageData` and the current Canvas2D effect surface remain deliberate RGBA8
preview boundaries; they must not be used as the document or working-buffer
storage contract.

### Analytical (browser) path
All browser-side rendering converts CMYK/Gray/Spot → sRGB via analytical formulas
in `packages/shared/src/colorConversion.ts`:
- `managedColorToRgba()` — all spaces → RGBA tuple
- `managedColorToCss()` — all spaces → `rgba()` CSS string
- `rgbToCmyk()` / `cmykToRgb()` — analytical (no ICC profile)

### ICC-aware (Rust/desktop) path
The `varve-print` crate provides full ICC-aware CMYK conversion:
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
| ICC-aware CMYK conversion | Full (via varve-print, lopdf) | Analytical only (no ICC) |
| PDF/X-1a, PDF/X-4 export | Full (Rust varve-print) | Not available — stub only |
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
- ICC-managed conversion stays in `varve-colour`/`varve-print` (PDF/X
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
When a proof configuration with a registered profile converter is active,
the picker replaces the heuristic with proof-condition gamut status
(`isColorOutOfProofGamut`); when no converter is registered it reports the
limitation instead of claiming a result.

## Colour-Mode Semantics (2026-08-03)

`switchColorMode` historically conflated two operations. It is deprecated and
delegates to the conversion operation; new callers use the explicit pair:

- **`assignDocumentColorMode(doc, mode)`** — changes `colorConfig.mode` only.
  Stored values keep their space and are reinterpreted under the new mode at
  read boundaries (render/export). Non-destructive to values; may change
  appearance. The DocumentPanel mode buttons use this and explain it.
- **`convertDocumentColors(doc, mode, opts)`** — rewrites stored process
  colors (fills, strokes, effects, gradient stops, swatches, canvas
  background) into the target mode and returns a structured report
  (converted / spotsPreserved / unsupported / warnings). Spot, registration,
  and unresolved colors are never rewritten. The `analytical` algorithm is
  reported as approximate; `icc` requires a runtime converter and is refused
  honestly with an `icc-unavailable` warning when none is supplied.

The ColorConversionDialog offers distinct **Assign mode** and **Convert
colors** actions. Conversion is one undo transaction.

## Managed Color Model (2026-08-03)

`ManagedColor` (schema 2.14) is an eight-variant tagged union:

- `rgb` / `cmyk` / `gray` — process colors, `bitDepth`-scaled channels,
  optional `profile` id + `profileFingerprint`.
- `lab` / `lch` — float channels (L 0–100; a/b signed; C ≥ 0; hue degrees,
  wrapped to [0, 360)); `a` is alpha (bit-depth scaled) on every member;
  the Lab a-channel is stored as `av`.
- `spot` — stable `spotId`/`library` identity (name is a display copy);
  tint stored on the ref, never duplicated as fake swatches.
- `registration` — prints on every plate; rendered black on screen.
- `unresolved` — imported value with retained `source` and display-only
  `fallback`; never silently reinterpreted.

Invariants are enforced centrally in `packages/scene/src/colorValidation.ts`
(NaN/Infinity rejection, hue wrapping, non-negative chroma, tint bounds,
alpha finitude, tolerance-aware equality). Lab/LCH values may be outside the
display gamut: previews clip, authoritative values are never clamped.

### Text colour
`CharacterFormat.color` and `ParagraphFormat.columnRuleColor` are
`ManagedColor` since schema 2.14 (migration in `colorMigration.ts`: legacy
`[r,g,b,a]` sRGB tuples converted at load, alpha preserved, no profile
attached, idempotent, never dependent on installed profiles). Text rendering
uses the same conversion path as node fills (`managedColorToRgba`); the
layout pipeline carries run color through to the renderer (previously it was
dropped when runs split into words).

### Soft proofing
Proof CONFIG (`Document.proofConfig`) is document state: profile, rendering
intent, black-point compensation, paper/ink simulation, gamut-warning prefs.
The proof TOGGLE is session state and never persists into portable
documents. The transform is display-only (`applyProofToRgba` in shared):
`icc` with a runtime-registered profile converter, `unavailable` otherwise —
browser canvases have no monitor-profile hook, so the UI discloses the
limitation rather than faking a proofed preview. The canvas applies the
proof to the IR frame (fills, gradient stops, strokes, effects, text run
colors) inside the render worker; exports never pass through it.

### Spot libraries
`Document.spotLibraries` (builtin / user-global / project / imported) with
stable ids. Operations in `packages/scene/src/spotLibraries.ts`: library
CRUD, spot add/update/remove, deterministic import conflict resolution
(id-based, name collisions keep distinct inks), search, tint preview.
`stabilizeSpotRef` embeds unknown inks as project definitions so imported
artwork stays visible. Missing external libraries never destroy embedded
definitions.

### Known limitations
- Browser analytical conversion is approximate and labeled as such;
  profile-accurate conversion requires the desktop ICC engine.
- Accurate monitor-profile soft proofing is unavailable in browser canvases
  — the proof transform reports `unavailable` and UIs disclose it.
- PDF spot (Separation/DeviceN) export is deferred until `varve-print`
  supports it; unsupported formats must warn before converting spots to
  process colors.
- Registration color renders as black on screen (all plates).

## Raster Colour Management (ADR-0217, 2026-08-09)

Raster pixels get the same discipline vector colours already have: a canonical
encoding on every source and explicit, separate assign-vs-convert operations.
See [image-lifecycle.md](image-lifecycle.md) for the container precedence
table and [ADR-0217](../adr/0217-raster-colour-management.md) for the decision
record.

### Pipeline

```text
ENCODED IMAGE (PNG/JPEG/WebP/TIFF/AVIF)
  -> metadata inspection (iCCP/APP2/ICCP/34675/colr, EXIF, cHRM/gAMA, CICP)
  -> DocumentAsset.metadata.colorEncoding (primaries/transfer/precision/provenance)
     + Document.iccProfiles (content-addressed profile bytes, header info)
  -> browser decode (display: sRGB baseline, orientation-normalized)
  -> export colour policy (sRGB default | display-p3 | adobe-rgb | pro-photo)
     analytic conversion of the rendered composite (never clamps)
     + ICC embedding: PNG iCCP / JPEG APP2; WebP disclosed unsupported
  -> preflight: IMAGE_PROFILE_MISSING / invalid profile / mismatch findings
```

### Invariants

- **Source vs working space are separate concepts.** The asset remembers what
  its pixels mean; document `colorConfig.rgbProfile` is the working space.
- **Assign never equals convert.** Assignment relabels without touching
  channel values; conversion changes values to preserve appearance.
- **Authoritative pixels survive display.** Wide-gamut values are never
  clipped into the document; display/export clipping is a boundary decision.
- **Conversion is analytic and explicit.** Matrix/TRC tables for sRGB, Display
  P3, Adobe RGB, ProPhoto, Rec.2020 (`@varve/shared`); PQ/HLG transfers are
  recorded but explicitly unsupported; arbitrary custom ICC profiles require
  the native/WASM provider, which is not yet wired.
- **Alpha is never colour-transformed**; premultiplied sources are
  un-premultiplied for the colour math and re-premultiplied after
  (`@varve/engine` `rasterColor/pixelBuffer.ts`).
- **Cache identity will include colour.** The ImageCache key remains
  source-only today because decode is sRGB; a profile-aware decode provider
  must extend the key before it lands (see image-lifecycle.md).

### Working spaces

| Space | Primaries | Transfer | Analytic conversion | ICC authoring |
| --- | --- | --- | --- | --- |
| sRGB | IEC 61966-2-1 | piecewise | yes | yes (matrix/TRC) |
| Display P3 | DCI-P3/D65 | sRGB curve (CSS Color 4) | yes | yes |
| Adobe RGB (1998) | D65 | gamma 2.2 | yes | yes |
| ProPhoto RGB | D50 | gamma 1.8 + toe | yes | yes (gamma approximation) |
| Rec.2020 | D65 | BT.2020 OETF | yes | yes |
| PQ / HLG | — | HDR | no (explicit unsupported) | no |

Export profile bytes are authored deterministically
(`buildMatrixProfile`) so "Display P3 PNG" means P3-encoded pixels plus a
self-consistent P3 profile — never a relabel of sRGB bytes.

### Known limitations (honest)

- Display path decodes through the browser's default sRGB pipeline; no
  Display-P3 canvas surface, no monitor ICC access, no per-frame raster
  proofing of image fills (proof transform covers vector colours only).
- WebP cannot embed ICC profiles through canvas encoders; exports disclose
  this instead of silently dropping the profile.
- Custom/user ICC profiles are stored and labelled, but conversion through
  them requires the native/WASM ICC provider (future work).

### Raster colour capability matrix (2026-08-09)

Capabilities are split per stage — "parse" and "preserve" are not "convert"
and "export". WebKitGTK/WKWebView/WebView2 canvas behaviour is the browser
default decode pipeline; no Display-P3 canvas surface is requested anywhere.

| Capability | Linux (Tauri/WebKitGTK) | Windows (WebView2) | macOS (WKWebView) | Web |
| --- | --- | --- | --- | --- |
| ICC parse (JPEG APP2 / PNG iCCP / WebP ICCP / TIFF 34675 / AVIF colr) | yes | yes | yes | yes |
| CICP/nclx parse (AVIF) | yes | yes | yes | yes |
| PNG sRGB/cHRM/gAMA parse | yes | yes | yes | yes |
| Profile fingerprint + dedup (`Document.iccProfiles`) | yes | yes | yes | yes |
| Profile metadata preserved in documents | yes | yes | yes | yes |
| Analytic wide-gamut conversion (P3/Adobe/ProPhoto/Rec2020) | yes | yes | yes | yes |
| Custom-ICC conversion (native/WASM provider) | **no** (deferred) | no | no | no |
| Display-P3 canvas surface | no (sRGB baseline) | no | no | no |
| Monitor ICC accuracy | no | no | no | no |
| Typed RGBA8/16/16F/32F working-buffer allocation | yes | yes | yes | yes |
| Raster soft-proof of image fills | no (vector only) | no | no | no |
| Export: sRGB (untagged baseline) | yes | yes | yes | yes |
| Export: P3/Adobe/ProPhoto PNG (converted + iCCP) | yes | yes | yes | yes |
| Export: P3/Adobe/ProPhoto JPEG (converted + APP2 ICC) | yes | yes | yes | yes |
| Export: profile embedding in WebP | **no** (disclosed) | no | no | no |
| Export: AVIF | no (unsupported encoder) | no | no | no |
| Preflight IMAGE_PROFILE_MISSING | yes | yes | yes | yes |

"Convert" always means real pixel transformation; "preserve" means the
authoritative source interpretation is retained and never relabelled.
