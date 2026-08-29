# Deterministic Undo/Redo Engine — Progress Tracker

## Phase 1: Migrate Bypass Mutation Paths
- [x] 1A: createShapeAt — wrap in transaction
- [x] 1B: groupSelected — wrap in transaction
- [x] 1C: ungroupSelected — wrap in transaction
- [x] 1D: duplicateSelected — wrap in transaction
- [x] 1E: paste — wrap in transaction
- [x] 1F: Logo geometry — no changes needed (uses updateDoc)

## Phase 2: Exact Replay Diff
- [x] 2A: Add epsilonPolicy option to diffDocuments — already exists
- [x] 2B: Pass exact policy from editorHistorySession.capture()
- [x] 2C: Add replay hash assertion tests

## Phase 3: Raster Tile History
- [x] 3A: Content-addressed tile store (IndexedDB + memory fallback)
- [x] 3B: Capture-time dirty-tile detection from exact before/after state
- [x] 3C: `document.raster-delta` operation payload and replay
- [x] 3D: Integration with transaction capture
- [x] 3E: Exact codec snapshot plus external content-hash tile manifest

## Phase 4: Transaction Coverage Enforcement
- [x] 4A: Dev-mode mutation guard
- [x] 4B: Updated bypass inventory audit

## Phase 5: Text Editing Grouping
- [x] 5A: Typing burst batching in TextEditOverlay

## Phase 6: NumberField Wheel Grouping
- [x] 6A: Wheel event batching

## Phase 7: Redo Semantics Documentation
- [x] 7A: Document redo-after-undo behavior

## Phase 8: Compound Operation Grouping API
- [x] 8A: groupCompoundOperation API
- [x] 8B: Audit which operations need grouping

## Phase 9: Snapshot/Recovery Hardening
- [x] 9A: Exact codec snapshot preserves raster bytes and verifies its external manifest
- [x] 9B: Reachability-based GC for pre-commit orphan tile blobs
- [x] 9C: Tile writes precede revision visibility; recovery receives the tile store

## Phase 10: Validation and Testing
- [x] 10A: Cross-paradigm undo regression test
- [~] 10B: Interleaved vector/raster torture sequence covered; broader eight-action matrix deferred
- [x] 10C: Deterministic round-trip sequence test
- [x] 10D: Branch divergence test
- [x] 10E: Text grouping test
- [x] 10F: Reload persistence test
- [x] 10G: Raster hash comparison test
