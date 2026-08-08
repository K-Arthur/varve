/**
 * useDetachedPanels — Shell-side integration for the multi-window session.
 *
 * One hook that:
 * - Subscribes to the detached-panels store (Shell hides detached panels)
 * - Attaches the session broker with the live editor API:
 *   - getSnapshot: serializes current document/selection/mode for aux windows
 *   - applyExternalDocument: aux-originated document → primary updateDoc
 *     (single undo authority; pushes one undo step)
 *   - applyExternalSelection: aux-originated selection → primary setSelection
 *   - requestUndo/requestRedo: exactly-once undo/redo
 *   - reattachPanel: clears the detached record (panel returns to dock)
 * - Notifies the broker whenever primary state changes (coalesced patch)
 *
 * Shell imports exactly ONE module for the whole multi-window session
 * integration (keeps Shell's import budget intact).
 */

import { getWindowService } from '@varve/platform';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorContextValue } from '../context';
import {
  getDetachedPanels,
  isPanelDetached,
  markPanelReattached,
  subscribeDetachedPanels,
} from './detachedPanelsStore';
import type { PanelTypeId } from './panelRegistry';
import type { BrokerSnapshot } from './sessionBroker';
import { attachSessionBroker, getSessionBroker } from './sessionBroker';
import { savePanelPlacement } from './workspaceManager';

export interface DetachedPanelsController {
  /** Panel type ids currently hosted in auxiliary windows. */
  detached: Set<PanelTypeId>;
  /** Whether a specific panel is detached. */
  isDetached(panelTypeId: PanelTypeId): boolean;
}

const SESSION_ID = 'current';

export function useDetachedPanels(editor: EditorContextValue): DetachedPanelsController {
  const [detached, setDetached] = useState<Set<PanelTypeId>>(
    () => new Set(getDetachedPanels().map((r) => r.panelTypeId)),
  );

  // Live editor reference — the broker API must never go stale.
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Subscribe to the detached store (single subscription).
  useEffect(() => {
    return subscribeDetachedPanels((records) => {
      setDetached(new Set(records.map((r) => r.panelTypeId)));
    });
  }, []);

  // Attach the session broker once; all closures read editorRef.current.
  useEffect(() => {
    const getSnapshot = (): BrokerSnapshot => {
      const s = editorRef.current.state;
      return {
        documentJson: JSON.stringify(s.document),
        activeDocumentId: s.activeId ?? '',
        activeDocumentName: s.document.name ?? '',
        selection: s.selection,
        workspaceMode: s.workspaceMode,
        theme:
          typeof document !== 'undefined'
            ? (document.documentElement.dataset.theme ?? 'light')
            : 'light',
        canUndo: s.canUndo,
        canRedo: s.canRedo,
        detachedPanels: getDetachedPanels(),
      };
    };

    return attachSessionBroker({
      getSessionId: () => SESSION_ID,
      getSnapshot,
      applyExternalDocument: (documentJson) => {
        try {
          editorRef.current.updateDoc(() => JSON.parse(documentJson));
        } catch {
          // Malformed external document — ignore
        }
      },
      applyExternalSelection: (selection) => {
        editorRef.current.setSelection(selection[0] ?? null, 'api');
      },
      requestUndo: () => editorRef.current.undo(),
      requestRedo: () => editorRef.current.redo(),
      reattachPanel: (panelTypeId) => {
        markPanelReattached(panelTypeId as PanelTypeId);
      },
    });
  }, []);

  // Broadcast patches on primary state change (coalesced by the broker).
  const state = editor.state;
  useEffect(() => {
    getSessionBroker(SESSION_ID)?.notifyStateChanged();
  }, [
    state.document,
    state.selection,
    state.workspaceMode,
    state.canUndo,
    state.canRedo,
    state.activeId,
  ]);

  // Remember panel-window placements so detached panels restore their
  // position/size on the next detach (per-panel, cross-session).
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void getWindowService()
      .listenToWindowEvents((event) => {
        if (!active) return;
        if (event.type !== 'moved' && event.type !== 'resized') return;
        const record = getDetachedPanels().find((r) => r.windowId === event.windowId);
        if (!record) return;
        void getWindowService()
          .getWindowPlacement(event.windowId)
          .then((placement) => {
            if (!active || !placement) return;
            savePanelPlacement({
              panelTypeId: record.panelTypeId,
              windowId: event.windowId,
              logicalPosition: placement.logicalPosition,
              logicalSize: placement.logicalSize,
              state: placement.state,
              updatedAt: Date.now(),
            });
          })
          .catch(() => {});
      })
      .then((unsub) => {
        if (active) unsubscribe = unsub;
        else unsub();
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return useMemo(
    () => ({
      detached,
      isDetached: (panelTypeId: PanelTypeId) => isPanelDetached(panelTypeId),
    }),
    [detached],
  );
}
