# Font Readiness and Text Geometry

Two rules govern this area, and most of the defects in it were a violation of
one of them:

1. **Fonts becoming usable is derived presentation state.** It invalidates
   every piece of geometry and every cache that depends on it, and it changes
   nothing about the document, selection, or history.
2. **Rendered text, selection, hit testing, and the editing overlay consume one
   layout.** The same string must not have one geometry when drawn, another
   when selected, and a third while being edited.

## Font lifecycle

```text
document text
  -> font dependency set (family + weight + style, per node and per rich run)
  -> face request                     FontRegistry.ensureDocumentFonts
  -> runtime readiness                CSS FontFaceSet / FontRegistry.load / restored faces
  -> revision                         FontRegistry.revision (monotone, synchronous)
  -> measurement invalidation         invalidateCanvasTextMeasurements
  -> geometry cache invalidation      transform cache, subtree IR, engine-node memo, snap index
  -> authoritative redraw
```

Sources are deliberately plural. `@fontsource` CSS can start and finish a load
without ever calling `FontRegistry.load()`, so `loadingdone` and `loadingerror`
on the browser `FontFaceSet` advance the same revision stream that registry
loads do. Registration and `fvar` axis parsing advance it too: both change what
can be resolved and drawn.

`document.fonts.ready` is not a readiness signal on its own. It resolves once
the loads that have *already started* have finished, and an unreferenced
`@font-face` never starts one, so the document's own faces are requested
explicitly, each at the weight and style the document uses. Only referenced
faces are requested; loading every installed family to cure a first-paint flash
would trade one defect for a worse one.

The revision moves **synchronously** even though the listener fan-out is
coalesced into a microtask. It is a cache identity: anything measured after a
registration must not be filed under the pre-registration key, even within the
same tick. Coalescing exists because system enumeration registers hundreds of
families in a loop and each one is not its own redraw.

Missing is not the same as pending. `FontLoadState` distinguishes `unknown`,
`loading`, `loaded`, and `error`, and missing-font replacement is offered only
after genuine resolution failure. Manifest resolution answers a different
question again -- whether an identity is known -- not whether Canvas can draw
that face this frame.

## Measurement

`@varve/shared`'s `textMeasure` owns one width path with a pluggable backend.
With no backend installed it returns a deterministic character-count estimate;
`@varve/engine`'s `canvasTextMeasurer` installs a Canvas2D backend that returns
real per-face advances, caches them, and exposes a revision that changes when
the usable face set does.

The backend installs itself behind a **capability probe**, not an environment
sniff: a real shaper gives `WWWWWWWWWW` a visibly greater advance than
`iiiiiiiiii`, and a character-count stub gives them the same. Where the probe
fails the backend uninstalls itself, because advertising a font-dependent
measurement revision that never reflects a font would invalidate caches for
nothing.

`textMeasureRevision()` is what font-dependent caches compare. The editor's
transform cache holds world bounds for text nodes, and font readiness changes
those without touching the document, so nothing in document diffing can notice
it. The cache therefore checks the measurement revision on every lookup, and
thumbnail cache keys include it for text nodes.

## Realms

A dedicated worker has its own `FontFaceSet`. The document's `@font-face`
rules do not cross that boundary, and neither does anything added to
`document.fonts`. Left alone, a frame the render worker draws resolves every
bundled family to a platform substitute while the identical frame on the main
thread draws it correctly -- the same wrong typography, arriving by a different
route and depending only on which path the frame took.

`render/workerFonts.ts` harvests the declared faces (absolutising sources
against the stylesheet that declared them, since the worker would otherwise
resolve them against its own script URL), the host hands them over on start,
on restart, and on every font-registry change, and the worker echoes back
**which families it actually loaded**.

The gate is per family, not per batch. A family is reported adopted only if
every face declared for it loaded there -- a document setting bold text in a
family whose bold payload failed must not be cleared for a realm that can only
synthesise it. Text in any family the worker cannot draw renders on the main
thread; everything else keeps the fast path, including while other families are
still arriving. That decision is made **synchronously**, before the frame picks
its branch: an asynchronous refusal lands after the frame has already been
drawn.

Documents whose text uses only system families keep the worker fast path
unconditionally -- they render identically in either realm.

## Text geometry

Four rectangles, deliberately distinct:

| Rectangle | Meaning | Derived? |
| --- | --- | --- |
| Container | the box the user defined (`w`/`h`) | no, document data |
| Layout | union of the line boxes after breaks and wrapping | yes |
| Ink | visible glyph extents | yes |
| Selection / transform | what the editor shows and transforms | yes, per mode |

`resolveTextGeometry` in `@varve/shared/textGeometry` produces all of them from
one pass, and `@varve/scene`'s `textNodeLocalBounds` is the single adapter onto
it. Scene bounds, unwarped source bounds, the render IR, hit testing, marquee,
fit-to-selection, snapping, the editing textarea, the floating text bar, spec
readouts, and export cropping all resolve through that one function.

### Mode matrix

| Mode | Width source | Height source | Overflow |
| --- | --- | --- | --- |
| `autoWidth` (point) | widest line box | all line boxes | none, the box grows |
| `autoHeight` | container `w` | wrapped line boxes | none, the box grows |
| `fixed` | container `w` | container `h` | `textOverflow` |
| `path` | container, else layout | container, else layout | path length |

`textResizing` is authoritative when set. Documents that predate it -- imports
especially -- express the same intent through `textMode` plus the presence of a
width: an area box with a width is a container, a width without an area mode is
a wrap constraint, and neither is auto-width.

`w`/`h` are container geometry and never a cached content measurement. An
auto-width node carrying a stale one-line `h` from an earlier state is measured
from its content, not pinned to that `h`; that conflation is what made
multi-line selection boxes cover only the first line. Correspondingly, changing
the resizing mode materialises a container from the current layout or clears
one, so the stored dimensions always mean what the new mode says they mean.

Empty paragraphs, trailing breaks, tracking, letter spacing, paragraph spacing,
text case, and per-run rich-text sizes all reach the box. Rich paragraphs are
the layout source when present, because the flat `text` mirror can lag behind
them.

### Line breaking

Break opportunities are found across runs, not at run boundaries. Formatting
changes mid-word constantly -- one bold letter, a coloured syllable -- so a
token accumulates through as many runs as it spans and closes only on
whitespace. Breaking where the run changed put the break in the wrong place and
reported lines far wider than the container.

A token too wide for the line on its own is broken by character. That is the
only break opportunity CJK offers: Japanese, Chinese and Korean have no
inter-word spaces, so under a space-only model an entire paragraph was one
token that never wrapped, and its box came out several times wider than the
container the renderer was already breaking the text into. The same path
handles a long unbreakable Latin word.

Each line's height comes from the runs actually on *that* line. A 60px word on
the first line does not set the leading of a second line containing only 20px
type. Trailing whitespace advances the caret but paints no ink, so it is
trimmed from the line's width.

An empty node keeps a minimum clickable width so it can be given a caret. That
is an editing affordance, derived on demand: it is never serialized, and it is
not applied to text that has content, where it would hand a one-letter node a
box several times wider than its ink.

## Interaction

Resizing a text object means different things per mode, because what the object
owns differs. Auto-width text has no container -- its box *is* its content --
so a handle can only change the type size. Area text does have a container, and
dragging its handle resizes that container and re-wraps; scaling the type
instead left the box at its old size with the text spilling out of it.

Creating text follows the same split: a click makes point text, a drag makes an
area container. A drag along a single axis is still a request for a box and is
clamped to a usable minimum rather than discarded. A node created by a click
that is left empty is discarded when editing ends, so an invisible node does
not persist as a layers row, a hit target, and an exported element.

## Invariants

- Selecting text never changes its appearance.
- Font completion creates no undo entry, no dirty flag, and no serialized
  measurement.
- No cache holding font-dependent geometry outlives the revision it was built
  under.
- A box that describes fewer lines than the renderer paints is a defect,
  including when the extra lines came from soft wrapping or rich text rather
  than from a literal newline.
