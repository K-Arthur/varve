/**
 * SortableVirtualRow — combines @dnd-kit's useSortable with
 * @tanstack/react-virtual positioning for a single virtualized tree row.
 *
 * Extracted from LayersTree.tsx to reduce its cyclomatic complexity.
 */

import { useSortable } from '@dnd-kit/sortable';
import type { Virtualizer } from '@tanstack/react-virtual';
import { getInstanceStatus, type NodeId, type SceneNode } from '@varve/scene';
import { useEditor } from '../../context';
import { useEffectStackDrag } from '../Shell/effectStackDragContext';
import { LayersRow } from './LayersRow';
import { usePresence } from './presenceStore';

export interface SortableVirtualRowProps {
  node: SceneNode;
  depth: number;
  selected: boolean;
  focused: boolean;
  expanded: boolean;
  editing: boolean;
  virtualItem: import('@tanstack/react-virtual').VirtualItem;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  dropClass: string;
  /** True while the drop preview targets a clipping mask source row — the
   *  row shows a "clip" hint so the user sees the resulting relationship
   *  before releasing the pointer. */
  dropClip: boolean;
  hasMotion: boolean;
  keyframeCount: number;
  maskRole?: 'source' | 'content';
  onToggleExpand: (id: NodeId) => void;
  onExpandSubtree: (id: NodeId) => void;
  onCollapseSubtree: (id: NodeId) => void;
  onExpandToDepth1: (id: NodeId) => void;
  onSelect: (id: NodeId, shift: boolean, ctrl: boolean) => void;
  onRename: (id: NodeId, name: string) => void;
  onRenameStart: (id: NodeId) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameCycle?: (direction: 'next' | 'previous') => void;
  onToggleVisibility: (id: NodeId) => void;
  onToggleLock: (id: NodeId) => void;
  onToggleSolo?: (id: NodeId) => void;
  onToggleSelectionCheckbox?: (id: NodeId) => void;
  onFocus: (idx: number) => void;
  idx: number;
  siblingIndex?: number;
  siblingCount?: number;
  /** Shared map of currently-mounted row elements, keyed by node id — used by
   * the parent's DnD handlers to resolve a row's rect for drop-zone math. */
  rowRefs: React.MutableRefObject<Map<NodeId, HTMLDivElement>>;
  selectedIds?: Set<NodeId>;
  onCopyEffectStack: (
    sourceId: NodeId,
    kind: import('@varve/scene').EffectStackKind,
    mode?: import('@varve/scene').EffectStackTransferMode,
  ) => void;
  onOpenEffectStack: (id: NodeId, kind: import('@varve/scene').EffectStackKind) => void;
  onOpenAdjustment: (id: NodeId) => void;
}

export function SortableVirtualRow({
  node,
  depth,
  selected,
  focused,
  expanded,
  editing,
  virtualItem,
  virtualizer,
  dropClass,
  dropClip,
  hasMotion,
  keyframeCount,
  maskRole,
  onToggleExpand,
  onExpandSubtree,
  onCollapseSubtree,
  onExpandToDepth1,
  onSelect,
  onRename,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onRenameCycle,
  onToggleVisibility,
  onToggleLock,
  onToggleSolo,
  onToggleSelectionCheckbox,
  onFocus,
  idx,
  siblingIndex,
  siblingCount,
  rowRefs,
  selectedIds,
  onCopyEffectStack,
  onOpenEffectStack,
  onOpenAdjustment,
}: SortableVirtualRowProps) {
  const totalRows = virtualizer.options.count;
  const { state: editorState, revealSelection } = useEditor();
  const effectStackDrag = useEffectStackDrag();
  const presences = usePresence(node.id);
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    isDragging,
  } = useSortable({
    id: node.id,
    data: {
      type: 'layer',
      nodeId: node.id,
      parentId: null, // resolved at drop time
    },
  });
  const effectStackDrop =
    effectStackDrag?.targetId === node.id
      ? {
          sourceId: effectStackDrag.sourceId,
          kind: effectStackDrag.stackKind,
          mode: effectStackDrag.transferMode,
        }
      : undefined;

  // Resolve variant name for component instances
  const variantName =
    node.kind === 'frame' && node.componentId && node.variant
      ? (() => {
          const comp = editorState.document.components[node.componentId];
          if (!comp?.variants) return undefined;
          const v = comp.variants.find((v) => v.id === node.variant);
          return v?.name;
        })()
      : undefined;

  // Resolve sync status for component instances
  const syncStatus: import('@varve/scene').InstanceStatus | undefined =
    node.kind === 'frame' && node.componentId
      ? (() => {
          try {
            return getInstanceStatus(editorState.document, node.id);
          } catch {
            return undefined;
          }
        })()
      : undefined;

  const style = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    // A sortable transform assumes every item has a stable DOM rectangle.
    // Virtual rows do not: applying both transforms makes the visible row and
    // the hit-tested row diverge during scroll and mount/unmount.
    transform: `translateY(${virtualItem.start}px)`,
    transition: 'none',
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <div
      ref={(el) => {
        setSortableRef(el);
        virtualizer.measureElement(el);
        // This div is just the virtualizer's absolute-positioned wrapper —
        // it has no tabIndex and can't receive focus. The focusable
        // role="treeitem" element (LayersRow's root) is its direct child;
        // that's what roving-tabindex focus management needs a handle to.
        const row = el?.querySelector<HTMLDivElement>('[role="treeitem"]');
        if (row) rowRefs.current.set(node.id, row);
        else rowRefs.current.delete(node.id);
      }}
      data-index={virtualItem.index}
      style={style}
      className={dropClass}
    >
      {dropClip ? (
        <span className="layers-row__clip-hint" role="status">
          Clip to {node.name}
        </span>
      ) : null}
      <LayersRow
        node={node}
        depth={depth}
        selected={selected}
        focused={focused}
        expanded={expanded}
        editing={editing}
        onRenameStart={onRenameStart}
        onToggleExpand={onToggleExpand}
        onExpandSubtree={onExpandSubtree}
        onCollapseSubtree={onCollapseSubtree}
        onExpandToDepth1={onExpandToDepth1}
        onSelect={onSelect}
        onRename={onRename}
        onRenameCommit={onRenameCommit}
        onRenameCancel={onRenameCancel}
        onRenameCycle={onRenameCycle}
        onToggleVisibility={onToggleVisibility}
        onToggleLock={onToggleLock}
        onToggleSolo={onToggleSolo}
        onToggleSelectionCheckbox={onToggleSelectionCheckbox}
        onFocus={onFocus}
        idx={idx}
        totalRows={totalRows}
        siblingIndex={siblingIndex}
        siblingCount={siblingCount}
        dragListeners={isDragging ? undefined : listeners}
        dragAttributes={isDragging ? undefined : attributes}
        variantName={variantName}
        hasMotion={hasMotion}
        keyframeCount={keyframeCount}
        maskRole={maskRole}
        syncStatus={syncStatus}
        presences={presences}
        docId={editorState.document.id}
        doc={editorState.document}
        onDoubleClickIcon={(id) => revealSelection({ nodeId: id, fit: true })}
        selectedIds={selectedIds}
        onCopyEffectStack={onCopyEffectStack}
        onOpenEffectStack={onOpenEffectStack}
        onOpenAdjustment={onOpenAdjustment}
        effectStackDrop={effectStackDrop}
      />
    </div>
  );
}
