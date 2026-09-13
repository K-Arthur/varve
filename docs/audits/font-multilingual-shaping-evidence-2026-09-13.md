# Multilingual font shaping evidence — 2026-09-13

This checkpoint records the focused shaping and geometry oracle run used by the
font-system audit. It exercises the same HarfBuzz adapter used by the editor
and the canonical paragraph layout path, rather than comparing screenshots
alone.

## Exact run

The command was run on `master` at `81490f87760e0699dba9cbbfe1d7ce035961d83d`:

```text
./node_modules/.bin/vitest run packages/engine/src/shapingOracle.test.ts packages/engine/src/text/visualOrder.test.ts packages/engine/src/text/paragraphLayout.test.ts packages/engine/src/text/unicodeLayout.fuzz.test.ts --config vitest.config.ts --reporter=verbose
```

Result: **4 files passed, 60 tests passed** in 19.66 seconds.

## Coverage observed

- Arabic joining forms, lam-alef clusters, harakat offsets, RTL visual order,
  glyph IDs, and metrics.
- Devanagari conjunct formation, pre-base matra placement, and cluster bounds.
- Thai stacked marks and finite offsets.
- Hebrew RTL output.
- Mixed-direction visual runs, paragraph-local direction, wrapped RTL lines,
  bracket mirroring, and caret/hit-test geometry.
- CJK line breaking, NBSP behavior, emoji ZWJ and combining grapheme safety,
  ligature clusters, selection rectangles, fuzzed Unicode input, and
  pathological long-mark/paragraph inputs.

The shaping oracle uses host Noto fonts when available and skips a script only
when its fixture is absent. This Linux run had Arabic, Devanagari, Thai, and
Hebrew fixtures available. The assertions intentionally validate structural
invariants instead of hard-coding glyph IDs, because host font revisions may
change IDs while preserving correct shaping.

## Remaining evidence

This is engine/layout evidence. It does not certify color-font rendering,
fallback provenance, native WebKitGTK parity, or the main-thread/worker canvas
oracle. Those remain separate acceptance-matrix items and need their platform
or fixture runs before release sign-off.
