# Save Destinations — User-Controlled Persistence

Canonical architecture for where documents live, how Save / Save As /
Save a Copy behave, and how Varve distinguishes "recoverable" from "saved".

Status: current (2026-08-09). Companion audit:
`docs/audits/save-locations-current-state-2026-08-09.md`.

## The core invariant

> A recovery snapshot is not a Save. An internal Home/library cache is not a
> filesystem Save unless the user explicitly chose Varve Library as the
> destination. A downloaded browser copy is not a persistent writable path.
> A user-selected file location is a save target.

Save writes to the current target. Save As chooses a new target. Save a Copy
writes elsewhere without changing the current target.

## Identity versus location

Two concepts are deliberately separate:

| Concept | Type | Meaning |
|---|---|---|
| Document identity | `Document.id` | Logical identity of the editing session; key for undo/version history |
| Library identity | `SessionFileMeta.fileId` | Identity in the Home/library index. Minted at document creation — **not** a save destination |
| Save destination | `SaveTarget` | Where the bytes are written (`native-file` / `web-file-handle` / `app-storage` / `download-only` / `unsaved`) |
| Content revision | immutable `Document` reference | The edit generation a save covered |

Rules:

- A bare `fileId` never makes a document "saved". New documents receive a
  library id at creation (so the Home index can track them), but their first
  Save still asks the user where to put them.
- Only `libraryStorage: true` marks an explicit choice of Varve Library as
  the authoritative destination — then a library write may mark clean.
- Save As keeps the library id stable (version history, recents, projects,
  tags and recovery survive); the destination (path/handle/name) updates on
  the same entry. A fresh UUID is minted only when the document never had one.
- `diskContentHash` on the session tracks the last known bytes of a native
  file (open-time read or last write) for external-change detection.

## Save intents

One authoritative save service — `persistence/saveCoordinator.ts` (editor) —
serves menu Save, keyboard Save, quit Save, Save As and Save a Copy. Requests
are serialized per document; bursts of plain Saves coalesce latest-wins
(finish the running write, skip obsolete intermediates, save the newest).
Save As / Save a Copy always run.

| Intent | Destination | Adopts target | Clears dirty | Mirrors Home |
|---|---|---|---|---|
| `save` | current target (chooses on first save) | — | yes, revision-aware | yes |
| `save-as` | new target via dialog | yes, only after success | yes, revision-aware | yes |
| `save-copy` | new target via dialog | never | never | no |

### Save (Ctrl/Cmd+S)

- Never saved → native Save dialog (folder + filename), writes `.varve`,
  remembers the location.
- Saved to a native path → writes back to that path directly, no dialog.
- Browser file handle → writes the same handle (permission-checked).
- Download-only browser → produces a fresh snapshot download; the document
  stays dirty and the UI never claims a persistent path.
- Explicit Varve Library choice → writes the library, may mark clean.

### First save is explicit by default

`Untitled → Ctrl+S → native dialog → choose folder + name → Poster.varve →
remember location → Saved`. Varve never silently stores an unlocated
document inside its database and reports Saved.

### Save As (Ctrl/Cmd+Shift+S)

Always opens the location picker. The session adopts the new destination
**only after a successful write**; a cancelled or failed Save As leaves the
current destination, name, identity and dirty state untouched. Suggested
filename normalizes to exactly one `.varve` (never `Poster.varve.varve`).

### Save a Copy (File menu)

Writes a duplicate to a new location without adopting it and without
clearing dirty state — the active document stays bound to its own file.

## Save states and status

`saveState`: `idle | saving | saved | error`, plus `saveIssue` with a
user-actionable category (`permission-denied`, `disk-full`, `read-only`,
`destination-missing`, `file-changed-externally`, `serialization-failed`,
`filesystem-unavailable`, `permission-expired`, `quota-exceeded`,
`unsupported`, `unknown-io`).

Status bar shows: `Saving… / Saved / Modified / Not saved / Save failed`
(never recovery state). Document Info (File → Document Info…) shows the
authoritative location: native path, `Browser file — name`, `Varve Library`,
`Browser download — name`, or `Not saved to a file`, plus Save / Save As /
Reveal in Files / Copy File Path actions.

## Revision-safe completion

A save captures the immutable document reference it serialized. When the
write completes, the document is marked clean only if the reference is still
current; an edit that landed mid-save keeps the document dirty. The
coordinator serializes writes so a stale save can never clobber a newer one.

## Safety before overwriting

For native-file targets, before every write:

1. `platform.readDocumentText(path)` — if the destination is gone (USB
   unplugged, folder deleted), the save fails with `destination-missing` and
   the UI offers Save As; nothing is silently redirected into internal
   storage.
2. Content-hash comparison against `diskContentHash` — if the file changed
   on disk since it was opened, the save fails with
   `file-changed-externally` instead of silently destroying external edits.

Desktop writes are atomic (`home_write_text_file_approved` →
temp sibling file → fsync → rename → best-effort directory fsync). A crash
mid-write leaves the previous file intact. Serialization happens before the
destination is touched. The Home mirror is secondary persistence — its
failure never fails the user's filesystem save.

## Platform contract

`packages/platform/src/platform.ts` separates **choosing** from **writing**:

- `chooseDocumentSaveTarget(suggestedName) → DocumentSaveTargetChoice`
  (`target | cancelled | unsupported | failed`) — native dialog only, no
  writes, no state changes.
- `writeSaveTarget(target, contents) → WriteSaveResult` — writes to an
  already-resolved target.
- `readDocumentText(path)` — external-change / missing-destination checks.

Desktop (Tauri): dialog-approved resolver lets documents live anywhere the
user chose (other drives, removable media, network mounts); the strict
home-scope resolver remains for non-dialog paths. The save dialog offers
`.varve` only; legacy `.strata` files still open/import and round-trip
through their existing path. `lastSaveDirectory` (local KV setting) is the
dialog's starting folder, never a silent destination.

Web: File System Access handles are persisted in IndexedDB (`varve-handles`)
keyed by an opaque handleId — never a fake path, never serialized into the
document. Writes re-check `queryPermission`/`requestPermission`. Without the
API, saving is an honest download-only snapshot. `lastSaveDirectory`,
paths, and filenames never leave the device.

## Recovery and the Home index

Recovery (autosave snapshots) and the Home mirror are implementation safety
mechanisms: never presented as "Saved", never the primary destination, and a
successful primary save deletes the corresponding recovery point only after
the write completed. Home metadata (`pinned`, `favoritedAt`, `projectId`,
`ordering`, `openedAt`, tags) survives every save via
`upsertPreservingMeta`.

## Related files

- Editor: `packages/editor/src/context/usePersistence.ts`,
  `persistence/saveCoordinator.ts`, `persistence/saveTypes.ts`,
  `context/types.ts` (SessionFileMeta), `lifecycle/dirtyRegistry.ts`
- Platform: `packages/platform/src/platform.ts`, `tauri.ts`, `web-save.ts`,
  `filePersist.ts`, `pure.ts` (normalizeSaveFileName / classify errors)
- UI: `components/StatusBar/SaveStatusIndicator.tsx`,
  `components/Shell/DocumentInfoDialog.tsx`
- Home: `apps/desktop/src/App.tsx` (Locate File rebind),
  `packages/home/src/HomeShell.tsx`
- Native: `apps/desktop/src-tauri/src/lib.rs` (approved path resolver,
  atomic writes)
- Tests: `tests/e2e/save/save-flow.spec.ts`,
  `packages/editor/src/persistence/saveCoordinator.test.ts`,
  `packages/platform/src/__tests__/saveTargets.test.ts`
