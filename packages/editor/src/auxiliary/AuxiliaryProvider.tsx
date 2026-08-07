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
import type { BrokerSnapshot } from '../workspace/sessionBroker';
import { createSessionTransport, type Transport } from '../workspace/sessionTransport';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuxiliarySessionState {
  connected: boolean;
  /** Latest snapshot received from the primary window. */
  snapshot: BrokerSnapshot | null;
  /** External state for EditorProvider (revision-guarded). */
  externalState: { documentJson: string; selection: string[]; revision: number } | null;
  /** Incremented on every received patch/snapshot. */
  revision: number;
}

export interface AuxiliarySessionContextValue {
  state: AuxiliarySessionState;
  /** Request undo from the primary window. */
  requestUndo: () => void;
  /** Request redo from the primary window. */
  requestRedo: () => void;
  /** Reattach this window's panel(s) back to the primary window. */
  reattach: () => void;
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
}

export function AuxiliarySessionProvider({
  children,
  windowId,
  sessionId,
  panelTypeIds,
}: AuxiliarySessionProviderProps) {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<BrokerSnapshot | null>(null);
  const [externalState, setExternalState] = useState<AuxiliarySessionState['externalState']>(null);
  const revisionRef = useRef(0);
  const transportRef = useRef<Transport | null>(null);
  // snapshotRef so the patch handler can read the latest snapshot.
  const snapshotRef = useRef<BrokerSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const handleMessage = useCallback(
    (eventId: string, payload: unknown) => {
      switch (eventId) {
        case 'session-snapshot': {
          const msg = payload as { target?: string; snapshot?: BrokerSnapshot } | null;
          if (!msg?.snapshot || (msg.target && msg.target !== windowId)) return;
          revisionRef.current += 1;
          setSnapshot(msg.snapshot);
          setExternalState({
            documentJson: msg.snapshot.documentJson,
            selection: msg.snapshot.selection,
            revision: revisionRef.current,
          });
          setConnected(true);
          break;
        }
        case 'session-patch': {
          const msg = payload as { patch?: Partial<BrokerSnapshot> } | null;
          if (!msg?.patch) return;
          revisionRef.current += 1;
          if (msg.patch.documentJson || msg.patch.selection) {
            setExternalState({
              documentJson: msg.patch.documentJson ?? snapshotRef.current?.documentJson ?? '',
              selection: msg.patch.selection ?? snapshotRef.current?.selection ?? [],
              revision: revisionRef.current,
            });
          }
          if (msg.patch.workspaceMode || msg.patch.canUndo !== undefined) {
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    ...msg.patch,
                  }
                : prev,
            );
          }
          break;
        }
        case 'reattach-ack':
          // Primary confirmed: close this window.
          window.close();
          break;
        default:
          break;
      }
    },
    [windowId],
  );

  // Connect transport once.
  useEffect(() => {
    const transport = createSessionTransport(sessionId, handleMessage);
    transportRef.current = transport;

    // Register with the primary window.
    transport.send('window-ready', { windowId, generation: 1, panelTypeIds });

    const onBeforeUnload = () => {
      transport.send('window-close', { windowId });
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      transport.send('window-close', { windowId });
      transport.close();
      transportRef.current = null;
    };
  }, [sessionId, windowId, panelTypeIds, handleMessage]);

  const send = useCallback((eventId: string, payload: unknown) => {
    transportRef.current?.send(eventId, payload);
  }, []);

  const requestUndo = useCallback(() => {
    transportRef.current?.send('request-undo', { windowId });
  }, [windowId]);

  const requestRedo = useCallback(() => {
    transportRef.current?.send('request-redo', { windowId });
  }, [windowId]);

  const reattach = useCallback(() => {
    // The primary window owns the detached-panels store: it clears the
    // record in broker.reattachPanel and broadcasts; this window closes on
    // reattach-ack.
    transportRef.current?.send('request-reattach', {
      windowId,
      panelTypeId: panelTypeIds[0],
    });
  }, [windowId, panelTypeIds]);

  const value = useMemo<AuxiliarySessionContextValue>(
    () => ({
      state: { connected, snapshot, externalState, revision: revisionRef.current },
      requestUndo,
      requestRedo,
      reattach,
      send,
    }),
    [connected, snapshot, externalState, requestUndo, requestRedo, reattach, send],
  );

  return (
    <AuxiliarySessionContext.Provider value={value}>{children}</AuxiliarySessionContext.Provider>
  );
}
