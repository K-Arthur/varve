/**
 * Cross-window session protocol (ADR-0207).
 *
 * Typed, versioned protocol for communication between the primary window
 * (session authority) and auxiliary panel windows. Every message is a
 * `SessionEnvelope` with validation, sequencing, and idempotency.
 *
 * Transport is abstracted — the protocol module doesn't know whether
 * messages go through Tauri IPC, BroadcastChannel, or direct calls.
 */

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type SessionMessageTarget = 'all' | 'primary' | string; // string = window id

export interface SessionEnvelope<TPayload> {
  protocolVersion: number;
  sessionId: string;
  senderWindowId: string;
  eventId: string;
  sequence: number;
  sentAt: number;
  documentRevision?: number;
  target?: SessionMessageTarget;
  payload: TPayload;
}

// ---------------------------------------------------------------------------
// Payload types — registration
// ---------------------------------------------------------------------------

export interface WindowRegisterPayload {
  kind: 'window-register';
  windowId: string;
  windowLabel: string;
  role: 'primary' | 'auxiliary-panel' | 'document-view';
  capabilities: string[];
}

export interface WindowReadyPayload {
  kind: 'window-ready';
  windowId: string;
}

export interface WindowClosePayload {
  kind: 'window-close';
  windowId: string;
}

// ---------------------------------------------------------------------------
// Payload types — session sync
// ---------------------------------------------------------------------------

export interface SessionSnapshotPayload {
  kind: 'session-snapshot';
  revision: number;
  activeDocumentId: string;
  openDocuments: Array<{ id: string; name: string }>;
  workspaceMode: string;
  selection: string[];
  theme: string;
  locale: string;
  dockLayout: unknown; // NativeWorkspaceLayout
  panelLocalStates: Record<string, unknown>;
}

export interface SessionPatchPayload {
  kind: 'session-patch';
  baseRevision: number;
  revision: number;
  patches: SessionPatch[];
}

export interface SessionPatch {
  path: string; // e.g. 'selection', 'activeDocumentId', 'document.nodes.abc'
  op: 'replace' | 'add' | 'remove';
  value: unknown;
}

// ---------------------------------------------------------------------------
// Payload types — commands
// ---------------------------------------------------------------------------

export interface SubmitCommandPayload {
  kind: 'submit-command';
  commandId: string;
  commandType: string;
  originWindowId: string;
  originPanelInstanceId: string;
  activeDocumentId: string;
  expectedRevision?: number;
  payload: unknown;
}

export interface CommandAckPayload {
  kind: 'command-ack';
  commandId: string;
  accepted: boolean;
  reason?: string;
  newRevision?: number;
}

// ---------------------------------------------------------------------------
// Payload types — panel transfer
// ---------------------------------------------------------------------------

export interface PanelTransferStartPayload {
  kind: 'panel-transfer-start';
  transactionId: string;
  panelInstanceId: string;
  panelTypeId: string;
  sourceWindowId: string;
  sourceNodeId: string;
  targetWindowId: string;
  targetNodeId?: string;
}

export interface PanelTransferReadyPayload {
  kind: 'panel-transfer-ready';
  transactionId: string;
  snapshot: unknown; // PanelTransferSnapshot
}

export interface PanelTransferAckPayload {
  kind: 'panel-transfer-ack';
  transactionId: string;
  accepted: boolean;
  reason?: string;
}

export interface PanelTransferCommitPayload {
  kind: 'panel-transfer-commit';
  transactionId: string;
  layout: unknown; // NativeWorkspaceLayout
}

export interface PanelTransferRollbackPayload {
  kind: 'panel-transfer-rollback';
  transactionId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Payload types — heartbeats
// ---------------------------------------------------------------------------

export interface HeartbeatPayload {
  kind: 'heartbeat';
  windowId: string;
  generation: number;
}

export interface HeartbeatAckPayload {
  kind: 'heartbeat-ack';
  windowId: string;
}

// ---------------------------------------------------------------------------
// Payload types — focus
// ---------------------------------------------------------------------------

export interface FocusChangedPayload {
  kind: 'focus-changed';
  windowId: string;
  panelInstanceId?: string;
}

// ---------------------------------------------------------------------------
// Union payload type
// ---------------------------------------------------------------------------

export type SessionPayload =
  | WindowRegisterPayload
  | WindowReadyPayload
  | WindowClosePayload
  | SessionSnapshotPayload
  | SessionPatchPayload
  | SubmitCommandPayload
  | CommandAckPayload
  | PanelTransferStartPayload
  | PanelTransferReadyPayload
  | PanelTransferAckPayload
  | PanelTransferCommitPayload
  | PanelTransferRollbackPayload
  | HeartbeatPayload
  | HeartbeatAckPayload
  | FocusChangedPayload;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ProtocolValidationError {
  field: string;
  message: string;
}

/**
 * Validate an incoming envelope. Returns an empty array if valid.
 */
export function validateEnvelope(envelope: unknown): ProtocolValidationError[] {
  const errors: ProtocolValidationError[] = [];
  if (typeof envelope !== 'object' || envelope === null) {
    return [{ field: 'envelope', message: 'must be an object' }];
  }
  const e = envelope as Record<string, unknown>;

  if (typeof e.protocolVersion !== 'number') {
    errors.push({ field: 'protocolVersion', message: 'must be a number' });
  } else if (e.protocolVersion !== PROTOCOL_VERSION) {
    errors.push({
      field: 'protocolVersion',
      message: `expected ${PROTOCOL_VERSION}, got ${e.protocolVersion}`,
    });
  }

  if (typeof e.sessionId !== 'string' || e.sessionId.length === 0) {
    errors.push({ field: 'sessionId', message: 'must be a non-empty string' });
  }

  if (typeof e.senderWindowId !== 'string' || e.senderWindowId.length === 0) {
    errors.push({ field: 'senderWindowId', message: 'must be a non-empty string' });
  }

  if (typeof e.eventId !== 'string' || e.eventId.length === 0) {
    errors.push({ field: 'eventId', message: 'must be a non-empty string' });
  }

  if (typeof e.sequence !== 'number' || e.sequence < 0) {
    errors.push({ field: 'sequence', message: 'must be a non-negative number' });
  }

  if (typeof e.sentAt !== 'number' || e.sentAt <= 0) {
    errors.push({ field: 'sentAt', message: 'must be a positive number' });
  }

  if (typeof e.payload !== 'object' || e.payload === null) {
    errors.push({ field: 'payload', message: 'must be an object' });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Envelope creation
// ---------------------------------------------------------------------------

let sequenceCounter = 0;

export function createEnvelope<TPayload>(
  sessionId: string,
  senderWindowId: string,
  eventId: string,
  payload: TPayload,
  options: { target?: SessionMessageTarget; documentRevision?: number } = {},
): SessionEnvelope<TPayload> {
  sequenceCounter += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    senderWindowId,
    eventId,
    sequence: sequenceCounter,
    sentAt: Date.now(),
    documentRevision: options.documentRevision,
    target: options.target,
    payload,
  };
}

/** Reset sequence counter (tests only). */
export function resetSequenceCounter(): void {
  sequenceCounter = 0;
}

// ---------------------------------------------------------------------------
// Sequence tracking
// ---------------------------------------------------------------------------

export class SequenceTracker {
  private lastSequence = -1;

  /** Check if a sequence number is new (not duplicate, not stale). */
  isCurrent(sequence: number): boolean {
    return sequence === this.lastSequence + 1;
  }

  /** Check if a sequence is a duplicate. */
  isDuplicate(sequence: number): boolean {
    return sequence <= this.lastSequence;
  }

  /** Accept a sequence number and advance. */
  accept(sequence: number): void {
    if (sequence > this.lastSequence) {
      this.lastSequence = sequence;
    }
  }

  getLastSequence(): number {
    return this.lastSequence;
  }

  reset(): void {
    this.lastSequence = -1;
  }
}
