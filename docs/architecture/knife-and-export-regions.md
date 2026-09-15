# Knife and Export Regions

Two features that used to be one, badly. This document records what each of
them is, why they were separated, and exactly where the boundaries of the
current implementation are.

## The problem this replaced

A single tool called **Slice** (`K`, scissors icon) drew a rectangle and then
called `createShapeAt`, which in `context.tsx` treated `activeTool === 'slice'`
identically to `activeTool === 'frame'`. The result was an ordinary `FrameNode`
named "Node". It

- painted the frame's grey fill over the artwork it was supposed to describe;
- ran frame capture-on-draw, adopting every fully-contained sibling into itself;
- resolved as a containing surface, so anything later drawn or dragged over it
  was reparented into it;
- offered auto-layout, clip-content and sizing controls in the inspector;
- and carried no export configuration, so it never appeared in the export
  dialog.

In other words the tool named after cutting produced a frame, and the export
feature it was actually implementing did not reach export. Both halves are now
real features with separate names, icons, shortcuts and semantics.

| | Knife | Export Region |
|---|---|---|
| Shortcut | `N` | `K` |
| Icon | Scissors | Crop |
| What it does | Divides artwork into independently editable objects | Marks a rectangular area to export |
| Destructive | Yes — the source object becomes its pieces | No — artwork is untouched |
| Aliases | object slice, split, cut | slice, export slice, export region |

## Export Region

An Export Region is stored as a `FrameNode` with `frameRole: 'exportRegion'`.
Keeping the frame node kind means transforms, resize, selection, clipboard, the
document codec and the layers tree all keep working with no new code. What
changes is everything that would make it behave like a container:

- **It paints nothing.** `sceneNodeToEngineNode` compiles a region to a fully
  transparent rect with no fills, strokes or effects. This is enforced at the
  conversion boundary rather than by writing a transparent fill at creation,
  so a document saved by an older build — which still holds the frame grey —
  also stops painting when reopened.
- **Its boundary is chrome, not artwork.** `ExportRegionOverlay` draws a dashed
  outline and name badge in the overlay layer. All four corners are projected
  through the region's world transform, so a rotated or nested region traces
  its real edges rather than an axis-aligned box.
- **It never adopts content.** `findContainingFrameInDoc` skips regions, and
  draw-time frame capture does not run for them.
- **It is not a layout container.** The inspector drops the frame-only layout,
  clip-content and child-slot sections; the breadcrumb reports it as an Export
  Region and marks it non-enterable.
- **It is an export target from the moment it is drawn.** Creation seeds the
  canonical 1× PNG `ExportPreset`, and `exportableNodes` lists regions whether
  or not presets remain — a region whose presets were all deleted should still
  be visible in the dialog, because being exported is the only reason it
  exists. This reuses the existing export configuration model; there is no
  parallel export-region model.

`isExportRegion` in `@varve/scene` is the single predicate. It deliberately
does **not** fold into `isContainer`, which still reports `true`: the node
really does carry a (always empty) `children` array, so adoption has to be
refused explicitly at each site rather than by accident of the node kind.

## Knife

### The cut

The knife is the straight segment the user drags, in world space. Shift
constrains it to 45° steps. The gesture is preview-only: the cut line is a
`DraftShape`, never a SceneNode, so dragging across a thousand objects mutates
nothing. On pointerup the editor applies the whole cut in one transaction.

**A shape is split only when the cut passes all the way through it.** Every
point at which the cut's line enters or leaves the outline must fall inside the
dragged span. This is the rule that makes the tool predictable:

- a short drag near a large shape does nothing rather than silently splitting
  it along an infinite line;
- a cut across one arm of a concave shape never also slices an arm the user
  never dragged over.

A partial cut — one that stops inside the object, the way Illustrator's knife
leaves a notch — is not supported. It needs true path booleans rather than a
line split, and refusing is better than approximating.

### The geometry

Splitting is a chain walk, not half-plane clipping.

Clipping each side of an outline against the cut line collapses the result into
one ring per side. That is wrong for any concave shape: a horizontal cut through
both arms of a U leaves one piece below the cut and **two** above it. So:

1. The outline is flattened with `@varve/scene`'s `shapeToPolygon` — the same
   sampler the boolean operations use, so a cut and a boolean agree on
   identical input.
2. The ring is augmented with a vertex at every crossing of the cut.
3. Each side's maximal runs of the outline become *chains*.
4. Chains are re-closed along the cut. The connecting run is the one whose
   midpoint lies inside the original outline — that is what distinguishes
   crossing the shape from crossing the gap in a concave one — and among those,
   the nearest along the cut.
5. Tracing the resulting cycles yields however many pieces the geometry really
   has.

`booleanOp` is not reused for this. It assembles exactly one contour and
simplifies at a 0.5px tolerance, both of which lose pieces a knife must keep.

Open paths need none of this: each crossing simply ends one piece and begins the
next.

### Coordinate spaces

Cuts are computed in **world** space and written back in **local** space. Each
piece keeps the source node's `transform` untouched; only its geometry changes.
That is what makes a piece land exactly where the source was under rotation,
non-uniform scale, negative scale, and nested transformed hierarchies.

### Tolerances

| Constant | Value | Meaning |
|---|---|---|
| `ON_LINE_DISTANCE` | 1e-6 world px | Perpendicular distance at which a point counts as on the cut. Compared in world units, not raw cross-product magnitude, which scales with the cut's length. |
| `SPAN_TOLERANCE` | 1e-6 of cut length | Slack on "this crossing is inside the drag". |
| `MIN_AREA` | 0.01 world px² | Pieces below this are discarded as numerical debris. |
| `MIN_CUT_LENGTH` | 1e-3 world px | Below this a cut cannot express a direction. |

## Supported objects

| Node type | Knife | Behaviour |
|---|---|---|
| Rectangle | Yes | Split into closed paths. Corner radius is dropped — the outline is now explicit, and keeping the radius would round the cut edge too. |
| Ellipse / Circle | Yes | Flattened outline split into closed paths. |
| Polygon / Star | Yes | Concave outlines yield every piece the cut creates, not two. |
| Closed path | Yes | Split into closed paths; fill rule preserved. |
| Open path / Line | Yes | Split at each crossing into open paths; stroke styling carried through. |
| Image | Yes | Non-destructive: both pieces reference the same asset. See below. |
| Text | No | Refused with "Live text can't be sliced. Convert *name* to outlines first." Never converted silently. |
| Group / Frame | Traversed | The container is never cut. The knife descends to leaf artwork, and the hierarchy is unchanged: pieces stay inside the container that held the source. |
| Component / Instance | Traversed | Same as frames — the knife reaches leaf geometry and does not restructure the instance. |
| Compound path (with holes) | No | Refused. Each hole would need re-assigning to whichever piece still contains it; leaving the path whole beats dropping its holes. |
| Warped / masked / traced / background-removed | No | Refused. The painted outline is not the stored one, so cutting the stored geometry would move visible pixels. |
| Table / Arrow | No | Refused. |
| Locked or hidden (including via an ancestor) | No | Skipped silently — not the knife's business. |

### Images

An image in Varve is a shape carrying an image *fill*, so slicing an image is
slicing its geometry. The catch is that image placement resolves against the
node's own local bounds, so a piece with smaller bounds would re-fit the
picture and shift it.

Every fit mode lands the source in some rectangle. That rectangle is computed
once and re-recorded on each piece as an explicit `crop` placement offset by the
piece's own origin. Both pieces keep referencing the one asset — no pixels are
copied, no bitmap is extracted, and the picture does not move. `crop` and `tile`
placements are already bounds-relative, so they only need the origin shift, which
also keeps a tiled fill on the same lattice.

Two cases are refused rather than approximated:

- **`stretch`** — non-uniform by construction, and a single crop scale cannot
  express it.
- **Unknown natural size** — without `imageWidth`/`imageHeight` there is no way
  to know where the source landed.

## Feedback

- `KnifeHoverOverlay` traces the outline under the pointer while the knife is
  active: solid in the accent colour when the object can be cut, muted and
  dashed when it cannot. Eligibility comes from `knifeRejectionFor`, the same
  rules the commit runs, so the highlight cannot promise a cut the operation
  would refuse.
- After a cut, the announcer reports `Split into N objects.`
- When nothing was cut, it reports the single most useful reason — live text,
  holes, an unsupported image placement, warped geometry — falling back to
  "Nothing was sliced. Drag the cut all the way across an object." Reasons are
  only reported for objects the cut's segment actually reached, so a cut in an
  empty corner does not announce every text layer in the document.

## History and selection

The whole cut is one transaction. The preview never touches the document, so:

- one undo restores every source object, whatever the cut divided;
- one redo restores every piece;
- Escape, pointercancel, a sub-threshold click, or a cut that divides nothing
  leaves the document untouched and writes no history entry.

After a successful cut every resulting piece is selected in document order, with
the first piece primary, so the pieces can be nudged, styled or node-edited
immediately.

## Naming

The first piece keeps the source's name. Later pieces advance a trailing index,
so "Rectangle 1" yields "Rectangle 2" the way a newly drawn rectangle would,
skipping any name already taken. Names never accrete suffixes.

## Runtime parity

The knife is portable TypeScript in `packages/editor`, operating on the scene
model through `@varve/scene`. It calls no native command and no WASM entry
point, so desktop, ordinary browser and the `/try` demo run the identical code
path — there is no geometry backend to diverge. Export Regions are likewise
pure scene-model state.

## Known limitations

- Partial cuts (stopping inside an object) are refused rather than notched.
- Compound paths with holes are refused.
- `stretch` image placements, and images with no recorded natural size, are
  refused.
- Corner radius is dropped from cut rectangles.
- The cut is a straight segment; freehand cutting is not implemented. The
  geometry core takes a polyline for open paths already, so the extension point
  exists.
