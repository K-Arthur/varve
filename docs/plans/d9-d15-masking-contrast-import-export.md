# D9-D15 Implementation Plan — Masking, Contrast, Import/Export

## Status: In Progress

Based on comprehensive codebase audit (2026-07-20).

## Current State Summary

| Area | Status |
|------|--------|
| Mask model (scene) | ✅ Mature — `Mask` union, 3 types (clip/alpha/luminance), full CRUD, validation, cycle detection |
| Mask rendering | ✅ All 3 types rasterized with feather/density/inversion |
| SVG export | ✅ Full mask/clip/blend support |
| SVG import | ❌ Parses defs/use but NO clipPath/mask/gradient/filter |
| PSD import | ❌ Pure stub — @webtoon/psd installed but unused |
| PDF export | ❌ Flat shapes only — no masks, blends, opacity, transparency groups |
| Preflight | ❌ Does NOT check masks/blends for export readiness |
| WebGPU | ✅ Hybrid compositor + ONNX provider chain; monitoring gaps |
| Adaptive text contrast | ❌ Not implemented |

## Implementation Phases

### Phase 1 — Capability Matrix & Compatibility Metadata (Foundation)
- `packages/scene/src/maskCapability.ts` — per-format capability declarations
- Compatibility outcome types: preserved/converted/rasterized/blocked
- Shared by D10, D11, D12, D13

### Phase 2 — D12: SVG clipPath/mask import
- Parse `<clipPath>` and `<mask>` elements
- Handle clipPathUnits/maskUnits/maskContentUnits, objectBoundingBox/userSpaceOnUse
- Reconstruct scene mask relationships from SVG defs
- Import report for conversions/losses

### Phase 3 — D13: PSD layer masks
- Use @webtoon/psd decoder (installed but unused)
- Extract layer masks, vector masks, channels, flags, density, feather
- Convert to canonical Strata mask model
- Import report

### Phase 4 — D9: Adaptive contrast text
- Backdrop sampling (analytical, region-scoped)
- Contrast policy with configurable candidates + hysteresis
- Inspector UI controls
- Export baking behavior

### Phase 5 — D11: PDF structural masks + raster fallback
- Rust print engine: soft masks (SMask), transparency groups
- Granular preflight outcomes replacing broad rejections
- Export UI for compatibility mode

### Phase 6 — D10: Structured alpha/luminance export
- Per-format capability matrix (SVG ✅, PDF via D11)
- Export UI messaging for preserved/converted/rasterized

### Phase 7 — D14: WebGPU eligibility + diagnostics
- Enhanced runtime checks beyond `navigator.gpu`
- Diagnostics UI for renderer/provider status
- Tests for false-positive scenarios

### Phase 8 — D15: Visual fixtures + platform coverage
- Playwright visual regression for masks/contrast
- Many-mask performance tests
- Cross-platform smoke tests

## Architecture Decisions

1. **One canonical mask model** — all importers convert to `Mask` union
2. **Capability matrix per format** — no implicit booleans
3. **Granular compatibility outcomes** — preserved/converted/rasterized/blocked
4. **Import reports** — structured warnings with codes, not strings
5. **Adaptive contrast is analytical** — no full-canvas readbacks
