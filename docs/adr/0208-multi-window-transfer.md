# ADR-0208: Atomic panel transfer

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Detaching a panel from the primary sidebar to an auxiliary window (or
reattaching it) must be atomic: the panel must not be destroyed in the
source before the destination confirms readiness.

## Decision

D1 — Panel transfer follows a state machine:

```
IDLE → PREPARING_SOURCE → CREATING_DESTINATION → WAITING_READY
→ HYDRATING → ACKNOWLEDGED → COMMITTING → REMOVING_SOURCE → COMPLETE
```

Failure at any step rolls back to IDLE, restoring the source panel.

D2 — Transfer is guarded by a `transferTransactionId`. Only one transfer
   per panel instance is active at a time.

D3 — The source panel calls `prepareForTransfer()` to capture a bounded
   `PanelTransferSnapshot` (max 64 KiB). If the panel cannot serialize
   safely (active IME, open modal), the transfer is blocked with a reason.

D4 — The destination receives the snapshot, hydrates, and acknowledges.
   On acknowledgement, the layout is committed atomically and the source
   is deactivated.

D5 — On failure: source is restored, unused destination windows are closed,
   transfer state is cleared, and a recoverable error is shown.

## Consequences

- No orphaned panel instances.
- No data loss on transfer failure.
- Transfer is reversible.

## Migration impact

None — new transaction layer.

## Rejected shortcuts

- Unmount-then-remount (race condition, data loss).
- Optimistic transfer with rollback (too complex for panel state).
