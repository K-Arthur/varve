# ADR-0103: DTCG source-preserving parsing and serialization

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

DTCG documents are plain JSON but live in repositories where formatting,
ordering, and unknown `$extensions` are meaningful to the team. A canonical
re-serialization on every write would create noisy diffs and destroy vendor
data. The 2025.10 format report requires tools to preserve unknown extension
data on save.

## Decisions

### D1 — Two representations are maintained

1. A normalized semantic token graph (what Varve uses).
2. A source representation sufficient to preserve supported details: file
   partitioning, token/group ordering, indentation, newline style, final
   newline, UTF-8 BOM policy, explicit `$type` placement, unknown
   `$extensions`, unchanged raw sections.

The parser builds a source-location map (byte offsets → JSON path →
line/column) during JSON tokenization, so diagnostics and surgical patches
are positional.

### D2 — Serialization modes

- **Source-preserving patch mode (default):** serialize only changed
  subtrees; unchanged regions are emitted byte-for-byte. Ordering of
  unchanged keys and formatting are inherited from the original text.
- **Canonical mode:** stable key order, 2-space indent, only when creating a
  new file, on explicit user formatting action, when source preservation is
  impossible, or when an adapter requires it.
- No comment preservation is promised (standard JSON). JSONC/JSON5 support,
  if added later, is a separate source-syntax adapter that must convert to
  valid DTCG JSON without semantic change.

### D3 — Pipeline

`bytes → encoding/size validation → JSON parse with location map → DTCG
structural parse → version validation → semantic validation → reference graph
construction → normalized token graph`. Diagnostics carry severity, error
code, message, file id, JSON pointer, line, column, related locations, and
optional safe repair suggestion.

## Alternatives

- Parse-then-re-serialize canonically — rejected: destroys ordering and
  formatting, creating merge noise in repositories.
- Text-diff-based surgical patching without a structural parse — rejected:
  cannot validate the result and cannot detect semantic changes.
- Storing only the raw text — rejected: no semantic access.

## Consequences

- The serializer is the most intricate component; round-trip tests must prove
  "parse → normalize → patch-serialize → parse" preserves semantics with
  minimal text change.

## Migration impact

None — new component.

## Compatibility impact

Unknown `$extensions` and future `$`-prefixed properties round-trip
losslessly in patch mode. Strict mode rejects unknown tokens the user cannot
preserve; compatibility mode imports with diagnostics and never silently
rewrites.

## Security considerations

JSON parsing is prototype-safe (no `__proto__`/`constructor`/`prototype`
merge), size-bounded (resource limits resource limits), and never evaluates input.

## Rejected shortcuts

- `JSON.stringify` round trips for synchronized writes.
- Regular-expression-based source patching.
- Silently dropping unknown `$extensions`.
