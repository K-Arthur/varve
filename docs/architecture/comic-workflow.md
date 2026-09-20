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
balloon**. `wrapTextInCallout` groups the existing text with an ordinary rounded
body and tail, so the source text is moved rather than copied. Selecting that
group exposes the Comic balloon inspector: Speech, Thought, Caption, Whisper,
and Shout recipes; padding; an explicit `reflow` / `fit-balloon` / `overflow`
policy; a derived fit status; a numeric tail endpoint; additional tails; and
an explicit Detach geometry action. Fit uses shared text geometry and grows the
ordinary body without silently shrinking authored type. Body and tail nodes remain
selectable through the normal layer tree, and direct path edits can be kept
without the recipe regenerating them.

The current creation entry point is the Typography inspector action; a
dedicated canvas drag tool for drawing a new balloon around an arbitrary region
is still a follow-up. Existing text, shape, path, selection, and transform
tools remain the editing surface for the generated nodes.

The Typography inspector also exposes a Sound effect preset. It uses the
existing text stroke, weight, case, alignment, and effect pipeline, so sound
effects remain editable text and export through the same composition snapshot
as ordinary lettering. Clear outline removes only the preset stroke. Ruby /
furigana can be authored for the currently selected rich-text range; ranges are
stored as UTF-16 source offsets and the existing ruby rebase logic marks ranges
stale when their base text changes. These controls are convenience actions over
shared text primitives, not a parallel comic text renderer.

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
