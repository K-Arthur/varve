# Image Trace — research and capability audit (2026-09-13, amended 2026-09-14)

Owner: vectorization session (`docs/agents/vectorization-2026-09-13-ownership.md`).
The first pass accessed sources on 2026-09-13. The follow-up source check and
repository verification were completed on 2026-09-14. Facts are separated
from repository observations, hypotheses, and product decisions.

## 1. External sources examined

| Source | Version / date | Finding | Consequence for Varve |
|---|---|---|---|
| [Adobe Illustrator Image Trace options](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/image-trace-panel-options.html) | official page read 2026-09-14; current page last updated 2026-02-11 | Reference capability set (not copied): color/grayscale/B&W modes, palette, Paths/Corners/Noise, Ignore White, Transparency, Fills/Strokes/Gradients, Abutting versus Overlapping, and Info diagnostics for paths/anchors/colors | Varve should expose structure (cutout versus stacked), explicit background policy, and honest per-mode controls. The previous 403 note is superseded; the page is now directly verified. |
| [VTracer README and releases](https://github.com/visioncortex/vtracer/releases) | exact release inspected: `1.0.0-alpha.4`, released 2026-08-29; README/API read 2026-09-14 | MIT. Pipeline covers segmentation, curve fitting, color fitting, output optimization. Key features include `hierarchical cutout` with shared-boundary handling, `hierarchical stacked`, `simplify`, OKLab `max_colors`, Bradley–Roth `adaptive`, watershed clustering, pixel mode, and speckle filtering. The release is explicitly alpha/prerelease. | These are comparison points, not an integration recommendation. Shared-boundary simplification and stacked emission remain useful quality targets; Varve keeps its existing Rust/TS engine because adding a second whole engine would increase topology, provider, memory, and lifecycle risk. Re-evaluate only against a pinned stable release and a license/maintenance review. |
| [Potrace algorithm paper and project](https://potrace.sourceforge.net/potrace.pdf) | 1.16 project/paper, 2019-09-17; checked 2026-09-14 | GPL-2.0-or-later. Binarize → decompose → optimal polygon → curve optimization; `turdsize`, `alphamax`, `opttolerance`, and `turnpolicy` are behavior references. Potrace offers a separate commercial licensing route. | **Do not vendor Potrace source.** GPL compatibility and a second binary engine need a separate legal and artifact review. Varve's own Rust/TS implementations remain the production path. `alphamax` is analogous to `cornerAngle`; `turdsize` to `minArea`; `opttolerance` to the bounded fitting/simplification budget. |
| [Inkscape tracing guide](https://inkscape-manuals.readthedocs.io/en/latest/tracing-an-image.html) | 1.3 (read 2026-09-14) | Conversion is not guaranteed faithful; multicolor traces quickly become hard to edit; warns about complexity | Varve must keep preset descriptions honest and show complexity diagnostics (already partially present). |
| [HTML Living Standard — canvas](https://html.spec.whatwg.org/multipage/canvas.html) | living standard | Pixel-manipulation methods (`putImageData`) are not affected by the current transformation matrix, `globalAlpha`, clipping, or compositing | **Confirmed root cause of the preview compositing bug**: `drawPreview` scaled and set `globalAlpha` before `putImageData`. Fixed by drawing the prepared source through an offscreen canvas with `drawImage`. |
| [SVG 2 painting / fill-rule](https://www.w3.org/TR/SVG2/painting.html) | SVG 2 (W3C) | `fill-rule` is `nonzero` by default; `evenodd` is the choice for compound paths with holes; open subpaths are implicitly closed for filling | Inserted trace paths must declare `fillRule: 'evenodd'` together with `holes`, and preview must use the same rule. Stacked output must not emit `holes` at all. |
| [WCAG 2.2 SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | W3C | Any drag operation needs a single-pointer, non-drag alternative | Preview comparison/zoom controls must be buttons/segmented controls, not drag-only sliders. |

Model/dependency check: no learned vectorization model exists in the trace
path. `varve-upscale`/`varve-bgremove` ONNX providers are unrelated to trace
dispatch and were not touched. ONNX Runtime web deployment guidance was
reviewed previously by the upscale work; adding an ONNX dependency to tracing
is out of scope and unjustified without ablation evidence.

### Follow-up source and contract check (2026-09-14)

- Adobe's official options page is now directly accessible, so the earlier
  403 observation must not be carried forward as if it were a product fact.
  Its documented distinction between abutting and overlapping output supports
  Varve's explicit `cutout`/`stacked` wording, but does not prove that Varve's
  independent simplification is seam-free.
- VTracer `1.0.0-alpha.4` is still a prerelease. Its current Rust/Node API
  and release artifacts were inspected, but no dependency was added: a whole
  alternate tracing engine would duplicate topology, provider, cancellation,
  memory, and export contracts. This is a product decision, not a claim that
  VTracer is low quality.
- The native IPC contract has two mode fields with different responsibilities:
  the editor's `mode` selects grayscale/color/pixel-art intent, while Rust's
  `traceMode` selects `silhouette`/`centerline`/`pixel_art`. Before the
  follow-up fix, desktop grayscale omitted `maxColors` (Rust then defaulted to
  monochrome) and pixel-art sent `silhouette` (Rust then traced a silhouette).
  The adapter now translates those values explicitly and has a regression test
  for the exact camelCase wire payload. This was a repository root cause, not
  an upstream algorithm limitation.

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
| Preview is detailed but Apply is smoother/different | [r/Inkscape, 2026-08-25](https://www.reddit.com/r/Inkscape/comments/1vy3cim/preview_for_trace_bitmap_not_previewing_what_it/) | A common workflow complaint; preview and committed paths are separate trust surfaces | Varve uses the same fitted display paths for preview and insertion; final-resolution differences remain labeled |
| Transparent artwork collapses to all black/white or loses white interiors | [r/Inkscape, 2024-10-08](https://www.reddit.com/r/Inkscape/comments/1fz35g1/trace_bitmap_only_showing_complete_black_or_white/) and [r/Inkscape, 2025-02-14](https://www.reddit.com/r/Inkscape/comments/1ipgtd0/trace_bitmap_turns_white_transparent/) | Alpha/background policy is easy to misread and white artwork is often dropped | Border-connected removal is explicit and preserves enclosed white; alpha and background fixtures are required |
| White seams/lines appear between colour regions | [Adobe Community](https://community.adobe.com/questions-652/image-tracing-problems-762957) and [r/Inkscape](https://www.reddit.com/r/Inkscape/comments/rp9w97/trace_bitmap_leaving_white_gaps_spots/) | Independently simplified abutting contours can expose the backdrop | Varve exposes `stacked` as the mitigation; shared-chain cutout simplification remains partial |
| Too many paths or fragile geometry makes editing/export painful | [r/Inkscape](https://www.reddit.com/r/Inkscape/comments/142jl20/traced_import_with_multiple_paths_but_already_saved_as_svg/) | Path count and topology are part of quality, not just visual similarity | Diagnostics report paths/anchors/holes and max-path/omitted-hole degradation; no promise of semantic reconstruction |

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

### Follow-up capability matrix: state, risk, and reproduction

This matrix is intentionally compact. “Unverified” means that the repository
has no evidence for the claim; it is not a negative result. Fixtures refer to
the synthetic and browser fixtures in `tests/e2e/canvas/image-trace.spec.ts`
and the Rust/TS contour tests.

| Capability / failure surface | State | Severity | Affected environments | Reproduction fixture | Root-cause evidence | Regression evidence |
|---|---|---:|---|---|---|---|
| Desktop grayscale and pixel-art intent reaches the native algorithm | Fixed | High | Tauri desktop before `779452dd7` | 2-colour/16-colour mode requests | Adapter sent no grayscale `maxColors` and sent `silhouette` for pixel-art | `nativeTraceProvider.test.ts` exact wire-payload assertions |
| Preview geometry equals inserted cubic geometry | Working | High | Web + desktop | donut/curved colour fixture | Preview and insertion share `buildDisplayPaths`/fit path | preview-path unit tests + image-trace E2E pixel checks |
| Prepared raster scale/opacity is composited correctly | Working | High | Browser canvas | transparent prepared-source fixture | Canvas spec excludes `putImageData` from transform/alpha | preview unit test + E2E source/overlay pixels |
| Holes, nested islands, and closed centerline loops | Working | High | Rust/native; fallback holes in supported modes | donut, nested-ring, skeleton-loop fixtures | contour ownership and loop insertion rules | Rust contour/centerline tests + E2E donut |
| Colour seams in independently simplified cutout paths | Partial | Medium/High | All colour providers at high tolerance | touching-colour regions | contours are simplified independently | stacked/cutout unit coverage; shared-chain test remains missing |
| Visible appearance (mask/crop/effect/backdrop) tracing | Missing | High | All | transformed/masked image fixture | no renderer capture contract in trace input | UI warning only; no passing implementation test |
| Re-trace source identity for same external URI with changed bytes | Partial | Medium | Linked/external assets | same URI, replacement bytes | current identity is a source-string hash, not content-addressed bytes | metadata tests cover source-string change; same-URI byte-change remains unverified |
| Gradients, semantic text, and primitive recovery | Missing | Medium | All | gradient/text/primitive fixtures | no supported editable representation in provider contract | deliberately not promised in UI/site copy |
| Native/WASM byte-identical output | Unverified | Low | Desktop vs web | same prepared fixture | providers use separate implementations | parity is capability/topology/determinism; no byte-golden claim |

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

- Adobe's options page was directly verified on 2026-09-14, but the product
  descriptions remain reference capabilities rather than Varve requirements.
- VTracer was read at exact prerelease `1.0.0-alpha.4`; prerelease details may
  change, so no API or output contract is treated as stable.
- Shared-boundary cutout was not implemented here; stacked mode reduces but
  does not provably eliminate seams at high simplification tolerances. This is
  recorded as a known limitation with a reproducible fixture.
- Native/WASM parity is defined as capability + topology + determinism, not
  byte-identical anchors (documented in the architecture doc).
