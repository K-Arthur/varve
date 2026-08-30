/**
 * Primary-window integration for detached panel hosts.
 *
 * This hook deliberately keeps the one authoritative editor in the primary
 * window. It attaches the scoped session broker, derives dock visibility from
 * the primary-owned detached store, and persists only stable window geometry
 * through the platform facade.
 */

import { type DisplayInfo, getWindowService, type NativeWindowService } from '@varve/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorContextValue } from '../context';
import {
  getDetachedPanels,
  markPanelReattached,
  reconcileDetachedPanelsForSession,
  subscribeDetachedPanels,
} from './detachedPanelsStore';
import type { PanelTypeId } from './panelRegistry';
import { recordPanelWindowDiagnostic } from './panelWindowDiagnostics';
import { bringAllPanelsToCurrentDisplay, resetPanelWindowLayout } from './panelWindowRecovery';
import { getPanelWindowSessionId } from './panelWindowSession';
import type { BrokerSnapshot } from './sessionBroker';
import { attachSessionBroker, getSessionBroker } from './sessionBroker';
import {
  loadPanelPlacements,
  reconcilePanelPlacements,
  savePanelPlacement,
} from './workspaceManager';

export interface DetachedPanelsController {
  /** Panel type ids currently hosted in auxiliary windows. */
  detached: Set<PanelTypeId>;
  /** Whether a specific panel is detached. */
  isDetached(panelTypeId: PanelTypeId): boolean;
  /** Recover every live panel window onto the display containing the editor. */
  bringAllPanelsToCurrentDisplay(): void;
  /** Reattach live panels and clear only their machine-local window geometry. */
  resetPanelWindowLayout(): void;
}

const PLACEMENT_DEBOUNCE_MS = 400;

function recordsForSession(sessionId: string) {
  return getDetachedPanels().filter((record) => record.sessionId === sessionId);
}

function restorePrimaryPanelFocus(panelTypeId: PanelTypeId): void {
  // Store notification causes the docked panel to remount. Wait for that
  // commit before restoring the meaningful keyboard target, then fall back
  // naturally to the editor if the panel is no longer mounted.
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(`[data-testid="detach-${panelTypeId}"]`)?.focus();
  });
}

async function persistPanelWindowPlacement(
  windowService: NativeWindowService,
  sessionId: string,
  windowId: string,
): Promise<void> {
  const record = recordsForSession(sessionId).find((candidate) => candidate.windowId === windowId);
  if (!record) return;

  const placement = await windowService.getWindowPlacement(windowId).catch(() => null);
  if (!placement) {
    recordPanelWindowDiagnostic({
      type: 'layout-persistence-failed',
      panelTypeId: record.panelTypeId,
      windowId,
      sessionId,
      errorCode: 'placement-unavailable',
    });
    return;
  }
  const displays = await windowService.listMonitors().catch(() => [] as DisplayInfo[]);
  const display = placement.displayId
    ? displays.find((candidate) => candidate.runtimeId === placement.displayId)
    : undefined;
  savePanelPlacement(
    {
      panelTypeId: record.panelTypeId,
      windowId,
      displayId: placement.displayId,
      displayFingerprint: placement.displayFingerprint,
      logicalPosition: placement.logicalPosition,
      logicalSize: placement.logicalSize,
      state: placement.state,
      updatedAt: Date.now(),
    },
    { display, displays },
  );
  recordPanelWindowDiagnostic({
    type: 'layout-persisted',
    panelTypeId: record.panelTypeId,
    windowId,
    sessionId,
    displayId: placement.displayId,
    logicalBounds: {
      x: placement.logicalPosition.x,
      y: placement.logicalPosition.y,
      width: placement.logicalSize.width,
      height: placement.logicalSize.height,
    },
    result: placement.state,
  });
}

/**
 * Apply a bounded topology reconciliation only to still-live current-session
 * hosts. It is exported for narrow integration tests; UI code never has to
 * duplicate monitor matching or logical-coordinate recovery.
 */
export async function reconcileDetachedPanelWindowTopology(
  windowService: NativeWindowService,
  sessionId: string,
  suppliedDisplays?: readonly DisplayInfo[],
): Promise<void> {
  const displays = [...(suppliedDisplays ?? (await windowService.listMonitors().catch(() => [])))];
  recordPanelWindowDiagnostic({
    type: 'topology-reconciliation-started',
    sessionId,
    displayCount: displays.length,
  });
  if (displays.length === 0) return;
  const records = recordsForSession(sessionId);
  if (records.length === 0) return;
  const recordByPanel = new Map(records.map((record) => [record.panelTypeId, record]));
  const plans = reconcilePanelPlacements(loadPanelPlacements(), displays);

  await Promise.all(
    plans.map(async (plan) => {
      const liveRecord = recordByPanel.get(plan.record.panelTypeId as PanelTypeId);
      if (!liveRecord) return;
      try {
        await windowService.setWindowPlacement(liveRecord.windowId, plan.placement);
        recordPanelWindowDiagnostic({
          type: 'placement-applied',
          panelTypeId: liveRecord.panelTypeId,
          windowId: liveRecord.windowId,
          sessionId,
          displayId: plan.placement.displayId,
          logicalBounds: {
            x: plan.placement.logicalPosition.x,
            y: plan.placement.logicalPosition.y,
            width: plan.placement.logicalSize.width,
            height: plan.placement.logicalSize.height,
          },
          result: plan.source,
        });
        savePanelPlacement(
          {
            ...plan.record,
            windowId: liveRecord.windowId,
            updatedAt: Date.now(),
          },
          { display: plan.display, displays },
        );
        recordPanelWindowDiagnostic({
          type: 'layout-persisted',
          panelTypeId: liveRecord.panelTypeId,
          windowId: liveRecord.windowId,
          sessionId,
          displayId: plan.placement.displayId,
          logicalBounds: {
            x: plan.placement.logicalPosition.x,
            y: plan.placement.logicalPosition.y,
            width: plan.placement.logicalSize.width,
            height: plan.placement.logicalSize.height,
          },
          result: 'topology-reconciled',
        });
      } catch {
        // A compositor can refuse programmatic placement (notably Wayland).
        // The original stable record remains available for a later retry.
        recordPanelWindowDiagnostic({
          type: 'layout-persistence-failed',
          panelTypeId: liveRecord.panelTypeId,
          windowId: liveRecord.windowId,
          sessionId,
          errorCode: 'placement-apply-failed',
        });
      }
    }),
  );
  recordPanelWindowDiagnostic({
    type: 'topology-reconciled',
    sessionId,
    displayCount: displays.length,
    result: 'completed',
  });
}

export function useDetachedPanels(editor: EditorContextValue): DetachedPanelsController {
  const sessionId = useMemo(() => getPanelWindowSessionId(), []);
  const [detached, setDetached] = useState<Set<PanelTypeId>>(
    () => new Set(reconcileDetachedPanelsForSession(sessionId).map((record) => record.panelTypeId)),
  );

  // Live editor reference — the broker API must never go stale.
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Subscribe before installing the broker so a recovered/closed auxiliary
  // host cannot leave a stale record hiding the source panel.
  useEffect(() => {
    return subscribeDetachedPanels((records) => {
      setDetached(
        new Set(
          records
            .filter((record) => record.sessionId === sessionId)
            .map((record) => record.panelTypeId),
        ),
      );
    });
  }, [sessionId]);

  // Attach one broker for this primary-session identity. All callbacks read
  // editorRef.current so document/selection state is always fresh.
  useEffect(() => {
    const getSnapshot = (): BrokerSnapshot => {
      const state = editorRef.current.state;
      return {
        documentJson: JSON.stringify(state.document),
        documentRevision: state.revision,
        activeDocumentId: state.activeId ?? '',
        activeDocumentName: state.document.name ?? '',
        selection: state.selection,
        workspaceMode: state.workspaceMode,
        theme:
          typeof document !== 'undefined'
            ? (document.documentElement.dataset.theme ?? 'light')
            : 'light',
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        detachedPanels: recordsForSession(sessionId),
      };
    };

    return attachSessionBroker({
      getSessionId: () => sessionId,
      getSnapshot,
      applyExternalDocument: (documentJson) => {
        try {
          editorRef.current.updateDoc(() => JSON.parse(documentJson));
        } catch {
          // Runtime protocol validation protects the payload boundary; retain
          // this final guard because document decoding is still fallible.
        }
      },
      applyExternalSelection: (selection) => {
        editorRef.current.setSelection(selection[0] ?? null, 'api');
      },
      requestUndo: () => editorRef.current.undo(),
      requestRedo: () => editorRef.current.redo(),
      reattachPanel: (panelTypeId) => {
        markPanelReattached(panelTypeId as PanelTypeId);
        restorePrimaryPanelFocus(panelTypeId as PanelTypeId);
      },
    });
  }, [sessionId]);

  // Broadcast primary state patches (coalesced by the broker).
  const state = editor.state;
  useEffect(() => {
    getSessionBroker(sessionId)?.notifyStateChanged();
  }, [
    sessionId,
    state.document,
    state.selection,
    state.workspaceMode,
    state.canUndo,
    state.canRedo,
    state.activeId,
  ]);

  // Persist placement only after the move/resize stream settles. Reconcile
  // only on platform topology notifications or bounded reactivation events;
  // there is deliberately no permanent polling loop.
  useEffect(() => {
    const windowService = getWindowService();
    const pendingWindowIds = new Set<string>();
    let placementTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;
    let active = true;
    let topologyRunning = false;
    let topologyQueued = false;

    const flushPlacement = () => {
      if (placementTimer) {
        clearTimeout(placementTimer);
        placementTimer = null;
      }
      const windowIds = [...pendingWindowIds];
      pendingWindowIds.clear();
      void Promise.all(
        windowIds.map((windowId) =>
          persistPanelWindowPlacement(windowService, sessionId, windowId),
        ),
      );
    };

    const schedulePlacement = (windowId: string) => {
      pendingWindowIds.add(windowId);
      if (placementTimer) clearTimeout(placementTimer);
      placementTimer = setTimeout(flushPlacement, PLACEMENT_DEBOUNCE_MS);
    };

    const reconcileTopology = (displays?: readonly DisplayInfo[]) => {
      if (topologyRunning) {
        topologyQueued = true;
        return;
      }
      topologyRunning = true;
      void reconcileDetachedPanelWindowTopology(windowService, sessionId, displays)
        .catch(() => {})
        .finally(() => {
          topologyRunning = false;
          if (topologyQueued && active) {
            topologyQueued = false;
            reconcileTopology();
          }
        });
    };

    const onPageHide = () => flushPlacement();
    const onFocus = () => reconcileTopology();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPlacement();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // This also makes the Tauri adapter subscribe the primary native window
    // to its move/scale/close lifecycle events.
    void windowService.getCurrentWindow().catch(() => {});
    void windowService
      .listenToWindowEvents((event) => {
        if (!active) return;
        if (event.type === 'moved' || event.type === 'resized') {
          if (recordsForSession(sessionId).some((record) => record.windowId === event.windowId)) {
            recordPanelWindowDiagnostic({
              type: event.type === 'moved' ? 'window-moved' : 'window-resized',
              windowId: event.windowId,
              sessionId,
              ...(event.type === 'moved'
                ? {
                    displayId: event.placement.displayId,
                    logicalBounds: {
                      x: event.placement.logicalPosition.x,
                      y: event.placement.logicalPosition.y,
                      width: event.placement.logicalSize.width,
                      height: event.placement.logicalSize.height,
                    },
                  }
                : {}),
            });
            schedulePlacement(event.windowId);
          }
          return;
        }
        if (event.type === 'closed') {
          getSessionBroker(sessionId)?.unregister(event.windowId);
          return;
        }
        if (event.type === 'monitors-changed') {
          recordPanelWindowDiagnostic({
            type: 'monitor-topology-changed',
            sessionId,
            displayCount: event.displays.length,
          });
          reconcileTopology(event.displays);
        }
      })
      .then((nextUnsubscribe) => {
        if (active) unsubscribe = nextUnsubscribe;
        else nextUnsubscribe();
      })
      .catch(() => {});
    reconcileTopology();

    return () => {
      active = false;
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flushPlacement();
      unsubscribe?.();
    };
  }, [sessionId]);

  const isDetached = useCallback(
    (panelTypeId: PanelTypeId) =>
      recordsForSession(sessionId).some((record) => record.panelTypeId === panelTypeId),
    [sessionId],
  );

  const bringAllPanelsToThisDisplay = useCallback(() => {
    void bringAllPanelsToCurrentDisplay({
      windowService: getWindowService(),
      sessionId,
      announce: (message) => editorRef.current.announce(message),
    }).catch(() => {
      editorRef.current.announce('Panel windows could not be moved to this display.');
    });
  }, [sessionId]);

  const resetDetachedPanelWindowLayout = useCallback(() => {
    void resetPanelWindowLayout({
      windowService: getWindowService(),
      sessionId,
      announce: (message) => editorRef.current.announce(message),
    }).catch(() => {
      editorRef.current.announce('Panel window layout could not be reset.');
    });
  }, [sessionId]);

  return useMemo(
    () => ({
      detached,
      isDetached,
      bringAllPanelsToCurrentDisplay: bringAllPanelsToThisDisplay,
      resetPanelWindowLayout: resetDetachedPanelWindowLayout,
    }),
    [bringAllPanelsToThisDisplay, detached, isDetached, resetDetachedPanelWindowLayout],
  );
}
