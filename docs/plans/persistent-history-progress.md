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
| 7 | Persistent undo/redo + editor wiring | **Landed** | Store core `581eb7c7` (16 tests); editor session `5e382f17` (12 session tests): `EditorHistorySession` with attach/capture/undo/redo/divergence/mergeBase, `usePersistentHistory` watcher hook, context wiring, diff.ts undefined-array fix |
| 8 | History panel | **Landed** | `cb8636ba`: registered panel (PanelId + workspace configs + lazy definition), HistoryPanel with step list + HEAD/checkpoint/branch markers + search + navigation, Shell grid area, View menu entry, Ctrl+Alt+H; 4 E2E specs (`tests/e2e/canvas/history-panel.spec.ts`) |
| 9 | Checkpoints and branches | **Landed** | Store refs `581eb7c7` (8 tests); session API landed `5e382f17`; panel UI landed `cb8636ba` (create/switch/merge/rename, protection rules); E2E-verified branch + checkpoint creation flows |
| 10 | Semantic diff | **Landed** | `581eb7c7`; `diff.ts` (ADR-0028): entity/property-level changes keyed by persistent ids, ordered-collection LCS, property-specific epsilon policies, grapheme text ranges — 17 tests |
| 11 | Three-way merge | **Landed** | `581eb7c7` + `cb8636ba`; `merge.ts` (ADR-0034): conflict keys, edit-vs-delete/add-vs-add/rename/text-overlap/reorder conflicts, deterministic three-way order merge for id-keyed arrays, `commitMergeRevision` two-parent revisions; deterministic conflict ids (kind\|entity\|path) so re-runs produce identical conflicts — 27 tests |
| 12 | Conflict resolver | **Landed** | `cb8636ba`: `resolveMerge.ts` (applyMergeResolutions ours/theirs/base, edit-vs-delete entity restores, validation, bulk resolve), `EditorHistorySession.completeMerge` (transactional two-parent merge revision, never moves heads on failure), ConflictResolver dialog (base/current/incoming triples, engine-bounded choices); 9 resolver tests + 3 session merge tests; E2E-verified conflict → resolve → two-parent revision |
| 13 | Git working format + drivers | **Landed** | `c25b9d65`; `@varve/cli` headless CLI: `validate`, `canonicalize`, `hash`, `diff`, `textconv`, `merge-driver`, `git-setup` (ADR-0039/0040); verified end-to-end against a real git merge (clean + conflicted paths) |
| 14 | Review bundles | **Landed** | `c25b9d65`; `review` command: manifest.json + diff.json + summary.md + standalone accessible index.html (ADR-0042); pixel previews deferred (headless render follow-up) |
| 15 | Collaboration integration | **Deferred by directive** | Out of scope for now (user directive 2026-08-05) |
| 16 | Multimodal assistance | **Deferred by directive** | Out of scope for now (user directive 2026-08-05) |
| 17 | Hardening | Partial | Validation passes (`invalid` flag on merge, `validateHistory`), fuzzing/a11y/RAM benchmarks pending |

## Deferred by directive (2026-08-05)

Milestones 15 (collaboration integration) and 16 (multimodal assistance) are
explicitly out of scope per the session directive. Do not start them without
a new instruction.

## Known coordination notes (2026-08-05, updated 2026-08-07)

The main working tree is shared with concurrent feature work (mockup/tables/
tokens/warp/multi-window). C1 and C2 (capture op + editor session) were
committed in `a3c766fb` and `5e382f17` respectively — both were swept into
the concurrent agent's commits due to shared-tree staging (content intact,
commit messages describe the concurrent agent's changes). If the history
system modules (`packages/history/`, `packages/editor/src/history/`,
`packages/scene/src/operations/ops/captureOps.ts`) ever disappear from HEAD,
re-land from `5e382f17`.

## Follow-up backlog

- Comparison workspace UI (ADR-0028/0035): the panel's Compare tab shows
  the diff summary; a full workspace with changed-entity tree, canvas
  highlights, and review-artifact export is pending.
- Migrate remaining editor mutation paths to typed dispatch by functional
  area (inspector setters → `node.patch`; text editing grouping per
  ADR-0018; prototype-playback undo pollution fix).
- Extend operation families: `text.replace-range` (grapheme-aware),
  `component.*`, `variable.set-value`, `path.*`, `timeline.*`.
- Wire `VersionHistoryService` as a facade over the revision store
  (ADR-0024); migrate web versions + desktop localStorage versions.
- Review bundle pixel previews via the headless renderer (deferred).
- Hardening: fuzzing for diff/merge, cross-platform CLI smoke tests,
  a11y audit of the review viewer, 4 GB RAM benchmarks.
- Persistence backends: IndexedDB store exists; SQLite (desktop), OPFS
  (browser), and memory-for-test backends per platform package.
- Visual review pass on the history panel screenshots (user-driven).
