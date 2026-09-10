# ADR-0021: Snapshot frequency and content addressing

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0020, ADR-0022, ADR-0046

## Context

Replay from genesis becomes expensive as logs grow; snapshots trade storage
for load speed. The existing version store snapshots every save and dedups by
FNV-1a 32-bit content hash — a weak integrity mechanism.

## Alternatives

1. Snapshot every transaction — storage blowup, defeats the operation log.
2. Snapshot on a fixed edit count — ignores transaction size and replay cost.
3. Threshold-driven snapshots with content addressing (chosen).

## Decision

Snapshots are content-addressed by **SHA-256** of the canonical document bytes
(ADR-0027; pure-TS SHA-256 for cross-runtime determinism). Snapshot triggers
are thresholds measured, not guessed: operation count since last snapshot,
replayed byte budget, measured replay duration, large imports, merges,
explicit checkpoints, clean shutdown, and migrations. Defaults are configurable
and calibrated with benchmarks (target: open = load nearest snapshot, never
full-lifetime replay). FNV-1a is retained only as a fast non-integrity index;
the canonical digest is the identity and integrity key. A snapshot is
referenced by `RevisionRecord.snapshotId` and deduplicated by digest.

## Consequences

- **Migration impact:** existing `versionContent` entries re-key to SHA-256
  during migration (ADR-0024); FNV keys remain as a secondary index.
- **Backward compatibility:** snapshot store is internal; no public API change.
- **Cross-platform/Performance:** SHA-256 is CPU-cheap (~1 GB/s class); hashing
  is deferred to transaction commit, never per pointer-move; worker-based
  snapshotting where available.
- **Security:** SHA-256 preimage resistance is adequate for content addressing
  and integrity; no trust placed in FNV.
- **Accessibility:** none.
- **Rejected shortcuts:** snapshotting every step; trusting FNV-1a 32-bit as an
  integrity hash; hashing `JSON.stringify` of the raw object graph.
