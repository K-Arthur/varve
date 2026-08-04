# Effects System & Halftone Audit

**Date:** 2026-07-06 | **Scope:** `@varve/engine`, `@varve/scene`, `@varve/editor`, `@varve/codegen`, `crates/strata-print`, `crates/strata-core`

---

## Executive summary

Strata has **two parallel adjustment/effect systems** in the document model. The `Effect[]` array (drop shadow, inner shadow, layer blur, background blur, outer/inner glow) is mature: stacked, reorderable, tested, and rendered. The **halftone/curves/levels/etc. adjustment stack** (`Adjustment[]` on `AdjustmentNode`) is architecturally the more advanced, Figma/Photoshop-style non-destructive model — but before this session it was **broken at every layer**: unreachable from the UI, silently dropped by the renderer, missing from the type conversion that feeds the renderer, and absent from every export target's gap reporting.

This session made the adjustment stack fully functional end-to-end for the first time, with halftone as the flagship case, and fixed a from-scratch pixel-level bug in CMYK halftone screening. All fixes are TDD (failing test first) and the full engine/scene/codegen/editor suites are green (2638/2640 tests; the 2 remaining failures — `RefineMaskTool` and `CurveEditor` — are pre-existing and unrelated to effects).

---

## 1. Research findings (industry patterns)

| Pattern | Who does it well | Strata fit |
|---|---|---|
| Non-destructive live effect stack, no "apply" step | Figma, Sketch (plain layer properties) | Matches Strata's `Adjustment[]` model — this session made it actually work |
| Smart-object/live-filter wrapper | Photoshop Smart Filters, Affinity Live Filter Layers | Strata's `AdjustmentNode` (separate node, affects layers below) is the wrapper equivalent |
| Per-channel CMYK screen angles for halftone | Photoshop Color Halftone | Implemented (`STANDARD_ANGLES` c/m/y/k); single-channel screens honor a user angle instead (see §4) |
| Raster-only halftone, resolution set by document settings | Illustrator (Document Raster Effects Settings), Photoshop | Strata is CPU raster-only today; no vector-halftone-as-geometry (no major tool does this natively either — plugin/manual-trace territory) |
| GPU-accelerated live filter recompute | Affinity (Metal / DirectX12+OpenCL) | Strata's WebGPU backend does not apply filters/effects at all today — dormant, unreachable from the running app (see §4) |
| FM/stochastic + blue-noise screening | Print RIPs, creative-coding shaders | Strata already implements both AM and FM halftone screening. FM has **two paths**: Floyd-Steinberg error diffusion (serpentine scan, export quality) and Bayer ordered dithering (8×8 matrix, position-stable preview) |
| Explicit per-target export-gap reporting | — (less common; most tools just rasterize) | Now implemented for the adjustment stack across all 5 codegen targets + PDF (see §5) |

**User friction (industry, informing priorities):** Photoshop nested Smart Objects cause severe memory bloat; Affinity's halftone lacks per-channel angles (users request real screen-printing controls); Figma's procedural effects (Texture) have no faithful vector/SVG export path — the same "raster effect, honest-or-silent export gap" tension Strata now handles explicitly instead of silently.

**Emerging technique not implemented anywhere surveyed:** shader/procedural halftone computed per-pixel on GPU, resolution-independent by construction. Noted as a future roadmap item (§8), not attempted this session — it would be a rendering-architecture change, not a bug fix.

---

## 2. Architecture before this session (evidence-based)

Two independent systems both claiming to represent "an effect":

```
Effect[]                              Adjustment[] (Phase 5 stack)
  dropShadow / innerShadow /            halftone / curves / levels / exposure /
  layerBlur / backgroundBlur /          selectiveColor / colorBalance /
  outerGlow / innerGlow                 channelMixer / photoFilter / ...(20 kinds)
  ↓                                     ↓
  stacked on every visual node          lives only on AdjustmentNode
  (ShapeNode.effects, etc.)             ("layers below" adjustment layer)
  ↓                                     ↓
  EffectsSection.tsx (mounted,          AdjustmentPanel.tsx + AdjustmentEditor.tsx
  well-tested, reorderable UI)          (fully built — but NEVER MOUNTED;
                                         PropertiesPanel rendered the legacy
                                         AdjustmentSection.tsx instead, which
                                         edited node.adjustmentType/params —
                                         fields the renderer never reads)
  ↓                                     ↓
  replay.ts renders directly            CanvasArea.tsx converts .adjustments
                                         → adjustmentsToFilters() → FilterIR
                                         → replay.ts → filterCompositor.ts
                                         → halftone.ts / adjustment/*.ts
```

The rendering path for the adjustment stack is real and reasonably sophisticated (CSS-filter fast path for simple adjustments, offscreen-canvas compositing for complex ones, dedicated halftone AM/FM screening engine) — it was simply disconnected from a working UI and had its own internal bugs.

---

## 3. Bugs found and fixed (root cause, not symptom)

| # | Bug | File(s) | Impact | Status |
|---|---|---|---|---|
| 1 | `adjustmentToFilter()` had no `case 'halftone'` — fell through to `default`, silently substituting an inert `{kind:'opacity', value:100}` filter | `engine/src/filters.ts` | Halftone could never reach the renderer even if constructed programmatically | **Fixed** + test |
| 2 | `adjustmentDefaults()` had no `case 'halftone'` — `pattern`/`frequency`/`angle`/`dotShape`/`channel`/`method` all `undefined` on creation | `engine/src/filters.ts` | Any halftone adjustment created was malformed | **Fixed** + test |
| 3 | `replay.ts`'s post-render `complexFilters` predicate omitted the "no CSS equivalent" clause that the earlier `needsPostRenderFilters` check correctly includes | `engine/src/replay.ts` | **Every** non-CSS adjustment (halftone, curves, levels, selectiveColor, exposure, sharpen, temperature, tint, colorBalance, channelMixer, photoFilter — 11 of 20 kinds) at default blend/opacity was computed nowhere: excluded from the CSS path (no CSS string exists) *and* excluded from the pixel path (didn't meet the complex-filter condition) | **Fixed** + regression test (spy on `applyFilterWithCompositing`) |
| 4 | CMYK halftone screening wrote each ink channel's on/off decision into the RGBA byte at that channel's *index* (`ciIdx = idx + ci`), so the K channel (`ci=3`) wrote into the **alpha byte** | `engine/src/halftone.ts` | CMYK halftone corrupted alpha and produced meaningless RGB (byte values were per-channel binary states, not colors) | **Fixed**: each ink now screened independently (own luminance + own standard angle) and recombined via subtractive overprint into RGB; alpha untouched. + 3 tests |
| 5 | Single-channel (k/c/m/y) halftone silently ignored the user's `angle` parameter — `STANDARD_ANGLES[channel]` always won over `params.angle` | `engine/src/halftone.ts` | The angle control (about to be wired into the UI) would have been a placebo for the common mono-halftone case | **Fixed**: mono path now honors `params.angle` directly; only the multi-channel cmyk path is locked to the moiré-safe standard angles |
| 6 | Two structurally incompatible types both named/claimed `kind: 'adjustment'`: `AdjustmentNode` (`scene/types.ts`, canonical, in `SceneNode` union) and `AdjustmentLayerNode` (`scene/adjustments.ts`, required `adjustments`, never in the union) | `scene/adjustments.ts`, `editor/AdjustmentPanel.tsx`, `editor/AdjustmentLayerRow.tsx` | Unsafe casts (`as AdjustmentLayerNode`); `AdjustmentPanel`'s unguarded `[...an.adjustments, adj]` spread would throw if `adjustments` were ever undefined | **Fixed**: removed the duplicate type; consumers use `AdjustmentNode` with `?? []` guards |
| 7 | `scene/adjustments.ts` (and its re-exports, including `AdjustmentLayerNode`/`Adjustment`/`AdjustmentKind`) was never exported from `@varve/scene`'s `index.ts` barrel | `scene/index.ts` | `AdjustmentPanel.tsx` and `AdjustmentLayerRow.tsx` imported names from `'@varve/scene'` that did not exist on the public API — a live compile break | **Fixed**: added `export * from './adjustments'` |
| 8 | `HalftoneAdjustment` itself was never added to `@varve/engine`'s or `@varve/scene`'s re-export lists (both list every other `*Adjustment` type by name) | `engine/src/index.ts`, `scene/src/adjustments.ts` | Any code importing `HalftoneAdjustment` by name (including the new halftone editor UI) failed to typecheck | **Fixed** |
| 9 | `AdjustmentPanel.tsx` called `useState`/`useRef`/`useCallback` **after** an early `if (...) return null` — a Rules-of-Hooks violation | `editor/AdjustmentPanel.tsx` | Never surfaced before because the component was never mounted; the very first test that mounted it through a real selection-change (no adjustment → adjustment selected) triggered React's hook-order error | **Fixed**: all hooks moved above the early return; regression test asserts no `console.error` hook-order warning |
| 10 | `AdjustmentPanel`/`AdjustmentEditor` (the correct, rendering-connected stack UI) had **zero mount points** anywhere in the app; `PropertiesPanel.tsx` rendered `AdjustmentSection.tsx` instead, which edits the legacy `adjustmentType`/`params` singleton — fields `CanvasArea.tsx`'s IR conversion never reads | `editor/PropertiesPanel.tsx` | The only reachable adjustment UI in the shipped app edited data with **zero visual effect on canvas**, for all 5 legacy-model kinds (curves/levels/selectiveColor/hsl/exposure), the latter two literally showing "coming soon" | **Fixed**: swapped to `AdjustmentPanel`; deleted the now-superseded `AdjustmentSection.tsx` + test |
| 11 | `HalftoneSection.tsx` (separate, older stub) claimed to offer "pattern, LPI, angle, dot shape, channel, method" controls but rendered only a static status line, and its `hasHalftone` check read `n.filters` — a field that does not exist on any `SceneNode` | `editor/HalftoneSection.tsx` | Always reported "Not applied"; zero mount points anywhere | **Removed** (dead, superseded by `AdjustmentPanel`/`AdjustmentEditor`) |
| 12 | `pixelPipeline.ts` (736 lines) reimplemented curves/levels/selectiveColor/colorBalance/channelMixer/exposure/temperature/sharpen/photoFilter with its own dispatch table, but had zero non-test importers and no halftone support either | `engine/src/pixelPipeline.ts` + test | Dead code, duplicate maintenance surface, itself incomplete | **Removed** (1,159 lines incl. test) |
| 13 | No codegen target (css/svg/swiftui/flutter/tailwind) or PDF export (`strata-print`) inspected `node.adjustments`/`node.filters` at all — an `AdjustmentNode` was silently skipped (SVG emitter's node-kind switch has no `case 'adjustment'`, returns `''`) | `codegen/*.ts`, `strata-print/src/lib.rs` | Halftone/adjustments vanish on every export with no warning | **Fixed**: `adjustmentStackTargetGaps()` shared helper wired into all 5 codegen targets; PDF export emits an honest `% nondestructive adjustment stack ... not rendered` comment |
| 14 | Threshold matrix (`generateAMMatrix`) regenerated from scratch on every `applyAMScreening` call — every frame for a live preview — even though it depends only on `(size, dotShape)` | `engine/src/halftone.ts` | Redundant O(size²) allocation+computation per frame | **Fixed**: `cachedAMMatrix()` memoizes by `${size}:${dotShape}` (capped at 64 entries) |
| 15 (found, not caused, fixed per explicit request) | `replay.test.ts`'s `traceOutline handles rect primitive via rect() call` asserted a `rect()` call on the wrong target — `paintInsetEffect` traces onto a separate offscreen canvas that this test environment's `OffscreenCanvas` polyfill always fails to provide a context for (`getContext()` returns `null`, matching the documented, already-accepted pattern in `replay-fill.test.ts`'s `backgroundBlur gracefully handles unavailable OffscreenCanvas` test) | `engine/src/replay.test.ts` | Test could never pass as written, in any environment, without a native `canvas` dependency | **Fixed**: rewritten to assert the achievable, meaningful behavior (graceful no-throw), matching house convention |

**Not fixed — pre-existing, out of scope, confirmed unrelated to effects/halftone:** `replay.test.ts`'s only other failure at baseline was this same traceOutline test (now fixed); `RefineMaskTool.test.ts` and `CurveEditor.test.tsx` failures observed during full-suite regression runs are unrelated to any file touched this session (mask-tool undo snapshot and an ARIA-role mismatch in a standalone curve widget, respectively) and were left alone per explicit direction.

---

## 4. Rendering architecture — current limitations (documented, not changed this session)

- **GPU path does not apply effects.** `packages/compositor/src/webgpu/backend.ts`'s `isGpuPrimitive` routes solely on primitive kind (rect/circle/line), never inspecting `item.filters`/`item.effects`. If the WebGPU backend were ever enabled (`router.ts` never receives `preferWebGpu: true` from the running app today, so it is dormant), any effect-bearing primitive would silently render as an unfiltered flat GPU shape. Filters/halftone are 100% CPU (`packages/engine`) today.
- **Limited effect caching.** The halftone AM threshold matrix is memoized by `{size,dotShape}` (capped at 64 entries). The Bayer 8×8 ordered dithering matrix for position-stable FM preview is precomputed once at module scope. Backdrop blur has a dedicated 20-entry LRU cache (500ms TTL, keyed by world bounds + transform + radius). All other effect types (drop shadow, inner shadow, layer blur, outer glow, inner glow) and the full pixel computation (screening, curves, etc.) recompute every render call. `packages/compositor/src/canvas2d/tileCache.ts` exists but `Canvas2DBackend.drawVectorItems` never calls `.has()` — draws are never skipped, by explicit design decision.
- **FM halftone has two dispatch paths.** The `applyHalftone()` function accepts optional `offsetX`/`offsetY` parameters. When provided (viewport-tiled preview), it dispatches to **Bayer ordered dithering** for position-stable, pan-invariant screening. When omitted (export path), it uses **Floyd-Steinberg error diffusion** for highest quality. This means the FM preview is a structured threshold dither (visible pattern under zoom), while export gets true error-diffusion quality — a deliberate preview-fidelity vs. performance tradeoff.
- **CMYK halftone is a preview approximation**, not a true separation workflow — it uses an uncalibrated overprint formula (`(1-C)(1-K)`, etc.), not ICC-based CMYK separation. `crates/strata-print/src/cmyk.rs` has real GCR/TAC color-separation math but is entirely disconnected from the halftone/adjustment stack.
- **Rust holds no computation logic for the adjustment stack.** `SceneNode.filters: Option<Vec<serde_json::Value>>` is an untyped pass-through in `strata-core`/`strata-engine`/`strata-bridge`; only `strata-print` was touched this session, and only to add an honest "not rendered" comment, not real rendering.
- **`AdjustmentEditor.tsx`'s curves/levels/selective-color controls are plain number inputs**, not the richer draggable `CurveEditor`/histogram-backed `HistogramWidget`/`SelectiveColorGrid` widgets that the now-deleted `AdjustmentSection.tsx` used. Functionally correct, lower ergonomics — a UX polish item, not a correctness bug (§8).
- **`AdjustmentLayerRow.tsx`** (a fuller layers-panel row for adjustment nodes — add button, adjustment-count badge, visible-adjustment-name preview) has zero mount points; the generic `LayersRow.tsx` renders adjustment nodes with a simpler inline badge instead. Left unwired — a discrete follow-up feature integration, not a bug.

---

## 5. Export fidelity (fixed this session)

| Target | Before | After |
|---|---|---|
| CSS / CSS Modules | Silent drop | `TargetGap` warning: "nondestructive adjustment stack (...)" |
| SVG / SVG component | Silent drop (`AdjustmentNode` hits no case in the node-kind switch, returns `''`) | Same gap warning; node-kind switch behavior unchanged (raster fallback is future work, §8 — would need a canvas-capable dependency in codegen, which doesn't exist today) |
| SwiftUI | Silent drop | Same gap warning |
| Flutter | Silent drop | Same gap warning |
| Tailwind | Silent drop | Same gap warning |
| PDF (`strata-print`) | Silent drop (`node.filters` never read) | Honest `% nondestructive adjustment stack ... not rendered in basic PDF export` comment, matching the existing pattern for `innerShadow`/`outerGlow`/`innerGlow` |

---

## 6. Testing strategy (this session, TDD throughout)

| Area | Tests added | What they catch |
|---|---|---|
| `filters.ts` | 3 (`adjustmentToFilter` halftone round-trip, `adjustmentDefaults`, `makeAdjustment`) | Bugs #1–2 |
| `replay.ts` / `replay-filter.test.ts` | `it.each` over exposure/halftone/curves via a `vi.mock`'d `applyFilterWithCompositing` spy | Bug #3 — the single highest-impact fix in this audit |
| `halftone.ts` | 3 CMYK tests (alpha preservation, valid byte range, saturated-K overprint ratio) + 3 cache tests | Bugs #4–5, #14 |
| `scene/adjustments.ts` | Rewrote the `AdjustmentLayerNode` shape test to construct a real `AdjustmentNode` | Bug #6 |
| `AdjustmentPanel.tsx` (new file, 7 tests) | Renders nothing without selection; shows stack UI; halftone appears in add-menu; adding halftone renders live controls; editing frequency updates state; removing clears controls; **no Rules-of-Hooks console error across the selection transition** | Bugs #9–10 |
| `target-analysis.test.ts` | One "warns for adjustment stack" test per codegen target (5) | Bug #13 (JS side) |
| `strata-print/src/lib.rs` | 2 Rust tests (filters produce comment; empty filters produce no output) | Bug #13 (Rust side) |
| `replay.test.ts` | Rewrote the broken traceOutline test | Bug #15 |
| **Session 47:** `halftone.ts` | +11 (4 Bayer matrix construction + 4 Bayer FM screening + 3 FM dispatch: offset vs. no-offset) | Bayer 8×8 matrix correctness, position stability under identical offsets, pattern change under different offsets, black-count parity with Floyd-Steinberg within 15% tolerance, correct dispatch path selection |
| **Session 47:** `replay.ts` | +6 (backdrop blur LRU cache: hit returns cached, miss captures new, TTL expiry eviction, full-cache LRU eviction at 20 entries, sweep clears expired, cache cleared between tests) | Backdrop blur caching correctness, eviction policy, and TTL enforcement |

**Full-suite result:** 223 test files, 2638/2640 passing across engine/scene/codegen/editor. 93/93 Rust tests in `strata-print`. Typecheck clean on every file touched (2 pre-existing, unrelated type errors elsewhere in the monorepo were left alone; one *was* fixed — an `indexOf`/`document.activeElement` type mismatch introduced by a concurrent formatter pass in `AdjustmentPanel.tsx`, a file this session owns).

---

## 7. Accessibility

- `AdjustmentPanel`'s add-menu retains full roving-tabindex keyboard nav (Arrow keys, Home/End, Escape) — unchanged, now reachable.
- New halftone controls use standard `<select>`/`<input type="range">` with explicit `aria-label`s (Method, Pattern, Dot shape, Channel, Frequency, Angle) — consistent with sibling editors in the same file.
- No new modal/focus-trap surfaces introduced.

---

## 8. Roadmap (prioritized, explicitly deferred — not attempted this session)

| Priority | Item | Why deferred |
|---|---|---|
| P1 | Wire `AdjustmentLayerRow.tsx` into the Layers panel (add button, adjustment-count badge) | Discrete feature integration into actively-changing LayersPanel files; not a correctness bug |
| P1 | Upgrade `AdjustmentEditor`'s curves/levels/selective-color controls to reuse `CurveEditor`/`HistogramWidget`/`SelectiveColorGrid` | UX polish, not correctness — those widgets exist and work, just aren't wired into the new stack UI |
| P2 | SVG raster fallback for the adjustment stack (rasterize to bitmap + embed `<image>`) instead of a gap-only warning | Requires a canvas-capable rendering dependency in `packages/codegen` (currently pure Node/DOM-free) — a real new dependency, not a small fix |
| P2 | GPU-accelerated effect application in the WebGPU backend | The backend is currently dormant/unreachable; building a real effect pipeline for it is a rendering-architecture project, not a bug fix |
| P2 | Per-content-hash caching of full effect *output* (not just the halftone matrix) | **Partially done (Session 47):** backdrop blur has a dedicated LRU cache (20 entries, 500ms TTL). Drop shadow, inner shadow, layer blur, outer glow, and inner glow still recompute every frame. Full caching requires a content-fingerprinting strategy and interacts with the immediate-mode canvas redraw model (`tileCache.ts`'s existing "always replay" design decision) |
| P3 | True vector-halftone-as-geometry (literal per-dot vector nodes) | No major tool does this natively either (Illustrator: manual trace workflow; Figma: plugin-only) — a genuinely new feature, not a gap vs. competitors |
| P3 | Per-ink customizable CMYK screen angles (Affinity-style single angle vs. Photoshop-style per-channel) | Current fixed standard angles are moiré-safe; making them user-editable needs UI + moiré-risk messaging. The Bayer ordered dithering path uses threshold matrices inherently rotation-invariant at the pixel level — per-channel angle support would require rotated Bayer matrices or a separate mechanism for FM |
| P3 | ICC-aware CMYK separation for halftone (bridge to `strata-print/src/cmyk.rs`'s real GCR/TAC math) | Print-production-grade feature; current preview-quality overprint approximation is adequate for screen/social/marketing workflows |
| P3 | Rust-side typed adjustment stack (replace `serde_json::Value` pass-through) | Only matters once Rust actually consumes the field for something (e.g. native PDF rasterization) |

---

## 9. Technical debt (explicitly not resolved)

- `AdjustmentNode` still carries the legacy `adjustmentType`/`params` singleton fields (required, not optional) alongside the modern `adjustments?: Adjustment[]` stack, for document-schema backward compatibility. No document migration was written to backfill old single-slot data into the stack — existing serialized documents that only ever used the legacy fields will show no adjustment in the new UI. A formal schema migration is future work.
- `crates/strata-core`/`strata-engine`/`strata-bridge`'s `filters: Option<Vec<serde_json::Value>>` remains untyped; this is a real, standing type-safety gap for any future Rust-side consumer.
- Two other components with zero mount points were left in place rather than deleted, since (unlike the confirmed-dead `HalftoneSection.tsx`/`AdjustmentSection.tsx`/`pixelPipeline.ts`) they represent plausible near-term follow-up work rather than superseded code: `AdjustmentLayerRow.tsx` (§8, P1).

---

## References

- `packages/engine/src/halftone.ts`, `filters.ts`, `filterCompositor.ts`, `replay.ts`
- `packages/scene/src/adjustments.ts`, `types.ts`
- `packages/editor/src/components/AdjustmentLayer/`, `Inspector/PropertiesPanel.tsx`
- `packages/codegen/src/shared.ts` (`adjustmentStackTargetGaps`), `target-analysis.ts`
- `crates/strata-print/src/lib.rs` (`render_effects`)
- Research basis for halftone math: Ulichney (Void-and-Cluster 1993), ISO 12647-2, Adobe Accurate Screens, Ghostscript `gxht.c`, Floyd–Steinberg (1975)
- Competitive research: Photoshop Smart Filters/Color Halftone, Figma effects model, Affinity Live Filter Layers, Illustrator Raster Effects Settings
