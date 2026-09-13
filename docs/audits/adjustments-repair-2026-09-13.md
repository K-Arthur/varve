# Adjustments repair and verification — 2026-09-13

**Status:** current implementation record
**Owner:** Adjustments integration
**Scope:** adjustment-layer targeting, reference pixel kernels, histogram
diagnostics, and the existing editor/website surfaces

This record accompanies the incremental repairs made on `master`. It is an
implementation record, not a claim of parity with another creative tool.

## Research record

Research was performed on 2026-09-13. The primary references below were
checked before changing the contracts:

| Source | Version/status | Finding used here |
| --- | --- | --- |
| [W3C Filter Effects Level 1](https://www.w3.org/TR/filter-effects-1/) | W3C Working Draft, latest published version accessed 2026-09-13 | Filters operate on a buffered result; a filter list is ordered, and filtering is distinct from clipping, masking, and opacity. |
| [W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/) | W3C Recommendation/technical specification accessed 2026-09-13 | Source-over and group invariance make duplicated parent/child processing and double-applied opacity observable correctness bugs. |
| [W3C CSS Color 4](https://www.w3.org/TR/css-color-4/) | W3C specification accessed 2026-09-13 | sRGB encoded/linear transfer functions and premultiplied-alpha rules are the reference for the exposure and alpha boundary. |
| [WHATWG Canvas 2D](https://html.spec.whatwg.org/multipage/canvas.html) | Living Standard accessed 2026-09-13 | Canvas output is premultiplied and a canvas round-trip may not preserve hidden RGB under transparent pixels; the effect contract therefore remains explicit RGBA8 `ImageData`. |
| [Adobe adjustment and fill layers](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/work-with-adjustment-and-fill-layers.html) | Current help page accessed 2026-09-13 | Adjustment layers are a non-destructive tonal/color workflow, which supports keeping editable parameters authoritative. |
| [Adobe Curves](https://helpx.adobe.com/photoshop/using/curves-adjustment.html) | Current help page accessed 2026-09-13 | Curves expose black/white points and keyboard/point editing; this is a workflow reference, not an algorithm claim. |
| [Krita filter masks](https://docs.krita.org/en/reference_manual/layers_and_masks/filter_masks.html) | Current manual accessed 2026-09-13 | A local filter attachment should retain its source and mask ownership instead of becoming an unrelated global stack. |
| [OpenColorIO authoring](https://opencolorio.readthedocs.io/en/latest/guides/authoring/authoring.html) | Current documentation accessed 2026-09-13 | Input/process/output color-space boundaries must be named; a richer document color model does not make an RGBA8 effect kernel ICC/HDR aware. |
| [OpenColorIO 3DL reader](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/main/src/OpenColorIO/fileformats/FileFormat3DL.cpp) | `main` source accessed 2026-09-13 | Discreet/Flame `.3dl` data uses integer code values, may contain one scalar shaper row, and stores 3D entries blue-fastest; a parser that assumes normalized floats or R-fastest order silently changes a look. |
| [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/) | Current documentation accessed 2026-09-13 | Providers are an optional dispatch layer with ordered fallback; model assistance must not replace the deterministic adjustment path. |

The installed workspace/runtime facts checked locally were pnpm 11.9.0,
Node 26, React 19.2.8, TypeScript 6.0.3, Playwright 1.62.1,
`onnxruntime-web` 1.27.0, WebKitGTK 2.52.6, and GTK 3.24.52. These are
runtime facts for this checkout, not support claims for every Varve build.

## What users have complained about elsewhere

The complaints below were used as failure-mode evidence and translated into
bounded repairs that Varve can actually own:

| Report | Reusable failure mode | Varve response |
| --- | --- | --- |
| [Photopea issue #8350](https://github.com/photopea/photopea/issues/8350) — vector masks on adjustment layers silently fail in a Linux/Firefox workflow | A mask action can appear accepted while the attachment is not usable | Keep scope and mask ownership explicit, report empty/stale targets, and verify the actual rendered workflow rather than treating a control as proof. |
| [Adobe adjustment-layer display bug](https://community.adobe.com/bug-reports-711/dragging-handles-for-adjustment-layer-in-properties-panel-results-in-incorrect-display-if-an-adjustment-layer-above-is-clipping-masked-to-a-0-fill-layer-1641424) — changing a lower adjustment can leave the display wrong until visibility is toggled | Stale dependent previews after an upstream edit | Histogram stage identity now includes the selected entry and upstream stack; subsequent work must keep revisioned compositor invalidation. |
| [Adobe saved adjustment colors bug](https://community.adobe.com/bug-reports-711/p-23-2-issue-previously-saved-files-with-adjustment-layers-open-with-strange-colors-659845/index2.html) — reopening a saved adjustment document can show wrong colors until toggled | Preview/output differs from persisted intent | Parameters and scope remain authoritative; derived previews are not stored as source truth, and save/reopen/export are part of the acceptance path. |
| [Adobe clipping-mask scope question](https://community.adobe.com/questions-712/clipping-masks-using-adjustment-layers-to-affect-only-the-layer-below-2010-1064089) | Users cannot tell “the layer below” from “everything below” | Varve keeps legacy behavior for old unscoped documents but new empty/no-selection edits are explicit and inactive; the inspector names the scope and target count. |

These sources do not prove that Varve had the same defects. They identify
failure classes worth preventing. The local defects below were reproduced by
source inspection and focused tests before repair.

## Reproduction and repair matrix

| User task | Evidence/reproduction | Root cause | Repair/owner | Validation |
| --- | --- | --- | --- | --- |
| Create an adjustment with no selection | `scopeForTargets([])` and the creation command produced document/legacy behavior | Empty arrays were used as a document-scope sentinel | Explicit empty target scope; new adjustment creation initializes it; `@varve/scene` scope resolver | Scene scope unit/integration tests; editor panel tests |
| Hide a parent or recover a malformed tree | Target eligibility checked the node only; descendant walk had no cycle/hidden-parent guard | Scene visibility and structural eligibility diverged | Reachability-bounded, cycle-safe document traversal and ancestor visibility checks | Scope tests, including empty/missing targets |
| Change a broad scope in the inspector | Impact modal read `impact` for the old scope while showing `pendingScope` | Pending state was not used for diagnostics | Compute `pendingImpact`; remove target-count “off-screen deferred” heuristic because the scene helper has no viewport | Inspector code path and focused UI validation |
| Apply +1 EV to a midtone | Software kernel used `encoded ** 2.2` while describing linear light | Approximate gamma was substituted for the shared sRGB transfer curve | Use `srgbToLinearUnit`, EV multiplication, linear offset/gamma, and `linearToSrgbUnit`; clamp non-finite inputs | Exact numeric compositor oracle |
| Enter malformed Levels/Curves values | NaN/infinity and reversed intervals could reach LUT arithmetic | Kernel trusted UI-normalized input | Finite bounded Levels parameters, deterministic interval collapse/reversal, finite Curve points and duplicate-x resolution | Levels/Curves focused tests |
| Target a neutral pixel with a colour-range Hue/Saturation edit | A Reds/Saturation edit treated an achromatic hue of zero as red | Range selection was evaluated without an achromatic guard | Only the Master range can affect a zero-chroma pixel; targeted ranges keep neutral artwork neutral | Hue/Saturation focused test |
| Import an integer/shaper `.3dl` LUT | The reader accepted only one kind of three-value row and inferred no code range or axis order | Real Discreet/Flame files use integer code values, optional scalar shaper data, and blue-fastest entries | Normalize bounded integer code ranges, return the existing `shaper3d` transform when present, and transpose into canonical R-fastest storage; retain an explicit normalized compatibility path | LUT parser known-answer fixtures: 45/45 |
| Inspect Levels/Curves later in a stack | Histogram source was always the scoped pre-stack composite | Cache key and render stage omitted selected entry/upstream filters | Histogram key includes stage; upstream `FilterIR` is rendered through the existing compositor; UI labels the source stage | Panel/editor tests; browser visual workflow pending final E2E gate |
| Localize an adjustment with a spatial mask | The live workflow configured an adjustment mask after explicit target resolution, then compared pixels inside and outside the matte and inspected the attachment in the inspector | The canonical `MaskSection` supported adjustment nodes, but the adjustment-layer panel did not render it; users could otherwise see a working mask in scene data without a reachable editor | Render the existing shared `MaskSection` from `AdjustmentPanel`; keep mask ownership separate from scope and expose type, source, visibility, inversion, feather, density, and transform-link controls | Chromium `clipping-masks.spec.ts --grep "spatial mask confines an adjustment"`: 1 passed; numeric inside/outside oracle and `reports/masking-review/09-mask-inspector-canvas.png` inspected |
| Open the adjustment entry point from Object immediately after creating a document | Chromium reached the editor but the Object button returned to `aria-expanded=false` with no menu portal after a click | A startup/native-overlay history guard was being removed with asynchronous `history.back()`; a new menu could push a second guard before the old pop arrived, and the stale pop dispatched Escape to the focused Object button. Menubar context invalidation was a separate stale-menu risk. | Extracted menubar context lifecycle handling and made `TabletBackDismiss` reconcile a pending guard removal without dispatching Escape to a newly opened layer | Menubar unit suite 21/21; tablet-guard regression 1/1; Chromium adjustment-picker 1/1; front-facing visual adjustment scenarios 2/2 |
| Use File → Export SVG after adding an adjustment | The old E2E dispatched an unhandled `strata:*` event; the live File-menu action called the legacy document serializer and could omit adjustment pixels | Whole-document SVG export bypassed the structural flattening compositor used by the batch exporter | Route the existing action through `composeFlattenedExportSnapshot` and `exportDocumentToSvgAdvanced`, save through the active platform, and cancel if the document revision changes during rendering | Chromium File-menu workflow passed; downloaded SVG bytes were inspected for a complete `<svg>` envelope and absence of the old adjustment warning |

## Canonical contracts after this slice

### Scope

`image-local`, `explicit-targets`, `container-descendant`, and `document`
remain the only scope modes. `explicit-targets: []` means “currently
inactive,” never “document.” Missing, hidden, self-referential, duplicate, or
nested duplicate targets resolve to no additional pixels. Legacy documents
without a scope continue through their compatibility sibling-below resolver;
this is intentionally not the default for newly created layers.

The scene scope helper can calculate resolved targets, affected pages, frames,
and estimated geometry. It does not have camera/viewport state, so it no longer
claims that a target is off-screen based on a target-count threshold. A future
viewport-aware impact diagnostic must receive the actual camera and page
geometry rather than guessing from list length.

### Pixel and alpha

The current reference boundary is straight-alpha RGBA8 `ImageData`. Exposure
uses sRGB transfer functions at the encoded/linear boundary, applies EV as
`2^stops` in linear light, treats offset as a bounded linear shift, then
re-encodes. Color-only operations preserve alpha and preserve hidden RGB for
fully transparent pixels where the raw-pixel kernel contract applies. This does
not claim HDR, float, CMYK-raster, or ICC-accurate effect execution.

### Histogram

The diagnostic source is the resolved scoped composite. With an active stack
entry selected, upstream enabled entries are applied through canonical
`Adjustment → FilterIR → applyFilterWithCompositing` before sampling. A later
entry therefore sees the same logical input stage as the editor preview. The
histogram remains a bounded 256-pixel sample and is labelled in the panel; it
is not a final-output or display-proof histogram.

## Remaining limits and next slices

- LUT library portability, save/reopen, and raster/PDF export still need a
  fresh full workflow capture on this checkout. Adjustment masks now have a
  targeted Chromium workflow pass (pixel oracle plus live inspector screenshot),
  but that pass does not establish save/reopen or every export format. The direct
  File → Export SVG path has an isolated browser pass, while existing
  architecture documents describe their current boundaries but do not replace
  that evidence. The focused Chromium attempt is captured under
  `test-results/adjustments-e2e-1517/` and `test-results/adjustments-e2e-1518/`:
  one run showed a live `colorHalftone.ts`/`filterCompositor.ts` export mismatch
  from concurrent work, and the fresh run reached Varve's “bundle loaded but
  never rendered” startup watchdog during Vite dependency optimization. These
  are runtime blockers for the visual gate, not successful adjustment evidence.
- Earlier Chromium runs reached the editor but were blocked by the stale menu
  close described in the matrix above. After the pending-history-guard repair,
  the isolated adjustment-picker scenario passed and the front-facing Hue /
  Saturation, Levels, Curves, and empty-scope scenarios passed. Their inspected
  screenshots are under `reports/ui-review/front-facing-adjustments/`. The
  repository global warm-up still timed out once under concurrent load, and a
  separate run used the documented `VARVE_VISUAL_HARNESS_ONLY=1` warm-up bypass;
  the spec's own navigation/readiness checks remained active.
- The effect kernel remains an RGBA8 Canvas2D/software reference path. Native,
  WASM, and WebGPU acceleration must prove equivalence before dispatch.
- `.3dl` import now covers the verified integer/shaper/blue-fastest contract and
  preserves the canonical embedded transform. LUT library replace/reveal,
  missing-resource recovery, and portable treatment-copy workflows still need
  their own end-to-end evidence.
- Histogram sampling is stage-aware but still downscaled and does not yet
  expose viewport/crop provenance in the UI.
- No neural model was added. Deterministic controls remain usable offline and
  model/provider absence cannot disable them.
