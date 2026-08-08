# Pages vs Frames — separating surfaces from containers

Status: proposal. Written 2026-08-08 after the "images only render inside
pages" report. Addresses a structural incoherence, not a single bug.

## The problem

Varve has grown **two parallel concepts for "a rectangle that owns content"**,
with different ownership, coordinates, and render paths:

| | `Page` (print) | `FrameNode` (design) |
|---|---|---|
| Declared in | `doc.pages[]` (`scene/pageScene.ts`) | `doc.nodes` like any node |
| Content ownership | `page.contentRoot` — a separate root | `frame.children` |
| Position | `PagePlacement`, auto or explicit, computed by `buildPlacedScene` | node `transform` |
| Clipping | implied by trim geometry | opt-in `clipContent` |
| Extras | backgrounds, masters (ADR-0132), numbering, bleed, export ranges | auto-layout, components, variants |
| Reaches the renderer via | `multipageRootNodes()` — a bespoke flattening | the ordinary node walk |

`multipageRootNodes` returns a flat id list mixing four different kinds of
thing — globals, pasteboard items, per-page backgrounds, projected master
content, and page content — each of which needs *different* transform handling
downstream (master nodes need `masterOffsets` applied; page content does not;
pasteboard items are world-space). CanvasArea then has to know which is which.

That is the incoherence. Every consumer — hit testing, snapping, selection,
export, the minimap, page thumbnails — has to re-derive "which surface does
this node belong to, and what coordinate space is it in". Each does it
slightly differently, which is exactly the shape of the reported bug: the
selection overlay resolves the image's position correctly while the content
pass does not draw it.

Design work is frame-centric (Figma-like); print work is page-centric. Today a
document is pushed into one mode at creation (`page-based document start
mode`, `a11730a5`), and the two models do not compose: a frame inside a page,
or a page-like export region around frames, has no coherent meaning.

## The proposal: one `Surface` concept, two presets

Introduce a single abstraction that both Pages and Frames are expressed in
terms of, rather than a third thing alongside them.

```ts
/** A rectangular region that owns content and can be exported. */
interface Surface {
  id: NodeId;
  kind: 'page' | 'frame' | 'artboard';
  /** World placement. Pages may compute this from spread layout. */
  placement: { x: number; y: number };
  size: { w: number; h: number };
  /** Content is ALWAYS the surface node's own children. No separate root. */
  /**
   * User-set container clipping — the existing Figma-style `clipContent`,
   * applying to pages and frames identically because it is a property of a
   * container, not of a page. Default false everywhere.
   */
  clipContent: boolean;
  /** Print-only geometry; absent on design frames. */
  print?: { bleed: Bleed; trim: Rect; masters: NodeId[]; pageNumber?: string };
  exportable: boolean;
}
```

### Clipping is a render intent, not a surface property

The first draft of this plan gave pages `clip: 'to-trim'` by default. That is
wrong, and InDesign is the proof: it never clips on the canvas — overflow sits
on the pasteboard and an object straddling the trim edge draws in full — and
always clips on output. Same document, two answers, so the answer cannot live
on the page.

| Intent | Clip applied |
|---|---|
| Canvas / editing | container `clipContent` only (default: none) |
| Preview / presentation | container clip + trim |
| Export / print | container clip + trim + bleed |

The trim/bleed clip is **derived at output time and never stored**. A page and
a frame therefore behave identically while editing, which is the behaviour the
"images only render inside pages" report expected.

**Accepted consequence:** in a multi-page document with tightly auto-placed
pages, content overflowing page 1 will visually overlap page 2 on the canvas.
This is what InDesign does and is the correct trade — hiding a user's object
because it crossed an invisible boundary is worse than overlap. Mitigations are
presentational only: page gutters in the auto-placement, and optionally dimming
content that falls outside trim rather than removing it.

Key moves:

1. **Collapse `page.contentRoot` into the surface node's children.** A page
   becomes a node in the tree like a frame, not a parallel structure with a
   detached content root. This deletes the "is this id a content root?" check
   in `multipageRootNodes` and the whole pasteboard-vs-page-content
   classification.

2. **Pages are additive, not a document mode.** A document does not decide at
   creation whether it is "page-based" (`a11730a5`); it starts as a canvas and
   you *add* a page exactly as you add a frame. `doc.pages[]` stops being
   storage and becomes a **derived ordering** over page-kind surface nodes.

   Nothing needs the separate list: page numbering, spread sequence and export
   ranges all derive from document order. Removing it removes the possibility
   of the two representations disagreeing — which is the class of bug that
   produced the original report.

   "New print document" still gives you a page: the template seeds one page
   node. That is a creation-time convenience, not a fork in the document
   model, so a design document can gain a page later and a print document can
   hold frames — neither is currently expressible.

3. **Make clipping explicit and shared.** `clip: 'never' | 'to-bounds' |
   'to-trim'`. Design frames default to `to-bounds` only when the user asks
   (matching `clipContent` today); pages default to `to-trim`. Content outside
   a surface is then *visible by default on the canvas* unless clipping is on,
   which is the Figma behaviour the report expects — and it becomes a property
   the user can see and change rather than an emergent consequence of which
   creation mode the document was started in.

4. **One placement resolver.** Page spread layout stays, but it resolves into
   `Surface.placement` before rendering. The renderer then has exactly one rule:
   a surface's children are positioned relative to their surface. `masterOffsets`
   stops being a renderer special case.

5. **Pasteboard is just "no surface".** Nodes whose parent is the document root
   render in world space. That is already true; the point is that it stops
   being a *fourth* category in `multipageRootNodes`.

6. **Print features stay opt-in and page-only.** Bleed, trim, masters,
   numbering, export ranges live in `Surface.print`, present only on pages.
   Design mode never sees them; print mode gets them without a separate tree.

## What this fixes

- One walk for the renderer: surfaces in document order, children within.
  `multipageRootNodes` shrinks to an ordering function, not a flattener.
- One answer to "which surface owns this node", shared by hit testing,
  snapping, selection, export and thumbnails.
- Content outside a surface renders unless clipping is explicitly on — the
  reported symptom becomes impossible by construction rather than by fix.
- Frames and pages compose: a frame inside a page is an ordinary container; a
  page is an exportable surface with print geometry.

## Migration

This is a scene-schema change and must not silently rewrite documents.

1. Add `Surface` alongside the existing model; derive it from `doc.pages` and
   frame nodes with no behaviour change (pure read model). Land it with tests
   proving the derived surfaces reproduce today's `multipageRootNodes` output
   exactly, for both page and flat documents.
2. Move consumers onto the read model one at a time (renderer, hit test, snap,
   minimap, export), each behind the golden/oracle suites.
3. Only then change storage: promote pages to real nodes, fold `contentRoot`
   children into them, bump the schema with a migration and a round-trip test.
4. Delete `contentRoot` and the pasteboard classification last.

Steps 1-2 are reversible and carry the risk; step 3 is the one that needs a
schema version and a migration test.

## Explicitly out of scope here

Auto-layout semantics inside pages, spread/facing-page layout rules, and
whether artboards should be a third preset or just a frame with
`exportable: true`. Those are worth deciding, but they do not block the
separation above.

---

## Export: multi-page PDF and per-surface output

The Rust side already has what is needed (`varve-print`, lopdf, CMYK/PDF-X,
font outlining) plus a page-range parser and filename tokens (`b84ecfef`).
What the surface model changes is *selection and clipping*, not the writer.

| Target | Surfaces used | Clip |
|---|---|---|
| Multi-page PDF | `kind==='page' && exportable`, document order | trim + bleed |
| Single-page PDF | one selected surface | trim + bleed |
| PNG/SVG/WebP | any selected surface (page, frame, artboard) | surface bounds |
| Canvas export | whole document | union of content |

Rules that must be explicit, because they are where users get surprised:

1. **Ownership decides membership, not geometry.** A node parented to page 1
   that visually overlaps page 2 exports on page 1 only. Geometry-based
   membership (InDesign's model) sounds friendlier but makes export
   non-deterministic under nudges. Ownership is deterministic and matches the
   layer tree the user can see.
2. **Bleed is content, trim is the cut.** Export clip is trim + bleed; crop
   marks reference trim. Content must be allowed to extend into bleed, so the
   export clip is strictly larger than the page rectangle.
3. **Pasteboard content never exports.** Nodes owned by no surface are working
   material. This is the InDesign contract and users rely on it.
4. **Page ranges are stored by surface id, rendered as numbers.** Storing
   `"1-5"` breaks the moment a page is inserted mid-document. Numbering is
   derived; the stored range must not be.

## Not interfering with the other workspaces

Workspace invariant 1 ("mode never forks the scene") is *strengthened* here:
with pages as ordinary surface nodes, a document is the same document in every
mode. What differs is disclosure, not structure.

| Mode | Pages | Frames |
|---|---|---|
| Design / Draw / Photo / Motion / Logo | absent unless added | primary |
| Print | seeded by the template | allowed, ordinary containers |

Nothing in Design mode changes: a document with no page surfaces walks exactly
the path it does today (`multipageRootNodes` already falls back to globals +
`rootChildren` when `pages` is empty).

## Raw placement on the canvas

Placing an image with no surface under the pointer must keep working and must
not invent a container.

- Parent to the **deepest surface whose bounds contain the drop point** and
  that accepts children; otherwise to the document root.
- **Never auto-create a frame.** Neither Figma nor Illustrator does, and a
  surprise container breaks subsequent transforms and export membership.
- A root-parented node is world-space, fully visible, exportable only via
  canvas/selection export.

## UI changes

### Progressive disclosure — page navigation

Page UI should not exist until pages do. Specifically:

- **Pages panel and page navigation (prev/next, "Page N of M") are hidden at
  zero pages** in every non-print workspace, and appear the moment the first
  page surface is added.
- **Print mode is the exception:** it shows the Pages panel with an empty
  state and an "Add page" call to action rather than hiding it, otherwise a
  print user opening a blank document sees no route to the feature.
- Discoverability at zero pages elsewhere: `Insert > Page` in the menu and the
  command palette. Not a toolbar button — that is prime real estate for a
  feature most design documents never use.
- Hiding must key off **`pages.length > 0`**, never off workspace mode alone,
  or a design document that gained a page would have no way to navigate it.

### Page size, like any other surface

Pages get the same Position & Size treatment frames get, plus print presets:

- W/H editable in the Inspector, identical control to a frame's.
- **Preset dropdown** (A4, A3, Letter, Legal, Tabloid, A5, custom) with an
  orientation toggle. Frames keep their device presets; both use one shared
  control so the two never drift.
- Presets are a *starting point*, not a constraint — custom dimensions must
  stay first-class, including non-standard sizes for packaging and signage.
- **Resizing a page must ask what happens to content.** `document-pages.ts`
  already has subtree scaling; the default should be anchor top-left (content
  keeps its size), with "scale content" as the opt-in. Silently scaling a
  user's layout because they changed paper size is destructive.
- Facing-page/spread settings constrain placement, not size.

### Other surfaces of the change

- **Layers panel:** pages appear as ordinary container rows once they are
  nodes, ending the current split between the Pages panel and the layer tree.
- **Inspector:** a "Print" section appears only when the selected surface has
  `print` geometry (bleed, margins, masters, numbering).
- **Selection outside its owner:** when a node is selected while sitting
  outside its owning surface, show a quiet affordance ("on Page 1") — this is
  precisely the state that produced the original bug report and it should be
  legible rather than mysterious.

## Edge cases and gaps worth deciding now

1. **Reparenting on drag across a page boundary.** Figma reparents into the
   frame under the cursor; InDesign never reparents. Recommendation: reparent
   on *drop into a surface* with a modifier to suppress, and **never** reparent
   on arrow-key nudge — otherwise a nudge can silently change export
   membership.
2. **Deleting a page that owns content outside its trim.** Today
   `removeNode(d, page.contentRoot)` destroys the subtree. That content is
   invisible on the page and may be the user's staging area; deletion should
   offer to keep it on the canvas.
3. **Z-order between pasteboard items and pages.** Today pasteboard content
   paints *before* every page, so it is always behind. Once pages are nodes,
   z-order should be document order. This is a visible behaviour change and
   needs a migration decision.
4. **Snapping and guides** should treat page trim, bleed and margins as snap
   targets on equal footing with frame edges.
5. **Undo granularity:** add-page, resize-page and reparent-on-drop must each
   be one undo entry.
6. **Master pages vs components.** Both are "reusable content projected
   elsewhere". They should not converge yet, but the overlap should be
   revisited once surfaces land.
7. **Performance watch item.** The page-culling fix walks a page's content
   subtree when its trim is off-screen, memoized per document revision. On a
   document with very many pages this is a full scene walk on the first frame
   after every edit. If it shows up in profiles, the fix is a per-page bounds
   revision (bump on subtree mutation), not a weaker cache key — see the
   comment in `pageContentWorldBounds` for why a node-identity key is unsound.
