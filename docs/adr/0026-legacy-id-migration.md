# ADR-0026: Legacy sequential-ID migration

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0025; audit `docs/audits/history-identity-inventory-2026-08-05.md`

## Context

Existing documents contain `n<N>`/`s<N>` ids and every reference to them
(children arrays, masks, components, bindings, interactions, pages). The new
format is collision-resistant going forward, but legacy ids in two branched
copies of the same document can still collide during a merge.

## Alternatives

1. Rewrite every stored document immediately (destructive, risky, huge diff).
2. Compatibility period: both formats readable, only new ids minted; explicit,
   idempotent migration available on demand; merge-time collision handling
   (chosen).

## Decision

- **Compatibility period is the default.** Decoders accept both formats
  forever. New entities always mint collision-resistant ids (ADR-0025).
- A versioned, idempotent migration `migrateLegacyIds(doc)` exists in
  `@varve/scene` and is offered (never forced) when a document is about to be
  branched or merged. It: (1) decodes and validates the graph, (2) builds a
  complete old→new mapping for every counter-based id, (3) updates every
  reference atomically in one pass over a declarative reference map
  (children/rootChildren/globalChildren, page content roots and backgrounds,
  component `masterRootId`/slots/instances/overrides, `mask.sourceNodeId`,
  `styleId`, `styleOverrides`, `paintRefs`, bindings, interactions,
  selection sets, icon asset references, raster-mask sources), (4) preserves
  original ids only in optional migration provenance (never as live
  identity), (5) validates referential integrity, (6) canonicalizes,
  (7) creates a migration checkpoint revision, (8) backs up the original
  document, and (9) is byte-deterministic given a fixed RNG seed.
- Table-model ids (`r<N>/c<N>/cell<N>`) are scoped per table and regenerated
  on remap; they migrate with the table model but need no document-wide
  mapping (documented exception).

## Consequences

- **Migration impact:** no forced migration at load; migration runs once per
  document, atomically, backup-first.
- **Backward compatibility:** both formats readable; older app versions can
  still open migrated documents (ids are plain strings).
- **Cross-platform/Performance:** one pass over the node map + references;
  O(nodes + references).
- **Security:** reference remapping validates keys against collections;
  dangling references reported, never guessed.
- **Accessibility:** none.
- **Rejected shortcuts:** partial migration; migrating only node maps and
  leaving references stale; rewriting all documents on first open; losing
  original ids without provenance.
