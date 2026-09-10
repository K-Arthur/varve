# Adjustment-layer workflow audit

Date: 2026-07-23

## Current architecture

Adjustment layers are scene nodes (`AdjustmentNode`) with an ordered, versioned
`adjustments` array. The scene package owns schemas, defaults, validation,
migration, scope resolution, and cloning. The engine converts those adjustments
to the existing `FilterIR` and applies Canvas2D/CSS or software kernels. The
editor owns creation, history, the inspector, and the structural Canvas2D replay
path. This is the correct consolidation boundary; a second UI-only effects model
must not be introduced.

The compatible implemented effects are LUT, duotone, tritone, halftone,
gradient map, brightness, contrast, exposure, levels, curves, hue/saturation,
vibrance, color balance, black and white, posterize, threshold, selective color,
channel mixer, invert, photo filter, and the existing portable filter effects.

## Root causes found

- The add-filter menu re-focused its first child on every bubbled focus event,
  so pointer and keyboard selection snapped back to Brightness.
- Levels and Curves used parameter shapes that did not match their engine
  kernels. Levels became an identity transform and Curves could produce black.
- The post-render compositor assigned `ctx.filter` after artwork had already
  been drawn. Simple filters therefore affected only a hypothetical later draw.
- Adjustment-only scenes could take the ordinary worker/IR path, where the
  zero-area adjustment IR item cannot process the backdrop.
- LUT layers were created with node opacity zero as a renderer sentinel,
  conflicting with real layer-opacity semantics.
- The legacy "below" resolver used the wrong sibling direction. The 2.2 to 2.3
  migration could also create an invalid empty target id.
- Generic fill, stroke, and legacy-effects inspector sections appeared beside
  the canonical adjustment editor, exposing unrelated fields and suggesting a
  duplicate effects pipeline.
- Stack drag affordances were decorative; per-effect opacity, blending,
  duplication, reset, and keyboard-accessible ordering were absent.
- Continuous slider updates created many history snapshots.

## Implemented semantics and fixes

- Filter choice follows the actual activated menu item and restores focus to the
  Add button when the menu closes.
- Adjustment effects remain ordered scene data and are converted through the
  shared `FilterIR`; Levels and Curves now use the kernel parameter contracts.
- Post-render filters always process an intermediate surface, with a portable
  software fallback when a surface or Canvas filter is unavailable.
- A visible active adjustment forces structural compositing.
- Layer opacity and effect opacity are independent; new LUT layers start at
  visible layer opacity.
- Legacy "below" means earlier siblings because scene child arrays are
  bottom-to-top. Clipped migrations target the immediate eligible sibling and
  omit invalid scope rather than persisting an empty id.
- Adjustment nodes show only the canonical progressive inspector. The stack has
  accessible select, visibility, remove, move up/down, reset, duplicate,
  per-effect opacity, and per-effect blend controls.
- Pointer and keyboard slider scrubs are coalesced into one history transaction.
- Levels use the histogram control, Curves use the curve editor, duotone exposes
  interpolation, black-and-white exposes tint, and Photo Filter exposes color.

## Remaining architectural work

The current Canvas2D structural renderer still defers adjustment siblings until
after ordinary siblings, uses world-space bounds when copying a backing-store
surface, and limits scoped adjustments by a rectangle rather than rendering only
the resolved target subtree. Adjustment masks also pass through container-mask
logic that assumes `children`. These must be replaced by a reusable bounded
backdrop compositor before adjustment masks, nested ordering, zoom/DPR parity,
or export flattening can be considered production-complete.

Raster export does not yet share the structural adjustment compositor. SVG and
PDF paths do not preserve or explicitly rasterize adjustment results. WebGPU
does not implement adjustment shaders and should continue to fall back to the
correct Canvas2D path. LUT asset embedding/link recovery and portability require
an asset-store policy rather than storing only local references.

## Next implementation slices

1. Extract a renderer-independent compositing plan that resolves sibling order,
   target subtree, bounds, masks, opacity, and blend mode.
2. Implement a bounded Canvas2D backdrop surface using backing-store
   coordinates and deterministic nested ordering, then add pixel goldens for
   multiple layers, masks, alpha, zoom, DPR, and groups.
3. Reuse that plan for raster export and add explicit SVG/PDF rasterization
   warnings where vector preservation is impossible.
4. Add dirty-region/cache keys from document revision, scope, effect parameters,
   mask revision, scale, and quality; cancel stale preview work.
5. Add portable embedded LUT assets and missing/corrupt-asset UI.
6. Add GPU kernels only after CPU/Canvas goldens define cross-backend tolerance.

## Verification completed for this slice

- Unit/integration suite: 8,740 passed, 3 skipped.
- Focused adjustment/schema/renderer suite: 203 passed.
- Chromium E2E filter selection: 2 passed, including an off-scroll option.
- TypeScript package and E2E checks passed.
- Formatting, lint (no new touched-file diagnostics), emoji audit, architecture
  health gate, and all 120 WCAG token pairs passed.
- Windows WebView2, macOS WKWebView, Linux WebKitGTK/Tauri, Firefox, WebKit,
  no-GPU, and low-memory runs were not available in this local verification.
