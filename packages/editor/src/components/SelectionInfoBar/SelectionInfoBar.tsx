/**
 * SelectionInfoBar — comprehensive selection feedback strip.
 *
 * Shows selection details: name, type, dimensions, position, rotation,
 * parent breadcrumb trail, and multi-selection counts. Breadcrumbs are
 * clickable to select+reveal ancestors.
 *
 * Research basis: Figma selection info bar, Illustrator properties panel.
 */

import {
  type Document,
  getParent,
  isContainer,
  isExportRegion,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import { Icon, type IconName } from '@varve/ui';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../context';
import { useViewport } from '../../context/ViewportContext';
import { nodeWorldBounds } from '../../scene/world';
import './SelectionInfoBar.css';

function getNodeTypeIcon(node: SceneNode): IconName {
  if (node.kind === 'shape') {
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return 'Square';
      case 'ellipse':
        return 'Circle';
      case 'circle':
        return 'Circle';
      case 'line':
        return 'Minus';
      case 'polygon':
        return 'Pentagon';
      case 'star':
        return 'Star';
      case 'path':
        return 'Pen';
      case 'arrow':
        return 'ArrowRight';
      default:
        return 'Square';
    }
  }
  if (isExportRegion(node)) return 'Crop';
  if (node.kind === 'frame') return 'Frame';
  if (node.kind === 'group') return 'Group';
  if (node.kind === 'text') return 'Type';
  if (node.kind === 'adjustment') return 'SlidersHorizontal';
  return 'Square';
}

function getNodeTypeLabel(node: SceneNode): string {
  // An Export Region is stored as a frame; naming it one here is the same
  // masquerade the Export Region tool was renamed to end.
  if (isExportRegion(node)) return 'Export Region';
  if (node.kind === 'shape') {
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return 'Rectangle';
      case 'ellipse':
        return 'Ellipse';
      case 'circle':
        return 'Circle';
      case 'line':
        return 'Line';
      case 'polygon':
        return 'Polygon';
      case 'star':
        return 'Star';
      case 'path':
        return 'Path';
      case 'arrow':
        return 'Arrow';
      default:
        return 'Shape';
    }
  }
  return node.kind.charAt(0).toUpperCase() + node.kind.slice(1);
}

export function getDisplayAncestorChain(doc: Document, nodeId: NodeId): SceneNode[] {
  const structuralRootIds = new Set([
    ...(doc.pages?.map((page) => page.contentRoot) ?? []),
    ...Object.values(doc.masters ?? {}).map((master) => master.contentRoot),
  ]);
  const chain: SceneNode[] = [];
  let currentId: NodeId | null = nodeId;
  while (currentId) {
    const node = doc.nodes[currentId];
    if (!node) break;
    if (!structuralRootIds.has(currentId)) chain.unshift(node);
    currentId = getParent(doc, currentId);
  }
  return chain;
}

export function countActivePageLayers(doc: Document): number {
  const visited = new Set<NodeId>();
  const visit = (id: NodeId) => {
    if (visited.has(id)) return;
    const node = doc.nodes[id];
    if (!node) return;
    visited.add(id);
    if (isContainer(node)) {
      for (const childId of node.children) visit(childId);
    }
  };

  const activePage = doc.pages?.find((page) => page.id === doc.activePageId);
  const contentRoot = activePage ? doc.nodes[activePage.contentRoot] : undefined;
  const roots =
    contentRoot && isContainer(contentRoot)
      ? [...contentRoot.children, ...(doc.globalChildren ?? [])]
      : doc.rootChildren;
  for (const rootId of roots) visit(rootId);
  return visited.size;
}

function countByType(nodes: SceneNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    const type = node.kind;
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

export function SelectionInfoBar() {
  const { state, selectedNodes, setSelection } = useEditor();
  const { revealSelection } = useViewport();
  const sel = selectedNodes();

  const handleBreadcrumbClick = useCallback(
    (nodeId: NodeId) => {
      setSelection(nodeId);
      revealSelection({ nodeId, fit: false });
    },
    [setSelection, revealSelection],
  );

  const content = useMemo(() => {
    if (sel.length === 0) {
      const page = state.document.pages?.find((p) => p.id === state.document.activePageId);
      const totalLayers = countActivePageLayers(state.document);
      return (
        <div className="selection-info-bar__empty">
          <span className="selection-info-bar__page-name">{page?.name || 'Untitled'}</span>
          <span className="selection-info-bar__separator">—</span>
          <span className="selection-info-bar__layer-count">{totalLayers} layers</span>
        </div>
      );
    }

    if (sel.length === 1) {
      const node = sel[0];
      if (!node) return null;

      const bounds = nodeWorldBounds(state.document, node.id);
      const rotation = node.rotation ?? 0;
      const ancestors = getDisplayAncestorChain(state.document, node.id);

      return (
        <div className="selection-info-bar__single">
          <Icon name={getNodeTypeIcon(node)} size={14} />
          <span className="selection-info-bar__name">{node.name}</span>
          <span className="selection-info-bar__type">{getNodeTypeLabel(node)}</span>
          {bounds && (
            <>
              <span className="selection-info-bar__separator">—</span>
              <span className="selection-info-bar__dimensions">
                {Math.round(bounds.w)} x {Math.round(bounds.h)}
              </span>
              <span className="selection-info-bar__position">
                X: {Math.round(bounds.x)} Y: {Math.round(bounds.y)}
              </span>
            </>
          )}
          {rotation !== 0 && (
            <span className="selection-info-bar__rotation">{Math.round(rotation)}°</span>
          )}
          {ancestors.length > 1 && (
            <>
              <span className="selection-info-bar__separator">—</span>
              <div className="selection-info-bar__breadcrumbs">
                {ancestors.map((ancestor, idx) => (
                  <button
                    type="button"
                    key={ancestor.id}
                    className="selection-info-bar__breadcrumb"
                    onClick={() => handleBreadcrumbClick(ancestor.id)}
                    disabled={idx === ancestors.length - 1}
                  >
                    {ancestor.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      );
    }

    // Multi-selection
    const typeCounts = countByType(sel);
    const firstNode = sel[0];
    const sharedKind =
      firstNode && sel.every((n) => n.kind === firstNode.kind) ? firstNode.kind : null;
    const typeLabels: string[] = [];
    for (const [type, count] of Object.entries(typeCounts)) {
      typeLabels.push(`${count} ${type}`);
    }

    // Compute aggregate bbox
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const node of sel) {
      const bounds = nodeWorldBounds(state.document, node.id);
      if (!bounds) continue;
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.w);
      maxY = Math.max(maxY, bounds.y + bounds.h);
    }

    const aggregateW = Number.isFinite(minX) ? Math.round(maxX - minX) : 0;
    const aggregateH = Number.isFinite(minY) ? Math.round(maxY - minY) : 0;

    return (
      <div className="selection-info-bar__multi">
        <span className="selection-info-bar__count">{sel.length} selected</span>
        {sharedKind && firstNode && (
          <span className="selection-info-bar__shared-type">{getNodeTypeLabel(firstNode)}</span>
        )}
        {!sharedKind && (
          <span className="selection-info-bar__type-list">{typeLabels.join(', ')}</span>
        )}
        {aggregateW > 0 && aggregateH > 0 && (
          <>
            <span className="selection-info-bar__separator">—</span>
            <span className="selection-info-bar__dimensions">
              {aggregateW} x {aggregateH}
            </span>
          </>
        )}
      </div>
    );
  }, [sel, state.document, handleBreadcrumbClick, revealSelection]);

  return <div className="selection-info-bar">{content}</div>;
}
