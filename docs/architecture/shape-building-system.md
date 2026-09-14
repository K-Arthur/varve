# Shape-building system

Status: implemented desktop/browser workflow, reviewed 2026-09-13

Shape Builder is a staged region-construction tool. It is deliberately
separate from whole-object booleans, grouping, clipping, raster flood fill,
and node editing.

## User contract

The tool starts with an explicit selection of eligible vector sources. The
document is not changed while the user hovers, clicks, sweeps, or previews.
The session ends with Apply, an action shortcut, Escape, or a tool switch.
Apply creates one undoable document transaction.

| Action | Result |
| --- | --- |
| Merge | Creates editable result component(s) from the selected filled regions and removes the selected sources. Internal selected boundaries disappear. Untouched source areas remain in source remainders. Disconnected components remain separate objects. |
| Erase | Removes the selected areas from participating sources. Unrelated source regions and unselected objects remain. Empty remainders are removed. |
| Extract | Creates editable output for the selected connected result while preserving unrelated source regions according to the source-remainder policy. |
| Create | Creates an editable result and retains the original sources. The result intentionally overlaps them and is not a live recipe. |
| Divide | Creates separate editable output components for the selected regions without fabricating a segment between disconnected components. |

The unbounded exterior is never selectable. A bounded face that is empty under
the authored fill rules is shown as an unavailable face; version 1 does not
create new artwork in that empty face. Open paths, visible strokes, image and
pattern paints, masks, effects, layout-managed children, instances, and live
Boolean groups are reported as unsupported rather than silently flattened,
outlined, or shifted to a new paint bounds.

Whole-object Union, Subtract, Intersect, and Exclude remain available as
separate commands. Shape Builder does not reinterpret a whole-object command
as an arbitrary region recipe.

## Geometry pipeline

```text
eligible sources
  -> world-space construction paths
  -> translated construction frame anchored at source bounds
  -> curve sampling with a bounded tolerance
  -> intersections and split fragments
  -> directed half-edge arrangement
  -> nested face/hole classification under each source fill rule
  -> revision-qualified selected face IDs
  -> boundary reconstruction and scene mutation plan
```

The arrangement stores source IDs, contour and segment references, direction,
and parameter intervals on each boundary fragment. A face ID includes the
geometry revision and a stable topology key; it is not an array index. Face
identity also includes its boundary component, so disconnected faces with the
same source contributors do not alias.

Parametric rectangles with ordinary corner radii are converted from the
rendered rounded boundary before intersection construction. Arc sampling uses
the complete world affine and a bounded 0.01-world-unit chord-error ceiling;
Bézier subdivision uses the smaller of the whole-path tolerance and a budget
derived from the segment's own control polygon, so a small curved feature
inside a very large path is not flattened to a chord (a sheared 8×24-unit bump
inside a 1,000,000-unit path is measured within 0.05 world units). Continuous
or smoothed corners remain explicitly unsupported until their renderer path can
be shared without drift. After world-space extraction, construction is
translated to the source bounds and its topology tolerance is capped by the
shortest authored edge. This avoids losing a small feature inside a very large
operand while keeping dimensional tolerances explicit. Zero-area primitives
are rejected before the arrangement is built, while self-intersecting paths
are still allowed when they contain non-collinear geometry.

Each source is classified independently using its authored fill rule before
the sources are combined. Even-odd parity and non-zero winding are not
substituted with one global rule. Duplicate and shared edges retain ownership
and orientation until classification is complete. Holes, nested islands, and
disconnected components remain separate rings; output paths use compound
contours and do not contain artificial connector segments.

The current committed output uses the existing scene polygon kernel for newly
reconstructed boundaries. Curved source geometry is sampled after its complete
world transform. Unchanged source curves are retained only by the Create
source-retention policy; reconstructed destructive remainders and results are
documented as bounded polygonal approximations. The subdivision routine has a
finite depth and vertex budget and does not claim an error bound after a cap is
hit.

## Eligibility and appearance

Selection is deduplicated so an ancestor and one of its descendants cannot
contribute the same geometry twice. Locked/hidden ancestors, page scope,
masks, references, and dependent objects are respected. A destructive action
is rejected when the selected sources have references that cannot be safely
updated. Scene mutation is planned as a pure document result and committed
atomically by the editor.

The first source supplies the result style. This is an explicit policy rather
than a promise to merge incompatible fills, gradients, blend modes, opacity
stacks, or effects. Created output is inserted immediately above the topmost
participating source, so a retained-source Create result is visible and
directly selectable instead of hidden under an identical source; destructive
results land at the participants' former position (the insertion index is
clamped when sources were removed). Create retains the original appearance
alongside the new result; destructive actions preserve the source fill policy
where a source remainder is reconstructed. Inline gradient fields are rebased
through world space when a result changes its bounds; bounds-relative
image/pattern paints are rejected with an explicit conversion instruction, and
shared gradient paints must be detached before construction.

When a visible stroke is the only blocker, the tool panel offers an explicit
**Outline strokes and retry** action. It runs the same stroke-to-outline
conversion as the Object menu command on the current selection, commits it as
its own undoable step, and rebuilds the arrangement. Nothing is outlined
silently: the action is only shown after eligibility has reported the stroke,
and open paths without a stroke are told to be closed instead.

## Interaction and accessibility

The interaction has an idle/preparing/hovering/selecting/previewing/committing
model even though the ephemeral draft is held by the tool manager. Click or
tap selects one region; a sweep tests every arrangement face crossed between
pointer samples, so a thin face between samples is not skipped. Shift, Alt,
Ctrl, or Command enables idempotent toggle selection for the gesture. Hovering
an action button previews its committed output in teal and source remainders in
amber before the button is pressed. Apply produces one document transaction,
selects the committed result (or the surviving source remainders), and returns
to the Select tool; with a path result selected, a double-click re-enters Node
Edit directly on the new geometry.

Escape first cancels an active gesture, then clears the staged region set, then
leaves the tool. Buttons expose every implemented action, and keyboard
shortcuts are M (Merge), E/Delete (Erase), X (Extract), C (Create), and D
(Divide). The overlay uses patterns and boundary styles in addition to color,
announces state changes, and exposes a tap-to-select/apply path for users who
cannot or do not want to drag. The existing touch multi-select toggle also
makes touch taps add or remove regions without relying on a hardware modifier
key.

## Budgets and invalidation

The arrangement refuses work above 64 sources, 20,000 segments, 300,000
candidate pairs, 100,000 intersections, 10,000 faces, or 100,000 generated
vertices. These are safety budgets, not a license to discard small regions. The
editor caches the arrangement while only hover changes; a document or
selection revision invalidates it. A stale revision cannot be committed.

Worker-backed computation is not yet used by this path. The current bounded
main-thread implementation is therefore appropriate for ordinary desktop and
Chromebook documents, while very large jobs should receive a future progress
and cancellation surface before moving off-thread.

## Interoperability

Results are ordinary editable scene path nodes and can be selected in Layers,
opened in Node Edit, saved, reopened, and sent through the existing SVG/PDF
export routes. The scene serializer remains the only persisted authority;
arrangements and hover selections are derived state and are never serialized.

SVG fill and stroke semantics are intentionally kept distinct: a path can have
filled interior semantics even when its authored subpath is open, but the
Shape Builder eligibility contract currently requires closed filled geometry.
Users are told to close/convert or outline the source explicitly when they need
boundary or stroke-area semantics.

## Research and known limits

The behavior follows the region-oriented interaction documented by Adobe
Illustrator and Affinity Designer, while retaining Varve's explicit staged
Apply/Cancel transaction and source-retaining Create policy. Inkscape's
construction tools demonstrate the useful “discard untouched segments” mode,
but also provide cautionary reports about stale cursors, fast sweeps,
transforms, fracture topology, and crashes; these are covered by the audit and
regression fixtures rather than hidden behind a generic Boolean command.

The reported failure classes that shaped this implementation were verified
against the arrangement with dedicated fixtures: externally tangent circles
(no phantom or missing area), exact shared edges, fully coincident rectangles
and circles, four quadrants meeting at one vertex, partial overlaps, thin
slivers, very large coordinate offsets, rotation and non-uniform scale,
nested islands, self-intersecting paths under both authored fill rules,
duplicate even-odd/non-zero rings, duplicate points and zero-length segments,
and repeated-build determinism. Gap handling stays explicit: Varve does not
silently weld a near-miss boundary, and a small mismatch remains a finite,
selectable region that the user can merge or erase. A scale-aware tolerance is
computed after the complete world transform and capped by the shortest
authored edge, so a tiny feature inside a very large operand is not discarded.

Primary evidence and the full capability matrix are recorded in
`docs/audits/shape-building-capability-matrix-2026-09-13.md`.
