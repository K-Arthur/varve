/**
 * Session broker (ADR-0204/0207) — primary-window authority for
 * auxiliary-window communication.
 *
 * Responsibilities:
 * - Accept window registration (window-ready)
 * - Serve validated session snapshots (document, selection, mode, theme)
 * - Broadcast state patches on primary-side changes (coalesced)
 * - Apply document/selection changes submitted by auxiliary windows as the
 *   authoritative edit (undo history lives in the primary window)
 * - Handle request-undo / request-redo exactly once
 * - Handle reattach (drop window, clear detached record)
 * - Track window generations (reloads invalidate stale windows)
 *
 * Transport-agnostic: receives/sends {eventId, payload} pairs through the
 * session transport.
 */

import type { DetachedPanelRecord } from './detachedPanelsStore';
import { createSessionTransport, type Transport } from './sessionTransport';

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
  activeDocumentId: string;
  activeDocumentName: string;
  selection: string[];
  workspaceMode: string;
  theme: string;
  canUndo: boolean;
  canRedo: boolean;
  detachedPanels: DetachedPanelRecord[];
}

// ---------------------------------------------------------------------------
// Window registry
// ---------------------------------------------------------------------------

interface RegisteredWindow {
  windowId: string;
  generation: number;
  registeredAt: number;
}

const MAX_AUX_WINDOWS = 8;

export class SessionBroker {
  private transport: Transport;
  private windows = new Map<string, RegisteredWindow>();
  private editorApi: BrokerEditorApi | null = null;
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

  /** Attach the editor API. */
  attach(editorApi: BrokerEditorApi): void {
    this.editorApi = editorApi;
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
    this.editorApi = null;
    if (!this.closed) {
      this.closed = true;
      this.transport.close();
    }
  }

  getRegisteredWindows(): RegisteredWindow[] {
    return [...this.windows.values()];
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

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  private handleMessage(eventId: string, payload: unknown): void {
    const editorApi = this.editorApi;
    if (!editorApi) return;

    switch (eventId) {
      case 'window-ready': {
        const msg = payload as { windowId?: string; generation?: number } | null;
        if (!msg?.windowId) return;
        if (this.windows.size >= MAX_AUX_WINDOWS) return;
        this.windows.set(msg.windowId, {
          windowId: msg.windowId,
          generation: msg.generation ?? 1,
          registeredAt: Date.now(),
        });
        this.sendSnapshot(msg.windowId);
        break;
      }
      case 'window-close': {
        const msg = payload as { windowId?: string } | null;
        if (msg?.windowId) this.windows.delete(msg.windowId);
        break;
      }
      case 'aux-doc-changed': {
        const msg = payload as { documentJson?: string } | null;
        if (msg?.documentJson) editorApi.applyExternalDocument(msg.documentJson);
        break;
      }
      case 'aux-selection-changed': {
        const msg = payload as { selection?: string[] } | null;
        if (msg?.selection) editorApi.applyExternalSelection(msg.selection);
        break;
      }
      case 'request-undo':
        editorApi.requestUndo();
        break;
      case 'request-redo':
        editorApi.requestRedo();
        break;
      case 'request-reattach': {
        const msg = payload as { windowId?: string; panelTypeId?: string } | null;
        if (!msg?.windowId || !msg.panelTypeId) return;
        this.windows.delete(msg.windowId);
        editorApi.reattachPanel(msg.panelTypeId);
        this.transport.send('reattach-ack', {
          windowId: msg.windowId,
          panelTypeId: msg.panelTypeId,
          accepted: true,
        });
        break;
      }
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot + patches
  // -------------------------------------------------------------------------

  private sendSnapshot(targetWindowId: string): void {
    const editorApi = this.editorApi;
    if (!editorApi) return;
    this.transport.send('session-snapshot', {
      target: targetWindowId,
      snapshot: editorApi.getSnapshot(),
    });
  }

  private broadcastPatch(): void {
    const editorApi = this.editorApi;
    if (!editorApi) return;
    const snapshot = editorApi.getSnapshot();
    this.transport.send('session-patch', {
      patch: {
        documentJson: snapshot.documentJson,
        selection: snapshot.selection,
        workspaceMode: snapshot.workspaceMode,
        canUndo: snapshot.canUndo,
        canRedo: snapshot.canRedo,
        detachedPanels: snapshot.detachedPanels,
      },
    });
  }

  /** Drop a window (crash detection hook). */
  unregister(windowId: string): void {
    this.windows.delete(windowId);
  }
}

let broker: SessionBroker | null = null;

/** Get or create the singleton broker for a session. */
export function getSessionBroker(sessionId?: string): SessionBroker | null {
  if (broker) return broker;
  if (!sessionId) return null;
  broker = new SessionBroker(sessionId);
  return broker;
}

export function attachSessionBroker(editorApi: BrokerEditorApi): () => void {
  const b = getSessionBroker(editorApi.getSessionId());
  if (!b) return () => {};
  b.attach(editorApi);
  return () => b.detach();
}

export function resetSessionBroker(): void {
  broker?.detach();
  broker = null;
}
