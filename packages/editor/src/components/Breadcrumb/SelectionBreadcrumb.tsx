import type { Document, NodeId } from '@varve/scene';
import { isContainer, isExportRegion } from '@varve/scene';
import { SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { getOrCreateParentCache, getParentFast } from '../../scene/parentIndexCache';
import './selectionBreadcrumb.css';

interface BreadcrumbSegment {
  id: NodeId;
  name: string;
  kind: string;
  isContainer: boolean;
}

export function SelectionBreadcrumb() {
  const { state } = useEditor();
  const { selection, primaryId, activeContainerId, document: doc } = state;

  const path = useMemo(() => {
    return buildBreadcrumbPath(doc, selection, primaryId, activeContainerId);
  }, [doc, selection, primaryId, activeContainerId]);

  if (path.length === 0) return null;

  return <BreadcrumbBar segments={path} />;
}

function buildBreadcrumbPath(
  doc: Document,
  selection: NodeId[],
  primaryId: NodeId | null,
  activeContainerId: NodeId | null,
): BreadcrumbSegment[] {
  const nodes = doc.nodes;
  const path: BreadcrumbSegment[] = [];

  const targetId = primaryId ?? (selection.length > 0 ? selection[0] : activeContainerId);
  if (!targetId) return path;

  const targetNode = nodes[targetId];
  if (!targetNode) return path;

  // Walk from root to the target building the ancestor chain
  const parentCache = getOrCreateParentCache(doc, null);
  const chain: NodeId[] = [];
  let current: NodeId | undefined = targetId;
  while (current) {
    chain.unshift(current);
    current = getParentFast(doc, current, parentCache) ?? undefined;
  }

  for (const id of chain) {
    const node = nodes[id];
    if (!node) continue;
    path.push({
      id,
      name: node.name || node.kind,
      // Export Regions are frames structurally but never containers: they
      // hold no content, so entering one has nothing to isolate.
      kind: isExportRegion(node) ? 'exportRegion' : node.kind,
      isContainer: isContainer(node) && !isExportRegion(node),
    });
  }

  // For multi-selection where the primary is set, add a count indicator
  if (selection.length > 1 && primaryId) {
    path.push({
      id: '',
      name: `+${selection.length - 1}`,
      kind: 'multi',
      isContainer: false,
    });
  }

  return path;
}

interface BreadcrumbBarProps {
  segments: BreadcrumbSegment[];
}

function BreadcrumbBar({ segments }: BreadcrumbBarProps) {
  const { setSelection, enterIsolation, revealSelection } = useEditor();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  const handleSegmentClick = useCallback(
    (segment: BreadcrumbSegment) => {
      if (!segment.id) return;
      setSelection(segment.id);
      revealSelection({ nodeId: segment.id, fit: true });
    },
    [setSelection, revealSelection],
  );

  const handleSegmentContext = useCallback(
    (e: React.MouseEvent, segment: BreadcrumbSegment) => {
      e.preventDefault();
      if (!segment.id || !segment.isContainer) return;
      enterIsolation?.(segment.id);
    },
    [enterIsolation],
  );

  // Show up to 4 segments, overflow the rest
  const visible = segments.length <= 5 ? segments : segments.slice(0, 2).concat(segments.slice(-2));
  const overflowCount = segments.length - visible.length;

  const kindLabel = (kind: string): string => {
    switch (kind) {
      case 'exportRegion':
        return 'Export Region';
      case 'frame':
        return 'Frame';
      case 'group':
        return 'Group';
      case 'text':
        return 'Text';
      case 'shape':
        return 'Shape';
      case 'multi':
        return 'selected';
      default:
        return kind;
    }
  };

  return (
    <nav className="selection-breadcrumb" aria-label="Selection path">
      {overflowCount > 0 && (
        <div className="selection-breadcrumb__overflow-wrapper" ref={overflowRef}>
          <button
            type="button"
            className="selection-breadcrumb__overflow-btn"
            onClick={() => setOverflowOpen(!overflowOpen)}
            aria-label={`${overflowCount} more levels`}
            aria-expanded={overflowOpen}
          >
            <SolidIcon name={SOLID_CHROME_ICONS.ellipsis} size="0.75em" />
          </button>
          {overflowOpen && (
            <div className="selection-breadcrumb__overflow-menu" role="menu">
              {segments.slice(0, overflowCount + 2).map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  className="selection-breadcrumb__overflow-item"
                  role="menuitem"
                  onClick={() => {
                    handleSegmentClick(seg);
                    setOverflowOpen(false);
                  }}
                  onContextMenu={(e) => handleSegmentContext(e, seg)}
                >
                  <span className="selection-breadcrumb__overflow-item-kind">
                    {kindLabel(seg.kind)}
                  </span>
                  <span className="selection-breadcrumb__overflow-item-name">{seg.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {visible.map((seg, i) => (
        <span key={seg.id || `multi-${i}`} className="selection-breadcrumb__segment-group">
          {i > 0 && (
            <SolidIcon
              name={SOLID_CHROME_ICONS.chevronRight}
              size="0.65em"
              className="selection-breadcrumb__separator"
            />
          )}
          <Tooltip
            label={
              seg.isContainer
                ? `${seg.name} (${kindLabel(seg.kind)}) — right-click to enter`
                : `${seg.name} (${kindLabel(seg.kind)})`
            }
          >
            <button
              type="button"
              className="selection-breadcrumb__segment"
              onClick={() => handleSegmentClick(seg)}
              onContextMenu={(e) => handleSegmentContext(e, seg)}
              aria-label={`${kindLabel(seg.kind)}: ${seg.name}${seg.isContainer ? '. Right-click to enter.' : ''}`}
            >
              <span className="selection-breadcrumb__segment-kind">{kindLabel(seg.kind)}</span>
              <span className="selection-breadcrumb__segment-name">{seg.name}</span>
            </button>
          </Tooltip>
        </span>
      ))}
    </nav>
  );
}
