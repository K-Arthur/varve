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

## Operation Boundaries

The following operations have different contracts and must not be conflated:

- **Assign profile / mode** changes metadata only; channel values do not change.
- **Convert profile / model** produces new authoritative channel values for a declared
  destination. Browser analytical CMYK conversion is explicitly an approximation;
  profile-specific CMYK requires an ICC provider.
- **Working transform** resolves a `ManagedColor` into an explicit RGB working encoding
  without reducing it to RGBA8. Unknown RGB profiles return an unresolved result rather
  than being relabelled as sRGB.
- **Display transform** is a lossy boundary. `managedColorToRgba()` is the legacy
  sRGB/RGBA8 adapter and must not be used for authoritative edits or conversion.
- **Soft proof** is a display-only transform (`document → proof → display`). Its output
  is untagged display-sRGB values and is never written into the document or export pipeline.

`managedColorToWorkingRgba()` and `createAnalyticRgbColorTransform()` in `@varve/shared`
are the common vector/raster analytical contract. They carry operation, intent, and
black-point-compensation requests even where the browser implementation cannot yet honor
ICC-only CMYK options.

## Print geometry and bleed

Print geometry is page-scoped. `Page.bleed` is an optional override of the
document's `bleed` default; `resolvePagePrintGeometry()` is the only resolver
used by the page inspector, canvas overlays, preflight, and page-bleed export
planning. A page's trim bounds are its placed `width`/`height`; bleed bounds
expand those bounds outward by the resolved top/right/bottom/left insets.

**Application default is zero bleed.** Documents that never configured bleed
(including every pre-bleed legacy document) resolve to `EMPTY_BLEED` — the
canvas shows no production region and export stays trim-only. Real bleed
values come from print presets at document creation or from the page/document
inspector; nothing injects 3 mm into an old document.

Bleed values are persisted in their declared physical unit (`mm`, `in`, `pt`,
or another supported `DocumentUnit`). The resolver converts them once to the
fixed-96-dpi document coordinate space. Raster/export DPI is a separate output
calculation and never changes canvas geometry. This prevents a 3 mm bleed from
changing when a document's export resolution changes.

Canonical geometry lives in `scene/printGeometry.ts`:
`pageBleedInsetsPx(doc, pageId)` resolves the per-edge insets in document
pixels (document default merged with the page override), and
`pageBleedBoundsInWorld(doc, pageId, origin)` expands a trim rect at a given
origin by those insets. The canvas overlay, the export plan's `page-bleed`
bounds, and preflight all consume the same resolver — there is no independent
bleed arithmetic in renderers or exporters.

The canvas's `bleedGuidesVisible` preference is view state, not document state:
it can hide the dashed outer boundary and production band without changing
bleed, dirty state, undo history, or export output. The guide is an SVG editor
overlay with `pointer-events: none`; it is not a scene node, does not enter hit
testing or bounds, and is never exported. The overlay draws in screen space:
origins map through `worldToCanvas` and sizes scale by zoom, so the physical
bleed distance tracks the camera while the stroke stays screen-readable. The
bleed boundary is a dashed accent-tinted rect with a subtle production band
between trim and bleed; trim corner marks are drawn at the four cut corners.

Page content remains editable on the pasteboard outside trim. The trim outline
continues to identify the cut edge while the bleed guide identifies the
production extent, so artwork that actually crosses trim remains visible for
inspection without globally disabling ordinary frame clipping.

The bleed value is edited in the Page Print inspector section (Page tool) in
the resolved config's unit (mm for print documents, px for screen documents),
clamped to non-negative values and to half the page's smaller dimension
(ADR-0190 D5). The export dialog seeds its PDF/X bleed field from the active
page's resolved bleed — the dialog value is an explicit export-job override of
the document value, and the panel names the document bleed so the relationship
is visible.

PDF/X export receives trim dimensions and the resolved bleed for the native
single-page production path. The encoder expands the media sheet around trim
to contain bleed and, when requested, the complete crop-mark arms; it emits
distinct `MediaBox`, `BleedBox`, `TrimBox`, `CropBox`, and `ArtBox` values in
that same coordinate system. `BleedBox` is trim plus the configured bleed,
while crop marks are positioned from the trim edge, not the bleed edge. With
zero bleed and no marks, the boxes coincide. ADR-0192's multi-page execution
and screen-PDF work remain separate roadmap items. PNG/JPEG/WebP retain their
own format capabilities; the editor must not imply that a view guide changes a
format that does not support page-bleed export.

## Colour Conversion Pipeline

### Working precision and display precision

`managedColorToWorkingRgba()` is the working-space adapter. It resolves known RGB profile
ids (sRGB, Display P3, Adobe RGB, ProPhoto, and Rec. 2020), reads uint16 and float
channels at their native scale, and produces normalized floating-point destination values
without passing through RGBA8. An unknown RGB profile is reported as unresolved; it is
never silently treated as sRGB. `managedColorToNormalized()` is the compatibility
sRGB-working wrapper, while `managedColorToRgba()` remains an explicit RGBA8
display/legacy adapter.

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
degradation. Proof output intentionally removes the authored RGB profile tag: it is now
display-sRGB, so keeping a source P3 tag would make replay convert it twice. Neither path
writes proofed values back to the document.

### Typed raster working buffers

Raster code must carry a `PixelBufferDescriptor` alongside its storage. The
engine allocator now provides the following explicit mappings:

| Format | Storage | Channel range |
| --- | --- | --- |
| `rgba8` | `Uint8Array` | 0–255 integer |
| `rgba16` | `Uint16Array` | 0–65535 integer |
| `rgba16f` | packed IEEE-754 half floats in `Uint16Array` | normalized working values |
| `rgba32f` | `Float32Array` | normalized working values |
| `cmyka8` | `Uint8Array` | C, M, Y, K, alpha; 0–255 integer |
| `cmyka16` | `Uint16Array` | C, M, Y, K, alpha; 0–65535 integer |
| `cmyka16f` | packed IEEE-754 half floats in `Uint16Array` | C, M, Y, K, alpha working values |
| `cmyka32f` | `Float32Array` | C, M, Y, K, alpha working values |

`allocatePixelBuffer()` rejects invalid dimensions and enforces a default
512 MiB byte budget. Format, color encoding, and alpha mode remain metadata;
they are not inferred from the typed array. Half-float conversion helpers are
explicit and tested, including negative and fractional values. Browser
`ImageData` and the current Canvas2D effect surface remain deliberate RGBA8
preview boundaries; they must not be used as the document or working-buffer
storage contract.

`convertPixelBufferFormat()` is the explicit storage-precision boundary. It
returns a new buffer, leaves the source untouched, preserves encoding and
alpha metadata, and applies integer clamping/rounding only when the selected
target format requires it. A display or export caller must choose this
operation deliberately rather than allowing an intermediate `ImageData`
allocation to overwrite the working buffer.

`createAnalyticRgbTransform()` exposes `convertPixelBuffer()`, which converts the four
RGBA formats tile-wise. Integer formats quantize only when writing their explicitly
selected storage format; float formats retain fractional working values. Premultiplied
buffers are un-premultiplied for RGB color math and re-premultiplied afterward, while
alpha remains untouched. CMYKA buffers are a distinct five-channel representation and are
deliberately rejected by the RGB transform: RGB↔CMYK needs a declared destination ICC
profile/provider, not a four-channel reinterpretation.

The WebGPU solid-vector upload adapter uses the same normalized conversion
for RGB, CMYK, Gray, Spot, and float colors. This prevents normalized float
channels from being divided by 255 a second time. The WebGPU canvas target is
still an RGBA8 display surface, so this fixes the upload math without claiming
that the GPU preview target is a high-precision document surface.

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
`convertDocumentColors()` in `packages/scene/src/colorMode.ts` converts all document
process colours between RGB/CMYK/Grayscale using the destination document bit depth and
destination profile reference. It preserves alpha at that precision, carries the destination
profile fingerprint, and walks nested color-bearing state immutably: node fills and stroke
gradients, effects (including glass-material tint/highlight), rich-text runs and column rules,
adaptive-contrast colors, table appearance/cell styles, shared paints/styles, text stories,
logo palettes, swatches, layer-state appearance snapshots, and `canvasBackground`. Its
analytical CMYK path remains explicitly approximate; it is not an ICC substitute. Raster
asset bytes and their source encodings are intentionally not rewritten by this vector/document
operation; raster conversion is a separate atomic workflow.

Wired into the editor context at `context.tsx` with undo/redo support.

## Deployment-Target Capability Tiers

| Capability | Desktop (Tauri/Rust) | Browser |
|---|---|---|
| ICC-aware CMYK conversion | Full (via varve-print, lopdf) | Analytical only (no ICC) |
| PDF/X-1a, PDF/X-4 export | Full (Rust varve-print) | Not available — stub only |
| Font outlining | Full (ab_glyph) | Not available |
| Native print pipeline | Yes (CUPS/system print) | No (window.print() only) |
| Soft proofing | Profile provider when registered; display-only | Source remains unchanged unless a profile provider is registered |
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
  colors across node and document-level color-bearing properties (including
  rich text, tables, shared paints/styles, stories, logo palettes, layer
  snapshots, gradients, effects, swatches, and canvas background) into the
  target mode and returns a structured report
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
- **Cache identity is color-partitionable.** `ImageCache` retains URL-only
  compatibility for existing callers, while profile-aware decode/conversion
  callers can supply a stable `rasterEncodingKey()` variant for both full-size
  and at-size representations (see image-lifecycle.md). Decode conversion
  itself remains a separate provider concern.

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

## High-precision pipeline status (2026-08-13)

The following land on top of the representation work above. Each item
cross-references the quantization-boundary inventory
(`docs/audits/color-quantization-boundary-inventory.md`).

### Canonical model and persistence (complete)

- `ManagedColor` (RGB/CMYK/Gray/Lab/LCH/Spot/Registration/Unresolved) carries
  `bitDepth` (`uint8`/`uint16`/`float16`/`float32`) and profile identity per
  value; legacy values default to `uint8` without mutation.
- Scene → engine IR preserves the tagged color object; `managedColorToRgba`
  is an explicit display boundary and never feeds precision-sensitive math
  (the normalized path `managedColorToNormalized` is the working path).
- Save/reopen is lossless at any depth: see
  `packages/scene/src/highPrecisionRegression.test.ts` (adjacent uint16
  values stay distinct, 512-level ramps survive, float/CMYK channels are
  exact, five save cycles show zero drift, legacy boundary values migrate
  exactly).

### Document color settings (complete)

- Inspector → Document Color now exposes Mode (assign-only), **Precision**
  (8-bit/16-bit/16f/32f — the default for newly authored colors) and
  **Blend space** (sRGB/Linear). Both are settings-only operations
  (`setDocumentBitDepth` / `setDocumentWorkingSpace` in
  `packages/scene/src/colorMode.ts`); existing values are never rewritten.
- File → **Document Color Mode…** opens the Assign vs Convert dialog
  (`ColorConversionHost`), also reachable from the command palette
  (`openColorConversion`). Assign keeps values; Convert rewrites them in one
  undoable transaction (analytical in browser, ICC via the desktop engine).

### Picker precision (complete)

- HSV area/slider/alpha drafts run on float HSV with a normalized 0-1 emit;
  storage quantization happens once at `denormalizeChannel`.
- Numeric RGB fields are bit-depth aware: 0-255 (uint8), 0-65535 (uint16),
  0-1 with 5 decimals (float16/float32). Editing one channel carries the
  untouched channels from the canonical normalized value — editing R never
  quantizes G/B (regression-tested in `ColorPicker.test.tsx`).
- Swatches (document colors + recents) carry the full `ManagedColor`; only
  the swatch face is 8-bit. Native-space swatches emit unchanged; RGB
  swatches flow through the normalized path; precision is capped by the
  document's bit depth, never by the 8-bit display.
- Recents dedupe by canonical key and keep Lab/LCH values.
- Gradient stop insertion interpolates in normalized 0-1 space
  (`interpolateNormalizedColor` in `@varve/shared`) and stores at the
  neighboring stops' bit depth.

### Effects and blends (partial — see inventory)

- `gaussianBlurLinearLight` runs the entire convolution on float32 linear
  premultiplied values with one quantization at the end (the previous
  implementation quantized linear values back to bytes before blurring).
- `exportPipeline/palette.ts` lost a dead `/255 → ×255` round trip.
- The adjustment stack (curves/levels/gradient maps/duotones) remains
  byte-space by construction: every kernel consumes `ImageData` via
  `filterCompositor.ts:150` and writes back through `putImageData`. A float
  entry/exit for the whole effect pipeline (single quantization) is the
  remaining work — the `rasterColor/` typed-buffer layer is the intended
  carrier and is not yet wired into the effect path.
- `liveEffects/dither.ts` already accumulates error diffusion in float; its
  palette lookup is the genuine output boundary and stays byte-keyed.

### Print (complete)

- The PDF exporter emits authored CMYK channels directly (`cmyk_normalized`
  is bit-depth aware: uint8 /255, uint16 /65535, float as-is) for solid
  fills, strokes, and gradient samples. Native CMYK stops interpolate in
  CMYK space. Pure K stays (0 0 0 1) — no four-color build from the naive
  `(1-c)(1-k)` round trip. Tested in `crates/varve-print` (151 tests).

### Remaining boundaries (explicit)

| Boundary | Status |
| --- | --- |
| Browser raster decode (`new Image`/`createImageBitmap`) | 8-bit; 16-bit PNG/TIFF preservation requires native/WASM decode (varve-media is decode-only today) |
| Canvas2D `ImageData` effect masks/backdrops | 8-bit preview boundary |
| WebGPU effect textures | `rgba8unorm` only; capability-selected `rgba16float` is pending |
| Export encoders | PNG/JPEG/WebP 8-bit only; PNG16/TIFF need a 16-bit composite path first (the compositor is Canvas2D 8-bit at the surface boundary) |
| Grid/guide colors | scene model stores CSS strings (UI chrome, not document content) |
| Document-wide precision conversion (uint8 → uint16 → float) | settings default exists; bulk value rewrite is not implemented |
