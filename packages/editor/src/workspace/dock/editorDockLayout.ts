import type { WorkspaceMode } from '../workspaceTypes';
import { listPanelInstances } from './dockOps';
import type { DockLayout, DockNode, PanelInstanceRef } from './dockTypes';
import { DOCK_LAYOUT_SCHEMA_VERSION, newId } from './dockTypes';

const BUILTIN_INSTANCE_IDS: Record<string, string> = {
  layers: 'builtin-layers',
  inspector: 'builtin-inspector',
  timeline: 'builtin-timeline',
  emailPreview: 'builtin-emailPreview',
  emailOutput: 'builtin-emailOutput',
};

function panel(panelTypeId: PanelInstanceRef['panelTypeId']): DockNode {
  const panelInstanceId = builtinPanelRef(panelTypeId).instanceId;
  return {
    kind: 'panel',
    id: `panel-node-${panelTypeId}`,
    panelInstanceId,
    panelTypeId,
  };
}

function builtinPanelRef(panelTypeId: PanelInstanceRef['panelTypeId']): PanelInstanceRef {
  return {
    instanceId: BUILTIN_INSTANCE_IDS[panelTypeId] ?? `builtin-${panelTypeId}`,
    panelTypeId,
  };
}

function split(
  id: string,
  direction: 'row' | 'column',
  ratio: number,
  first: DockNode,
  second: DockNode,
): DockNode {
  return { kind: 'split', id, direction, ratio, first, second };
}

function canvas(): DockNode {
  return { kind: 'canvas', id: 'canvas-primary' };
}

/**
 * Built-in dock intent shared by the renderer and the customization UI.
 * The six modes retain the familiar layers/canvas/inspector arrangement;
 * Motion and Email place their task-specific companion below the canvas.
 */
export function createDefaultEditorDockLayout(mode: WorkspaceMode): DockLayout {
  const emailPreview = builtinPanelRef('emailPreview');
  const emailOutput = builtinPanelRef('emailOutput');
  const companion =
    mode === 'motion'
      ? panel('timeline')
      : mode === 'email'
        ? {
            kind: 'tabs' as const,
            id: 'email-output-tabs',
            activePanelInstanceId: emailPreview.instanceId,
            panels: [emailPreview, emailOutput],
          }
        : null;
  const center = companion ? split('center-column', 'column', 0.72, canvas(), companion) : canvas();
  const main = split('center-inspector', 'row', 0.74, center, panel('inspector'));
  const root = split('layers-main', 'row', 0.22, panel('layers'), main);
  return {
    schemaVersion: DOCK_LAYOUT_SCHEMA_VERSION,
    windows: [{ id: 'main', role: 'primary', dockRoot: root }],
  };
}

/**
 * Keep the core surfaces reachable when restoring early dock snapshots that
 * contain only the canvas anchor. Add only omitted built-ins; existing panel
 * locations and the user's canvas placement remain untouched.
 */
export function completeEditorDockLayout(
  layout: DockLayout,
  mode: WorkspaceMode,
  includeTimeline = false,
  includeEmailPreview = false,
  additionalPanels: readonly PanelInstanceRef['panelTypeId'][] = [],
): DockLayout {
  const primaryIndex = layout.windows.findIndex((window) => window.role === 'primary');
  if (primaryIndex < 0) return createDefaultEditorDockLayout(mode);
  let root = layout.windows[primaryIndex]!.dockRoot;
  const present = new Set(
    layout.windows.flatMap((window) =>
      listPanelInstances(window.dockRoot).map((item) => item.panelTypeId),
    ),
  );
  const preferred = createDefaultEditorDockLayout(mode);
  const preferredRoot = preferred.windows[0]!.dockRoot;
  const required: Array<{
    id: PanelInstanceRef['panelTypeId'];
    side: 'left' | 'right' | 'bottom';
  }> = [
    { id: 'layers', side: 'left' },
    { id: 'inspector', side: 'right' },
  ];
  if (mode === 'motion' || includeTimeline) required.push({ id: 'timeline', side: 'bottom' });
  if (mode === 'email' || includeEmailPreview)
    required.push({ id: 'emailPreview', side: 'bottom' });
  for (const id of additionalPanels) {
    if (!required.some((panelEntry) => panelEntry.id === id)) {
      required.push({
        id,
        side: id === 'pagenav' ? 'left' : id === 'emailOutput' ? 'bottom' : 'right',
      });
    }
  }

  for (const { id, side } of required) {
    if (present.has(id)) continue;
    const preferredPanel = listPanelInstances(preferredRoot).find(
      (item) => item.panelTypeId === id,
    );
    const ref: PanelInstanceRef = preferredPanel ?? {
      instanceId: BUILTIN_INSTANCE_IDS[id] ?? `builtin-${id}`,
      panelTypeId: id,
    };
    if (id === 'emailOutput') {
      root = addPanelToTabGroup(root, 'emailPreview', ref) ?? insertAtCanvas(root, ref, side);
    } else {
      root = insertAtCanvas(root, ref, side);
    }
    present.add(id);
  }

  const windows = layout.windows.map((window, index) =>
    index === primaryIndex ? { ...window, dockRoot: root } : window,
  );
  return { ...layout, windows };
}

/** Keep Email Output reachable as a tab beside Preview when migrating older layouts. */
function addPanelToTabGroup(
  root: DockNode,
  targetPanelTypeId: PanelInstanceRef['panelTypeId'],
  panelRef: PanelInstanceRef,
): DockNode | null {
  if (root.kind === 'panel') {
    if (root.panelTypeId !== targetPanelTypeId) return null;
    return {
      kind: 'tabs',
      id: `tabs-${root.id}`,
      activePanelInstanceId: root.panelInstanceId,
      panels: [{ instanceId: root.panelInstanceId, panelTypeId: root.panelTypeId }, panelRef],
    };
  }
  if (root.kind === 'tabs') {
    if (!root.panels.some((panelEntry) => panelEntry.panelTypeId === targetPanelTypeId))
      return null;
    if (root.panels.some((panelEntry) => panelEntry.panelTypeId === panelRef.panelTypeId))
      return root;
    return {
      ...root,
      activePanelInstanceId: root.activePanelInstanceId ?? root.panels[0]?.instanceId,
      panels: [...root.panels, panelRef],
    };
  }
  if (root.kind !== 'split') return null;
  const first = addPanelToTabGroup(root.first, targetPanelTypeId, panelRef);
  if (first) return { ...root, first };
  const second = addPanelToTabGroup(root.second, targetPanelTypeId, panelRef);
  return second ? { ...root, second } : null;
}

function insertAtCanvas(
  root: DockNode,
  panelRef: PanelInstanceRef,
  side: 'left' | 'right' | 'bottom',
): DockNode {
  if (root.kind === 'canvas') {
    const panelNode: DockNode = {
      kind: 'panel',
      id: `panel-node-${panelRef.panelTypeId}`,
      panelInstanceId: panelRef.instanceId,
      panelTypeId: panelRef.panelTypeId,
    };
    const bottom = side === 'bottom';
    const panelFirst = side === 'left';
    const canvasRatio = bottom ? 0.72 : 0.78;
    return {
      kind: 'split',
      id: newId(),
      direction: bottom ? 'column' : 'row',
      ratio: panelFirst ? 1 - canvasRatio : canvasRatio,
      first: panelFirst ? panelNode : root,
      second: panelFirst ? root : panelNode,
    };
  }
  if (root.kind !== 'split') return root;
  return {
    ...root,
    first: insertAtCanvas(root.first, panelRef, side),
    second: insertAtCanvas(root.second, panelRef, side),
  };
}
