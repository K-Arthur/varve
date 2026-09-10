# Plain text ignores explicit newlines in the canonical layout path

**Status:** fixed. Found while auditing product screenshots; corrected in
`packages/engine/src/shaping.ts` and `packages/engine/src/textLayoutSnapshot.ts`.
**Owner:** text/engine workstream (`packages/engine` shaping + layout).

The first pass of this note named only the layout half of the problem. Fixing
that alone changed nothing on screen, because the text after the first newline
was never shaped in the first place — see *Cause* below, which now records both
defects.

## Symptom

A `TextNode` whose `text` contains `\n` renders only its first line in the
application. The node still *measures* as multi-line — the inspector reports
the full height, and the selection box is drawn tall enough for every line —
so the layer looks correct in the panel while the canvas paints one line.

Reproduced with the committed screenshot fixture
`scripts/screenshots/fixtures/poster.varve`:

| Node | Authored text | Painted |
|---|---|---|
| `poster-title` | `"Layers\nof time"` | `Layers` |
| `poster-body` | `"A varve is a single year of sediment — one\nlight layer, one dark. …"` | first line only |

The body copy is the visible tell: it paints as a sentence that stops
mid-clause.

## Cause

Two independent defects, one per stage. Either alone is enough to lose the
text, which is why correcting the layout stage first produced no visible
change.

### 1. Shaping stopped at the first newline

`shapeRun` (`shaping.ts`) analysed the whole string with `analyzeParagraph`.
U+000A **terminates** a UAX #9 paragraph, so that analysis only ever described
the text up to the first newline, and every character after it was never
shaped. Measured directly in the browser, `'Layers\nof time'` — 14 characters —
produced 7 glyphs, clusters 0-6, i.e. `Layers` plus the newline.

So even a layout stage that split paragraphs perfectly had no glyphs to place
on the second line.

`shapeRun` now shapes each paragraph separately — which UAX #9 requires anyway,
since base direction resolves per paragraph rather than once per string — and
rebases each paragraph's clusters back to document offsets. `shapeText`'s
`width` correspondingly becomes the widest paragraph rather than the sum of
all of them, which would otherwise report a runaway width for a text block.

### 2. Layout never broke on the newline

Below the shaping stage, there are two text paint paths in
`packages/engine/src/replay.ts`, and they disagree about `\n`.

**Rich text** (`p.richText` set) goes through `layoutRichTextSnapshot`
(`richTextLayout.ts`), which builds **one itemized paragraph per
`richText.paragraphs` entry** and joins them with `\n` only to rebuild the
source string. Explicit breaks survive because they are already paragraph
boundaries before layout runs.

**Plain text** goes through `buildTextLayoutSnapshot`, which itemized the
*entire* string as a single paragraph:

```ts
itemizeParagraph({ index: 0, start: 0, end: text.length, text }, …)
```

Downstream, `wrapLines` breaks lines **only** on `maxWidth`, and nothing in
`textLayoutSnapshot.ts` inspected `\n`. `paintCanonicalText` then skips any
glyph cluster containing `\n` when painting, so the character was consumed
without ever having produced a line break.

## Why the existing test does not catch it

`replay.test.ts` ("applies firstLineIndent to the first line only") lays out
`'First\nSecond'` and asserts two `fillText` calls — and it passes.

It passes because it exercises the *other* path. `canonicalTextSnapshot`
starts with:

```ts
if (!target.measureText) return undefined;
```

The test's `Recorder` implements no `measureText`, so the canonical path
returns `null` and replay falls back to the simple painter at
`replay.ts:3038`, which does `displayText.split('\n')` and handles newlines
correctly. A real browser canvas *does* implement `measureText`, so the
application always takes the canonical path the test never reaches.

Any regression test for this needs a target that implements `measureText`.

## The fix

`shapeRun` shapes per paragraph and rebases clusters (defect 1).
`buildTextLayoutSnapshot` splits on paragraphs and feeds the multi-paragraph
path `layoutRichTextSnapshot` already used (defect 2), partitioning the shaped
runs per paragraph with clusters rebased to paragraph-local indices —
`layoutText` adds `paragraph.sourceStart` back when it emits positioned
glyphs, so painters still receive document-local offsets.

The caret and BiDi bookkeeping needed no special handling: `layoutText` was
already written for multiple paragraphs, and `wrapLines` already returns a
single empty line for an empty paragraph, so blank lines keep their height.

The newline itself now produces no glyph at all. The break is carried by the
paragraph split rather than by a zero-width glyph that every painter has to
remember to skip.

## Regression cover

- `shaping.test.ts` — every paragraph is shaped, the newline yields no glyph,
  and width is the widest paragraph rather than the sum.
- `textLayoutSnapshot.test.ts` — an explicit newline breaks the line even when
  the text fits `maxWidth`, and consecutive newlines keep a blank line.

Both fail without their corresponding fix. The pre-existing replay test for
`'First\nSecond'` still passes; as noted above it never exercised this path.
