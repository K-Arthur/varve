# Plan — Robust Quit, Close & Application Shutdown Lifecycle

Status: **complete** (M0–M6; M5 partially deferred by a concurrent
save-system refactor). Canonical audit:
`docs/audits/lifecycle-current-state-2026-08-09.md`. Decision record:
`docs/adr/0216-termination-lifecycle-coordinator.md`. Final architecture:
`docs/architecture/lifecycle-system.md`.

## Milestones

### M0 — Audit + plan (DONE)
Entry-point inventory, gap analysis, ADR-0216, this plan.

### M1 — Lifecycle core (DONE)
`packages/editor/src/lifecycle/`: coordinator state machine (idempotent join
+ scope upgrade), dirty registry (per-intent scope, Untitled disambiguation),
revision-safe save plan (Save-As-cancel abort, failure taxonomy, conflict
retry bound), ShutdownMarker singleton, finalizer registry with deadlines.
40 unit tests.

### M2 — React wiring + dialogs (DONE)
`LifecycleProvider` (mounts in Shell, 1-for-1 RecoveryManager import swap),
single-doc / multi-doc / save-failed dialogs, dynamic unload protection,
discard-committed recovery cleanup, `deleteRecoveryForTab`. 51 lifecycle
tests.

### M3 — Commands, menus, shortcuts (DONE)
`tabClose` (Ctrl/Cmd+W) routed through the coordinator; new `closeWindow`
(Ctrl+Shift+W) and `quitApp` (Ctrl+Q) actions; File menu items in defs.ts +
in-app Menubar (Quit hidden on macOS); menu snapshots updated.

### M4 — Native interception (DONE)
Rust `lifecycle.rs`: one-shot per-window close + exit tokens; CloseRequested
/ ExitRequested prevented and forwarded to the webview; auxiliary windows
close freely. `nativeLifecycleBridge` routes native events through the
coordinator and approves at commit (macOS close-window keeps the app
running; Linux/Windows exit; quit/restart exit). Title-bar close uses
`requestCloseWindow()`. 4 Rust + 5 bridge tests.

### M5 — Persistence + teardown hardening (DONE, partially deferred)
Export/print jobs abort at commit via `LIFECYCLE_COMMIT_EVENT` finalizer.
The revision-safe save in `usePersistence` was **deferred**: a concurrent
save-system refactor owns that file; the coordinator's revision re-checks
already enforce save-race safety. `saveState` UI and failure classification
fold into the same deferred work.

### M6 — Docs + final gates (DONE)
`docs/architecture/lifecycle-system.md` (architecture + cross-platform
matrix), this status, AGENTS.md lifecycle section. Gates run on the
`feat/lifecycle` worktree branch.

## Deferred (tracked)

| Item | Reason | Where |
|---|---|---|
| Revision-safe `usePersistence.save` + `saveState` UI | concurrent saveCoordinator refactor owns the file | `packages/editor/src/context/usePersistence.ts` |
| Structured save-failure classification from platform errors | same refactor | `getLastSaveFailure` (currently 'unknown') |
| `snapshotOnClose` backup flag | pre-existing, unwired | `backupService.ts` |
| Per-window session registry (true multi-window) | additive; coordinator is window-scoped already | future ADR |
| Exit-reason log (clean-user-quit / os-shutdown) | reserved, local-only | future |
| E2E: Playwright dialogs + native lifecycle harness | browser E2E can cover dialogs; native exit needs a Tauri harness | `tests/e2e/` |

## Gate results (feat/lifecycle worktree, 2026-08-09)

- Editor lifecycle tests: 51 pass (41 + dialog host).
- Editor context/TabStrip/Shell/recovery/menu suites: pass.
- Desktop bridge tests: 5 pass; desktop typecheck clean.
- Rust: `cargo test --lib` 71 pass (incl. 4 lifecycle guard tests);
  clippy clean on new modules (pre-existing warnings elsewhere).
- Biome clean on all touched files.
- Repo-wide gates (format/typecheck/audit:*) are run by the coordinator
  after merge to master (concurrent WIP in the main tree blocks clean
  full-repo runs).
