# ADR-0104: Reference graph and expression separation

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

DTCG aliases (`{path}`, `$ref` JSON Pointers) are graph edges; Varve math
expressions (`{a} * 2`, evaluated by the Pratt parser in `expr.ts`) are local
computed values. The current system stores both as opaque strings in
`valuesByMode` and resolves them by linear name scan. This cannot detect
cycles, impact, or renaming safely.

## Decisions

### D1 — A dedicated reference graph with indexes

`@varve/tokens` builds a graph where nodes are tokens and edges are
references, with these indexes (per ADR-0121): internal id, canonical path,
source pointer, stable extension id, incoming references, outgoing
references, bound nodes, and composite-property references (for `$ref`
property-level edges).

Resolution is lazy/incremental: values resolve on demand with memoized
dependency invalidation; the graph is never rebuilt from a name scan.

### D2 — DTCG references and Varve expressions are separate types

- `TokenReference` — a parsed DTCG reference (`{a.b.c}` or `$ref` pointer),
  the only thing allowed in exported token values.
- `VarveExpression` — a Pratt-parsed local expression, kept in variable
  values and `binding.expression`; exported only via `org.varve.*` extension
  or evaluated-value policy with a portability warning (ADR-0101 D2).

### D3 — Cycle and validity guarantees

The graph detects and reports: direct/indirect cycles, self-reference,
missing targets, references to groups, invalid pointers, type mismatch,
deleted targets, ambiguous paths, cross-source references (flagged), group
`$extends` cycles, and alias chains beyond a safe depth. A proposed merged
graph that creates a cycle is rejected before application (ADR-0108).

Impact previews ("changing `color.brand.primary` affects: 3 aliases, 42
layers, 5 components, 2 generated outputs") come from the graph + bound-node
index.

## Alternatives

- Resolving by scanning `store.variables` by name — rejected: the current
  defect (rename breaks aliases).
- Eager full resolution on every change — rejected: O(tokens) churn per edit.
- Treating expressions and references as the same string form — rejected:
  they have different semantics, validity rules, and export behavior.

## Consequences

- A new module with its own validation surface; the old `resolve` path stays
  for legacy variable-only documents.
- Renames propagate through edges instead of string replacement.

## Migration impact

Name-based alias strings in existing docs keep working through the legacy
path; synchronized tokens always use graph-backed references.

## Compatibility impact

None to serialization: the graph is in-memory plus the token store.

## Security considerations

Reference targets are resolved against a closed document set; JSON Pointer
segments are validated (escapes, indices) so crafted pointers cannot escape
the document (no file or URL dereference).

## Rejected shortcuts

- Regex replacement of names inside alias strings.
- Treating every `{...}` string as a DTCG reference.
- Unbounded alias chains without a depth limit.
