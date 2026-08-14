# Cross-OS filesystem hardening audit — 2026-08-13

Scope: directory resolution, path identity, storage policy, the
frontend ↔ native filesystem boundary, recent files, logs, temp files, and
export naming across Linux, Windows, and macOS.

Canonical contract: `docs/architecture/filesystem-boundary.md`.

## What was already sound (credited, not rewritten)

- `write_file_atomic` + `replace_file`: `create_new` staging, `sync_all`,
  sibling-temp atomic replacement with Windows `MoveFileExW` and
  `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`.
- `resolve_user_path` / `resolve_user_path_approved`: canonicalize + lexical
  `.`/`..` rejection + symlink-escape tests.
- `validate_storage_key` / `validate_portable_relative_path`: storage keys
  and portable export paths are validated before any `PathBuf::join`.
- Crash report naming sanitization, 0o600/0o700 permissions, panic-payload
  redaction that now tokenizes Windows drive, UNC, and extended paths.
- Model downloads: https-only, checksum-required, staged, atomic.
- Legacy Strata migration: copy-not-move, partial-copy cleanup, idempotent.
- Portable project path contract (`PortableProjectPath`) with traversal,
  drive-prefix, UNC, and scheme rejection; no host-native `Path` parsing of
  portable references.

## Findings fixed in this pass

| Finding | Fix |
| --- | --- |
| Recent-file native backend missing — the TS facade invoked five commands that did not exist; the Open Recent menu read a write-dead localStorage store and was permanently empty | `recent_files` table (schema v2) + five commands; menu and Home rail read the live store; records keep `missing`/`hidden` state |
| Recent `missing` flag declared but never written | `App.tsx` sets `missing: true` on disk-gone and content-gone paths; opens clear it |
| `home_file_exists` accepted any string as a path oracle | absolute-path + NUL validation; new `home_check_files_exist` batches Home's sweep into one IPC call |
| `varve-upscale` model id reached `model_path` without validation (read escape via `../`) | `validate_storage_key` at the command boundary |
| Inference-crate model-dir fallback resolved to process CWD | falls back to OS data/temp root, never CWD |
| Font `meta.json` and native model writes non-atomic | sibling-temp staging + atomic replace (Windows replace-retry, never delete-first) |
| No app-owned log; `app_log_dir` created but unused; migration failures printed only to stderr | `logs.rs`: bounded `varve.log` (1 MiB, 2 generations), redacted roots, migration outcome recorded |
| Print temp names collided across processes on a shared counter; crashed-process leftovers never cleaned | pid + timestamp in the name; stale sweep under the `varve_print_*` prefix only |
| Pre-overwrite read conflated every failure with "file missing" | typed `FsError` from `home_read_text_file_approved`; editor reports `filesystem-unavailable` for unreadable locations |
| Export of a node named `logo.png` produced `logo.png.png` | `formatFileName` collapses duplicate trailing extensions (case-insensitive) |
| `extensionForExport` derived `"."` from trailing-dot filenames | hint-derived extensions reject bare dots and separators |

## Storage map (logical destinations)

| Category | Root | Subdirectory |
| --- | --- | --- |
| Application data | `app_data_dir()` | root, `fonts/`, `models/` |
| Configuration | `app_config_dir()` | root |
| State | `app_local_data_dir()` | root, `recovery/`, `crash-reports/` |
| Cache | `app_cache_dir()` | `thumbnails/`, `staging/` |
| Logs | `app_log_dir()` | `varve.log` (+ generations) |
| Temporary | OS temp | `varve/` (lazy, app-generated names) |
| Resources | `resource_dir()` | read-only by policy |
| Recents | app data `documents.db` | `recent_files` table |

Platform-resolved, never derived by the frontend, never beside the
executable, never in the mounted AppImage/app bundle.

## Remaining limitations

- `home_read_text_file_approved` / `home_write_text_file_approved` trust the
  native dialog as the authority: any absolute path a compromised renderer
  names is canonicalized and (for the strict variants) scoped to
  home + temp. A dialog-token binding scheme would close the remaining gap.
- The `fs` plugin capability grants read/write over app dirs; a webview
  compromise could reach `documents.db` through the plugin. Custom commands
  are already scoped; plugin-level scope tightening needs an audit of every
  `plugin:fs|` call site.
- Panic-payload redaction keeps basenames (useful) and is best effort, as is
  log redaction; neither is a security boundary.
- `varve-upscale` ONNX Runtime test requires a machine-loadable
  `libonnxruntime.so`; on machines without it the test is
  environment-blocked, not a code failure.
- Packaged-build filesystem validation (AppImage/DEB/RPM/NSIS/DMG) and
  Windows/macOS native CI runs remain the follow-up gate; only Linux
  dev-profile and unit-test evidence exists for this pass.
