# Persistent History and Version Control Architecture

Current-state document (2026-08-05). The persistent step-level history,
branching, diff, merge, and Git program is defined by ADRs 0017-0046 (see
`docs/adr/`) and audited in `docs/audits/history-*-2026-08-05.md`. This page
describes what exists today, the contracts that are already normative, and
the planned milestones.

## Status summary (Milestones 1-4 landed)

| Milestone | Status | Commits |
|---|---|---|
| 1. Audit, ADRs 0017-0046, baselines | Landed | `4102c5ba` (restored `666ddb5e`) |
| 2. Collision-resistant persistent identity | Landed | `ef16b31f` (restored `7c5ee704`) |
| 3. Canonical serialization + SHA-256 | Landed | `04722221` |
| 4. Typed operation pipeline (core) | Landed | `054af3b1` |
| 5. Immutable log + replay + storage | Next | — |
| 6. Snapshots + recovery | Next | — |
| 7. Persistent undo/redo | Next | — |
| 8. History panel | Next | — |
| 9. Checkpoints + branches | Next | — |
| 10. Semantic diff | Next | — |
| 11. Three-way merge | Next | — |
| 12. Conflict resolver | Next | — |
| 13. Git working format + drivers | Next | — |
| 14. Review bundles | Next | — |
| 15. Collaboration integration | Next | — |
| 16. Multimodal assistance | Next | — |
| 17. Hardening | Next | — |

Tracker: `docs/plans/persistent-history-progress.md`.

## Normative contracts already in effect

### Persistent identity (ADR-0025/0026)

New entity ids are minted in the format `<prefix><counter>_<16-hex-random>`
(`n12_3fa9c2e4d5b6a718`, `s1_...`, ...) — 64 bits of randomness per
allocation, so two independently edited copies of the same document can
never mint colliding ids. Legacy sequential ids (`n<number>`, `s<number>`,
`col-<number>`, `grp-<number>`, `v<number>`) remain readable forever;
only new allocations are minted. The per-document counter contract is
unchanged.

- `packages/scene/src/identity.ts` — format, `mintId`, `parseMintedId`,
  `idCounter`, injectable RNG (`setDefaultIdRng` for deterministic tests).
- `packages/scene/src/node-id.ts` — the canonical node allocator
  (`nextNodeId(doc, rng?)`); styles, components, variables, library remaps,
  and the Sketch importer mint through the same module.
- `packages/scene/src/migrateIds.ts` — `migrateLegacyIds(doc, opts)`:
  atomic, idempotent, deterministic legacy-to-minted migration with a
  complete old→new map, full reference remap (children, pages, masters,
  components, slots, masks, styles, bindings incl. expression tokens,
  interactions, selection sets, variable store), optional provenance, and
  `validateIdReferences` integrity checking. Table-model ids (`r/c/cell`)
  are scoped per table and are the documented exception.
- `documentCodec.maxNumericNodeId` recovers counters from both id formats.

**Constraints for new code:** never parse ids as `n<digits>`; never
regenerate ids from timestamps; never reuse deleted ids; use `mintId`/
`nextNodeId` for new entities.

### Canonical serialization (ADR-0027/0021/0030)

`packages/scene/src/canonical.ts` produces deterministic, cross-platform
canonical bytes for a Document:

- schema-driven property ordering (document, per-node-kind, fills, strokes,
  effects, text runs/paragraphs, path points, shape geometry, colors);
  unknown extension keys sorted lexicographically within their namespace
- map keys sorted lexicographically; **authored-order arrays never sorted**
  (children, rootChildren, pages, fills, strokes, effects, points, runs...)
- number policy: `-0 → 0`, `NaN`/`Infinity` rejected (throws
  `CanonicalizationError`); strings preserved exactly (no Unicode
  normalization); `undefined` omitted, `null` preserved
- binary payloads excluded: `DocumentAsset.dataUrl` and
  `RasterMaskAsset.dataUrl` serialize as `asset:<id>` content references;
  per-fill `image.src` duplicating an asset payload likewise
- idempotence contract: `canonicalize(canonicalize(doc)) ===
  canonicalize(doc)`; parse→reserialize stable; enforced by golden fixtures
  (`packages/scene/src/__goldens__/canonical-document.json` +
  `.sha256`, regenerate with `UPDATE_GOLDENS=1`) and fast-check key-shuffle
  properties

`packages/scene/src/sha256.ts` is a dependency-free synchronous pure-TS
SHA-256 (FIPS 180-4, NIST-vector verified) so the canonical digest
(`canonicalHash(doc)`) is identical in Node, browsers, jsdom tests, and
Tauri webviews. This digest is the revision/snapshot content hash
(ADR-0021/0022) and the Git text-diff input (ADR-0028/0036).

**Constraints for new code:** never add a document field that embeds binary
payloads or volatile runtime state into canonical output; keep canonical
ordering schema-driven rather than insertion-order; validate finite numbers
at mutation boundaries.

### Typed operation pipeline (ADR-0017/0018/0045)

`packages/scene/src/operations/` is the authoritative mutation pipeline:

- `types.ts` — `DesignOperation` envelope (schemaVersion, operationId,
  operationType, documentId, transactionId, actor, source, baseRevisionId,
  logicalSequence, affectedEntityIds, payload, provenance; `createdAt` is
  metadata only), `OperationDefinition` contract (validate/apply/
  summarize/affectedEntities/precondition/invert/migrate), dispatcher
  limits.
- `registry.ts` — versioned registry: `registerOperation`, `hasOperation`,
  `validatePayload`, `applyOperation`, `summarizeOperation`,
  `affectedEntitiesOf`, `preconditionFailure`, `migratePayload`.
- `transaction.ts` — transaction coordinator: pointer-gesture grouping into
  one history step, empty-transaction suppression by reference equality,
  flattened nesting with a mismatched-nesting guard, abort/rollback to the
  begin state, payload-byte and operation-count limits.
- `ops/` — starter families: `node.create` / `node.delete` / `node.move` /
  `node.reorder` / `node.rename` / `node.patch` (whitelisted property paths
  with typed validators; generic patches with prototype access are
  impossible), `document.set` (whitelisted doc properties), `asset.register`
  (content-addressed, preconditioned against content replacement).
- `bootstrap.ts` — `registerBuiltinOperations()` (idempotent).
- Import `@varve/scene` (exports `./operations`).

`document-nodes.moveNode` returns the identical document reference for
no-op moves so empty transactions are detectable and structural sharing is
preserved.

**Constraints for new code:** production mutations must eventually dispatch
typed operations; `updateDoc`/`updateNode` in the editor remain temporary
adapters (ADR-0017) and are being migrated by functional area per the
mutation inventory (`docs/audits/history-mutation-inventory-2026-08-05.md`).

## Audit and decision records

- Audits: `docs/audits/history-mutation-inventory-2026-08-05.md`,
  `history-identity-inventory-2026-08-05.md`,
  `history-serialization-inventory-2026-08-05.md`,
  `history-version-system-map-2026-08-05.md`,
  `history-capability-matrix-2026-08-05.md`
  (includes collaboration readiness, Git-format alternatives, frontend
  inventory, storage/perf baseline, security threat model).
- ADRs: `docs/adr/0017-*` through `0046-*` — the mandated decision set
  (mutation pipeline, operation/transaction model, undo semantics, revision
  DAG, persistent identity, canonical serialization, Git representation,
  conflict rules, review artifacts, multimodal consent, recovery).

## Baseline tests

- `packages/scene/src/__tests__/historyBaseline.test.ts` — ID allocation
  and clone-id behavior under the ADR-0025 contract.
- `packages/platform/src/__tests__/historyBaseline.test.ts` — version-store
  dedup/prune/lineage behavior of the existing flat version system (to be
  migrated per ADR-0024).
- `packages/scene/src/__tests__/identity.test.ts`,
  `migrateIds.test.ts`, `canonical.test.ts`, `canonicalGolden.test.ts`,
  `canonicalProperties.fuzz.test.ts`, `sha256.test.ts`,
  `operations/__tests__/operations.test.ts`.
