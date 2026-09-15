# ADR-0032: Text diff strategy

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0031, ADR-0034

## Context

Rich text lives in `TextRun[]` with character/paragraph styles
(`types.ts:837-851`). Diffing and merging must be safe for grapheme clusters,
combining marks, emoji, BiDi text, IME output, and run-boundary changes —
without splitting IME compositions into invalid operations.

## Alternatives

1. Code-point (UTF-16 or code point) diffing — splits grapheme clusters and
   emoji; breaks IME composition; rejected.
2. Whole-run replacement — coarse; adjacent text edits conflict
   unnecessarily.
3. Grapheme-aware range diffing with run-boundary reconciliation (chosen).

## Decision

Text changes diff at the **grapheme-cluster level** (using a small,
dependency-free grapheme segmenter over Unicode 15 segmentation rules; the
platform's `Intl.Segmenter` is used when available, with a bundled
deterministic fallback so behavior is identical across runtimes). Operation
payloads are range-based (`text.replace-range`): `{ startGrapheme, endGrapheme,
replacementRuns }`, where boundaries align to run boundaries. The transaction
coordinator treats an active IME composition as an indivisible unit (ADR-0018):
operations never split a composition, and composition events commit as one
step on composition end. Formatting-only changes and content changes are
distinguished in the diff output. Rich-text merging (Milestone 11) uses the
same range algebra so overlapping-but-identical edits merge cleanly and
overlapping-different edits produce text conflicts (ADR-0034).

## Consequences

- **Migration impact:** none.
- **Backward compatibility:** text content preserved byte-for-byte.
- **Cross-platform/Performance:** segmenter cost is linear in text length;
  cached per run.
- **Security:** payload limits on replacement length.
- **Accessibility:** no impact.
- **Rejected shortcuts:** UTF-16 code-unit diffing; per-keystroke operations
  without IME awareness; diffing by whole paragraph with no range math.
