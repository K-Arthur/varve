/**
 * Cross-window session protocol (ADR-0023/0024/0025).
 *
 * Every message between windows is a `SessionEnvelope` carrying protocol
 * version, session id, sender window id + generation, event id, sequence,
 * document revision (when relevant), target scope, kind, and payload.
 *
 * Validation is strict and centralized: unknown protocol versions, invalid
 * schemas, wrong session ids, unregistered/spoofed senders, stale
 * generations, duplicate event ids, oversized payloads, and malformed
 * targets are all rejected before any dispatch.
 */

export const SESSION_PROTOCOL_VERSION = 1;

/** Hard cap on a serialized envelope payload (ADR-0023). */
export const MAX_ENVELOPE_PAYLOAD_BYTES = 256 * 1024;

/** Hard cap on serialized panel-local state inside a snapshot (ADR-0019). */
export const MAX_PANEL_STATE_BYTES = 64 * 1024;

/** Default heartbeat interval/liveness window (ADR-0031). */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;

export const MAX_ACKNOWLEDGED_COMMANDS = 128;

export type SessionMessageKind =
  | 'WINDOW_READY'
  | 'WINDOW_HYDRATED'
  | 'SNAPSHOT_REQUEST'
  | 'SNAPSHOT'
  | 'PATCH'
  | 'COMMAND_SUBMIT'
  | 'COMMAND_ACK'
  | 'COMMAND_REJECT'
  | 'RESYNC_REQUEST'
  | 'TRANSFER_BEGIN'
  | 'TRANSFER_ACK'
  | 'TRANSFER_COMMIT'
  | 'TRANSFER_ABORT'
  | 'HEARTBEAT'
  | 'WINDOW_CLOSING'
  | 'GENERATION_RESET';

export const SESSION_MESSAGE_KINDS: readonly SessionMessageKind[] = [
  'WINDOW_READY',
  'WINDOW_HYDRATED',
  'SNAPSHOT_REQUEST',
  'SNAPSHOT',
  'PATCH',
  'COMMAND_SUBMIT',
  'COMMAND_ACK',
  'COMMAND_REJECT',
  'RESYNC_REQUEST',
  'TRANSFER_BEGIN',
  'TRANSFER_ACK',
  'TRANSFER_COMMIT',
  'TRANSFER_ABORT',
  'HEARTBEAT',
  'WINDOW_CLOSING',
  'GENERATION_RESET',
];

export type SessionMessageTarget =
  | { kind: 'broker' }
  | { kind: 'window'; windowId: string }
  | { kind: 'broadcast-panels' };

export interface SessionEnvelope<TPayload = unknown> {
  protocolVersion: number;
  sessionId: string;
  senderWindowId: string;
  senderGeneration: number;
  eventId: string;
  sequence: number;
  /** Diagnostics only — never used for ordering (ADR-0023). */
  sentAt: number;
  documentRevision?: number;
  target: SessionMessageTarget;
  kind: SessionMessageKind;
  payload: TPayload;
}

export type SessionWindowRole = 'primary' | 'auxiliary';

export interface SessionRegistration {
  windowId: string;
  generation: number;
  role: SessionWindowRole;
  registeredAt: number;
  lastHeartbeatAt: number;
  /** Panel instance ids this window reports hosting (ADR-0031). */
  hostedPanelInstanceIds: string[];
}

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

export interface WindowReadyPayload {
  role: SessionWindowRole;
  hostedPanelInstanceIds: string[];
}

export interface WindowHydratedPayload {
  snapshotRevision: number;
}

export interface SnapshotRequestPayload {
  reason: 'initial' | 'resync' | 'gap';
  lastRevision?: number;
}

export interface CommandAvailability {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export interface OpenDocumentDescriptor {
  id: string;
  name: string;
  dirty: boolean;
  fileId?: string;
}

export interface SessionSnapshotData {
  revision: number;
  openDocuments: OpenDocumentDescriptor[];
  activeDocumentId: string;
  workspaceMode: string;
  theme: string;
  locale: string;
  selection: string[];
  commandAvailability: CommandAvailability;
  /** Portable dock layout for the window (ADR-0021/0032). */
  panelLayout: unknown;
  panelLocalState: Array<{ instanceId: string; snapshot: unknown }>;
}

export interface SessionSnapshotPayload {
  snapshot: SessionSnapshotData;
}

export interface SessionPatchPayload {
  baseRevision: number;
  patches: Array<{ kind: string; payload: unknown }>;
}

export interface SubmitEditorCommand {
  commandId: string;
  originWindowId: string;
  originPanelInstanceId: string;
  activeDocumentId: string;
  expectedRevision?: number;
  commandType: string;
  payload: unknown;
}

export interface CommandSubmitPayload {
  command: SubmitEditorCommand;
}

export interface CommandAckPayload {
  commandId: string;
  newRevision: number;
}

export interface CommandRejectPayload {
  commandId: string;
  reason: string;
}

export interface ResyncRequestPayload {
  reason: 'revision-gap' | 'stale' | 'duplicate';
}

export interface HeartbeatPayload {
  hostedPanelInstanceIds: string[];
}

export interface WindowClosingPayload {
  reason: 'user' | 'reattach' | 'crash-recovery';
}

export interface TransferBeginPayload {
  transactionId: string;
  panelInstanceId: string;
  panelTypeId: string;
  destinationWindowId: string;
  /** Bounded, typed panel-local state (ADR-0019/0029). */
  localState?: unknown;
}

export interface TransferAckPayload {
  transactionId: string;
  panelInstanceId: string;
}

export interface TransferCommitPayload {
  transactionId: string;
  panelInstanceId: string;
  destinationWindowId: string;
}

export interface TransferAbortPayload {
  transactionId: string;
  reason: string;
}

export interface GenerationResetPayload {
  newGeneration: number;
}

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

export type EnvelopeValidation =
  | { ok: true; envelope: SessionEnvelope }
  | { ok: false; reason: string };

export interface EnvelopeValidationContext {
  sessionId: string;
  /** Envelope-level limits; window registration is the broker's job. */
  now?: () => number;
}

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function isPlausibleId(value: unknown): boolean {
  return typeof value === 'string' && ID_PATTERN.test(value) && value.length > 0;
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Serialized size of a payload — bounded (ADR-0023). */
export function payloadByteSize(payload: unknown): number {
  try {
    const json = JSON.stringify(payload);
    return json === undefined ? 0 : json.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Validate a raw envelope against structural rules + the session context.
 * Does NOT check registration (that is the broker's job — a structurally
 * valid envelope from an unregistered sender is still rejected there).
 */
export function validateEnvelope(
  input: unknown,
  context: EnvelopeValidationContext,
): EnvelopeValidation {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'envelope must be an object' };
  }
  const candidate = input as Record<string, unknown>;

  if (candidate.protocolVersion !== SESSION_PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: `unsupported protocol version ${String(candidate.protocolVersion)}`,
    };
  }
  if (candidate.sessionId !== context.sessionId) {
    return { ok: false, reason: 'session id mismatch' };
  }
  if (!isPlausibleId(candidate.senderWindowId)) {
    return { ok: false, reason: 'invalid sender window id' };
  }
  if (!isNonNegativeInteger(candidate.senderGeneration)) {
    return { ok: false, reason: 'invalid sender generation' };
  }
  if (!isPlausibleId(candidate.eventId)) {
    return { ok: false, reason: 'invalid event id' };
  }
  if (!isNonNegativeInteger(candidate.sequence)) {
    return { ok: false, reason: 'invalid sequence number' };
  }
  if (!isFiniteNumber(candidate.sentAt)) {
    return { ok: false, reason: 'invalid sentAt' };
  }
  if (
    candidate.documentRevision !== undefined &&
    !isNonNegativeInteger(candidate.documentRevision)
  ) {
    return { ok: false, reason: 'invalid document revision' };
  }
  if (!isValidTarget(candidate.target)) {
    return { ok: false, reason: 'invalid target' };
  }
  if (
    typeof candidate.kind !== 'string' ||
    !SESSION_MESSAGE_KINDS.includes(candidate.kind as SessionMessageKind)
  ) {
    return { ok: false, reason: `unknown message kind '${String(candidate.kind)}'` };
  }
  if (candidate.payload === undefined) {
    return { ok: false, reason: 'missing payload' };
  }
  const bytes = payloadByteSize(candidate.payload);
  if (bytes > MAX_ENVELOPE_PAYLOAD_BYTES) {
    return { ok: false, reason: `payload too large (${bytes} > ${MAX_ENVELOPE_PAYLOAD_BYTES})` };
  }

  const envelope = candidate as unknown as SessionEnvelope;
  return { ok: true, envelope };
}

function isValidTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const t = target as Record<string, unknown>;
  if (t.kind === 'broker') return true;
  if (t.kind === 'broadcast-panels') return true;
  if (t.kind === 'window') {
    return typeof t.windowId === 'string' && t.windowId.length > 0;
  }
  return false;
}

/**
 * Validate a submitted command payload (ADR-0025): identity, ownership,
 * document binding, revision expectation, type allowlist is the handler
 * table's job, but basic shape is checked here.
 */
export function validateSubmitEditorCommand(input: unknown): SubmitEditorCommand | null {
  if (typeof input !== 'object' || input === null) return null;
  const c = input as Record<string, unknown>;
  if (!isPlausibleId(c.commandId)) return null;
  if (!isPlausibleId(c.originWindowId)) return null;
  if (!isPlausibleId(c.originPanelInstanceId)) return null;
  if (!isPlausibleId(c.activeDocumentId)) return null;
  if (c.expectedRevision !== undefined && !isNonNegativeInteger(c.expectedRevision)) return null;
  if (typeof c.commandType !== 'string' || c.commandType.length === 0) return null;
  if (c.payload === undefined) return null;
  return c as unknown as SubmitEditorCommand;
}

/** Payload validators per message kind (broker-side dispatch gate). */
export const PAYLOAD_VALIDATORS: Record<SessionMessageKind, (payload: unknown) => boolean> = {
  WINDOW_READY: (p) => {
    const ready = p as WindowReadyPayload;
    return (
      typeof ready === 'object' &&
      ready !== null &&
      (ready.role === 'primary' || ready.role === 'auxiliary') &&
      Array.isArray(ready.hostedPanelInstanceIds) &&
      ready.hostedPanelInstanceIds.every((id) => typeof id === 'string')
    );
  },
  WINDOW_HYDRATED: (p) => {
    const hydrated = p as WindowHydratedPayload;
    return (
      typeof hydrated === 'object' &&
      hydrated !== null &&
      isNonNegativeInteger(hydrated.snapshotRevision)
    );
  },
  SNAPSHOT_REQUEST: (p) => {
    const request = p as SnapshotRequestPayload;
    return (
      typeof request === 'object' &&
      request !== null &&
      (request.reason === 'initial' || request.reason === 'resync' || request.reason === 'gap')
    );
  },
  SNAPSHOT: (p) => {
    const snapshot = p as SessionSnapshotPayload;
    return (
      typeof snapshot === 'object' &&
      snapshot !== null &&
      typeof snapshot.snapshot === 'object' &&
      snapshot.snapshot !== null &&
      isNonNegativeInteger(snapshot.snapshot.revision) &&
      typeof snapshot.snapshot.activeDocumentId === 'string' &&
      typeof snapshot.snapshot.workspaceMode === 'string'
    );
  },
  PATCH: (p) => {
    const patch = p as SessionPatchPayload;
    return (
      typeof patch === 'object' &&
      patch !== null &&
      isNonNegativeInteger(patch.baseRevision) &&
      Array.isArray(patch.patches)
    );
  },
  COMMAND_SUBMIT: (p) => {
    const submit = p as CommandSubmitPayload;
    return (
      typeof submit === 'object' &&
      submit !== null &&
      validateSubmitEditorCommand(submit.command) !== null
    );
  },
  COMMAND_ACK: (p) => {
    const ack = p as CommandAckPayload;
    return (
      typeof ack === 'object' &&
      ack !== null &&
      isPlausibleId(ack.commandId) &&
      isNonNegativeInteger(ack.newRevision)
    );
  },
  COMMAND_REJECT: (p) => {
    const reject = p as CommandRejectPayload;
    return (
      typeof reject === 'object' &&
      reject !== null &&
      isPlausibleId(reject.commandId) &&
      typeof reject.reason === 'string'
    );
  },
  RESYNC_REQUEST: (p) => {
    const request = p as ResyncRequestPayload;
    return (
      typeof request === 'object' &&
      request !== null &&
      (request.reason === 'revision-gap' ||
        request.reason === 'stale' ||
        request.reason === 'duplicate')
    );
  },
  HEARTBEAT: (p) => {
    const heartbeat = p as HeartbeatPayload;
    return (
      typeof heartbeat === 'object' &&
      heartbeat !== null &&
      Array.isArray(heartbeat.hostedPanelInstanceIds)
    );
  },
  WINDOW_CLOSING: (p) => {
    const closing = p as WindowClosingPayload;
    return (
      typeof closing === 'object' &&
      closing !== null &&
      (closing.reason === 'user' ||
        closing.reason === 'reattach' ||
        closing.reason === 'crash-recovery')
    );
  },
  TRANSFER_BEGIN: (p) => {
    const transfer = p as TransferBeginPayload;
    return (
      typeof transfer === 'object' &&
      transfer !== null &&
      isPlausibleId(transfer.transactionId) &&
      isPlausibleId(transfer.panelInstanceId) &&
      typeof transfer.panelTypeId === 'string' &&
      isPlausibleId(transfer.destinationWindowId) &&
      transfer.localState !== undefined
    );
  },
  TRANSFER_ACK: (p) => {
    const ack = p as TransferAckPayload;
    return (
      typeof ack === 'object' &&
      ack !== null &&
      isPlausibleId(ack.transactionId) &&
      isPlausibleId(ack.panelInstanceId)
    );
  },
  TRANSFER_COMMIT: (p) => {
    const commit = p as TransferCommitPayload;
    return (
      typeof commit === 'object' &&
      commit !== null &&
      isPlausibleId(commit.transactionId) &&
      isPlausibleId(commit.panelInstanceId) &&
      isPlausibleId(commit.destinationWindowId)
    );
  },
  TRANSFER_ABORT: (p) => {
    const abort = p as TransferAbortPayload;
    return (
      typeof abort === 'object' &&
      abort !== null &&
      isPlausibleId(abort.transactionId) &&
      typeof abort.reason === 'string'
    );
  },
  GENERATION_RESET: (p) => {
    const reset = p as GenerationResetPayload;
    return typeof reset === 'object' && reset !== null && isNonNegativeInteger(reset.newGeneration);
  },
};

export function createEnvelope<TPayload>(input: {
  sessionId: string;
  senderWindowId: string;
  senderGeneration: number;
  target: SessionMessageTarget;
  kind: SessionMessageKind;
  payload: TPayload;
  documentRevision?: number;
  sequence: number;
  eventId?: string;
  now?: () => number;
}): SessionEnvelope<TPayload> {
  return {
    protocolVersion: SESSION_PROTOCOL_VERSION,
    sessionId: input.sessionId,
    senderWindowId: input.senderWindowId,
    senderGeneration: input.senderGeneration,
    eventId: input.eventId ?? newId(),
    sequence: input.sequence,
    sentAt: (input.now ?? Date.now)(),
    documentRevision: input.documentRevision,
    target: input.target,
    kind: input.kind,
    payload: input.payload,
  };
}

function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
