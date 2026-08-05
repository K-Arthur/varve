# ADR-0100: Canonical internal design-token model

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The existing variable system (ADR-0002 is the app's UI tokens — unrelated)
stores `Variable { id, name, type, valuesByMode }` with counter-based ids
(`variables.ts:78-86,283-286`), name-or-id alias resolution, and a two-way
"source wins" merge (`variables.ts:341-349`). None of this can support
standards-based token synchronization: ids collide, names are the identity,
and there is no provenance or sync state.

## Decisions

### D1 — A canonical `DesignTokenStore` above `VariableStore`

A new module `packages/scene/src/tokens/` defines the canonical record:

```ts
type TokenId = string;                    // "tok_" + UUID
interface DesignTokenRecord {
  id: TokenId; path: readonly string[]; displayName: string;
  type: DtcgTokenType; value: TokenValueOrReference;
  description?: string; deprecated?: boolean | string;
  extensions: Record<string, unknown>;
  source?: TokenProvenance; localState: TokenLocalState;
}
```

`VariableStore` remains the persistence and binding layer; a compatibility
bridge (ADR-0101) maps tokens to variables. Tokens are versioned
(`schemaVersion`) and survive `serializeDocument`/`normalizeDocument` via an
optional additive `tokenSync` field on `VariableStore` (both functions spread
the document — verified in the audit).

### D2 — Collision-resistant identity, decoupled from path

`TokenId` is a UUID minted per import. `path` (human-readable, DTCG-visible)
and `id` (Varve-internal, durable) are separate fields. Renames/moves rewrite
`path` only; bindings reference variables backed by the token's id.

### D3 — Provenance and local state on every synchronized token

`TokenProvenance` (source id, file id, JSON pointer, optional source stable
id, adapter, spec version) and `TokenLocalState` (createdLocally,
detachedFromSource, locallyModified, unresolved, conflicted) live on the
record; sync metadata is never written into exported token values except the
namespaced stable-id extension (ADR-0102).

### D4 — Multi-source with ownership rules

Sources are first-class (`TokenSource` with kind, direction, adapter,
configuration, sync state). A token has at most one owning source; a second
source claiming the same token requires explicit user resolution.

## Alternatives

- Evolving `Variable` itself into the token record — rejected: breaks every
  existing consumer and mixes sync metadata into the binding layer.
- A global singleton store — rejected: must be per-document and collaborative.
- Process-local counters — rejected outright: they are the current defect
  (collisions after import/copy/merge/concurrent editing).

## Consequences

- Two layers (variables + tokens) with a bridge to maintain; the bridge is
  small and directional.
- Existing documents with plain variables keep working untouched; tokens only
  exist once a source is connected.

## Migration impact

New docs get an empty optional state. Existing docs gain nothing until sync is
enabled, then tokens are minted (not retrofitted) from imports.

## Compatibility impact

`VariableStore` shape is unchanged; the new field is optional and additive.
Older Varve versions reading a doc with `tokenSync` ignore it (spread
serialization) — documented as a forward-compat limitation.

## Security considerations

Token values may embed untrusted source data; the store validates on import
(no non-finite numbers, bounded strings/arrays, no prototype-polluting keys).

## Rejected shortcuts

- Storing sync metadata inside `$extensions` of exported files by default.
- Reusing `vN` counter ids for imported tokens.
- Making the token store a React context — it is a document-layer model.
