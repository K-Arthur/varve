/**
 * StrokeSection — stacked stroke controls for the Inspector.
 *
 * Multi-select: shows common strokes by index, "Mixed" for differing
 * properties. Property edits batch across all selected nodes in one
 * undo step via the transaction API.
 *
 * Research basis: Figma / Sketch stroke panel, APG Disclosure pattern.
 */
import type { Color } from '@strata/engine';
import type {
  FrameNode,
  SceneNode,
  ShapeNode,
  Stroke,
  StrokeAlign,
  StrokeCap,
  StrokeJoin,
  TextNode,
} from '@strata/scene';
import { defaultStroke } from '@strata/scene';
import { Icon } from '@strata/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
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

function hasStrokes(n: SceneNode): n is StrokeNode {
  return n.kind === 'shape' || n.kind === 'text' || n.kind === 'frame';
}

function getStroke(n: SceneNode, i: number): Stroke | undefined {
  const sn = n as StrokeNode;
  return sn.strokes?.[i];
}

function toSwatchBg(color: Color): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${(color[3] / 255).toFixed(2)})`;
}

const SWATCH_STYLE: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border-subtle)',
  flexShrink: 0,
  cursor: 'pointer',
  padding: 0,
};

const INLINE_BTN: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  background: 'transparent',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

const ADVANCED_BTN: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-muted)',
  font: 'inherit',
  fontSize: 'var(--font-size-xs)',
  cursor: 'pointer',
  padding: 'var(--space-1) 0',
};

const ADD_BTN: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-1)',
  width: '100%',
  height: 'var(--space-5)',
  background: 'transparent',
  border: '1px dashed var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-muted)',
  font: 'inherit',
  fontSize: 'var(--font-size-xs)',
  cursor: 'pointer',
};

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

  if (strokeNodes.length === 0) return null;

  const minStrokes = Math.min(...strokeNodes.map((n) => n.strokes.length));
  const allEqual = strokeNodes.every((n) => n.strokes.length === minStrokes);
  const countMixed = !allEqual;

  return (
    <DisclosureSection title="Stroke">
      {strokeNodes.every((n) => n.strokes.length === 0) ? (
        <div
          style={{
            padding: 'var(--space-2) 0',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          No stroke
        </div>
      ) : (
        Array.from({ length: minStrokes }, (_, i) => (
          <StrokeRow
            key={i}
            index={i}
            nodes={strokeNodes}
            expanded={expandedRows.has(i)}
            onToggle={() => toggleRow(i)}
            onChange={(updater) => updateStroke(i, updater)}
            onRemove={() => removeStroke(i)}
          />
        ))
      )}
      {countMixed && minStrokes > 0 && (
        <div
          style={{
            padding: 'var(--space-1) 0',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          Some selected nodes have additional strokes
        </div>
      )}
      <button type="button" style={ADD_BTN} onClick={addStroke}>
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
}

function StrokeRow({ index, nodes, expanded, onToggle, onChange, onRemove }: StrokeRowProps) {
  const label = index === 0 ? 'Stroke' : `Stroke ${index + 1}`;

  const visibleRaw = commonValue(nodes, (n) => getStroke(n, index)?.visible ?? true);
  const colorRaw = commonValue(
    nodes,
    (n) => getStroke(n, index)?.color ?? ([0, 0, 0, 255] as Color),
  );
  const weightRaw = commonValue(nodes, (n) => getStroke(n, index)?.weight ?? 1);
  const alignRaw = commonValue(nodes, (n) => getStroke(n, index)?.align ?? 'center');
  const capRaw = commonValue(nodes, (n) => getStroke(n, index)?.cap ?? 'round');
  const joinRaw = commonValue(nodes, (n) => getStroke(n, index)?.join ?? 'miter');
  const miterLimitRaw = commonValue(nodes, (n) => getStroke(n, index)?.miterLimit ?? 4);
  const dashPatternRaw = commonValue(nodes, (n) => getStroke(n, index)?.dashPattern ?? []);
  const dashOffsetRaw = commonValue(nodes, (n) => getStroke(n, index)?.dashOffset ?? 0);

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
          style={INLINE_BTN}
          aria-label={`${visibility ? 'Hide' : 'Show'} ${label}`}
          onClick={() => onChange((s) => ({ ...s, visible: !s.visible }))}
        >
          <Icon name={visibility ? 'Eye' : 'EyeOff'} label={undefined} size="0.85em" />
        </button>
        <button
          type="button"
          aria-label={`${label} colour`}
          style={{
            ...SWATCH_STYLE,
            background: swatchBg,
            borderColor: isMixed(colorRaw) ? 'var(--color-border-strong)' : undefined,
          }}
        />
        <NumberField
          label={label}
          value={isMixed(weightRaw) ? 0 : weightRaw}
          mixed={isMixed(weightRaw)}
          step={1}
          min={0}
          onChange={(v) => onChange((s) => ({ ...s, weight: v }))}
        />
        <SegmentedControl
          label={`${label} align`}
          value={isMixed(alignRaw) ? 'center' : alignRaw}
          options={ALIGN_OPTIONS}
          onChange={(v) => onChange((s) => ({ ...s, align: v }))}
        />
        <button type="button" style={INLINE_BTN} aria-label={`Remove ${label}`} onClick={onRemove}>
          <Icon name="X" label={undefined} size="0.85em" />
        </button>
      </div>
      <button type="button" style={ADVANCED_BTN} onClick={onToggle}>
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
