/**
 * Browser Fallback (M12) — in-page dock layouts, focus mode,
 * and logical/browser layout conversion for the single-window
 * browser environment where native multi-window is unavailable.
 *
 * Pure functions + lightweight state helpers. The browser fallback
 * emulates multi-window via CSS Grid regions within a single page.
 */

import { collectPanelInstances, normalizeDockTree } from './dockOps';
import type { DockNode, NativeWorkspaceLayout, PanelInstance } from './dockTypes';
import { WORKSPACE_LAYOUT_VERSION } from './dockTypes';
import type { PanelTypeId } from './panelRegistry';

// ---------------------------------------------------------------------------
// In-page dock layout
// ---------------------------------------------------------------------------

export type DockRegion = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'floating';

export interface InPageDockSlot {
  region: DockRegion;
  panelTypeId: PanelTypeId;
  panelInstanceId: string;
  /** Size in CSS grid fr units or px. */
  size: number;
  visible: boolean;
}

export interface InPageDockLayout {
  slots: InPageDockSlot[];
  /** The center (canvas) region size ratio. */
  centerRatio: number;
  /** Focus mode hides all side panels. */
  focusMode: boolean;
}

/** Create a default in-page dock layout with common panels. */
export function createDefaultInPageDockLayout(
  panelInstances: Array<{ id: string; typeId: PanelTypeId }>,
): InPageDockLayout {
  const slots: InPageDockSlot[] = panelInstances.map((pi, index) => {
    let region: DockRegion;
    if (pi.typeId === 'layers' || pi.typeId === 'pagenav') {
      region = 'left';
    } else if (pi.typeId === 'inspector' || pi.typeId === 'history') {
      region = 'right';
    } else if (pi.typeId === 'timeline') {
      region = 'bottom';
    } else {
      region = 'floating';
    }

    return {
      region,
      panelTypeId: pi.typeId,
      panelInstanceId: pi.id,
      size: 280,
      visible: index < 4, // first 4 visible by default
    };
  });

  return {
    slots,
    centerRatio: 0.6,
    focusMode: false,
  };
}

// ---------------------------------------------------------------------------
// Focus mode
// ---------------------------------------------------------------------------

/** Toggle focus mode — hides all side panels, shows only the canvas. */
export function toggleFocusMode(layout: InPageDockLayout): InPageDockLayout {
  return {
    ...layout,
    focusMode: !layout.focusMode,
  };
}

/** Get visible slots (respects focus mode). */
export function getVisibleSlots(layout: InPageDockLayout): InPageDockSlot[] {
  if (layout.focusMode) return [];
  return layout.slots.filter((s) => s.visible);
}

/** Toggle visibility of a specific panel. */
export function togglePanelVisibility(
  layout: InPageDockLayout,
  panelInstanceId: string,
): InPageDockLayout {
  return {
    ...layout,
    slots: layout.slots.map((s) =>
      s.panelInstanceId === panelInstanceId ? { ...s, visible: !s.visible } : s,
    ),
  };
}

/** Show a specific panel (sets visible = true). */
export function showPanel(layout: InPageDockLayout, panelInstanceId: string): InPageDockLayout {
  return {
    ...layout,
    focusMode: false,
    slots: layout.slots.map((s) =>
      s.panelInstanceId === panelInstanceId ? { ...s, visible: true } : s,
    ),
  };
}

/** Hide a specific panel. */
export function hidePanel(layout: InPageDockLayout, panelInstanceId: string): InPageDockLayout {
  return {
    ...layout,
    slots: layout.slots.map((s) =>
      s.panelInstanceId === panelInstanceId ? { ...s, visible: false } : s,
    ),
  };
}

// ---------------------------------------------------------------------------
// CSS Grid region mapping
// ---------------------------------------------------------------------------

export interface GridRegionDefinition {
  area: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert an InPageDockLayout into CSS Grid template regions.
 * Returns the grid-template-areas string and per-region coordinates.
 */
export function computeGridRegions(
  layout: InPageDockLayout,
  containerWidth: number,
  containerHeight: number,
): { template: string; regions: Record<DockRegion, GridRegionDefinition> } {
  const visibleSlots = getVisibleSlots(layout);
  const hasLeft = visibleSlots.some((s) => s.region === 'left');
  const hasRight = visibleSlots.some((s) => s.region === 'right');
  const hasBottom = visibleSlots.some((s) => s.region === 'bottom');

  const leftWidth = hasLeft ? 280 : 0;
  const rightWidth = hasRight ? 320 : 0;
  const bottomHeight = hasBottom ? 200 : 0;

  const centerX = leftWidth;
  const centerY = 0;
  const centerWidth = containerWidth - leftWidth - rightWidth;
  const centerHeight = containerHeight - bottomHeight;

  const regions: Record<DockRegion, GridRegionDefinition> = {
    left: { area: 'left', x: 0, y: 0, width: leftWidth, height: containerHeight },
    right: {
      area: 'right',
      x: containerWidth - rightWidth,
      y: 0,
      width: rightWidth,
      height: containerHeight,
    },
    top: { area: 'top', x: leftWidth, y: 0, width: centerWidth, height: 0 },
    bottom: {
      area: 'bottom',
      x: leftWidth,
      y: containerHeight - bottomHeight,
      width: centerWidth,
      height: bottomHeight,
    },
    center: { area: 'center', x: centerX, y: centerY, width: centerWidth, height: centerHeight },
    floating: { area: 'floating', x: centerX + 40, y: centerY + 40, width: 320, height: 400 },
  };

  const template = `"${hasLeft ? 'left ' : ''}center ${hasRight ? 'right' : ''}" ${
    hasBottom ? `/ "bottom"` : ''
  }`.trim();

  return { template, regions };
}

// ---------------------------------------------------------------------------
// Logical <-> Browser layout conversion
// ---------------------------------------------------------------------------

/**
 * Convert a NativeWorkspaceLayout (logical, multi-window) to a browser
 * InPageDockLayout (single-window, CSS Grid regions).
 *
 * The first window's dock tree is used. Auxiliary windows are flattened
 * into floating panels.
 */
export function logicalToBrowserLayout(layout: NativeWorkspaceLayout): InPageDockLayout {
  const slots: InPageDockSlot[] = [];

  for (const win of layout.windows) {
    const panelIds = collectPanelInstances(win.dockRoot);
    for (const pid of panelIds) {
      const instance = layout.panelInstances.find((p) => p.id === pid);
      if (!instance) continue;

      let region: DockRegion;
      if (win.role === 'auxiliary-panel' || win.role === 'document-view') {
        region = 'floating';
      } else {
        // Primary window: determine region from panel type
        region = inferRegionFromPanelType(instance.panelTypeId);
      }

      slots.push({
        region,
        panelTypeId: instance.panelTypeId,
        panelInstanceId: instance.id,
        size: 280,
        visible: true,
      });
    }
  }

  return {
    slots,
    centerRatio: 0.6,
    focusMode: false,
  };
}

/**
 * Convert a browser InPageDockLayout back to a NativeWorkspaceLayout.
 * All panels are placed in a single primary window with a dock tree
 * derived from the grid regions.
 */
export function browserToLogicalLayout(
  browserLayout: InPageDockLayout,
  layoutName: string = 'Browser Layout',
): NativeWorkspaceLayout {
  const visibleSlots = getVisibleSlots(browserLayout);
  const panelInstances: PanelInstance[] = [];
  let dockIndex = 0;

  // Group slots by region
  const regionGroups = new Map<DockRegion, InPageDockSlot[]>();
  for (const slot of visibleSlots) {
    const group = regionGroups.get(slot.region) ?? [];
    group.push(slot);
    regionGroups.set(slot.region, group);
  }

  // Build dock tree from regions
  let root: DockNode = { kind: 'empty', id: `dn-browser-${Date.now().toString(36)}` };

  const leftSlots = regionGroups.get('left') ?? [];
  const rightSlots = regionGroups.get('right') ?? [];
  const bottomSlots = regionGroups.get('bottom') ?? [];

  // Left panels
  if (leftSlots.length > 0) {
    const leftNodes = leftSlots.map((slot) => {
      panelInstances.push({
        id: slot.panelInstanceId,
        panelTypeId: slot.panelTypeId,
        hostNodeId: `dn-host-${slot.panelInstanceId}`,
      });
      return {
        kind: 'panel' as const,
        id: `dn-${slot.panelInstanceId}`,
        panelInstanceId: slot.panelInstanceId,
      };
    });
    root =
      leftNodes.length === 1
        ? leftNodes[0]!
        : {
            kind: 'tab-group',
            id: `dn-tg-left-${dockIndex++}`,
            tabs: leftNodes.map((n) => n.panelInstanceId),
            activeTabIndex: 0,
          };
  }

  // Right panels
  if (rightSlots.length > 0) {
    const rightNodes = rightSlots.map((slot) => {
      panelInstances.push({
        id: slot.panelInstanceId,
        panelTypeId: slot.panelTypeId,
        hostNodeId: `dn-host-${slot.panelInstanceId}`,
      });
      return {
        kind: 'panel' as const,
        id: `dn-${slot.panelInstanceId}`,
        panelInstanceId: slot.panelInstanceId,
      };
    });
    const rightNode =
      rightNodes.length === 1
        ? rightNodes[0]!
        : {
            kind: 'tab-group' as const,
            id: `dn-tg-right-${dockIndex++}`,
            tabs: rightNodes.map((n) => n.panelInstanceId),
            activeTabIndex: 0,
          };
    root = {
      kind: 'split',
      id: `dn-split-h-${dockIndex++}`,
      direction: 'horizontal',
      ratio: 0.65,
      first: root,
      second: rightNode,
    };
  }

  // Bottom panels
  if (bottomSlots.length > 0) {
    const bottomNodes = bottomSlots.map((slot) => {
      panelInstances.push({
        id: slot.panelInstanceId,
        panelTypeId: slot.panelTypeId,
        hostNodeId: `dn-host-${slot.panelInstanceId}`,
      });
      return {
        kind: 'panel' as const,
        id: `dn-${slot.panelInstanceId}`,
        panelInstanceId: slot.panelInstanceId,
      };
    });
    const bottomNode =
      bottomNodes.length === 1
        ? bottomNodes[0]!
        : {
            kind: 'tab-group' as const,
            id: `dn-tg-bottom-${dockIndex++}`,
            tabs: bottomNodes.map((n) => n.panelInstanceId),
            activeTabIndex: 0,
          };
    root = {
      kind: 'split',
      id: `dn-split-v-${dockIndex++}`,
      direction: 'vertical',
      ratio: 0.7,
      first: root,
      second: bottomNode,
    };
  }

  // Floating panels — add as tabs in the root
  const floatingSlots = regionGroups.get('floating') ?? [];
  for (const slot of floatingSlots) {
    panelInstances.push({
      id: slot.panelInstanceId,
      panelTypeId: slot.panelTypeId,
      hostNodeId: `dn-host-${slot.panelInstanceId}`,
    });
    const panelNode = {
      kind: 'panel' as const,
      id: `dn-${slot.panelInstanceId}`,
      panelInstanceId: slot.panelInstanceId,
    };
    if (root.kind === 'empty') {
      root = panelNode;
    } else {
      root = {
        kind: 'split',
        id: `dn-split-float-${dockIndex++}`,
        direction: 'horizontal',
        ratio: 0.5,
        first: root,
        second: panelNode,
      };
    }
  }

  return {
    schemaVersion: WORKSPACE_LAYOUT_VERSION,
    id: `layout-browser-${Date.now().toString(36)}`,
    name: layoutName,
    windows: [
      {
        id: 'main',
        role: 'primary',
        dockRoot: normalizeDockTree(root),
        state: 'normal',
      },
    ],
    panelInstances,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function inferRegionFromPanelType(panelTypeId: PanelTypeId): DockRegion {
  const leftPanels: PanelTypeId[] = ['layers', 'pagenav'];
  const rightPanels: PanelTypeId[] = ['inspector', 'history'];
  const bottomPanels: PanelTypeId[] = ['timeline'];

  if (leftPanels.includes(panelTypeId)) return 'left';
  if (rightPanels.includes(panelTypeId)) return 'right';
  if (bottomPanels.includes(panelTypeId)) return 'bottom';
  return 'floating';
}
