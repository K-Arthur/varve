# ADR-0030: Binary asset strategy

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0021, ADR-0027

## Context

Assets are embedded `dataUrl`s in `Document.assets`, deduplicated by FNV-1a
64-bit content hash (`assets.ts:37-85`), referenced by per-fill `src`
(stripped on save, rehydrated on load). Repeated base64 payloads must not
appear in canonical text, hashes, or Git diffs; identical payloads must share
storage.

## Alternatives

1. Keep raw dataUrl in canonical text — payload bloat, hash blowup.
2. External content-addressed files — requires the directory representation
   (ADR-0028 option 2, deferred).
3. Content-addressed references inside the document (chosen): canonical text
   carries the id `asset-<hash>`; payloads live in the asset store keyed by
   SHA-256 (migrated from FNV), and the portable file keeps the single
   embedded payload copy it has today.

## Decision

The canonical form (ADR-0027) replaces `dataUrl` with its content-addressed
id; the asset store is keyed by SHA-256 of the payload with the FNV hash kept
as a fast dedup index. During migration, payloads are re-hashed once.
`rehydrateEmbeddedAssetSrc` behavior is unchanged. Asset replacement is a
typed operation (`asset.replace-reference`) — never an in-place mutation of
shared payload bytes. Future externalization (Git LFS / directory package)
must preserve these references so conversion is byte-deterministic.

## Consequences

- **Migration impact:** one-time re-hash; ids `asset-<hash>` remain the same
  string space (FNV digest), new payloads mint SHA-256-prefixed ids per
  ADR-0045 schema bump.
- **Backward compatibility:** old FNV-based asset ids still resolvable.
- **Cross-platform/Performance:** identical payloads dedupe once; canonical
  text bounded by reference count.
- **Security:** payload size limits (10 MB inline cap exists,
  `documentCodec.ts:256`); hash collisions not trusted as identity alone.
- **Accessibility:** none.
- **Rejected shortcuts:** embedding payloads in every operation; hashing
  payload-bearing text; treating FNV as the sole integrity mechanism.
