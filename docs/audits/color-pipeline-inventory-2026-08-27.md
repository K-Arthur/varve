# Color Pipeline Inventory — 2026-08-27

## Canonical Models

### `ManagedColor` (packages/scene/src/colorManagement.ts)
8-variant discriminated union: `RgbColor | CmykColor | GrayColor | SpotColorRef | LabColor | LchColor | RegistrationColor | UnresolvedColor`

Each variant (except Registration/Unresolved) carries:
- `bitDepth?: BitDepth` ('uint8' | 'uint16' | 'float16' | 'float32')
- `profile?: string` (profile id, defaults to document profile)
- `profileFingerprint?: string` (ICC bytes hash for drift detection)

### `RasterColorEncoding` (packages/shared/src/rasterColorEncoding.ts)
Encodes pixel-buffer interpretation: model (rgb/gray/cmyk/unknown), primaries, transfer, matrixCoefficients, videoRange, bitDepth, alphaMode, profileId, profileFingerprint, provenance.

### `ColorConfig` (packages/scene/src/colorManagement.ts)
Document-level: mode, bitDepth, workingSpace ('srgb'|'linear'), rgbProfile, cmykProfile, displayProfile, outputIntent, blackGeneration, blendEvaluationSpace, defaultGradientInterpolation.

---

## Color-Bearing Representation Inventory

| Domain | Storage | Color Meaning | Profile Metadata | Precision | Authority |
|---|---|---|---|---|---|
| Vector fill | `RgbColor` / `CmykColor` / `LabColor` etc. | Tagged by space | `profile?: string`, `profileFingerprint?: string` | `bitDepth` field (uint8 default) | Authoritative |
| Gradient stop | `RgbColor` (inside `GradientStop.color`) | Same as fill | Same as fill | Same as fill | Authoritative |
| Stroke | `ManagedColor` | Same as fill | Same as fill | Same as fill | Authoritative |
| Effect color | `ManagedColor` | Same as fill | Same as fill | Same as fill | Authoritative |
| Swatch | `ColorSwatch.color: ManagedColor` | Same as fill | Same as fill | Same as fill | Authoritative |
| Raster asset | `RasterColorEncoding` on `DocumentAsset.metadata` | Primaries + transfer + precision + provenance | `profileId` → Document.iccProfiles | 8/10/12/16/float16/float32 | Authoritative |
| Raster layer | Same as raster asset | Same | Same | Same | Authoritative |
| Brush tile | Raster asset (via brush system) | Same | Same | Same | Authoritative |
| Working pixel buffer | `PixelBuffer` with `PixelBufferDescriptor` (format + encoding) | Typed array (rgba8/16/16f/32f or cmyka8/16/16f/32f) | `RasterColorEncoding` | Typed format | Working |
| Canvas preview | Canvas2D ImageData (always 8-bit RGBA) | sRGB display | None | 8-bit | Display-only |
| WebGPU surface | `rgba8unorm` textures | sRGB display | None | 8-bit | Display-only |
| Canvas2D CSS colors | `rgba()` strings | sRGB | None | 8-bit | Display-only |
| PDF export | PDF color operators (rg/CMYK/CS/SC) | Depends on output intent | OutputIntent ICC | 8-bit | Export-only |
| PNG export | ImageData → PNG encoder | Transformed pixels | Optional iCCP embedding | 8-bit | Export-only |
| JPEG export | ImageData → JPEG encoder | Transformed pixels | Optional APP2 ICC | 8-bit | Export-only |
| SVG export | CSS color strings in SVG | Depends on target | None | 8-bit | Export-only |
| Codegen | Framework color types | Framework-dependent | None | 8-bit | Export-only |

---

## Color Operation Inventory

### 5 Required Operations

| Operation | Current Status | Key File |
|---|---|---|
| **Assign Profile** | Partial — `assignDocumentColorMode` exists; no per-color assign | `packages/scene/src/colorMode.ts` |
| **Convert Profile** | Partial — `convertDocumentColors` rewrites supported process colors; analytical only without a supplied ICC converter | `packages/scene/src/colorMode.ts` |
| **Convert Color Model** | Implemented — `convertDocumentColors` with analytical + ICC paths | `packages/scene/src/colorMode.ts` |
| **Display Transform** | Not implemented — no profile-aware display conversion | `packages/engine/src/replay.ts` |
| **Soft Proof** | Partial — proof config exists; picker shows proof; no display transform | Picker + proofConfig |

### Current Conversion Architecture

```
ManagedColor (any space)
  → managedColorToWorkingRgba()   [bit-depth and known-RGB-profile aware]
    → normalized destination RGB or explicit unresolved result
  → managedColorToRgba()         [always produces uint8 0-255]
    → [R,G,B,A] uint8
  → managedColorToCss()          [CSS rgba() string]
    → "rgba(R,G,B,A/255)"
```

**Status after the 2026-08-28 remediation:** the shared working resolver maps known RGB
profiles before generating normalized working values. The RGBA8 adapter remains a deliberate
sRGB display boundary; unknown RGB profiles return an explicit unresolved result to the
working API.

### Raster Conversion Architecture

```
source encoding (RasterColorEncoding)
  → createAnalyticRgbTransform(source, target)
    → convertEncodedRgb()        [matrix + TRC, profile-aware for known primaries]
  → convertPixelBufferInPlace()  [format-aware read/write, alpha-preserving]
```

**This path IS profile-aware** for raster-to-raster RGB conversions via primaries+transfer metadata.

---

## Key Gaps Identified

### CRITICAL — Color Meaning Loss

1. **Resolved — working RGB profiles** (§10–11 of spec)
   - P3-tagged `RgbColor` is transformed by the shared working resolver.
   - `managedColorToRgba` still converts to sRGB8 at the Canvas2D/display boundary; that
     boundary cannot preserve P3 gamut.

3. **`engine_color_rgba` in Rust always produces u8** (§49 of spec)
   - Truncates f64 channels to u8, uses naive CMYK→RGB
   - `crates/varve-colour/src/conversions.rs:~line 280`

4. **Blend linearization uses sRGB EOTF only** (§34 of spec)
   - `BlendEvaluationSpace` only has 'legacy-srgb' | 'linear-srgb'
   - Linear blending of P3 values would use wrong transfer for non-sRGB
   - `packages/shared/src/blendEvaluation.ts`

5. **Export pipeline working space is sRGB-only** (§73-75 of spec)
   - Sharpen/resample/dither all normalize via `/255` assuming sRGB
   - Wide-gamut content rendered into sRGB8 intermediate loses gamut
   - `packages/engine/src/exportPipeline/`

### HIGH — Precision & Profile Issues

6. **Resolved — document analytical precision** (§16-17 of spec)
   - `colorMode.ts` normalizes input channels and emits destination channels at the destination
     bit depth/profile. It remains an explicitly non-ICC CMYK fallback.

7. **`cmyk_normalized` in print path is correct but `engine_color_rgba` is not**
   - Native CMYK bypasses RGB correctly in print, but other paths don't

8. **No unified ColorManagementProvider** (§51 of spec)
   - TS analytical, Rust tintbox, and export profile builders are separate
   - No transform caching (§46 of spec)

9. **Resolved — profile fingerprint persistence** (§47 of spec)
   - Imported ICC payloads have a SHA-256 fingerprint, which is carried into registry entries,
     asset metadata, and profile references.

10. **No Display P3 canvas surface** (§39 of spec)
    - Canvas2D always in sRGB, no `colorSpace: 'display-p3'` capability check

### MEDIUM — Missing Features

11. **No soft-proof display transform** (§88 of spec)
12. **No assign-profile dialog for individual colors** (§62 of spec)
13. **Resolved — document conversion walks nested color-bearing properties** (§66)
   - Node fills/stroke gradients/effects, rich-text runs and column rules, adaptive-contrast colors,
     table appearance/cell styles, shared paints/styles, text stories, logo palettes, swatches,
     canvas background, and layer-state appearance snapshots are converted immutably.
14. **Raster assets during document conversion — no explicit policy** (§67 of spec)
15. **Resolved — explicit CMYKA raster representation** (§20 of spec)
   - CMYKA uses five interleaved channels and cannot be passed to an RGB transform. ICC
     RGB↔CMYK conversion remains pending.
16. **Picker gamut warning uses HSV heuristic, not profile-based** (§90 of spec)

### LOW — Deferred / Documentation

17. Custom ICC profile loading (native) not wired
18. 16-bit PNG export not implemented
19. WebP ICC embedding not supported
20. Spot color / Separation / DeviceN PDF export deferred

---

## File Map

| File | Responsibility |
|---|---|
| `packages/scene/src/colorManagement.ts` | ManagedColor types, ColorConfig, profile refs |
| `packages/scene/src/colorMode.ts` | assignDocumentColorMode, convertDocumentColors |
| `packages/scene/src/colorValidation.ts` | Color validation, normalization, equality |
| `packages/shared/src/colorConversion.ts` | normalizeChannel, managedColorToNormalized/Rgba, analytical conversions |
| `packages/shared/src/rasterColorEncoding.ts` | RasterColorEncoding types |
| `packages/shared/src/blendModes.ts` | Blend pixel math |
| `packages/shared/src/blendEvaluation.ts` | BlendEvaluationSpace policy |
| `packages/engine/src/rasterColor/transform.ts` | Analytic RGB raster transform |
| `packages/engine/src/rasterColor/profiles.ts` | ICC profile builder (analytic) |
| `packages/engine/src/rasterColor/exportPolicy.ts` | Export encoding resolution |
| `packages/engine/src/rasterColor/pixelBuffer.ts` | Typed pixel buffer format conversion |
| `packages/engine/src/rasterColor/embed.ts` | JPEG/WebP ICC embedding |
| `packages/engine/src/replay.ts` | Canvas2D color → CSS string |
| `packages/engine/src/compositeCanvas.ts` | Canvas2D compositing |
| `packages/engine/src/exportPipeline/` | Raster export (resize→sharpen→color→dither→encode) |
| `crates/varve-colour/src/lib.rs` | WASM exports |
| `crates/varve-colour/src/conversions.rs` | Analytical + ICC CMYK conversion, engine_color_rgba |
| `crates/varve-colour/src/icc.rs` | tintbox ICC engine |
| `crates/varve-colour/src/profiles.rs` | Bundled profiles, ICC validation |
| `crates/varve-print/src/lib.rs` | PDF color string emission |
| `crates/varve-print/src/cmyk.rs` | PDF/X export |
| `packages/import/src/metadata/icc.ts` | ICC extraction from imported files |
| `packages/import/src/metadata/index.ts` | Encoding resolution from file metadata |
| `packages/ui/src/components/ColorPicker/ColorPicker.tsx` | Color picker |
| `packages/editor/src/components/Inspector/controls/InspectorColorPopover.tsx` | Picker wrapper with proof config |
