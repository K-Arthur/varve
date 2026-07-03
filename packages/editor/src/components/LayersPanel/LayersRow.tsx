/**
 * LayersRow — a single treeitem in the layers tree view.
 *
 * Displays: disclosure triangle (if container), indent guide, type icon, name
 * (with inline rename), instance badge, visibility and lock toggles.
 *
 * Research basis: APG Tree View (role=treeitem), type icons per Lucide icon maps.
 */

import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type { NodeId, SceneNode, ShapeNode } from '@strata/scene';
import { isContainer } from '@strata/scene';
import type { IconName } from '@strata/ui';
import { CHROME_ICONS, Icon, TOOL_ICONS } from '@strata/ui';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useThumbnail } from './useThumbnail';

export interface LayersRowProps {
  node: SceneNode;
  depth: number;
  selected: boolean;
  focused: boolean;
  expanded: boolean;
  editing: boolean;
  onToggleExpand: (id: NodeId) => void;
  onSelect: (id: NodeId, shift: boolean, ctrl: boolean) => void;
  onRename: (id: NodeId, name: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onToggleVisibility: (id: NodeId) => void;
  onToggleLock: (id: NodeId) => void;
  onFocus: (idx: number) => void;
  idx: number;
  style?: React.CSSProperties;
  dragListeners?: DraggableSyntheticListeners;
  dragAttributes?: DraggableAttributes;
  /** Optional resolved variant name for component instances. */
  variantName?: string;
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
};

function nodeTypeIcon(n: SceneNode): IconName {
  if (n.kind === 'shape') return NODE_ICONS[(n as ShapeNode).shape.kind] ?? TOOL_ICONS.rect;
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
  onSelect,
  onRename,
  onRenameCommit,
  onRenameCancel,
  onToggleVisibility,
  onToggleLock,
  onFocus,
  idx,
  style,
  dragListeners,
  dragAttributes,
  variantName,
}: LayersRowProps) {
  const [editValue, setEditValue] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFrame = node.kind === 'frame';
  const isGroup = node.kind === 'group';
  const isContainerNode = isContainer(node);
  const typeIcon = nodeTypeIcon(node);
  const thumbnailDataUrl = useThumbnail(node);
  const showThumbnail = (node.kind === 'frame' || node.kind === 'image') && thumbnailDataUrl != null;
  const isInstance =
    isFrame && 'componentId' in node && (node as { componentId?: string }).componentId != null;
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
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onRenameCancel();
      }
    },
    [commitRename, onRenameCancel],
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
      {/* biome-ignore lint/a11y/useFocusableInteractive: treeitem managed by tree container focus */}
      <div
        role="treeitem"
        data-node-id={node.id}
        data-layer-type={resolveLayerType(node)}
        aria-selected={selected}
        aria-expanded={container ? expanded : undefined}
        aria-level={depth + 1}
        className={rowClass}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        style={{
          paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-3))`,
          ...style,
        }}
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
              onToggleExpand(node.id);
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

        {/* Thumbnail preview (frames and images) */}
        {showThumbnail && (
          <img
            src={thumbnailDataUrl!}
            alt=""
            aria-hidden
            className="layers-row__thumbnail"
          />
        )}

        {/* Type icon */}
        <Icon
          name={typeIcon}
          size="0.85em"
          aria-hidden
          className="layers-row__type-icon"
          style={isInstance ? { opacity: 0.6 } : undefined}
        />

        {/* Name or rename input */}
        {editing ? (
          <input
            ref={inputRef}
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

        {/* Instance badge */}
        {isInstance && !editing && (
          <span className="layers-row__instance-badge">instance</span>
        )}
        {/* Variant badge */}
        {isInstance && !editing && variantName && (
          <span className="layers-row__variant-badge">{variantName}</span>
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
