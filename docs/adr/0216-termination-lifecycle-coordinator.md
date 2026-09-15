# ADR-0216: Termination lifecycle coordinator

- **Status:** Accepted
- **Date:** 2026-08-09
- **Supersedes/refines:** ADR-0211 (D2/D3 semantics adopted as requirements)

## Context

Varve has no authoritative termination path. Native macOS Quit/Close Window
items bypass the webview; the custom title-bar close calls the window API
directly; `beforeunload` is the only dirty-work guard, which Tauri does not
guarantee on desktop. The invariant — *never silently lose unsaved work
because one exit path bypassed another* — requires one coordinator that all
graceful termination requests converge on.

## Decision

### D1 — One coordinator, one state machine

A framework-free `TerminationCoordinator` in `packages/editor/src/lifecycle/`
owns every graceful termination request. Presentation components, menus,
shortcuts, and the native bridge never decide independently whether user data
can be destroyed; they call `requestTermination(intent, context)`.

States: `idle → checking → awaiting-user → saving → finalizing → committed`,
plus `cancelled` (back to `idle`). Termination is **idempotent**: a second
request during an active transaction joins it (upgrading scope when the new
intent is broader, e.g. close-document followed by quit-application), and
never opens a second dialog or starts a second save.

### D2 — Termination intents are explicit

```ts
type TerminationIntent =
  | 'close-document'   // close the active document/tab
  | 'close-window'     // close the native window and its documents
  | 'quit-application' // close all windows, terminate the process
  | 'reload'           // browser reload / native webview reload
  | 'restart'          // app restart (update flow reuses the guard)
```

`close-document` on the last tab resolves to back-to-Home (existing behavior),
never to quit. Back-to-Home intentionally preserves the editor for Resume
Editing; quitting from Home inspects all sessions, visible or hidden.

### D3 — Dirty registry is the editor's session array

`state.sessions[]` is the authoritative dirty registry (per-session `dirty`
metadata, snapshot store keyed by session id). The coordinator derives
`getUnsavedDocuments()` from it — never from undo-stack length, document
identity, or autosave timing. Scope rules:

- close-document: the active session only.
- close-window: sessions owned by this window (all, today).
- quit-application: all sessions, regardless of visible view.

A recovery snapshot does **not** make a document clean (§16 of the program):
dirty + snapshot still counts as unsaved work for intentional termination.

### D4 — Save plan is revision-safe and deduplicated

Each dirty document resolves to `saved | discarded | cancelled | failed`.
Saves are deduplicated per session (one write at a time), and a save records
the revision it persisted: after a successful write, the document is marked
clean **only if** its current revision equals the saved revision. If the user
edited during the save, the document stays dirty and the plan re-evaluates
(bounded auto-retry, no duplicate prompts for a resolution the user already
gave).

Save As cancellation, save failure, and serialization failure all abort the
termination transaction unless the user explicitly discards the document.

### D5 — Native interception is authoritative

Rust intercepts `WindowEvent::CloseRequested` (prevent + ask the webview)
and `RunEvent::ExitRequested` (prevent + ask the webview) for the `main`
window. Auxiliary windows close freely (ADR-0211 D1 — they own no document
state). Approved closes use a one-shot, per-window token:

```
close requested → prevent → coordinator approves → markNativeCloseAuthorized(label)
→ close() → second CloseRequested sees token → allow
```

The token is scoped to the correct window, consumed exactly once, and set
before `close()` is called, so the interception cannot recurse.

Predefined `quit` (macOS Cmd+Q) and `close_window` (macOS Cmd+W) items are
**retained** — they preserve native appearance/accelerator conventions and
now route through the coordinator via the Rust interception above. New
app-owned `close-document` / `close-window` / `quit-app` commands join the
action registry, File menu, and shortcut table on all platforms.

### D6 — Clean-shutdown marker is written only at the end

`strata-clean-shutdown = 'true'` is written only after the coordinator reaches
`committed` **and** all required finalization completed (saves resolved,
recovery flush drained). A quit that started but crashed mid-save remains
unclean. Intentional discard deletes the corresponding recovery snapshot only
at commit — never when a dialog merely opens.

### D7 — Browser behavior is capability-honest

The web layer never awaits a save in `beforeunload`. Instead: autosave +
recovery run continuously; `beforeunload` registration is dynamic (warn only
when genuinely unsaved work exists; no warning when clean); `pagehide` and
`visibilitychange` flush best-effort with dedup.

### D8 — Ownership and scope

| Scope | Released on |
|---|---|
| Document session | close-document (existing snapshot store) |
| Window | close-window (per-window session registry, future multi-window) |
| Application | quit-application (all sessions) |

A small finalizer registry lets commit-phase steps await bounded critical work
(recovery flush) and cancel optional work (exports) with deadlines. Optional
network/background work never blocks quit indefinitely.

## Consequences

- Every graceful termination path converges on one data-integrity decision.
- macOS conventions preserved (Cmd+Q/Cmd+W, hide-on-last-close).
- No duplicate dialogs, no double saves, no clean-marker lies.
- Native layer cannot be bypassed by menu/shortcut/OS paths.

## Migration impact

- New module: `packages/editor/src/lifecycle/` (no context.tsx/Shell.tsx
  hub growth; Shell swaps `RecoveryManager` import for `LifecycleProvider`,
  a 1-for-1 import exchange).
- New Rust lifecycle module in `apps/desktop/src-tauri/src/`.

## Cross-platform implications

| Platform | Quit trigger | Route |
|---|---|---|
| Linux (CachyOS) | custom X, Alt+F4, WM close, File > Quit (Ctrl+Q) | native CloseRequested → coordinator → token |
| Windows | X, Alt+F4, taskbar Close, File > Quit | same |
| macOS | Cmd+Q, app menu Quit, red close, Cmd+W | ExitRequested/CloseRequested → coordinator → token |
| Web | reload/nav/tab close | dynamic beforeunload + best-effort flush |

Forced termination (SIGKILL, OS shutdown) is protected by autosave +
recovery + atomic writes, never by dialogs.

## Rejected shortcuts

- Frontend-only close interception (JS `onCloseRequested`) as the sole guard —
  a hung webview would let the OS close proceed unchecked; Rust is authoritative.
- `beforeunload → await save()` (cannot complete; recovery durability instead).
- One global `close()` alias for all intents (scopes differ).
- Replacing predefined macOS items with app-owned ones (loses native look;
  interception already routes them through the coordinator).
