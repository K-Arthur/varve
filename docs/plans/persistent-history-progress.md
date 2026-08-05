# Persistent History Program — Progress Tracker

Tracks the persistent step-level history, branching, semantic diff, merge,
and Git program defined in ADRs 0017-0046. Current-state summary:
`docs/architecture/persistent-history.md`. Audits:
`docs/audits/history-*-2026-08-05.md`.

## Milestone status

| # | Milestone | Status | Evidence |
|---|---|---|---|
| 1 | Audit, ADRs 0017-0046, baselines | **Landed** | `4102c5ba`, restored `666ddb5e`; `pnpm audit:docs` clean; baseline tests in scene + platform |
| 2 | Persistent identity | **Landed** | `ef16b31f`, restored `7c5ee704`; 12 identity tests + 9 migration tests |
| 3 | Canonical serialization | **Landed** | `04722221`; NIST-verified SHA-256, goldens, fast-check properties, 26 tests |
| 4 | Typed mutation pipeline (core) | **Landed** | `054af3b1`, restored `7c4cde64`; registry + transaction coordinator + 7 operation families, 13 tests |
| 5 | Immutable log and replay | **Landed** | `1af1ef2e`; `@varve/history`: segments, `HistoryStore`, revisions, replay, entity index — 17 tests |
| 6 | Snapshots and recovery | **Landed** | `1af1ef2e`; snapshots + scheduling, tail recovery, validation, legacy version import (ADR-0024) |
| 7 | Persistent undo/redo | **Core landed, editor wiring pending** | `581eb7c7`; revision-DAG navigation (`undo.ts`): undo/redo/undoN/undoTo, first-parent chains, divergence branching (ADR-0019 Model A store core), 16 tests |
| 8 | History panel | Next | ADR-0043/0044 — editor UI, requires `context.tsx` wiring |
| 9 | Checkpoints and branches | **Core landed, UI pending** | `581eb7c7`; branch/checkpoint naming policy (`branchNames.ts`, ADR-0023), 8 tests; refs already in the store |
| 10 | Semantic diff | **Landed** | `581eb7c7`; `diff.ts` (ADR-0028): entity/property-level changes keyed by persistent ids, ordered-collection LCS, property-specific epsilon policies, grapheme text ranges — 17 tests |
| 11 | Three-way merge | **Landed** | `581eb7c7`; `merge.ts` (ADR-0034): conflict keys, edit-vs-delete/add-vs-add/rename/text-overlap/reorder conflicts, deterministic three-way order merge for id-keyed arrays, `commitMergeRevision` two-parent revisions — 27 tests |
| 12 | Conflict resolver | Next | ADR-0035 — resolver UI over the merge manifest (base/ours/theirs values already captured per conflict) |
| 13 | Git working format + drivers | **Landed** | `c25b9d65`; `@varve/cli` headless CLI: `validate`, `canonicalize`, `hash`, `diff`, `textconv`, `merge-driver`, `git-setup` (ADR-0039/0040); verified end-to-end against a real git merge (clean + conflicted paths) |
| 14 | Review bundles | **Landed** | `c25b9d65`; `review` command: manifest.json + diff.json + summary.md + standalone accessible index.html (ADR-0042); pixel previews deferred (headless render follow-up) |
| 15 | Collaboration integration | **Deferred by directive** | Out of scope for now (user directive 2026-08-05) |
| 16 | Multimodal assistance | **Deferred by directive** | Out of scope for now (user directive 2026-08-05) |
| 17 | Hardening | Partial | Validation passes (`invalid` flag on merge, `validateHistory`), fuzzing/a11y/RAM benchmarks pending |

## Deferred by directive (2026-08-05)

Milestones 15 (collaboration integration) and 16 (multimodal assistance) are
explicitly out of scope per the session directive. Do not start them without
a new instruction.

## Known coordination notes (2026-08-05)

The main working tree is shared with concurrent feature work (mockup/tables/
tokens/warp). Milestones 1-2 content was swept out of the committed tree once
by a concurrent index operation and re-landed as restore commits
(`666ddb5e`, `7c5ee704`); M4 was swept once and restored (`7c4cde64`) —
content identical to the originals. If the history-system modules
(`identity.ts`, `migrateIds.ts`, `canonical.ts`, `sha256.ts`,
`operations/`, `packages/history/`, `packages/cli/`) ever disappear from
HEAD again without a persistent-history commit explaining it, re-land them
from the commits listed above; do not assume removal was intentional.

## Follow-up backlog

- Migrate remaining editor mutation paths to typed dispatch by functional
  area (inspector setters → `node.patch`; text editing grouping per
  ADR-0018; prototype-playback undo pollution fix).
- Extend operation families: `text.replace-range` (grapheme-aware),
  `component.*`, `variable.set-value`, `path.*`, `timeline.*`.
- Wire `VersionHistoryService` as a facade over the revision store
  (ADR-0024); migrate web versions + desktop localStorage versions.
- Editor wiring for the undo core: bind undo/redo commands to
  `undoRevision`/`redoRevision`, keyboard shortcuts, and the in-memory
  editor undo stack interaction (ADR-0019).
- History panel as a workspace-registered panel (ADR-0043/0044) and
  checkpoints/branches UI (ADR-0023 refs are store-side; panels pending).
- Conflict resolver UI over the merge manifest (ADR-0035): pick
  ours/theirs/base per conflict, then `commitMergeRevision`.
- Review bundle pixel previews via the headless renderer (deferred).
- Hardening: fuzzing for diff/merge, cross-platform CLI smoke tests,
  a11y audit of the review viewer, 4 GB RAM benchmarks.
