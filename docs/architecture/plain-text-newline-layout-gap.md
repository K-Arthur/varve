# Plain text ignores explicit newlines in the canonical layout path

**Status:** open bug, not fixed here. Found while auditing product screenshots.
**Owner:** text/engine workstream (`packages/engine` shaping + layout).

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

There are two text paint paths in `packages/engine/src/replay.ts`, and they
disagree about `\n`.

**Rich text** (`p.richText` set) goes through `layoutRichTextSnapshot`
(`richTextLayout.ts`), which builds **one itemized paragraph per
`richText.paragraphs` entry** and joins them with `\n` only to rebuild the
source string. Explicit breaks survive because they are already paragraph
boundaries before layout runs.

**Plain text** goes through `buildTextLayoutSnapshot`
(`textLayoutSnapshot.ts:675`), which itemizes the *entire* string as a single
paragraph:

```ts
itemizeParagraph({ index: 0, start: 0, end: text.length, text }, …)
```

Downstream, `wrapLines` (`textLayoutSnapshot.ts:419`) breaks lines **only** on
`maxWidth`. Nothing in `textLayoutSnapshot.ts` inspects `\n` — the file
contains no reference to it. `paintCanonicalText` then skips any glyph cluster
containing `\n` when painting, so the character is consumed without ever
having produced a line break.

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

## Fix sketch

`buildTextLayoutSnapshot` should split `text` on `\n` and emit one itemized
paragraph per segment, mirroring what `layoutRichTextSnapshot` already does.

This is not a one-line change: `shaping.runs` are shaped against the whole
string, so they have to be partitioned per paragraph with cluster offsets
rebased to paragraph-local indices, and the caret-stop and BiDi bookkeeping in
`layoutText` has to stay consistent across the new paragraph boundaries. That
is why it was left to the owning workstream rather than patched from the
screenshot workstream.

A cheaper interim option, if the demo assets need to read correctly before the
engine fix lands: author multi-line copy in
`scripts/screenshots/demo-document.ts` as one text node per line, which sits
entirely inside the screenshot pipeline's own ownership.
