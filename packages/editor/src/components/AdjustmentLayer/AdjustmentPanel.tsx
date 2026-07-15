import type { AdjustmentBlendMode, BlendMode } from '@strata/engine';
import { filterKindDisplayName } from '@strata/engine';
import type { Adjustment, AdjustmentKind, AdjustmentNode, SceneNode } from '@strata/scene';
import { makeAdjustment } from '@strata/scene';
import { CHROME_ICONS, Icon } from '@strata/ui';
import { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { NumberField } from '../Inspector/controls/NumberField';
import { AdjustmentEditor } from './AdjustmentEditor';
import './adjustment.css';

const ADJUSTMENT_KINDS: AdjustmentKind[] = [
  'brightness',
  'contrast',
  'levels',
  'curves',
  'exposure',
  'saturation',
  'hueRotate',
  'colorBalance',
  'selectiveColor',
  'channelMixer',
  'temperature',
  'tint',
  'vibrance',
  'sepia',
  'grayscale',
  'invert',
  'opacity',
  'blur',
  'sharpen',
  'photoFilter',
  'halftone',
  'gradientMap',
  'tritone',
];

const ADJUSTMENT_BLEND_OPTIONS: { value: AdjustmentBlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'softLight', label: 'Soft Light' },
  { value: 'hardLight', label: 'Hard Light' },
  { value: 'colorDodge', label: 'Color Dodge' },
  { value: 'colorBurn', label: 'Color Burn' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
  { value: 'passThrough', label: 'Pass Through' },
];

let _localAdjCounter = 0;
function localAdjId(): string {
  _localAdjCounter++;
  return `adj-${Date.now()}-${_localAdjCounter}`;
}

export function AdjustmentPanel() {
  const { state, updateNode, setSelectedOpacity, setSelectedBlendMode } = useEditor();
  const selId = state.selection.length === 1 ? state.selection[0] : undefined;
  const selNode = selId ? state.document.nodes[selId] : undefined;
  const isAdjustmentNode = selNode?.kind === 'adjustment';
  // nodeId is only meaningful when isAdjustmentNode is true; the callbacks
  // below are unreachable otherwise since the component returns null before
  // any of them can be invoked. Hooks themselves must still run on every
  // render regardless (Rules of Hooks), so they cannot sit behind the
  // `if (!isAdjustmentNode) return null` early return.
  const nodeId = isAdjustmentNode ? selNode.id : undefined;

  const [selectedAdjId, setSelectedAdjId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const handleAddAdjustment = useCallback(
    (kind: AdjustmentKind) => {
      if (!nodeId) return;
      const newId = localAdjId();
      const adj = makeAdjustment(newId, kind);
      updateNode(nodeId, (n) => {
        const an = n as AdjustmentNode;
        return { ...an, adjustments: [...(an.adjustments ?? []), adj] } as SceneNode;
      });
      setSelectedAdjId(newId);
      setShowAddMenu(false);
    },
    [nodeId, updateNode],
  );

  const handleRemoveAdjustment = useCallback(
    (adjId: string) => {
      if (!nodeId) return;
      updateNode(nodeId, (n) => {
        const an = n as AdjustmentNode;
        return {
          ...an,
          adjustments: (an.adjustments ?? []).filter((a) => a.id !== adjId),
        } as SceneNode;
      });
      setSelectedAdjId((cur) => (cur === adjId ? null : cur));
    },
    [nodeId, updateNode],
  );

  const handleUpdateAdjustment = useCallback(
    (adjId: string) => (patch: Partial<Adjustment>) => {
      if (!nodeId) return;
      updateNode(nodeId, (n) => {
        const an = n as AdjustmentNode;
        return {
          ...an,
          adjustments: (an.adjustments ?? []).map((a) =>
            a.id === adjId ? ({ ...a, ...patch } as Adjustment) : a,
          ),
        } as SceneNode;
      });
    },
    [nodeId, updateNode],
  );

  const handleToggleVis = useCallback(
    (adjId: string, current: boolean) => {
      handleUpdateAdjustment(adjId)({ visible: !current } as Partial<Adjustment>);
    },
    [handleUpdateAdjustment],
  );

  if (!isAdjustmentNode) return null;

  const adjNode = selNode as AdjustmentNode;
  const { opacity, blendMode } = adjNode;
  const adjustments = adjNode.adjustments ?? [];
  const selectedAdj = adjustments.find((a) => a.id === selectedAdjId) ?? null;

  return (
    <div className="insp-panel">
      <header className="adj-panel__header">
        <Icon name="SlidersHorizontal" size="1em" aria-hidden className="adj-panel__header-icon" />
        <span className="adj-panel__header-name">Adjustment Layer</span>
      </header>

      <div className="adj-panel__opacity">
        <NumberField
          label="Opacity"
          value={opacity}
          onChange={setSelectedOpacity}
          step={0.01}
          min={0}
          max={1}
        />
      </div>

      <div className="adj-panel__blend">
        <div className="insp-field">
          <span className="insp-field__label">Blend</span>
          <div className="insp-field__control">
            <select
              className="insp-select"
              value={blendMode}
              onChange={(e) => setSelectedBlendMode(e.target.value as BlendMode)}
              aria-label="Blend mode"
            >
              {ADJUSTMENT_BLEND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="adj-panel__stack">
        <div className="adj-panel__stack-header">
          <span className="adj-panel__stack-title">Filter Stack</span>
        </div>

        {adjustments.map((adj) => (
          <div
            key={adj.id}
            className={`adj-panel__item${selectedAdjId === adj.id ? ' adj-panel__item--selected' : ''}`}
            onClick={() => setSelectedAdjId(adj.id === selectedAdjId ? null : adj.id)}
          >
            <span className="adj-panel__item-drag" aria-label="Drag to reorder">
              <Icon name={CHROME_ICONS.gripVertical} size="0.7em" />
            </span>

            <span className="adj-panel__item-vis">
              <button
                type="button"
                className="adj-panel__item-vis-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleVis(adj.id, adj.visible);
                }}
                aria-label={adj.visible ? `Disable ${adj.kind}` : `Enable ${adj.kind}`}
              >
                <Icon name={adj.visible ? 'Eye' : 'EyeOff'} size="0.75em" />
              </button>
            </span>

            <span className="adj-panel__item-name">{filterKindDisplayName(adj.kind)}</span>

            {adj.opacity < 1 && (
              <span className="adj-panel__item-opacity">{Math.round(adj.opacity * 100)}%</span>
            )}

            <button
              type="button"
              className="adj-panel__item-remove"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveAdjustment(adj.id);
              }}
              aria-label={`Remove ${adj.kind}`}
            >
              <Icon name={CHROME_ICONS.close} size="0.7em" />
            </button>
          </div>
        ))}

        <div style={{ position: 'relative' }}>
          <button
            ref={addBtnRef}
            type="button"
            className="adj-panel__add-btn"
            onClick={() => setShowAddMenu(!showAddMenu)}
            aria-haspopup="menu"
            aria-expanded={showAddMenu}
          >
            <Icon name={CHROME_ICONS.plus} size="0.75em" />
            Add adjustment
          </button>

          {showAddMenu && (
            <AddAdjustmentMenu
              onSelect={handleAddAdjustment}
              onClose={() => setShowAddMenu(false)}
            />
          )}
        </div>
      </div>

      {selectedAdj && (
        <div className="adj-panel__editor">
          <div className="adj-panel__editor-header">
            <span className="adj-panel__editor-title">
              {filterKindDisplayName(selectedAdj.kind)}
            </span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
              {Math.round(selectedAdj.opacity * 100)}%
            </span>
          </div>
          <AdjustmentEditor
            adjustment={selectedAdj}
            onChange={handleUpdateAdjustment(selectedAdj.id)}
          />
        </div>
      )}
    </div>
  );
}

function AddAdjustmentMenu({
  onSelect,
  onClose,
}: {
  onSelect: (kind: AdjustmentKind) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (!items || items.length === 0) return;

      const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLElement);

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          items[(currentIndex + 1) % items.length]?.focus();
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          items[(currentIndex - 1 + items.length) % items.length]?.focus();
          break;
        case 'Home':
          e.preventDefault();
          items[0]?.focus();
          break;
        case 'End':
          e.preventDefault();
          items[items.length - 1]?.focus();
          break;
      }
    },
    [onClose],
  );

  return (
    <div
      ref={menuRef}
      className="adj-panel__add-menu"
      role="menu"
      aria-label="Add adjustment"
      onKeyDown={handleKeyDown}
      onFocus={() => {
        const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
        first?.focus();
      }}
    >
      {ADJUSTMENT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="adj-panel__add-menu-item"
          role="menuitem"
          tabIndex={-1}
          onClick={() => onSelect(kind)}
        >
          {filterKindDisplayName(kind)}
        </button>
      ))}
    </div>
  );
}
