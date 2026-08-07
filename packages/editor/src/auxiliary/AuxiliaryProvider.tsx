/**
 * Auxiliary window context — minimal provider tree for panel-only windows.
 *
 * An auxiliary window does NOT mount the full EditorProvider (which owns
 * document state, undo, selection, canvas, etc.). Instead it receives
 * a synchronized projection from the primary window via the session
 * protocol and renders only the hosted panel(s).
 *
 * This module provides:
 * - `AuxiliarySession` context with synchronized shared state
 * - `useAuxiliarySession()` hook for panels to read shared state
 * - `useSubmitCommand()` hook for panels to submit commands to the primary
 */

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shared state that panel windows need. */
export interface AuxiliarySessionState {
  /** Active document identity. */
  activeDocumentId: string;
  /** Document name for display. */
  activeDocumentName: string;
  /** Current workspace mode. */
  workspaceMode: string;
  /** Current selection (node ids). */
  selection: string[];
  /** Theme. */
  theme: string;
  /** Locale. */
  locale: string;
  /** Can undo in the primary session. */
  canUndo: boolean;
  /** Can redo in the primary session. */
  canRedo: boolean;
  /** Protocol revision of the last received snapshot/patch. */
  lastRevision: number;
  /** Window generation (incremented on reload). */
  generation: number;
}

export interface AuxiliarySessionContextValue {
  state: AuxiliarySessionState;
  /** Submit a command to the primary window's command authority. */
  submitCommand: (commandType: string, payload: unknown) => void;
  /** Request undo from the primary window. */
  requestUndo: () => void;
  /** Request redo from the primary window. */
  requestRedo: () => void;
  /** Whether the session is connected to the primary window. */
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

const DEFAULT_STATE: AuxiliarySessionState = {
  activeDocumentId: '',
  activeDocumentName: '',
  workspaceMode: 'design',
  selection: [],
  theme: 'light',
  locale: 'en',
  canUndo: false,
  canRedo: false,
  lastRevision: 0,
  generation: 0,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

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
  /** Initial state from the session snapshot. */
  initialState?: Partial<AuxiliarySessionState>;
  /** Callback to send messages to the primary window. */
  onSendMessage?: (eventId: string, payload: unknown) => void;
}

export function AuxiliarySessionProvider({
  children,
  initialState,
  onSendMessage,
}: AuxiliarySessionProviderProps) {
  const [state, setState] = useState<AuxiliarySessionState>({
    ...DEFAULT_STATE,
    ...initialState,
  });
  const [connected, setConnected] = useState(false);
  const generationRef = useRef(0);

  // Handle incoming patches from the primary window
  const handlePatch = useCallback((patches: Array<{ path: string; value: unknown }>) => {
    setState((prev) => {
      const next = { ...prev };
      for (const patch of patches) {
        const key = patch.path.split('.')[0]!;
        if (key in next) {
          (next as Record<string, unknown>)[key] = patch.value;
        }
      }
      next.lastRevision = (next.lastRevision || 0) + 1;
      return next;
    });
  }, []);

  // Handle fresh snapshot from the primary window
  const handleSnapshot = useCallback((snapshot: Partial<AuxiliarySessionState>) => {
    setState((prev) => ({
      ...prev,
      ...snapshot,
      lastRevision: ((snapshot as Record<string, unknown>).revision as number) ?? prev.lastRevision,
    }));
    setConnected(true);
  }, []);

  // Handle connection state changes
  const handleConnect = useCallback(() => setConnected(true), []);
  const handleDisconnect = useCallback(() => setConnected(false), []);

  // Handle window reload (increment generation)
  const handleReload = useCallback(() => {
    generationRef.current += 1;
    setState((prev) => ({ ...prev, generation: generationRef.current }));
  }, []);

  const submitCommand = useCallback(
    (commandType: string, payload: unknown) => {
      onSendMessage?.('submit-command', {
        kind: 'submit-command',
        commandType,
        payload,
      });
    },
    [onSendMessage],
  );

  const requestUndo = useCallback(() => {
    onSendMessage?.('request-undo', { kind: 'request-undo' });
  }, [onSendMessage]);

  const requestRedo = useCallback(() => {
    onSendMessage?.('request-redo', { kind: 'request-redo' });
  }, [onSendMessage]);

  // Expose handlers for the transport layer to call
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__auxiliarySessionHandlers = {
      onPatch: handlePatch,
      onSnapshot: handleSnapshot,
      onConnect: handleConnect,
      onDisconnect: handleDisconnect,
      onReload: handleReload,
    };
    return () => {
      delete w.__auxiliarySessionHandlers;
    };
  }, [handlePatch, handleSnapshot, handleConnect, handleDisconnect, handleReload]);

  const value: AuxiliarySessionContextValue = {
    state,
    submitCommand,
    requestUndo,
    requestRedo,
    connected,
  };

  return (
    <AuxiliarySessionContext.Provider value={value}>{children}</AuxiliarySessionContext.Provider>
  );
}
