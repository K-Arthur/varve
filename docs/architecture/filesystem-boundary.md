# Varve filesystem boundary

Status: foundational contract introduced 2026-08-13; document lifecycle,
archive/import migrations, and platform-native packaged-build tests remain
follow-up slices. The slices below were implemented 2026-08-13.

Varve treats these as different values:

`PortableProjectPath` ≠ native filesystem `PathBuf` ≠ `file:` URL ≠ display text.

## Ownership model

The desktop process is the filesystem authority. The frontend sends user
intent and receives operation results; it does not reconstruct app-owned
directories or write arbitrary internal paths.

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
