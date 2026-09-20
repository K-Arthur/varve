# Comic workflow

Varve’s comic workflow is a document profile over the existing scene, page,
layer, text, history, renderer, and export systems. It does not add a Comic
workspace or a second scene model.

## Profiles

The shared preset registry provides `comic-print-a4`, `manga-a5`, and
`webtoon-vertical`. Creating a document from one of these presets records an
advisory `workflowProfile`, `paintingPpi`, `readingDirection`, and
`publishingTarget`. The profile supplies defaults for new documents; it never
changes existing artwork or hides tools. The document codec now advances to
schema 2.29; all comic fields are optional for legacy files.

`comic-print` starts at A4, RGB, and 300 PPI. `manga` starts at A5, grayscale,
RTL reading, and 600 PPI. `webtoon-vertical` starts at a 1600 × 8000 source
strip at screen resolution. These are editable conventions. Printer and
platform profiles remain authoritative for output limits.

## Story and lettering metadata

`Document.storyOutline` contains page entries with notes, production status,
explicit panel order, and ordered dialogue story IDs. Dialogue content remains
in the existing authoritative `TextStory`; outline entries only reference it.
The Pages panel exposes a keyboard-accessible outline editor for the active
comic page.

Ruby annotations are source ranges on `RichText`, so the text source is not
duplicated. A text edit can mark an annotation stale for author review. Panel
metadata and callout recipes are optional fields on ordinary `FrameNode` and
`GroupNode` values, preserving generic rendering and cloning behavior.

## Balloons and lettering effects

Selecting a text node in the Typography inspector exposes **Add speech
balloon**. `wrapTextInCallout` groups the existing text with an ordinary body
and tail, so the source text is moved rather than copied.

A balloon is a **recipe over ordinary nodes**, never a new node kind and never
a second text engine:

- `CalloutRecipe` on the group names the body, text, and tails and carries the
  authored policy: kind, padding, fit policy, wrap-shape override, and logical
  tails. `CalloutTail` groups the nodes that draw one tail, so a pointed tail
  is one editable path and a thought tail is a chain of decreasing circles;
  `tailNodeIds` remains the flat membership list generic scene operations use.
- The body is a `ShapeNode` rect with a corner radius; tails are ordinary path
  or circle nodes. Both are selectable, restylable, and exportable through the
  normal scene, layer, history, clipboard, and export systems.
- Selectable in the Comic balloon inspector: Speech, Thought, Caption, Whisper,
  Shout, Burst, and Cloud recipes; text padding; line shape (Balloon contour /
  Rectangle); fit policy (`reflow` / `fit-balloon` / `overflow`) with a derived
  fit status; the first tail's endpoint, curve, and base width; Add/Flip/Remove
  tail; and Detach geometry.
- Burst and Cloud are **shaped** balloons: an ordinary star outline painted
  behind the tail/body/text recipe, resized with the body on fit. No new node
  kind and no imported SVG path; the star's inner radius tracks the text box
  and its outer radius adds the burst or scallop depth. Tails paint behind the
  outline so their base is hidden by the balloon fill, and they anchor at the
  outline's outer edge.

### Contour (balloon-aware) text layout

Dialogue inside a round balloon does not wrap to a rectangle. The interior
shape narrows the first and last lines so the text mass echoes the outline,
with the longest line near the vertical middle.

- One derivation: `ellipseLineWidthProfile` in `@varve/shared` turns a box
  width and a **line count** into per-line maximum widths. The scene geometry
  resolver (`resolveTextGeometry`) and the canonical engine painter
  (`layoutText` in `textLayoutSnapshot.ts`) each iterate the same rule — a
  rectangular pass counts the lines, the profile is applied, and the pass
  repeats until the count stabilizes (bounded; parity is covered by
  `balloonWrapParity.test.ts`). Selection, hit testing, editing, paint, and
  export therefore break the same text the same way.
- Line count, not container height, shapes the profile: a tall mostly-empty
  balloon must not squeeze its first line into a sliver, and a one-line caption
  stays full width.
- The wrap shape is authored state on the `TextNode` (`textWrapShape:
  'ellipse' | 'rect'`); the profile is derived and never serialized. Kind
  defaults apply until the author chooses a shape explicitly, after which the
  recipe records the override and later style changes keep it.
- Vertical writing stays rectangular until column profiles are designed.

### Fitting and overflow

`fitCalloutToText` sizes the body around the bound text to a bounded fixpoint
and unions the final pass so text can never clip. It never reduces the type
size, and it never fits a contour balloon narrower than its longest word, so a
long translation grows a readable box instead of a column of broken syllables;
a bounded balance pass widens a stack that would read as a strip. A tail tip
the grown body would swallow is re-aimed along the direction the author gave
it, outside the new edge. Under the `fit-balloon` policy a snug body reports
`fit`; `reflow` reports `near-overflow` before the edge is tight. Creating a
balloon around an auto-width text node caps the measure to a lettering-friendly
width, converts it to a fixed container, and fits once — the previous flow
produced single-line ribbon balloons hundreds of pixels wide. Authored area
text keeps its box.

### Tails

Pointed tails support a signed curve (a fraction of the tail length) and a
base width; both sides bow toward a shared control point, and the authored tip
never moves when the body is fitted. Thought balloons draw a chain of
decreasing circles sized from the space each one gets, with the last circle at
the authored target. Add, flip, and remove operate on logical tails; body and
text identities never change.

### Selection and editing

The group is selected as a whole on the canvas; the body, each tail, and the
text are reached through the layer tree, and the text node remains a normal
editable `TextNode`. This is the existing scene container/deep-selection
model, not a comic-only selection mode. Double-clicking anywhere on a balloon —
the group, the body, or a tail — starts editing the bound dialogue directly
(the canvas hit-test returns the callout group, so the ancestor walk resolves
the recipe instead of entering group isolation).

Copy/paste and duplicate remap the recipe's body, text, tail, and outline
references through the clone id map; before this a pasted balloon still edited
the original dialogue, and a cross-document paste kept dangling ids. A clone
that cannot resolve its members drops the recipe and pastes an ordinary group.

### Remaining lettering work

The current creation entry point is the Typography inspector action; a
dedicated canvas drag tool for drawing a new balloon around an arbitrary
region, canvas tail-drag handles, joined balloons, per-glyph comic effects,
and a script import stay follow-ups. Tails added by hand to a Burst or Cloud
balloon anchor at the text box rather than the star's outer edge — the
creation path anchors them correctly. See `docs/plans/comic-lettering-system.md`
for the admission matrix and slice ledger.

Known defect observed during visual review (2026-09-20): the live canvas
renders shape corner radii square even though the produced IR carries
`cornerRadius` and `replayIr` calls `roundRect` for it (verified by a unit
probe against the callout's own IR). The live editor frame path is suspected;
the defect is pre-existing, affects every rounded shape, and is recorded in
`docs/audits/comic-lettering-capability-audit-2026-09-19.md` with pixel
evidence.

### Sound effects and display lettering

The Typography inspector exposes a Text effects preset library: Sound effect
(heavy uppercase display type with a contrasting outline), Outline, Whisper,
Electronic / radio, Display title, and Body text. Each preset is a patch over
ordinary `TextNode` fields — case, weight, style, spacing, stroke — so content,
story binding, and geometry are never touched, and Clear outline removes only
the stroke. A preset never outlines glyphs and never rasterizes: sound effects
remain editable text and export through the same composition snapshot as
ordinary lettering. Text strokes are painted from the canonical layout, so
a stroked area-text node keeps its outline on the same wrapped lines as its
fill. Ruby / furigana can be authored for the currently selected rich-text
range; ranges are stored as UTF-16 source offsets and the existing ruby rebase
logic marks ranges stale when their base text changes. These controls are
convenience actions over shared text primitives, not a parallel comic text
renderer.

## Panels and paint resolution

Panels are clipped frames. The panel layout helper adds stable semantic panel
metadata, supports world-transform-preserving joins, and provides
`previewPanelDivision`, which computes destination count, source-child count,
and estimated additional raster bytes before mutation.

Frame and Panel intentionally expose different preset vocabularies while using
the same `FrameNode` and renderer. Frame and New Document presets describe the
page or source-strip bounds and production defaults: A4 print, A5 manga, and an
editable vertical webtoon strip. Panel presets describe authored composition:
panel count, arrangement, gutter, and reading rhythm. They never resize the
page. The Panel tool keeps layout buttons disabled until one frame is selected,
and exposes joining when two or more semantic panels are selected. This split
follows the distinction in Clip Studio's documentation between creating and
dividing frame borders and exporting a webtoon as slices ([frame and panel
operations](https://help.clip-studio.com/en-us/manual_en/540_comic/Frames_and_Panels.htm),
[webtoon viewing and export](https://help.clip-studio.com/en-us/manual_en/540_comic/Webtoons.htm)).

The built-in panel templates are common starting points rather than universal
comic rules. `Webtoon stack` uses a larger vertical gutter for phone-scroll
pacing; the publisher's actual encoded limits remain in the publishing profile
and are validated at export. WEBTOON's current checklist, for example, limits
uploaded slices to 800 × 1280 pixels and 2 MB per image, while Tapas documents a
940-pixel width and 10 MB file limit; neither requirement defines a panel grid.
Painting fallback searches a selected panel’s descendants before searching the
active page. New raster layers use the document’s painting PPI while applying
an inverse transform so scene geometry remains in the existing 96-unit page
space.

## Bounded export

`streamTiledExport` and `writeTiledExport` expose row-major tiles to an encoder
or file sink without allocating a full-height destination bitmap. The existing
`tiledExport` API remains as a compatibility aggregate for callers that can
afford a complete image. Long-page exporters should use the streaming API,
process one tile at a time, and preserve effect halos and diffusion state.

The remaining publishing work is to connect this iterator to the canonical
page export planner, multipage PDF assembly, image/CBZ packaging, transcript
generation, and publisher-specific byte-limit preflight.

## Publisher provenance

`COMIC_PUBLISHER_PROFILES` records editable defaults and provenance for the
current WEBTOON CANVAS and Tapas checks. `validateComicPublisherArtifacts`
checks encoded dimensions and byte lengths after encoding and returns actionable
issues; it never lowers quality silently. WEBTOON values come from the 2024
checklist and Tapas values from its publishing specification. Both records have
`verifiedAt: 2026-09-19` and must be reverified before release.

The WEBTOON record is 800 × 1280 pixels, 2 MB per image, 20 MB per episode,
and 100 images ([official 2024 checklist](https://webtoons-static.pstatic.net/creator101/en/pdf/Before-You-Publish-Checklist-2024.pdf?dt=2024011001)).
Tapas records its 940-pixel width and 10 MB per-file limit
([publishing specification](https://help.tapas.io/hc/en-us/articles/1260802028970-Series-Basics-How-to-publish-a-comic-episode-on-Tapas));
the 2048-pixel slice height remains Varve's editable default rather than a
Tapas requirement.

## Compatibility and validation

All new fields are optional and unknown fields remain handled by the existing
document codec. Workspace switching does not mutate artwork; comic Draw routes
scene scope, creation, navigation, Layers, font usage, and hit testing to the
publishing page surface. Existing page, story, panel, preset, and export tests
cover the shared contracts; feature-specific tests must add pointer, clipping,
typography, encoding, persistence, and bounded-memory coverage before
publishing support is declared complete.
