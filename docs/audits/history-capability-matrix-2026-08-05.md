# Persistent History — Capability Matrix, Readiness, and Baseline (2026-08-05)

Milestone 1 audit output. Consolidates the mutation inventory, identity
inventory, serialization inventory, version-system map, collaboration
readiness, Git-format alternatives, frontend inventory, storage/performance
baseline, and security threat model.

## Capability matrix

| Capability | Existing | Partial | Missing | Unsafe | Evidence | Migration owner |
|---|---|---|---|---|---|---|
| Transaction grouping | | X | | | `begin/commit/abortTransaction` `context.tsx:2581-2634`; drags/sliders grouped; text keystrokes + NumberField wheel not | editor (M4 policy) |
| Persistent operations | | | X | | no operation log anywhere | history pkg (M4/M5) |
| Deterministic replay | | | X | | no logged ops to replay | history pkg (M5) |
| Persistent undo | | | X | | 50-entry in-memory stacks `context.tsx:2226-2231`; `resetUndo` on load | history pkg (M7) |
| Content-addressed snapshots | | X | | | platform `versions`+`versionContent` (FNV-1a 32-bit), unwired `VersionHistoryService` | platform (M6) |
| Parent-linked revisions | | | X | | flat `VersionEntry` list; `Branch` has `baseVersionId` only | history pkg (M5) |
| Named checkpoints | | X | | | `VersionEntry kind:'checkpoint'/'named'`; no revision link | history pkg (M9) |
| Mutable branch heads | | | X | | `Branch.status` only; no head field; desktop branch commands missing | history pkg (M9) |
| Merge revisions | | | X | | none | history pkg (M11) |
| Collision-resistant IDs | | X | | X | nodes/styles/components/variables counter-based (`node-id.ts:4`, `styles.ts:338`, `component.ts:41`, `variables.ts:78`); pages/masters/etc random | scene (M2) |
| Canonical serialization | | | X | | plain `JSON.stringify` `version.ts:906-911` | scene (M3) |
| Semantic diff | | | X | | only `VersionHistoryService.compareVersions` stub (unwired) | scene/history (M10) |
| Three-way merge | | | X | | none | scene/history (M11) |
| Conflict representation | | | X | | none | history (M11/M12) |
| Git text diff | | | X | | zero git integration in Rust or TS | CLI (M13) |
| Git merge driver | | | X | | none | CLI (M13) |
| Visual comparison | | | X | | `ImageCompareOverlay` (`components/ImageCompareOverlay.tsx:22-72`) exists for before/after compare of single node | editor (M10) |
| PR review artifacts | | | X | | none | CLI (M14) |
| Collaboration compatibility | | | X | | `@varve/collab` is scaffold: `noopTransactionHooks`, `getCollabUsers()=[]` (`collab/src/index.ts:38-86`); Rust stubs | collab (M15) |
| Crash-tail recovery | | X | | | recovery points + autosave + backups (three disconnected stores); no op-log tail recovery | platform (M6) |
| History compaction | | | X | | prune of versions exists (`memory.ts:780-787`); no revision GC | history (M17) |
| Browser persistence | | X | | | IndexedDB stores for versions/branches; OPFS unused | platform (M5) |
| Native E2E coverage | | X | | | wdio smoke + Playwright tauri project; no history coverage yet | tests (M17) |

## Collaboration readiness

`@varve/collab` is **scaffold, not CRDT**: no-op transaction hooks, empty
user list, Rust stubs (`collab/src/index.ts`, `lib.rs:2027-2036`). There is no
synchronization to reconcile with, so the persistent operation log can be
defined as the future protocol (ADR-0039) without translation. Nothing in the
current collab layer constrains array ordering, actor identity, or undo
policy. Do not describe it as production synchronization (plan §26).

## Git-format alternatives (ADR-0028 input)

| Option | Fit today | Risks |
|---|---|---|
| 1. Single canonical text file | `.varve` already a single JSON file; zero migration; existing save path atomic (temp+rename `lib.rs:233-261`) | Assets inline (dataUrl) bloat diffs; whole-file conflicts |
| 2. Deterministic directory package | Content-addressed assets would shrink diffs | New save/load machinery, packaging, rename handling |
| 3. Dual representation (portable + unpacked) | Friendly file + git-optimized tree | Two sources of truth; pack/unpack determinism burden |
| 4. Manifest + external assets | Best diff granularity | New format; LFS dependency |

**Direction**: v1 = option 1 (single canonical `.varve` text file; diff drivers
consume the canonicalized text; binary payloads excluded from the diff text via
hash references). Options 2/4 documented as future extensions with a
deterministic pack/unpack requirement. Decided in ADR-0028/0029.

## Frontend panel inventory (for the History panel)

- **No panel registry**: `Shell.tsx` statically composes panels; visibility
  from editor state (`leftPanelVisible` etc., `Shell.tsx:284-290`); workspace
  config via `PanelId`/`PanelConfig` (`workspace/workspaceTypes.ts:40-60`).
- Panel recipe: context state + toggle → `actions/registerAll.ts` →
  `SHORTCUT_DEFS` → `menu/defs.ts` + `localization.ts` → Shell div →
  `workspaceTypes.ts` per-mode table.
- Virtualization pattern to reuse: `useFlatTree` structural diffing +
  `@tanstack/react-virtual` (`LayersTree.tsx:522-532`), `aria-setsize` rows.
- Comparison highlight pattern: `ImageCompareOverlay` (DOM overlay,
  world→screen coords, `pointerEvents:none`).
- Announcements: `CanvasAnnouncer` (`canvas/CanvasAnnouncer.ts:13-87`),
  `editor.announce`, ToastBridge.
- No detachable-panel architecture exists; none required for v1.

## Storage and performance baseline

- Save path: encode → `upsertPreservingMeta` (+`writeDocumentToPath` when from
  disk) → thumbnail → dirty=false (`usePersistence.ts:67-112`). Autosave 5 min
  default (`autoSaveService.ts:26-30`). Atomic native writes via temp+rename
  (`lib.rs:233-261`), sandboxed paths (`lib.rs:154-225`).
- Undo cost today: full immutable document snapshot per entry (structural
  sharing); 50 entries; no serialization in the interaction path.
- No benchmarks exist for version creation, hash, or replay (none exist).
- 4 GB RAM target: snapshots are JSON strings of the document; bounded by
  pruning. Persistent log design must batch appends and defer hashing.

## Security threat model (plan §30 — summary)

Documents/logs/snapshots/repos/bundles are untrusted input. Attack surface
today: `DocumentCodec.decode` (JSON.parse of untrusted files, migration chain),
asset dataUrls (MIME whitelist + 10 MB cap already exist,
`documentCodec.ts:256-258`), clipboard payloads, import parsers. New surface
from this project: operation payloads (validate against registered schemas,
never generic `JSON` patches with prototype access), revision/branch/conflict
counts (set limits), Git drivers (untrusted paths, no shell assembly, no
auto-mutations, document-manifest-bound reads), review bundles (CSP, escaped
user content, no remote deps), multimodal (artwork text = untrusted prompt
content; consent; typed schema-validated proposals only).

## Test infrastructure readiness

Vitest + RTL (jsdom for editor/ui/home), `fast-check` already used in
scene/engine/editor, Playwright chromium/visual/tauri projects, wdio native
suite, engine goldens (sha256 of pixels), menu snapshots, coverage thresholds
80/70/80/80. Pattern established for golden fixtures and property tests —
directly reusable for canonical fixtures and merge-matrix tests.
