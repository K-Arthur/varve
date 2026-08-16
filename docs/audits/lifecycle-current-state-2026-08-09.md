# Lifecycle Current-State Audit — Quit / Close / Exit / Shutdown (2026-08-09)

Phase 0 deliverable of the robust-quit program (see
`docs/plans/archived/quit-close-lifecycle.md`). Maps every termination entry point in
Varve as of 2026-08-09, before any implementation work.

## Executive summary

Varve has **no authoritative termination coordinator**. Every close path today
either (a) bypasses the webview entirely (macOS native predefined Quit /
Close Window items), (b) calls `getCurrentWindow().close()` directly from the
custom title bar, or (c) relies on browser `beforeunload`/`pagehide` semantics
that Tauri does not guarantee. Dirty-work protection therefore exists only:

- per-tab: `closeTab()` dirty guard + TabStrip dialog (or native `confirm()`),
- per-unload: RecoveryManager's `beforeunload` flush + browser prompt.

The core invariant ("never silently lose unsaved work because one exit path
bypassed another") is violated today by at least these paths:

1. macOS `Varve > Quit` (predefined `quit` item, Cmd+Q) — native `app.exit()`,
   webview never consulted, no flush, no clean marker.
2. macOS `Window > Close Window` (predefined `close_window`, Cmd+W) — native
   window close, webview never consulted.
3. Custom title-bar X (Linux custom chrome) — direct `window.close()`.
4. Alt+F4 / WM close — no native interception, no frontend veto.
5. Window service `onCloseRequested` — emit-only bookkeeping, never
   `preventDefault()`.

## Entry-point inventory

### Native (Tauri) — `apps/desktop/src-tauri/src/lib.rs`

| Entry point | Mechanism | Guards | Verdict |
|---|---|---|---|
| macOS App > Quit (Cmd+Q) | Predefined menu item → `app.exit()` (menu.rs:157 `b.quit()`) | None | **Bypasses webview** |
| macOS Window > Close (Cmd+W) | Predefined `close_window` (menu.rs:170) | None | **Bypasses webview** |
| Alt+F4 / WM close / X | OS close → `CloseRequested` | None | **No interception** (no `on_window_event`) |
| `close_splashscreen` | Custom command, startup only | — | N/A |
| App exit anywhere | `app.exit(0)` (lib.rs:120, spike only) | None | N/A |

`run()` (lib.rs:2384-2605) registers **no** `on_window_event`, **no**
`on_run_event`, and no `CloseRequested`/`ExitRequested`/`RunEvent` handling.

### Frontend — `apps/desktop/src`

| Entry point | File:line | Guards | Verdict |
|---|---|---|---|
| Title-bar Close button | `chrome/TitleBar.tsx:67-74` → `runWindowAction('close')` → `windowActions.ts:43` `getCurrentWindow().close()` | Rapid-click in-flight guard only | Direct native close |
| Minimize/Maximize | `windowActions.ts` | — | Fine |
| Back to Home | `App.tsx:167-169` (`setView('home')`) | **None** | Dirty docs silently hidden, never prompted |
| Resume Editing | `App.tsx:171-174` | — | Editor stays mounted (`display:none`) |

### Editor — `packages/editor/src`

| Entry point | File:line | Guards | Verdict |
|---|---|---|---|
| Tab close button / Delete / middle-click | `TabStrip.tsx:67-73` → `closeTab()` dirty guard (context.tsx:8671-8673) | TabStrip dirty dialog (Save/Don't save/Cancel, TabStrip.tsx:210-247) | Correct UX, tab-scoped |
| Ctrl/Cmd+W (`tabClose`) | `actions/createActionHandlers.ts:522-529` | **native `confirm()`** | Inconsistent with TabStrip dialog; no coordinator |
| Save / Save As | `context/usePersistence.ts:52-105, 257-294` | `saveState` transition | `saveState` never rendered; **not revision-safe** (marks clean even if edits landed mid-save) |
| Dirty tracking | Per-session `sessions[].dirty` + global `state.dirty` (context.tsx:2746,2752) | — | Authoritative registry exists (sessions array) |
| `beforeunload` / `pagehide` / `visibilitychange` | `components/Shell/RecoveryManager.tsx:70-99` | Flush via `lifecycleFlush.ts` (dedup + revision check) + `preventDefault` | Good dedup; browser-only, not native-authoritative |
| Clean marker `strata-clean-shutdown` | `RecoveryManager.tsx:37-43` (write 'true'); `lifecycleFlush.ts:55-63` (`beginRecoverySession` write 'false') | — | Marker only as reliable as `beforeunload`; macOS Quit never writes it |
| Crash-loop detection | `crash/crashController.ts:190-207` reads marker via App.tsx:208 | StrictMode-guarded | OK |
| Autosave | `autoSaveService.ts` (5 min interval, 1 s poller) | Retries ×3, recovery point on success | Stopped only on editor unmount |
| Backup | `backupService.ts` (5 min interval, 60 s tick) | Retention | `snapshotOnClose` flag declared but **never invoked** |
| Recovery snapshots | `recovery.ts` (IndexedDB `varve-recovery`, max 20, 7-day TTL) | Written on autosave; deleted on save/restore/discard | OK |
| Exports | `exportService.ts:399-488` (`AbortSignal`-aware) | ExportDialog owns `AbortController` | Cancellable; no quit-time hook |
| Workers | `render/workerHost.ts` (terminate on CanvasArea unmount), brush worker, bg-remove pool (`terminateWorkerPool`), upscale/trace native jobs (cancel flags), thumbnail queue (`shutdown()`) | Unmount paths only | No quit-time teardown (process-exit reclaims; acceptable except in-flight writes) |

### Platform — `packages/platform/src`

- `Platform` interface (platform.ts:39-289) has **no close/quit/window method**.
  Window control is a separate `NativeWindowService` port
  (`windows/types.ts:111-129`).
- `windows/tauri.ts:390-394` `onCloseRequested` — **emit-only**, no
  `preventDefault`.
- Disk writes: `home_write_text_file`/`write_binary_file` → Rust
  `write_file_atomic` (lib.rs:233-261: temp + `sync_all` + rename) — **atomic**. 
- `saveDocumentToDisk` (tauri.ts:568-582) = dialog + atomic text write. 
- SQLite `save_document` (varve-sync lib.rs:167-177) — atomic single statement;
  `save_document_with_file` explicit transaction.

### Menu system — `packages/editor/src/menu`

- In-app menubar (Menubar.tsx) routes through the shared ActionRegistry.
- Native menu: **macOS only** (`useNativeMenu.ts:36-41`); `nativeAdapter.ts`
  builds App menu with **predefined `quit`** (nativeAdapter.ts:243) and Window
  menu with **predefined `close_window`** (nativeAdapter.ts:258).
- `menu://action` events (lib.rs:2464-2469 → useNativeMenu.ts:80-88) only fire
  for **app-owned** items — predefined items never reach the registry.
- **No `close-document`, `close-window`, or `quit` command exists** in the
  File menu (defs.ts File menu: new/open/save/saveAs/import/export/settings…).

### Shortcuts — `packages/editor/src/shortcuts/ShortcutManager.ts`

- `tabClose` Ctrl/Cmd+W (ShortcutManager.ts:231) → `tabClose` action.
- **No quit binding.** `home` Ctrl+Shift+H (View menu).

### Auxiliary windows — `packages/editor/src/auxiliary`

- Separate `WebviewWindow`s (`?surface=panel-window`), session transport to
  primary; `beforeunload` sends `window-close` (AuxiliaryProvider.tsx:181-184);
  auto-close on reattach (AuxiliaryShell.tsx:201-205). No document state of
  their own (ADR-0211 D1).

### Web

- `apps/web` is a stub; the desktop bundle (apps/desktop) is shared.
- Browser protection = RecoveryManager handlers + browser `beforeunload`
  prompt; no custom dialogs.

## Gap summary (maps to plan milestones)

| # | Gap | Milestone |
|---|---|---|
| G1 | No TerminationIntent/scope model; one vague `close()` | M1 |
| G2 | No coordinator; entry points disagree | M1 |
| G3 | Native close/exit never intercepted (Rust) | M4 |
| G4 | Predefined quit/close_window bypass webview | M4 |
| G5 | Title-bar close bypasses checks | M4 |
| G6 | No Close/Quit menu commands or shortcuts | M3 |
| G7 | Ctrl+W uses native confirm() instead of dialog | M3 |
| G8 | Save not revision-safe; saveState unused in UI | M5 |
| G9 | Back-to-Home never prompts; dirty hidden sessions unaccounted in quit | M1/M3 |
| G10 | Clean marker not tied to completed finalization | M2 |
| G11 | No quit-time job cancellation hook | M5 |
| G12 | `snapshotOnClose` unwired | M5 (documented; deferred) |

## What already works (do not break)

- Atomic file writes and SQLite transactions (crash-safe persistence).
- Per-session dirty metadata + snapshot store (`sessionStoreRef`).
- Flush dedup + revision check in `lifecycleFlush.ts`.
- Recovery snapshot lifecycle (create on autosave, delete on save/discard).
- Crash-loop detection and safe mode.
- TabStrip dirty dialog UX (Save/Don't save/Cancel).
- ADR-0211 decisions (aux windows close freely; primary close = full session;
  macOS hide-on-close) — adopted as requirements.
