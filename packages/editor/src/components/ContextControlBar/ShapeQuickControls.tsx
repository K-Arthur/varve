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
 * edits the primary solid fill and first stroke; shared or non-solid fills and
 * gradient strokes direct users to the Inspector. Other fill-stack and stroke
 * settings (alignment, caps/joins, per-side weights) remain in the Inspector.
 */
import type {
  Document,
  Fill,
  ManagedColor,
  NodeId,
  SceneNode,
  ShapeNode,
  Stroke,
} from '@varve/scene';
import { createStrokeId, defaultStroke, resolveNodePaints } from '@varve/scene';
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

function fillsOf(node: SceneNode, document: Document): Fill[] {
  return resolveNodePaints(node as unknown as Parameters<typeof resolveNodePaints>[0], document);
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
    state,
    setSelectedFill,
    updateSelectedFillAt,
    groupCompoundOperation,
    updateNode,
    beginTransaction,
    commitTransaction,
    announce,
    documentColorMode,
  } = useEditor();

  const fills = useMemo(() => fillsOf(node, state.document), [node, state.document]);
  const primaryFill = fills[0];
  const fillColor = primaryFill?.type === 'solid' ? (primaryFill.color ?? null) : null;
  const sharedPaint = Boolean(node.paintRefs?.length);
  const fillDisabledReason = sharedPaint
    ? 'This object uses a shared paint. Detach it in the Inspector before editing its fill.'
    : primaryFill && primaryFill.type !== 'solid'
      ? `The primary fill is ${primaryFill.type}; edit it in the Inspector.`
      : undefined;
  const strokes = useMemo(() => strokesOf(node), [node]);
  const stroke = strokes[0];
  const strokeColor = stroke && !stroke.gradient ? stroke.color : null;
  const strokeSwatchColor = stroke?.gradient?.stops[0]?.color ?? strokeColor;
  const strokeDisabledReason = stroke?.gradient
    ? 'This stroke uses a gradient; edit it in the Inspector.'
    : undefined;
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

  const changeFillColor = useCallback(
    (color: ManagedColor) => {
      if (sharedPaint || !primaryFill || primaryFill.type !== 'solid') return;
      if (node.fills && node.fills.length > 0) {
        // `setSelectedFill` only writes the legacy `fill` field. Inline fill
        // stacks take precedence over it, so update the visible first row
        // through the same stack-aware command used by the Inspector.
        groupCompoundOperation('Change fill color', () =>
          updateSelectedFillAt(0, { ...primaryFill, color }),
        );
        return;
      }
      setSelectedFill(color);
    },
    [
      groupCompoundOperation,
      node.fills,
      primaryFill,
      setSelectedFill,
      sharedPaint,
      updateSelectedFillAt,
    ],
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
  const strokeStyle = strokeSwatchColor
    ? {
        background: toSwatchBackground(strokeSwatchColor),
        border: '1px solid var(--color-border-strong)',
      }
    : NO_STROKE_STYLE;

  return (
    <>
      <span className="ccb__label">Shape</span>
      <Divider />

      <span className="ccb__swatch-control">
        <span className="ccb__swatch-label">Fill</span>
        <Tooltip
          label={fillColor ? 'Fill colour' : 'Set fill colour'}
          disabledReason={fillDisabledReason}
        >
          <InspectorColorPopover
            label="Fill colour"
            value={fillColor ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }}
            onChange={changeFillColor}
            swatchStyle={fillStyle}
            className="ccb__swatch"
            disabled={Boolean(fillDisabledReason)}
            tooltipDisabledReason={fillDisabledReason}
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
              disabledReason={strokeDisabledReason}
            >
              <InspectorColorPopover
                label="Stroke colour"
                value={strokeColor ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }}
                onChange={(color) => patchStroke((s) => ({ ...s, color, gradient: undefined }))}
                swatchStyle={strokeStyle}
                className="ccb__swatch"
                disabled={Boolean(strokeDisabledReason)}
                tooltipDisabledReason={strokeDisabledReason}
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
