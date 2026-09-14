# Image Trace — research and capability audit (2026-09-13)

Owner: vectorization session (`docs/agents/vectorization-2026-09-13-ownership.md`).
All sources accessed 2026-09-13. Facts are separated from repository
observations, hypotheses, and product decisions.

## 1. External sources examined

| Source | Version / date | Finding | Consequence for Varve |
|---|---|---|---|
| Adobe Illustrator Image Trace options (helpx.adobe.com) | blocked (HTTP 403) — no direct capture; used [Adobe Community reports](#3-failure-modes-users-report) as evidence instead | Documented capability set (reference only, not copied): trace presets, mode (color/grayscale/B&W), palette, paths/anchors, corners, noise, "ignore white", abutting vs overlapping output, strokes vs fills, transparency handling | Varve should expose structure (abutting/cutout vs stacked), explicit background removal, and honest per-mode controls. Not claimed as implemented unless verified. |
| [VTracer README](https://github.com/visioncortex/vtracer) | 1.0.0-alpha.4 (master, read 2026-09-13) | MIT. Pipeline covers segmentation, curve fitting, color fitting, output optimization. Key features: `--hierarchical cutout` (true seam-free mosaic with shared boundaries), `--hierarchical stacked` (default; stacking avoids holes), `--simplify` (paper.js-style, shared boundaries simplified once in cutout), `--palette`/`--max-colors` (OKLab), `--adaptive` Bradley–Roth thresholding, watershed clustering, pixel mode, speckle filter | These are the capabilities Varve's color modes should be measured against. Stacked emission and adaptive thresholding are the highest-value, lowest-risk additions; shared-boundary cutout is the correct long-term fix for seam artifacts. VTracer is MIT but is a whole new engine — no vendoring considered for this pass; Varve's existing engine is extended instead. |
| [Potrace](https://potrace.sourceforge.net/) | 1.16 (2019-09-17) | GPL-2.0-or-later. Algorithm: binarize → decompose → optimal polygon → curve optimization. Options: turdsize, alphamax (corner threshold), opttolerance, turnpolicy. Dual licensing via Potrace Professional (Icosasoft) for proprietary integration | **Do not vendor Potrace source.** GPL is incompatible with Varve's licensing. Varve's own Rust/TS implementations remain the path; Potrace is a behavior reference only. `alphamax` ≈ Varve `cornerAngle`; `turdsize` ≈ `minArea`; `opttolerance` ≈ `optimizeTolerance` (not exposed). |
| [Inkscape tracing guide](https://inkscape-manuals.readthedocs.io/en/latest/tracing-an-image.html) | 1.3 (read 2026-09-13) | Conversion is not guaranteed faithful; multicolor traces quickly become hard to edit; warns about complexity | Varve must keep preset descriptions honest and show complexity diagnostics (already partially present). |
| [HTML Living Standard — canvas](https://html.spec.whatwg.org/multipage/canvas.html) | living standard | Pixel-manipulation methods (`putImageData`) are not affected by the current transformation matrix, `globalAlpha`, clipping, or compositing | **Confirmed root cause of the preview compositing bug**: `drawPreview` scaled and set `globalAlpha` before `putImageData`. Fixed by drawing the prepared source through an offscreen canvas with `drawImage`. |
| [SVG 2 painting / fill-rule](https://www.w3.org/TR/SVG2/painting.html) | SVG 2 (W3C) | `fill-rule` is `nonzero` by default; `evenodd` is the choice for compound paths with holes; open subpaths are implicitly closed for filling | Inserted trace paths must declare `fillRule: 'evenodd'` together with `holes`, and preview must use the same rule. Stacked output must not emit `holes` at all. |
| [WCAG 2.2 SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | W3C | Any drag operation needs a single-pointer, non-drag alternative | Preview comparison/zoom controls must be buttons/segmented controls, not drag-only sliders. |

Model/dependency check: no learned vectorization model exists in the trace
path. `varve-upscale`/`varve-bgremove` ONNX providers are unrelated to trace
dispatch and were not touched. ONNX Runtime web deployment guidance was
reviewed previously by the upscale work; adding an ONNX dependency to tracing
is out of scope and unjustified without ablation evidence.

## 2. Repository observations (verified by reading code, 2026-09-13)

Marked **[R]** to distinguish from external facts.

1. **[R] Preview does not match committed geometry.** `drawPreview`
   (`packages/editor/src/logo/vectorization/preview.ts:164-204`) draws every
   path with `moveTo`/`lineTo`, ignoring `handleIn`/`handleOut` cubic handles.
   Insertion (`imageOperations.ts:613-621`) fits cubics (or keeps provider
   handles), so preview shows polygons while the document shows curves.
2. **[R] Preview compositing is spec-invalid.** `ctx.scale()` + `globalAlpha`
   are set before `putImageData`, which the canvas spec ignores. Result: source
   drawn unscaled and fully opaque, overwriting any scaled geometry beneath.
3. **[R] Centerline preview color is theme-derived**
   (`preview.ts:154-156`, `198-199`), but committed centerline strokes are
   black (`imageOperations.ts:543-557`). Switching theme changes the preview
   but not the artwork — exactly the failure mode the task forbids.
4. **[R] Closed centerline loops are inserted as filled shapes.**
   `makeTraceChildNode` decides fill vs stroke from `traced.closed` only.
   Native centerline always emits `closed: false` today (`varve-trace/src/lib.rs:694-699`),
   so loops are not preserved; if a provider emitted a closed stroked path it
   would become a black blob.
5. **[R] Hole rings are not closed in the preview.** `drawPreview` calls
   `closePath()` once after appending all hole subpaths, so only the last
   subpath closes.
6. **[R] Reproducibility is incomplete.** `TraceMetadata` (schema v1) stores
   most options but `settingsFromTraceMetadata` resets `prep` to defaults
   (`metadata.ts:76`), and `traceEngineLabel()` guesses from the environment
   instead of recording the provider that actually produced the result.
7. **[R] Silent background removal.** Color/grayscale modes drop any
   near-white palette bucket covering >40% of pixels
   (`rasterTrace.ts:554-556`; Rust `lib.rs:783-787`). White artwork or a large
   enclosed white area can disappear with no warning or control.
8. **[R] Two provenance models, one wired.** `GroupNode.traceMetadata` is used
   by the dialog; `ShapeNode.liveTrace` (`packages/scene/src/liveTrace.ts`) and
   `insertLiveTraceGroup` have **no production callers** (tests only). The
   renderer consults `liveTrace` (`render/sceneToEngine.ts:267`) but nothing
   creates it. It is a dormant, competing lifecycle; no orphaning occurs today
   because it is unreachable, but it must not be presented as a live workflow.
9. **[R] Area sort is not an area.** Rust `sort_paths_by_area_desc`
   (`lib.rs:862-870`) sums `x*y` instead of the shoelace area. maxPaths
   truncation can therefore keep the wrong paths. TS `polygonArea` is correct.
10. **[R] Centerline is native-only and honest about it**; web disables it with
    a reason (`traceDispatch.ts:74-80`). TS fallback throws rather than
    degrading to filled outlines (`rasterTrace.ts:761-765`).
11. **[R] Preview and final resolutions are capped** at 1024 / 4096 px; distance
    and area settings are scaled into the processing raster
    (`preview.ts:42-69`).
12. **[R] One dialog, many entry points** (Object menu, canvas/Layers context
    menus, command palette, Inspector, QuickBar) — all go through
    `openVectorizeDialog`.
13. **[R] E2E coverage exists** for menu trace + single undo, pixel-art preset,
    Edit Trace round trip, and the honest disabled state
    (`tests/e2e/canvas/image-trace.spec.ts`). It does not inspect preview
    pixels, preview-vs-committed agreement, provider reporting, or background
    handling.

## 3. Failure modes users report (external)

Community reports were used to choose what to fix first. Access date
2026-09-13.

| Reported failure | Source | Varve status before this work | Action taken |
|---|---|---|---|
| Traced paths not closed; detail "bleeds out" (2025 Illustrator regression) | Adobe Community 816501 | Monochrome compound holes exist; color seams can still show | Preview fidelity + honest structure controls; closed-loop centerline fix |
| White flecks/gaps between abutting paths at high zoom, unpredictable; "abutting" makes it worse | Adobe Community 761173, 824160 | Abutting color regions are traced and simplified independently → possible hairline gaps | Stacked structure option + explicit structure label; shared-boundary cutout documented as the remaining gap |
| Fine detail missing; suspected internal blur/downsampling; "paths 100%" gives blocky 72 dpi edges | Adobe Community 764360; uservoice 51608315 | Preview 1024 / final 4096 cap, never described as full source resolution | Effective resolution now recorded in metadata and shown; cap disclosed in UI copy |
| Traced letters split into 2–3 paths; transparent rogue paths move together | Adobe Community 766452 | Not applicable (Varve inserts plain editable paths, no live effects) | Preserved: no live-trace coupling is introduced |
| Tiny holes left behind after cleanup; users want quick removal | r/AdobeIllustrator 1s7g7cj | `minArea` filters small regions; holes follow compound rules | Explicit minimum region area retained; stacked mode merges sub-threshold holes into the parent instead of leaving specks |
| Inkscape brightness cutoff misses/fills letters; light grey lost | r/Inkscape 1o634jo, 1muzk2w | Threshold slider + grayscale prep exist | Adaptive threshold added for uneven scans |
| Preview looks perfect, Apply produces blocky mess | r/Inkscape 1gl4zmy | Preview and final use different resolution — honest label exists | Preview now uses the same curve-fitting path as insertion; resolution difference still disclosed |
| Faint rectangular artifact around traced transparent PNG (Voronoi/pixel-art) | r/Inkscape 1j3mlp4 | Pixel-art traced exact pixel regions; a border-touching region becomes a full-canvas rect if the source has an opaque border | Background removal now defaults to physical, border-connected white removal; pixel-exact behavior unchanged for opaque art |
| Multicolor trace leaves holes/gaps; Stack leaves tails | graphicdesign.stackexchange 169653 | Same abutting limitation | Stacked mode added; seams documented and measured |
| Centerline vs outline confusion ("single black lines" become filled compound shapes) | r/Inkscape 1ifregl | Centerline mode exists natively and is labeled; web explains unavailability | Preview now strokes centerline exactly as committed; closed loops stay stroked |
| Traced result changes with theme/display mode | r/Inkscape 1ifregl (display mode) | Centerline preview changed with theme | Artwork rendering is now theme-independent (theme used only for chrome) |

## 4. Capability matrix (after this work unless marked otherwise)

| Capability | State | Evidence / test |
|---|---|---|
| Monochrome silhouette w/ holes | Working | Rust + TS unit tests; E2E donut |
| Grayscale/color quantized silhouette | Working | Unit tests; Oklab median cut |
| Pixel-art exact/near-exact regions | Working | Rust/TS unit tests; E2E preset |
| Centerline (native only) | Working | Rust unit tests; capability-gated on web |
| Closed centerline loops preserved as strokes | Fixed in this work | Rust + insertion tests |
| Preview uses committed cubic handles / same fit | Fixed in this work | `previewPaths` unit tests; E2E pixel check |
| Preview source compositing (scale/alpha) | Fixed in this work | Unit test on recording context; E2E pixel check |
| Theme-independent artwork preview | Fixed in this work | Visual capture light/dark |
| Explicit connected-background removal | Added | Unit tests (enclosed white preserved) |
| Stacked output structure for color modes | Added (TS + Rust) | Unit tests; quality corpus comparison |
| Adaptive (Bradley–Roth) threshold prep | Added (prep is provider-independent) | Unit tests; scan fixture |
| Effective resolution + provider in provenance | Added | Metadata round-trip tests |
| Prep settings restored on Edit Trace | Fixed | Metadata round-trip test; E2E re-trace |
| Source revision hash in provenance | Added (cheap src identity hash) | Metadata test |
| Visible-appearance tracing (crop/mask/effect) | Missing (documented) | UI discloses source-only capture |
| Shared-boundary (cutout) simplification | Missing (documented) | Stacked mode mitigates; measured gap counts |
| `liveTrace` non-destructive pipeline | Dormant/missing (tests only) | Ownership note; no UI promise |
| Gradient/primitive recovery | Missing (documented) | Not promised in copy |
| Model-assisted tracing | Missing (deliberate) | No ONNX dependency in trace dispatch |

## 5. Product decisions

1. **Extend, do not replace.** No VTracer/Potrace vendoring. Keep the Rust
   engine as the desktop production path and the TS provider chain as the
   honest web fallback.
2. **Correctness before features.** Preview/committed agreement, theme
   independence, centerline loop semantics, provenance, and honest background
   handling come before palettes/gradients.
3. **Explicit structure.** `stacked` (paint back-to-front, no holes except
   transparent interiors) is added; `cutout` remains the compound-hole mode.
   Default stays `cutout` for logos/monochrome and `stacked` is selectable for
   color/photo work.
4. **Explicit background policy.** "Remove white background connected to the
   image edge" replaces the hidden >40% bucket heuristic. Enclosed white must
   survive; the option can be turned off.
5. **Measure before claiming.** Every added behavior gets a unit test and, for
   visual behavior, a Playwright pixel or screenshot check; screenshots are
   inspected, not merely captured.

## 6. Uncertainty / limits

- Adobe's options page could not be fetched (403); the capability list is
  treated as orientation from community reports, not a verified spec.
- VTracer was read at `1.0.0-alpha.4` master; prerelease details may change.
- Shared-boundary cutout was not implemented here; stacked mode reduces but
  does not provably eliminate seams at high simplification tolerances. This is
  recorded as a known limitation with a reproducible fixture.
- Native/WASM parity is defined as capability + topology + determinism, not
  byte-identical anchors (documented in the architecture doc).
