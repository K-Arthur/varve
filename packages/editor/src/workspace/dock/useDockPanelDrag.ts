import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { tryGetPanelDefinition } from '../panelRegistry';
import { setDockLayoutOverride, updateWorkspacePreferences } from '../workspaceStore';
import type { PanelId, WorkspaceMode } from '../workspaceTypes';
import { type DockPanelPlacement, resolveDockTreeGeometry } from './dockGeometry';
import { DOCK_PANEL_CHROME_HEIGHT, findPanelInLayout, movePanelToHost } from './dockOps';
import type { DockLayout, DockNode } from './dockTypes';

export interface DockPanelMoveHandle {
  instanceId: string;
  panelTypeId: PanelId;
  title: string;
  tabGroupNodeId?: string;
  style: CSSProperties;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
  onBlur: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

export interface DockPanelDropPreview {
  style: CSSProperties;
  label: string;
}

interface DockPanelMoveBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DockDropTarget {
  instanceId: string;
  nodeId: string;
  rect: DockPanelPlacement['rect'];
  title: string;
  placement:
    | { kind: 'tab'; targetNodeId: string }
    | {
        kind: 'split';
        targetNodeId: string;
        direction: 'row' | 'column';
        side: 'before' | 'after';
        targetRatio: number;
      };
  label: string;
}

interface DockPanelMoveSession {
  pointerId: number;
  sourceInstanceId: string;
  startX: number;
  startY: number;
  moved: boolean;
  target: DockDropTarget | null;
}

function findPanelNode(root: DockNode, instanceId: string): DockNode | undefined {
  if (root.kind === 'panel') {
    return root.panelInstanceId === instanceId ? root : undefined;
  }
  if (root.kind === 'tabs') {
    return root.panels.some((panel) => panel.instanceId === instanceId) ? root : undefined;
  }
  if (root.kind !== 'split') return undefined;
  return findPanelNode(root.first, instanceId) ?? findPanelNode(root.second, instanceId);
}

function targetAtPoint(
  sourceInstanceId: string,
  x: number,
  y: number,
  root: DockNode,
  placements: readonly DockPanelPlacement[],
): DockDropTarget | null {
  for (const target of [...placements].reverse()) {
    if (!target.active || target.panelInstanceId === sourceInstanceId) continue;
    const { rect } = target;
    if (x < rect.x || y < rect.y || x > rect.x + rect.width || y > rect.y + rect.height) continue;
    const targetNode = findPanelNode(root, target.panelInstanceId);
    if (!targetNode) continue;
    const nodeId = targetNode.id;
    const horizontal = (x - rect.x) / Math.max(1, rect.width);
    const vertical = (y - rect.y) / Math.max(1, rect.height);
    let placement: DockDropTarget['placement'];
    let label: string;
    if (vertical < 0.2) {
      placement = {
        kind: 'split',
        targetNodeId: nodeId,
        direction: 'column',
        side: 'before',
        targetRatio: 0.5,
      };
      label = `Move above ${tryGetPanelDefinition(target.panelTypeId)?.title ?? target.panelTypeId}`;
    } else if (vertical > 0.8) {
      placement = {
        kind: 'split',
        targetNodeId: nodeId,
        direction: 'column',
        side: 'after',
        targetRatio: 0.5,
      };
      label = `Move below ${tryGetPanelDefinition(target.panelTypeId)?.title ?? target.panelTypeId}`;
    } else if (horizontal < 0.2) {
      placement = {
        kind: 'split',
        targetNodeId: nodeId,
        direction: 'row',
        side: 'before',
        targetRatio: 0.5,
      };
      label = `Move left of ${tryGetPanelDefinition(target.panelTypeId)?.title ?? target.panelTypeId}`;
    } else if (horizontal > 0.8) {
      placement = {
        kind: 'split',
        targetNodeId: nodeId,
        direction: 'row',
        side: 'after',
        targetRatio: 0.5,
      };
      label = `Move right of ${tryGetPanelDefinition(target.panelTypeId)?.title ?? target.panelTypeId}`;
    } else {
      placement = { kind: 'tab', targetNodeId: nodeId };
      label = `Group with ${tryGetPanelDefinition(target.panelTypeId)?.title ?? target.panelTypeId}`;
    }
    return {
      instanceId: target.panelInstanceId,
      nodeId,
      rect,
      title: tryGetPanelDefinition(target.panelTypeId)?.title ?? target.panelTypeId,
      placement,
      label,
    };
  }
  return null;
}

function localPoint(
  event: ReactPointerEvent<HTMLButtonElement>,
  shell: HTMLElement | null,
  bounds: DockPanelMoveBounds,
) {
  const shellRect = shell?.getBoundingClientRect();
  return {
    x: event.clientX - (shellRect?.left ?? 0) - bounds.left,
    y: event.clientY - (shellRect?.top ?? 0) - bounds.top,
  };
}

/** Pointer-first dock movement. Customize Workspace provides the non-drag path. */
export function useDockPanelDrag(
  mode: WorkspaceMode,
  shell: HTMLElement | null,
  layout: DockLayout,
  bounds: DockPanelMoveBounds | null,
  visibility: Partial<Record<PanelId, boolean>>,
) {
  const activeSession = useRef<DockPanelMoveSession | null>(null);
  const [sessionView, setSessionView] = useState<DockPanelMoveSession | null>(null);
  const primary = layout.windows.find((window) => window.role === 'primary');
  const placements = useMemo(
    () =>
      bounds && primary
        ? resolveDockTreeGeometry(primary.dockRoot, bounds.width, bounds.height, visibility).panels
        : [],
    [bounds, primary, visibility],
  );

  const finish = useCallback(
    (event?: ReactPointerEvent<HTMLButtonElement>) => {
      const active = activeSession.current;
      if (!active || (event && active.pointerId !== event.pointerId)) return;
      activeSession.current = null;
      setSessionView(null);
      if (!active.moved) return;
      const point = event && bounds ? localPoint(event, shell, bounds) : null;
      const target =
        point && primary
          ? targetAtPoint(active.sourceInstanceId, point.x, point.y, primary.dockRoot, placements)
          : active.target;
      if (!target || !primary) return;

      updateWorkspacePreferences((current) => {
        const savedLayout = current[mode]?.dockLayout ?? layout;
        const sourceExists = findPanelInLayout(savedLayout, active.sourceInstanceId);
        const targetExists = findPanelInLayout(savedLayout, target.instanceId);
        const baseLayout = sourceExists && targetExists ? savedLayout : layout;
        const host = baseLayout.windows.find((window) => window.role === 'primary');
        if (!host) return current;
        const moved = movePanelToHost(
          baseLayout,
          active.sourceInstanceId,
          host.id,
          target.placement,
        );
        return moved.ok ? setDockLayoutOverride(current, mode, moved.layout) : current;
      });
    },
    [bounds, layout, mode, placements, primary, shell],
  );

  const cancel = useCallback(() => {
    activeSession.current = null;
    setSessionView(null);
  }, []);

  const handles = useMemo<DockPanelMoveHandle[]>(() => {
    if (!bounds || !primary) return [];
    return placements
      .filter((placement) => placement.active && visibility[placement.panelTypeId] !== false)
      .map((placement) => {
        const title = tryGetPanelDefinition(placement.panelTypeId)?.title ?? placement.panelTypeId;
        const style: CSSProperties = placement.tabGroupNodeId
          ? {
              position: 'absolute',
              left: bounds.left + placement.rect.x + Math.max(4, placement.rect.width - 54),
              top: bounds.top + placement.rect.y + 1,
              width: 48,
              height: 28,
              zIndex: 'calc(var(--z-overlay) + 3)',
            }
          : {
              position: 'absolute',
              left: bounds.left + placement.rect.x,
              top: bounds.top + placement.rect.y + 1,
              width: placement.rect.width,
              height: DOCK_PANEL_CHROME_HEIGHT - 2,
              zIndex: 'calc(var(--z-overlay) + 3)',
            };
        return {
          instanceId: placement.panelInstanceId,
          panelTypeId: placement.panelTypeId,
          title,
          tabGroupNodeId: placement.tabGroupNodeId,
          style,
          onPointerDown: (event) => {
            if (event.button !== 0 || activeSession.current) return;
            const active: DockPanelMoveSession = {
              pointerId: event.pointerId,
              sourceInstanceId: placement.panelInstanceId,
              startX: event.clientX,
              startY: event.clientY,
              moved: false,
              target: null,
            };
            activeSession.current = active;
            setSessionView(active);
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Pointer capture is unavailable in some test and embedded engines.
            }
          },
          onPointerMove: (event) => {
            const active = activeSession.current;
            if (!active || active.pointerId !== event.pointerId || !bounds) return;
            const moved =
              active.moved ||
              Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= 6;
            const point = localPoint(event, shell, bounds);
            const target =
              moved && primary
                ? targetAtPoint(
                    active.sourceInstanceId,
                    point.x,
                    point.y,
                    primary.dockRoot,
                    placements,
                  )
                : null;
            active.moved = moved;
            active.target = target;
            setSessionView({ ...active });
          },
          onPointerUp: (event) => finish(event),
          onPointerCancel: cancel,
          onLostPointerCapture: cancel,
          onBlur: cancel,
          onKeyDown: (event) => {
            if (event.key !== 'Escape' || !activeSession.current) return;
            event.preventDefault();
            cancel();
          },
        };
      });
  }, [bounds, cancel, finish, layout, mode, placements, primary, shell, visibility]);

  const preview = useMemo<DockPanelDropPreview | null>(() => {
    if (!sessionView?.moved || !sessionView.target || !bounds) return null;
    const rect = sessionView.target.rect;
    return {
      label: sessionView.target.label,
      style: {
        position: 'absolute',
        left: bounds.left + rect.x,
        top: bounds.top + rect.y,
        width: rect.width,
        height: rect.height,
        zIndex: 'calc(var(--z-overlay) + 4)',
      },
    };
  }, [bounds, sessionView]);

  return { handles, preview };
}
