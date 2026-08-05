# ADR-0136: Auxiliary-window recovery

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Auxiliary windows can crash, reload, fail hydration, or lose the broker.
The primary window can also reload. Recovery must never corrupt the
document, duplicate panels, or reopen crashing windows in a loop.

## Alternatives

1. Auto-reopen every dead window forever — rejected (crash loops).
2. Generation-based registration with last-known-good layout fallback and
   a crash-loop breaker (chosen).

## Decision

- **Window generations:** every `WINDOW_READY` after a reload registers a
  fresh `senderGeneration`; the broker rejects all messages from older
  generations (ADR-0128) and sends a fresh snapshot (ADR-0129) — reload
  never duplicates panel instances because instances are broker-assigned
  and re-validated against the layout on registration.
- **Auxiliary crash/disappear:** heartbeat timeout (10 s) marks the
  window's panels orphaned (not lost): layout keeps their instances,
  panel-local snapshots are retained broker-side, focus ownership is
  cleared, in-flight transfers involving the window are cancelled
  (ADR-0134), and a recovery banner offers automatic safe reattachment to
  the primary or to a new window.
- **Primary broker reload:** new registration round; the session
  re-hydrates from its own storage (BackupService/RecoveryManager,
  `context.tsx:2355-2359`); auxiliaries detect broker loss via heartbeat
  gap and enter a "waiting for session" state with a recoverable error
  screen rather than shutting down silently.
- **Failed hydration:** startup timeout (default 10 s) → error screen with
  retry; two consecutive failures for the same window in one session mark
  it bad and offer the safe single-window layout instead of reopening
  (crash-loop breaker: exponential backoff, max 3 attempts).
- **Last-known-good:** the layout store persists a last-known-good layout
  + restore-attempt marker; after repeated failure the app boots in the
  safe built-in single-window layout and explains what was recovered.
- The existing per-window BackupService semantics are unchanged; the
  broker adds only window-level liveness on top.

## Consequences

- A dead auxiliary window never loses a panel permanently; the document
  session is never taken down by a panel window crash.
- Safe-mode flags already declared in `packages/crash/src/safeMode.ts`
  (`skipWorkspaceRestore`, `resetWindowLayout`) gain real consumers.

## Migration impact

Safe-mode flags become functional (M11).

## Cross-platform implications

WebKitGTK crash behavior (page reload vs process death) differs from
WebView2/WKWebView; the heartbeat + generation model is transport-agnostic
and covers all.

## Security implications

Generation checks prevent stale-window replay; re-registration requires a
valid session id; crash reports use opaque ids (privacy).

## Accessibility implications

Recovery states announce corrective actions ("Layers panel recovered to
Window 1"); safe-mode boot explains what was lost and what was kept.

## Performance implications

Heartbeats are cheap (10 s interval); crash-loop breaker bounds reopen
cost; recovered windows resync via snapshot, not replay of all history.

## Rejected shortcuts

Auto-reopen loops; treating reload as a new panel instance;
reconstructing panel-local state from the last message only.
