/**
 * LayersRow — a single treeitem in the layers tree view.
 *
 * Displays: disclosure triangle (if container), indent guide, type icon, name
 * (with inline rename), instance badge, visibility and lock toggles.
 *
 * Research basis: APG Tree View (role=treeitem), type icons per Lucide icon maps.
 */

import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type {
  AdjustmentNode,
  Document,
  InstanceStatus,
  NodeId,
  SceneNode,
  ShapeNode,
} from '@varve/scene';
import { isAnimatedMediaNode, isContainer, isImageShape, nodeHasStyle } from '@varve/scene';
import type { SolidIconName } from '@varve/ui';
import { SOLID_CHROME_ICONS, SOLID_TOOL_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoName } from '../../intelligence/autoNamer';
import type { PresenceData } from './PresenceIndicator';
import { PresenceIndicator } from './PresenceIndicator';
import { useThumbnail } from './useThumbnail';

export interface LayersRowProps {
  node: SceneNode;
  depth: number;
  selected: boolean;
  focused: boolean;
  expanded: boolean;
  editing: boolean;
  onToggleExpand: (id: NodeId) => void;
  onExpandSubtree?: (id: NodeId) => void;
  onCollapseSubtree?: (id: NodeId) => void;
  onExpandToDepth1?: (id: NodeId) => void;
  onSelect: (id: NodeId, shift: boolean, ctrl: boolean) => void;
  /** Commit a new name for the row. */
  onRename: (id: NodeId, name: string) => void;
  /** Enter inline edit mode for the row. */
  onRenameStart: (id: NodeId) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameCycle?: (direction: 'next' | 'previous') => void;
  /** Fires when the type icon is double-clicked (zoom-to-layer). */
  onDoubleClickIcon?: (id: NodeId) => void;
  onToggleVisibility: (id: NodeId) => void;
  onToggleLock: (id: NodeId) => void;
  onToggleSelectionCheckbox?: (id: NodeId) => void;
  onFocus: (idx: number) => void;
  idx: number;
  /** Total visible rows (for aria-setsize on virtualized trees). */
  totalRows: number;
  style?: React.CSSProperties;
  dragListeners?: DraggableSyntheticListeners;
  dragAttributes?: DraggableAttributes;
  /** Optional resolved variant name for component instances. */
  variantName?: string;
  /** Whether this node has animation keyframes in any timeline. */
  hasMotion?: boolean;
  /** Number of keyframes across all timelines for this node. */
  keyframeCount?: number;
  /** Sync status for component instances. */
  syncStatus?: InstanceStatus;
  /** Other users currently present on this node (collaborative editing). */
  presences?: PresenceData[];
  /** Owning document id — scopes the thumbnail cache so nodes with the same
   * id in different open documents (ids are per-document counters starting
   * at `n1`) never share a cached thumbnail. */
  docId?: string;
  /** Document used to compute auto-name suggestions while renaming. */
  doc?: Document;
  /** Relationship to the direct parent's structural mask, when applicable. */
  maskRole?: 'source' | 'content';
  /** Full selection set — used to compute mixed visibility/lock state for toggles. */
  selectedIds?: Set<NodeId>;
}

const NODE_ICONS: Record<string, SolidIconName> = {
  frame: SOLID_TOOL_ICONS.frame,
  group: SOLID_TOOL_ICONS.group,
  text: SOLID_TOOL_ICONS.text,
  rect: SOLID_TOOL_ICONS.rect,
  ellipse: SOLID_TOOL_ICONS.ellipse,
  circle: SOLID_TOOL_ICONS.ellipse,
  line: SOLID_TOOL_ICONS.line,
  polygon: SOLID_TOOL_ICONS.polygon,
  star: SOLID_TOOL_ICONS.star,
  component: SOLID_TOOL_ICONS.component,
  image: SOLID_TOOL_ICONS.image,
  arrow: SOLID_TOOL_ICONS.arrow,
  path: 'Pen',
  adjustment: SOLID_TOOL_ICONS.adjustment,
};

function nodeTypeIcon(n: SceneNode): SolidIconName {
  if (n.kind === 'shape') {
    if (isImageShape(n)) return NODE_ICONS.image ?? SOLID_TOOL_ICONS.rect;
    return NODE_ICONS[(n as ShapeNode).shape.kind] ?? SOLID_TOOL_ICONS.rect;
  }
  return NODE_ICONS[n.kind] ?? SOLID_TOOL_ICONS.rect;
}

function resolveLayerType(node: SceneNode): string {
  if (
    node.kind === 'frame' &&
    'componentId' in node &&
    (node as { componentId?: string }).componentId != null
  ) {
    return 'component';
  }
  return node.kind;
}

export const LayersRow = memo(function LayersRow({
  node,
  depth,
  selected,
  focused,
  expanded,
  editing,
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
  onDoubleClickIcon,
  onToggleVisibility,
  onToggleLock,
  onToggleSelectionCheckbox,
  onFocus,
  idx,
  totalRows,
  style,
  dragListeners,
  dragAttributes,
  variantName,
  hasMotion,
  keyframeCount,
  syncStatus,
  presences,
  docId,
  doc,
  maskRole,
  selectedIds,
}: LayersRowProps) {
  const [editValue, setEditValue] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const ghostName = useMemo(() => (doc ? autoName(doc, node) : null), [doc, node]);
  const isFrame = node.kind === 'frame';
  const isGroup = node.kind === 'group';
  const isContainerNode = isContainer(node);
  const typeIcon = nodeTypeIcon(node);
  const thumbnailDataUrl = useThumbnail(node, docId);
  // Only show a preview chip for real image content — solid-fill frame
  // thumbnails read as unexplained coloured squares next to the type icon.
  const showThumbnail = isImageShape(node) && thumbnailDataUrl != null;
  const isInstance =
    isFrame && 'componentId' in node && (node as { componentId?: string }).componentId != null;

  // Compute mixed visibility/lock state for multi-selection toggles.
  // When multiple nodes are selected, the toggle icon reflects whether ALL
  // selected nodes share the same state or whether it's mixed.
  const hasMultiSelection = selectedIds && selectedIds.size > 1;
  const isMixedVisibility = useMemo(() => {
    if (!hasMultiSelection || !selectedIds) return false;
    const vals = [...selectedIds].map((id) => {
      const n = doc?.nodes[id];
      return n ? 'visible' in n && n.visible : true;
    });
    return vals.some((v) => v !== vals[0]);
  }, [hasMultiSelection, selectedIds, doc]);
  const isMixedLocked = useMemo(() => {
    if (!hasMultiSelection || !selectedIds) return false;
    const vals = [...selectedIds].map((id) => {
      const n = doc?.nodes[id];
      return n ? 'locked' in n && n.locked : false;
    });
    return vals.some((v) => v !== vals[0]);
  }, [hasMultiSelection, selectedIds, doc]);

  // Blend mode / opacity badge
  const blendModeLabel =
    node.blendMode !== 'normal' && node.blendMode !== 'passThrough'
      ? node.blendMode.charAt(0).toUpperCase() + node.blendMode.slice(1)
      : null;
  const opacityLabel = node.opacity < 1 ? `${Math.round(node.opacity * 100)}%` : null;
  const badgeText =
    blendModeLabel || opacityLabel
      ? [blendModeLabel, opacityLabel].filter(Boolean).join(' ')
      : null;

  const handleIconDoubleClick = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      onDoubleClickIcon?.(node.id);
    },
    [node.id, onDoubleClickIcon],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onSelect(node.id, e.shiftKey, e.ctrlKey || e.metaKey);
      onFocus(idx);
    },
    [node.id, idx, onSelect, onFocus],
  );

  const handleDoubleClick = useCallback(() => {
    if (isContainerNode) onToggleExpand(node.id);
    // Begin editing. This previously reused `onRename` with the node's current
    // name, which left the parent unable to tell "start editing" apart from
    // "save this name" — so it treated every commit as another start and the
    // typed name was never written to the document.
    onRenameStart(node.id);
  }, [isContainerNode, node.id, onToggleExpand, onRenameStart]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed === '') {
      if (ghostName && ghostName !== node.name) {
        onRename(node.id, ghostName);
      }
    } else if (trimmed !== node.name) {
      onRename(node.id, trimmed);
    }
    onRenameCommit();
  }, [editValue, node.id, node.name, onRename, onRenameCommit, ghostName]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Stop these from bubbling to the tree container's own onKeyDown —
      // without it, e.g. Escape-to-cancel-rename also fires the tree's
      // Escape-to-exit-isolation handler in the same keypress.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onRenameCancel();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitRename();
        onRenameCycle?.(e.shiftKey ? 'previous' : 'next');
      }
    },
    [commitRename, onRenameCancel, onRenameCycle],
  );

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const container = isFrame || isGroup;

  // Sync edit value when editing state changes
  useEffect(() => {
    if (editing) {
      setEditValue(node.name);
    }
  }, [editing, node.name]);

  const rowClass = [
    'layers-row',
    selected ? 'layers-row--selected' : '',
    focused ? 'layers-row--focused' : '',
    !node.visible ? 'layers-row--hidden' : '',
    node.locked ? 'layers-row--locked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard at tree level per APG tree view */}
      <div
        role="treeitem"
        data-node-id={node.id}
        data-layer-type={resolveLayerType(node)}
        aria-selected={selected}
        aria-expanded={container ? expanded : undefined}
        aria-level={depth + 1}
        aria-setsize={totalRows}
        aria-posinset={idx + 1}
        className={rowClass}
        tabIndex={focused ? 0 : -1}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        style={{
          paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-3))`,
          ...style,
        }}
        // Draggable from anywhere on the row (Figma/Illustrator/Photoshop
        // convention), not just the small grip handle — but not while renaming,
        // so dragging to select text in the rename input isn't hijacked as a
        // reorder/reparent gesture. dragAttributes (ARIA role/description)
        // stays scoped to the labeled handle button below for a11y.
        {...(!editing ? dragListeners : undefined)}
      >
        {/* Drag handle */}
        <button
          type="button"
          className="layers-row__drag-handle"
          aria-label="Drag to reorder"
          tabIndex={-1}
          {...dragListeners}
          {...dragAttributes}
        >
          <SolidIcon name={SOLID_CHROME_ICONS.gripVertical} size="0.75em" />
        </button>

        {/* Selection checkbox — visual and touch-friendly multi-select affordance */}
        <label
          className={`layers-row__selection-checkbox ${selected ? 'layers-row__selection-checkbox--selected' : ''}`}
          tabIndex={-1}
          aria-label={
            selected ? `Remove ${node.name} from selection` : `Add ${node.name} to selection`
          }
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelectionCheckbox?.(node.id);
            }}
            hidden
          />
          <SolidIcon
            name={selected ? SOLID_CHROME_ICONS.checkSquare : SOLID_CHROME_ICONS.square}
            size="0.75em"
          />
        </label>

        {/* Disclosure triangle */}
        {container ? (
          <button
            type="button"
            className="layers-row__disclosure"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              if (e.altKey) {
                onExpandSubtree?.(node.id);
              } else if (e.shiftKey) {
                onCollapseSubtree?.(node.id);
              } else if (e.ctrlKey || e.metaKey) {
                onExpandToDepth1?.(node.id);
              } else {
                onToggleExpand(node.id);
              }
            }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <SolidIcon
              name={expanded ? SOLID_CHROME_ICONS.chevronDown : SOLID_CHROME_ICONS.chevronRight}
              size="0.75em"
            />
          </button>
        ) : (
          <span className="layers-row__disclosure-spacer" />
        )}

        {/* Color tag indicator (8px dot) */}
        {node.layerColor && (
          <span
            className={`layers-row__color-tag layers-row__color-tag--${node.layerColor}`}
            data-layer-color={node.layerColor}
            role="img"
            aria-label={`Color: ${node.layerColor}`}
          />
        )}

        {/* Thumbnail preview (frames and images) */}
        {showThumbnail && (
          <img src={thumbnailDataUrl!} alt="" aria-hidden className="layers-row__thumbnail" />
        )}

        {/* Type icon — double-click zooms to layer */}
        <button
          type="button"
          className="layers-row__icon-area"
          onDoubleClick={handleIconDoubleClick}
          aria-label={`Zoom to ${node.name}`}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleIconDoubleClick();
            }
          }}
        >
          <SolidIcon
            name={typeIcon}
            size={16}
            aria-hidden
            className="layers-row__type-icon"
            style={isInstance ? { opacity: 0.65 } : undefined}
          />
        </button>

        {/* Name or rename input */}
        {editing ? (
          <input
            ref={inputRef}
            id={`layers-row-rename-${node.id}`}
            name={`layers-row-rename-${node.id}`}
            className="layers-row__name-input"
            value={editValue}
            placeholder={ghostName ?? ''}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            aria-label={`Rename ${node.name}`}
          />
        ) : (
          <Tooltip label={node.name} truncationOnly>
            <span className={`layers-row__name${isInstance ? ' layers-row__name--instance' : ''}`}>
              {node.name}
            </span>
          </Tooltip>
        )}

        {/* Animated-media badge (subtle, rows without animation unchanged) */}
        {!editing && doc && isAnimatedMediaNode(node, doc) && (
          <Tooltip label={`Animated media: ${animatedFrameCount(doc, node)} frames`}>
            <span
              className="layers-row__media-badge"
              role="status"
              aria-label={`Animated: ${animatedFrameCount(doc, node)} frames`}
            >
              Animated · {animatedFrameCount(doc, node)}
            </span>
          </Tooltip>
        )}

        {/* Grid layout indicator */}
        {node.kind === 'frame' &&
          (node as { layoutStyle?: { mode?: string } }).layoutStyle?.mode === 'grid' &&
          !editing && (
            <Tooltip label="Grid layout">
              <span className="layers-row__grid-indicator" role="img" aria-label="Grid layout">
                <SolidIcon name={SOLID_CHROME_ICONS.layoutGrid} size="0.75em" />
              </span>
            </Tooltip>
          )}

        {/* Style indicator */}
        {nodeHasStyle(node) && !editing && (
          <Tooltip label="Linked to style">
            <span className="layers-row__style-indicator" role="img" aria-label="Linked to style">
              <SolidIcon name={SOLID_CHROME_ICONS.palette} size="0.75em" />
            </span>
          </Tooltip>
        )}

        {/* Instance badge */}
        {isInstance && !editing && <span className="layers-row__instance-badge">instance</span>}
        {/* Sync status indicator for component instances */}
        {isInstance && !editing && syncStatus && syncStatus !== 'synced' && (
          <Tooltip
            label={
              syncStatus === 'overridden'
                ? 'Has local overrides'
                : 'Broken — master component not found'
            }
          >
            <span className={`layers-row__sync-badge layers-row__sync-badge--${syncStatus}`}>
              {syncStatus === 'overridden' ? 'modified' : 'broken'}
            </span>
          </Tooltip>
        )}
        {/* Variant badge */}
        {isInstance && !editing && variantName && (
          <span className="layers-row__variant-badge">{variantName}</span>
        )}

        {/* Adjustment type badge */}
        {node.kind === 'adjustment' && !editing && (
          <span className="layers-row__adjustment-badge">
            {(node as AdjustmentNode).adjustmentType}
          </span>
        )}
        {/* Adjustment scope badge */}
        {node.kind === 'adjustment' &&
          !editing &&
          (() => {
            const adjNode = node as AdjustmentNode;
            const s = adjNode.scope;
            if (!s) return null;
            const label =
              s.mode === 'image-local'
                ? 'I'
                : s.mode === 'explicit-targets'
                  ? `T${s.targetNodeIds.length}`
                  : s.mode === 'container-descendant'
                    ? 'C'
                    : 'G';
            const title =
              s.mode === 'image-local'
                ? 'Targets one image'
                : s.mode === 'explicit-targets'
                  ? `Targets ${s.targetNodeIds.length} nodes`
                  : s.mode === 'container-descendant'
                    ? 'Container descendants'
                    : 'Document-wide';
            return (
              <span className="layers-row__scope-badge" role="img" aria-label={title}>
                {label}
              </span>
            );
          })()}

        {/* Motion indicator dot */}
        {hasMotion && !editing && (
          <span className="layers-row__motion-dot" role="img" aria-label="Has animation" />
        )}

        {/* Keyframe count badge */}
        {keyframeCount != null && keyframeCount > 0 && !editing && (
          <span className="layers-row__keyframe-badge">{keyframeCount}</span>
        )}

        {/* Mask indicator badge */}
        {(node as { mask?: { type?: string; visible?: boolean } }).mask?.visible && !editing && (
          <span
            className={`layers-row__mask-badge ${
              (node as { mask?: { type?: string } }).mask?.type === 'alpha'
                ? 'layers-row__mask-badge--alpha'
                : (node as { mask?: { type?: string } }).mask?.type === 'luminance'
                  ? 'layers-row__mask-badge--luminance'
                  : 'layers-row__mask-badge--clip'
            }`}
            role="img"
            aria-label={`${(node as { mask?: { type?: string } }).mask?.type ?? 'clip'} mask`}
          >
            {(node as { mask?: { type?: string } }).mask?.type ?? 'clip'}
          </span>
        )}

        {maskRole && !editing && (
          <Tooltip label={maskRole === 'source' ? 'Clipping mask source' : 'Clipped content'}>
            <span
              className={`layers-row__mask-role layers-row__mask-role--${maskRole}`}
              role="img"
              aria-label={maskRole === 'source' ? 'Clipping mask source' : 'Clipped content'}
              data-mask-role={maskRole}
            >
              {maskRole === 'source' ? 'mask' : 'clipped'}
            </span>
          </Tooltip>
        )}

        {/* Blend mode / opacity badge */}
        {badgeText && !editing && <span className="layers-row__badge">{badgeText}</span>}

        {/* Collaborator presence */}
        {presences && presences.length > 0 && !editing && (
          <PresenceIndicator presences={presences} />
        )}

        {/* Visibility toggle */}
        <button
          type="button"
          className={`layers-row__toggle ${
            isMixedVisibility
              ? 'layers-row__toggle--visibility-mixed'
              : node.visible
                ? 'layers-row__toggle--visibility-on'
                : 'layers-row__toggle--visibility-off'
          }`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(node.id);
          }}
          aria-label={
            isMixedVisibility
              ? `Mixed visibility for selection`
              : node.visible
                ? `Hide ${node.name}`
                : `Show ${node.name}`
          }
          aria-pressed={isMixedVisibility ? undefined : !node.visible}
        >
          {isMixedVisibility ? (
            <SolidIcon name={SOLID_CHROME_ICONS.minus} size="0.85em" />
          ) : (
            <SolidIcon
              name={node.visible ? SOLID_CHROME_ICONS.visibility : SOLID_CHROME_ICONS.visibilityOff}
              size="0.85em"
            />
          )}
        </button>

        {/* Lock toggle */}
        <button
          type="button"
          className={`layers-row__toggle ${
            isMixedLocked
              ? 'layers-row__toggle--locked-mixed'
              : node.locked
                ? 'layers-row__toggle--locked-on'
                : 'layers-row__toggle--locked-off'
          }`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(node.id);
          }}
          aria-label={
            isMixedLocked
              ? `Mixed lock for selection`
              : node.locked
                ? `Unlock ${node.name}`
                : `Lock ${node.name}`
          }
          aria-pressed={isMixedLocked ? undefined : node.locked}
        >
          {isMixedLocked ? (
            <SolidIcon name={SOLID_CHROME_ICONS.minus} size="0.85em" />
          ) : (
            <SolidIcon
              name={node.locked ? SOLID_CHROME_ICONS.lock : SOLID_CHROME_ICONS.unlock}
              size="0.85em"
            />
          )}
        </button>
      </div>
    </>
  );
});

function animatedFrameCount(
  doc: import('@varve/scene').Document | undefined,
  node: SceneNode,
): number {
  if (!doc || node.kind !== 'shape') return 0;
  for (const fill of node.fills ?? []) {
    if (fill.type !== 'image' || !fill.image?.assetId) continue;
    const animated = doc.assets?.[fill.image.assetId]?.animated;
    if (animated) return animated.frameCount;
  }
  return 0;
}
