# ADR-0128: Cross-window protocol

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

WebViews are isolated JS contexts with no shared memory. The app has no
event bus (only module-scope function pointers, `context.tsx:23-67`) and no
`BroadcastChannel` usage. A cross-window protocol must be typed, versioned,
secure, and testable without real windows.

## Alternatives

1. BroadcastChannel only — rejected: no lifecycle authority, no startup
   ordering, no validation, unreliable in browsers, no crash recovery.
2. Rust broker holding all session state — rejected (ADR-0122).
3. **Hybrid: TypeScript session broker in the primary window + Tauri event
   transport, with Rust as the registry/liveness relay** (chosen).

## Decision

- `SessionEnvelope<TPayload>` carries: `protocolVersion` (v1), `sessionId`,
  `senderWindowId`, `senderGeneration`, `eventId` (uuid), `sequence`
  (monotonic per window-generation), `sentAt` (diagnostics only),
  `documentRevision` (when relevant), `target` (`'broker'` | windowId |
  `'broadcast-panels'`), `kind` (typed union), `payload`.
- Message kinds: `WINDOW_READY`, `WINDOW_HYDRATED`, `SNAPSHOT_REQUEST`,
  `SNAPSHOT`, `PATCH`, `COMMAND_SUBMIT`, `COMMAND_ACK`, `COMMAND_REJECT`,
  `RESYNC_REQUEST`, `TRANSFER_BEGIN/ACK/COMMIT/ABORT`, `HEARTBEAT`,
  `WINDOW_CLOSING`, `GENERATION_RESET`.
- Broker (primary window, `packages/editor/src/workspace/session/broker.ts`)
  owns: registration, heartbeat/liveness, snapshots, patch fan-out,
  command routing to the canonical provider, transfer transactions,
  focus tracking, protocol-version negotiation, diagnostics.
- Transport adapters: `tauriEventTransport` (primary emits
  `ws://session` events via `window.__TAURI__.event.emit`, each window
  listens and filters by sessionId + target), `broadcastChannelTransport`
  (browser fallback), `memoryTransport` (tests).
- Rejections enforced broker-side: unknown protocol version, invalid
  payload schema (JSON-schema-style runtime validators), wrong sessionId,
  unknown/closed sender, stale generation, duplicate eventId,
  out-of-sequence updates, oversized payloads (bounded envelope), and
  messages targeting closed windows.
- Every mutation `COMMAND_SUBMIT` carries `expectedRevision` where
  applicable; the broker rejects stale mutations and triggers RESYNC
  (ADR-0129/0025).

## Consequences

- All cross-window traffic is auditable and fuzzable (ADR-0147).
- The protocol is transport-agnostic; the same broker logic runs on
  desktop, browser fallback, and tests.

## Migration impact

Protocol v1 is new; no existing messages to migrate. `protocolVersion`
enables future upgrades with rejection of mismatched versions.

## Cross-platform implications

Tauri `emit`/`listen` work on all OSes; WebKitGTK event delivery is
per-window and label-scoped; browser fallback uses BroadcastChannel with
the same envelope schema.

## Security implications

Every envelope is untrusted input (ADR-0145); the broker validates sender
registration, generation, and payload schemas before dispatch; session ids
are opaque uuids not derivable from document names.

## Accessibility implications

Focus/announcement messages are typed messages, so screen readers in the
receiving window get the same guarantees as the primary.

## Performance implications

Sequence numbers and revisions enable gap detection (ADR-0129); heartbeat
is throttled (e.g. 10s); diagnostics counters (duplicate/stale dropped
messages) are non-PII.

## Rejected shortcuts

BroadcastChannel as the only mechanism; untyped JSON blobs; message
formats without version/session/window identity.
