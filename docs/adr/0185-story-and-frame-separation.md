# ADR-0185: Story and frame separation

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Text lives per-frame (`TextNode.richText`, `types.ts:1096`); `TextChain` is an
ordered frame list whose own `richText` is never populated (`context.tsx:2661`).
Linked frames therefore duplicate story text or drop it. The audit requires one
authoritative story with derived per-frame ranges.

## Decision

D1 — Introduce `TextStory { id, name?, content: RichText, language?,
hyphenation?, compositionSettings? }` in `@varve/scene`. `TextChain` becomes
the story's frame thread: `chain.storyId` links it.

D2 — A text frame's effective content resolves: `story → chain → frame`:
when a frame belongs to a story, its displayed text is the story range
assigned by composition; standalone frames keep `TextNode.richText`.

D3 — Composed ranges are **derived** (ADR-0187), never stored on the frame;
the story is the only authoritative text source.

D4 — Frame bindings carry geometry-for-composition fields: `columns?`,
`insets?`, `verticalAlignment?`, `autoSize?` — new optional node-level fields
so standalone frames stay unchanged.

D5 — All chain mutations (link/unlink/insert/reorder) validate: no duplicate
frames, no cycles, one story per chain, one chain membership per frame.

## Alternatives

- Story as a hidden scene node — rejected: stories are not paintables;
  scene traversal and hit testing would need special cases.
- Frame-local text with chain-level synchronization — rejected: two sources
  of truth, undo/diff hazards.

## Consequences

- Editing any frame in a story edits the story; all linked frames reflow
  (ADR-0188).
- Overset is measured per story, displayed per frame.
- Export composes from the story via the same engine as canvas.

## Migration impact

v2.18: chains with frames become stories with `content` = first frame's
richText (or merged in thread order with explicit diagnostics); standalone
frames untouched.

## Compatibility impact

Old readers see a `stories` map they ignore and unchanged per-frame richText
snapshots (kept as the last composed range for compat, marked derived).

## Security considerations

Story length limits (≤ 10M graphemes), frames per story ≤ 5,000; cycle
detection on load and on link.

## Rejected shortcuts

- Keeping per-frame copies synchronized.
- Reusing `TextNode.richText` as the story store.
