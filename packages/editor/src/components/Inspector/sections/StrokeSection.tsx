/**
 * StrokeSection — stacked stroke controls for the Inspector.
 *
 * Multi-select: shows common strokes by index, "Mixed" for differing
 * properties. Property edits batch across all selected nodes in one
 * undo step via the transaction API.
 *
 * Research basis: Figma / Sketch stroke panel, APG Disclosure pattern.
 */

import type {
  ArrowheadStyle,
  FrameNode,
  GradientFill,
  ManagedColor,
  SceneNode,
  ShapeNode,
  Stroke,
  StrokeAlign,
  StrokeCap,
  StrokeJoin,
  TextNode,
} from '@varve/scene';
import { defaultStroke } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { Icon, Select } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { GradientEditor } from '../color/GradientEditor';
import {
  resolvedGradientHueInterpolation,
  resolvedGradientInterpolationSpace,
} from '../color/gradientUiState';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { NumberField } from '../controls/NumberField';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { SegmentedControl } from '../controls/SegmentedControl';
import { commonValue, isMixed } from '../selection/selectionState';

export interface StrokeSectionProps {
  nodes: SceneNode[];
}

type StrokeNode = ShapeNode | TextNode | FrameNode;

const ALIGN_OPTIONS: readonly SegmentedOption<StrokeAlign>[] = [
  { value: 'inside', label: 'In' },
  { value: 'center', label: 'Ct' },
  { value: 'outside', label: 'Out' },
] as const;

const CAP_OPTIONS: readonly SegmentedOption<StrokeCap>[] = [
  { value: 'butt', label: 'Butt' },
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Sq' },
] as const;

const JOIN_OPTIONS: readonly SegmentedOption<StrokeJoin>[] = [
  { value: 'miter', label: 'Miter' },
  { value: 'round', label: 'Round' },
  { value: 'bevel', label: 'Bevel' },
] as const;

const ARROW_OPTIONS: { value: ArrowheadStyle; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'diamond', label: 'Diamond' },
];

function hasStrokes(n: SceneNode): n is StrokeNode {
  return n.kind === 'shape' || n.kind === 'text' || n.kind === 'frame';
}

/** True if any selected node is a line, arrow, or open path (supports arrowheads). */
function isLineOrPath(n: SceneNode): boolean {
  if (n.kind !== 'shape') return false;
  const s = n.shape;
  return s.kind === 'line' || s.kind === 'arrow' || s.kind === 'path';
}

/** True if any selected node is a rect or frame (supports per-side weights). */
function isRectLike(n: SceneNode): boolean {
  if (n.kind === 'frame') return true;
  if (n.kind === 'shape') return n.shape.kind === 'rect';
  return false;
}

function getStroke(n: SceneNode, i: number): Stroke | undefined {
  const sn = n as StrokeNode;
  return sn.strokes?.[i];
}

function toSwatchBg(color: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

export function StrokeSection({ nodes }: StrokeSectionProps) {
  const { updateNode, beginTransaction, commitTransaction, announce } = useEditor();
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const strokeNodes = useMemo(() => nodes.filter(hasStrokes), [nodes]);

  const toggleRow = useCallback((i: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const batchUpdate = useCallback(
    (updater: (strokes: Stroke[]) => Stroke[]) => {
      beginTransaction();
      for (const node of strokeNodes) {
        updateNode(node.id, (n) => {
          const sn = n as StrokeNode;
          if (!sn.strokes) return n;
          return { ...n, strokes: updater(sn.strokes) };
        });
      }
      commitTransaction();
    },
    [strokeNodes, updateNode, beginTransaction, commitTransaction],
  );

  const updateStroke = useCallback(
    (index: number, updater: (s: Stroke) => Stroke) => {
      batchUpdate((strokes) => {
        const next = [...strokes];
        if (next[index]) {
          next[index] = updater(next[index] as Stroke);
        }
        return next;
      });
    },
    [batchUpdate],
  );

  const addStroke = useCallback(() => {
    batchUpdate((strokes) => [...strokes, defaultStroke()]);
    announce('Stroke added');
  }, [batchUpdate, announce]);

  const removeStroke = useCallback(
    (index: number) => {
      batchUpdate((strokes) => strokes.filter((_, i) => i !== index));
      announce('Stroke removed');
    },
    [batchUpdate, announce],
  );

  const reorderStroke = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      batchUpdate((strokes) => {
        if (from < 0 || from >= strokes.length || to < 0 || to >= strokes.length) return strokes;
        const next = [...strokes];
        const [item] = next.splice(from, 1);
        if (item) next.splice(to, 0, item);
        return next;
      });
    },
    [batchUpdate],
  );

  if (strokeNodes.length === 0) return null;

  const minStrokes = Math.min(...strokeNodes.map((n) => n.strokes.length));
  const allEqual = strokeNodes.every((n) => n.strokes.length === minStrokes);
  const countMixed = !allEqual;

  return (
    <DisclosureSection title="Stroke" sectionId="stroke">
      {strokeNodes.every((n) => n.strokes.length === 0) ? (
        <div className="insp-empty-message">No stroke</div>
      ) : (
        Array.from({ length: minStrokes }, (_, i) => (
          <StrokeRow
            // biome-ignore lint/suspicious/noArrayIndexKey: stroke rows have no stable id in the document model; index identifies the slot
            key={i}
            index={i}
            nodes={strokeNodes}
            expanded={expandedRows.has(i)}
            onToggle={() => toggleRow(i)}
            onChange={(updater) => updateStroke(i, updater)}
            onRemove={() => removeStroke(i)}
            onReorder={(dir) => reorderStroke(i, i + dir)}
            canMoveUp={i > 0}
            canMoveDown={i < minStrokes - 1}
          />
        ))
      )}
      {countMixed && minStrokes > 0 && (
        <div className="insp-empty-message">Some selected nodes have additional strokes</div>
      )}
      <button type="button" className="insp-add-btn" onClick={addStroke}>
        <Icon name="Plus" label={undefined} size="0.85em" />
        <span>Add Stroke</span>
      </button>
    </DisclosureSection>
  );
}

interface StrokeRowProps {
  index: number;
  nodes: StrokeNode[];
  expanded: boolean;
  onToggle: () => void;
  onChange: (updater: (s: Stroke) => Stroke) => void;
  onRemove: () => void;
  onReorder: (dir: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function StrokeRow({
  index,
  nodes,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onReorder,
  canMoveUp,
  canMoveDown,
}: StrokeRowProps) {
  const label = index === 0 ? 'Stroke' : `Stroke ${index + 1}`;
  const editor = useEditor();

  const visibleRaw = commonValue(nodes, (n) => getStroke(n, index)?.visible ?? true);
  const colorRaw = commonValue(
    nodes,
    (n) => getStroke(n, index)?.color ?? { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
  );
  const weightRaw = commonValue(nodes, (n) => getStroke(n, index)?.weight ?? 1);
  const alignRaw = commonValue(nodes, (n) => getStroke(n, index)?.align ?? 'center');
  const capRaw = commonValue(nodes, (n) => getStroke(n, index)?.cap ?? 'round');
  const joinRaw = commonValue(nodes, (n) => getStroke(n, index)?.join ?? 'miter');
  const miterLimitRaw = commonValue(nodes, (n) => getStroke(n, index)?.miterLimit ?? 4);
  const dashPatternRaw = commonValue(nodes, (n) => getStroke(n, index)?.dashPattern ?? []);
  const dashOffsetRaw = commonValue(nodes, (n) => getStroke(n, index)?.dashOffset ?? 0);
  const gradientRaw = commonValue(nodes, (n) => getStroke(n, index)?.gradient);
  const documentGradientInterpolation =
    editor.state.document.colorConfig?.defaultGradientInterpolation ?? 'oklab';
  const strokeInterpRaw = commonValue(
    nodes,
    (n) =>
      resolvedGradientInterpolationSpace(
        getStroke(n, index)?.gradient,
        documentGradientInterpolation,
      ),
  );
  const strokeHueRaw = commonValue(nodes, (n) =>
    resolvedGradientHueInterpolation(getStroke(n, index)?.gradient, documentGradientInterpolation),
  );
  const strokeInterpMixed = isMixed(strokeInterpRaw);
  const strokeHueMixed = isMixed(strokeHueRaw);
  const perSideRaw = commonValue(nodes, (n) => getStroke(n, index)?.perSideWeights);
  const arrowStartRaw = commonValue(nodes, (n) => getStroke(n, index)?.arrowStart ?? 'none');
  const arrowEndRaw = commonValue(nodes, (n) => getStroke(n, index)?.arrowEnd ?? 'none');

  const hasLineOrPath = nodes.some(isLineOrPath);
  const hasRectLike = nodes.some(isRectLike);

  const color = isMixed(colorRaw) ? null : colorRaw;
  const swatchBg = color ? toSwatchBg(color) : 'transparent';

  const visibility = isMixed(visibleRaw) ? true : visibleRaw;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        padding: 'var(--space-1) 0',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div className="insp-field">
        <button
          type="button"
          className="insp-inline-btn"
          aria-label={`${visibility ? 'Hide' : 'Show'} ${label}`}
          onClick={() => onChange((s) => ({ ...s, visible: !s.visible }))}
        >
          <Icon name={visibility ? 'Eye' : 'EyeOff'} label={undefined} size="0.85em" />
        </button>
        <InspectorColorPopover
          label={`${label} colour`}
          value={color ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }}
          onChange={(c) =>
            onChange((s) => ({
              ...s,
              color: c as ManagedColor,
            }))
          }
          swatchStyle={{
            background: swatchBg,
            borderColor: isMixed(colorRaw) ? 'var(--color-border-strong)' : undefined,
          }}
          documentColorMode={editor.documentColorMode}
          onEditStart={editor.beginTransaction}
          onEditEnd={editor.commitTransaction}
        />
        <NumberField
          label={label}
          value={isMixed(weightRaw) ? 0 : weightRaw}
          mixed={isMixed(weightRaw)}
          step={1}
          min={0}
          fieldName={`strokeWeight${index}`}
          onShiftClick={() => editor.setBindingField(`strokeWeight${index}`)}
          onChange={(v) => onChange((s) => ({ ...s, weight: v }))}
        />
        <SegmentedControl
          label={`${label} align`}
          value={isMixed(alignRaw) ? 'center' : alignRaw}
          options={ALIGN_OPTIONS}
          onChange={(v) => onChange((s) => ({ ...s, align: v }))}
        />
        <button
          type="button"
          aria-label={`Move ${label} up`}
          disabled={!canMoveUp}
          onClick={() => onReorder(-1)}
          className="insp-inline-btn"
          style={{
            opacity: canMoveUp ? 1 : 0.3,
            cursor: canMoveUp ? 'pointer' : 'not-allowed',
          }}
        >
          <Icon name="ChevronUp" label={undefined} size="0.85em" />
        </button>
        <button
          type="button"
          aria-label={`Move ${label} down`}
          disabled={!canMoveDown}
          onClick={() => onReorder(1)}
          className="insp-inline-btn"
          style={{
            opacity: canMoveDown ? 1 : 0.3,
            cursor: canMoveDown ? 'pointer' : 'not-allowed',
          }}
        >
          <Icon name="ChevronDown" label={undefined} size="0.85em" />
        </button>
        <button
          type="button"
          className="insp-inline-btn"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <Icon name="X" label={undefined} size="0.85em" />
        </button>
      </div>
      <button type="button" className="insp-advanced-btn" onClick={onToggle}>
        <Icon
          name="ChevronRight"
          label={undefined}
          size="0.75em"
          style={{
            transition: 'transform var(--duration-quick) var(--ease-standard)',
            transform: expanded ? 'rotate(90deg)' : 'none',
          }}
        />
        <span>Advanced</span>
      </button>
      {expanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            paddingLeft: 'var(--space-4)',
          }}
        >
          {/* Stroke type: solid vs gradient */}
          <FieldRow label="Type">
            <Select
              label={`${label} paint type`}
              value={isMixed(gradientRaw) ? '' : gradientRaw ? 'gradient' : 'solid'}
              options={[
                ...(isMixed(gradientRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
                { value: 'solid', label: 'Solid' },
                { value: 'gradient', label: 'Gradient' },
              ]}
              onChange={(v) => {
                if (v === 'gradient') {
                  onChange((s) => ({
                    ...s,
                    gradient: s.gradient ?? {
                      type: 'linear',
                      stops: [
                        {
                          position: 0,
                          color: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 },
                        },
                        {
                          position: 1,
                          color: { space: 'rgb' as const, r: 37, g: 99, b: 235, a: 255 },
                        },
                      ],
                      interpolationSource: 'document',
                    },
                  }));
                } else {
                  onChange((s) => {
                    const { gradient: _g, ...rest } = s;
                    return rest as Stroke;
                  });
                }
              }}
            />
          </FieldRow>
          {!isMixed(gradientRaw) && gradientRaw && (
            <GradientEditor
              gradient={gradientRaw as GradientFill}
              onChange={(g: GradientFill) => onChange((s) => ({ ...s, gradient: g }))}
              documentColorMode={editor.documentColorMode}
              documentGradientInterpolation={documentGradientInterpolation}
              mixedInterpolationSpace={strokeInterpMixed}
              mixedHue={strokeHueMixed}
            />
          )}
          {/* Per-side weights for rects/frames */}
          {hasRectLike && (
            <FieldRow label="Per-side">
              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                {(['T', 'R', 'B', 'L'] as const).map((side, i) => (
                  <input
                    key={side}
                    type="number"
                    aria-label={`${label} ${side} weight`}
                    value={
                      !isMixed(perSideRaw) && perSideRaw
                        ? (perSideRaw as [number, number, number, number])[i]
                        : isMixed(weightRaw)
                          ? 0
                          : weightRaw
                    }
                    step={0.5}
                    min={0}
                    onChange={(e) => {
                      const base =
                        !isMixed(perSideRaw) && perSideRaw
                          ? [...(perSideRaw as [number, number, number, number])]
                          : [
                              isMixed(weightRaw) ? 0 : weightRaw,
                              isMixed(weightRaw) ? 0 : weightRaw,
                              isMixed(weightRaw) ? 0 : weightRaw,
                              isMixed(weightRaw) ? 0 : weightRaw,
                            ];
                      base[i] = Number(e.target.value) || 0;
                      onChange((s) => ({
                        ...s,
                        perSideWeights: base as [number, number, number, number],
                      }));
                    }}
                    className="insp-per-side"
                  />
                ))}
              </div>
            </FieldRow>
          )}
          {/* Arrowheads for lines/paths */}
          {hasLineOrPath && (
            <>
              <FieldRow label="Start">
                <Select
                  label={`${label} arrowhead start`}
                  value={isMixed(arrowStartRaw) ? 'none' : arrowStartRaw}
                  options={ARROW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(v) => onChange((s) => ({ ...s, arrowStart: v as ArrowheadStyle }))}
                />
              </FieldRow>
              <FieldRow label="End">
                <Select
                  label={`${label} arrowhead end`}
                  value={isMixed(arrowEndRaw) ? 'none' : arrowEndRaw}
                  options={ARROW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(v) => onChange((s) => ({ ...s, arrowEnd: v as ArrowheadStyle }))}
                />
              </FieldRow>
            </>
          )}
          <FieldRow label="Cap">
            <SegmentedControl
              label={`${label} cap`}
              value={isMixed(capRaw) ? 'round' : capRaw}
              options={CAP_OPTIONS}
              onChange={(v) => onChange((s) => ({ ...s, cap: v }))}
            />
          </FieldRow>
          <FieldRow label="Join">
            <SegmentedControl
              label={`${label} join`}
              value={isMixed(joinRaw) ? 'miter' : joinRaw}
              options={JOIN_OPTIONS}
              onChange={(v) => onChange((s) => ({ ...s, join: v }))}
            />
          </FieldRow>
          <NumberField
            label="Miter limit"
            value={isMixed(miterLimitRaw) ? 4 : miterLimitRaw}
            mixed={isMixed(miterLimitRaw)}
            step={0.5}
            min={0}
            onChange={(v) => onChange((s) => ({ ...s, miterLimit: v }))}
          />
          <FieldRow label="Dash pattern">
            <input
              type="text"
              className="insp-num__input"
              aria-label={`${label} dash pattern`}
              defaultValue={isMixed(dashPatternRaw) ? '' : dashPatternRaw.join(', ')}
              onBlur={(e) => {
                const parts = e.target.value.split(',').map((s) => Number.parseFloat(s.trim()));
                const valid = parts.every((n) => Number.isFinite(n) && n >= 0);
                if (valid) onChange((s) => ({ ...s, dashPattern: parts }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              placeholder="e.g. 4, 2"
            />
          </FieldRow>
          <NumberField
            label="Dash offset"
            value={isMixed(dashOffsetRaw) ? 0 : dashOffsetRaw}
            mixed={isMixed(dashOffsetRaw)}
            step={1}
            onChange={(v) => onChange((s) => ({ ...s, dashOffset: v }))}
          />
        </div>
      )}
    </div>
  );
}
