import type { Document, NodeId } from '@varve/scene';
import { Menu, type MenuEntry, SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import {
  buildSelectionContext,
  type SelectionHierarchyEntry,
} from '../../selection/selectionContext';
import './selectionBreadcrumb.css';

type BreadcrumbSegment = Omit<SelectionHierarchyEntry, 'node'>;

/** Levels a path renders in full before it is folded into the overflow menu. */
export const MAX_INLINE_BREADCRUMB_SEGMENTS = 5;

export interface BreadcrumbPlan {
  visible: BreadcrumbSegment[];
  hidden: BreadcrumbSegment[];
}

/**
 * Split a selection path into the levels shown inline and the ones folded
 * behind the overflow control.
 *
 * Paths of up to `MAX_INLINE_BREADCRUMB_SEGMENTS` levels render in full.
 * Longer paths keep the first two levels (outermost container → its child) and
 * the last two (inner container → the selected leaf), so the leaf the path
 * exists to identify is always inline; the levels between them are offered by
 * the overflow menu. `visible` and `hidden` partition the input: no level is
 * dropped, and none appears in both places (the overflow menu previously
 * re-listed the two leading levels the bar already showed).
 */
export function planBreadcrumbSegments(
  segments: readonly BreadcrumbSegment[],
  maxInline: number = MAX_INLINE_BREADCRUMB_SEGMENTS,
): BreadcrumbPlan {
  if (segments.length <= maxInline) {
    return { visible: [...segments], hidden: [] };
  }
  return {
    visible: [...segments.slice(0, 2), ...segments.slice(-2)],
    hidden: segments.slice(2, -2),
  };
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
  const barRef = useRef<HTMLElement>(null);

  // Publish the bar's rendered height. The dock's `path` row is `auto`, so its
  // height is content-driven (and grows with text enlargement) and cannot be
  // expressed as a token — but canvas-corner chrome anchored to the shell's
  // `canvas` grid area (the panel restore chips) has to clear the path row *and*
  // the 20px rulers below it. Same mechanism as `--floating-toolbar-height`;
  // the property is removed when the bar unmounts, which is exactly when there
  // is no path row. See `.editor__panel-restore-btn` in editor.css.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const rootElement = bar?.ownerDocument.documentElement;
    if (!bar || !rootElement) return;
    const publish = () => {
      const height = bar.getBoundingClientRect().height;
      if (Number.isFinite(height) && height > 0) {
        rootElement.style.setProperty('--selection-path-height', `${Math.ceil(height)}px`);
      }
    };
    publish();
    if (typeof ResizeObserver === 'undefined') {
      return () => rootElement.style.removeProperty('--selection-path-height');
    }
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      rootElement.style.removeProperty('--selection-path-height');
    };
  }, []);

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

  // Paths longer than the inline limit fold their middle levels into the
  // overflow menu; the leaf always stays inline (see planBreadcrumbSegments).
  const { visible, hidden } = useMemo(() => planBreadcrumbSegments(segments), [segments]);
  const overflowCount = hidden.length;

  const overflowItems = useMemo<MenuEntry[]>(
    () =>
      hidden.map((segment, index) => ({
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
    [handleSegmentClick, handleSegmentContext, hidden],
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
    <nav ref={barRef} className="selection-breadcrumb" aria-label="Selection path">
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
            size="default"
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
