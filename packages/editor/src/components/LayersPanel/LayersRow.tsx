/**
 * LayersRow — a single treeitem in the layers tree view.
 *
 * Displays: disclosure triangle (if container), indent guide, type icon, name
 * (with inline rename), instance badge, visibility and lock toggles.
 *
 * Research basis: APG Tree View (role=treeitem), type icons per Lucide icon maps.
 */

import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type { AdjustmentNode, InstanceStatus, NodeId, SceneNode, ShapeNode } from '@strata/scene';
import { isContainer, isImageShape, nodeHasStyle } from '@strata/scene';
import type { IconName } from '@strata/ui';
import { CHROME_ICONS, Icon, TOOL_ICONS } from '@strata/ui';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
  onRename: (id: NodeId, name: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameCycle?: (direction: 'next' | 'previous') => void;
  /** Fires when the type icon is double-clicked (zoom-to-layer). */
  onDoubleClickIcon?: (id: NodeId) => void;
  onToggleVisibility: (id: NodeId) => void;
  onToggleLock: (id: NodeId) => void;
  onFocus: (idx: number) => void;
  idx: number;
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
}

const NODE_ICONS: Record<string, IconName> = {
  frame: TOOL_ICONS.frame,
  group: TOOL_ICONS.group,
  text: TOOL_ICONS.text,
  rect: TOOL_ICONS.rect,
  ellipse: TOOL_ICONS.ellipse,
  circle: TOOL_ICONS.ellipse,
  line: TOOL_ICONS.line,
  polygon: TOOL_ICONS.polygon,
  star: TOOL_ICONS.star,
  component: TOOL_ICONS.component,
  image: TOOL_ICONS.image,
  arrow: TOOL_ICONS.line,
  path: 'Pen',
  adjustment: TOOL_ICONS.adjustment,
};

function nodeTypeIcon(n: SceneNode): IconName {
  if (n.kind === 'shape') {
    if (isImageShape(n)) return NODE_ICONS.image ?? TOOL_ICONS.rect;
    return NODE_ICONS[(n as ShapeNode).shape.kind] ?? TOOL_ICONS.rect;
  }
  return NODE_ICONS[n.kind] ?? TOOL_ICONS.rect;
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
  onRenameCommit,
  onRenameCancel,
  onRenameCycle,
  onDoubleClickIcon,
  onToggleVisibility,
  onToggleLock,
  onFocus,
  idx,
  style,
  dragListeners,
  dragAttributes,
  variantName,
  hasMotion,
  keyframeCount,
  syncStatus,
  presences,
  docId,
}: LayersRowProps) {
  const [editValue, setEditValue] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFrame = node.kind === 'frame';
  const isGroup = node.kind === 'group';
  const isContainerNode = isContainer(node);
  const typeIcon = nodeTypeIcon(node);
  const thumbnailDataUrl = useThumbnail(node, docId);
  const showThumbnail = (node.kind === 'frame' || isImageShape(node)) && thumbnailDataUrl != null;
  const isInstance =
    isFrame && 'componentId' in node && (node as { componentId?: string }).componentId != null;

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
    (e: React.MouseEvent) => {
      e.stopPropagation();
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
    onRename(node.id, node.name);
  }, [isContainerNode, node.id, node.name, onToggleExpand, onRename]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== node.name) {
      onRename(node.id, trimmed);
    }
    onRenameCommit();
  }, [editValue, node.id, node.name, onRename, onRenameCommit]);

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
          <Icon name={CHROME_ICONS.gripVertical} size="0.75em" />
        </button>

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
            <Icon
              name={expanded ? CHROME_ICONS.chevronDown : CHROME_ICONS.chevronRight}
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
            aria-label={`Color: ${node.layerColor}`}
          />
        )}

        {/* Thumbnail preview (frames and images) */}
        {showThumbnail && (
          <img src={thumbnailDataUrl!} alt="" aria-hidden className="layers-row__thumbnail" />
        )}

        {/* Type icon — double-click zooms to layer */}
        <span
          className="layers-row__icon-area"
          onDoubleClick={handleIconDoubleClick}
          role="button"
          aria-label={`Zoom to ${node.name}`}
          tabIndex={-1}
        >
          <Icon
            name={typeIcon}
            size="0.85em"
            aria-hidden
            className="layers-row__type-icon"
            style={isInstance ? { opacity: 0.6 } : undefined}
          />
        </span>

        {/* Name or rename input */}
        {editing ? (
          <input
            ref={inputRef}
            id={`layers-row-rename-${node.id}`}
            name={`layers-row-rename-${node.id}`}
            className="layers-row__name-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            aria-label={`Rename ${node.name}`}
          />
        ) : (
          <span
            className={`layers-row__name${isInstance ? ' layers-row__name--instance' : ''}`}
            title={node.name}
          >
            {node.name}
          </span>
        )}

        {/* Grid layout indicator */}
        {node.kind === 'frame' &&
          (node as { layoutStyle?: { mode?: string } }).layoutStyle?.mode === 'grid' &&
          !editing && (
            <span
              className="layers-row__grid-indicator"
              title="Grid layout"
              aria-label="Grid layout"
            >
              <Icon name={CHROME_ICONS.layoutGrid} size="0.75em" />
            </span>
          )}

        {/* Style indicator */}
        {nodeHasStyle(node) && !editing && (
          <span
            className="layers-row__style-indicator"
            title="Linked to style"
            aria-label="Linked to style"
          >
            <Icon name={CHROME_ICONS.palette} size="0.75em" />
          </span>
        )}

        {/* Instance badge */}
        {isInstance && !editing && <span className="layers-row__instance-badge">instance</span>}
        {/* Sync status indicator for component instances */}
        {isInstance && !editing && syncStatus && syncStatus !== 'synced' && (
          <span
            className={`layers-row__sync-badge layers-row__sync-badge--${syncStatus}`}
            title={
              syncStatus === 'overridden'
                ? 'Has local overrides'
                : 'Broken — master component not found'
            }
          >
            {syncStatus === 'overridden' ? 'modified' : 'broken'}
          </span>
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

        {/* Motion indicator dot */}
        {hasMotion && !editing && <span className="layers-row__motion-dot" title="Has animation" />}

        {/* Keyframe count badge */}
        {keyframeCount != null && keyframeCount > 0 && !editing && (
          <span className="layers-row__keyframe-badge">{keyframeCount}</span>
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
            node.visible
              ? 'layers-row__toggle--visibility-on'
              : 'layers-row__toggle--visibility-off'
          }`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(node.id);
          }}
          aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
          aria-pressed={!node.visible}
        >
          <Icon
            name={node.visible ? CHROME_ICONS.visibility : CHROME_ICONS.visibilityOff}
            size="0.85em"
          />
        </button>

        {/* Lock toggle */}
        <button
          type="button"
          className={`layers-row__toggle ${
            node.locked ? 'layers-row__toggle--locked-on' : 'layers-row__toggle--locked-off'
          }`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(node.id);
          }}
          aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
          aria-pressed={node.locked}
        >
          <Icon name={node.locked ? CHROME_ICONS.lock : CHROME_ICONS.unlock} size="0.85em" />
        </button>
      </div>
    </>
  );
});
