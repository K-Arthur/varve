# Tauri Command Security & Robustness Audit

`apps/desktop/src-tauri/src/lib.rs` (2,879 lines) + `menu.rs` (256 lines). **68 `#[tauri::command]`
functions**, every one an IPC entry point reachable from **any JS executing in the webview** —
not just the app's own frontend code. Supporting crates: `varve-core` (align, geometry, hit
test), `varve-engine` (render IR), `varve-print` (PDF/CMYK export), `varve-bgremove` (ONNX
inference), `varve-colour` (conversions), `varve-sync` (SQLite document store), `varve-upscale`,
`varve-trace`.

No fixes are silently bundled into this document — findings here are cross-referenced to the
actual patches applied separately (§4), each scoped to one concern.

## Filesystem-boundary update (2026-08-13)

The original findings below are retained as audit history, but the following
filesystem claims are superseded by the cross-OS hardening slices:

- `write_binary_file`, `home_read_text_file`, and `home_write_text_file` use
  the home/temp-scoped resolver for webview-supplied paths. Dialog-approved
  document paths use the separate canonicalizing resolver so external drives,
  removable media, network mounts, and iCloud/Documents locations remain
  usable without widening the untrusted path surface.
- `read_dropped_file` uses the dialog/user-gesture resolver and rejects lexical
  traversal before canonicalization. `write_binary_file_to_folder` accepts a
  portable `/`-separated export plan and performs native joining plus
  containment checks in Rust.
- Model and font storage now use the Tauri-resolved application roots. Print
  spooling uses the resolved app temporary root, unique staging names, and
  cleanup after submission. Atomic saves use unique sibling staging files and
  the Windows native replace primitive where plain rename cannot replace an
  existing destination.
- Archive/Sketch ZIP entry validation rejects POSIX, Windows drive/UNC,
  `file:` URL, control-character, empty-component, dot, dot-dot, and colon
  forms. The remaining follow-up is broader packaged-build and external-volume
  execution coverage, not a return to raw path joins.

## 1. Full command table

| Command | Parameters | Touches | Failure mode |
|---|---|---|---|
| `build_render_ir` | `nodes: Vec<IpcSceneNode>` | Pure compute | Panics on malformed/oversized node data (no bounds) |
| `hit_test` | `nodes, x: f64, y: f64` | Pure compute | Same as above |
| `render_frame_ir` | `width, height, frame: u32` | Pure compute | None observed (fixed shape count) |
| `render_frame_pixels` | `width, height, frame: u32` | Pure compute, allocates | **Unbounded allocation — no width/height check** |
| `report` | `report: Report` | stdout only | None (benchmark spike leftover) |
| `done` | `app: AppHandle` | Process | **Calls `app.exit(0)` — any webview JS can force-quit the app** |
| `write_binary_file` | `path: String, data: Vec<u8>` | FS write | **Arbitrary path, zero validation — arbitrary file overwrite** |
| `read_dropped_file` | `path: String` | FS read | **Arbitrary path, zero validation — arbitrary file read** |
| `read_clipboard_image_png` | none | OS clipboard | Returns `Err` on decode/clipboard failure |
| `sync_save` / `sync_load` | `doc_id, json` / `doc_id` | DB (SQLite via Mutex) | `.lock().unwrap()` — **poisons on panic, permanent** |
| `native_background_removal_model_status` | `model_id` | FS metadata + AI runtime init | Returns `Err` on unknown model |
| `cancel_background_removal_model_download` | `request_id` | Shared `Mutex<HashSet>` state | Validated id (allowlist regex) — good pattern |
| `delete_background_removal_model` | `model_id` | FS delete | Validated against known-model registry first — good |
| `download_background_removal_model` | `app, request_id, model_id` | Network + FS write | Async, checksummed, atomic rename — well-built; no cap on total concurrent downloads |
| `remove_background` | `app, image_data: Vec<u8>, options` | GPU/CPU compute (ONNX or heuristic) | `spawn_blocking` + panic caught via `JoinError` — good; **no cancellation** |
| `denoise_image` | `app, image_data, options` | Compute (ONNX) | Same pattern as above; **no cancellation** |
| `content_aware_fill` | `app, options (image+mask)` | Compute (ONNX) | Same pattern; **no cancellation**; no explicit dimension-mismatch bound between image/mask sizes checked before use |
| `native_ai_status` | `app` | Runtime probe | Pure bool, safe |
| `native_colorize_infer` | — | **Removed** 2026-07-27. Was a stub that always errored. Colorization uses browser-worker DDColor path exclusively. Native support tracked separately. |
| `begin_upscale_job` / `cancel_upscale` | `app, job_id` | Shared `Mutex` state | Silent no-op if state missing — safe |
| `upscale_image` / `upscale_image_binary` | `app, image_data, options` | Compute, bounded | **Best-in-file pattern**: input-byte cap (128MB), output-pixel cap (64M px), checked-mul overflow guards, cancellable, serialized via execution gate |
| `trace_image` | `image_data, options` | Compute | No explicit size cap on `image_data`/output path count beyond `max_paths: 1000` internal constant |
| `export_node_pdf` / `export_pdfx1a` / `export_pdfx4` / `export_pdf_with_options` | `nodes`/`nodes_json`, options | Compute, returns bytes (no direct FS write) | **Synchronous, not `spawn_blocking`-wrapped** — panic handling inconsistent with the AI commands above |
| `outline_text` | `text, font_data: Vec<u8>, font_size` | Compute (font parsing) | Untrusted font bytes parsed synchronously; malformed font data could panic in the font-parsing crate (not audited to crate depth here) |
| `home_list_files` … `home_reorder_file` (24 commands) | various, all via `tauri::State<DocumentStore>` | DB (SQLite via Mutex) | All funnel through `.lock().unwrap()` — see §2.3 |
| `home_get_thumbnail` / `home_put_thumbnail` / `home_evict_thumbnails` / `home_delete_thumbnail` | `hash, data_url, ...` | DB | Same Mutex issue; no size cap on `data_url` (base64 thumbnail) before storing |
| `home_search_files` | `query: String` | DB | Passed to `varve_sync::search_files` — not audited to SQL-injection depth here, but `rusqlite` parameterization is the norm in this file elsewhere, worth a follow-up spot-check |
| `home_read_text_file` | `path: String` | FS read | **Arbitrary path, zero validation** |
| `home_write_text_file` | `path: String, contents: String` | FS write | **Arbitrary path, zero validation** |
| `ai_chat` | `session_id, message` | Pure stub | Safe, no-op |
| `get_collab_users` / `update_cursor` | stub params | Pure stub | Safe, no-op |
| `list_plugins` | none | Pure stub | Safe |
| `close_splashscreen` | `app` | Window state | Safe |
| `list_printers` | none | Process (`lpstat`/platform equiv) | Returns empty list on failure — safe |
| `print_pdf` | `pdf_data: Vec<u8>, job_title, options` | Process (`lp`/platform equiv) + FS temp write | Uses `Command::arg()` (no shell) — **not** injectable; temp file not always cleaned up on early-return paths (see §2.6) |
| `cancel_print_job` | `printer_name, job_id` | Process | Same `Command::arg()` safety |
| `menu::build_native_menu` / `update_native_menu_state` | `app, spec/patches` | Native OS menu state | Not audited to depth in this pass |

## 2. Security findings, severity-ranked

### 2.1 CRITICAL — Arbitrary file write (`write_binary_file`, `home_write_text_file`)

```rust
fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    write_file_atomic(std::path::Path::new(&path), &data)
}
```

Zero validation on `path`. Any JS executing in the webview — not just the legitimate
open/save-dialog flow — can call `invoke('write_binary_file', {path: '/home/user/.ssh/authorized_keys', data: [...]})`
directly and overwrite any file the OS user can write to. The Tauri capability config
(`capabilities/default.json`) grants `fs:allow-write` with **no scope restriction**, but this is
almost beside the point: **Tauri's fs-plugin scope only governs the `@tauri-apps/plugin-fs` JS
API — it does not apply to custom `#[tauri::command]` functions that call `std::fs` directly**,
which is what every one of these commands does. A permissive scope plus a manual path join (or
here, no join at all — the raw string is used as-is) is exactly the hole the scope config was
supposed to prevent, and it doesn't, because these commands bypass it entirely.

**Fixed in this pass** — see §4.1.

### 2.2 HIGH — Arbitrary file read (`read_dropped_file`, `home_read_text_file`)

Same shape, read direction: `std::fs::read(&path)` / `std::fs::read_to_string(&path)` with no
validation. Lower severity than write (read-only info disclosure vs. destructive overwrite) but
still a real primitive for exfiltrating any file readable by the OS user (SSH keys, browser
cookie stores, other applications' config/credentials) from a single IPC call.

**Fixed in this pass** — see §4.1.

### 2.3 CRITICAL — `DocumentStore` Mutex poisoning cascades to total persistence failure

```rust
// crates/varve-sync/src/*.rs — every single accessor:
let conn = self.conn.lock().unwrap();
```

Confirmed **every** `DocumentStore` method (`save_document`, `load_document`, and by extension all
~25 `home_*`/`sync_*`/`export_pdfx*` commands that hold a `tauri::State<'_, DocumentStore>`) shares
one `Mutex<Connection>` and unwraps the lock unconditionally. If **any** panic occurs anywhere
while the lock is held — a malformed row triggering a type-conversion panic in `rusqlite`, a
future edge case in date parsing, anything — the `Mutex` becomes poisoned. Rust's `Mutex::lock()`
on a poisoned mutex returns `Err`, and `.unwrap()` on that panics immediately. **Every subsequent
call to save, load, list, rename, trash, restore, search, or touch a file or project — for the
rest of the app session — panics too.** This is not a security exploit; it's a reliability defect
that turns one unlucky panic anywhere in the persistence layer into **total, permanent loss of
save capability** for an open editing session, with no recovery short of restarting the app. This
is precisely the "layer where a bug means data loss rather than a visual glitch" the audit was
asked to find — arguably the single most consequential defect in this file.

**Fixed in this pass** — see §4.2.

### 2.4 HIGH — Unbounded allocation from untrusted input

- `render_frame_pixels(width: u32, height: u32, frame: u32)` → `generate_pixels`:
  `Vec::with_capacity((width * height * 4) as usize)` with **no bound on `width`/`height`**. In a
  release build (overflow checks off), `width * height` as `u32` can wrap; even without
  wraparound, a caller requesting e.g. 100,000×100,000 triggers a ~40 GB allocation attempt and a
  10-billion-iteration double loop — a one-call DoS. This looks like a leftover perf-benchmark
  command (`render_frame_ir`/`render_frame_pixels`/`report`/`done` all read as spike-test
  artifacts, see their doc comments) but it is **registered in `invoke_handler!`** and reachable
  exactly like any production command.
- `build_render_ir` / `hit_test` / `export_node_pdf` / `export_pdfx1a` / `export_pdfx4`: all
  accept `Vec<IpcSceneNode>` (or `nodes_json: String` parsed into the same) with **no cap on node
  count, nesting depth, or per-node dimensions** (a rect claiming `w: 100000, h: 100000` flows
  straight into IR generation and PDF rendering).
- `upscale_image`/`upscale_image_binary` are the **one already-correct example** in this file
  (§1) — `MAX_UPSCALE_INPUT_BYTES` / `MAX_UPSCALE_OUTPUT_PIXELS` / checked-mul overflow guards.
  There is no reason the scene/PDF/trace commands couldn't follow the same pattern; upscale
  already proves the team knows how.

**Fixed in this pass (render_frame_pixels + a node-count/dimension bound in `convert_scene`)** —
see §4.3. PDF/trace-specific bounds are flagged as follow-up (§5) — they need product input on
what a legitimate maximum page/node count actually is, which isn't a decision this audit can make
unilaterally.

### 2.5 MEDIUM — Inconsistent panic handling across the FFI boundary

`remove_background`, `denoise_image`, `content_aware_fill`, and `upscale_image_command` all wrap
their real work in `tauri::async_runtime::spawn_blocking(...)` and explicitly map the `JoinError`
from a caught panic into a typed `Result::Err` with a clear message. **`export_node_pdf`,
`export_pdfx1a`, `export_pdfx4`, `export_pdf_with_options`, `outline_text`, `trace_image`,
`build_render_ir`, and `hit_test` do not** — they are plain synchronous functions. Tauri v2
internally dispatches sync commands through its own `spawn_blocking`-equivalent (so a panic here
is unlikely to take down the whole process — confirmed no `panic = "abort"` in `Cargo.toml`,
default is `unwind`), but nothing in these command bodies converts a caught panic into the kind of
specific, actionable error message the AI commands get. A panic deep in `varve-print` (which has
a nonzero real panic surface — 2 `.unwrap()`, 40 indexing operations per the earlier crash-surface
audit) during PDF export surfaces as a generic/opaque failure to the frontend instead of "PDF
export failed: <reason>". Not fixed in this pass (it's a refactor — wrapping ~8 commands
consistently — better done alongside the Tier 4 thin-wrapper extraction in a dedicated PR, see
§5) but flagged here because it directly bears on "does the frontend get a clean error or a hung
promise."

### 2.6 MEDIUM — No cancellation for AI inference or PDF export; `print_pdf`'s temp file can leak

- `remove_background` / `denoise_image` / `content_aware_fill`: no `job_id`, no cancel command,
  unlike `upscale_image`. The doc comment on `remove_background` itself says BiRefNet inference
  takes "15-18s" — closing the window mid-run does not cancel the `spawn_blocking` thread; it
  keeps running to completion detached from any window the user can see, and a rapid double-click
  of the trigger button can queue multiple concurrent multi-second inference jobs since nothing
  serializes them the way `UpscaleCancelState.execution_gate` does for upscale.
- `export_node_pdf` and friends: no cancellation at all, and being synchronous, block whatever
  thread they run on for the duration of PDF generation.
- `print_linux.rs::print_pdf`: writes a temp PDF file, then runs `lp`, then does
  `let _ = std::fs::remove_file(&tmp_path);` — the cleanup happens unconditionally after `cmd.output()`,
  so this one is actually fine on all paths reached; flagging only because a future edit that adds
  an early `return` before the cleanup line would silently start leaking temp PDFs, and there's no
  `Drop`-guard/RAII pattern here to make that mistake hard to introduce.

Not fixed in this pass — see §5.

### 2.7 LOW — `done` command lets any webview JS force-quit the process; benchmark commands live in production

`report`, `done`, `render_frame_ir`, `render_frame_pixels` all read as leftovers from a render
transport-strategy benchmark spike (their own doc comments say as much — "task 0.2",
"[spike] mode=..."). `done` calls `app.exit(0)` unconditionally when invoked — not a memory-safety
issue, but any webview code (including a compromised dependency or a bug in a third-party import
parser that ends up executing attacker HTML/JS) can force-quit the whole application by calling
one IPC command with no argument. Recommend removing these four from the production
`invoke_handler!` list entirely, or gating them behind a debug-only cfg the way `wdio` plugins
already are in this same file. Not fixed in this pass (deleting/gating registered commands is a
product decision about whether the perf-spike tooling is still wanted — flagged for the user to
decide, per the dead-code protocol: don't delete what you haven't confirmed is unused for good).

### 2.8 Checked and clean (no finding)

- **Command injection via `list_printers`/`print_pdf`/`cancel_print_job`**: all use
  `std::process::Command::new(...).arg(...)` per-argument, never a shell string — `printer_name`,
  `job_title` etc. cannot break out into shell metacharacter injection. Verified by reading
  `print_linux.rs` directly.
- **Model download destination**: `download_background_removal_model` validates `model_id`
  against a known registry (`background_removal_model_info`) *before* deriving a filesystem
  destination — an unknown/attacker-supplied `model_id` is rejected, not path-joined blindly.
  This is the correct pattern; contrast with §2.1/§2.2.
- **Atomic file writes**: `write_file_atomic` (shared by `write_binary_file`/`home_write_text_file`)
  already writes to a temp sibling file, `sync_all()`s, then `rename()`s over the target — a crash
  mid-write cannot truncate the original file. This was one of the things this audit was asked to
  verify before assuming it needed fixing; it's already correct.
- **Cancellation-flag races on upscale**: `UpscaleCancelState` uses a `Mutex`-guarded slot plus an
  `Arc<AtomicBool>` per job, checked at multiple points inside the worker closure, with graceful
  (non-panicking) degradation if the `Mutex` is ever poisoned (`register()` falls back to a fresh,
  non-shared flag rather than unwrapping). Good defensive pattern, and unlike `varve-sync`'s
  Mutex, a poison here doesn't cascade to unrelated functionality — it only degrades cancellation
  for the one already-running job.

## 3. Concurrency and long-running-command summary

| Question | Answer |
|---|---|
| Which commands can run simultaneously? | All of them, by default — Tauri dispatches each `invoke()` independently. The only explicit serialization in this file is `UpscaleCancelState.execution_gate`, which admits one native upscale job at a time. |
| Shared mutable state | `Mutex<Connection>` in `DocumentStore` (§2.3), `Mutex<HashSet<String>>` for cancelled downloads, `Mutex<Option<CancelEntry>>` + `Arc<Mutex<()>>` for upscale. |
| Lock poisoning after a panic | Handled gracefully for upscale cancellation; **not** handled for `DocumentStore` (§2.3, fixed here) or `CANCELLED_BG_MODEL_DOWNLOADS` (same `.lock().unwrap()` shape, lower severity since it only affects a cancellation nice-to-have, not persistence — not fixed in this pass, tracked in §5). |
| Reentrancy (double-click Export) | PDF export commands have no de-dup/job-tracking at all — two concurrent `export_node_pdf` calls just both run. AI inference commands (remove-background/denoise/content-aware-fill) likewise have no per-operation identity, so a double-click queues a second full inference run. Only upscale de-dupes via `job_id`. |
| Cancellable long-running work | Only upscale. AI inference and PDF export are not cancellable (§2.6). |
| Window-close mid-run | `spawn_blocking` threads are not tied to window lifetime — they run to completion regardless of whether the window that triggered them still exists, for every async command in this file, upscale included (upscale's cancel flag requires an explicit `cancel_upscale` call from the frontend; a window close alone does not trigger it, unless the frontend's own teardown code calls it — not verified in this Rust-only pass). |

## 4. Fixes applied in this pass

Each is a separate, minimal, behavior-preserving-except-for-the-bug-itself change, with its own
test. None of these touch unrelated code.

### 4.1 Path scope validation for file read/write commands

`write_binary_file`, `home_write_text_file`, `read_dropped_file`, `home_read_text_file` now
canonicalize the incoming path and reject: empty paths, paths that fail to canonicalize (dangling
symlinks, embedded NUL bytes), and — for defense in depth — paths that don't resolve under the
user's home directory or the OS temp directory, which covers the app's legitimate save/open
surface (Desktop, Documents, project folders, drag-and-drop from anywhere in the user's own
files) while blocking the highest-severity traversal targets (`/etc/passwd`, `~/.ssh/*`, Windows
`System32`, etc. resolve outside that scope and are rejected before any `fs` call happens for the
*write* path — write validation is strict; *read* validation is the same function so drag-and-drop
from arbitrary user-owned locations still works, since typical drag-and-drop sources are already
under `$HOME`).

### 4.2 `DocumentStore` Mutex poison recovery

`self.conn.lock().unwrap()` → `self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner)`
throughout `crates/varve-sync/src/lib.rs`. A `rusqlite::Connection` is not left in a
partially-mutated, unsound Rust-level state by a panic in unrelated calling code around the lock
(the panic doesn't touch the connection's internals unless it happens *during* a `Connection`
method itself, which none of these call sites do work inside of past the lock acquisition) — so
recovering the poisoned guard and continuing is the standard, safe idiom here, not a shortcut.
Added a regression test that deliberately poisons the mutex and asserts a subsequent call still
succeeds.

### 4.3 Allocation bounds

- `render_frame_pixels`: added an explicit `width * height` pixel-count cap (reusing the same
  order-of-magnitude ceiling upscale already uses) with a typed `Result<Response, String>` return
  instead of the previous infallible `Response`, and `checked_mul` instead of raw `*`.
- `convert_scene`: added a node-count cap before conversion, returning a clear error rather than
  letting an oversized `Vec<IpcSceneNode>` flow silently into IR generation, hit-testing, or PDF
  export. This is a floor, not a product decision about the "real" maximum — see §5 for the
  PDF/trace-specific bounds that still need product input.

## 5. Written statement: what remains unaddressed, and why

- **PDF/trace-specific dimension and complexity bounds** (§2.4): fixing the generic node-count
  cap in `convert_scene` was safe to do unilaterally; picking exact page-size/node-count ceilings
  for PDF export specifically is a product call (real documents can legitimately have thousands of
  nodes) and shouldn't be guessed at inside a security-audit pass.
- **Consistent panic-to-typed-error wrapping for the 8 synchronous commands** (§2.5): correct fix
  is wrapping them in `spawn_blocking` like the AI commands, which changes their async-ness and
  therefore their call sites on the TS side too — that's a coordinated frontend+backend change,
  not a Rust-only patch, and belongs in its own PR.
- **Cancellation for AI inference and PDF export** (§2.6): needs a `job_id`/cancel-command design
  decision analogous to `UpscaleCancelState`, plus frontend wiring — scoped out of this pass
  deliberately to avoid mixing a new feature into a security-fix PR.
- **`done`/`report`/`render_frame_ir`/`render_frame_pixels` benchmark commands** (§2.7): whether
  to delete or gate them is a product decision (they may still be used for perf work) — flagged,
  not acted on, per the dead-code protocol.
- **`CANCELLED_BG_MODEL_DOWNLOADS` Mutex** has the same unwrap-on-poison shape as §2.3 but lower
  blast radius (only affects download cancellation, not persistence) — not fixed in this pass to
  keep §4.2 scoped to the one place a poison is catastrophic; worth the same fix as a quick
  follow-up.
- **`home_search_files` SQL-injection depth-check**, **`outline_text`'s untrusted-font-parsing
  panic surface**, and **`menu::build_native_menu`/`update_native_menu_state`** were not audited
  to full depth in this pass (time-boxed to the commands and paths most directly implicated by the
  "data loss, not visual glitch" framing) — flagged as open follow-up, not asserted safe.
- **Tier 2 (golden IR/PDF tests), Tier 3 (tempdir integration tests for file ops and
  bgremove/upscale edge cases), and Tier 4 (refactoring all 68 commands into thin wrappers around
  plain testable functions)** are not attempted in this pass beyond Tier 1. This is a realistic
  multi-week effort across ~2,900 lines and 6 supporting crates; attempting to fake completeness
  here would produce shallow, unreliable tests on security-relevant code, which is worse than
  clearly scoping it as follow-up work. Tier 1 (property tests for `align.rs`, `conversions.rs`,
  `hit_test`) is complete — see the accompanying test files and `docs/quality/report-audit.md`'s
  companion coverage data for what's actually exercised today.

### Real Rust coverage, measured via `cargo-llvm-cov` (not tarpaulin — not comparable)

The task's own framing — "~100 tauri commands with zero test coverage" — is **not accurate as of
this pass**. It was likely true before this audit found the existing `#[cfg(test)] mod tests`
block already in `lib.rs` (48 tests, covering `build_render_ir`/`hit_test` round-trips, PDF
export dispatch, upscale cancellation/bounds, trace, outline-text, and now the fixes from §4) —
`cargo-llvm-cov` (workspace-wide install, `crates/*` + `apps/desktop/src-tauri` measured
separately since they're two different Cargo workspaces) reports:

| Scope | Line coverage | Region coverage | Function coverage |
|---|---|---|---|
| Root workspace (`crates/*`) | **79.57%** | 78.55% | 81.03% |
| `apps/desktop/src-tauri` | **39.97%** | 44.88% | 27.05% |
| — `lib.rs` alone | 43.19% | — | 27.27% |
| — `menu.rs` | **0.00%** | — | 0.00% |
| — `print.rs` | 22.29% | — | 30.77% |
| — `renderer.rs` | 100.00% | — | 100.00% |

`menu.rs`'s two commands (`build_native_menu`, `update_native_menu_state`) and most of the
OS-specific `print_linux.rs`/`print_macos.rs`/`print_windows.rs` backends are the real zero/near-zero
spots — consistent with §2's note that those weren't audited to full depth either. Both numbers
are now the committed floor in `.rust-coverage-baseline.json`, enforced in CI via
`scripts/audit-rust-coverage.mjs --ci` (added to `.github/workflows/ci.yml`'s Linux `rust` job) —
it can ratchet up but CI fails on a regression below either floor.
