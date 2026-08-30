/**
 * Auxiliary window context — the session bridge (ADR-0204).
 *
 * Connects the auxiliary window to the primary window's session broker
 * over the session transport:
 *
 * Downstream (primary → aux):
 * - session-snapshot → initial document/selection/mode for EditorProvider
 * - session-patch   → externalState for EditorProvider (revision-guarded)
 *
 * Upstream (aux → primary):
 * - EditorProvider onMutation       → aux-doc-changed (document JSON)
 * - EditorProvider onSelectionChange → aux-selection-changed
 * - reattach request                → request-reattach, then window.close()
 *
 * The primary window remains the single authority for document state,
 * undo, and redo; the auxiliary EditorProvider is a live projection.
 */

import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type BrokerSnapshot,
  isPanelMembershipMessage,
  isReattachAckMessage,
  isSessionPatchMessage,
  isSessionSnapshotMessage,
  type PanelHostTransfer,
  withBrokerMessageMetadata,
} from '../workspace/sessionBroker';
import { createSessionTransport, type Transport } from '../workspace/sessionTransport';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuxiliarySessionState {
  connected: boolean;
  /** Latest snapshot received from the primary window. */
  snapshot: BrokerSnapshot | null;
  /** External state for EditorProvider (revision-guarded). */
  externalState: {
    documentJson: string;
    selection: string[];
    /** Transport delivery revision used only to ignore duplicate payloads. */
    revision: number;
    /** Primary-authoritative base revision for an auxiliary document edit. */
    documentRevision: number;
  } | null;
  /** Incremented on every received patch/snapshot. */
  revision: number;
  /** Transfer state that must be restored before acknowledging the host. */
  transfer: PanelHostTransfer | null;
}

export interface AuxiliarySessionContextValue {
  state: AuxiliarySessionState;
  /** Panel type ids currently hosted in THIS window (mutable). */
  panelTypeIds: string[];
  /** Add a panel hosted in this window (primary-driven, panel-added). */
  addPanelType: (panelTypeId: string) => void;
  /** Remove a panel from this window (primary-driven, panel-removed). */
  removePanelType: (panelTypeId: string) => void;
  /** Request undo from the primary window. */
  requestUndo: () => void;
  /** Request redo from the primary window. */
  requestRedo: () => void;
  /** Reattach this window's panel(s) back to the primary window. */
  reattach: () => void;
  /** Confirm that the transferred panel's state has been restored and rendered. */
  acknowledgeHydration: () => void;
  /** Reject a transfer when panel-local state could not be restored. */
  reportHydrationFailure: (reason: string) => void;
  /** Send an arbitrary event upstream (bridge for the shell). */
  send: (eventId: string, payload: unknown) => void;
}

const AuxiliarySessionContext = createContext<AuxiliarySessionContextValue | null>(null);

export function useAuxiliarySession(): AuxiliarySessionContextValue {
  const ctx = useContext(AuxiliarySessionContext);
  if (!ctx) throw new Error('useAuxiliarySession must be used within AuxiliarySessionProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface AuxiliarySessionProviderProps {
  children: ReactNode;
  windowId: string;
  sessionId: string;
  panelTypeIds: string[];
  /** Supplied in the auxiliary route for a transactional panel detach. */
  transactionId?: string;
  /** Canonical panel instance id supplied with `transactionId`. */
  panelInstanceId?: string;
  /** Incremented by a future reload/recovery coordinator. */
  generation?: number;
}

export function AuxiliarySessionProvider({
  children,
  windowId,
  sessionId,
  panelTypeIds,
  transactionId,
  panelInstanceId,
  generation = 1,
}: AuxiliarySessionProviderProps) {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<BrokerSnapshot | null>(null);
  const [externalState, setExternalState] = useState<AuxiliarySessionState['externalState']>(null);
  const [transfer, setTransfer] = useState<PanelHostTransfer | null>(null);
  const [membership, setMembership] = useState<string[]>(() => [...panelTypeIds]);
  const revisionRef = useRef(0);
  const documentRevisionRef = useRef<number | null>(null);
  const transportRef = useRef<Transport | null>(null);
  // snapshotRef so the patch handler can read the latest snapshot.
  const snapshotRef = useRef<BrokerSnapshot | null>(null);
  const transferRef = useRef<PanelHostTransfer | null>(null);
  const acknowledgedTransferRef = useRef<string | null>(null);
  // React StrictMode intentionally cleans up and re-runs effects once during
  // development. A close signal in that tiny hand-off looks exactly like a
  // real auxiliary-window crash to the primary, so defer it one task and let
  // the replacement effect cancel it when this is only an effect replay.
  const deferredCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  snapshotRef.current = snapshot;
  transferRef.current = transfer;

  const addPanelType = useCallback((panelTypeId: string) => {
    setMembership((prev) => (prev.includes(panelTypeId) ? prev : [...prev, panelTypeId]));
  }, []);

  const removePanelType = useCallback((panelTypeId: string) => {
    setMembership((prev) => prev.filter((id) => id !== panelTypeId));
  }, []);

  const handleMessage = useCallback(
    (eventId: string, payload: unknown) => {
      switch (eventId) {
        case 'session-snapshot': {
          if (!isSessionSnapshotMessage(payload) || payload.target !== windowId) return;
          const msg = payload;
          if (
            documentRevisionRef.current !== null &&
            msg.snapshot.documentRevision < documentRevisionRef.current
          ) {
            return;
          }
          revisionRef.current += 1;
          documentRevisionRef.current = msg.snapshot.documentRevision;
          snapshotRef.current = msg.snapshot;
          setSnapshot(msg.snapshot);
          setTransfer(msg.transfer ?? null);
          acknowledgedTransferRef.current = null;
          setExternalState({
            documentJson: msg.snapshot.documentJson,
            selection: msg.snapshot.selection,
            revision: revisionRef.current,
            documentRevision: msg.snapshot.documentRevision,
          });
          setConnected(true);
          break;
        }
        case 'session-patch': {
          if (!isSessionPatchMessage(payload)) return;
          const msg = payload;
          if (
            documentRevisionRef.current !== null &&
            msg.patch.documentRevision < documentRevisionRef.current
          ) {
            return;
          }
          revisionRef.current += 1;
          documentRevisionRef.current = msg.patch.documentRevision;
          const nextSnapshot = snapshotRef.current
            ? { ...snapshotRef.current, ...msg.patch }
            : null;
          if (nextSnapshot) {
            snapshotRef.current = nextSnapshot;
            setSnapshot(nextSnapshot);
          }
          if (msg.patch.documentJson !== undefined || msg.patch.selection !== undefined) {
            setExternalState({
              documentJson: nextSnapshot?.documentJson ?? '',
              selection: nextSnapshot?.selection ?? [],
              revision: revisionRef.current,
              documentRevision: nextSnapshot?.documentRevision ?? msg.patch.documentRevision,
            });
          }
          break;
        }
        case 'panel-added': {
          if (isPanelMembershipMessage(payload) && payload.windowId === windowId) {
            const msg = payload;
            addPanelType(msg.panelTypeId);
          }
          break;
        }
        case 'panel-removed': {
          if (isPanelMembershipMessage(payload) && payload.windowId === windowId) {
            const msg = payload;
            removePanelType(msg.panelTypeId);
          }
          break;
        }
        case 'reattach-ack': {
          if (
            isReattachAckMessage(payload) &&
            payload.windowId === windowId &&
            payload.generation === generation &&
            payload.accepted
          ) {
            // Primary confirmed: close this window.
            window.close();
          }
          break;
        }
        default:
          break;
      }
    },
    [windowId, generation, addPanelType, removePanelType],
  );

  // Connect transport once (registration is a one-shot; membership changes
  // are driven by the primary via panel-added/panel-removed).
  useEffect(() => {
    if (deferredCloseRef.current) {
      clearTimeout(deferredCloseRef.current);
      deferredCloseRef.current = null;
    }
    const transport = createSessionTransport(sessionId, handleMessage);
    transportRef.current = transport;

    // Register with the primary window. A transactional route proves the
    // canonical identities reserved before its native/browser window opened.
    transport.send(
      'window-ready',
      withBrokerMessageMetadata(windowId, generation, {
        panelTypeIds: [...panelTypeIds],
        ...(transactionId === undefined ? {} : { transactionId }),
        ...(panelTypeIds.length === 1 ? { panelTypeId: panelTypeIds[0] } : {}),
        ...(panelInstanceId === undefined ? {} : { panelInstanceId }),
      }),
    );

    const onBeforeUnload = () => {
      transport.send('window-close', withBrokerMessageMetadata(windowId, generation, {}));
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      transport.close();
      if (transportRef.current === transport) transportRef.current = null;
      deferredCloseRef.current = setTimeout(() => {
        // Build a short-lived transport after the old one is closed. This is
        // a real unmount only if the next effect has not cancelled the task.
        const closeTransport = createSessionTransport(sessionId, () => {});
        closeTransport.send('window-close', withBrokerMessageMetadata(windowId, generation, {}));
        closeTransport.close();
        deferredCloseRef.current = null;
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, windowId, generation, transactionId, panelInstanceId, handleMessage]);

  const send = useCallback(
    (eventId: string, payload: unknown) => {
      const messagePayload =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : { value: payload };
      transportRef.current?.send(
        eventId,
        withBrokerMessageMetadata(windowId, generation, messagePayload),
      );
    },
    [windowId, generation],
  );

  const requestUndo = useCallback(() => {
    send('request-undo', {});
  }, [send]);

  const requestRedo = useCallback(() => {
    send('request-redo', {});
  }, [send]);

  const reattach = useCallback(() => {
    // The primary window owns the detached-panels store: it clears the
    // records in broker.reattachPanel and broadcasts; this window closes on
    // reattach-ack.
    setMembership((current) => {
      if (current.length > 0) {
        send('request-reattach', { panelTypeIds: current });
      }
      return current;
    });
  }, [send]);

  const acknowledgeHydration = useCallback(() => {
    const pending = transferRef.current;
    if (!pending || acknowledgedTransferRef.current === pending.transactionId) return;
    acknowledgedTransferRef.current = pending.transactionId;
    send('panel-hydrated', {
      transactionId: pending.transactionId,
      panelTypeId: pending.panelTypeId,
      panelInstanceId: pending.panelInstanceId,
    });
  }, [send]);

  const reportHydrationFailure = useCallback(
    (reason: string) => {
      const pending = transferRef.current;
      if (!pending) return;
      send('panel-hydration-failed', {
        transactionId: pending.transactionId,
        panelTypeId: pending.panelTypeId,
        panelInstanceId: pending.panelInstanceId,
        reason: reason.slice(0, 512) || 'The panel state could not be restored.',
      });
    },
    [send],
  );

  const value = useMemo<AuxiliarySessionContextValue>(
    () => ({
      state: { connected, snapshot, externalState, revision: revisionRef.current, transfer },
      panelTypeIds: membership,
      addPanelType,
      removePanelType,
      requestUndo,
      requestRedo,
      reattach,
      acknowledgeHydration,
      reportHydrationFailure,
      send,
    }),
    [
      connected,
      snapshot,
      externalState,
      transfer,
      membership,
      addPanelType,
      removePanelType,
      requestUndo,
      requestRedo,
      reattach,
      acknowledgeHydration,
      reportHydrationFailure,
      send,
    ],
  );

  return (
    <AuxiliarySessionContext.Provider value={value}>{children}</AuxiliarySessionContext.Provider>
  );
}
