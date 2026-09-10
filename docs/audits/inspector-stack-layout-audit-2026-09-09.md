# Inspector and stack layout audit — 2026-09-09

## Scope

This audit refreshed the checkout at `master` after the prior session advanced
from `baf5af225` through `0e9b637af`. It covers the layout solver, inspector
ownership, paint order, import/export semantics, and the marketing surface.
Existing dirty files and screenshot baselines were inspected and left in place.

## Reproductions and repairs

| Area | Reproduction | Root cause | Repair |
|---|---|---|---|
| Fill redistribution | A 300px row with a 20px gap, a capped Fill child (max 80), and another Fill child resolved 80/140 | A one-shot split discarded space released by a capped participant | Freeze capped participants and redistribute the residual |
| Minimum overflow | Two Fill children with 60px minima in a 100px row resolved to zero | Flexible minima were applied after the allocation had already collapsed | Preserve minima and report the overflow through the resolved geometry |
| Fixed bounds | A 100px Fixed child with max 40 was placed as 40px while retaining 100px geometry | Constraint clamping was applied to placement even when Fixed bounds are inactive | Fixed bounds remain retained but inactive; sibling placement uses authored geometry |
| Center alignment | A capped 40px item in a 100px cross axis aligned at 10px | Alignment used the pre-clamp size | Clamp first, then align using final geometry |
| Hug overlap | Three 40px items with −60px gap measured zero width | Intrinsic measurement clamped signed spacing to zero | Measure the occupied union, yielding 80px |
| Grid | Auto tracks produced zero cells and repeat syntax was ignored | Child-to-track maps were reversed and the parser did not expand repeat() | Correct occupant maps, repeat expansion, and constrained child application |
| Affine reflow | Reflowing a transformed child reset its scale/skew components | The reflow path replaced the complete transform with an identity matrix | Layout now owns translation while preserving the authored linear component |
| Mixed fills | Editing opacity copied the first selected object's complete fill to every object | The update path replaced a complete row for a partial edit | Same-type edits merge only the supplied fields; type changes replace the row |
| Typography | A stored 1.2 multiplier was labelled `%` and entering 120 stored 120 | Display and persisted units were conflated | The inspector displays 120% and stores 1.2 |
| Tables | Track editors were mounted twice and span inputs had no-op handlers | Duplicate ownership and incomplete bindings | One track editor owns columns/rows; spans are read-only until Merge/Split is available |
| Effects | Display and mutation could address different effect entries | Rows used unstable reference stacks | Rows remount from stable selected-node/index identity |
| Paint order | Render, replay, scene scope, and codegen could disagree about reverse flow | Each consumer inferred order independently | `effectivePaintOrder` is scene-owned and preserves absolute/mask/component slots |

## Performance evidence

The previous 50,000-item probe measured roughly 16.4s for center alignment and
21.6ms for start alignment. The repeated `results.find()` lookup in the
justify pass was removed in favour of a result map. Future benchmarks should
report p50/p95, allocation counts, layout passes, memory, and no-op reflow for
100, 1k, 10k, and 50k items across start, center, distributed, wrapping,
percent, border, and text-measurement cases.

## Interaction baseline

The existing Chromium containment and quick-properties baseline passed 3/3
tests on the refreshed checkout. The matching quick-properties screenshot was
manually inspected. Two history warnings (`updateDoc called outside
transaction`) were observed and remain a follow-up item for numeric draft
ownership. Selection changes during numeric drafts, portaled colour edits,
table text editing, and image tuning still need browser reproductions.

## Decisions

* Design remains the primary inspector editing surface; Adjustments, Prototype,
  and Export remain contextual workspace surfaces.
* Fixed bounds are visible but inactive. Relative sizing stores a literal,
  finite percentage and never becomes a weight.
* Flex gaps may be signed; padding and grid gaps remain non-negative. Export
  targets that cannot represent negative gaps receive a diagnostic and a
  resolved fallback.
* Border-aware layout is opt-in (`includeBordersInLayout: false`) and measures
  visible stroke protrusions only. Shadows and blur do not affect occupied
  layout footprints.
* `overlapOrder` changes effective paint order without mutating authored child
  arrays or moving absolute children, mask sources, adjustment membership, or
  component boundaries.

## Remaining audit queue

Browser workflow coverage still needs real pointer/keyboard tasks for signed
gap dragging, owner-loss cancellation, mixed-fill opacity, table cell identity,
component slot clearing, and explicit mixed-selection export scope. The visual
matrix also needs light, dark, high-contrast, narrow/wide rails, fractional
zoom, camera rotation, and DPR 1/2 captures. Windows/macOS and 4GB hardware
results are verification gaps, not inferred support.
