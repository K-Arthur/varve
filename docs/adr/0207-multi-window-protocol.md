# ADR-0207: Cross-window session protocol

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Auxiliary windows communicate with the primary window through a typed
protocol. The protocol must be versioned, validated, idempotent, and
secure.

## Decision

D1 — Every message is a `SessionEnvelope<TPayload>`:

```ts
interface SessionEnvelope<TPayload> {
  protocolVersion: number;
  sessionId: string;
  senderWindowId: string;
  eventId: string;
  sequence: number;
  sentAt: number;
  documentRevision?: number;
  target?: 'all' | 'primary' | WorkspaceWindowId;
  payload: TPayload;
}
```

D2 — Protocol versions are monotonic. Unknown versions are rejected.
   Version mismatches trigger a `protocol-mismatch` event and
   resynchronization.

D3 — Messages are validated against a schema registry. Invalid payloads,
   wrong session IDs, spoofed window IDs, and duplicate sequence numbers
   are rejected.

D4 — Transport is platform-specific:
   - Tauri: `window.__TAURI__.event` (inter-webview IPC)
   - Browser: `BroadcastChannel` with fallback to `localStorage` events
   - Memory: direct function calls (tests)

D5 — Heartbeat liveness: auxiliary windows send `heartbeat` every 5s.
   Primary marks a window as disconnected after 15s without heartbeat.

## Consequences

- Protocol is testable with the memory transport.
- Security validation catches spoofing and replay.
- Heartbeat enables crash detection.

## Migration impact

None — new protocol layer.

## Rejected shortcuts

- Raw `postMessage` without envelope (no versioning, no validation).
- `BroadcastChannel` only (no Tauri inter-webview support).
