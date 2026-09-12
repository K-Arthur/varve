# Varve filesystem boundary

Status: foundational contract introduced 2026-08-13; document lifecycle,
archive/import migrations, and platform-native packaged-build tests remain
follow-up slices. The slices below were implemented 2026-08-13.

Varve treats these as different values:

`PortableProjectPath` ≠ native filesystem `PathBuf` ≠ `file:` URL ≠ display text.

## Ownership model

On the desktop route the desktop process is the filesystem authority. The
frontend sends user intent and receives operation results; it does not
reconstruct app-owned directories or write arbitrary internal paths. The
browser route has a different authority (origin storage plus user-selected
File System Access handles); its contract is the
[Browser route](#browser-route-chrome-edge-and-chromebooks) section below.

```text
user intent
  → typed logical resource / native dialog selection
  → Tauri command
  → AppDirectories + validated PathBuf
  → OS filesystem
  → typed result / redacted display state
```

`apps/desktop/src-tauri/src/filesystem.rs` is the policy boundary. It uses the
Tauri 2 path resolver for application data, config, cache, local state, logs,
temporary storage, and packaged resources. Resource directories are read-only
by policy. The frontend must not derive `%APPDATA%`, XDG, or macOS Library
locations itself.

## Storage map

| Category | Resolver root | Varve subdirectory | Persistence | Sensitivity |
| --- | --- | --- | --- | --- |
| Application data | `app_data_dir()` | root, `fonts/`, `models/` | durable user data | private |
| Configuration | `app_config_dir()` | root | durable preferences | private |
| State | `app_local_data_dir()` | root, `recovery/`, `crash-reports/` | restart/recovery state | private |
| Cache | `app_cache_dir()` | `thumbnails/`, `staging/` | regenerable | private |
| Logs | `app_log_dir()` | root | bounded operational diagnostics | private |
| Temporary | `temp_dir()` | `varve/` (created lazily by operation) | ephemeral | private |
| Resources | `resource_dir()` | packaged resources | read-only | non-user, may identify build |

The actual platform paths are intentionally not printed in product UI or
documentation. Tauri supplies the platform-specific roots for AppImage, DEB,
RPM, NSIS, DMG, installed `.app`, and development launches. No mutable state
is placed beside the executable, in the current working directory, or inside
a mounted AppImage/app bundle.

Downloaded models and installed fonts are application data, not cache. Clearing
regenerable cache must not remove either. Model storage is injected into the
native inference crates at startup so all desktop inference uses the same
Tauri-resolved root; standalone crate tests retain a deterministic platform
fallback.

## Path taxonomy

- `PortableProjectPath`: canonical `/`-separated relative reference stored in
  a `.varve` document. It rejects absolute paths, drive prefixes, UNC roots,
  backslashes, `.`/`..`, URL schemes, and traversal components.
- Native user path: an OS-selected document, asset, import, or export path. It
  remains native in Rust and is only rendered as display text after redaction.
- App-owned path: a child of an `AppDirectories` root. It is never supplied as
  an arbitrary frontend destination.
- Display path: lossy, privacy-filtered text for UI or diagnostics only; it is
  never used for equality, containment, deduplication, or filesystem access.

Portable references are not URL-decoded. A URL such as `file:///etc/passwd`
is not a native path and is not accepted as a portable project reference.
Conversion between a native path and a `file:` URL belongs in a dedicated
platform adapter, never in a separator replacement helper.

## Safety contracts introduced in this slice

- Generated names replace Windows-invalid characters, trim trailing dots and
  spaces, protect reserved device names, and preserve safe Unicode.
- Storage keys reject separators, NUL/control characters, `.`/`..`, and
  oversized values before `PathBuf::join`.
- Atomic writes use an app-generated sibling temporary name and do not convert
  the target filename through `to_string_lossy()`.
- Replacement uses the host-native atomic replace operation: `rename` on
  platforms where it replaces a destination, and Windows `MoveFileExW` with
  replace/write-through flags where plain rename would fail on an existing
  file.
- Font downloads and print spooling use unique staging files under the
  resolved application/temporary roots; they do not share a fixed process-wide
  temporary filename.
- Crash-path redaction recognizes POSIX, Windows drive, UNC, extended Windows,
  mixed-separator, and Unicode path forms. Redaction is best effort and is
  tested independently from crash storage.
- Filesystem failures have a stable category (`NOT_FOUND`, `READ_ONLY`,
  `DISK_FULL`, `TRAVERSAL_BLOCKED`, and related categories); native detail is
  retained only for diagnostics.

## Ownership matrix

| Path purpose | Source / owner | Trust | Native/logical | Lifetime | Expected root |
| --- | --- | --- | --- | --- | --- |
| Open/save document | native dialog / user | user-selected | native | persistent | user-selected location |
| Linked asset | document intent / user | external | portable reference or native location | persistent | project or external volume |
| Fonts | font commands / native service | app-managed | native | persistent | app data `fonts/`; unique staging names |
| Models | download command / native service | app-managed + checksum | native | persistent | app data `models/` |
| Recovery | editor recovery service | app-managed | native | durable until cleared | state `recovery/` |
| Recent files | Home SQLite store | app-managed | library ids, not raw paths | durable | app data `documents.db` |
| Crash reports | native panic hook / crash service | app-managed | native | bounded queue | state `crash-reports/` |
| Thumbnails | home/index service | app-managed | native cache key | regenerable | cache `thumbnails/` |
| Logs | native runtime | app-managed | native | bounded/rotated | Tauri app log dir |
| Packaged assets | Tauri resource resolver | trusted read-only | native | installed build | resource dir |

## Browser route (Chrome, Edge, and Chromebooks)

The browser route runs the same editor on origin storage plus user-selected
File System Access API handles. It has no OS paths, no app-owned directories,
and no Tauri IPC; the origin's storage partition is the authority. This section
is the boundary contract for that route (introduced 2026-09-12).

```text
user intent
  → file picker (Files app / Drive / removable media) or library record
  → FileSystemFileHandle (opaque, permission-gated) or IndexedDB record
  → createWritable() → write → close()          # user-picked file
  → IndexedDB transaction                        # library/document/recovery
  → typed result / honest display state
```

### Storage map

| Category | Storage | Identity | Persistence | Sensitivity |
| --- | --- | --- | --- | --- |
| Documents / library | IndexedDB `varve-home` (`files`, `projects`, …) | library ids, never paths | durable until browser data is deleted | private |
| Recovery points | IndexedDB `varve-recovery` (`recovery_*`) | session id | durable; capped at 20, cleaned after 7 days | private |
| File permissions | IndexedDB `varve-handles` (`handleId → handle`) | opaque handle id | durable while the browser remembers permission; in-memory fallback for the session | private |
| Offline app copies | Cache Storage `varve-demo-shell-*` | versioned cache name | disposable; cleared per user action | non-user build assets |
| Settings / privacy choice | `localStorage` (`varve-editor-settings`) | key | durable; small values only | private |
| Thumbnails / derived previews | IndexedDB `varve-home` (thumbnail stores) | content/identity key | regenerable | private |
| OPFS | **not used** | — | — | — |

The browser has no user-visible application directory. OPFS is origin-private
storage, not a project folder, and is deliberately unused so no document is
hidden from the user's own file manager.

### Path taxonomy (browser)

- File handle: the browser analogue of a native user path. It is opaque,
  permission-gated, serializable into IndexedDB, and may stop resolving when
  the file moves, the volume unmounts, or the permission is revoked.
- Handle id: an internal key for a persisted handle; never a path, never
  displayed, never used for equality of documents.
- Library id: document identity inside `varve-home`; survives Save As.
- Download snapshot: a Blob download is a one-way export, not a location.
  Browsers without File System Access (Firefox, Safari) treat every Save as a
  snapshot plus a library mirror, and it never reports "Saved" as a path.
- `file:` URLs and arbitrary paths are not accepted as browser destinations.

### Safety contracts

- **Pre-overwrite external-change guard.** Both native paths and browser file
  handles compare a content hash before writing. For a handle, the session
  stores `diskContentHash` after every successful write and passes it as
  `expectedContentHash` on the next write; a mismatch returns
  `file-changed-externally` and never touches the file. This is what detects a
  Drive-synced newer copy, another app's edit, a second device, or a remounted
  removable volume.
- **Permission is re-checked, never assumed.** `queryPermission` runs before
  every handle write; `requestPermission` is attempted only when the browser
  can surface it. A denial keeps the document dirty and reports
  `permission-denied`.
- **Writes are staged by the browser.** `createWritable()` buffers until
  `close()`; the document is clean only after `close()` resolves. Quota
  failures surface as `quota-exceeded`, missing/renamed destinations as
  `destination-missing`, read-only or shared files as `permission-denied`; the
  document stays modified in every failure case.
- **Handles survive storage denial.** If IndexedDB is unavailable (private
  mode, blocked storage) or the handle is not cloneable, it is kept in memory
  for the session and the first write still succeeds; only a reload asks for
  the file again, reported as `permission-expired`.
- **Cross-tab safety.** Autosave takes a Web Lock per document
  (`varve-doc-write:<fileId>`) and skips the write when the stored record is
  newer than this tab's last write, so a background autosave cannot silently
  replace another editor's later work on the same origin.
- **Eviction and cleanup.** Origin storage is best-effort by default; the
  Storage manager requests persistence from a user action and labels usage as
  an estimate. Offline-copy cleanup is prefix-gated to `varve-demo-shell-*` and
  can never touch documents or recovery points. Deleting browser data (or
  uninstalling the app with data removal) removes documents and recovery
  points together, which is why the UI warns before suggesting it.

### ChromeOS specifics

- **Files app and Drive.** A user-picked file may live in My Files, a
  removable volume, or Google Drive. Varve sees an opaque handle; Drive sync,
  rename/move, and "available offline" pinning are external to Varve. Do not
  promise that a Drive-backed file stays available offline, and do not describe
  Drive sync as Varve-managed. The external-change guard is the protection
  against a newer synced copy being overwritten.
- **Removable media.** Unmounting an SD card or USB volume makes the handle
  stop resolving; the next save reports `destination-missing` or
  `permission-expired` and offers Save As. Reconnecting the volume and
  re-selecting the file is the recovery path.
- **Shared / read-only files.** Files shared read-only in Drive fail at
  `createWritable()` with a permission category; Save As is the resolution.
- **Data deletion.** "Delete browsing data" for the site, profile removal, and
  uninstall-with-data all delete documents and recovery copies. Files the user
  saved through the Files app (My Files/Drive/removable) are untouched because
  they live outside browser storage.
- **Private/incognito.** Treated as non-durable: storage may be unavailable or
  cleared at session end, so handles are session-only and the editor reports
  ephemeral storage rather than a false "Saved".
- **ChromeOS Linux (Crostini) is a separate route.** Storage inside the Linux
  container is not shared with the browser's origin storage; see
  `docs/release/chromeos-linux.md`.

### Known follow-ups (browser route)

- **Recent-files rebinding.** The browser recent-files flow reads a stored
  handle and opens the document content, but the session does not adopt the
  handle as its save target, so the next Save asks for a location again. The
  handle guard above protects sessions that bound a destination; rebinding on
  open is the remaining parity gap.
- **`file_handlers` launch** (opening a `.varve` from the Files app) is
  researched but not implemented; it requires an installed app and per-launch
  permission, so it remains a progressive enhancement.
- **OPFS staging** for very large temporary work is unused; documents are
  bounded by origin quota and the editor's own raster policies.

## Known follow-up slices

The contract does not claim that every legacy document/import/export path has
already migrated. The next slices must apply it to Save As transactions,
external linked assets, archive extraction, symlink-aware cleanup, temporary
ownership, and packaged-build tests on each supported OS. Those operations
must preserve the same distinction between portable references, native paths,
URLs, and display strings.

## Implemented since the contract (2026-08-13)

- **Native recent-file store.** `recent_files` table (schema v2) in the Home
  SQLite store with touch/list/patch/remove/clear commands. The frontend
  facade already spoke this contract; the native side was missing entirely,
  so the File → Open Recent menu was permanently empty in production. Records
  keep `missing` and `hidden` state instead of being deleted when a path is
  temporarily unavailable, so a network/removable volume that reconnects
  does not lose history. The menu now opens records by library id and
  restores the disk binding from the file row.
- **Missing-file state is written.** `App.tsx` records `missing: true` when a
  document's path or cached content is gone; a successful open clears it via
  the touch command.
- **Batch existence probes.** `home_check_files_exist` resolves Home's
  per-file missing sweep in one IPC round-trip. `home_file_exists` rejects
  relative and NUL-containing input so the command cannot act as an arbitrary
  path oracle.
- **Typed read errors.** `home_read_text_file_approved` returns structured
  `FsError` categories; the pre-overwrite read in the editor now distinguishes
  a vanished destination from a location that exists but cannot be read.
- **Model-boundary validation.** The `varve-upscale` model id is validated as
  a storage key at the command boundary so a `../` component can never escape
  the models root on a read. Background-removal ids were already allow-listed.
- **No CWD fallbacks.** The standalone inference crates' model-dir fallback
  never resolves to the process working directory; it uses the OS data or
  temp root.
- **Atomic metadata writes.** Font `meta.json` and native model writes are
  staged through unique sibling temporary files and atomic replacement
  (Windows replace-retry, never delete-then-write).
- **Bounded app-owned logs.** `logs.rs` writes `varve.log` into the
  Tauri-resolved app log directory with rotation (1 MiB, 2 generations) and
  redacts real HOME/USERPROFILE/temp/app roots before they reach the log.
  Legacy-migration outcomes are recorded there.
- **Collision-safe print staging.** Print temp files carry pid + timestamp
  (no cross-process counter collision) and a stale sweep removes only
  `varve_print_*` leftovers older than a day.
- **Export naming.** `formatFileName` collapses a duplicate trailing
  extension (`logo.png.png` → `logo.png`, case-insensitive) while keeping
  legitimate interior dots; `extensionForExport` never derives `"."` from a
  trailing-dot filename.
