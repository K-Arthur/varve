import { filterKindDisplayName } from '@strata/engine';
import type { AdjustmentNode, NodeId } from '@strata/scene';
import { adjustmentEnabledCount } from '@strata/scene';
import { CHROME_ICONS, Icon } from '@strata/ui';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import './adjustment.css';

export interface AdjustmentLayerRowProps {
  node: AdjustmentNode;
  depth: number;
  selected: boolean;
  focused: boolean;
  editing: boolean;
  onSelect: (id: NodeId, shift: boolean, ctrl: boolean) => void;
  onRename: (id: NodeId, name: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onToggleVisibility: (id: NodeId) => void;
  onToggleLock: (id: NodeId) => void;
  onFocus: (idx: number) => void;
  onAddAdjustment: (id: NodeId) => void;
  idx: number;
  style?: React.CSSProperties;
}

export const AdjustmentLayerRow = memo(function AdjustmentLayerRow({
  node,
  depth,
  selected,
  focused,
  editing,
  onSelect,
  onRename,
  onRenameCommit,
  onRenameCancel,
  onToggleVisibility,
  onToggleLock,
  onFocus,
  onAddAdjustment,
  idx,
  style,
}: AdjustmentLayerRowProps) {
  const [editValue, setEditValue] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const enabledCount = adjustmentEnabledCount(node.adjustments ?? []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onSelect(node.id, e.shiftKey, e.ctrlKey || e.metaKey);
      onFocus(idx);
    },
    [node.id, idx, onSelect, onFocus],
  );

  const handleDoubleClick = useCallback(() => {
    onRename(node.id, node.name);
  }, [node.id, node.name, onRename]);

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

  const adjustmentNames = (node.adjustments ?? [])
    .filter((a) => a.visible)
    .slice(0, 2)
    .map((a) => filterKindDisplayName(a.kind));

  return (
    <div
      role="treeitem"
      data-node-id={node.id}
      data-layer-type="adjustment"
      aria-selected={selected}
      className={rowClass}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect(node.id, e.shiftKey, e.ctrlKey || e.metaKey);
          onFocus(idx);
        }
      }}
      style={{
        paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-3))`,
        ...style,
      }}
    >
      <span className="layers-row__disclosure-spacer" />

      <Icon name="SlidersHorizontal" size="0.85em" aria-hidden className="adj-layer-row__icon" />

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
        <span className="layers-row__name" title={node.name}>
          {node.name}
        </span>
      )}

      <span
        className="adj-layer-row__badge"
        title={`${enabledCount} adjustment${enabledCount === 1 ? '' : 's'}`}
      >
        {enabledCount}
      </span>

      {adjustmentNames.length > 0 && (
        <span
          className="layers-row__name"
          style={{
            fontSize: '10px',
            opacity: 0.6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 80,
          }}
        >
          {adjustmentNames.join(', ')}
        </span>
      )}

      <button
        type="button"
        className="adj-layer-row__add"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onAddAdjustment(node.id);
        }}
        aria-label={`Add adjustment to ${node.name}`}
      >
        <Icon name={CHROME_ICONS.plus} size="0.75em" />
      </button>

      <button
        type="button"
        className={`layers-row__toggle ${
          node.visible ? 'layers-row__toggle--visibility-on' : 'layers-row__toggle--visibility-off'
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
  );
});
