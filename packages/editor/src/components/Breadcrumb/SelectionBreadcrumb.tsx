import type { Document, NodeId } from '@varve/scene';
import { Menu, type MenuEntry, SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import {
  buildSelectionContext,
  type SelectionHierarchyEntry,
} from '../../selection/selectionContext';
import './selectionBreadcrumb.css';

type BreadcrumbSegment = Omit<SelectionHierarchyEntry, 'node'>;

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
  const model = buildSelectionContext(doc, selection, primaryId, activeContainerId);
  const path = model.hierarchy.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    isContainer: entry.isContainer,
  }));

  // For multi-selection where the primary is set, add a count indicator
  if (model.count > 1 && model.primaryId) {
    path.push({
      id: '',
      name: `+${model.count - 1}`,
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
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);

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

  const overflowItems = useMemo<MenuEntry[]>(
    () =>
      segments.slice(0, overflowCount + 2).map((segment, index) => ({
        id: `breadcrumb-${segment.id || index}`,
        label: `${kindLabel(segment.kind)}: ${segment.name}`,
        onAction: () => {
          handleSegmentClick(segment);
          setOverflowOpen(false);
        },
        onContextMenu: (event) => {
          handleSegmentContext(event, segment);
          setOverflowOpen(false);
        },
      })),
    [handleSegmentClick, handleSegmentContext, overflowCount, segments],
  );

  function kindLabel(kind: string): string {
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
  }

  return (
    <nav className="selection-breadcrumb" aria-label="Selection path">
      {overflowCount > 0 && (
        <div className="selection-breadcrumb__overflow-wrapper">
          <button
            ref={overflowTriggerRef}
            type="button"
            className="selection-breadcrumb__overflow-btn"
            onClick={() => setOverflowOpen(!overflowOpen)}
            aria-label={`${overflowCount} more levels`}
            aria-expanded={overflowOpen}
            aria-haspopup="menu"
          >
            <SolidIcon name={SOLID_CHROME_ICONS.ellipsis} size="0.75em" />
          </button>
          <Menu
            triggerRef={overflowTriggerRef}
            open={overflowOpen}
            onClose={() => setOverflowOpen(false)}
            label="Selection path"
            items={overflowItems}
          />
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
