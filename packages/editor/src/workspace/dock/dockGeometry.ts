import { DOCK_TAB_STRIP_MIN_HEIGHT, getDockNodeMinimumSize } from './dockOps';
import type {
  DockFloatingGroup,
  DockNode,
  PanelInstanceId,
  PanelInstanceRef,
  PanelTypeId,
} from './dockTypes';

export interface DockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockPanelPlacement {
  panelTypeId: PanelTypeId;
  panelInstanceId: PanelInstanceId;
  rect: DockRect;
  active: boolean;
  tabGroupNodeId?: string;
  floatingGroupId?: string;
}

export interface DockTabGroupPlacement {
  nodeId: string;
  rect: DockRect;
  activePanelInstanceId?: PanelInstanceId;
  panels: PanelInstanceRef[];
  floating?: boolean;
}

export interface DockFloatingGroupPlacement {
  id: string;
  rect: DockRect;
  headerRect: DockRect;
  contentRect: DockRect;
  panels: DockPanelPlacement[];
  tabGroup?: DockTabGroupPlacement;
  activePanelTypeId?: PanelTypeId;
  minimumSize: { width: number; height: number };
}

export interface DockSplitPlacement {
  nodeId: string;
  direction: 'row' | 'column';
  ratio: number;
  minRatio: number;
  maxRatio: number;
  extent: number;
  rect: DockRect;
}

export interface DockTreeGeometry {
  panels: DockPanelPlacement[];
  tabGroups: DockTabGroupPlacement[];
  splitters: DockSplitPlacement[];
  canvas?: DockRect;
  minimumSize: { width: number; height: number };
}

export type DockPanelVisibility = Partial<Record<PanelTypeId, boolean>>;

/** Collapse temporarily hidden panel branches without changing saved intent. */
export function projectVisibleDockTree(node: DockNode, visibility: DockPanelVisibility): DockNode {
  if (node.kind === 'panel') {
    return visibility[node.panelTypeId] === false ? { kind: 'empty', id: node.id } : node;
  }
  if (node.kind === 'tabs') {
    const panels = node.panels.filter((panel) => visibility[panel.panelTypeId] !== false);
    if (panels.length === 0) return { kind: 'empty', id: node.id };
    if (panels.length === 1) {
      const [panel] = panels;
      return {
        kind: 'panel',
        id: node.id,
        panelInstanceId: panel!.instanceId,
        panelTypeId: panel!.panelTypeId,
      };
    }
    const activePanelInstanceId = panels.some(
      (panel) => panel.instanceId === node.activePanelInstanceId,
    )
      ? node.activePanelInstanceId
      : panels[0]!.instanceId;
    return { ...node, panels, activePanelInstanceId };
  }
  if (node.kind !== 'split') return node;
  const first = projectVisibleDockTree(node.first, visibility);
  const second = projectVisibleDockTree(node.second, visibility);
  if (first.kind === 'empty') return second;
  if (second.kind === 'empty') return first;
  return { ...node, first, second };
}

/**
 * Resolve pixel boxes while honoring registered minimum sizes whenever the
 * available host can satisfy them. Ratios remain the user's preferred sizes.
 */
export function resolveDockTreeGeometry(
  root: DockNode,
  width: number,
  height: number,
  visibility: DockPanelVisibility = {},
): DockTreeGeometry {
  const projected = projectVisibleDockTree(root, visibility);
  const placements: DockPanelPlacement[] = [];
  const tabGroups: DockTabGroupPlacement[] = [];
  const splitters: DockSplitPlacement[] = [];
  let canvas: DockRect | undefined;
  const finiteWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const finiteHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const visit = (node: DockNode, rect: DockRect): void => {
    if (node.kind === 'canvas') {
      canvas = rect;
      return;
    }
    if (node.kind === 'panel') {
      placements.push({
        panelTypeId: node.panelTypeId,
        panelInstanceId: node.panelInstanceId,
        rect,
        active: true,
      });
      return;
    }
    if (node.kind === 'tabs') {
      const activeId = node.activePanelInstanceId ?? node.panels[0]?.instanceId;
      if (node.panels.length > 1) {
        tabGroups.push({
          nodeId: node.id,
          rect,
          activePanelInstanceId: activeId,
          panels: [...node.panels],
        });
      }
      for (const panel of node.panels) {
        placements.push({
          panelTypeId: panel.panelTypeId,
          panelInstanceId: panel.instanceId,
          rect,
          active: panel.instanceId === activeId,
          tabGroupNodeId: node.id,
        });
      }
      return;
    }
    if (node.kind !== 'split') return;

    const ratio = Number.isFinite(node.ratio) ? Math.max(0.05, Math.min(0.95, node.ratio)) : 0.5;
    const firstMin = getDockNodeMinimumSize(node.first);
    const secondMin = getDockNodeMinimumSize(node.second);
    if (node.direction === 'row') {
      const desired = rect.width * ratio;
      const maxFirst = rect.width - secondMin.width;
      const firstWidth =
        maxFirst >= firstMin.width ? clamp(desired, firstMin.width, maxFirst) : rect.width * ratio;
      const canFit = rect.width > 0 && maxFirst >= firstMin.width;
      splitters.push({
        nodeId: node.id,
        direction: node.direction,
        ratio: rect.width > 0 ? firstWidth / rect.width : ratio,
        minRatio: canFit ? Math.max(0.05, firstMin.width / rect.width) : 0.05,
        maxRatio: canFit ? Math.min(0.95, maxFirst / rect.width) : 0.95,
        extent: rect.width,
        rect: {
          x: rect.x + firstWidth - 12,
          y: rect.y,
          width: 24,
          height: rect.height,
        },
      });
      visit(node.first, { ...rect, width: firstWidth });
      visit(node.second, {
        ...rect,
        x: rect.x + firstWidth,
        width: rect.width - firstWidth,
      });
    } else {
      const desired = rect.height * ratio;
      const maxFirst = rect.height - secondMin.height;
      const firstHeight =
        maxFirst >= firstMin.height
          ? clamp(desired, firstMin.height, maxFirst)
          : rect.height * ratio;
      const canFit = rect.height > 0 && maxFirst >= firstMin.height;
      splitters.push({
        nodeId: node.id,
        direction: node.direction,
        ratio: rect.height > 0 ? firstHeight / rect.height : ratio,
        minRatio: canFit ? Math.max(0.05, firstMin.height / rect.height) : 0.05,
        maxRatio: canFit ? Math.min(0.95, maxFirst / rect.height) : 0.95,
        extent: rect.height,
        rect: {
          x: rect.x,
          y: rect.y + firstHeight - 12,
          width: rect.width,
          height: 24,
        },
      });
      visit(node.first, { ...rect, height: firstHeight });
      visit(node.second, {
        ...rect,
        y: rect.y + firstHeight,
        height: rect.height - firstHeight,
      });
    }
  };
  visit(projected, { x: 0, y: 0, width: finiteWidth, height: finiteHeight });
  return {
    panels: placements,
    tabGroups,
    splitters,
    canvas,
    minimumSize: getDockNodeMinimumSize(projected),
  };
}

/** Resolve normalized leaf boxes from a validated dock tree. */
export function getDockPanelPlacements(
  root: DockNode,
  visibility: DockPanelVisibility = {},
): DockPanelPlacement[] {
  return resolveDockTreeGeometry(root, 1, 1, visibility).panels;
}

/** Return the normalized box of the protected canvas anchor. */
export function getDockCanvasRect(
  root: DockNode,
  visibility: DockPanelVisibility = {},
): DockRect | undefined {
  return resolveDockTreeGeometry(root, 1, 1, visibility).canvas;
}

/** Resolve a float group inside the primary window without changing docked layout geometry. */
export function resolveDockFloatingGroupGeometry(
  group: DockFloatingGroup,
  width: number,
  height: number,
  visibility: DockPanelVisibility = {},
): DockFloatingGroupPlacement {
  const finiteWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const finiteHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const panels = group.panels.filter((panel) => visibility[panel.panelTypeId] !== false);
  const activePanelInstanceId = panels.some(
    (panel) => panel.instanceId === group.activePanelInstanceId,
  )
    ? group.activePanelInstanceId
    : panels[0]?.instanceId;
  const minimumNode: DockNode =
    panels.length > 1
      ? { kind: 'tabs', id: group.id, panels, activePanelInstanceId }
      : panels[0]
        ? {
            kind: 'panel',
            id: `float-panel-${panels[0].instanceId}`,
            panelInstanceId: panels[0].instanceId,
            panelTypeId: panels[0].panelTypeId,
          }
        : { kind: 'empty', id: `float-empty-${group.id}` };
  const panelMinimum = getDockNodeMinimumSize(minimumNode);
  const headerHeight = 36 + (panels.length > 1 ? DOCK_TAB_STRIP_MIN_HEIGHT : 0);
  const minimumSize = {
    width: panelMinimum.width,
    height: panelMinimum.height + headerHeight,
  };
  const normalized = group.normalizedBounds;
  const nx = Number.isFinite(normalized?.x) ? clamp(normalized.x, 0, 1) : 0.18;
  const ny = Number.isFinite(normalized?.y) ? clamp(normalized.y, 0, 1) : 0.14;
  const normalizedWidth = Number.isFinite(normalized?.width) ? clamp(normalized.width, 0, 1) : 0.38;
  const normalizedHeight = Number.isFinite(normalized?.height)
    ? clamp(normalized.height, 0, 1)
    : 0.72;
  const requestedWidth = finiteWidth * normalizedWidth;
  const requestedHeight = finiteHeight * normalizedHeight;
  const floatWidth = Math.min(finiteWidth, Math.max(requestedWidth, minimumSize.width));
  const floatHeight = Math.min(finiteHeight, Math.max(requestedHeight, minimumSize.height));
  const x = clamp(finiteWidth * nx, 0, Math.max(0, finiteWidth - floatWidth));
  const y = clamp(finiteHeight * ny, 0, Math.max(0, finiteHeight - floatHeight));
  const rect = { x, y, width: floatWidth, height: floatHeight };
  const headerRect = { x, y, width: floatWidth, height: 36 };
  const tabRect =
    panels.length > 1
      ? { x, y: y + 36, width: floatWidth, height: DOCK_TAB_STRIP_MIN_HEIGHT }
      : undefined;
  const contentRect = {
    x,
    y: y + headerHeight,
    width: floatWidth,
    height: Math.max(0, floatHeight - headerHeight),
  };
  const placements = panels.map((panel) => ({
    panelTypeId: panel.panelTypeId,
    panelInstanceId: panel.instanceId,
    rect: contentRect,
    active: panel.instanceId === activePanelInstanceId,
    ...(panels.length > 1 ? { tabGroupNodeId: group.id } : {}),
    floatingGroupId: group.id,
  }));
  return {
    id: group.id,
    rect,
    headerRect,
    contentRect,
    panels: placements,
    ...(panels.length > 1 && tabRect
      ? {
          tabGroup: {
            nodeId: group.id,
            rect: tabRect,
            activePanelInstanceId,
            panels,
            floating: true,
          },
        }
      : {}),
    activePanelTypeId: panels.find((panel) => panel.instanceId === activePanelInstanceId)
      ?.panelTypeId,
    minimumSize,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
