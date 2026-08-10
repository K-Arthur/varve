# Save Locations — Current-State Audit (2026-08-09)

Audit of Varve's document-saving architecture before and after the
user-controlled persistence overhaul. Canonical design:
`docs/architecture/save-destinations.md`.

## Why files could previously appear saved without a user-chosen location

1. **New documents were born with a library id.** `createDocumentFromRequest`
   (`packages/home/src/HomeShell.tsx`) minted a `FileEntry.id` and upserted
   the entry into the app store at creation; the editor session opened with
   that `fileId` and no path. Save's identity logic treated "has a fileId"
   as "saved somewhere", so `Ctrl+S` on a brand-new document silently wrote
   the internal store copy and set `dirty=false`, `saveState='saved'`.
   The UI then said **Saved** even though the user never chose a location.
2. **`saveAsImpl` minted a fresh UUID on every Save As** while
   `RecentFileRecord`'s doc comment promised a stable id — version history,
   recents, projects and tags were orphaned onto a new id each time.
3. **Save completion was not revision-aware.** `save()` captured no revision;
   a save finishing after a newer edit unconditionally cleared `dirty`.
4. **Recovery was presented as saved.** Restoring an autosave snapshot
   opened a clean, unbound tab; the recovery dialog showed a "Saved file"
   badge, and nothing distinguished a recoverable internal copy from a real
   user-chosen destination.
5. **Web saving was a no-op or a lie.** `detectPlatform()` returned the
   in-memory platform in browsers, so every browser Save silently did
   nothing (or, via `writeDocumentToPath`, re-picked with a hardcoded
   `'document'` filename). File System Access handles were never persisted
   on the save side.
6. **Desktop could not open/save outside `$HOME`.** `resolve_user_path`
   rejected every path not under the home or temp directory, silently
   breaking documents on other drives, removable media, and network mounts.
7. **Canvas draws never marked the document dirty.** `createShapeAt` /
   `createTextNodeAt` patched the document without setting `dirty` — a
   freshly drawn frame/rect/text left the document "clean", so a subsequent
   save could skip it entirely.

## New model (implemented)

- **Identity vs destination.** `SessionFileMeta.fileId` = library identity
  (minted at creation); `SaveTarget` = destination. A bare fileId is
  `unsaved`; only `libraryStorage: true` is an explicit Varve Library
  destination.
- **One save coordinator.** `persistence/saveCoordinator.ts` serializes all
  intents (`save | save-as | save-copy`), coalesces plain-Save bursts
  latest-wins, and marks clean only when the captured immutable document
  reference is still current.
- **First Save is explicit.** Untitled → Ctrl+S → native dialog → write →
  adopt. Cancellation is a first-class outcome, never an error.
- **Save As keeps identity.** Library id stable; destination/name update on
  the same entry after a successful write. Failed/cancelled Save As changes
  nothing.
- **Save a Copy** writes elsewhere without adopting or clearing dirty.
- **External-change and missing-destination checks** before every native
  overwrite (content-hash vs `diskContentHash`; `readDocumentText`).
- **Native safety.** Dialog-approved path resolver (external drives work),
  atomic temp+rename writes with directory fsync, transactional
  `home_upsert_file`, varve-only save-dialog filter.
- **Web honesty.** Browser build boots the IndexedDB + FSA web platform;
  handles persist in `varve-handles` (IndexedDB) with permission
  re-checking; download-only fallback never claims a path; save-copy/cancel/
  failure semantics identical to desktop.
- **Status.** `Saving… / Saved / Modified / Not saved / Save failed` in the
  status bar with aria-live announcements; Document Info shows the
  authoritative location + Reveal in Files / Copy File Path.
- **Locate File.** Home context menu re-links a moved/renamed file through a
  native picker, verifying document identity before rebinding.

## Verified behavior (E2E, `tests/e2e/save/save-flow.spec.ts`)

- new document → Save → picker requested (`Untitled.varve`), status Saved
- saved document → modify → Save → target reused, no re-pick
- Save As → re-picks, adopts only after success
- Save As cancel → target/name/dirty unchanged
- Save a Copy → active target unchanged, dirty preserved
- write failure → dirty preserved, status Save failed
- stale save completing after a new edit → document stays dirty

## Remaining limitations

- Headless Chromium intercepts Ctrl+Shift+S at the browser level; the E2E
  drives Save As through the File menu (same action-registry path). Native
  dialog behavior itself (GTK save chooser on CachyOS, Win32/macOS panels)
  is OS-owned and covered by the manual checklist + Rust unit tests, not by
  Playwright.
- Binary exports (`write_binary_file`) remain home-scope restricted; only
  document open/save/drop paths use the approved resolver.
- `EditorState.revision` remains a dead counter; revision identity uses the
  immutable document reference instead (no context-churn risk).
- Version-history visibility follows library identity (stable across Save
  As); the Home Version History restore button remains a close-dialog no-op
  (pre-existing).
- `FileEntry.isMissing` / `RecentFileRecord.missing` are still never
  written; missing detection re-runs per render (pre-existing).
- Web autosave does not write to external file handles (recovery-only), by
  design; manual Save is the flush point.
