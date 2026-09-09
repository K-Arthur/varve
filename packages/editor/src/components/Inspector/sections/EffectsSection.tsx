/**
 * EffectsSection — stacked layer-effect controls (shadows, glows, and blurs).
 *
 * Multi-select: matches effects by stable identity when available, with a
 * type-checked index fallback for legacy stacks. Property edits batch across
 * all selected nodes in one undo step.
 *
 * Research basis: Figma / Sketch effects panel, APG Disclosure pattern.
 */
import type {
  BlendMode,
  ChannelColors,
  ChannelOffset,
  ChromaticChannelSource,
  ChromaticContribution,
  Effect,
  EffectGradient,
  EffectMaskBinding,
  FrameNode,
  GroupNode,
  ManagedColor,
  PathNode,
  RasterLayerNode,
  SceneNode,
  ShapeNode,
  TableNode,
  TextNode,
} from '@varve/scene';
import {
  canBeMatteSource,
  canHaveLayerEffects,
  cloneEffects,
  createDefaultEffect,
  layerEffectMoveTarget,
  layerEffectStage,
  removeEffectMask,
  setEffectMask,
} from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { Icon, Select } from '@varve/ui';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow, InspectorFieldGroup } from '../controls/FieldRow';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed, type MaybeMixed } from '../selection/selectionState';

export interface EffectsSectionProps {
  nodes: SceneNode[];
  /** Link the disclosure to centralized Inspector state when hosted there. */
  sectionId?: 'effects';
}

type EffectNode =
  | ShapeNode
  | TextNode
  | FrameNode
  | GroupNode
  | TableNode
  | PathNode
  | RasterLayerNode;

const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'colorDodge', label: 'Color Dodge' },
  { value: 'colorBurn', label: 'Color Burn' },
  { value: 'hardLight', label: 'Hard Light' },
  { value: 'softLight', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

function hasEffects(n: SceneNode): n is EffectNode {
  return canHaveLayerEffects(n);
}

function getEffect(n: SceneNode, i: number): Effect | undefined {
  const sn = n as EffectNode;
  return sn.effects?.[i];
}

/**
 * Resolve a row's first-node effect in each selected stack without applying a
 * change to an unrelated effect that merely happens to share its array index.
 * Older documents may not have effect ids, so the fallback remains guarded by
 * the effect type.
 */
function matchingEffectIndex(
  effects: Effect[],
  rowIndex: number,
  reference: Effect | undefined,
  referenceStack: readonly Effect[] = effects,
): number {
  if (!reference) return -1;
  if (reference.id) {
    const byId = effects.findIndex((effect) => effect.id === reference.id);
    if (byId >= 0) return byId;
  }
  const stage = layerEffectStage(reference);
  const ordinal = referenceStack
    .slice(0, rowIndex)
    .filter(
      (effect) => effect.type === reference.type && layerEffectStage(effect) === stage,
    ).length;
  const candidates = effects.filter(
    (effect) => effect.type === reference.type && layerEffectStage(effect) === stage,
  );
  return candidates[ordinal] ? effects.indexOf(candidates[ordinal]!) : -1;
}

/**
 * Present one logical row consistently when selected layers have different
 * serialized orders. Missing effects stay missing; an unrelated effect at the
 * same array index must never appear as this row's controls.
 */
function alignEffectRow(
  node: EffectNode,
  rowIndex: number,
  referenceStack: readonly Effect[],
): EffectNode {
  const effects = node.effects ?? [];
  const targetIndex = matchingEffectIndex(
    effects,
    rowIndex,
    referenceStack[rowIndex],
    referenceStack,
  );
  if (targetIndex < 0) return { ...node, effects: [] };
  if (targetIndex === rowIndex) return node;
  const aligned = [...effects];
  const displaced = aligned[rowIndex] ?? aligned[targetIndex];
  aligned[rowIndex] = aligned[targetIndex]!;
  aligned[targetIndex] = displaced!;
  return { ...node, effects: aligned };
}

/** Generate a stable per-effect identifier (used as a row key for reordering). */
function toSwatchBg(color: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

const EFFECT_TYPE_OPTIONS: { value: Effect['type']; label: string }[] = [
  { value: 'dropShadow', label: 'Drop Shadow' },
  { value: 'innerShadow', label: 'Inner Shadow' },
  { value: 'outerGlow', label: 'Outer Glow' },
  { value: 'innerGlow', label: 'Inner Glow' },
  { value: 'layerBlur', label: 'Layer Blur' },
  { value: 'gaussianBlur', label: 'Gaussian Blur' },
  { value: 'fieldBlur', label: 'Field Blur' },
  { value: 'irisBlur', label: 'Iris Blur' },
  { value: 'tiltShiftBlur', label: 'Tilt-Shift Blur' },
  { value: 'pathBlur', label: 'Path Blur' },
  { value: 'spinBlur', label: 'Spin Blur' },
  { value: 'backgroundBlur', label: 'Background Blur' },
  { value: 'depthBlur', label: 'Depth Blur' },
  { value: 'glassMaterial', label: 'Glass Material' },
  { value: 'chromaticAberration', label: 'Chromatic Aberration' },
  { value: 'glitch', label: 'Glitch' },
];

export function EffectsSection({ nodes, sectionId }: EffectsSectionProps) {
  const { updateNode, beginTransaction, commitTransaction, announce } = useEditor();
  const [newEffectType, setNewEffectType] = useState<Effect['type']>('dropShadow');
  // Effect just added via the picker below — that row should mount expanded
  // (ready to configure) instead of collapsed like the rest of the stack.
  const [lastAddedIndex, setLastAddedIndex] = useState<number | null>(null);

  const effectNodes = useMemo(() => nodes.filter(hasEffects), [nodes]);
  const referenceEffects = useMemo(
    () => effectNodes.find((node) => (node.effects?.length ?? 0) > 0)?.effects ?? [],
    [effectNodes],
  );

  const batchUpdate = useCallback(
    (updater: (effects: Effect[]) => Effect[]) => {
      beginTransaction();
      for (const node of effectNodes) {
        updateNode(node.id, (n) => {
          const sn = n as EffectNode;
          return { ...n, effects: updater(sn.effects ?? []) };
        });
      }
      commitTransaction();
    },
    [effectNodes, updateNode, beginTransaction, commitTransaction],
  );

  const updateEffect = useCallback(
    (index: number, updater: (e: Effect) => Effect) => {
      const reference = referenceEffects[index];
      batchUpdate((effects) => {
        const next = [...effects];
        const targetIndex = matchingEffectIndex(effects, index, reference, referenceEffects);
        if (targetIndex >= 0) {
          next[targetIndex] = updater(next[targetIndex] as Effect);
        }
        return next;
      });
    },
    [batchUpdate, effectNodes, referenceEffects],
  );

  const addEffect = useCallback(() => {
    if (newEffectType === 'depthBlur') {
      announce('Generate a DepthMap in the image Depth Blur section before adding Depth Blur');
      return;
    }
    if (effectNodes.length > 0) {
      setLastAddedIndex(Math.min(...effectNodes.map((n) => n.effects?.length ?? 0)));
    }
    batchUpdate((effects) => [...effects, createDefaultEffect(newEffectType)]);
    announce('Effect added');
  }, [newEffectType, batchUpdate, announce, effectNodes]);

  const removeEffect = useCallback(
    (index: number) => {
      const reference = referenceEffects[index];
      batchUpdate((effects) => {
        const targetIndex = matchingEffectIndex(effects, index, reference, referenceEffects);
        return targetIndex >= 0 ? effects.filter((_, i) => i !== targetIndex) : effects;
      });
      announce('Effect removed');
    },
    [batchUpdate, announce, effectNodes, referenceEffects],
  );

  const duplicateEffect = useCallback(
    (index: number) => {
      setLastAddedIndex(index + 1);
      const reference = referenceEffects[index];
      batchUpdate((effects) => {
        const targetIndex = matchingEffectIndex(effects, index, reference, referenceEffects);
        const source = targetIndex >= 0 ? effects[targetIndex] : undefined;
        if (!source || targetIndex < 0) return effects;
        const next = [...effects];
        const copied = cloneEffects([source])[0];
        if (!copied) return effects;
        next.splice(targetIndex + 1, 0, copied);
        return next;
      });
      announce('Effect duplicated');
    },
    [batchUpdate, announce, effectNodes, referenceEffects],
  );

  const resetEffect = useCallback(
    (index: number) => {
      updateEffect(index, (effect) => {
        const reset = createDefaultEffect(effect.type, effect.id);
        return effect.mask ? { ...reset, mask: effect.mask } : reset;
      });
      announce('Effect reset');
    },
    [updateEffect, announce],
  );

  const reorderEffect = useCallback(
    (from: number, direction: -1 | 1) => {
      const reference = referenceEffects[from];
      batchUpdate((effects) => {
        const sourceIndex = matchingEffectIndex(effects, from, reference, referenceEffects);
        const targetIndex = layerEffectMoveTarget(effects, sourceIndex, direction);
        if (sourceIndex < 0 || targetIndex < 0) return effects;
        const next = [...effects];
        const [item] = next.splice(sourceIndex, 1);
        if (item) next.splice(targetIndex, 0, item);
        return next;
      });
    },
    [batchUpdate, effectNodes, referenceEffects],
  );

  if (effectNodes.length === 0) return null;

  const rowCount = referenceEffects.length;
  const countMixed = !effectNodes.every((n) => (n.effects?.length ?? 0) === rowCount);

  return (
    <DisclosureSection
      title="Layer Effects"
      sectionId={sectionId}
      defaultExpanded={effectNodes.some((n) => (n.effects?.length ?? 0) > 0)}
    >
      {effectNodes.every((n) => (n.effects?.length ?? 0) === 0) ? (
        <div className="insp-empty-message">No effects</div>
      ) : (
        Array.from({ length: rowCount }, (_, i) => {
          const first = referenceEffects[i];
          const rowKey = first?.id ?? `${i}-${first?.type ?? 'effect'}`;
          return (
            <EffectRow
              key={rowKey}
              index={i}
              nodes={effectNodes}
              onChange={(updater) => updateEffect(i, updater)}
              onRemove={() => removeEffect(i)}
              onDuplicate={() => duplicateEffect(i)}
              onReset={() => resetEffect(i)}
              onReorder={(dir: number) => reorderEffect(i, dir as -1 | 1)}
              canMoveUp={layerEffectMoveTarget(referenceEffects, i, -1) >= 0}
              canMoveDown={layerEffectMoveTarget(referenceEffects, i, 1) >= 0}
              startExpanded={i === lastAddedIndex}
            />
          );
        })
      )}
      {countMixed && rowCount > 0 && (
        <div className="insp-empty-message">Some selected nodes have additional effects</div>
      )}
      <div className="insp-fill-add">
        <Select
          label="New effect type"
          value={newEffectType}
          options={EFFECT_TYPE_OPTIONS}
          onChange={(v) => setNewEffectType(v as Effect['type'])}
        />
        <button
          type="button"
          className="insp-add-btn"
          onClick={addEffect}
          disabled={newEffectType === 'depthBlur'}
          title={
            newEffectType === 'depthBlur'
              ? 'Generate a DepthMap in the image Depth Blur section first'
              : undefined
          }
        >
          <Icon name="Plus" label={undefined} size="0.85em" />
          <span>Add</span>
        </button>
      </div>
    </DisclosureSection>
  );
}

interface EffectRowProps {
  index: number;
  nodes: EffectNode[];
  onChange: (updater: (e: Effect) => Effect) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onReset: () => void;
  onReorder: (dir: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Mount already expanded — used for the effect just added via the picker. */
  startExpanded?: boolean;
}

function EffectRow({
  index,
  nodes,
  onChange,
  onRemove,
  onDuplicate,
  onReset,
  onReorder,
  canMoveUp,
  canMoveDown,
  startExpanded = false,
}: EffectRowProps) {
  const referenceStack = nodes[0]?.effects ?? [];
  const rowNodes = nodes.map((node) => alignEffectRow(node, index, referenceStack));
  const hasMissingEffect = rowNodes.some((node) => (node.effects?.length ?? 0) === 0);
  const typeRaw = commonValue(rowNodes, (n) => getEffect(n, index)?.type ?? 'dropShadow');
  const visibleRaw = commonValue(rowNodes, (n) => getEffect(n, index)?.visible ?? true);

  const type = isMixed(typeRaw) ? null : typeRaw;
  const visibility = isMixed(visibleRaw) ? true : visibleRaw;

  const typeLabel =
    type === null
      ? 'Mixed'
      : (EFFECT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type);
  const rowLabel = hasMissingEffect ? `${typeLabel} · Not on all selected layers` : typeLabel;

  // Collapsed by default: with several stacked effects, showing every
  // effect's full parameter set (shadows/glow/blur/glass/etc. can each be a
  // dozen fields) at once turns the section into a wall of sliders. Only the
  // one-line summary row shows until expanded, matching how Figma/Sketch
  // effect stacks behave. `startExpanded` (lazy initializer) opens the row
  // that was just added instead of requiring an extra click to configure it.
  const [expanded, setExpanded] = useState(startExpanded);
  const paramsId = useId();

  return (
    <div className="insp-effect-row">
      <div className="insp-effect-row__header">
        {type && (
          <button
            type="button"
            className="insp-disclosure__trigger"
            style={{ width: 'auto', padding: 0 }}
            aria-expanded={expanded}
            aria-controls={paramsId}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${rowLabel} parameters`}
            onClick={() => setExpanded((v) => !v)}
          >
            <Icon
              name="ChevronRight"
              label={undefined}
              className="insp-disclosure__chevron"
              size="0.85em"
            />
          </button>
        )}
        <button
          type="button"
          className="insp-inline-btn"
          aria-label="Reset effect"
          onClick={onReset}
        >
          <Icon name="RotateCcw" label={undefined} size="0.85em" />
        </button>
        <button
          type="button"
          className="insp-inline-btn"
          aria-label="Duplicate effect"
          onClick={onDuplicate}
        >
          <Icon name="Copy" label={undefined} size="0.85em" />
        </button>
        <button
          type="button"
          className="insp-inline-btn"
          aria-label={`${visibility ? 'Hide' : 'Show'} effect`}
          onClick={() => onChange((e) => ({ ...e, visible: !e.visible }))}
        >
          <Icon name={visibility ? 'Eye' : 'EyeOff'} label={undefined} size="0.85em" />
        </button>
        {type &&
          type !== 'layerBlur' &&
          type !== 'gaussianBlur' &&
          type !== 'fieldBlur' &&
          type !== 'irisBlur' &&
          type !== 'tiltShiftBlur' &&
          type !== 'pathBlur' &&
          type !== 'spinBlur' &&
          type !== 'backgroundBlur' &&
          type !== 'glassMaterial' &&
          type !== 'chromaticAberration' &&
          type !== 'glitch' &&
          type !== 'depthBlur' && (
            <EffectColorSwatch nodes={rowNodes} index={index} onChange={onChange} />
          )}
        {type === 'glassMaterial' && (
          <GlassTintSwatch nodes={rowNodes} index={index} onChange={onChange} />
        )}
        <span
          style={{ flex: 1, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
        >
          {rowLabel}
        </span>
        <button
          type="button"
          aria-label="Move effect up"
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
          aria-label="Move effect down"
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
          aria-label="Remove effect"
          onClick={onRemove}
        >
          <Icon name="X" label={undefined} size="0.85em" />
        </button>
      </div>

      {type && expanded && (
        <div id={paramsId}>
          <EffectParams type={type} nodes={rowNodes} index={index} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function getEffectColor(e: Effect): ManagedColor | undefined {
  if (e.type === 'dropShadow' || e.type === 'innerShadow') return e.color;
  if (e.type === 'outerGlow' || e.type === 'innerGlow') return e.color;
  return undefined;
}

function setEffectColor(e: Effect, color: ManagedColor): Effect {
  if (e.type === 'dropShadow' || e.type === 'innerShadow') return { ...e, color };
  if (e.type === 'outerGlow' || e.type === 'innerGlow') return { ...e, color };
  return e;
}

function EffectColorSwatch({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();
  const colorRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e) return getEffectColor(e);
    return { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };
  });
  const color = isMixed(colorRaw) ? null : colorRaw;
  const swatchBg = color ? toSwatchBg(color) : 'transparent';

  return (
    <InspectorColorPopover
      label="Effect colour"
      value={color ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }}
      onChange={(c) => onChange((e) => setEffectColor(e, c as ManagedColor))}
      swatchStyle={{ background: swatchBg }}
      documentColorMode={documentColorMode}
      onEditStart={beginTransaction}
      onEditEnd={commitTransaction}
    />
  );
}

function LinkedChannelOffsets({
  value,
  onChange,
}: {
  value: ChannelOffset;
  onChange: (v: ChannelOffset) => void;
}) {
  const [linked, setLinked] = useState(true);
  const baselineRef = useRef(value);
  const maxOffset = useMemo(() => {
    const vals = [value.redX, value.redY, value.greenX, value.greenY, value.blueX, value.blueY];
    return Math.max(...vals.map(Math.abs));
  }, [value]);
  return (
    <div className="insp-effect-params">
      <button
        type="button"
        className={`insp-toggle-btn${linked ? ' --active' : ''}`}
        aria-label="Link channel offsets"
        aria-pressed={linked}
        onClick={() => {
          if (!linked) baselineRef.current = value;
          setLinked(!linked);
        }}
      >
        {linked ? 'Linked' : 'Independent'}
      </button>
      {linked ? (
        <NumberField
          label="Offset"
          value={maxOffset}
          step={0.5}
          min={0}
          max={100}
          onChange={(v) => {
            // Linked mode scales a captured vector instead of replacing X and
            // Y with one signed scalar. This keeps diagonal direction,
            // proportions, and zero axes intact, and avoids cumulative drift.
            const baseline = baselineRef.current;
            const baselineMax = Math.max(
              Math.abs(baseline.redX),
              Math.abs(baseline.redY),
              Math.abs(baseline.greenX),
              Math.abs(baseline.greenY),
              Math.abs(baseline.blueX),
              Math.abs(baseline.blueY),
            );
            const scale = baselineMax > 0 ? v / baselineMax : 0;
            onChange({
              redX: baseline.redX * scale,
              redY: baseline.redY * scale,
              greenX: baseline.greenX * scale,
              greenY: baseline.greenY * scale,
              blueX: baseline.blueX * scale,
              blueY: baseline.blueY * scale,
            });
          }}
        />
      ) : (
        <>
          <FieldRow label="Red">
            <NumberField
              label="X"
              value={value.redX}
              step={0.5}
              min={-100}
              max={100}
              onChange={(v) => onChange({ ...value, redX: v })}
            />
            <NumberField
              label="Y"
              value={value.redY}
              step={0.5}
              min={-100}
              max={100}
              onChange={(v) => onChange({ ...value, redY: v })}
            />
          </FieldRow>
          <FieldRow label="Green">
            <NumberField
              label="X"
              value={value.greenX}
              step={0.5}
              min={-100}
              max={100}
              onChange={(v) => onChange({ ...value, greenX: v })}
            />
            <NumberField
              label="Y"
              value={value.greenY}
              step={0.5}
              min={-100}
              max={100}
              onChange={(v) => onChange({ ...value, greenY: v })}
            />
          </FieldRow>
          <FieldRow label="Blue">
            <NumberField
              label="X"
              value={value.blueX}
              step={0.5}
              min={-100}
              max={100}
              onChange={(v) => onChange({ ...value, blueX: v })}
            />
            <NumberField
              label="Y"
              value={value.blueY}
              step={0.5}
              min={-100}
              max={100}
              onChange={(v) => onChange({ ...value, blueY: v })}
            />
          </FieldRow>
        </>
      )}
    </div>
  );
}

const DEFAULT_CHROMATIC_CHANNEL_COLORS: ChannelColors = {
  red: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
  green: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
  blue: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
};

const CHROMATIC_SOURCE_OPTIONS: { value: ChromaticChannelSource; label: string }[] = [
  { value: 'red', label: 'Red signal' },
  { value: 'green', label: 'Green signal' },
  { value: 'blue', label: 'Blue signal' },
  { value: 'luminance', label: 'Luminance' },
  { value: 'alpha', label: 'Glyph / alpha coverage' },
];

function defaultChromaticContributions(
  effect: Extract<Effect, { type: 'chromaticAberration' }>,
): ChromaticContribution[] {
  return [
    {
      id: 'red',
      enabled: true,
      source: 'red',
      color: effect.channelColors?.red ?? DEFAULT_CHROMATIC_CHANNEL_COLORS.red,
      strength: 1,
      x: effect.offsets.redX,
      y: effect.offsets.redY,
    },
    {
      id: 'green',
      enabled: true,
      source: 'green',
      color: effect.channelColors?.green ?? DEFAULT_CHROMATIC_CHANNEL_COLORS.green,
      strength: 1,
      x: effect.offsets.greenX,
      y: effect.offsets.greenY,
    },
    {
      id: 'blue',
      enabled: true,
      source: 'blue',
      color: effect.channelColors?.blue ?? DEFAULT_CHROMATIC_CHANNEL_COLORS.blue,
      strength: 1,
      x: effect.offsets.blueX,
      y: effect.offsets.blueY,
    },
  ];
}

function ChromaticCustomChannels({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();
  const firstEffect = getEffect(nodes[0]!, index);
  const firstChromatic = firstEffect?.type === 'chromaticAberration' ? firstEffect : undefined;
  const contributions =
    firstChromatic?.customChannels ??
    (firstChromatic ? defaultChromaticContributions(firstChromatic) : []);
  const updateContribution = (contributionIndex: number, patch: Partial<ChromaticContribution>) => {
    onChange((effect) => {
      if (effect.type !== 'chromaticAberration') return effect;
      const current = effect.customChannels ?? defaultChromaticContributions(effect);
      return {
        ...effect,
        channelMode: 'custom',
        customChannels: current.map((entry, entryIndex) =>
          entryIndex === contributionIndex ? { ...entry, ...patch } : entry,
        ),
      };
    });
  };

  return (
    <div className="insp-effect-params">
      <p className="insp-help-text">
        Each contribution samples a source independently and paints it with its own output colour.
        Alpha coverage keeps black text and transparent artwork fringes usable.
      </p>
      {contributions.map((contribution, contributionIndex) => (
        <div key={contribution.id ?? contributionIndex} className="insp-effect-params">
          <FieldRow label={`Contribution ${contributionIndex + 1}`}>
            <button
              type="button"
              className={`insp-toggle-btn${contribution.enabled ? ' --active' : ''}`}
              aria-pressed={contribution.enabled}
              onClick={() =>
                updateContribution(contributionIndex, { enabled: !contribution.enabled })
              }
            >
              {contribution.enabled ? 'On' : 'Off'}
            </button>
            <Select
              label={`Contribution ${contributionIndex + 1} source`}
              value={contribution.source}
              options={CHROMATIC_SOURCE_OPTIONS}
              onChange={(source) =>
                updateContribution(contributionIndex, { source: source as ChromaticChannelSource })
              }
            />
            <InspectorColorPopover
              label={`Contribution ${contributionIndex + 1} output colour`}
              tooltipLabel={`Contribution ${contributionIndex + 1} output colour`}
              value={contribution.color}
              onChange={(color) => updateContribution(contributionIndex, { color })}
              swatchStyle={{ background: toSwatchBg(contribution.color) }}
              documentColorMode={documentColorMode}
              onEditStart={beginTransaction}
              onEditEnd={commitTransaction}
            />
          </FieldRow>
          <InspectorFieldGroup columns={3}>
            <NumberField
              label="Strength"
              value={contribution.strength}
              min={0}
              max={2}
              step={0.05}
              onChange={(strength) => updateContribution(contributionIndex, { strength })}
            />
            <NumberField
              label="X"
              value={contribution.x}
              step={0.5}
              onChange={(x) => updateContribution(contributionIndex, { x })}
            />
            <NumberField
              label="Y"
              value={contribution.y}
              step={0.5}
              onChange={(y) => updateContribution(contributionIndex, { y })}
            />
          </InspectorFieldGroup>
        </div>
      ))}
    </div>
  );
}

function ChromaticAberrationParams({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const intensityRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'chromaticAberration') return e.intensity;
    return 1;
  });
  const opacityRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'chromaticAberration') return e.opacity;
    return 1;
  });
  const mixRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    return e?.type === 'chromaticAberration' ? (e.mix ?? 1) : 1;
  });
  const modeRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    return e?.type === 'chromaticAberration'
      ? (e.channelMode ?? (e.customChannels ? 'custom' : 'rgb'))
      : 'rgb';
  });
  const blendRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'chromaticAberration') return e.blendMode;
    return 'normal';
  });
  const offsetsRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'chromaticAberration') return e.offsets;
    return null;
  });
  const offsets = offsetsRaw && !isMixed(offsetsRaw) ? offsetsRaw : null;

  return (
    <div className="insp-effect-params">
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Intensity"
          value={isMixed(intensityRaw) ? 1 : intensityRaw}
          mixed={isMixed(intensityRaw)}
          step={0.1}
          min={0}
          max={10}
          onChange={(v) =>
            onChange((e) => (e.type === 'chromaticAberration' ? { ...e, intensity: v } : e))
          }
        />
        <NumberField
          label="Opacity"
          value={isMixed(opacityRaw) ? 1 : opacityRaw}
          mixed={isMixed(opacityRaw)}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) =>
            onChange((e) => (e.type === 'chromaticAberration' ? { ...e, opacity: v } : e))
          }
        />
        <NumberField
          label="Mix"
          value={isMixed(mixRaw) ? 1 : mixRaw}
          mixed={isMixed(mixRaw)}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) =>
            onChange((e) => (e.type === 'chromaticAberration' ? { ...e, mix: v } : e))
          }
        />
      </InspectorFieldGroup>
      <FieldRow label="Channel mode">
        <Select
          label="Chromatic channel mode"
          value={isMixed(modeRaw) ? '' : (modeRaw as string)}
          options={[
            ...(isMixed(modeRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            { value: 'rgb', label: 'RGB split' },
            { value: 'custom', label: 'Custom colour split' },
          ]}
          onChange={(mode) => {
            if (!mode) return;
            onChange((effect) => {
              if (effect.type !== 'chromaticAberration') return effect;
              if (mode === 'custom') {
                return {
                  ...effect,
                  channelMode: 'custom',
                  customChannels: effect.customChannels ?? defaultChromaticContributions(effect),
                };
              }
              return { ...effect, channelMode: 'rgb' };
            });
          }}
          placeholder="Mixed"
        />
      </FieldRow>
      <FieldRow label="Blend">
        <Select
          label="Aberration blend mode"
          value={isMixed(blendRaw) ? '' : (blendRaw as string)}
          options={[
            ...(isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            ...BLEND_OPTIONS,
          ]}
          onChange={(v) => {
            if (!v) return;
            onChange((e) =>
              e.type === 'chromaticAberration' ? { ...e, blendMode: v as BlendMode } : e,
            );
          }}
          placeholder="Mixed"
        />
      </FieldRow>
      {offsets && (
        <LinkedChannelOffsets
          value={offsets}
          onChange={(v) =>
            onChange((e) => (e.type === 'chromaticAberration' ? { ...e, offsets: v } : e))
          }
        />
      )}
      {modeRaw === 'custom' && (
        <ChromaticCustomChannels nodes={nodes} index={index} onChange={onChange} />
      )}
    </div>
  );
}

function GlitchDisplacementParams({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const blockStrengthRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    return e?.type === 'glitch' ? e.blockStrength : 10;
  });
  const modeRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    return e?.type === 'glitch' ? e.channelShiftMode : 'static';
  });
  const channelValue = (key: keyof ChannelOffset): MaybeMixed<number> =>
    commonValue<number>(nodes, (n) => {
      const e = getEffect(n, index);
      return e?.type === 'glitch' ? e.channelShift[key] : 0;
    });
  const updateChannel = (key: keyof ChannelOffset, value: number): void => {
    onChange((effect) =>
      effect.type === 'glitch'
        ? { ...effect, channelShift: { ...effect.channelShift, [key]: value } }
        : effect,
    );
  };

  return (
    <>
      <NumberField
        label="Block Strength"
        value={isMixed(blockStrengthRaw) ? 10 : blockStrengthRaw}
        mixed={isMixed(blockStrengthRaw)}
        step={1}
        min={0}
        max={200}
        onChange={(value) =>
          onChange((effect) =>
            effect.type === 'glitch' ? { ...effect, blockStrength: value } : effect,
          )
        }
      />
      <FieldRow label="Channel Shift">
        <Select
          label="Channel shift mode"
          value={isMixed(modeRaw) ? '' : modeRaw}
          options={[
            ...(isMixed(modeRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            { value: 'static', label: 'Static' },
            { value: 'seeded', label: 'Seeded' },
          ]}
          onChange={(value) => {
            if (!value) return;
            onChange((effect) =>
              effect.type === 'glitch'
                ? { ...effect, channelShiftMode: value as 'static' | 'seeded' }
                : effect,
            );
          }}
          placeholder="Mixed"
        />
      </FieldRow>
      {(
        [
          ['Red', 'redX', 'redY'],
          ['Green', 'greenX', 'greenY'],
          ['Blue', 'blueX', 'blueY'],
        ] as const
      ).map(([label, xKey, yKey]) => {
        const xRaw = channelValue(xKey);
        const yRaw = channelValue(yKey);
        return (
          <FieldRow key={label} label={label}>
            <NumberField
              label={`${label} X`}
              value={isMixed(xRaw) ? 0 : xRaw}
              mixed={isMixed(xRaw)}
              step={1}
              min={-200}
              max={200}
              onChange={(value) => updateChannel(xKey, value)}
            />
            <NumberField
              label={`${label} Y`}
              value={isMixed(yRaw) ? 0 : yRaw}
              mixed={isMixed(yRaw)}
              step={1}
              min={-200}
              max={200}
              onChange={(value) => updateChannel(yKey, value)}
            />
          </FieldRow>
        );
      })}
    </>
  );
}

function GlitchParams({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const strengthRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glitch') return e.strength;
    return 0;
  });
  const densityRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glitch') return e.density;
    return 0;
  });
  const seedRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glitch') return e.seed;
    return 42;
  });
  const opacityRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glitch') return e.opacity;
    return 1;
  });
  const dirRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glitch') return e.direction;
    return 'horizontal';
  });
  const blendRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    return e?.type === 'glitch' ? e.blendMode : 'normal';
  });

  return (
    <div className="insp-effect-params">
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Strength"
          value={isMixed(strengthRaw) ? 0 : strengthRaw}
          mixed={isMixed(strengthRaw)}
          step={1}
          min={0}
          max={200}
          onChange={(v) => onChange((e) => (e.type === 'glitch' ? { ...e, strength: v } : e))}
        />
        <NumberField
          label="Density"
          value={isMixed(densityRaw) ? 0 : densityRaw}
          mixed={isMixed(densityRaw)}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) => onChange((e) => (e.type === 'glitch' ? { ...e, density: v } : e))}
        />
      </InspectorFieldGroup>
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Seed"
          value={isMixed(seedRaw) ? 42 : seedRaw}
          mixed={isMixed(seedRaw)}
          step={1}
          min={0}
          max={999999}
          onChange={(v) => onChange((e) => (e.type === 'glitch' ? { ...e, seed: v } : e))}
        />
        <NumberField
          label="Opacity"
          value={isMixed(opacityRaw) ? 1 : opacityRaw}
          mixed={isMixed(opacityRaw)}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) => onChange((e) => (e.type === 'glitch' ? { ...e, opacity: v } : e))}
        />
      </InspectorFieldGroup>
      <FieldRow label="Direction">
        <Select
          label="Glitch direction"
          value={isMixed(dirRaw) ? '' : (dirRaw as string)}
          options={[
            ...(isMixed(dirRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            { value: 'horizontal', label: 'Horizontal' },
            { value: 'vertical', label: 'Vertical' },
            { value: 'both', label: 'Both' },
          ]}
          onChange={(v) => {
            if (!v) return;
            onChange((e) =>
              e.type === 'glitch'
                ? { ...e, direction: v as 'horizontal' | 'vertical' | 'both' }
                : e,
            );
          }}
          placeholder="Mixed"
        />
      </FieldRow>
      <FieldRow label="Blend">
        <Select
          label="Glitch blend mode"
          value={isMixed(blendRaw) ? '' : blendRaw}
          options={[
            ...(isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            ...BLEND_OPTIONS,
          ]}
          onChange={(value) => {
            if (!value) return;
            onChange((effect) =>
              effect.type === 'glitch' ? { ...effect, blendMode: value as BlendMode } : effect,
            );
          }}
          placeholder="Mixed"
        />
      </FieldRow>
      <button
        type="button"
        className="insp-inline-btn"
        style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--color-text-muted)' }}
        onClick={() => setAdvancedOpen(!advancedOpen)}
      >
        {advancedOpen ? 'Hide advanced' : 'Advanced...'}
      </button>
      {advancedOpen && (
        <div className="insp-effect-params">
          <NumberField
            label="Slice Height"
            value={
              isMixed(
                commonValue(nodes, (n) => {
                  const e = getEffect(n, index);
                  if (e && e.type === 'glitch') return e.sliceHeight;
                  return 8;
                }),
              )
                ? 8
                : (commonValue(nodes, (n) => {
                    const e = getEffect(n, index);
                    if (e && e.type === 'glitch') return e.sliceHeight;
                    return 8;
                  }) as number)
            }
            step={1}
            min={1}
            max={200}
            onChange={(v) => onChange((e) => (e.type === 'glitch' ? { ...e, sliceHeight: v } : e))}
          />
          <FieldRow label="Block">
            <NumberField
              label="Count"
              value={
                isMixed(
                  commonValue(nodes, (n) => {
                    const e = getEffect(n, index);
                    if (e && e.type === 'glitch') return e.blockCount;
                    return 0;
                  }),
                )
                  ? 0
                  : (commonValue(nodes, (n) => {
                      const e = getEffect(n, index);
                      if (e && e.type === 'glitch') return e.blockCount;
                      return 0;
                    }) as number)
              }
              step={1}
              min={0}
              max={100}
              onChange={(v) => onChange((e) => (e.type === 'glitch' ? { ...e, blockCount: v } : e))}
            />
            <NumberField
              label="Size"
              value={
                isMixed(
                  commonValue(nodes, (n) => {
                    const e = getEffect(n, index);
                    if (e && e.type === 'glitch') return e.blockSize;
                    return 20;
                  }),
                )
                  ? 20
                  : (commonValue(nodes, (n) => {
                      const e = getEffect(n, index);
                      if (e && e.type === 'glitch') return e.blockSize;
                      return 20;
                    }) as number)
              }
              step={1}
              min={1}
              max={200}
              onChange={(v) => onChange((e) => (e.type === 'glitch' ? { ...e, blockSize: v } : e))}
            />
          </FieldRow>
          <GlitchDisplacementParams nodes={nodes} index={index} onChange={onChange} />
          <FieldRow label="Noise">
            <NumberField
              label="Intensity"
              value={
                isMixed(
                  commonValue(nodes, (n) => {
                    const e = getEffect(n, index);
                    if (e && e.type === 'glitch') return e.noiseIntensity;
                    return 0;
                  }),
                )
                  ? 0
                  : (commonValue(nodes, (n) => {
                      const e = getEffect(n, index);
                      if (e && e.type === 'glitch') return e.noiseIntensity;
                      return 0;
                    }) as number)
              }
              step={0.01}
              min={0}
              max={1}
              onChange={(v) =>
                onChange((e) => (e.type === 'glitch' ? { ...e, noiseIntensity: v } : e))
              }
            />
          </FieldRow>
          <FieldRow label="Scanline">
            <NumberField
              label="Intensity"
              value={
                isMixed(
                  commonValue(nodes, (n) => {
                    const e = getEffect(n, index);
                    if (e && e.type === 'glitch') return e.scanlineIntensity;
                    return 0;
                  }),
                )
                  ? 0
                  : (commonValue(nodes, (n) => {
                      const e = getEffect(n, index);
                      if (e && e.type === 'glitch') return e.scanlineIntensity;
                      return 0;
                    }) as number)
              }
              step={0.01}
              min={0}
              max={1}
              onChange={(v) =>
                onChange((e) => (e.type === 'glitch' ? { ...e, scanlineIntensity: v } : e))
              }
            />
            <NumberField
              label="Spacing"
              value={
                isMixed(
                  commonValue(nodes, (n) => {
                    const e = getEffect(n, index);
                    if (e && e.type === 'glitch') return e.scanlineSpacing;
                    return 4;
                  }),
                )
                  ? 4
                  : (commonValue(nodes, (n) => {
                      const e = getEffect(n, index);
                      if (e && e.type === 'glitch') return e.scanlineSpacing;
                      return 4;
                    }) as number)
              }
              step={1}
              min={1}
              max={50}
              onChange={(v) =>
                onChange((e) => (e.type === 'glitch' ? { ...e, scanlineSpacing: v } : e))
              }
            />
          </FieldRow>
        </div>
      )}
    </div>
  );
}

function GlassTintSwatch({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();
  const tintRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glassMaterial') return e.tint;
    return { space: 'rgb' as const, r: 200, g: 220, b: 255, a: 60 };
  });
  const tint = isMixed(tintRaw) ? null : tintRaw;
  const swatchBg = tint ? toSwatchBg(tint) : 'transparent';

  return (
    <InspectorColorPopover
      label="Glass tint"
      value={tint ?? { space: 'rgb', r: 200, g: 220, b: 255, a: 60 }}
      onChange={(c) =>
        onChange((e) => (e.type === 'glassMaterial' ? { ...e, tint: c as ManagedColor } : e))
      }
      swatchStyle={{ background: swatchBg }}
      documentColorMode={documentColorMode}
      onEditStart={beginTransaction}
      onEditEnd={commitTransaction}
    />
  );
}

function EffectParams({
  type,
  nodes,
  index,
  onChange,
}: {
  type: Effect['type'];
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const maskControl = <EffectMaskControl nodes={nodes} index={index} />;
  switch (type) {
    case 'dropShadow':
    case 'innerShadow':
      return (
        <>
          {maskControl}
          <ShadowParams nodes={nodes} index={index} onChange={onChange} />
        </>
      );
    case 'outerGlow':
    case 'innerGlow':
      return (
        <>
          {maskControl}
          <GlowParams nodes={nodes} index={index} onChange={onChange} />
        </>
      );
    case 'layerBlur':
    case 'backgroundBlur':
      return (
        <>
          {maskControl}
          <SingleBlurParam nodes={nodes} index={index} onChange={onChange} />
        </>
      );
    case 'gaussianBlur':
    case 'fieldBlur':
    case 'irisBlur':
    case 'tiltShiftBlur':
    case 'pathBlur':
    case 'spinBlur':
      return (
        <>
          {maskControl}
          <SpatialBlurParams type={type} nodes={nodes} index={index} onChange={onChange} />
        </>
      );
    case 'depthBlur':
      return (
        <>
          {maskControl}
          <DepthBlurParams nodes={nodes} index={index} onChange={onChange} />
        </>
      );
    case 'glassMaterial':
      return (
        <>
          {maskControl}
          <GlassMaterialParams nodes={nodes} index={index} onChange={onChange} />
        </>
      );
    case 'chromaticAberration':
      return (
        <>
          {maskControl}
          <ChromaticAberrationParams nodes={nodes} index={index} onChange={onChange} />
        </>
      );
    case 'glitch':
      return (
        <>
          {maskControl}
          <GlitchParams nodes={nodes} index={index} onChange={onChange} />
        </>
      );
  }
}

function effectIdFor(node: EffectNode, index: number): string {
  return node.effects?.[index]?.id ?? `fx-${node.id}-${index + 1}`;
}

function EffectMaskControl({ nodes, index }: { nodes: EffectNode[]; index: number }) {
  const editor = useEditor();
  const document = editor.state?.document;
  const firstEffect = getEffect(nodes[0]!, index);
  const binding = firstEffect?.mask;
  const sourceId = binding?.source.kind === 'scene-node' ? binding.source.nodeId : '';
  const sourceCandidates = useMemo(() => {
    if (!document) return [];
    const selectedIds = new Set(nodes.map((node) => node.id));
    return Object.values(document.nodes)
      .filter((candidate) => !selectedIds.has(candidate.id) && canBeMatteSource(candidate))
      .map((candidate) => ({
        value: candidate.id,
        label: candidate.name ?? `${candidate.kind} ${candidate.id.slice(0, 6)}`,
      }));
  }, [document, nodes]);

  const updateBinding = useCallback(
    (next: EffectMaskBinding | null) => {
      if (!document) return;
      editor.beginTransaction();
      editor.updateDoc((doc) => {
        let nextDoc = doc;
        for (const node of nodes) {
          const currentIndex = matchingEffectIndex(
            node.effects ?? [],
            index,
            firstEffect,
            nodes[0]?.effects ?? [],
          );
          const current = currentIndex >= 0 ? node.effects?.[currentIndex] : undefined;
          if (!current) continue;
          const effectId = effectIdFor(node, currentIndex);
          if (!current.id) {
            nextDoc = {
              ...nextDoc,
              nodes: {
                ...nextDoc.nodes,
                [node.id]: {
                  ...nextDoc.nodes[node.id],
                  effects: (node.effects ?? []).map((effect, effectIndex) =>
                    effectIndex === currentIndex ? { ...effect, id: effectId } : effect,
                  ),
                } as EffectNode,
              },
            };
          }
          nextDoc = next
            ? setEffectMask(nextDoc, node.id, effectId, next)
            : removeEffectMask(nextDoc, node.id, effectId);
        }
        return nextDoc;
      });
      editor.commitTransaction();
      editor.announce(next ? 'Effect mask updated' : 'Effect mask removed');
    },
    [document, editor, firstEffect, index, nodes],
  );

  const selectSource = useCallback(
    (value: string) => {
      if (!value) {
        updateBinding(null);
        return;
      }
      updateBinding({
        source: { kind: 'scene-node', nodeId: value },
        type: binding?.type === 'luminance' ? 'luminance' : 'alpha',
        visible: binding?.visible !== false,
        inverted: binding?.inverted === true,
        density: binding?.density ?? 1,
        feather: binding?.feather ?? 0,
        linked: binding?.linked !== false,
        coordinateSpace: binding?.coordinateSpace ?? 'world',
      });
    },
    [binding, updateBinding],
  );

  const patchBinding = useCallback(
    (patch: Partial<EffectMaskBinding>) => {
      if (!binding) return;
      updateBinding({ ...binding, ...patch });
    },
    [binding, updateBinding],
  );

  return (
    <div className="insp-effect-params insp-effect-mask">
      <Select
        label="Effect mask source"
        value={sourceId}
        options={[
          { value: '', label: binding ? 'Remove effect mask' : 'No effect mask' },
          ...sourceCandidates,
        ]}
        onChange={selectSource}
      />
      {binding && (
        <>
          <FieldRow label="Mask type">
            <Select
              label="Effect mask type"
              value={binding.type}
              options={[
                { value: 'alpha', label: 'Alpha' },
                { value: 'luminance', label: 'Luminance' },
                { value: 'clip', label: 'Clip' },
              ]}
              onChange={(value) => patchBinding({ type: value as EffectMaskBinding['type'] })}
            />
          </FieldRow>
          <InspectorFieldGroup columns={2}>
            <NumberField
              label="Density"
              value={binding.density ?? 1}
              min={0}
              max={1}
              step={0.05}
              onChange={(value) => patchBinding({ density: value })}
            />
            <NumberField
              label="Feather"
              value={binding.feather ?? 0}
              min={0}
              step={1}
              onChange={(value) => patchBinding({ feather: value })}
            />
          </InspectorFieldGroup>
          <InspectorFieldGroup columns={2}>
            <button
              type="button"
              className={`insp-toggle-btn${binding.inverted ? ' --active' : ''}`}
              aria-pressed={binding.inverted === true}
              onClick={() => patchBinding({ inverted: !binding.inverted })}
            >
              {binding.inverted ? 'Inverted' : 'Normal'}
            </button>
            <Select
              label="Effect mask coordinates"
              value={binding.coordinateSpace}
              options={[
                { value: 'world', label: 'World' },
                { value: 'target-local', label: 'Target local' },
              ]}
              onChange={(value) =>
                patchBinding({ coordinateSpace: value as EffectMaskBinding['coordinateSpace'] })
              }
            />
          </InspectorFieldGroup>
        </>
      )}
    </div>
  );
}

function ShadowParams({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const xRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) return e.x;
    return 0;
  });
  const yRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) return e.y;
    return 0;
  });
  const angleRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) {
      if (e.x === 0 && e.y === 0) return 0;
      return (Math.atan2(e.y, e.x) * 180) / Math.PI;
    }
    return 0;
  });
  const distanceRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) {
      return Math.hypot(e.x, e.y);
    }
    return 0;
  });
  const blurRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) return e.blur;
    return 0;
  });
  const spreadRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) return e.spread;
    return 0;
  });
  const opacityRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) return e.opacity;
    return 1;
  });
  const blendRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) return e.blendMode;
    return 'normal';
  });

  return (
    <div className="insp-effect-params">
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="X"
          value={isMixed(xRaw) ? 0 : xRaw}
          mixed={isMixed(xRaw)}
          step={1}
          onChange={(v) =>
            onChange((e) =>
              e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, x: v } : e,
            )
          }
        />
        <NumberField
          label="Y"
          value={isMixed(yRaw) ? 0 : yRaw}
          mixed={isMixed(yRaw)}
          step={1}
          onChange={(v) =>
            onChange((e) =>
              e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, y: v } : e,
            )
          }
        />
      </InspectorFieldGroup>
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Angle"
          value={isMixed(angleRaw) ? 0 : angleRaw}
          mixed={isMixed(angleRaw)}
          step={1}
          onChange={(angle) =>
            onChange((e) => {
              if (e.type !== 'dropShadow' && e.type !== 'innerShadow') return e;
              const distance = Math.hypot(e.x, e.y);
              const radians = (angle * Math.PI) / 180;
              return { ...e, x: Math.cos(radians) * distance, y: Math.sin(radians) * distance };
            })
          }
        />
        <NumberField
          label="Distance"
          value={isMixed(distanceRaw) ? 0 : distanceRaw}
          mixed={isMixed(distanceRaw)}
          step={1}
          min={0}
          onChange={(distance) =>
            onChange((e) => {
              if (e.type !== 'dropShadow' && e.type !== 'innerShadow') return e;
              const angle = e.x === 0 && e.y === 0 ? 0 : Math.atan2(e.y, e.x);
              return { ...e, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
            })
          }
        />
      </InspectorFieldGroup>
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Blur"
          value={isMixed(blurRaw) ? 0 : blurRaw}
          mixed={isMixed(blurRaw)}
          step={1}
          min={0}
          onChange={(v) =>
            onChange((e) =>
              e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, blur: v } : e,
            )
          }
        />
        <NumberField
          label="Spread"
          value={isMixed(spreadRaw) ? 0 : spreadRaw}
          mixed={isMixed(spreadRaw)}
          step={1}
          min={-2048}
          onChange={(v) =>
            onChange((e) =>
              e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, spread: v } : e,
            )
          }
        />
      </InspectorFieldGroup>
      <NumberField
        label="Opacity"
        value={isMixed(opacityRaw) ? 1 : opacityRaw}
        mixed={isMixed(opacityRaw)}
        step={0.01}
        min={0}
        max={1}
        onChange={(v) =>
          onChange((e) =>
            e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, opacity: v } : e,
          )
        }
      />
      <FieldRow label="Blend">
        <Select
          label="Effect blend mode"
          value={isMixed(blendRaw) ? '' : (blendRaw as string)}
          options={[
            ...(isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            ...BLEND_OPTIONS,
          ]}
          onChange={(v) => {
            if (!v) return;
            const mode = v as BlendMode;
            onChange((eff) =>
              eff.type === 'dropShadow' || eff.type === 'innerShadow'
                ? { ...eff, blendMode: mode }
                : eff,
            );
          }}
          placeholder="Mixed"
        />
      </FieldRow>
    </div>
  );
}

function glowGradientFor(nodes: EffectNode[], index: number): EffectGradient {
  const effect = getEffect(nodes[0]!, index);
  if (effect?.type === 'outerGlow' || effect?.type === 'innerGlow') {
    if (effect.gradient?.stops && effect.gradient.stops.length >= 2) return effect.gradient;
    return {
      stops: [
        { position: 0, color: effect.color },
        {
          position: 1,
          color: effect.color.space === 'rgb' ? { ...effect.color, a: 0 } : effect.color,
        },
      ],
    };
  }
  const fallback = { space: 'rgb' as const, r: 255, g: 200, b: 100, a: 255 };
  return {
    stops: [
      { position: 0, color: fallback },
      { position: 1, color: fallback },
    ],
  };
}

function updateGlowGradientStop(e: Effect, index: number, color: ManagedColor): Effect {
  if (e.type !== 'outerGlow' && e.type !== 'innerGlow') return e;
  const gradient = e.gradient ?? {
    stops: [
      { position: 0, color: e.color },
      {
        position: 1,
        color: e.color.space === 'rgb' ? { ...e.color, a: 0 } : e.color,
      },
    ],
  };
  const stops = gradient.stops.map((stop, stopIndex) =>
    stopIndex === index ? { ...stop, color } : stop,
  );
  return { ...e, colorMode: 'gradient', color: stops[0]!.color, gradient: { stops } };
}

function GlowParams({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();
  const blurRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.blur;
    return 0;
  });
  const spreadRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.spread;
    return 0;
  });
  const chokeRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.choke ?? 0;
    return 0;
  });
  const contourRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.contour ?? 'smooth';
    return 'smooth';
  });
  const originRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e?.type === 'innerGlow') return e.origin ?? 'edge';
    return 'edge';
  });
  const isInnerGlow = getEffect(nodes[0]!, index)?.type === 'innerGlow';
  const colorModeRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e?.type === 'outerGlow' || e?.type === 'innerGlow') return e.colorMode ?? 'solid';
    return 'solid';
  });
  const opacityRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.opacity;
    return 1;
  });
  const blendRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.blendMode;
    return 'normal';
  });
  return (
    <div className="insp-effect-params">
      <Select
        label="Glow color treatment"
        value={isMixed(colorModeRaw) ? '' : (colorModeRaw as string)}
        options={[
          ...(isMixed(colorModeRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
          { value: 'solid', label: 'Solid' },
          { value: 'gradient', label: 'Gradient' },
        ]}
        onChange={(value) => {
          if (!value) return;
          onChange((e) => {
            if (e.type !== 'outerGlow' && e.type !== 'innerGlow') return e;
            if (value !== 'gradient') return { ...e, colorMode: 'solid' };
            const stops = e.gradient?.stops?.length
              ? e.gradient.stops
              : [
                  { position: 0, color: e.color },
                  {
                    position: 1,
                    color: e.color.space === 'rgb' ? { ...e.color, a: 0 } : e.color,
                  },
                ];
            return {
              ...e,
              colorMode: 'gradient',
              gradient: { stops },
            };
          });
        }}
      />
      {colorModeRaw === 'gradient' && (
        <FieldRow label="Gradient colors">
          <InspectorColorPopover
            label="Glow gradient start"
            value={glowGradientFor(nodes, index).stops[0]!.color}
            onChange={(color) =>
              onChange((e) => updateGlowGradientStop(e, 0, color as ManagedColor))
            }
            swatchStyle={{ background: toSwatchBg(glowGradientFor(nodes, index).stops[0]!.color) }}
            documentColorMode={documentColorMode}
            onEditStart={beginTransaction}
            onEditEnd={commitTransaction}
          />
          <InspectorColorPopover
            label="Glow gradient end"
            value={glowGradientFor(nodes, index).stops[1]!.color}
            onChange={(color) =>
              onChange((e) => updateGlowGradientStop(e, 1, color as ManagedColor))
            }
            swatchStyle={{ background: toSwatchBg(glowGradientFor(nodes, index).stops[1]!.color) }}
            documentColorMode={documentColorMode}
            onEditStart={beginTransaction}
            onEditEnd={commitTransaction}
          />
        </FieldRow>
      )}
      <InspectorFieldGroup>
        <NumberField
          label="Blur"
          value={isMixed(blurRaw) ? 0 : blurRaw}
          mixed={isMixed(blurRaw)}
          step={1}
          min={0}
          onChange={(v) =>
            onChange((e) => {
              if (e.type === 'outerGlow' || e.type === 'innerGlow') return { ...e, blur: v };
              return e;
            })
          }
        />
      </InspectorFieldGroup>
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Choke"
          value={isMixed(chokeRaw) ? 0 : chokeRaw}
          mixed={isMixed(chokeRaw)}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) =>
            onChange((e) =>
              e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, choke: v } : e,
            )
          }
        />
        <Select
          label="Glow contour"
          value={isMixed(contourRaw) ? '' : (contourRaw as string)}
          options={[
            ...(isMixed(contourRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            { value: 'linear', label: 'Linear' },
            { value: 'smooth', label: 'Smooth' },
            { value: 'sharp', label: 'Sharp' },
          ]}
          onChange={(v) => {
            if (!v) return;
            onChange((e) =>
              e.type === 'outerGlow' || e.type === 'innerGlow'
                ? { ...e, contour: v as 'linear' | 'smooth' | 'sharp' }
                : e,
            );
          }}
        />
      </InspectorFieldGroup>
      {isInnerGlow && (
        <Select
          label="Inner glow origin"
          value={isMixed(originRaw) ? '' : (originRaw as string)}
          options={[
            ...(isMixed(originRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            { value: 'edge', label: 'Edge' },
            { value: 'center', label: 'Center' },
          ]}
          onChange={(v) => {
            if (!v) return;
            onChange((e) =>
              e.type === 'innerGlow' ? { ...e, origin: v as 'edge' | 'center' } : e,
            );
          }}
        />
      )}
      <InspectorFieldGroup>
        <NumberField
          label="Spread"
          value={isMixed(spreadRaw) ? 0 : spreadRaw}
          mixed={isMixed(spreadRaw)}
          step={1}
          min={-2048}
          onChange={(v) =>
            onChange((e) => {
              if (e.type === 'outerGlow' || e.type === 'innerGlow') return { ...e, spread: v };
              return e;
            })
          }
        />
      </InspectorFieldGroup>
      <InspectorFieldGroup columns={2}>
        <span className="insp-label" style={{ fontSize: 'var(--font-size-2xs)' }}>
          Opacity
        </span>
        <NumberField
          label=""
          value={isMixed(opacityRaw) ? 0 : opacityRaw}
          mixed={isMixed(opacityRaw)}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) =>
            onChange((e) => {
              if (e.type === 'outerGlow' || e.type === 'innerGlow') return { ...e, opacity: v };
              return e;
            })
          }
        />
      </InspectorFieldGroup>
      <InspectorFieldGroup columns={2}>
        <span className="insp-label" style={{ fontSize: 'var(--font-size-2xs)' }}>
          Blend
        </span>
        <Select
          label="Glow blend mode"
          value={isMixed(blendRaw) ? '' : (blendRaw as string)}
          options={[
            ...(isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            ...BLEND_OPTIONS,
          ]}
          onChange={(v) => {
            if (!v) return;
            const mode = v as BlendMode;
            onChange((effect) => {
              if (effect.type === 'outerGlow' || effect.type === 'innerGlow')
                return { ...effect, blendMode: mode };
              return effect;
            });
          }}
          placeholder="Mixed"
        />
      </InspectorFieldGroup>
    </div>
  );
}

function SingleBlurParam({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const radiusRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'layerBlur' || e.type === 'backgroundBlur')) return e.radius;
    return 0;
  });

  return (
    <div style={{ paddingLeft: 'var(--space-2)' }}>
      <NumberField
        label="Radius"
        value={isMixed(radiusRaw) ? 0 : radiusRaw}
        mixed={isMixed(radiusRaw)}
        step={1}
        min={0}
        onChange={(v) =>
          onChange((e) =>
            e.type === 'layerBlur' || e.type === 'backgroundBlur' ? { ...e, radius: v } : e,
          )
        }
      />
    </div>
  );
}

type SpatialBlurType =
  | 'gaussianBlur'
  | 'fieldBlur'
  | 'irisBlur'
  | 'tiltShiftBlur'
  | 'pathBlur'
  | 'spinBlur';

function SpatialBlurParams({
  type,
  nodes,
  index,
  onChange,
}: {
  type: SpatialBlurType;
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const effect = getEffect(nodes[0]!, index);
  const numeric = (fallback: number, read: (candidate: Effect) => number): number => {
    const value = effect ? read(effect) : fallback;
    return Number.isFinite(value) ? value : fallback;
  };

  if (type === 'gaussianBlur') {
    const sigmaX = numeric(4, (candidate) => (candidate.type === type ? candidate.sigmaX : 4));
    const sigmaY = numeric(4, (candidate) => (candidate.type === type ? candidate.sigmaY : 4));
    return (
      <div className="insp-effect-params">
        <InspectorFieldGroup columns={2}>
          <NumberField
            label="Sigma X"
            value={sigmaX}
            min={0}
            max={4096}
            step={0.5}
            unit="px"
            onChange={(value) =>
              onChange((candidate) =>
                candidate.type === type
                  ? {
                      ...candidate,
                      sigmaX: value,
                      ...(candidate.linkedAxes ? { sigmaY: value } : {}),
                    }
                  : candidate,
              )
            }
          />
          <NumberField
            label="Sigma Y"
            value={sigmaY}
            min={0}
            max={4096}
            step={0.5}
            unit="px"
            onChange={(value) =>
              onChange((candidate) =>
                candidate.type === type ? { ...candidate, sigmaY: value } : candidate,
              )
            }
          />
        </InspectorFieldGroup>
        <p className="insp-help-text">
          Linear-light, premultiplied Gaussian reference blur. Radius is 3σ.
        </p>
      </div>
    );
  }

  if (type === 'fieldBlur') {
    const radius = numeric(12, (candidate) =>
      candidate.type === type ? Math.max(0, ...candidate.pins.map((pin) => pin.radius)) : 12,
    );
    return (
      <div className="insp-effect-params">
        <NumberField
          label="Maximum pin blur"
          value={radius}
          min={0}
          max={4096}
          step={1}
          unit="px"
          onChange={(value) =>
            onChange((candidate) =>
              candidate.type === type
                ? {
                    ...candidate,
                    maxRadius: value,
                    pins: candidate.pins.map((pin) => ({ ...pin, radius: value })),
                  }
                : candidate,
            )
          }
        />
        <p className="insp-help-text">
          Add and move value pins on canvas when the spatial editor is active. Pin interpolation is
          inverse-distance and bounded.
        </p>
      </div>
    );
  }

  if (type === 'irisBlur' || type === 'tiltShiftBlur') {
    const amount = numeric(24, (candidate) =>
      type === 'irisBlur' && candidate.type === 'irisBlur'
        ? Math.max(0, ...candidate.regions.map((region) => region.amount))
        : type === 'tiltShiftBlur' && candidate.type === 'tiltShiftBlur'
          ? Math.max(0, ...candidate.regions.map((region) => region.amount))
          : 24,
    );
    const feather = numeric(35, (candidate) =>
      type === 'irisBlur' && candidate.type === 'irisBlur'
        ? Math.max(0, ...candidate.regions.map((region) => region.feather)) * 100
        : type === 'tiltShiftBlur' && candidate.type === 'tiltShiftBlur'
          ? Math.max(0, ...candidate.regions.map((region) => region.feather))
          : 35,
    );
    return (
      <div className="insp-effect-params">
        <InspectorFieldGroup columns={2}>
          <NumberField
            label="Maximum blur"
            value={amount}
            min={0}
            max={4096}
            step={1}
            unit="px"
            onChange={(value) =>
              onChange((candidate) => {
                if (type === 'irisBlur' && candidate.type === 'irisBlur') {
                  return {
                    ...candidate,
                    regions: candidate.regions.map((region) => ({ ...region, amount: value })),
                  };
                }
                if (type === 'tiltShiftBlur' && candidate.type === 'tiltShiftBlur') {
                  return {
                    ...candidate,
                    regions: candidate.regions.map((region) => ({ ...region, amount: value })),
                  };
                }
                return candidate;
              })
            }
          />
          <NumberField
            label="Feather"
            value={feather}
            min={0}
            max={type === 'irisBlur' ? 100 : 4096}
            step={1}
            unit={type === 'irisBlur' ? '%' : 'px'}
            onChange={(value) =>
              onChange((candidate) => {
                if (type === 'irisBlur' && candidate.type === 'irisBlur') {
                  return {
                    ...candidate,
                    regions: candidate.regions.map((region) => ({
                      ...region,
                      feather: value / 100,
                    })),
                  };
                }
                return type === 'tiltShiftBlur' && candidate.type === 'tiltShiftBlur'
                  ? {
                      ...candidate,
                      regions: candidate.regions.map((region) => ({ ...region, feather: value })),
                    }
                  : candidate;
              })
            }
          />
        </InspectorFieldGroup>
        <p className="insp-help-text">
          {type === 'irisBlur'
            ? 'A rotated elliptical focus region with a smooth outer falloff.'
            : 'An oriented sharp band with independent outer fade distance.'}
        </p>
      </div>
    );
  }

  if (type === 'pathBlur') {
    const amount = numeric(1, (candidate) => (candidate.type === type ? candidate.amount : 1));
    const samples = numeric(16, (candidate) => (candidate.type === type ? candidate.samples : 16));
    return (
      <div className="insp-effect-params">
        <InspectorFieldGroup columns={2}>
          <NumberField
            label="Motion amount"
            value={amount}
            min={0}
            max={4096}
            step={0.1}
            unit="x"
            onChange={(value) =>
              onChange((candidate) =>
                candidate.type === type ? { ...candidate, amount: value } : candidate,
              )
            }
          />
          <NumberField
            label="Samples"
            value={samples}
            min={1}
            max={64}
            step={1}
            onChange={(value) =>
              onChange((candidate) =>
                candidate.type === type ? { ...candidate, samples: value } : candidate,
              )
            }
          />
        </InspectorFieldGroup>
        <p className="insp-help-text">
          Samples the authored path by arc length; curved paths are not reduced to one directional
          vector.
        </p>
      </div>
    );
  }

  const angle = numeric(22.5, (candidate) =>
    candidate.type === type ? (candidate.angle * 180) / Math.PI : 22.5,
  );
  const amount = numeric(1, (candidate) => (candidate.type === type ? candidate.amount : 1));
  return (
    <div className="insp-effect-params">
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Angle"
          value={angle}
          min={-360}
          max={360}
          step={1}
          unit="°"
          onChange={(value) =>
            onChange((candidate) =>
              candidate.type === type
                ? { ...candidate, angle: (value * Math.PI) / 180 }
                : candidate,
            )
          }
        />
        <NumberField
          label="Motion amount"
          value={amount}
          min={0}
          max={4096}
          step={0.1}
          unit="x"
          onChange={(value) =>
            onChange((candidate) =>
              candidate.type === type ? { ...candidate, amount: value } : candidate,
            )
          }
        />
      </InspectorFieldGroup>
      <p className="insp-help-text">
        Angular samples are integrated around the saved pivot and clipped by the feathered ellipse.
      </p>
    </div>
  );
}

function DepthBlurParams({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const focusRaw = commonValue(nodes, (n) => {
    const effect = getEffect(n, index);
    return effect?.type === 'depthBlur' ? effect.focusDepth * 100 : 50;
  });
  const blurRaw = commonValue(nodes, (n) => {
    const effect = getEffect(n, index);
    return effect?.type === 'depthBlur' ? effect.blurStrength : 0;
  });
  const rangeRaw = commonValue(nodes, (n) => {
    const effect = getEffect(n, index);
    return effect?.type === 'depthBlur' ? effect.focusRange * 100 : 20;
  });
  const falloffRaw = commonValue(nodes, (n) => {
    const effect = getEffect(n, index);
    return effect?.type === 'depthBlur' ? effect.falloff * 100 : 100;
  });
  const edgeRaw = commonValue(nodes, (n) => {
    const effect = getEffect(n, index);
    return effect?.type === 'depthBlur' ? effect.edgeProtection * 100 : 3.5;
  });
  const invertRaw = commonValue(nodes, (n) => {
    const effect = getEffect(n, index);
    return effect?.type === 'depthBlur' ? effect.invert : false;
  });
  return (
    <div className="insp-effect-params">
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Focus depth"
          value={isMixed(focusRaw) ? 50 : focusRaw}
          mixed={isMixed(focusRaw)}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(value) =>
            onChange((effect) =>
              effect.type === 'depthBlur' ? { ...effect, focusDepth: value / 100 } : effect,
            )
          }
        />
        <NumberField
          label="Focus range"
          value={isMixed(rangeRaw) ? 20 : rangeRaw}
          mixed={isMixed(rangeRaw)}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(value) =>
            onChange((effect) =>
              effect.type === 'depthBlur' ? { ...effect, focusRange: value / 100 } : effect,
            )
          }
        />
      </InspectorFieldGroup>
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Blur strength"
          value={isMixed(blurRaw) ? 0 : blurRaw}
          mixed={isMixed(blurRaw)}
          min={0}
          max={4096}
          step={1}
          unit="px"
          onChange={(value) =>
            onChange((effect) =>
              effect.type === 'depthBlur' ? { ...effect, blurStrength: value } : effect,
            )
          }
        />
        <NumberField
          label="Falloff"
          value={isMixed(falloffRaw) ? 100 : falloffRaw}
          mixed={isMixed(falloffRaw)}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(value) =>
            onChange((effect) =>
              effect.type === 'depthBlur' ? { ...effect, falloff: value / 100 } : effect,
            )
          }
        />
      </InspectorFieldGroup>
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Edge protection"
          value={isMixed(edgeRaw) ? 3.5 : edgeRaw}
          mixed={isMixed(edgeRaw)}
          min={0}
          max={100}
          step={0.5}
          unit="%"
          onChange={(value) =>
            onChange((effect) =>
              effect.type === 'depthBlur' ? { ...effect, edgeProtection: value / 100 } : effect,
            )
          }
        />
        <button
          type="button"
          className={`insp-toggle-btn${isMixed(invertRaw) || invertRaw ? ' --active' : ''}`}
          aria-pressed={isMixed(invertRaw) ? 'mixed' : invertRaw}
          onClick={() =>
            onChange((effect) =>
              effect.type === 'depthBlur' ? { ...effect, invert: !effect.invert } : effect,
            )
          }
        >
          {isMixed(invertRaw) ? 'Mixed depth' : invertRaw ? 'Invert depth' : 'Normal depth'}
        </button>
      </InspectorFieldGroup>
    </div>
  );
}

function GlassMaterialParams({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const blurRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glassMaterial') return e.blur;
    return 0;
  });
  const tintOpacityRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glassMaterial') return e.tintOpacity;
    return 0;
  });
  const saturationRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glassMaterial') return e.saturation;
    return 1;
  });
  const brightnessRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glassMaterial') return e.brightness;
    return 1;
  });
  const noiseRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glassMaterial') return e.noise;
    return 0;
  });
  const edgeHighlightRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glassMaterial') return e.edgeHighlight;
    return false;
  });
  const edgeWidthRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glassMaterial') return e.edgeHighlightWidth;
    return 1;
  });

  return (
    <div className="insp-effect-params">
      <NumberField
        label="Blur"
        value={isMixed(blurRaw) ? 0 : blurRaw}
        mixed={isMixed(blurRaw)}
        step={1}
        min={0}
        onChange={(v) => onChange((e) => (e.type === 'glassMaterial' ? { ...e, blur: v } : e))}
      />
      <NumberField
        label="Tint"
        value={isMixed(tintOpacityRaw) ? 0 : tintOpacityRaw}
        mixed={isMixed(tintOpacityRaw)}
        step={0.01}
        min={0}
        max={1}
        onChange={(v) =>
          onChange((e) => (e.type === 'glassMaterial' ? { ...e, tintOpacity: v } : e))
        }
      />
      <NumberField
        label="Saturation"
        value={isMixed(saturationRaw) ? 1 : saturationRaw}
        mixed={isMixed(saturationRaw)}
        step={0.1}
        min={0}
        max={3}
        onChange={(v) =>
          onChange((e) => (e.type === 'glassMaterial' ? { ...e, saturation: v } : e))
        }
      />
      <NumberField
        label="Brightness"
        value={isMixed(brightnessRaw) ? 1 : brightnessRaw}
        mixed={isMixed(brightnessRaw)}
        step={0.05}
        min={0}
        max={3}
        onChange={(v) =>
          onChange((e) => (e.type === 'glassMaterial' ? { ...e, brightness: v } : e))
        }
      />
      <NumberField
        label="Noise"
        value={isMixed(noiseRaw) ? 0 : noiseRaw}
        mixed={isMixed(noiseRaw)}
        step={0.01}
        min={0}
        max={1}
        onChange={(v) => onChange((e) => (e.type === 'glassMaterial' ? { ...e, noise: v } : e))}
      />
      <InspectorFieldGroup columns={2}>
        <button
          type="button"
          className={`insp-toggle-btn${isMixed(edgeHighlightRaw) ? '' : edgeHighlightRaw ? ' --active' : ''}`}
          aria-label="Edge highlight"
          aria-pressed={isMixed(edgeHighlightRaw) ? 'mixed' : edgeHighlightRaw}
          onClick={() =>
            onChange((e) =>
              e.type === 'glassMaterial' ? { ...e, edgeHighlight: !e.edgeHighlight } : e,
            )
          }
        >
          {isMixed(edgeHighlightRaw) ? '—' : edgeHighlightRaw ? 'Edge On' : 'Edge Off'}
        </button>
        {isMixed(edgeHighlightRaw) || edgeHighlightRaw ? (
          <NumberField
            label="Width"
            value={isMixed(edgeWidthRaw) ? 1 : edgeWidthRaw}
            mixed={isMixed(edgeWidthRaw)}
            step={0.5}
            min={0}
            onChange={(v) =>
              onChange((e) => (e.type === 'glassMaterial' ? { ...e, edgeHighlightWidth: v } : e))
            }
          />
        ) : null}
      </InspectorFieldGroup>
      <GlassEdgeHighlightColor nodes={nodes} index={index} onChange={onChange} />
    </div>
  );
}

function GlassEdgeHighlightColor({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();
  const raw = commonValue(nodes, (n) => {
    const effect = getEffect(n, index);
    return effect?.type === 'glassMaterial'
      ? effect.edgeHighlightColor
      : ({ space: 'rgb', r: 255, g: 255, b: 255, a: 120 } as ManagedColor);
  });
  const color = isMixed(raw)
    ? ({ space: 'rgb', r: 255, g: 255, b: 255, a: 120 } as ManagedColor)
    : raw;
  return (
    <FieldRow label="Edge colour">
      <InspectorColorPopover
        label="Glass edge highlight colour"
        value={color}
        onChange={(next) =>
          onChange((effect) =>
            effect.type === 'glassMaterial' ? { ...effect, edgeHighlightColor: next } : effect,
          )
        }
        swatchStyle={{ background: toSwatchBg(color) }}
        documentColorMode={documentColorMode}
        onEditStart={beginTransaction}
        onEditEnd={commitTransaction}
      />
    </FieldRow>
  );
}
