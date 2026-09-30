# Presentation system

Varve presentations are ordered views over ordinary editable frame nodes. The
same scene, editing tools, history, and persistence are used for general Design
work and slide authoring. Deck membership does not alter frame ownership, page
placement, paint order, or canvas coordinates.

## Implementation status — 2026-09-29

The current source-build preview implements the versioned deck metadata,
2.30-to-2.31 migration, typed deck/slide/section operations, canonical slide
resolution, 16:9/4:3/vertical/custom presentation creation, selected-frame order
review for creating or appending to a deck, and the Slides navigator with
rendered frame thumbnails, rename, deep-clone duplication, skip, reorder,
private notes, section management, reference removal, overview, and focused
frame editing. The navigator is available only for documents with a
presentation deck in Design mode. Save and reopen use the normal document
codec.

Audience preview uses a top-layer dialog with keyboard navigation and private
notes omitted. Playback is a modal surface: the global shortcut layer is
intentionally inert while it is open, so the stage carries focus and handles
Space/Enter (advance), the arrow, PageUp, PageDown, Home and End keys, and
Escape (exit) itself. Reaching the last slide stops and announces a boundary
instead of wrapping silently to the first, and the visible Previous/Next
controls disable at the ends for the same reason. The stage lays out as an
explicitly sized area so the slide letterboxes inside it rather than being
cropped. Thumbnails, preview, and output share the ordinary frame export
renderer; slide capture maps world content into exact frame-local dimensions,
clips to the slide rectangle, and waits on the export readiness barriers.
Delivery writes mixed-size multipage raster PDF and ordered PNG ZIP through the
existing save adapter. Current capture caches are revision-keyed, bounded, and
cancellable. The source build has not yet completed the planned mask/effect
fidelity matrix, stress-deck measurements, or published-release review.

Basic geometry layout sources and previewed reapplication now work in this
source build. Authors can register a non-slide frame, assign stable role names
to its direct children, map compatible shape/text objects on a slide, preview
reflow, uniform fit, or uniform crop, and apply the result as one undoable
operation. Preview is checked against the current source revision and slide
geometry. Text and rich runs, target fills, effects, image-fill crop intent,
notes, identities, and unmatched artwork stay on the slide. Managed geometry
baselines preserve local overrides. Source edits are detected against the
captured geometry and must be explicitly refreshed before reapplication.
Removing a layout source preserves its materialized slide artwork. Seven
original sources are generated as ordinary editable frames on the dedicated
`Presentation Layouts` Design Canvas: title/section, body, image/text,
comparison, evidence, process, and conclusion. They use placeholder text,
native vector geometry, and the bundled default artwork font, so source
creation needs no network or external stock asset. The author can also register
any ordinary non-slide frame as a layout source. Every mapped object reports
inherited versus locally changed state against its recorded baseline, with
per-object and per-property reset. Formatting inheritance is still planned.

Two more capabilities are in the source build. Slide-size conversion (16:9 to
4:3 or vertical, or a custom size) is previewed before it is applied and lands
in one undo step; it offers Fit inside, Fill and crop, and an explicitly
labelled Stretch, and it never moves frames on the canvas. Linked colour
themes point slide objects at real document variables, so editing a colour in
the Variables panel recolours every bound slide at once while deliberately
recoloured objects stay as they are.

The Slides tab has initial advisory preflight for missing included frames,
unfinished placeholder text, small type, off-slide content, missing slide alt
descriptions, unavailable fonts recorded in the document manifest, unresolved
image asset references, and low contrast when both text and slide background
are known solid colors. Bounds follow nested scene transforms and the slide
frame; effect-expanded pixels and detailed readability remain outside the
current check. Contrast is advisory and configurable, and skips gradient,
image, transparent, and otherwise ambiguous backgrounds. Only missing included
artwork blocks delivery. The marketing and public documentation pages label
current behavior as a source-build preview and disclose that raster PDFs are
not editable, searchable, or tagged for accessibility. Source-build status
does not imply a published release.

## Document model

`Document.presentation` is optional and versioned independently from its frame
artwork. It contains multiple decks; each deck has stable identity, a slide
pixel size, sections, a theme reference, and an ordered array of slide entries.
An entry carries its stable ID, referenced frame ID, title, private notes,
skip state, optional section/layout/theme references, and accessibility
metadata. The array is the sequence contract. Scene node order and Design
Canvas placement never determine slide order.

The `presentation` schema normalizer preserves references even when the target
frame is gone. Notes, title, and sequence position therefore remain available
for recovery. Removing a slide entry leaves the frame tree untouched; deleting
the artwork is a separate scene operation. Different decks may reference the
same frame, and the resolver reports that shared use.

## Resolution and operations

`resolvePresentationSlides(document, deckId)` is the shared ordering and
inclusion contract. It returns every entry in explicit order, including
skipped, hidden, invalid, or unresolved items; each item has a status and a
default-inclusion flag. `includedSlides` contains valid, visible,
non-skipped frames. `deliveryErrors` identifies unresolved included
references that must be repaired before export. Audience preview and export
consume this same result, while the navigator can show all entries and their
status.

Mutations use registered `presentation.*` operations. Transactions group those
operations into the existing document history mechanism. Preview navigation is
transient. The supported operations create, rename, and remove decks; add,
remove, update, and reorder entries; create, rename, and remove sections; and
register, refresh, remove, and apply geometry layout sources. Add rejects a
second reference to the same frame within one deck but allows another deck to
share it.

The document version migration from 2.30 to 2.31 is additive. Old documents
have no presentation metadata and continue to open unchanged. Metadata schema
normalization retains broken frame IDs rather than cleaning them up silently.

## Layouts and themes

Reusable layout sources are editable frames. The initial UI registers an
existing non-slide frame and assigns role names to its direct shape/text
children. Slide objects are mapped by the author before preview; compatible
geometry is never guessed by paint order. The first reapply implementation
manages text boxes and matching primitive shape bounds; path, line, arrow, and
table geometry stays unmatched to protect its artwork. The source geometry
snapshot detects edits, and an explicit refresh increments its revision. A slide stores its
source revision, role mapping, and baseline for only managed geometry
properties. Reflow, uniform fit, and uniform crop are previewed before Apply;
the operation rejects an outdated preview. Local geometry overrides are
retained. Removing a source unregisters it but does not delete materialized
slide artwork. Seven original templates—title/section, body, image/text,
comparison, evidence, process, and conclusion—are editable frames on a separate
`Presentation Layouts` Design Canvas. Their source text and vector placeholders
use the bundled artwork font and no external assets. Authors can edit those
frames through the normal Design Canvas navigator. The manager also accepts an
existing non-slide frame anywhere in the document.

### Inherited versus overridden state

Because application materializes geometry rather than leaving a live link, the
override report compares each managed key on the slide against the baseline
recorded at application time, using the same projection the apply path used
(`describePresentationLayoutOverrides`). Each mapped object reads `Inherited`,
`Locally changed`, or `Object removed`, and each changed key gets its own
reset.

`presentation.layout.overrides.reset` restores only keys the layout owns,
narrowable to one object or one property. It merges shape geometry, so fields
the layout does not manage — corner radius, gradients, strokes — survive, and it
never touches identity, name, fill, effects, or text. `presentation.layout.detach`
removes the binding only; since nothing stays live between source and slide, the
resolved appearance is preserved by construction, which is what makes
"detach and keep appearance" a statement about this system rather than a promise
about a link that did not exist. Both are precondition-checked by the operation
registry, so a reset on a property the layout does not own is refused with an
actionable message instead of silently doing nothing. Formatting inheritance
and formatting (as opposed to geometry) reset remain unimplemented.

### Themes

A theme is not a snapshot of colours. Each theme role (`title`, `subtitle`,
`body`, `caption`, `accent`, `background`) points at an ordinary document colour
variable created in the `Presentation themes` collection, and slide objects hold
a `bindings.fill` reference to that variable — the same binding path the
renderer already resolves on every frame. Editing one variable therefore
recolours every bound object with no rebuild, no deck walk, and no flattened
output, and the colours remain editable in the Variables panel rather than
living in a private palette.

`PresentationSlideThemeBinding` persists which theme and which role-to-object
mapping a slide uses, so a mapping chosen by hand survives reload, and it is
deliberately kept across detach so re-applying resumes the author's mapping
instead of starting over.

Local overrides are preserved by rule rather than by memory: once a slide has
been themed, an object whose fill no longer follows a theme variable is an
intentional colour and is skipped when a later theme is applied. Detach bakes
the currently resolved colour into the node and removes the binding — the same
contract `unlinkStyleFromNode` keeps for text styles — so appearance is
identical while the object stops following the brand.

Typography is not applied yet: `PresentationTheme.textStyles` stays
schema-ready, and the text-style resolver retains font references, paragraph
spacing, vertical alignment, and zero-valued style properties, but a per-role
text style changes font metrics and therefore reflow, which needs its own
review. Theme fragments and layout-source IDs also still need to join the
existing cross-document clipboard resource maps; paste must retain local
artwork without creating deck membership.

### Deck size and aspect-ratio conversion

The deck declares one slide size; its frames are ordinary artwork parked on the
canvas. `previewPresentationResize` is a pure function that reports, per slide,
the frame change, the content scale, and the centering offset, plus warnings for
the mode, for mixed-size slides, and for unresolvable references.
`presentation.deck.resize` re-checks that preview against the current deck
before applying, so a stale preview is refused rather than committed.

Content is scaled by applying `T·S·child` to each frame's *direct* children in
their parent's local space. Because `world = parent ∘ local`, every descendant,
text size, gradient, and vector shape follows without a descendant walk and
without rewriting geometry. Each slide ends at the chosen size; Fit and Fill
scale uniformly and centre, while Stretch scales each axis independently and
says so before anything commits. Frame transforms are never touched, so canvas
positions are unchanged, and an anisotropic conversion round-trips exactly with
its inverse.

## Rendering and delivery

Thumbnails, the audience view, and deck exports use one frame-local capture
adapter over the existing export renderer. Capture resolves the frame's local
bounds and inverse world transform, clips to the declared slide rectangle,
and waits for font and image readiness. Effect-expanded bounds cannot change
the output page size. Thumbnail work begins only near the visible list region;
its revision-keyed URL cache holds at most 12 entries. The audience preview
keeps a six-entry LRU cache, aborts stale work, and suppresses results from an
outdated document revision.

The audience view uses the shared top-layer dialog system so the editor's
sidebar and dock controls cannot paint over the slide. It supports current,
previous, and next slide navigation, keyboard control, fullscreen fallback,
speaker notes private (they are not shown), and focus restoration on exit. It excludes skipped
slides and scene-hidden frames, and navigation does not create history steps.

Initial delivery outputs are:

- One compressed multipage raster screen PDF, with one page per included slide
  and explicit pixel-to-point mapping for mixed slide sizes.
- One ordered PNG archive whose filenames encode stable sequence positions.

The export captures one document revision, processes slides sequentially under
the existing resource budget, and reports success only after the save adapter
completes. Missing included frames block delivery with a repair route. Empty or
all-skipped decks present an actionable state. Notes, nonmember artwork, and
scene-hidden slides are excluded by default. Raster PDF output preserves
appearance but does not contain editable slide objects or structured reading
order; accessibility claims must match the inspected PDF.

## Quality checks

Preflight is advisory except for missing included frames. The current checks
cover placeholder-looking text, authored text size, approximate shape overflow,
and missing slide alt descriptions. Font availability, image readiness,
contrast, output support, and detailed readability remain future checks.
Titles, language, alt text, and reading order are stored separately from paint
order.

The regression matrix in
[`docs/audits/presentation-workflow-defects-2026-09-29.md`](../audits/presentation-workflow-defects-2026-09-29.md)
tracks Varve reproductions separately from other-product reports. Each modest
deck is compared across editor, thumbnail, audience preview, reopened document,
and actual exports. Large decks are checked for sequential work, cancellation,
cache bounds, and memory recovery.
