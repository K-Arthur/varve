/**
 * Session broker (ADR-0017/0023/0024/0025).
 *
 * Owns the canonical session's cross-window contract:
 * - window registration with generations and heartbeat liveness
 * - session revisions and snapshot/projection delivery
 * - patch fan-out with per-window bounded, coalescing queues
 * - command submission: validate -> dedupe -> apply once -> ack/reject
 * - resync handling, stale/duplicate rejection, unregistration
 *
 * The broker is transport-agnostic: it receives envelopes and emits
 * envelopes through injected callbacks, so the same logic runs over Tauri
 * events, BroadcastChannel, or an in-memory transport in tests.
 *
 * The canonical editor session (EditorProvider) injects `applyCommand`
 * and `projectSnapshot` — the broker never mutates state itself.
 */

import {
  type CommandRejectPayload,
  type CommandSubmitPayload,
  createEnvelope,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  MAX_ACKNOWLEDGED_COMMANDS,
  MAX_ENVELOPE_PAYLOAD_BYTES,
  PAYLOAD_VALIDATORS,
  type SessionEnvelope,
  type SessionRegistration,
  type SessionSnapshotData,
  type SessionWindowRole,
  validateEnvelope,
  validateSubmitEditorCommand,
} from './protocol';

export type BrokerCommandResult =
  | { kind: 'ok'; newRevision: number }
  | { kind: 'rejected'; reason: string };

export type BrokerOutcome =
  | { kind: 'ok' }
  | { kind: 'dropped'; reason: string }
  | { kind: 'command-applied'; newRevision: number }
  | { kind: 'command-rejected'; reason: string }
  | { kind: 'snapshot-sent'; revision: number };

export interface SessionBrokerOptions {
  sessionId: string;
  primaryWindowId: string;
  /** Transport send (to a specific window or broadcast). */
  emit: (envelope: SessionEnvelope) => void;
  /** Apply a validated command on the canonical session. */
  applyCommand: (command: CommandSubmitPayload['command']) => BrokerCommandResult;
  /** Build the snapshot projection for a window (ADR-0024). */
  projectSnapshot: (windowId: string, hostedPanelInstanceIds: string[]) => SessionSnapshotData;
  /** Panel capability validation for a command origin (ADR-0025). */
  canPanelCommand: (originPanelInstanceId: string, commandType: string) => boolean;
  heartbeatTimeoutMs?: number;
  maxAuxiliaryWindows?: number;
  now?: () => number;
  createId?: () => string;
}

interface OutgoingPatch {
  kind: string;
  payload: unknown;
}

export class SessionBroker {
  private readonly sessionId: string;
  private readonly primaryWindowId: string;
  private readonly emit: (envelope: SessionEnvelope) => void;
  private readonly applyCommand: SessionBrokerOptions['applyCommand'];
  private readonly projectSnapshot: SessionBrokerOptions['projectSnapshot'];
  private readonly canPanelCommand: SessionBrokerOptions['canPanelCommand'];
  private readonly heartbeatTimeoutMs: number;
  private readonly maxAuxiliaryWindows: number;
  private readonly now: () => number;
  private readonly createId: () => string;

  private registrations = new Map<string, SessionRegistration>();
  private revision = 0;
  private generationByWindow = new Map<string, number>();
  private sequenceByWindow = new Map<string, number>();
  private outgoingSequenceByWindow = new Map<string, number>();
  private seenEventIds = new Set<string>();
  private acknowledgedCommands = new Map<string, number>();
  /** Per-window outgoing patch slots keyed by patch kind (coalescing). */
  private pendingPatches = new Map<string, Map<string, OutgoingPatch>>();
  private flushPending = false;

  constructor(options: SessionBrokerOptions) {
    this.sessionId = options.sessionId;
    this.primaryWindowId = options.primaryWindowId;
    this.emit = options.emit;
    this.applyCommand = options.applyCommand;
    this.projectSnapshot = options.projectSnapshot;
    this.canPanelCommand = options.canPanelCommand;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.maxAuxiliaryWindows = options.maxAuxiliaryWindows ?? 8;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => newId());
  }

  getRevision(): number {
    return this.revision;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  listRegistrations(): SessionRegistration[] {
    return [...this.registrations.values()];
  }

  isWindowRegistered(windowId: string): boolean {
    return this.registrations.has(windowId);
  }

  // -------------------------------------------------------------------------
  // Registration and liveness
  // -------------------------------------------------------------------------

  registerWindow(
    windowId: string,
    role: SessionWindowRole,
    hostedPanelInstanceIds: string[],
  ): SessionRegistration {
    if (role === 'auxiliary' && this.countAuxiliary() >= this.maxAuxiliaryWindows) {
      throw new Error(`auxiliary window limit reached (${this.maxAuxiliaryWindows})`);
    }
    const now = this.now();
    const generation = (this.generationByWindow.get(windowId) ?? -1) + 1;
    this.generationByWindow.set(windowId, generation);
    const registration: SessionRegistration = {
      windowId,
      generation,
      role,
      registeredAt: now,
      lastHeartbeatAt: now,
      hostedPanelInstanceIds,
    };
    this.registrations.set(windowId, registration);
    // A new generation invalidates old in-flight patches and sequences.
    this.pendingPatches.set(windowId, new Map());
    this.sequenceByWindow.set(windowId, 0);
    return registration;
  }

  unregisterWindow(windowId: string): void {
    this.registrations.delete(windowId);
    this.pendingPatches.delete(windowId);
    this.sequenceByWindow.delete(windowId);
  }

  markHeartbeat(windowId: string, hostedPanelInstanceIds: string[]): boolean {
    const registration = this.registrations.get(windowId);
    if (!registration) return false;
    registration.lastHeartbeatAt = this.now();
    registration.hostedPanelInstanceIds = hostedPanelInstanceIds;
    return true;
  }

  /** Windows whose heartbeat has lapsed (ADR-0031). */
  getExpiredWindows(): SessionRegistration[] {
    const now = this.now();
    return [...this.registrations.values()].filter(
      (registration) => now - registration.lastHeartbeatAt > this.heartbeatTimeoutMs,
    );
  }

  // -------------------------------------------------------------------------
  // Revisions, snapshots, patches
  // -------------------------------------------------------------------------

  private bumpRevision(): number {
    this.revision += 1;
    return this.revision;
  }

  sendSnapshot(windowId: string, _reason: string): void {
    const registration = this.registrations.get(windowId);
    if (!registration) return;
    const snapshot = this.projectSnapshot(windowId, registration.hostedPanelInstanceIds);
    this.emit(
      this.outgoing(registration, 'SNAPSHOT', { snapshot }, snapshot.revision, {
        kind: 'window',
        windowId,
      }),
    );
  }

  /** Fan out a domain patch to every registered auxiliary window. */
  publishPatch(kind: string, payload: unknown, baseRevision?: number): void {
    const revision = this.bumpRevision();
    for (const windowId of this.registrations.keys()) {
      const registration = this.registrations.get(windowId);
      if (!registration || registration.role === 'primary') continue;
      const slots = this.pendingPatches.get(windowId) ?? new Map<string, OutgoingPatch>();
      slots.set(kind, { kind, payload });
      this.pendingPatches.set(windowId, slots);
    }
    this.scheduleFlush(revision, baseRevision);
  }

  private scheduleFlush(revision: number, baseRevision?: number): void {
    if (this.flushPending) return;
    this.flushPending = true;
    const flush = () => {
      this.flushPending = false;
      this.flushPatches(revision, baseRevision);
    };
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(flush);
    } else {
      Promise.resolve().then(flush);
    }
  }

  /** Flush coalesced per-window patches (ADR-0024: last-value-wins). */
  flushPatches(revision: number, baseRevision?: number): void {
    for (const [windowId, slots] of this.pendingPatches) {
      const registration = this.registrations.get(windowId);
      if (!registration) continue;
      if (slots.size === 0) continue;
      const patches = [...slots.values()];
      slots.clear();
      this.emit(
        this.outgoing(
          registration,
          'PATCH',
          { baseRevision: baseRevision ?? this.revision, patches },
          revision,
          { kind: 'window', windowId },
        ),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Envelope entry point
  // -------------------------------------------------------------------------

  /** Validate + dispatch one incoming envelope. Never throws. */
  handleEnvelope(raw: unknown): BrokerOutcome {
    const validation = validateEnvelope(raw, { sessionId: this.sessionId, now: this.now });
    if (!validation.ok) {
      return { kind: 'dropped', reason: validation.reason };
    }
    const envelope = validation.envelope;

    if (this.seenEventIds.has(envelope.eventId)) {
      return { kind: 'dropped', reason: `duplicate event ${envelope.eventId}` };
    }
    this.seenEventIds.add(envelope.eventId);
    if (this.seenEventIds.size > 4096) {
      // Bound the dedupe set; old ids are gone from the window anyway.
      const head = this.seenEventIds.values().next().value as string;
      this.seenEventIds.delete(head);
    }

    const registration = this.registrations.get(envelope.senderWindowId);
    // WINDOW_READY is allowed from unregistered windows AND re-registers
    // (fresh generation) when a window reloads (ADR-0031).
    if (envelope.kind === 'WINDOW_READY') {
      return this.handleReady(envelope);
    }
    if (!registration) {
      return { kind: 'dropped', reason: `sender '${envelope.senderWindowId}' is not registered` };
    }
    if (envelope.senderGeneration !== registration.generation) {
      return {
        kind: 'dropped',
        reason: `stale generation ${envelope.senderGeneration} (current ${registration.generation})`,
      };
    }
    if (envelope.sequence < (this.sequenceByWindow.get(envelope.senderWindowId) ?? 0)) {
      return { kind: 'dropped', reason: 'out-of-order or duplicate message' };
    }
    this.sequenceByWindow.set(envelope.senderWindowId, envelope.sequence);

    const validator = PAYLOAD_VALIDATORS[envelope.kind];
    if (!validator(envelope.payload)) {
      return { kind: 'dropped', reason: `invalid payload for ${envelope.kind}` };
    }

    switch (envelope.kind) {
      case 'HEARTBEAT':
        return this.handleHeartbeat(envelope);
      case 'SNAPSHOT_REQUEST':
        this.sendSnapshot(envelope.senderWindowId, 'requested');
        return { kind: 'snapshot-sent', revision: this.revision };
      case 'RESYNC_REQUEST':
        this.sendSnapshot(envelope.senderWindowId, 'resync');
        return { kind: 'snapshot-sent', revision: this.revision };
      case 'COMMAND_SUBMIT':
        return this.handleCommandSubmit(envelope as SessionEnvelope<CommandSubmitPayload>);
      case 'WINDOW_HYDRATED':
      case 'PATCH':
      case 'SNAPSHOT':
      case 'COMMAND_ACK':
      case 'COMMAND_REJECT':
      case 'TRANSFER_BEGIN':
      case 'TRANSFER_ACK':
      case 'TRANSFER_COMMIT':
      case 'TRANSFER_ABORT':
      case 'WINDOW_CLOSING':
      case 'GENERATION_RESET':
        return this.handleControlMessage(envelope);
      default:
        return { kind: 'dropped', reason: `unhandled kind ${envelope.kind}` };
    }
  }

  private handleReady(envelope: SessionEnvelope): BrokerOutcome {
    const payload = envelope.payload as {
      role?: SessionWindowRole;
      hostedPanelInstanceIds?: string[];
    };
    const role = payload.role ?? 'auxiliary';
    if (role === 'primary' && envelope.senderWindowId !== this.primaryWindowId) {
      return {
        kind: 'dropped',
        reason: 'only the designated primary window may register as primary',
      };
    }
    try {
      this.registerWindow(envelope.senderWindowId, role, payload.hostedPanelInstanceIds ?? []);
    } catch (error) {
      return {
        kind: 'dropped',
        reason: error instanceof Error ? error.message : 'registration failed',
      };
    }
    this.sendSnapshot(envelope.senderWindowId, 'registration');
    return { kind: 'snapshot-sent', revision: this.revision };
  }

  private handleHeartbeat(envelope: SessionEnvelope): BrokerOutcome {
    const payload = envelope.payload as { hostedPanelInstanceIds?: string[] };
    this.markHeartbeat(envelope.senderWindowId, payload.hostedPanelInstanceIds ?? []);
    return { kind: 'ok' };
  }

  private handleCommandSubmit(envelope: SessionEnvelope<CommandSubmitPayload>): BrokerOutcome {
    const command = validateSubmitEditorCommand(envelope.payload.command);
    if (!command) {
      return this.rejectCommand(envelope, 'malformed command');
    }
    if (command.originWindowId !== envelope.senderWindowId) {
      return this.rejectCommand(envelope, 'command origin window does not match sender');
    }
    if (this.acknowledgedCommands.has(command.commandId)) {
      return { kind: 'dropped', reason: `duplicate command ${command.commandId}` };
    }
    if (command.expectedRevision !== undefined && command.expectedRevision !== this.revision) {
      return this.rejectCommand(
        envelope,
        `stale command (expected revision ${command.expectedRevision}, current ${this.revision})`,
      );
    }
    const registration = this.registrations.get(envelope.senderWindowId);
    if (!registration?.hostedPanelInstanceIds.includes(command.originPanelInstanceId)) {
      return this.rejectCommand(envelope, 'command originates from an unhosted panel instance');
    }
    if (!this.canPanelCommand(command.originPanelInstanceId, command.commandType)) {
      return this.rejectCommand(envelope, `panel does not allow command '${command.commandType}'`);
    }
    const result = this.applyCommand(command);
    if (result.kind === 'rejected') {
      return this.rejectCommand(envelope, result.reason);
    }
    this.acknowledgedCommands.set(command.commandId, result.newRevision);
    if (this.acknowledgedCommands.size > MAX_ACKNOWLEDGED_COMMANDS) {
      const oldest = this.acknowledgedCommands.keys().next().value as string;
      this.acknowledgedCommands.delete(oldest);
    }
    const ack = { commandId: command.commandId, newRevision: result.newRevision };
    this.emit(
      this.outgoing(registration, 'COMMAND_ACK', ack, result.newRevision, {
        kind: 'window',
        windowId: envelope.senderWindowId,
      }),
    );
    return { kind: 'command-applied', newRevision: result.newRevision };
  }

  private rejectCommand(envelope: SessionEnvelope, reason: string): BrokerOutcome {
    const registration = this.registrations.get(envelope.senderWindowId);
    if (registration) {
      const rejectPayload: CommandRejectPayload = {
        commandId:
          (envelope.payload as CommandSubmitPayload | undefined)?.command?.commandId ?? 'unknown',
        reason,
      };
      this.emit(
        this.outgoing(registration, 'COMMAND_REJECT', rejectPayload, this.revision, {
          kind: 'window',
          windowId: envelope.senderWindowId,
        }),
      );
    }
    return { kind: 'command-rejected', reason };
  }

  private handleControlMessage(envelope: SessionEnvelope): BrokerOutcome {
    if (envelope.kind === 'WINDOW_CLOSING') {
      this.unregisterWindow(envelope.senderWindowId);
    }
    if (envelope.kind === 'GENERATION_RESET') {
      const payload = envelope.payload as { newGeneration?: number };
      const registration = this.registrations.get(envelope.senderWindowId);
      if (registration && typeof payload.newGeneration === 'number') {
        registration.generation = payload.newGeneration;
      }
    }
    return { kind: 'ok' };
  }

  private outgoing(
    registration: SessionRegistration,
    kind: SessionEnvelope['kind'],
    payload: unknown,
    documentRevision: number,
    target: SessionEnvelope['target'],
  ): SessionEnvelope {
    const sequence = (this.outgoingSequenceByWindow.get(registration.windowId) ?? 0) + 1;
    this.outgoingSequenceByWindow.set(registration.windowId, sequence);
    return createEnvelope({
      sessionId: this.sessionId,
      senderWindowId: this.primaryWindowId,
      senderGeneration: this.registrations.get(this.primaryWindowId)?.generation ?? 0,
      target,
      kind,
      payload,
      documentRevision,
      sequence,
      now: this.now,
      eventId: this.createId(),
    });
  }

  private countAuxiliary(): number {
    let count = 0;
    for (const registration of this.registrations.values()) {
      if (registration.role === 'auxiliary') count += 1;
    }
    return count;
  }
}

function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Keep the size cap referenced (used by protocol tests and transports).
export { MAX_ENVELOPE_PAYLOAD_BYTES };
