# ADR-0109: Rename and move detection

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

External tools rename and move tokens (`color.brand.primary` →
`color.action.primary`). Varve bindings must survive when identity can be
determined, and must never guess when it cannot.

## Decisions

### D1 — Detection order

1. Stable id in `org.varve.*` extensions (ADR-0102) — exact.
2. Vendor stable ids via adapter metadata — exact, adapter-verified.
3. Source file + JSON-pointer lineage from the sync base — exact for
   pointer-stable files.
4. Heuristic rename/move detection — conservative, previewed, user-confirmed.
5. No match → delete + add with an explicit resolution workflow.

### D2 — Heuristics are bounded and multi-signal

Signals: same type; identical prior value; identical description; similar
path (edit distance bounded); same sibling context; deletion and addition
within the same change set; alias dependants; existing binding usage.
Candidates are ranked; only unambiguous top candidates are proposed; equal
values alone never merge tokens. `Rename`, `Move`, `Rename+Move`, and
`Delete+Recreate` are distinct diff classes with distinct UIs.

### D3 — Confirmation semantics

Every heuristic match requires explicit user confirmation (or a stored
per-source policy "auto-confirm unambiguous renames"). Ambiguity → conflict.

## Alternatives

- Path-based identity — rejected: the defect being fixed.
- Value-based merging — rejected: many legitimate tokens share values.
- Always requiring manual reconnect — rejected: defeats the workflow.

## Consequences

- Rename detection is bounded in scope (bounded candidate sets) so it cannot
  become a quadratic scan on large libraries (ADR-0121/resource limits).

## Migration impact

Name-based aliases in existing documents are excluded from heuristic
renames until converted to graph edges (ADR-0104).

## Compatibility impact

None to serialization; renames show up as path changes in the semantic diff.

## Security considerations

None beyond the existing validation of `org.varve.id` values.

## Rejected shortcuts

- Auto-accepting rename suggestions.
- Merging tokens on equal values.
- Global string substitution of old paths in values.
