# Plan — Robust Quit, Close & Application Shutdown Lifecycle

Status: **in progress** (M0 complete). Canonical audit: `docs/audits/lifecycle-current-state-2026-08-09.md`.
Decision record: `docs/adr/0216-termination-lifecycle-coordinator.md`.

## Goal

One authoritative termination coordinator in `packages/editor/src/lifecycle/`,
with native (Tauri) close/exit interception, revision-safe saving, coherent
unsaved-work dialogs, a clean-shutdown marker written only after completed
finalization, and capability-honest web behavior. All graceful termination
routes converge on the same data-integrity decision.

## Milestones

### M0 — Audit + plan (DONE, committed)
- Entry-point inventory, gap analysis, ADR-0216, this plan.

### M1 — Lifecycle core (`packages/editor/src/lifecycle/`) — pure TS, TDD
- `types.ts` — `TerminationIntent`, `TerminationScope`, phases,
  `QuitDocumentResolution`, diagnostics events.
- `coordinator.ts` — state machine (`idle → checking → awaiting-user →
  saving → finalizing → committed`), idempotent join + scope upgrade,
  cancel path, bounded finalization.
- `dirtyRegistry.ts` — derives unsaved docs from the editor session array;
  scope-aware collection (document/window/application).
- `savePlan.ts` — per-document resolution, per-session save dedup (mutex),
  revision-safe clean marking, Save As cancellation abort, failure taxonomy.
- `lifecycleMarker.ts` — clean-shutdown marker singleton (single reader,
  cached `beginRecoverySession` result; crash loop reads first).
- `global.ts` — module singleton accessors (`getLifecycleCoordinator`).
- Unit tests: state machine transitions, idempotence, scope upgrade, dirty
  registry scoping, save-plan revision races, Save As cancel, save failure,
  double-request, quit-during-save.

### M2 — React wiring + dialogs
- `LifecycleProvider.tsx` — mounts inside the editor (replaces the
  `RecoveryManager` import in `Shell.tsx` 1-for-1; renders RecoveryManager
  internally), installs the editor API on the coordinator, owns
  beforeunload/pagehide/visibilitychange (dynamic dirty-warning), writes the
  clean marker via the coordinator at commit.
- `useTerminationDialog.tsx` + dialog components — single-doc
  (Save/Don't Save/Cancel), multi-doc (checklist + Save Selected / Discard
  All / Cancel), save-failure (Cancel / Try Again / Save As / Discard),
  Save-As-cancelled handling; focus trap, Escape→Cancel, safe default focus,
  long-name truncation + full label, Untitled 1/2 disambiguation.
- `RecoveryManager.tsx` refactor — recovery dialog gating reads the
  centralized marker result; discard-at-commit only.
- Tests: dialog behavior, unload-warning registration, marker timing.

### M3 — Commands, menus, shortcuts
- Actions: `close-document`, `close-window`, `quit-app` in the ActionRegistry
  (route through coordinator); `tabClose` (Ctrl/Cmd+W) rerouted from
  native `confirm()` to the coordinator + shared dialog.
- File menu items: Close Document (Ctrl+W), Close Window (Ctrl+Shift+W),
  Quit (Ctrl+Q on non-mac; macOS keeps the native app-menu Quit).
- ShortcutManager bindings with platform conventions; no conflicts
  (verify against existing table).
- Tests: action dispatch, menu defs, shortcut routing.

### M4 — Native interception (Rust + desktop bridge)
- `apps/desktop/src-tauri/src/lifecycle.rs` — `on_window_event`
  `CloseRequested` (prevent + emit `varve://close-requested`, main window
  only), `on_run_event` `ExitRequested` (prevent + emit
  `varve://exit-requested`), one-shot approved-close token set, commands
  `approve_window_close(label)` / `approve_exit()`.
- `apps/desktop/src/lifecycle/nativeLifecycleBridge.ts` — subscribes to
  coordinator + Tauri events; forwards approved close/exit to Rust.
- Title-bar Close → `requestCloseWindow()` (coordinator) instead of
  `runWindowAction('close')`; windowActions keeps minimize/maximize only.
- Keep predefined macOS quit/close_window (they now route through the
  coordinator via Rust interception).
- Tests: Rust unit tests for token logic; Playwright for dialog; manual
  matrix for WM close/Alt+F4.

### M5 — Persistence + teardown hardening
- `usePersistence.ts` — revision-safe save (mark clean only if revision
  unchanged), `saveState` rendered in StatusBar.
- Export/print jobs cancel on commit (lifecycle event → existing
  AbortControllers); workers/bg jobs unaffected at process exit
  (documented); recovery flush awaited at commit (bounded).
- Tests: edit-during-save race, stale-save completion, save-failure blocks
  exit, export cancel on quit.

### M6 — Docs + final gates
- `docs/architecture/lifecycle-system.md` (final architecture), cross-platform
  verification matrix, exit-reason logging, README/AGENTS.md updates.
- Full gate: `pnpm format/typecheck/lint/test/audit:*`, `audit-architecture
  --ci`, `cargo fmt/clippy/test`.

## Constraints

- No new imports into `Shell.tsx`/`CanvasArea.tsx` (net-zero swap in Shell).
- No meaningful complexity added to `context.tsx` (833/847 ceiling) —
  coordinator consumes the existing editor API via `useEditor`.
- Follow the sub-context `onReady`/singleton patterns already used by
  `getSharedRecoveryManager`/`getActionRegistry`.
- Progressive commits per milestone; full gate before each commit.
