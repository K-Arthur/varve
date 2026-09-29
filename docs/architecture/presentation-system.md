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
notes omitted. Thumbnails, preview, and output share the ordinary frame export
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
Removing a layout source preserves its materialized slide artwork. Built-in
layout templates, formatting inheritance/reset, and linked themes are still
planned.

The Slides tab has initial advisory preflight for missing included frames,
unfinished placeholder text, small type, obvious off-slide shapes, and
missing slide alt descriptions. The check can focus the affected frame or
object; only missing included artwork blocks delivery. It does not yet inspect
font/image readiness, contrast, or measured readability, and its bounds
estimate does not account for every nested transform or effect expansion. The
marketing and public documentation pages label current behavior as a
source-build preview and disclose that raster PDFs are not editable, searchable,
or tagged for accessibility. Source-build status does not imply a published
release.

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
slide artwork. Built-in layout templates, formatting inheritance/reset, and
individual override reset are not yet implemented. The current manager accepts
an existing non-slide frame anywhere in the document; the planned dedicated
Presentation Layouts Design Canvas and source-edit navigation are still open.

Themes are not implemented yet. Before linking presentation typography and
colors, the general style-resolution path must preserve all authored text-style
fields (including font references, paragraph spacing, and vertical alignment)
and route user formatting edits into theme overrides. The current editor can
write inline typography that would otherwise be replaced by style resolution.
Theme fragments and layout-source IDs also still need to join the existing
cross-document clipboard resource maps. Paste must retain local artwork without
creating deck membership.

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
