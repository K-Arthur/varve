# Curve and node editing

Status: implemented core workflow, with explicit topology limitations  
Last reviewed: 2026-09-13

This document describes the current path-editing contract. The companion
[research and capability record](../quality/curve-node-editing-research-and-capability.md)
contains the source ledger, baseline reproductions, and the external failure
reports that informed the interaction choices.

## Geometry contract

The editable path is one logical set of authored rings:

- `points` is the outer-ring compatibility field.
- `contours`, when present, is authoritative for all rings.
- `holes`, when present without `contours`, contributes rings after the outer
  ring. Canonical reads and writes go through `pathRings` and `withPathRings`;
  an operation must not update only `points`.
- `closed` controls whether each ring has a closing segment. It does not
  duplicate the first endpoint, and changing it is distinct from filling an
  open contour.
- Handles are relative vectors in path-local coordinates. Anchor translations
  leave those vectors unchanged; affine translation is never applied to a
  vector.
- A point's optional `mode` is `corner`, `smooth`, `symmetric`, or
  `automatic`. Missing modes remain valid legacy data and are inferred only for
  display/interaction.

`corner` permits independent handles. `smooth` keeps the two tangent vectors
collinear/opposite while preserving unequal lengths. `symmetric` also equalizes
the lengths. `automatic` derives both handles from adjacent anchors; dragging a
handle changes it to `smooth`, while Alt creates an independent `corner` edit.
These modes describe tangent continuity, not a claim of higher-order curvature
continuity.

All path-editing helpers reject non-finite coordinates and avoid applying an
inverse for a non-invertible or near-singular transform. Empty holes may be
removed, while an outer ring is not reduced below two open or three closed
anchors by ordinary deletion.

## Coordinate and hit-test contract

Rendering, overlays, and node hit testing use the same pipeline:

```text
path-local → complete node/ancestor affine → world → camera rotation,
floating origin, pan, zoom, viewport → CSS-pixel screen
```

Anchor, handle, and segment proximity is evaluated in screen space. The hit
radii are CSS-pixel hand tolerances and are not divided by zoom. Pointer
movement is converted back through the complete affine inverse before geometry
mutation, so rotation, reflection, non-uniform scale, shear, and nesting do not
change the meaning of a drag.

The deterministic hit priority is anchor, handle, then segment. Anchors win
when a collapsed/crowded handle overlaps the anchor target. A segment drag
keeps its endpoint anchors fixed and adjusts that segment's endpoint handles;
it is a deliberately bounded direct-bend operation, not a promise that
adjacent segments remain unchanged when an endpoint handle is shared.

## Selection and transactions

Node selection is scoped to the active path and represented internally as
global ring indices. Topology operations return explicit remaps:

- de Casteljau insertion remaps later indices and selects the inserted node;
- deletion removes deleted indices and compacts surviving indices;
- reversal maps each selected point to its reversed ring position;
- hole deletion removes only the selected hole ring when all its points are
  deleted.

This keeps selection attached to the intended point without a document-schema
migration solely for anchor IDs. A document or target disappearing during an
active gesture cancels the gesture. Selection-only clicks do not open history.

The gesture state is idle/selection, potential drag, active drag, commit, or
cancel. A transaction starts only after three CSS pixels of movement, commits
once on pointer-up, and aborts on Escape, `pointercancel`, lost capture,
focus loss, tool deactivation, or target invalidation. Keyboard nudges use one
transaction for a held-key sequence. `Escape` first cancels an active drag;
pressing it again exits node editing.

## Available operations

Implemented through canonical helpers and visible node-edit controls:

- anchor and multi-anchor movement, including holes;
- independent, smooth, symmetric, and automatic handle behavior;
- numeric local anchor coordinates and relative handle vectors;
- nearest-segment insertion, including a closed contour's closing segment,
  using cubic de Casteljau subdivision;
- ordinary anchor deletion with bounded topology rules;
- open/close, reverse, line/corner conversion, curve/smooth conversion, and a
  bounded segment-bend gesture;
- keyboard nudge, mode shortcuts, cancellation, undo, and redo.

Break/split into separate path objects and joining separate endpoint objects
are intentionally unavailable in this milestone. The control is visible but
disabled with an explanation rather than acting as a no-op. Shape-preserving
general deletion, arbitrary contour joining, and conversion of live parametric
objects are also not implied by the available controls.

Topology changes are blocked when the path is referenced by text-on-path,
masks/clipping, effects or adjustment scopes, motion/timeline data, component
relationships, or interaction data. This prevents the common “operation looks
successful but a dependent feature silently drifts” failure; users must detach
or convert the dependent feature first.

## Persistence and downstream rendering

`mode` is optional JSON data. Existing documents load unchanged, and
`DocumentCodec` preserves explicit modes through save/reopen. The Rust path
wire type accepts and re-emits the optional semantic while renderers continue
to use anchors and handles only. No document-format migration is required.

Varve JSON remains the editable interchange format. SVG/PDF export preserves
the resulting path geometry and paint semantics supported by those exporters;
semantic node modes are an editor affordance and are not represented by
standard SVG path commands. SVG import therefore creates legacy/inferred node
modes until the user assigns a mode in Varve.

Before shipping a change to this area, verify path-cache/bounds invalidation,
strokes, joins/caps, dashes, fills and holes, masks, text-on-path, motion
references, save/reopen, duplication, SVG import/export, and PDF export. The
topology guard is conservative because those dependent systems do not share a
single editable-path identity model yet.

## Verification contract

Focused geometry and interaction checks include rotated/sheared transforms,
closing-segment insertion, compound holes, mode constraints, reversal,
finite-coordinate rejection, group movement, selection-only history, pointer
cancellation, persistence, and topology dependency blocking. Real browser
verification must drive the actual canvas with Playwright and inspect both the
rendered artwork and the node overlay; a passing unit test is not evidence that
the overlay is aligned.

The current known platform boundary is the actual browser/Tauri webview pair
available on the validation host. A Chromebook viewport or user-agent string
is not reported as physical ChromeOS hardware coverage.
