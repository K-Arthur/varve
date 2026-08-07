# Persistent History and Version Control Architecture

Current-state document (2026-08-05). The persistent step-level history,
branching, diff, merge, and Git program is defined by ADRs 0017-0046 (see
`docs/adr/`) and audited in `docs/audits/history-*-2026-08-05.md`. This page
describes what exists today, the contracts that are already normative, and
the planned milestones.

## Status summary (Milestones 1-14 landed, 15/16 deferred, 17 partial)

| Milestone | Status | Commits |
|---|---|---|
| 1. Audit, ADRs 0017-0046, baselines | Landed | `4102c5ba` (restored `666ddb5e`) |
| 2. Collision-resistant persistent identity | Landed | `ef16b31f` (restored `7c5ee704`) |
| 3. Canonical serialization + SHA-256 | Landed | `04722221` |
| 4. Typed operation pipeline (core) | Landed | `054af3b1` (restored `7c4cde64`) |
| 5. Immutable log + replay + storage | Landed | `@varve/history` (`1af1ef2e`) |
| 6. Snapshots + recovery | Landed | `@varve/history` (`1af1ef2e`) |
| 7. Persistent undo/redo + editor wiring | Landed | `581eb7c7` + `5e382f17` (session + watcher hook) |
| 8. History panel | Landed | `cb8636ba` (registered panel + E2E specs) |
| 9. Checkpoints + branches UI | Landed | `cb8636ba` (branch/checkpoint management in panel) |
| 10. Semantic diff | Landed | `581eb7c7` |
| 11. Three-way merge | Landed | `581eb7c7` + `cb8636ba` (deterministic conflict ids) |
| 12. Conflict resolver | Landed | `cb8636ba` (resolveMerge + completeMerge + dialog) |
| 13. Git working format + drivers | Landed | `c25b9d65` |
| 14. Review bundles | Landed | `c25b9d65` |
| 15. Collaboration integration | Deferred by directive (2026-08-05) | — |
| 16. Multimodal assistance | Deferred by directive (2026-08-05) | — |
| 17. Hardening | Partial (validation); fuzzing/a11y/RAM pending | — |

Tracker: `docs/plans/persistent-history-progress.md`.

## `@varve/history` — diff, merge, undo (M7 core, M9 core, M10, M11)

- `diff.ts` — semantic document diff (ADR-0028). Entity/property-level
  changes keyed by persistent ids (`SemanticChange` with full
  document-relative paths so merge application is a pure deep-set);
  ordered collections diffed by LCS over stable ids with a single array
  rewrite change carrying full before/after arrays; id-less arrays
  (fills/strokes/effects) are rewrite-only (no stable element identity);
  property-specific epsilon policies (geometry/transform/typography
  families, exact elsewhere); grapheme-cluster text changes carrying
  base/target cluster ranges ([start, end) semantics) for merge-time
  overlap detection; asset `dataUrl` bytes and the `nextId` counter are
  excluded as non-semantic.
- `merge.ts` — three-way semantic merge (ADR-0034). Conflict keys are
  `entityId + propertyPath`; identical edits adopt once; concurrent edits
  to the same property conflict (`scalar`); edit-vs-delete, add-vs-add,
  rename-vs-rename, and overlapping text edits conflict; id-keyed array
  rewrites (rootChildren, pages, children) merge with a deterministic
  three-way order merge (additions land in base-relative gaps, ours first
  within a gap; moves conflict when both sides moved an item); id-less
  array rewrites conflict unless identical. The merged document is always
  produced with `ours` values kept under conflicts, plus
  base/ours/theirs values per conflict for the resolver (M12) to
  re-resolve. `commitMergeRevision` creates the two-parent merge revision
  and moves the branch head atomically.
- `undo.ts` — ADR-0019 Model A store core: the undo stack IS the revision
  DAG. `undoRevision`/`redoRevision`/`undoN`/`undoTo` move the branch head
  along first-parent chains (redo targets validated as direct children);
  `abandonedDescendants` + `materializeDivergenceBranch` preserve
  left-behind redo paths as named branches (never deleted).
- `branchNames.ts` — ADR-0023 naming policy: git-ref-safe branch names
  (charset, length, reserved names) and free-form checkpoint names;
  `suggestBranchName`/`suggestUniqueBranchName` for automatic
  divergence/import branches.

All three modules are pure (sync) over `Document` values; only
`commitMergeRevision` touches the store. Test coverage: 65 tests across
`diff.test.ts`, `merge.test.ts`, `undo.test.ts`, `branchNames.test.ts`.

## `@varve/cli` — headless tooling (M13, M14)

`packages/cli` is a dependency-free Node CLI (self-bundling esbuild
launcher, no build step):

- `varve validate <file>` — decode + validate; prints name/format/hash.
- `varve canonicalize <file> [--hash]` / `varve hash <file>` — canonical
  JSON / SHA-256 (Git textconv input, ADR-0028/0036).
- `varve diff <base> <target> [--format text|json|summary]` — semantic
  diff (M10).
- `varve textconv <file>` — git textconv conversion.
- `varve merge-driver <base> <current> <incoming> [--manifest <path>]` —
  git merge driver (ADR-0040 contract: writes the merged document into
  %A, writes a conflict manifest sidecar, exit 0 clean / 1 conflicted /
  2 error). Verified end-to-end against real git merges (clean and
  conflicted paths).
- `varve review <base> <target> -o <dir>` — review bundle (M14):
  manifest.json (schema `varve-review-bundle/1`), diff.json, summary.md,
  and a standalone accessible index.html viewer (no network, no assets,
  CSP meta, keyboard-navigable change lists grouped by entity, before/
  after tables). Pixel previews are a documented follow-up (headless
  render).
- `varve git-setup [--apply]` — prints or applies `.gitattributes`
  (`*.varve diff=varve merge=varve`) + `diff.varve.textconv` +
  `merge.varve.driver` config.

Exit codes: 0 clean, 1 conflicted merge, 2 error. Runtime deps:
`@varve/scene` + `@varve/history` bundled with esbuild on first run.

## Normative contracts already in effect

The revision-history core lives in a dedicated package (`packages/history`),
per the plan's package ownership:

- `log.ts` — append-only, checksummed (SHA-256) operation segments;
  contiguous logical sequences; JSON-serializable for every backend.
- `store.ts` — backend-agnostic `HistoryStore` contract (ADR-0020) with an
  atomic `commitRevision` (revision + branch head + checkpoint commit
  together — a branch is never observed pointing at an incomplete
  revision); memory implementation included; IndexedDB/SQLite backends are
  platform follow-ups.
- `revisions.ts` — immutable `RevisionRecord` DAG (genesis/one-parent/two
  parents, ADR-0022), genesis creation (always snapshotted), checkpoint and
  branch-head helpers, graph validation.
- `replay.ts` — deterministic replay from the nearest snapshotted ancestor
  over half-open log ranges, hash verification (`replayAndVerify`),
  `applyStoredOperations`, `loadDocumentAt`.
- `snapshots.ts` — content-addressed snapshots keyed by canonical SHA-256
  (dedupe), threshold-based `SnapshotPolicy`/`SnapshotScheduler`
  (operation count, replayed bytes, replay time, checkpoint, shutdown).
- `recovery.ts` — `recoverTail` (corrupt-tail detection → truncation →
  last-known-good revision → branch-head rewind) and `validateHistory`
  (segments, DAG invariants, ref resolution, replay-based hash checks).
- `legacyImport.ts` — ADR-0024 convergence: legacy `VersionEntry` records
  import as parentless snapshot revisions (no fabricated lineage) with
  named/pinned versions becoming checkpoints.
- `entityIndex.ts` — rebuildable entity → operation index.

Fault-injection coverage: corrupt tail segments, dangling branch heads,
hash mismatch, mid-history snapshots, deterministic replay.

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
