# ADR-0137: Text composition engine

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Line layout is browser `measureText` greedy word wrap at paint time
(`replay.ts:2354-2378`); the TS shaping bridge (`shaping.ts:141-232`) and the
Rust rustybuzz shaper (`varve-print/src/shaper.rs:82`) are both unused; there
is no paragraph composition, hyphenation, keep/widow/orphan, columns, or
insets; frame capacity is a dead char-count split (`textFlow.ts:109-154`).

## Decision

D1 — Replace approximate capacity logic with a deterministic composition
engine in `@varve/engine`: per-paragraph shaping via the existing shaping
bridge (grapheme clusters via Intl.Segmenter, UAX#14-style breaking,
browser BiDi with the scene's bidi analyzer for complex-script segments),
line boxes from real advances, frame range from composed line count.

D2 — The compositor produces: glyph runs, line boxes, paragraph fragments,
frame ranges, overset state, column assignment, caret maps, hit-test data,
a11y text order, export-ready positioning, diagnostics.

D3 — Determinism contract: same (document revision, story revision, frame
geometry, font manifest, settings, engine version) ⇒ same output. The
composition key includes the font-manifest hash.

D4 — Desktop can route shaping through the existing `shape_text` IPC
(rustybuzz) where font data is local; web uses the TS shaping bridge. Both
must produce the same ranges within documented tolerance; golden fixtures pin
the primary path.

D5 — Composition runs in a worker with cancellation and stale-response
rejection (story revision + frame revision + font-manifest revision + request
id + composition key).

## Alternatives

- Paint-time layout forever (status quo) — rejected: frame ranges, overset,
  and export require pre-paint composition.
- Rust-only composition — rejected: web needs parity; TS bridge already
  exists.

## Consequences

- Text paint switches from per-char wrap to composed line boxes (renderer
  becomes a replay of composition output).
- Existing estimate-based auto-size (`engine.ts:97-115`) is replaced by
  measured composition for text nodes.

## Migration impact

Existing documents recompose on load (v2.21) — documented layout changes where
the old estimator differed; a migration report lists per-story diffs.

## Compatibility impact

None at the schema level.

## Security considerations

Composition duration and memory bounds; pathological inputs (very long
unbreakable tokens, 10k-char runs) capped and time-boxed in the worker.

## Rejected shortcuts

- Char-count capacity (status quo `splitRichTextByCharLimit`).
- Approximate 0.6×fontSize estimation for frame ranges.
