/**
 * ShapeQuickControls — compact fill / stroke / stroke-width editing for the
 * contextual control bar.
 *
 * The bar's shape context previously offered only Flip H and Flip V, while its
 * own docstring promised "Fill swatch, Stroke swatch, Stroke width". Fill and
 * stroke are the first things a designer reaches for after drawing a shape, so
 * sending them to the Inspector for every colour tweak made the contextual bar
 * a dead end.
 *
 * Scope discipline: this is a *convenience* surface over the same commands the
 * Inspector uses (`setSelectedFill`, `updateNode` inside a transaction). It
 * edits the first solid fill and first stroke only; gradients, layered fills,
 * alignment/caps/joins, and per-side weights stay in the Inspector, and the
 * controls stay enabled so the user can open the popover and see the real
 * value.
 */
import type { ManagedColor, NodeId, SceneNode, ShapeNode, Stroke } from '@varve/scene';
import { createStrokeId, defaultStroke } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { InspectorColorPopover } from '../Inspector/controls/InspectorColorPopover';

export interface ShapeQuickControlsProps {
  node: SceneNode;
  setSelectedFlipH: () => void;
  setSelectedFlipV: () => void;
}

/** Transparent checker placeholder when a shape has no stroke. */
const NO_STROKE_STYLE = {
  background:
    'repeating-linear-gradient(45deg, var(--color-border-subtle) 0 3px, transparent 3px 6px)',
  border: '1px dashed var(--color-border-strong)',
} as const;

function toSwatchBackground(color: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
}

function firstSolidFill(node: SceneNode): ManagedColor | null {
  const fills = (node as ShapeNode).fills;
  const first = fills?.[0];
  if (first && first.type === 'solid' && first.color) return first.color;
  if (fills && fills.length > 0) return null;
  return node.fill ?? null;
}

function strokesOf(node: SceneNode): Stroke[] {
  const strokes = (node as ShapeNode).strokes;
  return Array.isArray(strokes) ? strokes : [];
}

export function ShapeQuickControls({
  node,
  setSelectedFlipH,
  setSelectedFlipV,
}: ShapeQuickControlsProps) {
  const {
    setSelectedFill,
    updateNode,
    beginTransaction,
    commitTransaction,
    announce,
    documentColorMode,
  } = useEditor();

  const fillColor = useMemo(() => firstSolidFill(node), [node]);
  const strokes = useMemo(() => strokesOf(node), [node]);
  const stroke = strokes[0];
  const strokeColor = stroke && !stroke.gradient ? stroke.color : null;
  const strokeWeight = stroke ? stroke.weight : null;

  const [weightDraft, setWeightDraft] = useState(strokeWeight === null ? '' : String(strokeWeight));
  useEffect(() => {
    setWeightDraft(strokeWeight === null ? '' : String(strokeWeight));
  }, [strokeWeight]);

  const patchStroke = useCallback(
    (updater: (stroke: Stroke) => Stroke) => {
      beginTransaction();
      updateNode(node.id as NodeId, (n) => {
        const current = strokesOf(n);
        if (current.length === 0) return n;
        const next = [...current];
        next[0] = updater(next[0] as Stroke);
        return { ...n, strokes: next } as SceneNode;
      });
      commitTransaction();
    },
    [beginTransaction, commitTransaction, node.id, updateNode],
  );

  const addStroke = useCallback(() => {
    beginTransaction();
    updateNode(node.id as NodeId, (n) => {
      const current = strokesOf(n);
      if (current.length > 0) return n;
      return { ...n, strokes: [{ ...defaultStroke(), id: createStrokeId() }] } as SceneNode;
    });
    commitTransaction();
    announce('Stroke added');
  }, [announce, beginTransaction, commitTransaction, node.id, updateNode]);

  const commitWeight = useCallback(() => {
    const next = Number(weightDraft);
    if (!Number.isFinite(next) || next < 0 || next > 1000) {
      setWeightDraft(strokeWeight === null ? '' : String(strokeWeight));
      return;
    }
    if (next === strokeWeight) {
      setWeightDraft(String(next));
      return;
    }
    patchStroke((s) => ({ ...s, weight: next }));
    setWeightDraft(String(next));
  }, [patchStroke, strokeWeight, weightDraft]);

  const fillStyle = fillColor
    ? { background: toSwatchBackground(fillColor), border: '1px solid var(--color-border-strong)' }
    : NO_STROKE_STYLE;
  const strokeStyle = strokeColor
    ? {
        background: toSwatchBackground(strokeColor),
        border: '1px solid var(--color-border-strong)',
      }
    : NO_STROKE_STYLE;

  return (
    <>
      <span className="ccb__label">Shape</span>
      <Divider />

      <span className="ccb__swatch-control">
        <span className="ccb__swatch-label">Fill</span>
        <Tooltip label={fillColor ? 'Fill colour' : 'Set fill colour'}>
          <InspectorColorPopover
            label="Fill colour"
            value={fillColor ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }}
            onChange={(color) => setSelectedFill(color)}
            swatchStyle={fillStyle}
            className="ccb__swatch"
            documentColorMode={documentColorMode}
            onEditStart={beginTransaction}
            onEditEnd={commitTransaction}
          />
        </Tooltip>
      </span>

      {stroke ? (
        <>
          <span className="ccb__swatch-control">
            <span className="ccb__swatch-label">Stroke</span>
            <Tooltip
              label={stroke.gradient ? 'Stroke gradient colour' : 'Stroke colour'}
              disabledReason={
                stroke.gradient ? 'Stroke uses a gradient — edit it in the Inspector' : undefined
              }
            >
              <InspectorColorPopover
                label="Stroke colour"
                value={strokeColor ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }}
                onChange={(color) => patchStroke((s) => ({ ...s, color, gradient: undefined }))}
                swatchStyle={strokeStyle}
                className="ccb__swatch"
                tooltipDisabledReason={
                  stroke.gradient ? 'Stroke uses a gradient — edit it in the Inspector' : undefined
                }
                documentColorMode={documentColorMode}
                onEditStart={beginTransaction}
                onEditEnd={commitTransaction}
              />
            </Tooltip>
          </span>
          <label className="ccb__size-control ccb__stroke-weight">
            <span className="ccb__field-label">W</span>
            <input
              type="number"
              className="ccb__size-input"
              aria-label="Stroke width"
              min={0}
              max={1000}
              step={0.5}
              value={weightDraft}
              onChange={(event) => setWeightDraft(event.target.value)}
              onBlur={commitWeight}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape' && weightDraft !== String(strokeWeight ?? '')) {
                  event.preventDefault();
                  event.stopPropagation();
                  setWeightDraft(strokeWeight === null ? '' : String(strokeWeight));
                }
              }}
            />
          </label>
        </>
      ) : (
        <Tooltip label="Add stroke">
          <button
            type="button"
            className="ccb__btn ccb__btn--no-stroke"
            aria-label="Add stroke"
            onClick={addStroke}
          >
            <Icon name="Plus" size={16} />
          </button>
        </Tooltip>
      )}

      <Divider />
      <Tooltip label="Flip horizontal">
        <button
          type="button"
          className="ccb__btn"
          aria-label="Flip horizontal"
          onClick={setSelectedFlipH}
        >
          <Icon name="FlipHorizontal2" size={14} />
        </button>
      </Tooltip>
      <Tooltip label="Flip vertical">
        <button
          type="button"
          className="ccb__btn"
          aria-label="Flip vertical"
          onClick={setSelectedFlipV}
        >
          <Icon name="FlipVertical2" size={14} />
        </button>
      </Tooltip>
    </>
  );
}

/** Local divider so this module can render inside the contextual bar without
 *  importing the bar's private component. */
function Divider() {
  return <span aria-hidden className="ccb__divider" />;
}
