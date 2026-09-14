# Selection refinement audit and research ledger — 2026-09-13

Point-in-time audit before the selection-refinement repair work. The
current-state contract remains `docs/architecture/selection-system.md`; this
document records what was verified, what was broken, and which external
evidence justified each decision.

Access date for every online source below: **2026-09-13** (browser research,
no source code executed).

## 1. Verified defects

### D1 — Binary masks cannot be edge-refined at all (severity: high)

- **Observed:** `refineHairMatting()` defaults `edgeBandOnly: true` and both
  the guided and closed-form paths treat a pixel as refineable only when
  `10 < mask < 245` (`refineHairMatting.ts`, band selection and final write
  back). A hard mask produced by a binary selection or a hard segmentation is
  `0/255` only, so `bandCount === 0` and the function returns the input
  unchanged. `trimapFromMask()` has the same condition (`v <= 10 || v >= 245`
  are skipped), so the trimap generated for a binary mask has no unknown band.
- **Consequence:** "Refine edges (hair/fur)" and the trimap workflow silently
  do nothing on the most common inputs (hard selections, thresholded
  segmentation, vector-derived masks).
- **Reproduction:** unit-level: `refineHairMatting(image, binaryMask)`
  returns a byte-identical mask; `trimapFromMask(binaryMask)` contains only
  `0` and `255`, never `TRIMap.UNKNOWN`.
- **Fix direction:** build the unknown region spatially from the boundary
  distance, not from existing intermediate alpha.

### D2 — The "closed-form" solver is not the closed-form system (severity: high)

- **Observed:** in `applyClosedFormMatting()`:
  - the diagonal is accumulated as
    `invWindowSize * nPx - 1 - affinity`, which equals `-affinity` for a full
    window, while the paper's diagonal term is `1 - W(i,i)`;
  - off-diagonal entries are accumulated as `-affinity`, i.e.
    `+W(i,j)`, but the Laplacian requires `L(i,j) = -W(i,j)`;
  - `opts.laplacianRadius` is accepted and ignored (`const rHalf = 1`);
  - known-pixel boundary terms are missing entirely: pixels whose trimap
    label is known are skipped while building rows, so their fixed values
    never enter the right-hand side.
- **Verified against:** Levin, Lischinski & Weiss, *A Closed Form Solution to
  Natural Image Matting*, CVPR 2006, eq. (12):
  `L(i,j) = Σ_k (δ_ij - 1/|w_k| (1 + (I_i-μ_k)^T (Σ_k + ε/|w_k| I)^-1 (I_j-μ_k)))`,
  and the constrained system `(L + λD)α = λβ` (eq. 13); PyMatting's
  `estimate_alpha_cf`/`cg` do the same construction
  (<https://pymatting.github.io/laplacian.html>). The Schur-complement
  interpretation (known pixels fixed, their contribution moved to the RHS)
  is standard.
- **Consequence:** the solver returns a non-minimizer of the intended energy,
  can produce alpha that ignores the user's known pixels, and cannot be
  trusted for hair/fur refinement. It also allocates one `Map` per band pixel
  and evaluates all 81 ordered pairs per window, which is both wrong and
  unusably slow.

### D3 — Box filter is not linear-time despite its documentation (severity:
medium)

- **Observed:** `boxMean()` is documented as a "separable approximation" but
  runs a full `(2r+1)²` loop per pixel, i.e. O(N·r²); the guided filter calls
  it five times. `dilateMask`/`erodeMask` in `areaSelection.ts` and
  `expandMask`/`contractMask` in `maskOps.ts` are also O(N·r) brute force.
- **Verified against:** the van Herk/Gil-Werman algorithm computes 1-D
  min/max windows in ≤3 comparisons per sample independent of the window size
  (van Herk 1992; Gil & Werman 1993; Leptonica grayscale morphology notes);
  the sliding-window box sum is O(1) per pixel with a running accumulator.
- **Consequence:** a 12 MP image with radius 4 spends ~5×81 samples/pixel in
  the guided filter; large grow/shrink radii are quadratic and can freeze the
  editor's background path.
- **Fix direction:** sliding-window box sums, van Herk min/max, and exact
  Euclidean distance transforms for boundary operations.

### D4 — `solveTrimapMatting()` does not propagate from the trimap (severity:
high)

- **Observed:** each iteration replaces an unknown pixel with the average of
  *known* pixels inside the window and does nothing when the window contains
  no known pixel. Unknown regions wider than `windowRadius` retain the
  `0.5` initialization in their interior, and the image (colours) is never
  consulted despite the docstring's "local color affinity".
- **Consequence:** trimap matting returns a blurred ramp near the constraint
  boundary and flat 50% alpha elsewhere; `TRIMap.UNKNOWN` effectively becomes
  "50% opaque", which is exactly the categorical-label misuse the workflow
  must avoid.
- **Reproduction:** a 20 px wide unknown band between fg and bg produces
  `128` in the middle regardless of image content.
- **Fix direction:** use the corrected matting system, with known labels as
  hard constraints and unknown initialized from the current mask; keep a
  bounded, honest fallback when the system cannot be solved.

### D5 — Refine brush is clipped to the selection it is meant to grow
(severity: high)

- **Observed:** `RefineMaskTool.paintStroke()` always multiplies the dab
  weight by `areaSelectionCoverageAtMaskPixel(...)`, and
  `strokeAreaSelection` is captured at pointer-down. With an active pixel
  selection, strokes outside that selection are silently discarded. This is
  the same limitation Krita users hit with "use selection as boundary"
  (<https://www.reddit.com/r/krita/comments/1n34k4v/selection_as_boundary_not_working/>).
- **Consequence:** recovering missing hair or foreground outside the current
  selection is impossible unless the user first clears the selection.
- **Fix direction:** explicit, default-off "clip strokes to the current
  selection" option; protected regions remain opt-in.

### D6 — Stroke sampling gaps and unit mixing (severity: medium)

- **Observed:**
  - `RefineMaskTool` and `TrimapEditTool` skip a sample when the distance
    from the last painted point is below a threshold, then paint only the
    sample (no interpolation between samples). `SelectionPaintTool` appends
    a stamp per event with the same gap behaviour: at fast pointer speeds a
    single event can land far from the previous stamp, leaving unpainted
    spans. `getCoalescedEvents()` improves resolution but does not guarantee
    coverage of the geometric segment between samples.
  - `TrimapEditTool` compares world-space distance against
    `brushSize * 0.3`, but `brushSize` is used as mask/source pixels — a unit
    mismatch on scaled images.
  - `pressure` is used raw; a pointer reporting `pressure === 0` (pen near
    contact, some touch stacks) produces zero-weight dabs even while the
    button is down.
  - `createBrushMask()` is rebuilt inside the per-sample loop.
- **Consequence:** dashed/spotty strokes, uneven refinement on scaled images.
- **Fix direction:** one shared stroke interpolator (segment walk at a
  spacing fraction of the brush radius, including the final sample),
  pointer-type-aware pressure normalization, cached brush masks.

### D7 — Refinement operations collapse distinct behaviours (severity: medium)

- **Observed:** the public operation union is
  `'grow' | 'shrink' | 'smooth' | 'threshold'`; `smooth` is a box blur
  (radius = rounded sigma) and there is no feather, contrast/harden,
  antialias, border, shift-edge, or cleanup operation. The UI/text describes
  `smooth` as a Gaussian approximation even though the implementation is a
  box filter with integer radius, and `amount`/`sigma` are silently floored.
- **Verified against:** GIMP documents feather as a Gaussian blur and
  grow/shrink as boundary moves; border creates a band with half inside/half
  outside and supports edge-lock; Photoshop separates Smooth (outline shape),
  Feather (blur), Contrast (transition steepness), and Shift Edge (boundary
  move). The four concepts are not interchangeable.
- **Consequence:** users cannot express "smooth then feather" vs "feather
  then contrast", and repeated slider changes recompute from the current
  preview (accumulating blur) rather than a baseline.

### D8 — Editor reset semantics and preview truthfulness (severity: low-medium)

- **Observed:** `refineAreaSelection` is a one-shot destructive transform
  (documented in code) and the editor commands call it repeatedly from the
  *current* selection, so a re-run of "Smooth" accumulates. The preview
  always rasterizes from the `AreaSelection` expression, which is consistent,
  but `TrimapEditTool` writes `128` into the trimmed mask plane and the
  overlay renders that plane without distinguishing "unknown" from "50%
  selected" unless a dedicated preview mode exists.
- **Fix direction:** document operation ordering and baseline semantics;
  render the trimap with categorical colours (fg/bg/unknown), never as
  alpha.

## 2. Capability matrix (audited state)

| Capability | Status | Evidence |
|---|---|---|
| Soft area selection (analytical + raster) composition | Working | `areaSelection.ts`, existing tests |
| Grow / shrink (binary, bounded) | Working, square footprint, O(N·r) | `dilateMask`/`erodeMask` |
| Smooth | Partial — box blur with integer radius, not boundary smoothing | `smoothMask` |
| Threshold | Working | `refineAreaSelection` |
| Feather (explicit) | Missing | no op |
| Antialias (1 px transition) | Missing | no op |
| Contrast / harden | Missing | no op |
| Border band | Missing | no op |
| Shift edge (soft-profile move) | Missing | no op |
| Cleanup (islands/holes) | Missing in area selection; hole fill exists in background removal | `maskOps.fillMaskHoles` |
| Guided edge refinement | Partial — correct formula, O(N·r²), edge-band-only | `guidedFilter1D` |
| Closed-form matting | Broken (D2) | `applyClosedFormMatting` |
| Trimap generation | Broken for binary masks (D1) | `trimapFromMask` |
| Trimap solve | Broken (D4) | `solveTrimapMatting` |
| Brush add/subtract refinement | Partial — clipping and gaps (D5, D6) | `RefineMaskTool` |
| Restore-original brush | Missing | — |
| Foreground colour repair | Missing explicitly; `decontaminateMask`/`maskOps` choke exists | `maskOps.decontaminateMask` |
| SAM2 → AreaSelection bridge | Working (implemented after the architecture doc) | `useSam2Segmentation.ts` `'selection'` case; `areaSelectionFromMaskCoverage` |
| Saved area selections | Working | `savedAreaSelections.ts`, panel |
| Mask ↔ selection round trip | Working with bounded resolution; boundary cap documented | `selectionMask.ts` |

## 3. Research ledger (verified facts vs. decisions)

| Source | Verified fact used | Consequence for Varve | Uncertainty |
|---|---|---|---|
| Adobe, *Refine and soften selection edges*; *Select and Mask* guides (helpx.adobe.com, accessed 2026-09-13) | Antialiasing modifies only edge pixels; feather creates a blur transition; Smooth reshapes the outline; Contrast steepens; Shift Edge moves the boundary; Decontaminate Colors is a colour operation and can only be output as a new layer/mask. | Keep the operations distinct; do not route labels to one blur; colour repair is a separate, optional operation whose output cannot be a plain selection. | Adobe's exact Smooth/Shift Edge kernels are undocumented; Varve documents its own rules. |
| GIMP 3.x manual: Feather, Grow, Shrink, Border (docs.gimp.org, accessed 2026-09-13) | Feather is implemented with a Gaussian blur; grow/shrink move the boundary; border = band of the given radius around the boundary, half inside/half outside, with optional "selected areas continue outside the image". | Feather uses a true separable Gaussian; grow/shrink use distance-based boundary moves; border exposes inside/outside/centered placement; boundary handling must be explicit. | GIMP's shrink may alter feather shape at corners; Varve documents the same. |
| Levin, Lischinski & Weiss, CVPR 2006, eq. (12)–(13); PyMatting `laplacian` docs (accessed 2026-09-13) | Matting Laplacian `L = D − W`, `W` from local 3×3 colour statistics with ε regularization; constraints via `(L + λD)α = λβ`; known pixels are hard constraints. | The solver must build `L` with the correct diagonal/off-diagonal signs, window statistics from all pixels (known or not), and move known-pixel contributions to the RHS. | Windows larger than 3×3 densify the system; Varve keeps radius configurable but bounded and documents the trade-off. |
| He, Sun & Tang, *Guided Image Filtering*, ECCV 2010 (people.csail.mit.edu/kaiming, accessed 2026-09-13) | Guided filter is an edge-aware local linear filter; linear-time in the number of pixels with O(1) box filters, independent of radius. | The implementation must use O(1)/pixel box statistics; the guided filter is not a matting solver and is documented as edge-aware smoothing only. | Absolute `epsilon` depends on guide normalization; Varve normalizes the guide to [0,1]. |
| van Herk 1992; Gil & Werman 1993; Leptonica grayscale morphology notes (accessed 2026-09-13) | Deterministic 1-D min/max sliding window in ≤3 comparisons/sample, independent of window size. | Grow/shrink use van Herk min/max (square) or exact EDT (Euclidean) instead of the O(N·r) loops. | None material. |
| Felzenszwalb & Huttenlocher 2012 (generalized distance transform), standard image-processing practice | Exact squared Euclidean distance transform in O(N) via lower-envelope of parabolas. | Signed distance fields power antialias, border, shift-edge, and spatial trimap bands without per-radius cost. | Implementation must handle 2 passes (x then y) with float accumulators. |
| Reddit r/GIMP: "Selection issues" thread (accessed 2026-09-13) | Users interpret marching ants as the selection boundary and are surprised when feathered coverage affects pixels outside the outline. | Overlay/UX must state that ants show the 50% contour; a coverage/grayscale preview must be available. | Anecdotal, but consistent across GIMP/Affinity/Krita threads. |
| Reddit r/krita: "Selection as boundary not working" (accessed 2026-09-13) | Boundary-clipped tools cannot extend outside the existing selection; this is a reported user frustration. | Refine brush clipping is default-off and explicitly labelled. | Anecdotal. |
| Reddit r/AffinityPhoto: "Refine Selection issue on v2" (accessed 2026-09-13) | Users report hair refinement selecting background (sky) as foreground. | Trimap/band construction and known-pixel constraints must dominate; automatic results must be previewable and cancellable. | Anecdotal; exact Affinity algorithm unknown. |
| Photopea Refine Edge docs + issue #7715 (accessed 2026-09-13) | Refine Edge estimates new transparency *and* new colour for unknown pixels; saving only alpha loses the colour repair and produces fringes; preview must match committed output. | Alpha refinement and colour decontamination are separate outputs; preview and commit must share one pipeline. | Photopea's algorithm is closed; only the separation of concerns is borrowed. |
| Reddit r/photopea: "Refine edge tool completely useless" (accessed 2026-09-13) | Users report that refining one area ruins already-good areas and that the gray/unknown brush behaves like 50% black. | Unknown must stay categorical; local edits must not overwrite unrelated regions (bands are per-session and constraints preserve prior strokes). | Anecdotal. |
| W3C WCAG 2.2 SC 2.5.7 / 2.5.1 (w3.org, accessed 2026-09-13) | Dragging operations need a single-pointer, non-drag alternative; freehand drawing is not expected to have a keyboard equivalent for the same path. | Add/subtract/restore brush modes are clickable controls, numeric size inputs, and refine operations have command paths; freehand refinement is documented as path-based. | None material. |
| Pointer Events Level 3 (w3.org/TR/pointerevents3, accessed 2026-09-13) | `getCoalescedEvents()` returns sub-frame samples but is not guaranteed to cover the full geometric segment; pressure may be 0. | Interpolate between samples and normalize pressure by pointer type. | Browser differences; verified only on Chromium here. |

## 4. Product decisions

1. **Coverage contract.** Selection coverage is an 8-bit plane, 0 = outside,
   255 = inside, intermediate = fractional coverage. The domain of an
   operation is the padded finite bounds of the rasterized selection; padding
   is derived from the operation's support (radius), never from an infinite
   canvas. Outside-the-plane pixels are treated as "coverage continues" for
   feather (edge-lock normalization) and as the appropriate neutral value for
   morphology; image-border pixels are never forced to background.
2. **Operation semantics.**
   - `grow` / `shrink`: move the 50% boundary by `amount` document units using
     an exact Euclidean distance transform; soft transitions become crisp at
     the new boundary (documented; GIMP notes feather shape may change).
   - `feather`: separable Gaussian on coverage, radius = `sigma` document
     units, edge-lock normalized at the plane boundary.
   - `smooth`: morphological open+close of the 50% shape (disk, Euclidean)
     that preserves original coverage where the shape is unchanged; reduces
     boundary irregularity without blurring.
   - `threshold`: hard cut at `threshold`.
   - `contrast` (a.k.a. harden): linear level remap around 0.5; amount 1
     equals threshold at 0.5.
   - `antialias`: 1-pixel transition reconstructed from the signed distance
     to the 50% boundary.
   - `border`: ring of `width` around the 50% boundary with `inside`,
     `outside`, or `centered` placement.
   - `shift-edge`: translate the coverage profile by `amount` document units
     along the local boundary normal (bilinear resample of the original
     plane), preserving softness.
   - `cleanup`: remove islands below `minIslandArea` and fill holes below
     `maxHoleArea`, preserving kept coverage values.
3. **Baseline semantics.** Each operation is computed from the *current*
   committed selection; the UI's live preview recomputes from a session
   baseline so returning a slider to its previous value restores the previous
   result and does not accumulate blur. Commands apply one operation per
   invocation from the current selection (existing contract).
4. **Matting contract.** `refineHairMatting` is edge-aware refinement with an
   explicit method:
   - `guided`: guided filter (edge-aware smoothing), never advertised as
     solving for alpha;
   - `closed-form`: corrected matting Laplacian with hard known-pixel
     constraints from a spatial trimap band, unknown initialized from the
     existing coverage; bounded by `maxUnknownPixels`; returns the original
     mask plus a diagnostic when the system is refused or fails to converge.
5. **Trimap contract.** Labels are categorical: 0 background, 255 foreground,
   128 unknown. Unknown carries no opacity meaning; previews render unknown
   as a distinct badge colour; only the matting solve produces coverage.
6. **Round trips.** Area selection ↔ native mask conversion keeps 8-bit
   coverage, uses the canonical image placement and node transforms, and
   never threshold-intermediates unless the user asks for it.

## 5. Implementation outcome (2026-09-13)

All defects in §1 are repaired. Commit trail: `ac03fd07d` (audit), `fe9ebc34a`
(coverage geometry + full operation set), `71acb8d6b` (validated matting),
`e9a159ebf` (reliable refine brushes + refinement controls), `f0113229c`
(exact neutral selection no-ops), `d3c8657fc` (target-safe, complete
refinement strokes), and `194b37764` (binary-safe editor default, documentation,
and marketing copy).

- **D1 fixed.** `trimapFromMask()` now builds a spatial unknown band from the
  signed distance to the 50% contour, so hard binary masks get a real unknown
  region; `refineHairMatting({ method: 'closed-form' })` refines them.
- **D2 fixed.** `mattingSolver.ts` implements the Levin et al. system with
  exact partial-window statistics (prefix sums), hard constraints solved by
  Jacobi-preconditioned CG over the unknown subspace, and a matrix-free
  product validated cell-by-cell against an independently built dense
  Laplacian (direct Gaussian elimination reference test).
- **D3 fixed.** Sliding-window box sums, van Herk/Gil-Werman min/max, and
  Felzenszwalb-Huttenlocher distance transforms; `guidedFilter1D` uses the
  O(N) box means. Benchmarks below show radius independence.
- **D4 fixed.** `solveTrimapMatting` is backed by the corrected solver,
  accepts a warm-start mask (`initialAlpha`), and throws an honest error when
  a trimap has no constraints or the bounded solve refuses.
- **D5 fixed.** `clipToSelection` is explicit and default-off in
  `RefineMaskTool` and in the Background Removal inspector.
- **D6 fixed.** Shared `brushStroke.ts` interpolation (coalesced events +
  segment walk including the final sample) and pointer-type-aware pressure
  normalization; trimap spacing now applies in source-pixel space.
- **D7 fixed.** Distinct `feather`, `smooth`, `contrast`, `antialias`,
  `border`, `shift-edge`, and `cleanup` operations with documented semantics,
  numeric inputs, and one undoable Apply; zero-radius calls are byte-exact
  no-ops and malformed parameters clamp.
- **D8 fixed.** Selection Sources panel exposes the full operation set with the
  50%-contour explanation.

A real interaction bug was found during browser validation and fixed in this
work: a refine/trimap stroke that began outside the target image aborted the
whole gesture because the first mapped sample was `null`
(`RefineMaskTool`/`TrimapEditTool` now start the segment at the first
paintable sample and reset across gaps instead of giving up).

## 6. Validation evidence

**Numerical.** 96 engine area-selection tests, 502 background-removal tests,
and the editor tool tests pass, including independent references (naive
min/max and box sums, dense Laplacian + Gaussian elimination, analytic
distance checks) and invariant tests (no-op zero radii, finite coverage,
monotone feather, explicit empty semantics).

**Browser / visual.** `tests/e2e/canvas/selection-refine-operations.spec.ts`
runs the real editor under Chromium (Playwright 1.62.1, isolated port 1593):
a Photo-workspace marquee → Selection Sources → Feather → Grow → undo path,
and a Design-workspace paint-to-create mask with a deliberately coarse
three-step drag, one undo, and colored-pixel count assertions. Both tests
pass; screenshots and hashes are archived in
`docs/screenshots/selection-refinement/2026-09-13/` and were inspected
(the after capture shows only the painted band of the image, proving
interpolation filled the coarse-drag gaps). Physical pen pressure, Tauri
WebKitGTK, and non-Chromium engines remain unverified.

**Performance (2048² coverage plane, Linux desktop, two runs).**

| Case | Time |
|---|---|
| Dilate r=2 / r=16 / r=64 | 325 / 345 / 317 ms (second run: 270 / 216 / 223) |
| Gaussian feather σ=2 | 1.2–1.4 s |
| Gaussian feather σ=16 | 5.7–6.8 s |
| Signed distance (exact EDT) | 750–800 ms |
| Island/hole cleanup | ~350 ms |
| Matting solve, 1024², 24 px band, 37 CG iterations | 310–370 ms |

Morphology is radius-independent as documented. Large-σ feathering is the
slowest bounded operation (O(Nσ) with exact kernel accumulation); it is an
explicit Apply action, not a per-pointer-move path, and it is capped by the
selection's padded bounds. The matting solve converges well inside its
iteration budget on a representative band; oversized regions are refused with
a diagnostic instead of allocating without bound.

## 7. Validation plan (original)

- Unit: independent reference implementations for EDT, van Herk min/max,
  Gaussian feather, coverage algebra, and the closed-form system on small
  hand-computable problems (constant image, single edge, all-known trimap,
  missing constraints, binary input).
- Invariants: zero-radius no-op, finite/`[0,1]` coverage, monotonic
  grow/shrink on convex shapes, no edge fade at plane borders, no mutation of
  the source selection, generation monotonicity, explicit empty-selection
  semantics.
- Interaction: Playwright drives the real refine-mask, trimap, and selection
  refinement UI on an isolated port; screenshots are opened and inspected;
  preview vs. committed output compared on multiple backgrounds where the
  commit path is available.
- Performance: bounded stress tests (large plane, large radius) assert the
  linear-time algorithms complete within a generous bound and measure the
  before/after on the same machine.

## 8. Follow-up review and complaint-driven corrections

This section was added after the original repair audit, still on **2026-09-13**,
against the current `master` checkout. It separates newly verified behavior
from the historical defect record above.

### Verified follow-up findings

| Finding | Evidence | Implementation consequence |
|---|---|---|
| Zero-radius grow, shrink, smooth, feather, contrast, and shift-edge previously entered the raster path, whose internal radius floor could turn zero into one pixel. | `refineAreaSelection()` computed `Math.max(1, ...)`; a byte-exact identity test now covers every neutral operation. | `refineAreaSelection()` returns the original immutable selection before rasterization, preserving coverage, bounds, and generation and avoiding a no-op history entry. |
| Guided filtering is intentionally not a binary-mask matting algorithm. | He, Sun & Tang, *Guided Image Filtering*, ECCV 2010, describes an edge-aware local linear filter; the current guided path preserves definite 0/255 cores under `edgeBandOnly`. | The editor now defaults to closed-form matting for `Refine edges`; Guided remains an explicit choice for already-soft masks. The lower-level engine default remains guided for API compatibility and honest caller control. |
| Restore must mean the original session mask, not the mask at the beginning of the previous stroke. | Two-stroke test: subtract then restore on one session; the second stroke must return to the first loaded mask. | `RefineMaskTool` keeps an immutable session baseline, a separate per-stroke cancel snapshot, and never paints source RGB. |
| Pointerup is an input sample, not merely transaction cleanup. | Unit tests send pointerdown followed immediately by pointerup at a different location; the endpoint must be covered. | Refine-mask and trimap tools process the final pointer position, skip duplicate zero-distance dabs, and keep the existing shared interpolation helper for gaps. |
| The selected node ID is not sufficient target identity during async loading or a gesture. | Replacing a node under the same ID or changing selection can otherwise redirect the callback in `toolContext.ts`. | Tools capture node object identity and session generations; trimap/mask callbacks receive explicit node IDs and expected node identity and reject stale commits. |
| The existing “Contract soft edges” option is alpha-only. | `decontaminateMask()` only changes the mask plane; the inspector copy explicitly says it does not recolour source pixels. | No RGB mutation was added under a misleading name. Foreground-color estimation remains a separate future derived-asset operation; mask-only output preserves the original artwork. |

### Complaint patterns checked against public reports

These reports are anecdotal and do not establish the other products’ internal
algorithms. They were used to test whether Varve’s failure modes were
realistically preventable, not to copy another product’s controls.

| Reported user failure | Source and access date | Varve response |
|---|---|---|
| Hair refinement selects sky/background or worsens a good boundary. | Affinity forum, “Replacing Background” (`https://forum.affinity.serif.com/index.php?/topic/178058-replacing-background/`); AffinityPhoto Reddit report (`https://www.reddit.com/r/AffinityPhoto/comments/yuxuzz/`). Accessed 2026-09-13. | Spatial unknown bands, categorical trimaps, hard known constraints, binary-safe default matting, and cancellable previews. Fine hair and translucent material remain quality-limited rather than promised as exact. |
| Refine Edge damages already-good areas or requires manually rebuilding a selection. | Photopea Reddit report (`https://www.reddit.com/r/photopea/comments/1jej4gf/`) and Krita boundary-clipping report (`https://www.reddit.com/r/krita/comments/1n34k4v/`). Accessed 2026-09-13. | Local brush constraints are session-scoped, cancel restores the prior trimap/mask, and refine strokes are not clipped to the selection by default. |
| Unknown/gray painting is interpreted as 50% opacity or output loses repaired edge color. | Photopea Refine Edge documentation (`https://www.photopea.com/learn/refine-edge`) and Affinity halo discussion (`https://forum.affinity.serif.com/index.php?/topic/118787-refine-selection-unexpected-halo/`). Accessed 2026-09-13. | Unknown is categorical and previewed separately; alpha refinement does not claim foreground-color repair. Color-changing output is not silently written into a mask-only result. |
| Feathered selections appear to stop at marching ants and users cannot tell what will be painted. | GIMP selection documentation (`https://docs.gimp.org/3.0/en/gimp-tools-selection.html`) and GIMP feather documentation (`https://docs.gimp.org/3.0/en/gimp-selection-feather.html`). Accessed 2026-09-13. | The UI documents ants as the 50% contour and retains grayscale/coverage preview paths; downstream mask consumers use fractional coverage. |

### Product decisions retained

- This work does not add a second mask editor or a remote model path.
- Foreground-color decontamination is deliberately not claimed as complete:
  PyMatting documents foreground estimation as separate from alpha estimation
  (`https://pymatting.github.io/foreground.html`, accessed 2026-09-13). A future
  implementation must produce a derived color asset or layer and preview it
  over multiple backgrounds; it must not modify source RGB during coverage-only
  refinement.
- Physical pen pressure, WebKitGTK/Tauri, and non-Chromium browser behavior
  remain unverified. Chromium pointer interaction and numerical coverage tests
  are evidence for the supported path, not a claim of universal platform
  equivalence.
