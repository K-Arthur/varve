# ADR-0101: Relationship between Varve Variables and DTCG tokens

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Node bindings (`PropertyBinding { variableId, expression?, modifiers? }`,
`types.ts:652`) resolve through `VariableStore` at render time
(`bindings.ts:91-158`). Replacing variables with tokens would break every
existing document, binding control, and undo snapshot. The audit confirms the
existing system must be preserved and extended, not replaced.

## Decisions

### D1 — Variables stay the binding surface; tokens are the semantic layer

- `PropertyBinding.variableId` continues to reference a `Variable`.
- A synchronized token owns (or maps to) exactly one backing variable per
  mode context; the bridge materializes variable values from token values.
- Import/apply operations create or update backing variables through existing
  document ops (`addVariableToDocument` etc.), so undo, clipboard, collab, and
  render paths are unchanged.

### D2 — The bridge is bidirectional and identity-backed

- Varve → DTCG: variable name + mode values → token path + `$value` per mode.
- DTCG → Varve: token path + values → variable (name = last path segment,
  values per mode), binding records tokenId ↔ variableId in the token store.
- The bridge never converts Varve math expressions into DTCG aliases.
  Expressions are either preserved under a namespaced `org.varve.*`
  extension, or the evaluated value is exported with a portability warning
  (never mislabeled as a standards reference).

### D3 — Concept separation enforced in types and UI

`DTCG reference` (standards-defined), `Varve expression` (local computed
math), `Property binding` (node ↔ variable), and `Platform transform`
(generation) are distinct concepts with distinct types. The UI uses
different labels and never calls all of them "modes" (see ADR-0105/ADR-0106).

## Alternatives

- Unifying tokens and variables into one record — rejected (ADR-0100 D1).
- Bridging by name at render time — rejected: names are not identities.
- Making the bridge one-way (import only) — rejected: conflicts require
  pushing Varve edits back to the source.

## Consequences

- A small, well-tested bridge module; render hot path untouched.
- Imported tokens appear as variables too — the existing VariablePanel keeps
  working for them, while Sync Center shows the token view.

## Migration impact

None for existing documents. When sync is enabled, the bridge mints variables
for tokens; existing variables that pre-date sync are either left as-is or
optionally adopted as local tokens (explicit user action).

## Compatibility impact

`PropertyBinding`, `VariableStore`, undo, clipboard, and collab serialization
are byte-identical for non-sync documents.

## Security considerations

The bridge validates every value crossing the boundary (types, finiteness,
bounded size) — the token side is untrusted input.

## Rejected shortcuts

- Serializing Varve expressions as DTCG aliases (`"$value": "{a} * 2"` is not
  a valid reference).
- Creating parallel binding fields on nodes for tokens.
- Deprecating `VariableStore` before migration is complete.
