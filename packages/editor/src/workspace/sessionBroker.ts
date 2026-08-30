/**
 * Session broker (ADR-0204/0207) — primary-window authority for the live
 * auxiliary-panel session.
 *
 * This is deliberately the broker used by `useDetachedPanels`, not the
 * older protocol-only experiment under `workspace/session/`. The transport
 * uses Tauri core events in desktop auxiliary windows and BroadcastChannel
 * in browser popups, so every boundary here treats messages as untrusted
 * data even though they share an origin.
 */

import type { DetachedPanelRecord } from './detachedPanelsStore';
import type { PanelTransferSnapshot } from './panelRegistry';
import { recordPanelWindowDiagnostic } from './panelWindowDiagnostics';
import { createSessionTransport, type Transport } from './sessionTransport';

// ---------------------------------------------------------------------------
// Live transport protocol
// ---------------------------------------------------------------------------

/** Version for the transport consumed by AuxiliarySessionProvider. */
export const SESSION_BROKER_PROTOCOL_VERSION = 1;

const MAX_AUX_WINDOWS = 8;
const MAX_PANEL_TYPES_PER_WINDOW = 8;
const MAX_STRING_LENGTH = 16_384;
const MAX_DOCUMENT_JSON_LENGTH = 64 * 1024 * 1024;
const MAX_SELECTION_ITEMS = 50_000;
const MAX_TRANSFER_SNAPSHOT_BYTES = 64 * 1024;
const MAX_DOCUMENT_REVISION = Number.MAX_SAFE_INTEGER - 1;
const DEFAULT_HOST_READY_TIMEOUT_MS = 10_000;
const MIN_HOST_READY_TIMEOUT_MS = 250;
const MAX_HOST_READY_TIMEOUT_MS = 30_000;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function isBoundedString(value: unknown, maxLength = MAX_STRING_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isOptionalBoundedString(value: unknown, maxLength = MAX_STRING_LENGTH): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function isStringArray(value: unknown, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxLength &&
    value.every((item) => isBoundedString(item))
  );
}

function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** Document revisions start at zero and must leave room for one next revision. */
function isDocumentRevision(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DOCUMENT_REVISION
  );
}

/** Reject functions, DOM values, prototypes, cycles, and pathological depth. */
function isSerializablePanelState(value: unknown, depth = 0): boolean {
  if (depth > 32 || value === undefined) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= MAX_TRANSFER_SNAPSHOT_BYTES;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;

  if (Array.isArray(value)) {
    return (
      value.length <= MAX_SELECTION_ITEMS &&
      value.every((item) => isSerializablePanelState(item, depth + 1))
    );
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const entries = Object.entries(value as UnknownRecord);
    return (
      entries.length <= MAX_SELECTION_ITEMS &&
      entries.every(
        ([key, field]) =>
          !['__proto__', 'constructor', 'prototype'].includes(key) &&
          key.length <= MAX_STRING_LENGTH &&
          isSerializablePanelState(field, depth + 1),
      )
    );
  } catch {
    return false;
  }
}

function hasBoundedSerializedSize(value: unknown): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_TRANSFER_SNAPSHOT_BYTES
    );
  } catch {
    return false;
  }
}

function isDetachedPanelRecord(value: unknown): value is DetachedPanelRecord {
  const record = asRecord(value);
  return (
    record !== null &&
    isBoundedString(record.panelTypeId) &&
    isBoundedString(record.panelInstanceId) &&
    isBoundedString(record.windowId) &&
    isGeneration(record.generation) &&
    typeof record.detachedAt === 'number' &&
    Number.isFinite(record.detachedAt)
  );
}

export interface BrokerMessageMetadata {
  protocolVersion: number;
  windowId: string;
  generation: number;
}

export interface PanelHostTransfer {
  transactionId: string;
  panelTypeId: string;
  panelInstanceId: string;
  /** Panel-local state prepared by the primary before creating the host. */
  transferSnapshot?: PanelTransferSnapshot;
}

export interface WindowReadyMessage extends BrokerMessageMetadata {
  panelTypeIds: string[];
  transactionId?: string;
  panelTypeId?: string;
  panelInstanceId?: string;
}

export interface WindowCloseMessage extends BrokerMessageMetadata {}

export interface SessionSnapshotMessage {
  protocolVersion: number;
  target: string;
  snapshot: BrokerSnapshot;
  transfer?: PanelHostTransfer;
}

export interface SessionPatchMessage {
  protocolVersion: number;
  /** Every patch is ordered against the primary's authoritative document revision. */
  patch: BrokerSnapshotPatch;
}

export interface PanelMembershipMessage extends BrokerMessageMetadata {
  panelTypeId: string;
}

export interface ReattachAckMessage extends BrokerMessageMetadata {
  accepted: boolean;
  panelTypeIds: string[];
}

export interface PanelHydrationMessage extends BrokerMessageMetadata {
  transactionId: string;
  panelTypeId: string;
  panelInstanceId: string;
}

export interface PanelHydrationFailureMessage extends PanelHydrationMessage {
  reason: string;
}

/**
 * Add the immutable identity metadata required by every aux → primary
 * message. AuxiliarySessionProvider uses this so callers cannot accidentally
 * omit the version or spoof another window through a payload spread.
 */
export function withBrokerMessageMetadata<T extends UnknownRecord>(
  windowId: string,
  generation: number,
  payload: T,
): T & BrokerMessageMetadata {
  return {
    ...payload,
    protocolVersion: SESSION_BROKER_PROTOCOL_VERSION,
    windowId,
    generation,
  };
}

function hasMetadata(value: unknown): value is BrokerMessageMetadata & UnknownRecord {
  const record = asRecord(value);
  return (
    record !== null &&
    record.protocolVersion === SESSION_BROKER_PROTOCOL_VERSION &&
    isBoundedString(record.windowId) &&
    isGeneration(record.generation)
  );
}

function isPanelTransferSnapshot(value: unknown): value is PanelTransferSnapshot {
  const snapshot = asRecord(value);
  return (
    snapshot !== null &&
    isGeneration(snapshot.schemaVersion) &&
    isBoundedString(snapshot.panelTypeId) &&
    Object.hasOwn(snapshot, 'state') &&
    isSerializablePanelState(snapshot.state) &&
    hasBoundedSerializedSize(snapshot.state) &&
    typeof snapshot.byteSize === 'number' &&
    Number.isFinite(snapshot.byteSize) &&
    snapshot.byteSize >= 0 &&
    snapshot.byteSize <= MAX_TRANSFER_SNAPSHOT_BYTES
  );
}

function isPanelHostTransfer(value: unknown): value is PanelHostTransfer {
  const record = asRecord(value);
  const transferSnapshot = record?.transferSnapshot;
  return (
    record !== null &&
    isBoundedString(record.transactionId) &&
    isBoundedString(record.panelTypeId) &&
    isBoundedString(record.panelInstanceId) &&
    (transferSnapshot === undefined ||
      (isPanelTransferSnapshot(transferSnapshot) &&
        transferSnapshot.panelTypeId === record.panelTypeId))
  );
}

export function isWindowReadyMessage(value: unknown): value is WindowReadyMessage {
  if (!hasMetadata(value)) return false;
  const record = value as UnknownRecord;
  return (
    isStringArray(record.panelTypeIds, MAX_PANEL_TYPES_PER_WINDOW) &&
    isOptionalBoundedString(record.transactionId) &&
    isOptionalBoundedString(record.panelTypeId) &&
    isOptionalBoundedString(record.panelInstanceId)
  );
}

export function isWindowCloseMessage(value: unknown): value is WindowCloseMessage {
  return hasMetadata(value);
}

export function isPanelHydrationMessage(value: unknown): value is PanelHydrationMessage {
  if (!hasMetadata(value)) return false;
  const record = value as UnknownRecord;
  return (
    isBoundedString(record.transactionId) &&
    isBoundedString(record.panelTypeId) &&
    isBoundedString(record.panelInstanceId)
  );
}

export function isPanelHydrationFailureMessage(
  value: unknown,
): value is PanelHydrationFailureMessage {
  const record = asRecord(value);
  return isPanelHydrationMessage(value) && record !== null && isBoundedString(record.reason, 512);
}

function isBrokerSnapshot(value: unknown): value is BrokerSnapshot {
  const snapshot = asRecord(value);
  return (
    snapshot !== null &&
    typeof snapshot.documentJson === 'string' &&
    snapshot.documentJson.length <= MAX_DOCUMENT_JSON_LENGTH &&
    isDocumentRevision(snapshot.documentRevision) &&
    typeof snapshot.activeDocumentId === 'string' &&
    snapshot.activeDocumentId.length <= MAX_STRING_LENGTH &&
    typeof snapshot.activeDocumentName === 'string' &&
    snapshot.activeDocumentName.length <= MAX_STRING_LENGTH &&
    isStringArray(snapshot.selection, MAX_SELECTION_ITEMS) &&
    isBoundedString(snapshot.workspaceMode) &&
    isBoundedString(snapshot.theme) &&
    typeof snapshot.canUndo === 'boolean' &&
    typeof snapshot.canRedo === 'boolean' &&
    Array.isArray(snapshot.detachedPanels) &&
    snapshot.detachedPanels.every(isDetachedPanelRecord)
  );
}

function isSnapshotPatch(value: unknown): value is BrokerSnapshotPatch {
  const patch = asRecord(value);
  if (!patch) return false;
  const allowedKeys = new Set([
    'documentJson',
    'documentRevision',
    'activeDocumentId',
    'activeDocumentName',
    'selection',
    'workspaceMode',
    'theme',
    'canUndo',
    'canRedo',
    'detachedPanels',
  ]);
  const entries = Object.entries(patch);
  if (
    entries.length === 0 ||
    !Object.hasOwn(patch, 'documentRevision') ||
    !isDocumentRevision(patch.documentRevision) ||
    entries.some(([key]) => !allowedKeys.has(key))
  ) {
    return false;
  }

  return entries.every(([key, field]) => {
    switch (key) {
      case 'documentJson':
        return typeof field === 'string' && field.length <= MAX_DOCUMENT_JSON_LENGTH;
      case 'documentRevision':
        return isDocumentRevision(field);
      case 'activeDocumentId':
      case 'activeDocumentName':
        return typeof field === 'string' && field.length <= MAX_STRING_LENGTH;
      case 'selection':
        return isStringArray(field, MAX_SELECTION_ITEMS);
      case 'workspaceMode':
      case 'theme':
        return isBoundedString(field);
      case 'canUndo':
      case 'canRedo':
        return typeof field === 'boolean';
      case 'detachedPanels':
        return Array.isArray(field) && field.every(isDetachedPanelRecord);
      default:
        return false;
    }
  });
}

export function isSessionSnapshotMessage(value: unknown): value is SessionSnapshotMessage {
  const message = asRecord(value);
  return (
    message !== null &&
    message.protocolVersion === SESSION_BROKER_PROTOCOL_VERSION &&
    isBoundedString(message.target) &&
    isBrokerSnapshot(message.snapshot) &&
    (message.transfer === undefined || isPanelHostTransfer(message.transfer))
  );
}

export function isSessionPatchMessage(value: unknown): value is SessionPatchMessage {
  const message = asRecord(value);
  return (
    message !== null &&
    message.protocolVersion === SESSION_BROKER_PROTOCOL_VERSION &&
    isSnapshotPatch(message.patch)
  );
}

export function isPanelMembershipMessage(value: unknown): value is PanelMembershipMessage {
  return hasMetadata(value) && isBoundedString((value as UnknownRecord).panelTypeId);
}

export function isReattachAckMessage(value: unknown): value is ReattachAckMessage {
  if (!hasMetadata(value)) return false;
  const record = value as UnknownRecord;
  return (
    typeof record.accepted === 'boolean' &&
    isStringArray(record.panelTypeIds, MAX_PANEL_TYPES_PER_WINDOW)
  );
}

function isExternalDocumentMessage(
  value: unknown,
): value is BrokerMessageMetadata & { documentJson: string; baseDocumentRevision: number } {
  const record = asRecord(value);
  return (
    hasMetadata(value) &&
    record !== null &&
    typeof record.documentJson === 'string' &&
    record.documentJson.length <= MAX_DOCUMENT_JSON_LENGTH &&
    isDocumentRevision(record.baseDocumentRevision)
  );
}

function isExternalSelectionMessage(
  value: unknown,
): value is BrokerMessageMetadata & { selection: string[] } {
  return (
    hasMetadata(value) && isStringArray((value as UnknownRecord).selection, MAX_SELECTION_ITEMS)
  );
}

function isWindowMessage(value: unknown): value is BrokerMessageMetadata {
  return hasMetadata(value);
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_HOST_READY_TIMEOUT_MS;
  return Math.min(
    MAX_HOST_READY_TIMEOUT_MS,
    Math.max(MIN_HOST_READY_TIMEOUT_MS, Math.floor(value ?? DEFAULT_HOST_READY_TIMEOUT_MS)),
  );
}

// ---------------------------------------------------------------------------
// Editor API the primary window must inject
// ---------------------------------------------------------------------------

export interface BrokerEditorApi {
  getSessionId(): string;
  getSnapshot(): BrokerSnapshot;
  /** Apply an externally-originated document (aux → primary, undo push). */
  applyExternalDocument(documentJson: string): void;
  /** Apply an externally-originated selection (aux → primary). */
  applyExternalSelection(selection: string[]): void;
  requestUndo(): void;
  requestRedo(): void;
  /** Mark a panel reattached (clears the detached record + returns to dock). */
  reattachPanel(panelTypeId: string): void;
}

export interface BrokerSnapshot {
  documentJson: string;
  /** Monotonic primary-authoritative revision for the serialized document. */
  documentRevision: number;
  activeDocumentId: string;
  activeDocumentName: string;
  selection: string[];
  workspaceMode: string;
  theme: string;
  canUndo: boolean;
  canRedo: boolean;
  detachedPanels: DetachedPanelRecord[];
}

/** A patch may omit unchanged presentation fields, but never its document revision. */
export type BrokerSnapshotPatch = Partial<BrokerSnapshot> &
  Pick<BrokerSnapshot, 'documentRevision'>;

// ---------------------------------------------------------------------------
// Window registry and two-phase panel host reservation
// ---------------------------------------------------------------------------

export interface RegisteredWindow {
  windowId: string;
  generation: number;
  panelTypeIds: string[];
  transactionId?: string;
  registeredAt: number;
}

export interface PanelHostReservationRequest extends PanelHostTransfer {
  windowId: string;
  /**
   * Expected auxiliary-host generation. The first host created for a
   * transaction is generation one; a future explicit reload hand-off can
   * reserve a later generation without letting an arbitrary ready message
   * replace the live host.
   */
  generation?: number;
  /** Bounded readiness deadline; defaults to ten seconds. */
  timeoutMs?: number;
}

export interface PanelHostReadiness {
  transactionId: string;
  windowId: string;
  panelTypeId: string;
  panelInstanceId: string;
}

interface PendingPanelHost extends Omit<PanelHostReservationRequest, 'generation'> {
  generation: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (readiness: PanelHostReadiness) => void;
  reject: (reason: Error) => void;
}

function isReservationRequest(value: PanelHostReservationRequest): boolean {
  return (
    isBoundedString(value.transactionId) &&
    isBoundedString(value.windowId) &&
    isBoundedString(value.panelTypeId) &&
    isBoundedString(value.panelInstanceId) &&
    (value.generation === undefined || isGeneration(value.generation)) &&
    (value.transferSnapshot === undefined ||
      (isPanelTransferSnapshot(value.transferSnapshot) &&
        value.transferSnapshot.panelTypeId === value.panelTypeId))
  );
}

export class SessionBroker {
  private transport: Transport;
  private windows = new Map<string, RegisteredWindow>();
  private pendingPanelHosts = new Map<string, PendingPanelHost>();
  private editorApi: BrokerEditorApi | null = null;
  /**
   * The last primary-authorized document accepted by this broker. The cache
   * closes the small React commit window after an auxiliary edit is accepted:
   * a second message based on the old revision must be rejected immediately,
   * even before the primary provider has rendered its next snapshot.
   */
  private authoritativeDocumentRevision: number | null = null;
  private authoritativeDocumentJson: string | null = null;
  private patchTimer: ReturnType<typeof setTimeout> | null = null;
  private patchDirty = false;
  private closed = false;

  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.transport = createSessionTransport(sessionId, (eventId, payload) =>
      this.handleMessage(eventId, payload),
    );
  }

  /** Identity of the transport channel this broker owns. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Ensure the primary native listener is armed before creating a child webview. */
  ready(): Promise<void> {
    return this.transport.ready?.() ?? Promise.resolve();
  }

  /** Attach the editor API. */
  attach(editorApi: BrokerEditorApi): void {
    this.editorApi = editorApi;
    // The primary remains the source of truth across a StrictMode hand-off or
    // a replacement editor attachment. Rebuild the short-lived broker cache
    // from its next snapshot rather than carrying a prior provider's state.
    this.authoritativeDocumentRevision = null;
    this.authoritativeDocumentJson = null;
    // StrictMode double-mount: detach() closes the transport; re-attach
    // must bring up a fresh channel or every send fails.
    if (this.closed) {
      this.closed = false;
      this.transport = createSessionTransport(this.sessionId, (eventId, payload) =>
        this.handleMessage(eventId, payload),
      );
    }
  }

  detach(): void {
    if (this.patchTimer) {
      clearTimeout(this.patchTimer);
      this.patchTimer = null;
    }
    this.patchDirty = false;
    for (const pending of [...this.pendingPanelHosts.values()]) {
      this.failPanelHost(pending, 'The primary editor session closed before the panel was ready.');
    }
    this.editorApi = null;
    if (!this.closed) {
      this.closed = true;
      this.transport.close();
    }
  }

  getRegisteredWindows(): RegisteredWindow[] {
    return [...this.windows.values()].map((window) => ({
      ...window,
      panelTypeIds: [...window.panelTypeIds],
    }));
  }

  /** Visible for diagnostics and focused readiness tests. */
  getPendingPanelHosts(): PanelHostReadiness[] {
    return [...this.pendingPanelHosts.values()].map((pending) => ({
      transactionId: pending.transactionId,
      windowId: pending.windowId,
      panelTypeId: pending.panelTypeId,
      panelInstanceId: pending.panelInstanceId,
    }));
  }

  /**
   * Reserve a canonical host identity before creating a native/web window.
   *
   * The caller should create the window only after this returns, pass the
   * reservation identity in its route, then await this promise before hiding
   * the source panel. A missing/failed acknowledgement rejects on a bounded
   * timeout; `abortPanelHost` is the rollback path for native creation errors.
   */
  reservePanelHost(request: PanelHostReservationRequest): Promise<PanelHostReadiness> {
    if (!this.editorApi) {
      recordPanelWindowDiagnostic({
        type: 'invalid-message-rejected',
        transactionId: request.transactionId,
        panelTypeId: request.panelTypeId,
        windowId: request.windowId,
        sessionId: this.sessionId,
        result: 'broker-not-attached',
      });
      return Promise.reject(
        new Error('Cannot reserve a panel host before the editor session is attached.'),
      );
    }
    if (!isReservationRequest(request)) {
      recordPanelWindowDiagnostic({
        type: 'invalid-message-rejected',
        transactionId: request.transactionId,
        panelTypeId: request.panelTypeId,
        windowId: request.windowId,
        sessionId: this.sessionId,
        result: 'invalid-reservation',
      });
      return Promise.reject(new Error('Panel host reservation contains an invalid identity.'));
    }
    if (
      this.pendingPanelHosts.has(request.transactionId) ||
      [...this.pendingPanelHosts.values()].some(
        (pending) => pending.windowId === request.windowId,
      ) ||
      this.windows.has(request.windowId)
    ) {
      recordPanelWindowDiagnostic({
        type: 'stale-message-rejected',
        transactionId: request.transactionId,
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        windowId: request.windowId,
        sessionId: this.sessionId,
        generation: request.generation,
        result: 'duplicate-reservation',
      });
      return Promise.reject(new Error('Panel host identity is already reserved or registered.'));
    }

    const timeoutMs = boundedTimeout(request.timeoutMs);
    recordPanelWindowDiagnostic({
      type: 'destination-host-reserved',
      transactionId: request.transactionId,
      panelTypeId: request.panelTypeId,
      panelInstanceId: request.panelInstanceId,
      destinationWindowId: request.windowId,
      sessionId: this.sessionId,
      protocolVersion: SESSION_BROKER_PROTOCOL_VERSION,
      generation: request.generation ?? 1,
      lifecyclePhase: 'reserved',
    });
    return new Promise<PanelHostReadiness>((resolve, reject) => {
      const pending: PendingPanelHost = {
        ...request,
        generation: request.generation ?? 1,
        timeout: setTimeout(() => {
          const current = this.pendingPanelHosts.get(request.transactionId);
          if (current) {
            this.failPanelHost(
              current,
              'The panel window did not become ready before the timeout.',
            );
          }
        }, timeoutMs),
        resolve,
        reject,
      };
      this.pendingPanelHosts.set(request.transactionId, pending);
    });
  }

  /** Abort a reservation after window creation fails or the transfer is cancelled. */
  abortPanelHost(transactionId: string, reason = 'Panel transfer was cancelled.'): boolean {
    const pending = this.pendingPanelHosts.get(transactionId);
    if (!pending) return false;
    this.failPanelHost(pending, reason);
    return true;
  }

  /** Notify the broker that primary state changed → schedule a patch. */
  notifyStateChanged(): void {
    if (this.patchTimer) return;
    this.patchDirty = true;
    this.patchTimer = setTimeout(() => {
      this.patchTimer = null;
      if (this.patchDirty) this.broadcastPatch();
      this.patchDirty = false;
    }, 50);
  }

  /** Tell the target auxiliary window it now hosts an additional panel. */
  broadcastPanelAdded(panelTypeId: string, windowId: string): void {
    if (!isBoundedString(panelTypeId) || !isBoundedString(windowId)) return;
    const registered = this.windows.get(windowId);
    // Model A deliberately gives each detached panel its own host. Do not
    // let an old grouping caller turn a registered one-panel host into a
    // multi-panel host after the transactional admission check.
    if (!registered) {
      return;
    }
    if (registered.panelTypeIds.length !== 1) {
      return;
    }
    if (registered.panelTypeIds[0] !== panelTypeId) {
      return;
    }
    this.transport.send(
      'panel-added',
      withBrokerMessageMetadata(windowId, registered?.generation ?? 1, { panelTypeId }),
    );
  }

  /** Tell auxiliary windows a panel left a window (reattach/close). */
  broadcastPanelRemoved(panelTypeId: string, windowId: string): void {
    if (!isBoundedString(panelTypeId) || !isBoundedString(windowId)) return;
    const registered = this.windows.get(windowId);
    if (registered?.panelTypeIds.includes(panelTypeId)) {
      this.windows.set(windowId, {
        ...registered,
        panelTypeIds: registered.panelTypeIds.filter((id) => id !== panelTypeId),
      });
    }
    this.transport.send(
      'panel-removed',
      withBrokerMessageMetadata(windowId, registered?.generation ?? 1, { panelTypeId }),
    );
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  private handleMessage(eventId: string, payload: unknown): void {
    const editorApi = this.editorApi;
    if (!editorApi) return;

    switch (eventId) {
      case 'window-ready':
        this.handleWindowReady(payload);
        break;
      case 'window-close':
        if (isWindowCloseMessage(payload) && this.isRegisteredSource(payload)) {
          recordPanelWindowDiagnostic({
            type: 'auxiliary-close-requested',
            windowId: payload.windowId,
            sessionId: this.sessionId,
            protocolVersion: payload.protocolVersion,
            generation: payload.generation,
          });
          this.closeRegisteredWindow(
            payload.windowId,
            payload.generation,
            'The panel window closed.',
          );
        } else {
          recordPanelWindowDiagnostic({
            type: 'stale-message-rejected',
            sessionId: this.sessionId,
            result: 'window-close',
          });
        }
        break;
      case 'panel-hydrated':
        this.handlePanelHydrated(payload);
        break;
      case 'panel-hydration-failed':
        this.handlePanelHydrationFailure(payload);
        break;
      case 'aux-doc-changed':
        if (isExternalDocumentMessage(payload) && this.isRegisteredSource(payload)) {
          this.handleExternalDocumentMutation(payload);
        } else {
          recordPanelWindowDiagnostic({
            type: 'invalid-message-rejected',
            sessionId: this.sessionId,
            result: 'aux-document-mutation',
          });
        }
        break;
      case 'aux-selection-changed':
        if (isExternalSelectionMessage(payload) && this.isRegisteredSource(payload)) {
          editorApi.applyExternalSelection(payload.selection);
        }
        break;
      case 'request-undo':
        if (isWindowMessage(payload) && this.isRegisteredSource(payload)) editorApi.requestUndo();
        break;
      case 'request-redo':
        if (isWindowMessage(payload) && this.isRegisteredSource(payload)) editorApi.requestRedo();
        break;
      case 'request-reattach':
        this.handleReattachRequest(payload);
        break;
      default:
        break;
    }
  }

  /**
   * Apply an auxiliary document only when it was authored from the latest
   * primary document revision. The primary editor is still the mutation
   * authority; this broker merely serializes competing full-document writes
   * and returns a fresh authoritative snapshot to a stale projection.
   */
  private handleExternalDocumentMutation(
    payload: BrokerMessageMetadata & { documentJson: string; baseDocumentRevision: number },
  ): void {
    const editorApi = this.editorApi;
    if (!editorApi) return;

    const snapshot = this.getAuthoritativeSnapshot();
    if (!snapshot) {
      recordPanelWindowDiagnostic({
        type: 'invalid-message-rejected',
        windowId: payload.windowId,
        sessionId: this.sessionId,
        protocolVersion: payload.protocolVersion,
        generation: payload.generation,
        result: 'invalid-primary-snapshot',
      });
      return;
    }

    if (payload.baseDocumentRevision !== snapshot.documentRevision) {
      recordPanelWindowDiagnostic({
        type: 'stale-message-rejected',
        windowId: payload.windowId,
        sessionId: this.sessionId,
        protocolVersion: payload.protocolVersion,
        generation: payload.generation,
        result: 'document-revision-stale',
      });
      // A stale full-document write must never be retried against the old
      // projection. Send only this registered auxiliary host a fresh primary
      // snapshot; normal coalesced patches continue to fan out separately.
      this.sendSnapshot(payload.windowId);
      return;
    }

    this.authoritativeDocumentRevision = snapshot.documentRevision + 1;
    this.authoritativeDocumentJson = payload.documentJson;
    editorApi.applyExternalDocument(payload.documentJson);
    // Do not wait for a later primary render to inform every projection. The
    // cache above supplies the accepted document/revision until React commits.
    this.notifyStateChanged();
  }

  private handleWindowReady(payload: unknown): void {
    if (!isWindowReadyMessage(payload)) {
      recordPanelWindowDiagnostic({
        type: 'invalid-message-rejected',
        sessionId: this.sessionId,
        result: 'window-ready',
      });
      return;
    }

    // A panel-only host is admitted only through the reservation created by
    // the primary before its native/web window exists. Versioning alone is
    // not authority: accepting an unreserved BroadcastChannel sender would
    // expose a snapshot and let it issue editor commands.
    const pending = payload.transactionId
      ? this.pendingPanelHosts.get(payload.transactionId)
      : undefined;
    if (
      !pending ||
      pending.windowId !== payload.windowId ||
      pending.generation !== payload.generation ||
      pending.panelTypeId !== payload.panelTypeId ||
      pending.panelInstanceId !== payload.panelInstanceId ||
      payload.panelTypeIds.length !== 1 ||
      payload.panelTypeIds[0] !== pending.panelTypeId
    ) {
      recordPanelWindowDiagnostic({
        type: 'stale-message-rejected',
        transactionId: payload.transactionId,
        panelTypeId: payload.panelTypeId,
        panelInstanceId: payload.panelInstanceId,
        windowId: payload.windowId,
        sessionId: this.sessionId,
        protocolVersion: payload.protocolVersion,
        generation: payload.generation,
        result: 'window-ready-mismatch',
      });
      return;
    }

    const existing = this.windows.get(payload.windowId);
    if (!existing && this.windows.size >= MAX_AUX_WINDOWS) {
      recordPanelWindowDiagnostic({
        type: 'invalid-message-rejected',
        transactionId: pending.transactionId,
        panelTypeId: pending.panelTypeId,
        panelInstanceId: pending.panelInstanceId,
        windowId: pending.windowId,
        sessionId: this.sessionId,
        generation: pending.generation,
        result: 'window-limit',
      });
      if (pending)
        this.failPanelHost(pending, 'The maximum number of panel windows is already open.');
      return;
    }

    const registered: RegisteredWindow = {
      windowId: payload.windowId,
      generation: payload.generation,
      panelTypeIds: [...new Set(payload.panelTypeIds)],
      transactionId: payload.transactionId,
      registeredAt: Date.now(),
    };
    this.windows.set(payload.windowId, registered);
    recordPanelWindowDiagnostic({
      type: 'destination-host-registered',
      transactionId: pending.transactionId,
      panelTypeId: pending.panelTypeId,
      panelInstanceId: pending.panelInstanceId,
      windowId: payload.windowId,
      sessionId: this.sessionId,
      protocolVersion: payload.protocolVersion,
      generation: payload.generation,
      lifecyclePhase: 'registered',
    });
    recordPanelWindowDiagnostic({
      type: 'panel-hydration-started',
      transactionId: pending.transactionId,
      panelTypeId: pending.panelTypeId,
      panelInstanceId: pending.panelInstanceId,
      windowId: payload.windowId,
      sessionId: this.sessionId,
      protocolVersion: SESSION_BROKER_PROTOCOL_VERSION,
      generation: pending.generation,
      lifecyclePhase: 'snapshot-sent',
    });
    this.sendSnapshot(payload.windowId, pending);
  }

  private handlePanelHydrated(payload: unknown): void {
    if (!isPanelHydrationMessage(payload)) {
      recordPanelWindowDiagnostic({
        type: 'invalid-message-rejected',
        sessionId: this.sessionId,
        result: 'panel-hydrated',
      });
      return;
    }
    if (!this.isRegisteredSource(payload)) {
      recordPanelWindowDiagnostic({
        type: 'stale-message-rejected',
        transactionId: payload.transactionId,
        panelTypeId: payload.panelTypeId,
        panelInstanceId: payload.panelInstanceId,
        windowId: payload.windowId,
        sessionId: this.sessionId,
        protocolVersion: payload.protocolVersion,
        generation: payload.generation,
        result: 'panel-hydrated-source',
      });
      return;
    }
    const pending = this.pendingPanelHosts.get(payload.transactionId);
    if (
      !pending ||
      pending.windowId !== payload.windowId ||
      pending.panelTypeId !== payload.panelTypeId ||
      pending.panelInstanceId !== payload.panelInstanceId
    ) {
      recordPanelWindowDiagnostic({
        type: 'stale-message-rejected',
        transactionId: payload.transactionId,
        panelTypeId: payload.panelTypeId,
        panelInstanceId: payload.panelInstanceId,
        windowId: payload.windowId,
        sessionId: this.sessionId,
        protocolVersion: payload.protocolVersion,
        generation: payload.generation,
        result: 'panel-hydrated-mismatch',
      });
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingPanelHosts.delete(pending.transactionId);
    recordPanelWindowDiagnostic({
      type: 'panel-hydrated',
      transactionId: pending.transactionId,
      panelTypeId: pending.panelTypeId,
      panelInstanceId: pending.panelInstanceId,
      windowId: pending.windowId,
      sessionId: this.sessionId,
      protocolVersion: payload.protocolVersion,
      generation: pending.generation,
      lifecyclePhase: 'acknowledged',
    });
    pending.resolve({
      transactionId: pending.transactionId,
      windowId: pending.windowId,
      panelTypeId: pending.panelTypeId,
      panelInstanceId: pending.panelInstanceId,
    });
  }

  private handlePanelHydrationFailure(payload: unknown): void {
    if (!isPanelHydrationFailureMessage(payload)) {
      recordPanelWindowDiagnostic({
        type: 'invalid-message-rejected',
        sessionId: this.sessionId,
        result: 'panel-hydration-failed',
      });
      return;
    }
    if (!this.isRegisteredSource(payload)) {
      recordPanelWindowDiagnostic({
        type: 'stale-message-rejected',
        transactionId: payload.transactionId,
        panelTypeId: payload.panelTypeId,
        panelInstanceId: payload.panelInstanceId,
        windowId: payload.windowId,
        sessionId: this.sessionId,
        protocolVersion: payload.protocolVersion,
        generation: payload.generation,
        result: 'panel-hydration-failure-source',
      });
      return;
    }
    const pending = this.pendingPanelHosts.get(payload.transactionId);
    if (
      !pending ||
      pending.windowId !== payload.windowId ||
      pending.panelTypeId !== payload.panelTypeId ||
      pending.panelInstanceId !== payload.panelInstanceId
    ) {
      recordPanelWindowDiagnostic({
        type: 'stale-message-rejected',
        transactionId: payload.transactionId,
        panelTypeId: payload.panelTypeId,
        panelInstanceId: payload.panelInstanceId,
        windowId: payload.windowId,
        sessionId: this.sessionId,
        protocolVersion: payload.protocolVersion,
        generation: payload.generation,
        result: 'panel-hydration-failure-mismatch',
      });
      return;
    }
    recordPanelWindowDiagnostic({
      type: 'panel-hydration-failed',
      transactionId: pending.transactionId,
      panelTypeId: pending.panelTypeId,
      panelInstanceId: pending.panelInstanceId,
      windowId: pending.windowId,
      sessionId: this.sessionId,
      protocolVersion: payload.protocolVersion,
      generation: pending.generation,
      errorCode: 'auxiliary-hydration-failed',
    });
    this.failPanelHost(pending, payload.reason);
  }

  private handleReattachRequest(payload: unknown): void {
    if (!isWindowReadyMessage(payload) || !this.isRegisteredSource(payload)) {
      recordPanelWindowDiagnostic({
        type: 'stale-message-rejected',
        sessionId: this.sessionId,
        result: 'reattach-request',
      });
      return;
    }
    if (payload.panelTypeIds.length === 0) return;

    const registered = this.windows.get(payload.windowId);
    if (!registered) return;
    const requested = [...new Set(payload.panelTypeIds)];
    if (requested.some((panelTypeId) => !registered.panelTypeIds.includes(panelTypeId))) return;

    recordPanelWindowDiagnostic({
      type: 'dock-requested',
      transactionId: registered.transactionId,
      panelTypeId: requested[0],
      sourceWindowId: payload.windowId,
      destinationWindowId: 'main',
      sessionId: this.sessionId,
      protocolVersion: payload.protocolVersion,
      generation: payload.generation,
    });

    this.windows.delete(payload.windowId);
    this.reattachPanels(requested);
    if (registered.transactionId) {
      const pending = this.pendingPanelHosts.get(registered.transactionId);
      if (pending)
        this.failPanelHost(pending, 'The panel was reattached before hydration completed.', false);
    }
    this.transport.send(
      'reattach-ack',
      withBrokerMessageMetadata(payload.windowId, payload.generation, {
        accepted: true,
        panelTypeIds: requested,
      }),
    );
  }

  private isRegisteredSource(message: BrokerMessageMetadata): boolean {
    const registered = this.windows.get(message.windowId);
    return registered?.generation === message.generation;
  }

  private closeRegisteredWindow(windowId: string, generation: number, reason: string): void {
    const registered = this.windows.get(windowId);
    if (!registered || registered.generation !== generation) return;
    this.windows.delete(windowId);
    this.reattachPanels(registered.panelTypeIds);

    if (registered.transactionId) {
      const pending = this.pendingPanelHosts.get(registered.transactionId);
      if (pending) this.failPanelHost(pending, reason, false);
    }
    recordPanelWindowDiagnostic({
      type: 'host-cleanup-completed',
      transactionId: registered.transactionId,
      panelTypeId: registered.panelTypeIds[0],
      windowId,
      sessionId: this.sessionId,
      generation,
      result: 'closed',
    });
  }

  private reattachPanels(panelTypeIds: string[]): void {
    const editorApi = this.editorApi;
    if (!editorApi) return;
    for (const panelTypeId of new Set(panelTypeIds)) {
      editorApi.reattachPanel(panelTypeId);
    }
  }

  private failPanelHost(pending: PendingPanelHost, reason: string, reattach = true): void {
    clearTimeout(pending.timeout);
    this.pendingPanelHosts.delete(pending.transactionId);

    const registered = this.windows.get(pending.windowId);
    if (registered?.transactionId === pending.transactionId) {
      this.windows.delete(pending.windowId);
      if (reattach) this.reattachPanels(registered.panelTypeIds);
    }
    recordPanelWindowDiagnostic({
      type: 'host-cleanup-completed',
      transactionId: pending.transactionId,
      panelTypeId: pending.panelTypeId,
      panelInstanceId: pending.panelInstanceId,
      windowId: pending.windowId,
      sessionId: this.sessionId,
      generation: pending.generation,
      result: reattach ? 'rollback-reattached' : 'rollback',
    });
    pending.reject(new Error(reason));
  }

  // -------------------------------------------------------------------------
  // Snapshot + patches
  // -------------------------------------------------------------------------

  /**
   * Read the primary's current snapshot while retaining an accepted auxiliary
   * mutation through the asynchronous primary-provider commit. A primary
   * snapshot with a newer revision always wins over this transient cache.
   */
  private getAuthoritativeSnapshot(): BrokerSnapshot | null {
    const editorApi = this.editorApi;
    if (!editorApi) return null;
    const snapshot = editorApi.getSnapshot();
    if (!isBrokerSnapshot(snapshot)) return null;

    if (
      this.authoritativeDocumentRevision === null ||
      snapshot.documentRevision > this.authoritativeDocumentRevision ||
      // A primary document switch/load can legitimately replace the JSON
      // while retaining its session revision. The primary is authoritative in
      // that tie; retaining an old cache would hydrate a new panel host with
      // a previous document, as happened after a newly-created document was
      // edited before its first detach.
      (snapshot.documentRevision === this.authoritativeDocumentRevision &&
        snapshot.documentJson !== this.authoritativeDocumentJson)
    ) {
      this.authoritativeDocumentRevision = snapshot.documentRevision;
      this.authoritativeDocumentJson = snapshot.documentJson;
    }

    return {
      ...snapshot,
      documentJson: this.authoritativeDocumentJson ?? snapshot.documentJson,
      documentRevision: this.authoritativeDocumentRevision ?? snapshot.documentRevision,
    };
  }

  private sendSnapshot(targetWindowId: string, pending?: PendingPanelHost): void {
    const snapshot = this.getAuthoritativeSnapshot();
    if (!snapshot) {
      if (pending)
        this.failPanelHost(pending, 'The primary editor produced an invalid session snapshot.');
      return;
    }

    const transfer = pending
      ? {
          transactionId: pending.transactionId,
          panelTypeId: pending.panelTypeId,
          panelInstanceId: pending.panelInstanceId,
          ...(pending.transferSnapshot === undefined
            ? {}
            : { transferSnapshot: pending.transferSnapshot }),
        }
      : undefined;
    this.transport.send('session-snapshot', {
      protocolVersion: SESSION_BROKER_PROTOCOL_VERSION,
      target: targetWindowId,
      snapshot,
      ...(transfer ? { transfer } : {}),
    });
  }

  private broadcastPatch(): void {
    const snapshot = this.getAuthoritativeSnapshot();
    if (!snapshot) return;
    this.transport.send('session-patch', {
      protocolVersion: SESSION_BROKER_PROTOCOL_VERSION,
      patch: {
        documentJson: snapshot.documentJson,
        documentRevision: snapshot.documentRevision,
        selection: snapshot.selection,
        workspaceMode: snapshot.workspaceMode,
        canUndo: snapshot.canUndo,
        canRedo: snapshot.canRedo,
        detachedPanels: snapshot.detachedPanels,
      },
    });
  }

  /**
   * Drop a crashed auxiliary host. This is intentionally equivalent to a
   * close: a panel must never remain hidden in the primary after its host is
   * gone.
   */
  unregister(windowId: string): void {
    const registered = this.windows.get(windowId);
    if (!registered) return;
    this.closeRegisteredWindow(
      windowId,
      registered.generation,
      'The panel window became unavailable.',
    );
  }
}

let broker: SessionBroker | null = null;

/** Get or create the singleton broker for a session. */
export function getSessionBroker(sessionId?: string): SessionBroker | null {
  // A stale auxiliary must never get a handle to a newer primary session.
  // Replacement is intentionally owned by attachSessionBroker below.
  if (broker) return !sessionId || broker.getSessionId() === sessionId ? broker : null;
  if (!sessionId) return null;
  broker = new SessionBroker(sessionId);
  return broker;
}

export function attachSessionBroker(editorApi: BrokerEditorApi): () => void {
  const sessionId = editorApi.getSessionId();
  if (broker && broker.getSessionId() !== sessionId) {
    broker.detach();
    broker = null;
  }
  const b = getSessionBroker(sessionId);
  if (!b) return () => {};
  b.attach(editorApi);
  return () => b.detach();
}

export function resetSessionBroker(): void {
  broker?.detach();
  broker = null;
}
