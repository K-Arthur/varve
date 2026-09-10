# Persistent History — Existing Version-System Map (2026-08-05)

Part of the persistent step-level history architecture audit (Milestone 1).
Evidence from `packages/platform`, `packages/home`, `packages/editor`,
`apps/desktop/src-tauri`. Feeds ADR-0024 (version-history migration).

## Storage backends

| Backend | Doc storage | Version storage | Branch storage | Notes |
|---|---|---|---|---|
| Memory (tests) | `Map` (`memory-state.ts:30`) | `versions: Map<fileId, VersionEntry[]>` + content-addressed `versionContent` (`memory-state.ts:44-46`) | same as web | |
| Web / IndexedDB | `files` store, DB `varve-home` v3 | `versions` + `versionContent` stores (`web-db.ts:45-52`) | `branches` store | 18 object stores |
| Tauri / SQLite | `documents`/`files` tables (`varve-sync/src/lib.rs:86-126`) | **localStorage only** (`tauri.ts:760-764`) | **broken** — Rust commands missing | No versions/branches tables in SQLite |

## Version record

```ts
{ id, fileId, name?, description?, documentHash (FNV-1a 32-bit), timestamp,
  kind: 'checkpoint'|'named'|'auto'|'manual', origin: 'save'|'autosave'|'checkpoint'|'manual'|'import'|'migration'|'sync',
  size, schemaVersion?, thumbnail?, pinned }
```
(`packages/platform/src/types.ts:384-403`)

## Branch record

```ts
{ id, name, fileId, baseVersionId?, status: 'open'|'merged'|'closed', createdAt, updatedAt }
```
(`types.ts:425-433`)

## Key findings

1. **Flat snapshot list, no DAG.** No parent link, no heads, no merge parents
   anywhere. `baseVersionId` is the only lineage pointer and it is never
   advanced — a branch has no head.
2. **Content-addressed dedup exists**: identical serialized JSON shares one
   copy keyed by `documentHash`; content GC during prune
   (`memory.ts:709-787`, `web.ts:708-787`).
3. **No production caller**: `createVersion`/`maybeAutoVersion` are only
   exercised by tests. `VersionHistoryService` (`packages/editor/src/versionHistory/`)
   is unwired. Home screen Version History dialog operates on
   `platform.saveVersion` only when opened via the file context menu.
4. **Desktop versioning is weakest**: versions live in webview localStorage
   (not SQLite); `home_list_recent_files`/`home_list_branches`/`home_create_branch`
   commands are missing in Rust (`lib.rs:2240-2332`), so recents and branches
   silently fail on desktop.
5. **Hash is FNV-1a 32-bit** — a dedup key, not an integrity mechanism
   (per plan §14, replace with a modern content hash; keep FNV only as a
   fast pre-filter).
6. **Recovery/backup are separate systems**: crash recovery points
   (`recovery.ts`, IndexedDB `varve-recovery`, max 20, 7-day TTL), engine
   backups (`packages/engine/src/backup/`, IndexedDB, retention ladder), and
   platform versions are three disconnected snapshot stores.

## Migration mapping (proposed, ADR-0024)

| Existing concept | Becomes |
|---|---|
| `VersionEntry` (checkpoint/named) | Imported snapshot revision + `CheckpointRef` |
| `VersionEntry` (auto/manual) | Recovery refs / snapshot revisions (no fabricated linear order) |
| `Branch` record | `BranchRef` with real head revision (migrated from `baseVersionId` or creation point) |
| `versionContent` | content-addressed snapshots (re-keyed to SHA-256, keeping FNV fast index) |
| Home "Save to Version History" | `checkpoint` command in the new pipeline |
| `VersionHistoryService` | re-implemented as a facade over the revision store |
| Engine backups | remain an orthogonal disaster-recovery layer (documented, not unified) |

## Verdict

Do not build a parallel `PersistentHistoryService` beside `VersionEntry`:
the existing version APIs become facades over the revision DAG, and the flat
`versions`/`branches` stores are migrated into revision/checkpoint/branch refs
(Milestones 6 and 9).
