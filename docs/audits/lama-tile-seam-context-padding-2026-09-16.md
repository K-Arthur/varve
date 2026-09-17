# LaMa staged-border tile seams — context padding and feathering, 2026-09-16

Status: implemented and unit-tested fix (context padding), plus a
documented negative result (feathering). Follow-up to the tile-seam banding
flagged in the
[progressive-vs-staged comparison](lama-progressive-expand-comparison-2026-09-16.md).

## Question

That comparison observed visible horizontal banding in one real photograph's
staged-border result (`real-life-landscape.jpg`, a 60%-width single-direction
expansion split by `splitRegion` into 5 vertically-stacked tiles). Two
candidate fixes: widen the shared context each tile sees around its own
target rectangle, and/or feather-blend the seam between adjacent tiles
instead of a hard cut.

## What was checked

A faithful reimplementation of `expandFallback.ts`'s staged-border tiling
against the pinned production LaMa model, on the same photograph and margin
as the comparison above, run three ways:

- **A. Baseline** — the shipped `DEFAULT_CONTEXT_PADDING` (32px), hard tile
  edges.
- **B. Wider context** — 96px context padding, still hard tile edges.
- **C. Wider context + feather** — 96px context padding, plus a linear alpha
  cross-fade across a 32px band at each tile's leading edge against the
  already-written neighbour.

Seam visibility was measured quantitatively, not just eyeballed: for each of
the four tile-boundary rows, the average per-pixel color change between the
row immediately above and below the boundary, compared against the same
measurement at eight rows well inside tiles (the "normal" local variation
baseline). A first attempt at C produced numbers bit-identical to B — a bug:
the feather check compared local tile-crop coordinates against the padded
context region's origin, not the tile's actual shared boundary, so the
"distance from the seam" the feather formula computed was always larger than
the 32px feather band and it silently never activated. Fixed by feathering
across an explicit overlap zone in true document/global coordinates, and
widening the compositing mask (not the model's input mask) to admit that
zone, then re-measured.

## Result

| Variant | Boundary-avg discontinuity | vs. baseline local variation | Per-boundary values |
| --- | --- | --- | --- |
| A. Baseline (32px, hard edge) | 7.30 | 3.40x | 4.5, 15.8, 1.8, 7.1 |
| B. Wide context (96px, hard edge) | 6.26 | 2.98x | 0.9, 20.1, 1.7, 2.4 |
| C. Wide context + feather (96px, 32px, fixed) | 8.68 | 4.12x | 0.9, 27.7, 2.7, 3.4 |

**Widening context padding alone (A → B) measurably helped**: the
seam-to-baseline ratio dropped from 3.40x to 2.98x (about 12%), with no
observed downside — the model's input frame is always letterboxed to 512×512
regardless of context padding, so this does not change inference cost; it
only changes how much real surrounding content each independent tile pass
gets to see before generating, giving the model more shared signal to align
color and lighting across tiles.

**Feathering (B → C) made the worst boundary measurably worse** (20.1 →
27.7 at the second boundary) and did not clearly help the others. Cause:
this specific boundary's two tiles generated visibly different plausible
continuations that were not spatially aligned (e.g., a faint structure edge
at a slightly different position between the two independent generations).
Cross-fading two *misaligned* structures does not hide the seam — it
superimposes both structures into a ghosted blend, which reads as more
wrong, not less, than a hard cut between two colors that merely don't quite
match. This is not a general verdict on feathering — a blend of two mostly
*aligned* regions that differ only in tone would likely benefit — but it is
a real, measured downside for this photograph's most visible seam, and
implementing a heuristic to distinguish the two cases automatically is a
materially larger effort than this comparison, so feathering was not
implemented.

## Fix

Widened the context padding used for AI-quality (LaMa) staged-border tiles
from 32px to 96px in `expandFallback.ts`. Extracted the padding-resolution
logic into an exported, directly unit-testable
`resolveExpandContextPadding(quality, requested?)` rather than leaving it
inline, since the previous single shared constant was otherwise untestable
without a real model run. Fast/PatchMatch keeps the original 32px default —
its context need is a local neighbourhood search, a different algorithm this
measurement did not cover, and changing it without evidence would be a
guess, not a fix. An explicit caller-supplied `contextPadding` still
overrides either default, for both quality tiers.

## What this is not

- Not a claim that 96px is optimal — it is the one wider value measured
  against the one 32px default value, on one photograph. A parameter sweep
  (64, 96, 128, 160px) was not run.
- Not a fix for every seam — the landscape case's worst boundary (the
  second of four) improved with wider context but was not eliminated;
  20.1 is still well above the ~2.1 baseline local-variation level. Large,
  many-tile margins on some photographs will likely still show some seam.
- Not a change to Fast/PatchMatch's tiling behavior, or to Fill/Remove's
  separate `AUTO_MIN_CONTEXT_PADDING` auto-padding heuristic in
  `contextExtraction.ts` (an unrelated constant).
- Not evidence about `onnxruntime-web`'s WASM backend, browser memory
  behavior, or any platform other than this session's Linux x86_64 CPU host
  (same caveat as the other 2026-09-16 real-model checks in this series).
