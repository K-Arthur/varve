# Lifecycle System — Quit, Close, Exit & Shutdown Architecture

Canonical decisions: `docs/adr/0216-termination-lifecycle-coordinator.md`.
Audit baseline: `docs/audits/lifecycle-current-state-2026-08-09.md`.
Plan: `docs/plans/archived/quit-close-lifecycle.md` (complete; archived 2026-08-16).

## Invariant

> Varve must never silently lose unsaved user work because one exit path
> bypassed another. No presentation component, native menu item, keyboard
> shortcut, OS window event, restart command, or browser lifecycle event may
> independently decide that user data is safe to destroy.

"Quit requested" never means "shutdown is clean". Only: required user data
resolved + required persistence committed + recovery/session state
reconciled + finalization complete = clean shutdown.

## Architecture

```
        USER / OS TERMINATION REQUEST
                   │
    ┌──────────────┼───────────────┐
    │              │               │
    ▼              ▼               ▼
TitleBar X    File menu/Shortcuts  OS event (Alt+F4, WM close, Cmd+Q,
    │          (tabClose/close-     Cmd+W, macOS quit, taskbar close)
    │           Window/quitApp)        │
    │              │               Rust LifecycleGuard prevent + emit
    │              │               (varve://close-requested / exit-requested)
    └──────────────┼───────────────────┘
                   ▼
       TerminationCoordinator (packages/editor/src/lifecycle)
        idle → checking → awaiting-user → saving → finalizing → committed
                              ↘ cancelled
                   │
                   ▼
           collect dirty docs (per scope)
                   │
          ┌────────┴────────┐
          │                 │
      no dirty           unsaved
          │                 │
          ▼                 ▼
      commit ────◄──  user resolution (Save / Discard / Cancel)
          │           │      │
          │           ▼      └── resume (cancelled)
          │      revision-safe
          │      save plan
          │           │
          └───────────┴──────────► TERMINATION COMMIT
                                     │
                         finalizers (bounded, abortable)
                         recovery cleanup for discards
                         mark CLEAN SHUTDOWN (only now)
                         native/browser terminate via one-shot tokens
```

## Modules

### `packages/editor/src/lifecycle/` (platform-neutral core)

| File | Role |
|---|---|
| `types.ts` | `TerminationIntent`, phases, `QuitDocumentResult`, `EditorLifecycleApi`, diagnostics events |
| `coordinator.ts` | State machine; idempotent join + scope upgrade; dialogs; commit; marker timing |
| `dirtyRegistry.ts` | Scope-aware unsaved-doc collection from the session array; Untitled 1/2 naming |
| `savePlan.ts` | Per-document revision-safe saves; Save-As-cancel aborts; failure taxonomy |
| `finalizers.ts` | Bounded, abortable commit-phase cleanup (5 s deadline) |
| `lifecycleMarker.ts` | Browser `strata-clean-shutdown` singleton (read once, write at commit only) |
| `global.ts` | `getLifecycleCoordinator()`, finalize-handler registry, `LIFECYCLE_COMMIT_EVENT` |
| `LifecycleProvider.tsx` | React host: editor API wiring, unload handlers, marker, dialogs, recovery |
| `TerminationDialogHost.tsx` | Single-doc / multi-doc / save-failed dialogs (native `<dialog>`) |

### Desktop bridge (`apps/desktop/src/lifecycle/`, `src-tauri/src/lifecycle.rs`)

| File | Role |
|---|---|
| `lifecycle.rs` | `LifecycleGuard` one-shot tokens; `CloseRequested`/`ExitRequested` prevent + emit; `approve_window_close` / `approve_exit` commands |
| `nativeLifecycleBridge.ts` | Listens for native events → coordinator; approves close/exit at commit; no-coordinator fallback approves immediately |
| `requestCloseWindow.ts` | Title-bar close: coordinator first, raw close only when no editor mounted |

## Termination intents

| Intent | Scope | Final action |
|---|---|---|
| `close-document` | active session | close tab (last tab → Home) |
| `close-window` | all sessions | macOS: close window (app stays). Linux/Windows: exit (last-window convention) |
| `quit-application` | all sessions | native exit (Linux/Windows/macOS) |
| `reload` / `restart` | all sessions | same save guard; platform action at commit |

## Key behaviors

- **Idempotence**: duplicate requests join the active transaction; broader
  intents upgrade the scope mid-dialog (the pending dialog is superseded and
  re-presented with the wider document set). One dialog, one save per doc.
- **Dirty authority**: `state.sessions[]` (per-session `dirty`) — never undo
  stack length, identity, or autosave timing. Hidden sessions and Home view
  count.
- **Revision safety**: a save marks clean only if the document is still at
  the saved revision; a revision race re-saves (bounded) or fails as
  `conflict`. A quit during Ctrl+S joins the existing save.
- **Save As cancellation aborts the transaction** — never interpreted as
  discard. Save failures block termination until resolved (retry / save-as /
  discard / cancel).
- **Discard commits recovery cleanup**: `deleteRecoveryForTab` removes the
  discarded tab's recovery points only at commit (fileId-precise; unique-name
  untitled; duplicate untitled kept). Discarded edits never reappear as
  crash recovery.
- **Clean marker**: native termination writes it only after finalizers complete.
  On the web, a non-bfcache `pagehide` may mark a clean session only when the
  coordinator is idle or committed and no document is dirty; an active
  transaction or dirty session stays unclean. A crash mid-quit remains
  recoverable. **Crash-loop classification reads the same marker with
  evidence-only rules** (`readUncleanShutdownMarker`): only an explicitly
  armed, never-finalized `'false'` counts as an interrupted run — an absent
  marker is a fresh profile or a surface that never mounts the lifecycle
  (Home), and a failed storage read proves nothing, so neither can accrue
  startup failures or open safe mode (audit 2026-09-27 §7.4,
  `tests/e2e/crash/safe-mode-counter.spec.ts`).
- **Native recovery authority**: desktop startup reads the prior process result
  from `view_state[app-setting:native-clean-shutdown]`, then commits `false`
  before the webview starts. When upgrading from a release without that native
  key, `RecoveryManager` and `CrashCenter` fall back to the prior WebView marker
  captured before the current run is armed; this preserves clean upgrades and
  clears stale crash-loop counts from older releases. Once a native value
  exists, it is authoritative. An unavailable IPC read remains unclean for
  crash-loop tracking and preserves recovery sessions. The cached result is
  stable for React effect replay in one webview; a later webview reload in the
  still-running process is treated as unclean. After a coordinator-approved
  app exit, Rust commits `true` to the same SQLite store before approving the
  exit token. A Home-only exit keeps the marker unclean because Home has no
  editor coordinator to reconcile recovery sessions. Verified updater restarts
  set the marker clean before relaunch and re-arm it unclean if relaunch fails.
  Web builds continue using localStorage.
- **Native authority**: Rust prevents close/exit, asks the webview; one-shot
  per-window tokens prevent recursion. Auxiliary windows close freely
  (ADR-0211 D1).
- **Web honesty**: beforeunload warns only when genuinely unsaved work
  exists (dynamic registration); pagehide/visibilitychange flush best-effort;
  no `await save()` during unload — autosave + recovery are the durability
  layer.
- **Bounded finalization**: export/print jobs abort at commit
  (`LIFECYCLE_COMMIT_EVENT`); optional finalizers have deadlines; critical
  document saves are never timeout-truncated.
- **Forced termination** (SIGKILL, OS shutdown) is protected by autosave +
  recovery + atomic writes (`write_file_atomic`, SQLite transactions), never
  by dialogs.

## Cross-platform matrix (2026-08-09)

| Action | Linux (CachyOS) | Windows | macOS | Web |
|---|---|---|---|---|
| Close document (Ctrl/Cmd+W, tab X) | Coordinator dialog | Coordinator dialog | Coordinator dialog (native Cmd+W → CloseRequested) | Coordinator dialog |
| Close window button (custom title bar) | Coordinator → exit | Coordinator → exit | Coordinator → close window (app stays) | n/a |
| Alt+F4 / WM close / taskbar close | Rust intercept → coordinator | Rust intercept → coordinator | Rust intercept → coordinator | n/a |
| Quit menu / Cmd+Q | File > Quit Varve (Ctrl+Q) | File > Quit Varve (Ctrl+Q) | Native app menu Quit → ExitRequested → coordinator | n/a |
| Cmd+W (macOS) | n/a | n/a | Window > Close Window → CloseRequested → coordinator | n/a |
| Dirty warning | Coordinator dialog | Coordinator dialog | Coordinator dialog | beforeunload prompt (dirty only) |
| Save failure blocks exit | Yes (dialog) | Yes (dialog) | Yes (dialog) | Yes (dialog) |
| Clean marker | After finalization | After finalization | After finalization | After finalization; otherwise a clean non-bfcache pagehide with no dirty work |
| Recovery after forced crash | Yes (IndexedDB) | Yes | Yes | Yes |
| Back to Home with dirty docs | Allowed — editor stays mounted; quit still sees all sessions | same | same | same |

Cells marked "n/a" mean the platform convention does not route that gesture.

## Session restore vs crash recovery

- Crash recovery: shown only when the previous run was unclean
  (`strata-clean-shutdown !== 'true'`) and recovery points exist.
- Session restore (open documents/geometry) is a separate concern; the
  lifecycle layer persists only legitimate session state, never transient
  dialog/drag state.
- Discarded documents have their recovery points removed at commit, so an
  intentional discard never resurfaces as crash recovery.

## Diagnostics

Dev-only structured trace (`console.debug`):
`termination.request → scope → dialog → dialog-resolved → save.start/finish →
finalize → clean-marker → commit | cancel`. Never document contents.

## Exit reasons (local only)

The clean marker distinguishes clean vs crash; fine-grained exit reasons
(`clean-user-quit` / `clean-update-restart` / `os-shutdown`) are reserved for
a future local log — never transmitted without crash-reporting consent.

## Known deferred items

- `usePersistence` revision-safe marking + saveState UI: superseded by the
  coordinator's revision re-checks; the concurrent save-system refactor
  (`persistence/saveCoordinator`) owns the final shape.
- `snapshotOnClose` backup flag remains unwired.
- Real multi-window: the coordinator already scopes by window; wiring a
  per-window session registry is additive.
