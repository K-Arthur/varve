# Color System Memory — Strata

## Discovery Results (§0)

### Libraries
- **No external color libraries** anywhere (TS or Rust). All color math is hand-written analytical code.

### Color Conversion Pipeline
- `packages/shared/src/colorConversion.ts` (540 lines) — SSOT: sRGB↔linear↔XYZ D65↔CIELab↔Oklab↔OKLCH↔CMYK, ΔEOK, `gamutMapToSrgb`
- `packages/ui/src/tokens/contrast.ts` (174 lines) — duplicate OKLCH math for token system
- `packages/ui/src/components/ColorPicker/color-utils.ts` (123 lines) — HSV/HSL/Hex for ColorPicker
- `packages/shared/src/colorInterpolation.ts` (~480 lines) — gradient interpolation (5 spaces: sRGB, linear-sRGB, OKLab, OKLCH, HSL) with configurable hue direction
- `packages/shared/src/cssColorParser.ts` (343 lines) — CSS color parser (hex/rgb/hsl/oklch/oklab/named)

### Gradient Rendering
- **Backend**: Canvas2D only (`ReplayTarget` interface, `@varve/engine/replay.ts`). No WebGL/WebGPU.
- **Gradient types**: linear, radial, angular (conic), diamond (radial fallback)
- **Interpolation spaces**: sRGB, Linear sRGB, OKLab, OKLCH, HSL — all handled via `expandGradientStops` (16 subdivisions/segment)
- **Tiling**: repeat/reflect via OffscreenCanvas + `createPattern`
- **Transform matrix**: Affine matrix override for fill position/rotation
- **Tests**: 43 replay-fill tests, 46 colorInterpolation tests, 28 fills tests

### Types
- **Scene**: `ManagedColor` (RGB/CMYK/Gray/Spot union), `GradientFill`, `GradientStop`, `Fill` (solid/gradient/image/pattern)
- **Engine**: `EngineColor`, `EngineGradientFill`, `FillIR` — mirrors scene types without scene dependency
- **Rust**: `EngineColor`, `GradientStop`, `GradientFill`, `FillIR` — serde parity with camelCase

### Existing Systems
- **Undo/redo**: Snapshot-based, full Document clones, 50-entry cap, transaction grouping available
- **Token/variable**: Figma-style collections+modes+groups, circular-reference detection, Pratt parser for math expressions
- **Bindings**: `PropertyBinding{variableId, expression?}` on NodeBase, `applyBindingsToNode()` in render loop
- **Styles**: named reusable styles (color/text/effect/layout), flat resolution (no recursive chaining)
- **Blend modes**: 14 separable + 4 non-separable (W3C L*C*h) + 12 Porter-Duff operators
- **Color blindness**: Machado 2009 LMS matrices (protanopia/deuteranopia/tritanopia)
- **WCAG contrast**: WCAG 2.2 (shared declares 2.1, UI tokens 2.2 — same math), relative luminance formula
- **Swatches**: CRUD on Document, palette formats (GPL parse+export, ASE parse only, ACO parse+export)
- **Palette extraction**: median-cut OKLCH + harmony generation (OKLCH-based, not HSL)
- **ColorPicker UI**: Full (22 files, HSV area + CMYK/Gray/Spot tabs + gamut warning + contrast readout)
- **GradientEditor UI**: Multi-stop with drag bar, midpoint slider, type/space/tiling selectors, rotation, color picker

### Document Version
- Current: **1.6** (added `interactions` field)
- Supported: 1.0–1.6
- Migration engine: sequential version-based, O(n) per migration

---

## Decisions (§1)

### Gamut mapping strategy
**Chosen: Chroma-reduction binary search (CSS Color 4 style)**

Implemented in `gamutMapToSrgb()` (colorConversion.ts:497) — preserves hue and lightness by reducing chroma until in-sRGB-gamut. Used in the OKLCH interpolation path (`colorInterpolation.ts:191`).

**⚠ Contrast evaluation still uses simple-clipped sRGB** — `gamutMapToSrgb` is NOT called in the contrast/audit path. This means WCAG ratios for wide-gamut colors are measured against clipped values, not gamut-mapped ones. Deferred fix (minor impact for current sRGB-primary workflow).

### Hue interpolation direction
**Chosen: User-configurable, default shortest path.**

Implemented in `lerpHue()` (`colorInterpolation.ts`) — supports CSS Color 4's four directional modes: shorter, longer, increasing, decreasing. Stored in `GradientFill.hueInterpolation` (optional, defaults to `'shorter'`). UI shows the hue direction selector conditionally for cylindrical spaces (OKLCH, HSL) only.

### Undefined-hue handling (chroma=0 in OKLCH)
**Resolved.** When chroma (C) is 0, `oklabToOkLch()` returns H=0 via `atan2(0,0)` → 0. During OKLCH interpolation between an achromatic stop (C≈0, H=0 arbitrary) and a chromatic stop (C>0, H=real), the hue ramps from the arbitrary 0 to the real hue — creating a visible wrong hue shift through gray.

**Decision**: For segments where either endpoint has C < 0.001, fall back to OKLab interpolation (no hue component). This is the standard fix used by color-science-aware engines. Tested with 46 tests including achromatic edge cases.

### CMYK scope
**Screen preview only.** All CMYK conversions use analytical inverse-complement formulas (`cmykToRgb` / `rgbToCmyk`). ICC-profile-aware output (Fogra39/GRACoL/SWOP) exists in the Rust print crate (`strata-print`) for PDF export only, not for screen display.

### WCAG version
**WCAG 2.2** (relative luminance formula). The `UI` grade (3:1 for non-text contrast, SC 1.4.11) is included. APCA is NOT used. The underlying math is identical between WCAG 2.1 and 2.2 — the difference is the additional `UI` grade.

---

## Gap Analysis — Priority Order

### P0 — Functional Bugs

| # | Gap | File | Fix |
|---|-----|------|-----|
| 1 | ~~**Undefined-hue in OKLCH interpolation** via gray stops (chroma≈0 → H=0 arbitrary → hue shift)~~ | `colorInterpolation.ts` | **Resolved**: Fall back to OKLab when C < 0.001 |
| 2 | **Gradient stop drag = one undo entry per pointermove** (not per gesture) | `GradientEditor.tsx:173-193` + `FillSection.tsx` | Wrap drag in `beginTransaction()`/`commitTransaction()` |
| 3 | **Zero-length gradient vector** (degenerate shape: bounds.w===0 || bounds.h===0) — relies on Canvas2D undefined behavior | `replay.ts:806-810` | Guard on `halfDiag <= 0`, emit solid fill of last stop |

### P1 — Performance

| # | Gap | File | Fix |
|---|------|------|-----|
| 4 | **No throttle/RAF batching** during gradient stop drag — every pointermove triggers full React state update + undo push | `GradientEditor.tsx:173-193` | RAF-batched or requestIdleCallback-throttled update |
| 5 | **No gradient caching/LUT** — full OKLab interpolation recalculated every frame per gradient | `replay.ts:797-863` | Memoize `CanvasGradient` by fill hash; invalidate on stop/type/space/transform change |
| 6 | **Token change → full scene re-render** (`docVersion` bump invalidates ALL IR cache, even unaffected nodes) | `CanvasArea.tsx:448-455`, `context.tsx` | Track per-variable dependent node set; only invalidate cache entries for nodes bound to changed variable |

### P2 — UX

| # | Gap | File | Fix |
|---|------|------|-----|
| 7 | **No keyboard add-stop** in gradient editor (only click on bar) | `GradientEditor.tsx` | Add key binding (e.g., `A` or `Insert`) to add stop at selected stop's position |
| 8 | **Gradient stop drag unthrottled** — 60-120 events/sec, no RAF | `GradientEditor.tsx:173-193` | Same as P1#4 |
| 9 | **No `ArrowUp`/`ArrowDown`/`Home`/`End`** for stop keyboard nudging | `GradientEditor.tsx:291-301` | Add shortcuts: Up=+5%, Down=-5%, Home=0, End=1 |

### P3 — Edge-case hardening

| # | Gap | File | Fix |
|---|------|------|-----|
| 10 | **Stops outside [0,1] from programmatic import** — `expandGradientStops`/`sampleGradientColor` don't clamp stop positions | `colorInterpolation.ts` | Clamp stop positions in expansion/query functions (not just UI) |
| 11 | **ASE export missing** — can parse but not export; no round-trip test | `paletteFormats.ts` | Add ASE export function + round-trip test |
| 12 | **ACO error handling weak** — 0 error tests, no malformed input coverage | `paletteFormats.ts` + test | Add malformed-ACO tests and validation |
| 13 | **Conic rotation UI shows [0,360]** but underlying data can store any value — rotation clamps only in UI | `GradientEditor.tsx:372-378` | Clamp `fill.rotation` at set time in `updateSelectedFillAt` |
| 14 | **Contrast evaluated on pre-gamut-mapped sRGB** — `gamutMapToSrgb` never called in contrast path | `contrast.ts:99-132` | Low priority — manifests only for OOG colors |

### P4 — Polish / Documentation

| # | Gap | File | Fix |
|---|------|------|-----|
| 15 | ~~**Hue interpolation direction not user-configurable**~~ | `colorInterpolation.ts` | **Resolved**: `hueInterpolation` field added to GradientFill (shorter/longer/increasing/decreasing), UI selector visible for cylindrical spaces |
| 16 | **Dirty-flagging per token** (architectural improvement) | `CanvasArea.tsx` | Track `token→[nodeIds]` mapping; only rebuild IR for affected nodes |

---

## Edge Case Checklist

| Case | Status | Notes |
|------|--------|-------|
| Duplicate-position stops | ⚠ Guarded (`span===0?0`) | Hard band remains; `expandGradientStops` deduplicates via `seen` set but interpolation between duplicate positions snaps to first |
| Division by zero (span=0) | ✅ | `span===0?0` guard |
| Stops outside [0,1] | ⚠ UI-clamped only | Programmatic import bypasses clamping |
| Linear gradient zero-length vector | ❌ No guard | Relies on Canvas2D undefined behavior |
| Conic angle wrap-around at 0°/360° | ✅ Canvas2D natively handles | `createConicGradient` wraps angles |
| Undefined hue (chroma=0 in OKLCH) | ✅ Resolved | Falls back to OKLab when C < 0.001; tested with 4 achromatic edge-case tests |
| NaN propagation (achromatic→chromatic) | ✅ Resolved | Same fix as undefined-hue — guarded by C < 0.001 check |
| Round-trip hex→OKLab→hex precision | ✅ Untested but analytical | Pure math, no truncation between iterations |
| Named CSS colors | ✅ | ~30 named colors in cssColorParser |
| Hex #RGB/#RRGGBB/#RGBA/#RRGGBBAA | ✅ | 3, 4, 6, 8-digit supported |
| Locale-sensitive decimal parsing | ⚠ Assumes `.` separator | No locale-aware parse; comma-separated would fail |
| Infinity/NaN in color values | ❌ Not guarded | No `isFinite` checks on input values |
| Very large palettes (performance) | ❌ Not tested | No stress test for 1000+ swatches |
| Transparent pixels in extraction | ⚠ Not explicit | `paletteExtractor` likely includes them; no mention of filtering |

---

## Test Coverage Gaps

| Area | Current | Needed |
|------|---------|--------|
| Undefined-hue OKLCH interpolation | ✅ 4 tests | Covered (achromatic edge cases) |
| Zero-length gradient vector | 0 | 2 tests (bounds.w===0, bounds.h===0) |
| Gradient stop transaction wrapping | 0 | 2 tests (drag=1 undo entry, abort restores) |
| Throttled gradient updates | 0 | 1 test (RAF fires at ≤1 per frame) |
| Gradient caching | 0 | 2 tests (identical gradients share cache, cache invalidated on change) |
| ASE round-trip | 0 | 1 test (export→re-import preserves all colors) |
| ACO malformed input | 0 | 3 tests (truncated, bad mode, corrupt channels) |
| Token dirty-flag selective re-render | 0 | 1 test (changing variable V affects only nodes bound to V) |
| Palette extraction transparent pixels | 0 | 1 test (transparent pixels excluded from result) |
| Conic rotation clamp (data model) | 0 | 1 test (rotation stored as clamped [0,360]) |
