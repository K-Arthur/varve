import {
  ADJUSTMENT_KINDS,
  type AdjustmentBlendMode,
  autoWhiteBalanceParams,
  type BlendMode,
  filterKindDisplayName,
} from '@varve/engine';
import type { Adjustment, AdjustmentKind, AdjustmentNode, SceneNode } from '@varve/scene';
import { makeAdjustment } from '@varve/scene';
import { Select, SOLID_CHROME_ICONS, SolidIcon } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { NumberField } from '../Inspector/controls/NumberField';
import { AdjustmentScopeSection } from '../Inspector/sections/AdjustmentScopeSection';
import { AdjustmentEditor } from './AdjustmentEditor';
import { useAdjustmentHistogram } from './useAdjustmentHistogram';
import './adjustment.css';

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

/**
 * AdjustmentPanel — flat layout for adjustment layer controls.
 *
 * Architecture decision (2026-07-20): intentionally NOT a DisclosureSection.
 * The panel is compact, scrollable, and the filter stack is inherently linear.
 * There are no subsections to collapse. The entire panel is controlled at the
 * tab level (it renders within SingleSelectionPanel before all section entries).
 *
 * Do NOT convert to DisclosureSection unless the control count exceeds ~30
 * or the scroll length exceeds 3 viewports.
 */
export function AdjustmentPanel() {
  const {
    state,
    updateNode,
    beginTransaction,
    commitTransaction,
    reorderAdjustmentInLayer,
    setSelectedOpacity,
    setSelectedBlendMode,
  } = useEditor();
  const selId = state.selection.length === 1 ? state.selection[0] : undefined;
  const selNode = selId ? state.document.nodes[selId] : undefined;
  const isAdjustmentNode = selNode?.kind === 'adjustment';
  // nodeId is only meaningful when isAdjustmentNode is true; the callbacks
  // below are unreachable otherwise since the component returns null before
  // any of them can be invoked. Hooks themselves must still run on every
  // render regardless (Rules of Hooks), so they cannot sit behind the
  // `if (!isAdjustmentNode) return null` early return.
  const nodeId = isAdjustmentNode ? selNode.id : undefined;
  // Derive the adjustment node for the histogram hook (must be before early return).
  const adjNodeRef = isAdjustmentNode ? (selNode as AdjustmentNode) : undefined;

  // Source histogram for the adjustment layer's scope targets.
  // The histogram shows the INPUT pixels (before this adjustment is applied).
  const { histogram: sourceHistogram } = useAdjustmentHistogram(state.document, adjNodeRef);

  const [selectedAdjId, setSelectedAdjId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const editTransactionRef = useRef(false);

  const startEditTransaction = useCallback(() => {
    if (editTransactionRef.current) return;
    editTransactionRef.current = true;
    beginTransaction();
  }, [beginTransaction]);

  const finishEditTransaction = useCallback(() => {
    if (!editTransactionRef.current) return;
    editTransactionRef.current = false;
    commitTransaction();
  }, [commitTransaction]);

  useEffect(
    () => () => {
      if (editTransactionRef.current) {
        editTransactionRef.current = false;
        commitTransaction();
      }
    },
    [commitTransaction],
  );

  useEffect(() => {
    if (!isAdjustmentNode || !selectedAdjId) return;
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [isAdjustmentNode, selectedAdjId]);

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
      addBtnRef.current?.focus();
    },
    [nodeId, updateNode],
  );

  const handleAutoWhiteBalance = useCallback(() => {
    if (!nodeId || !sourceHistogram) return;
    const correction = autoWhiteBalanceParams(sourceHistogram);
    const id = localAdjId();
    const auto = makeAdjustment(id, 'colorBalance', {
      shadows: correction,
      midtones: correction,
      highlights: correction,
      preserveLuminosity: true,
    } as Partial<Adjustment>);
    updateNode(nodeId, (n) => {
      if (n.kind !== 'adjustment') return n;
      return { ...n, adjustments: [...(n.adjustments ?? []), auto] } as SceneNode;
    });
    setSelectedAdjId(id);
  }, [nodeId, sourceHistogram, updateNode]);

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

  const handleResetAdjustment = useCallback(
    (adjId: string, kind: AdjustmentKind) => {
      if (!nodeId) return;
      updateNode(nodeId, (n) => {
        if (n.kind !== 'adjustment') return n;
        return {
          ...n,
          adjustments: (n.adjustments ?? []).map((adjustment) =>
            adjustment.id === adjId ? makeAdjustment(adjId, kind) : adjustment,
          ),
        };
      });
    },
    [nodeId, updateNode],
  );

  const handleDuplicateAdjustment = useCallback(
    (adjId: string) => {
      if (!nodeId) return;
      const duplicateId = localAdjId();
      updateNode(nodeId, (n) => {
        if (n.kind !== 'adjustment') return n;
        const adjustments = n.adjustments ?? [];
        const sourceIndex = adjustments.findIndex((adjustment) => adjustment.id === adjId);
        if (sourceIndex < 0) return n;
        const duplicate = { ...adjustments[sourceIndex]!, id: duplicateId };
        const next = [...adjustments];
        next.splice(sourceIndex + 1, 0, duplicate);
        return { ...n, adjustments: next };
      });
      setSelectedAdjId(duplicateId);
    },
    [nodeId, updateNode],
  );

  const closeAddMenu = useCallback(() => {
    setShowAddMenu(false);
    addBtnRef.current?.focus();
  }, []);

  if (!isAdjustmentNode) return null;

  const adjNode = selNode as AdjustmentNode;
  const { opacity, blendMode } = adjNode;
  const adjustments = adjNode.adjustments ?? [];
  const selectedAdj = adjustments.find((a) => a.id === selectedAdjId) ?? null;

  return (
    <div className="insp-panel">
      <header className="adj-panel__header">
        <SolidIcon name="Faders" size="1em" aria-hidden className="adj-panel__header-icon" />
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
            <Select
              label="Blend mode"
              value={blendMode}
              options={ADJUSTMENT_BLEND_OPTIONS}
              onChange={(v) => setSelectedBlendMode(v as BlendMode)}
            />
          </div>
        </div>
      </div>

      <AdjustmentScopeSection
        nodeId={nodeId!}
        doc={state.document}
        scope={adjNode.scope}
        onChangeScope={(s) => {
          updateNode(nodeId!, (n) => {
            if (n.kind !== 'adjustment') return n;
            return { ...n, scope: s } as SceneNode;
          });
        }}
      />

      <div className="adj-panel__stack">
        <div className="adj-panel__stack-header">
          <span className="adj-panel__stack-title">Filter Stack</span>
          <button
            type="button"
            className="adj-panel__auto-btn"
            onClick={handleAutoWhiteBalance}
            disabled={!sourceHistogram}
            aria-label="Auto White Balance"
          >
            Auto WB
          </button>
        </div>

        {adjustments.map((adj, index) => (
          <div
            key={adj.id}
            className={`adj-panel__item${selectedAdjId === adj.id ? ' adj-panel__item--selected' : ''}`}
          >
            <span className="adj-panel__item-reorder">
              <button
                type="button"
                className="adj-panel__item-reorder-btn"
                disabled={index === 0}
                onClick={() => reorderAdjustmentInLayer(nodeId!, adj.id, index - 1)}
                aria-label={`Move ${filterKindDisplayName(adj.kind)} up`}
              >
                <SolidIcon name={SOLID_CHROME_ICONS.chevronUp} size="0.65em" />
              </button>
              <button
                type="button"
                className="adj-panel__item-reorder-btn"
                disabled={index === adjustments.length - 1}
                onClick={() => reorderAdjustmentInLayer(nodeId!, adj.id, index + 1)}
                aria-label={`Move ${filterKindDisplayName(adj.kind)} down`}
              >
                <SolidIcon name={SOLID_CHROME_ICONS.chevronDown} size="0.65em" />
              </button>
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
                <SolidIcon
                  name={
                    adj.visible ? SOLID_CHROME_ICONS.visibility : SOLID_CHROME_ICONS.visibilityOff
                  }
                  size="0.75em"
                />
              </button>
            </span>

            <button
              type="button"
              className="adj-panel__item-select"
              aria-expanded={selectedAdjId === adj.id}
              onClick={() => setSelectedAdjId(adj.id === selectedAdjId ? null : adj.id)}
            >
              <span className="adj-panel__item-name">{filterKindDisplayName(adj.kind)}</span>
              {adj.opacity < 1 && (
                <span className="adj-panel__item-opacity">{Math.round(adj.opacity * 100)}%</span>
              )}
            </button>

            <button
              type="button"
              className="adj-panel__item-remove"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveAdjustment(adj.id);
              }}
              aria-label={`Remove ${adj.kind}`}
            >
              <SolidIcon name={SOLID_CHROME_ICONS.close} size="0.7em" />
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
            <SolidIcon name={SOLID_CHROME_ICONS.plus} size="0.75em" />
            Add adjustment
          </button>

          {showAddMenu && (
            <AddAdjustmentMenu onSelect={handleAddAdjustment} onClose={closeAddMenu} />
          )}
        </div>
      </div>

      {selectedAdj && (
        <div
          ref={editorRef}
          className="adj-panel__editor"
          onPointerDownCapture={(event) => {
            if ((event.target as Element).matches('input[type="range"]')) {
              startEditTransaction();
            }
          }}
          onPointerUpCapture={finishEditTransaction}
          onPointerCancelCapture={finishEditTransaction}
          onKeyDownCapture={(event) => {
            if ((event.target as Element).matches('input[type="range"]')) {
              startEditTransaction();
            }
          }}
          onKeyUpCapture={finishEditTransaction}
        >
          <div className="adj-panel__editor-header">
            <span className="adj-panel__editor-title">
              {filterKindDisplayName(selectedAdj.kind)}
            </span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {Math.round(selectedAdj.opacity * 100)}%
            </span>
          </div>
          <AdjustmentEditor
            adjustment={selectedAdj}
            onChange={handleUpdateAdjustment(selectedAdj.id)}
            onEditStart={startEditTransaction}
            onEditEnd={finishEditTransaction}
            doc={state.document}
            sourceHistogram={sourceHistogram}
          />
          <div className="adj-panel__effect-controls">
            <label className="adj-editor__slider-row">
              <span className="adj-editor__slider-label">
                <span>Effect Opacity</span>
                <span>{Math.round(selectedAdj.opacity * 100)}%</span>
              </span>
              <input
                type="range"
                className="adj-editor__slider"
                min={0}
                max={100}
                step={1}
                value={Math.round(selectedAdj.opacity * 100)}
                onChange={(event) =>
                  handleUpdateAdjustment(selectedAdj.id)({
                    opacity: Number(event.target.value) / 100,
                  })
                }
                aria-label={`${filterKindDisplayName(selectedAdj.kind)} effect opacity`}
              />
            </label>
            <div className="adj-editor__row">
              <span className="adj-editor__label">Effect Blend</span>
              <Select
                label={`${filterKindDisplayName(selectedAdj.kind)} effect blend mode`}
                value={selectedAdj.blendMode}
                options={ADJUSTMENT_BLEND_OPTIONS}
                onChange={(value) =>
                  handleUpdateAdjustment(selectedAdj.id)({
                    blendMode: value as AdjustmentBlendMode,
                  })
                }
              />
            </div>
            <div className="adj-panel__effect-actions">
              <button
                type="button"
                className="adj-panel__effect-action"
                onClick={() => handleResetAdjustment(selectedAdj.id, selectedAdj.kind)}
              >
                Reset
              </button>
              <button
                type="button"
                className="adj-panel__effect-action"
                onClick={() => handleDuplicateAdjustment(selectedAdj.id)}
              >
                Duplicate
              </button>
            </div>
          </div>
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

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

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
