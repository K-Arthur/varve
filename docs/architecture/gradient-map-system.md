# Gradient Map System

A gradient map remaps the **tonal value** of rendered content through a color
ramp: each source pixel is reduced to a scalar tonal value, that value samples
a color gradient, and the result is composited back. It is a **non-destructive
tonal adjustment**, not a spatial gradient fill.

## Gradient maps vs gradient fills

| | Gradient fill | Gradient map |
|---|---|---|
| Ramp position from | Object coordinates (linear/radial/…) | Source pixel luminance/tonal value |
| Scene model | `Fill.type='gradient'` → `GradientFill` | `AdjustmentNode.adjustments[]` → `kind:'gradientMap'` |
| Editing surface | FillSection / GradientHandleOverlay | AdjustmentPanel → Gradient Map section |
| Scope | One node's fill | Adjustment scope (image-local / targets / container / document) |

The two share stop + interpolation primitives (`GradientColorStop`,
`GradientOpacityStop`, midpoint bias, OKLab/OKLCH/Linear-sRGB/HSL/sRGB interpolation) but
remain distinct scene concepts.

## Canonical model

- `packages/scene/src/gradientPresets.ts` — `GradientPreset`,
  `GradientColorStop`, `GradientOpacityStop`, `GradientInterpolation`,
  `GradientLuminanceMode`, `GradientPresetSource`, `GradientCompatibilityInfo`.
  Stable stop/preset ids, deterministic content hashing
  (`gradientPresetContentHash`), NaN/Infinity sanitization, deterministic
  merge/dedup (`mergeGradientPresets`).
- `Document.gradientPresets` — document-local presets (v2.11+). Portability:
  effects embed a snapshot (`GradientMapAdjustment.embeddedGradient`), so
  documents render correctly even when the global preset is renamed/deleted.
- Engine structural mirror — `GradientMapStop`/`GradientMapOpacityStop` use
  `Color` tuples; conversion helpers
  `gradientPresetToGradientMapStops` / `gradientPresetToEmbeddedGradient` /
  `embeddedGradientToGradientPreset`.

## Rendering

- LUT evaluation: `packages/engine/src/gradientMap.ts`
  (`buildGradientColorLut`, `buildGradientAlphaLut`, `applyGradientMapFilter`).
  Color math reuses `@varve/shared` `interpolateManagedColor` so gradient-map
  stops blend identically to fill gradients in the same space. Midpoint
  semantics follow the Photoshop `.grd` convention (a stop's midpoint governs
  the segment to the previous stop) — see the module docstring.
- Luminance modes: `relative-luminance` (default, Rec.709/WCAG),
  `perceptual-lightness` (Oklab L), `average-rgb`, `max-channel`, plus
  `alpha`/`red`/`green`/`blue`/`compatibility` for imported-asset compat.
- Parameters: `reverse`, `intensity` (mix with source), `dither` (deterministic
  Bayer 4×4/8×8), `preserveSourceAlpha` (default on — transparent pixels never
  develop fringes), independent `opacityStops`, `lutSize` (64–4096).
- Pipeline: `AdjustmentNode.adjustments` → `adjustmentsToFilters` →
  `FilterIR.gradientMap` → `applySoftwareFilter` → backdrop compositing of the
  scope targets (raster AND vector — vectors are painted into the effect
  surface first, then filtered). Preview and export run the same function, so
  they cannot diverge.

## Import

- `packages/import/src/gradient/`:
  - `descriptor.ts` — bounded big-endian reader + 8BIM descriptor parser
    (Objc/VlLs/doub/long/UntF/TEXT/enum/bool/tdtd), depth/count/size limits.
  - `photoshopGrd.ts` — modern descriptor files (`8BGR`, PS CS6+) with anchor
    scanning + per-gradient skip on partial corruption; legacy `Grad` v1/v2
    best-effort.
  - `normalize.ts`, `detect.ts`, `nativeFormat.ts`, `index.ts`.
- Supported `.grd` features: multiple gradients per file, names (unicode/empty/
  duplicates), RGB/HSB/CMYK/Gray color models (analytical conversion), color +
  opacity stops, positions (0–4096), midpoints, smoothness, noise detection.
- **Unsupported / approximated**: noise gradients import read-only with a
  compatibility warning (no PRNG reproduction); unknown color models
  approximate to sRGB with a warning. A partially corrupt multi-gradient file
  imports its valid entries and reports the skipped ones.
- Native interchange: `.varve-gradient.json` (versioned, human-inspectable),
  `encodeGradientPresets` / `decodeGradientPresets`.
- Limits: 5 MB max file, 2000 gradients, 256 color stops, 256 opacity stops,
  4096-char names, depth 32, 100k collection items.

## Presets

- `packages/editor/src/gradientPresets/` — `useGradientPresetLibrary` (user
  presets + favorites + recents, persisted via the platform app-setting store),
  `builtin.ts` (12 deterministic built-ins), `thumbnail.ts`,
  `importFile.ts`.
- Scopes: built-in / user-level / document-local (`Document.gradientPresets`).
- Duplicate handling: content-hash merge (never overwrite on name match).

## UI

`GradientMapAdjustmentSection` (in the AdjustmentPanel, the standard home for
adjustment effects) composes:

- `GradientMapPresetBrowser` — searchable list, All/Favorites/Recent filters,
  roving-tabindex keyboard nav, shared context menu (rename/duplicate/delete/
  favorite/export).
- `GradientMapEditor` — color stop bar (drag/click/keys), opacity stop bar,
  position/opacity numeric inputs, interpolation, luminance source, intensity,
  reverse, dither, keep-alpha, preserve-luminosity, channel mode.
- `GradientImportDialog` — per-preset selection, thumbnails, warnings,
  duplicate counts, import scope (library/document/both), immediate apply.

## Persistence

- Migration `2.10 → 2.11` stamps `Document.gradientPresets` (version.ts).
- Adjustments serialize through the existing document codec; new fields are
  optional and backward-compatible; clipboard/backup/autosave all flow through
  `DocumentCodec`.
- Undo/redo: all effect edits go through the existing
  `updateAdjustmentInLayer`/transaction system.

## Export

- Raster (PNG/JPG/WebP): native — the filter applies at export resolution.
- SVG/PDF: gradient maps cannot be represented live; the affected subtree is
  rasterized (existing `compositor.ts` capability path). `exportService`
  surfaces a preflight warning
  (`export/gradientMapPreflight.ts`) when flattening loses editability.
- Print (varve-print): adjustments are flattened via the webview raster path
  (documented pre-existing limitation).

## Performance

- LUT generation is O(size × stops), cached per call (callers hold LUTs for the
  frame); `lutSize` 256 default matches 8-bit input.
- `perceptual-lightness` is the only per-pixel Oklab cost; the default
  `relative-luminance` path is a single dot product.
- Vector/group targets share the scope backdrop, so one filter pass covers the
  subtree (no per-node surface explosion).
- Ordered Bayer dithering is deterministic (visual-regression stable, no
  tile seams).

## Test fixtures

`packages/import/src/gradient/__fixtures__/` — clean-room generated `.grd`
files (provenance in `PROVENANCE.md`): two-stop, multi-gradient, mixed color
models, noise, unicode names, legacy v1/v2, truncated, empty.

## Extension points

- New gradient import formats: add `detect` + `parse` + `normalize` in
  `packages/import/src/gradient/`; wire into `importGradientPresets`.
- GPU compute gradient map (WebGPU/WebGL post-pass): deferred — Linux
  WebKitGTK cannot be assumed to expose either; the CPU path is the shared
  fallback and current default.
- Blue-noise / error-diffusion dithering: ordered Bayer retained for
  determinism; error diffusion deferred pending perf budget.
- ICC-accurate profile conversion for imported wide-gamut presets: deferred
  (TS has no ICC engine; analytical sRGB/Display-P3 math only).
- `.ase` import: not overloaded (cannot represent stops/midpoints/opacity).
