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
| 4 | Typed mutation pipeline (core) | **Landed** | `054af3b1`; registry + transaction coordinator + 7 operation families, 13 tests |
| 5 | Immutable log and replay | **Landed** | `@varve/history`: segments, `HistoryStore`, revisions, replay, entity index — 17 tests |
| 6 | Snapshots and recovery | **Landed** | snapshots + scheduling, tail recovery, validation, legacy version import (ADR-0024) |
| 7 | Persistent undo/redo | Next | ADR-0019 hybrid model |
| 8 | History panel | Next | ADR-0043/0044 |
| 9 | Checkpoints and branches | Next | ADR-0023 |
| 10 | Semantic diff | Next | ADR-0031/0032 |
| 11 | Three-way merge | Next | ADR-0033/0034 |
| 12 | Conflict resolver | Next | ADR-0035 |
| 13 | Git working format + drivers | Next | ADR-0028/0036/0037 |
| 14 | Review bundles | Next | ADR-0038 |
| 15 | Collaboration integration | Next | ADR-0039 |
| 16 | Multimodal assistance | Next | ADR-0042 |
| 17 | Hardening | Next | cross-platform native tests, fuzzing, a11y audit, 4 GB RAM benchmarks |

## Known coordination notes (2026-08-05)

The main working tree is shared with concurrent feature work (mockup/tables/
tokens). Milestones 1-2 content was swept out of the committed tree once by a
concurrent index operation and re-landed as restore commits
(`666ddb5e`, `7c5ee704`) — content identical to the originals. If the
history-system modules (`identity.ts`, `migrateIds.ts`, `canonical.ts`,
`sha256.ts`, `operations/`) ever disappear from HEAD again without a
persistent-history commit explaining it, re-land them from the restore
commits; do not assume removal was intentional.

## Follow-up backlog (from the audit)

- Migrate remaining editor mutation paths to typed dispatch by functional
  area (inspector setters → `node.patch`; text editing grouping per
  ADR-0018; prototype-playback undo pollution fix).
- Extend operation families: `text.replace-range` (grapheme-aware),
  `component.*`, `variable.set-value`, `path.*`, `timeline.*`.
- Wire `VersionHistoryService` as a facade over the revision store
  (ADR-0024); migrate web versions + desktop localStorage versions.
- Persistent undo cursor + branch-on-divergence (ADR-0019).
- New `@varve/history` package for the revision DAG, replay, snapshots,
  compaction, merge orchestration (per the plan's package ownership).
- Git drivers as a headless CLI (`varve diff/merge-driver/validate/...`).
- History panel as a workspace-registered panel (ADR-0043).
