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
create new artwork in that empty face. Open paths, visible strokes, masks,
effects, layout-managed children, instances, and live Boolean groups are
reported as unsupported rather than silently flattened or outlined.

Whole-object Union, Subtract, Intersect, and Exclude remain available as
separate commands. Shape Builder does not reinterpret a whole-object command
as an arbitrary region recipe.

## Geometry pipeline

```text
eligible sources
  -> world-space construction paths
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
stacks, or effects. Create retains the original appearance alongside the new
result; destructive actions preserve the source fill policy where a source
remainder is reconstructed. Gradient and pattern placement is still an
integration limitation when a result changes its bounds.

## Interaction and accessibility

The interaction has an idle/preparing/hovering/selecting/previewing/committing
model even though the ephemeral draft is held by the tool manager. Click or
tap selects one region; a sweep tests every arrangement face crossed between
pointer samples, so a thin face between samples is not skipped. Shift, Alt,
Ctrl, or Command enables idempotent toggle selection for the gesture. Hovering
an action button previews its committed output in teal and source remainders in
amber before the button is pressed.

Escape first cancels an active gesture, then clears the staged region set, then
leaves the tool. Buttons expose every implemented action, and keyboard
shortcuts are M (Merge), E/Delete (Erase), X (Extract), C (Create), and D
(Divide). The overlay uses patterns and boundary styles in addition to color,
announces state changes, and exposes a tap-to-select/apply path for users who
cannot or do not want to drag.

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

Primary evidence and the full capability matrix are recorded in
`docs/audits/shape-building-capability-matrix-2026-09-13.md`.
