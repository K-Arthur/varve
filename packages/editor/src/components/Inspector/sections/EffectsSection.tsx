/**
 * EffectsSection — stacked effect controls (shadows, blurs) for the Inspector.
 *
 * Multi-select: matches effects by index, shows "Mixed" for differing
 * properties. Property edits batch across all selected nodes in one undo step.
 *
 * Research basis: Figma / Sketch effects panel, APG Disclosure pattern.
 */
import type {
  AdjustmentNode,
  BlendMode,
  ChannelOffset,
  Effect,
  FrameNode,
  ManagedColor,
  SceneNode,
  ShapeNode,
  TextNode,
} from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';
import { Icon, Select } from '@strata/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed } from '../selection/selectionState';

export interface EffectsSectionProps {
  nodes: SceneNode[];
}

type EffectNode = ShapeNode | TextNode | FrameNode | AdjustmentNode;

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
  return (
    n.kind === 'shape' ||
    n.kind === 'text' ||
    n.kind === 'frame' ||
    n.kind === 'adjustment' ||
    n.kind === 'path'
  );
}

function getEffect(n: SceneNode, i: number): Effect | undefined {
  const sn = n as EffectNode;
  return sn.effects?.[i];
}

function defaultEffect(type: Effect['type']): Effect {
  switch (type) {
    case 'dropShadow':
      return {
        type,
        x: 0,
        y: 4,
        blur: 8,
        spread: 0,
        color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 76 },
        opacity: 0.3,
        blendMode: 'normal',
        visible: true,
      };
    case 'innerShadow':
      return {
        type,
        x: 0,
        y: 2,
        blur: 4,
        spread: 0,
        color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 38 },
        opacity: 0.25,
        blendMode: 'normal',
        visible: true,
      };
    case 'layerBlur':
      return { type, radius: 4, visible: true };
    case 'backgroundBlur':
      return { type, radius: 8, visible: true };
    case 'outerGlow':
      return {
        type,
        blur: 6,
        spread: 0,
        color: { space: 'rgb' as const, r: 255, g: 200, b: 100, a: 128 },
        opacity: 0.6,
        blendMode: 'screen',
        visible: true,
      };
    case 'innerGlow':
      return {
        type,
        blur: 6,
        spread: 0,
        color: { space: 'rgb' as const, r: 255, g: 200, b: 100, a: 128 },
        opacity: 0.6,
        blendMode: 'screen',
        visible: true,
      };
    case 'glassMaterial':
      return {
        type,
        blur: 12,
        tint: { space: 'rgb' as const, r: 200, g: 220, b: 255, a: 60 },
        tintOpacity: 0.3,
        saturation: 1.2,
        brightness: 1.05,
        noise: 0.02,
        edgeHighlight: true,
        edgeHighlightWidth: 1.5,
        edgeHighlightColor: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 120 },
        edgeHighlightOpacity: 0.4,
        visible: true,
      };
    case 'chromaticAberration':
      return {
        type,
        offsets: { redX: 3, redY: 0, greenX: 0, greenY: 0, blueX: -3, blueY: 0 },
        intensity: 1,
        blendMode: 'normal',
        opacity: 1,
        visible: true,
      };
    case 'glitch':
      return {
        type,
        seed: 42,
        strength: 8,
        density: 0.3,
        sliceHeight: 8,
        blockCount: 5,
        blockSize: 20,
        blockStrength: 10,
        noiseIntensity: 0.05,
        scanlineIntensity: 0.15,
        scanlineSpacing: 4,
        direction: 'horizontal',
        channelShift: { redX: 0, redY: 0, greenX: 0, greenY: 0, blueX: 0, blueY: 0 },
        channelShiftMode: 'static',
        blendMode: 'normal',
        opacity: 1,
        visible: true,
      };
  }
}

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
  { value: 'backgroundBlur', label: 'Background Blur' },
  { value: 'glassMaterial', label: 'Glass Material' },
  { value: 'chromaticAberration', label: 'Chromatic Aberration' },
  { value: 'glitch', label: 'Glitch' },
];

export function EffectsSection({ nodes }: EffectsSectionProps) {
  const { updateNode, beginTransaction, commitTransaction, announce } = useEditor();
  const [newEffectType, setNewEffectType] = useState<Effect['type']>('dropShadow');

  const effectNodes = useMemo(() => nodes.filter(hasEffects), [nodes]);

  const batchUpdate = useCallback(
    (updater: (effects: Effect[]) => Effect[]) => {
      beginTransaction();
      for (const node of effectNodes) {
        updateNode(node.id, (n) => {
          const sn = n as EffectNode;
          if (!sn.effects) return n;
          return { ...n, effects: updater(sn.effects) };
        });
      }
      commitTransaction();
    },
    [effectNodes, updateNode, beginTransaction, commitTransaction],
  );

  const updateEffect = useCallback(
    (index: number, updater: (e: Effect) => Effect) => {
      batchUpdate((effects) => {
        const next = [...effects];
        if (next[index]) {
          next[index] = updater(next[index] as Effect);
        }
        return next;
      });
    },
    [batchUpdate],
  );

  const addEffect = useCallback(() => {
    batchUpdate((effects) => [...effects, defaultEffect(newEffectType)]);
    announce('Effect added');
  }, [newEffectType, batchUpdate, announce]);

  const removeEffect = useCallback(
    (index: number) => {
      batchUpdate((effects) => effects.filter((_, i) => i !== index));
      announce('Effect removed');
    },
    [batchUpdate, announce],
  );

  const reorderEffect = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      batchUpdate((effects) => {
        if (from < 0 || from >= effects.length || to < 0 || to >= effects.length) return effects;
        const next = [...effects];
        const [item] = next.splice(from, 1);
        if (item) next.splice(to, 0, item);
        return next;
      });
    },
    [batchUpdate],
  );

  if (effectNodes.length === 0) return null;

  const minEffects = Math.min(...effectNodes.map((n) => n.effects.length));
  const countMixed = !effectNodes.every((n) => n.effects.length === minEffects);

  return (
    <DisclosureSection title="Effects">
      {effectNodes.every((n) => n.effects.length === 0) ? (
        <div className="insp-empty-message">No effects</div>
      ) : (
        Array.from({ length: minEffects }, (_, i) => (
          <EffectRow
            key={i}
            index={i}
            nodes={effectNodes}
            onChange={(updater) => updateEffect(i, updater)}
            onRemove={() => removeEffect(i)}
            onReorder={(dir: number) => reorderEffect(i, i + dir)}
            canMoveUp={i > 0}
            canMoveDown={i < minEffects - 1}
          />
        ))
      )}
      {countMixed && minEffects > 0 && (
        <div className="insp-empty-message">Some selected nodes have additional effects</div>
      )}
      <div className="insp-fill-add">
        <Select
          label="New effect type"
          value={newEffectType}
          options={EFFECT_TYPE_OPTIONS}
          onChange={(v) => setNewEffectType(v as Effect['type'])}
        />
        <button type="button" className="insp-add-btn" onClick={addEffect}>
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
  onReorder: (dir: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function EffectRow({
  index,
  nodes,
  onChange,
  onRemove,
  onReorder,
  canMoveUp,
  canMoveDown,
}: EffectRowProps) {
  const typeRaw = commonValue(nodes, (n) => getEffect(n, index)?.type ?? 'dropShadow');
  const visibleRaw = commonValue(nodes, (n) => getEffect(n, index)?.visible ?? true);

  const type = isMixed(typeRaw) ? null : typeRaw;
  const visibility = isMixed(visibleRaw) ? true : visibleRaw;

  const typeLabel = type ?? 'Mixed';

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
          aria-label={`${visibility ? 'Hide' : 'Show'} effect`}
          onClick={() => onChange((e) => ({ ...e, visible: !e.visible }))}
        >
          <Icon name={visibility ? 'Eye' : 'EyeOff'} label={undefined} size="0.85em" />
        </button>
        {type &&
          type !== 'layerBlur' &&
          type !== 'backgroundBlur' &&
          type !== 'glassMaterial' &&
          type !== 'chromaticAberration' &&
          type !== 'glitch' && (
            <EffectColorSwatch nodes={nodes} index={index} onChange={onChange} />
          )}
        {type === 'glassMaterial' && (
          <GlassTintSwatch nodes={nodes} index={index} onChange={onChange} />
        )}
        <span
          style={{ flex: 1, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
        >
          {typeLabel}
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

      {type && <EffectParams type={type} nodes={nodes} index={index} onChange={onChange} />}
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
  const { documentColorMode } = useEditor();
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
  const maxOffset = useMemo(() => {
    const vals = [value.redX, value.redY, value.greenX, value.greenY, value.blueX, value.blueY];
    return Math.max(...vals.map(Math.abs));
  }, [value]);
  return (
    <div
      style={{
        paddingLeft: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <button
        type="button"
        className={`insp-toggle-btn${linked ? ' --active' : ''}`}
        aria-label="Link channel offsets"
        aria-pressed={linked}
        onClick={() => setLinked(!linked)}
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
            const sign = (orig: number) => (orig < 0 ? -1 : orig > 0 ? 1 : 0);
            const sR = sign(value.redX || value.redY);
            const sG = sign(value.greenX || value.greenY);
            const sB = sign(value.blueX || value.blueY);
            onChange({
              redX: sR * v,
              redY: sR * v,
              greenX: sG * v,
              greenY: sG * v,
              blueX: sB * v,
              blueY: sB * v,
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
    <div
      style={{
        paddingLeft: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <div className="insp-field">
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
      </div>
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
    </div>
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

  return (
    <div
      style={{
        paddingLeft: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <div className="insp-field">
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
      </div>
      <div className="insp-field">
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
      </div>
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
      <button
        type="button"
        className="insp-inline-btn"
        style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--color-text-muted)' }}
        onClick={() => setAdvancedOpen(!advancedOpen)}
      >
        {advancedOpen ? 'Hide advanced' : 'Advanced...'}
      </button>
      {advancedOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
  const { documentColorMode } = useEditor();
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
  switch (type) {
    case 'dropShadow':
    case 'innerShadow':
      return <ShadowParams nodes={nodes} index={index} onChange={onChange} />;
    case 'outerGlow':
    case 'innerGlow':
      return <GlowParams nodes={nodes} index={index} onChange={onChange} />;
    case 'layerBlur':
    case 'backgroundBlur':
      return <SingleBlurParam nodes={nodes} index={index} onChange={onChange} />;
    case 'glassMaterial':
      return <GlassMaterialParams nodes={nodes} index={index} onChange={onChange} />;
    case 'chromaticAberration':
      return <ChromaticAberrationParams nodes={nodes} index={index} onChange={onChange} />;
    case 'glitch':
      return <GlitchParams nodes={nodes} index={index} onChange={onChange} />;
  }
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        paddingLeft: 'var(--space-2)',
      }}
    >
      <div className="insp-field">
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
      </div>
      <div className="insp-field">
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
          onChange={(v) =>
            onChange((e) =>
              e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, spread: v } : e,
            )
          }
        />
      </div>
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

function GlowParams({
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
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.blur;
    return 0;
  });
  const spreadRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.spread;
    return 0;
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        paddingLeft: 'var(--space-2)',
      }}
    >
      <div className="insp-field">
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
      </div>
      <div className="insp-field">
        <NumberField
          label="Spread"
          value={isMixed(spreadRaw) ? 0 : spreadRaw}
          mixed={isMixed(spreadRaw)}
          step={1}
          min={0}
          onChange={(v) =>
            onChange((e) => {
              if (e.type === 'outerGlow' || e.type === 'innerGlow') return { ...e, spread: v };
              return e;
            })
          }
        />
      </div>
      <div className="insp-field">
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
      </div>
      <div className="insp-field">
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
      </div>
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
    <div
      style={{
        paddingLeft: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
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
      <div className="insp-field">
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
      </div>
    </div>
  );
}
