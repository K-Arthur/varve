# ADR-0105: Resolver document support

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The DTCG Resolver module report defines resolver documents that select token
sets for contexts (light/dark, brand, platform, density, contrast, locale,
product, user preference) via sources, modifiers, and defaults. Varve has
per-collection modes with no concept of sets, modifiers, or resolution order.
Inventing a parallel "mode" format would be wrong; the resolver must be
implemented deliberately from the report.

## Decisions

### D1 — Resolver documents are a first-class parsed structure

`@varve/tokens` parses and validates resolver documents: named `sets`
(sources of token documents), `modifiers` (name, type, value domain),
`transformers`, `defaults` (input fallbacks), and resolution order. Invalid
inputs, missing required modifiers, duplicate modifier names, and resolver
source cycles are rejected.

### D2 — Lazy, bounded permutation evaluation

Resolvers with 4 brands × 3 platforms × 3 densities × 2 themes × 2 contrast
contexts are NOT materialized eagerly:

- Lazy resolution on demand.
- A cache of active permutations with dependency invalidation.
- Bounded preview generation (user-requested contexts only).
- Search operates across resolved and source values.
- Permutation count limits are enforced (resource limits).

### D3 — Existing Varve collections/modes bridge through a compatibility layer

`VariableCollection.modes` maps to resolver modifiers where semantically
equivalent; the bridge is explicit and documented, never conflated in the UI.
The UI distinguishes: token collection, token set, resolver modifier, Varve
preview mode, platform output, and active synchronization source.

## Alternatives

- Re-implementing themes as more Varve modes — rejected: conflates concepts
  and invents a competing format.
- Eagerly resolving every permutation — rejected: combinatorial explosion.
- Ignoring the resolver report — rejected: the program explicitly requires
  standards-based sets/modifiers.

## Consequences

- Resolver evaluation joins the deterministic pipeline: sets are resolved in
  the report's defined order, then aliases resolve against the ordered token
  set (aliases never resolve before set ordering).
- Playwright workflow 6 (resolver contexts) verifies switching light/dark and
  brand without materializing unnecessary permutations.

## Migration impact

Existing Varve modes remain valid; only synchronized documents gain resolver
contexts, through explicit setup.

## Compatibility impact

Resolver documents are external artifacts; Varve never exports its mode
system as a resolver without a user-visible mapping step.

## Security considerations

Resolver input is validated like token input (bounded modifiers, bounded
permutation space, no executable content).

## Rejected shortcuts

- Reusing token `$type` vocabulary for resolver metadata.
- Auto-generating every permutation on import.
- Calling resolver modifiers "modes" in the UI.
