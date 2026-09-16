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
  ManagedColor,
  SceneNode,
  ShapeNode,
  Stroke,
  StrokeAlign,
  StrokeCap,
  StrokeJoin,
  TextNode,
} from '@varve/scene';
import { createStrokeId, defaultStroke } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { Icon, Menu, type MenuEntry, Select, Switch } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
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

const ALIGN_OPTIONS: readonly { value: StrokeAlign; label: string }[] = [
  { value: 'inside', label: 'Inside' },
  { value: 'center', label: 'Center' },
  { value: 'outside', label: 'Outside' },
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

const CAP_LABELS: Record<StrokeCap, string> = {
  butt: 'Butt',
  round: 'Round',
  square: 'Square',
};

const JOIN_LABELS: Record<StrokeJoin, string> = {
  miter: 'Miter',
  round: 'Round',
  bevel: 'Bevel',
};

/** Clockwise, matching the canvas: the box edge order authors read. */
const PER_SIDE_LABELS = ['Top', 'Right', 'Bottom', 'Left'] as const;

/**
 * Dash presets in absolute (canvas) units — the same units `setLineDash`
 * consumes. The previous UI offered only a raw comma-separated text field,
 * which is the Affinity/Illustrator "four mystery numbers" failure: precise
 * but undiscoverable. Presets make the common patterns one click; the text
 * field stays for precision under Custom.
 */
const DASH_PRESETS: readonly { id: string; label: string; pattern: number[] }[] = [
  { id: 'solid', label: 'Solid', pattern: [] },
  { id: 'dashed', label: 'Dashed', pattern: [8, 4] },
  { id: 'dotted', label: 'Dotted', pattern: [1, 2] },
  { id: 'dash-dot', label: 'Dash-dot', pattern: [8, 4, 2, 4] },
];

const CUSTOM_DASH_ID = 'custom';

const DASH_STYLE_OPTIONS: { value: string; label: string }[] = [
  ...DASH_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
  { value: CUSTOM_DASH_ID, label: 'Custom…' },
];

function dashPatternsEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Preset id for a stored pattern; 'custom' when no preset matches. */
function dashPresetFor(pattern: readonly number[]): string {
  if (pattern.length === 0) return 'solid';
  const preset = DASH_PRESETS.find(
    (candidate) => candidate.pattern.length > 0 && dashPatternsEqual(candidate.pattern, pattern),
  );
  return preset?.id ?? CUSTOM_DASH_ID;
}

function dashStyleLabel(styleId: string): string {
  return DASH_STYLE_OPTIONS.find((option) => option.value === styleId)?.label ?? 'Custom';
}

function hasStrokes(n: SceneNode): n is StrokeNode {
  return n.kind === 'shape' || n.kind === 'text' || n.kind === 'frame';
}

/** True if every selected node is a line, arrow, or open path (supports arrowheads). */
function isLineOrPath(n: SceneNode): boolean {
  if (n.kind !== 'shape') return false;
  const s = n.shape;
  return (
    s.kind === 'line' ||
    s.kind === 'arrow' ||
    (s.kind === 'path' && !s.closed && s.points.length > 1)
  );
}

/** True if every selected node is a rect or frame (supports per-side weights). */
function isRectLike(n: SceneNode): boolean {
  if (n.kind === 'frame') return true;
  if (n.kind === 'shape') return n.shape.kind === 'rect';
  return false;
}

function getStroke(n: SceneNode, i: number): Stroke | undefined {
  const sn = n as StrokeNode;
  return sn.strokes?.[i];
}

function strokeRowId(n: StrokeNode, index: number): string {
  return n.strokes[index]?.id ?? `legacy-stroke-${index}`;
}

function formatDashPattern(pattern: number[]): string {
  return pattern.join(', ');
}

/** Strictly parse the documented comma/space-separated dash syntax. */
function parseDashPattern(value: string): number[] | null {
  const trimmed = value.trim();
  if (trimmed === '') return [];
  const tokens = trimmed.split(/[\s,]+/);
  if (tokens.length > 64 || tokens.some((token) => token === '')) return null;
  const values = tokens.map((token) => Number(token));
  if (values.some((number) => !Number.isFinite(number) || number < 0)) return null;
  // Canvas treats an all-zero dash list as a degenerate pattern. Treating it
  // as solid gives the field a useful, reversible meaning and avoids a
  // renderer-specific fallback.
  return values.some((number) => number > 0) ? values : [];
}

function toSwatchBg(color: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

function gradientSwatchBg(gradient: import('@varve/scene').GradientFill): string {
  const stops = gradient.stops
    .map((stop) => {
      const [r, g, b, a] = managedColorToRgba(stop.color);
      return `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${(stop.position * 100).toFixed(0)}%`;
    })
    .join(', ');
  return `linear-gradient(90deg, ${stops})`;
}

export function StrokeSection({ nodes }: StrokeSectionProps) {
  const { updateNode, beginTransaction, commitTransaction, announce } = useEditor();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const strokeNodes = useMemo(() => nodes.filter(hasStrokes), [nodes]);

  const toggleRow = useCallback((rowId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
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
    // New strokes copy the layer's last stroke (Illustrator-style style
    // memory) so weight, colour, dash and arrows do not have to be rebuilt
    // from the 1px black default on every add.
    batchUpdate((strokes) => {
      const template = strokes[strokes.length - 1];
      return [
        ...strokes,
        { ...(template ?? defaultStroke()), id: createStrokeId(), visible: true },
      ];
    });
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
    <DisclosureSection
      title="Stroke"
      sectionId="stroke"
      action={
        <button type="button" className="insp-add-btn" onClick={addStroke}>
          <Icon name="Plus" label={undefined} size="0.85em" />
          <span>Add Stroke</span>
        </button>
      }
    >
      {strokeNodes.every((n) => n.strokes.length === 0) ? (
        <div className="insp-empty-message">No stroke</div>
      ) : (
        Array.from({ length: minStrokes }, (_, i) => (
          <StrokeRow
            key={strokeRowId(strokeNodes[0]!, i)}
            rowId={strokeRowId(strokeNodes[0]!, i)}
            index={i}
            totalStrokes={minStrokes}
            nodes={strokeNodes}
            expanded={expandedRows.has(strokeRowId(strokeNodes[0]!, i))}
            onToggle={() => toggleRow(strokeRowId(strokeNodes[0]!, i))}
            onChange={(updater) => updateStroke(i, updater)}
            onRemove={() => removeStroke(i)}
            onReorder={(dir) => reorderStroke(i, i + dir)}
            canMoveUp={i > 0}
            canMoveDown={i < minStrokes - 1}
          />
        ))
      )}
      {countMixed && minStrokes > 0 && (
        <div className="insp-empty-message">
          Some selected layers have extra strokes beyond these
        </div>
      )}
    </DisclosureSection>
  );
}

interface StrokeRowProps {
  rowId: string;
  index: number;
  totalStrokes: number;
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
  rowId,
  index,
  totalStrokes,
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
  const strokeInterpRaw = commonValue(nodes, (n) =>
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
  const dashInputValue = isMixed(dashPatternRaw)
    ? ''
    : formatDashPattern(dashPatternRaw as number[]);
  const [dashDraft, setDashDraft] = useState(dashInputValue);
  useEffect(() => setDashDraft(dashInputValue), [dashInputValue]);

  const hasLineOrPath = nodes.every(isLineOrPath);
  const hasRectLike = nodes.every(isRectLike);

  const color = isMixed(colorRaw) ? null : colorRaw;
  const swatchBg = color ? toSwatchBg(color) : 'transparent';
  const gradient = isMixed(gradientRaw) ? null : gradientRaw;
  const swatchBackground = gradient ? gradientSwatchBg(gradient) : swatchBg;

  const visibility = isMixed(visibleRaw) ? true : visibleRaw;

  // ── Advanced-state summary ──
  // The collapsed row must be able to say "this stroke is dashed" or "has
  // arrowheads" without being expanded; otherwise hidden state reads as
  // default state (the Affinity dash-fields complaint, generalised).
  const dashPattern = isMixed(dashPatternRaw) ? null : (dashPatternRaw as number[]);
  const dashStyleMixed = dashPattern === null;
  const dashStyle = dashPattern === null ? CUSTOM_DASH_ID : dashPresetFor(dashPattern);
  // Choosing "Custom…" while the stored pattern still matches a preset must
  // keep the pattern editor open (the value alone cannot carry that intent).
  const [customDashOpen, setCustomDashOpen] = useState(false);
  const weight = isMixed(weightRaw) ? 1 : weightRaw;
  const perSideActive = Array.isArray(perSideRaw) && perSideRaw.length === 4;
  const perSideValues: [number, number, number, number] = perSideActive
    ? (perSideRaw as [number, number, number, number])
    : [weight, weight, weight, weight];
  const join = isMixed(joinRaw) ? 'miter' : joinRaw;
  const arrowStart = isMixed(arrowStartRaw) ? 'none' : arrowStartRaw;
  const arrowEnd = isMixed(arrowEndRaw) ? 'none' : arrowEndRaw;
  const zeroWidth = !perSideActive && !isMixed(weightRaw) && weightRaw === 0;
  const advancedParts: string[] = [];
  if (gradient) advancedParts.push('Gradient');
  if (!dashStyleMixed && dashStyle !== 'solid') advancedParts.push(dashStyleLabel(dashStyle));
  if (!isMixed(dashOffsetRaw) && dashOffsetRaw !== 0) advancedParts.push(`Offset ${dashOffsetRaw}`);
  if (perSideActive) advancedParts.push('Per-side');
  if (arrowStart !== 'none' || arrowEnd !== 'none') advancedParts.push('Arrowheads');
  if (!isMixed(capRaw) && capRaw !== 'round') advancedParts.push(`${CAP_LABELS[capRaw]} caps`);
  if (!isMixed(joinRaw) && joinRaw !== 'miter') advancedParts.push(`${JOIN_LABELS[joinRaw]} joins`);
  if (!isMixed(miterLimitRaw) && join === 'miter' && miterLimitRaw !== 4) {
    advancedParts.push(`Miter ${miterLimitRaw}`);
  }

  const setPerSideEnabled = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        onChange((s) => ({ ...s, perSideWeights: [s.weight, s.weight, s.weight, s.weight] }));
      } else {
        onChange((s) => {
          const { perSideWeights: _drop, ...rest } = s;
          return rest as Stroke;
        });
      }
    },
    [onChange],
  );

  const setPerSideValue = useCallback(
    (side: number, value: number) => {
      onChange((s) => {
        const current = s.perSideWeights ?? [s.weight, s.weight, s.weight, s.weight];
        const next = [...current] as [number, number, number, number];
        next[side] = value;
        return { ...s, perSideWeights: next };
      });
    },
    [onChange],
  );

  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const actionItems = useMemo<readonly MenuEntry[]>(
    () => [
      {
        id: 'move-up',
        label: `Move ${label.toLowerCase()} up`,
        onAction: () => onReorder(-1),
        disabled: !canMoveUp,
        icon: 'ChevronUp',
      },
      {
        id: 'move-down',
        label: `Move ${label.toLowerCase()} down`,
        onAction: () => onReorder(1),
        disabled: !canMoveDown,
        icon: 'ChevronDown',
      },
      { id: 'separator-before-remove', separator: true },
      {
        id: 'remove',
        label: `Remove ${label.toLowerCase()}`,
        onAction: onRemove,
        destructive: true,
        icon: 'X',
      },
    ],
    [canMoveDown, canMoveUp, label, onRemove, onReorder],
  );

  return (
    <div className="insp-stroke-row">
      <div className="insp-paint-row">
        <Switch
          className="insp-switch"
          aria-label={`${visibility ? 'Hide' : 'Show'} ${label}`}
          checked={visibility}
          onChange={() => onChange((s) => ({ ...s, visible: !s.visible }))}
        />
        <InspectorColorPopover
          label={`${label} colour`}
          value={gradient?.stops[0]?.color ?? color ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }}
          onChange={(c) =>
            onChange((s) => (gradient ? { ...s } : { ...s, color: c as ManagedColor }))
          }
          gradient={
            gradient
              ? {
                  value: gradient,
                  onChange: (g) => onChange((s) => ({ ...s, gradient: g })),
                  documentGradientInterpolation,
                  mixedInterpolationSpace: strokeInterpMixed,
                  mixedHue: strokeHueMixed,
                }
              : undefined
          }
          swatchStyle={{
            background: swatchBackground,
            borderColor: isMixed(colorRaw) ? 'var(--color-border-strong)' : undefined,
          }}
          documentColorMode={editor.documentColorMode}
          onEditStart={editor.beginTransaction}
          onEditEnd={editor.commitTransaction}
        />
        <div className="insp-paint-row__weight">
          <NumberField
            label={`${label} weight`}
            hideLabel
            value={isMixed(weightRaw) ? 0 : weightRaw}
            mixed={isMixed(weightRaw)}
            unit="px"
            step={1}
            min={0}
            fieldName={`strokeWeight:${rowId}`}
            onShiftClick={() => editor.setBindingField(`strokeWeight:${rowId}`)}
            onChange={(v) => onChange((s) => ({ ...s, weight: v }))}
          />
        </div>
        <div className="insp-paint-row__type">
          <Select
            label={`${label} position`}
            value={isMixed(alignRaw) ? '' : alignRaw}
            options={[
              ...(isMixed(alignRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
              ...ALIGN_OPTIONS,
            ]}
            onChange={(v) => {
              if (v) onChange((s) => ({ ...s, align: v as StrokeAlign }));
            }}
            placeholder="Mixed"
          />
        </div>
        {/* Multi-stroke stacks get the same direct reorder/remove affordances
            as multi-fill stacks; a single stroke keeps the row quiet and uses
            the actions menu. */}
        {totalStrokes > 1 && (
          <div className="insp-paint-row__reorder">
            <button
              type="button"
              className="insp-paint-row__reorder-btn"
              aria-label={`Move ${label.toLowerCase()} up`}
              title={`Move ${label.toLowerCase()} up`}
              disabled={!canMoveUp}
              onClick={() => onReorder(-1)}
            >
              <Icon name="ChevronUp" size="0.75em" />
            </button>
            <button
              type="button"
              className="insp-paint-row__reorder-btn"
              aria-label={`Move ${label.toLowerCase()} down`}
              title={`Move ${label.toLowerCase()} down`}
              disabled={!canMoveDown}
              onClick={() => onReorder(1)}
            >
              <Icon name="ChevronDown" size="0.75em" />
            </button>
          </div>
        )}
        {totalStrokes > 1 && (
          <button
            type="button"
            className="insp-paint-row__remove-btn"
            aria-label={`Remove ${label.toLowerCase()}`}
            title={`Remove ${label.toLowerCase()}`}
            onClick={onRemove}
          >
            <Icon name="X" size="0.75em" />
          </button>
        )}
        <button
          type="button"
          ref={actionsTriggerRef}
          className="insp-inline-btn insp-paint-row__menu-trigger"
          aria-label={`${label} actions`}
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((open) => !open)}
        >
          <Icon name="Ellipsis" label={undefined} size="0.85em" />
        </button>
        <Menu
          triggerRef={actionsTriggerRef}
          open={actionsOpen}
          onClose={() => setActionsOpen(false)}
          label={`${label} actions`}
          items={actionItems}
          size="compact"
        />
      </div>
      <button
        type="button"
        className="insp-advanced-btn"
        aria-expanded={expanded}
        title={
          advancedParts.length > 0
            ? `Advanced stroke settings: ${advancedParts.join(', ')}`
            : 'Advanced stroke settings'
        }
        onClick={onToggle}
      >
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
        {advancedParts.length > 0 && (
          <span className="insp-advanced-btn__summary">{advancedParts.join(' · ')}</span>
        )}
      </button>
      {expanded && (
        <div className="insp-paint-advanced">
          {/* Dash: one-click presets, exact values under Custom. */}
          <FieldRow label="Dash">
            <Select
              label={`${label} dash style`}
              value={dashStyleMixed ? '' : dashStyle}
              options={[
                ...(dashStyleMixed ? [{ value: '', label: 'Mixed', disabled: true }] : []),
                ...DASH_STYLE_OPTIONS,
              ]}
              onChange={(v) => {
                if (!v) return;
                if (v === CUSTOM_DASH_ID) {
                  // Keep the current values; just reveal the exact editor.
                  setCustomDashOpen(true);
                  return;
                }
                setCustomDashOpen(false);
                const preset = DASH_PRESETS.find((candidate) => candidate.id === v);
                if (preset) onChange((s) => ({ ...s, dashPattern: [...preset.pattern] }));
              }}
            />
          </FieldRow>
          {(dashStyle === CUSTOM_DASH_ID || dashStyleMixed || customDashOpen) && (
            <FieldRow label="Pattern">
              <input
                type="text"
                className="insp-num__input"
                aria-label={`${label} dash pattern`}
                value={dashDraft}
                onChange={(e) => setDashDraft(e.target.value)}
                onBlur={(e) => {
                  const pattern = parseDashPattern(e.target.value);
                  if (pattern) {
                    onChange((s) => ({ ...s, dashPattern: pattern }));
                    setDashDraft(formatDashPattern(pattern));
                  } else {
                    setDashDraft(dashInputValue);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder="e.g. 4, 2"
              />
            </FieldRow>
          )}
          {!dashStyleMixed && dashStyle !== 'solid' && (
            <NumberField
              label="Dash offset"
              value={isMixed(dashOffsetRaw) ? 0 : dashOffsetRaw}
              mixed={isMixed(dashOffsetRaw)}
              step={1}
              onChange={(v) => onChange((s) => ({ ...s, dashOffset: v }))}
            />
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
          {/* Miter limit only means something for miter joins. */}
          {join === 'miter' && (
            <NumberField
              label="Miter limit"
              value={isMixed(miterLimitRaw) ? 4 : miterLimitRaw}
              mixed={isMixed(miterLimitRaw)}
              step={0.5}
              min={1}
              onChange={(v) => onChange((s) => ({ ...s, miterLimit: v }))}
            />
          )}
          {/* Arrowheads for lines/paths — both ends on one row. */}
          {hasLineOrPath && (
            <FieldRow label="Arrowheads">
              <div className="insp-paint-advanced__pair">
                <div className="insp-paint-advanced__cell">
                  <span className="insp-paint-advanced__caption">Start</span>
                  <Select
                    label={`${label} arrowhead start`}
                    value={isMixed(arrowStartRaw) ? 'none' : arrowStartRaw}
                    options={ARROW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    onChange={(v) => onChange((s) => ({ ...s, arrowStart: v as ArrowheadStyle }))}
                  />
                </div>
                <div className="insp-paint-advanced__cell">
                  <span className="insp-paint-advanced__caption">End</span>
                  <Select
                    label={`${label} arrowhead end`}
                    value={isMixed(arrowEndRaw) ? 'none' : arrowEndRaw}
                    options={ARROW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    onChange={(v) => onChange((s) => ({ ...s, arrowEnd: v as ArrowheadStyle }))}
                  />
                </div>
              </div>
            </FieldRow>
          )}
          {/* Per-side widths are a mode, not four loose fields: the switch
              creates the quadrille, the text action returns to one width. */}
          {hasRectLike && (
            <>
              <FieldRow label="Per-side">
                <div className="insp-paint-advanced__actions">
                  <Switch
                    aria-label={`${label} per-side widths`}
                    checked={perSideActive}
                    onChange={() => setPerSideEnabled(!perSideActive)}
                  />
                  {perSideActive && (
                    <button
                      type="button"
                      className="insp-text-btn"
                      onClick={() => setPerSideEnabled(false)}
                    >
                      Use one width
                    </button>
                  )}
                </div>
              </FieldRow>
              {perSideActive && (
                <fieldset className="insp-quad-grid">
                  <legend className="sr-only">{label} per-side widths</legend>
                  {PER_SIDE_LABELS.map((side, i) => (
                    <NumberField
                      key={side}
                      label={side}
                      displayLabel={side.slice(0, 2)}
                      unit="px"
                      value={perSideValues[i] ?? 0}
                      min={0}
                      step={0.5}
                      onChange={(v) => setPerSideValue(i, v)}
                    />
                  ))}
                </fieldset>
              )}
            </>
          )}
          {/* Stroke paint type: solid vs gradient */}
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
        </div>
      )}
      {zeroWidth && (
        <p className="insp-paint-note" role="note">
          Zero width — this stroke is invisible on the canvas.
        </p>
      )}
    </div>
  );
}
