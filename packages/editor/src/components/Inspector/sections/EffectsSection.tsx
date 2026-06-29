/**
 * EffectsSection — stacked effect controls (shadows, blurs) for the Inspector.
 *
 * Multi-select: matches effects by index, shows "Mixed" for differing
 * properties. Property edits batch across all selected nodes in one undo step.
 *
 * Research basis: Figma / Sketch effects panel, APG Disclosure pattern.
 */
import type { Color } from '@strata/engine';
import type { BlendMode, Effect, FrameNode, SceneNode, ShapeNode, TextNode } from '@strata/scene';
import { Icon } from '@strata/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed } from '../selection/selectionState';

export interface EffectsSectionProps {
  nodes: SceneNode[];
}

type EffectNode = ShapeNode | TextNode | FrameNode;

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
  return n.kind === 'shape' || n.kind === 'text' || n.kind === 'frame';
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
        color: [0, 0, 0, 76] as Color,
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
        color: [0, 0, 0, 38] as Color,
        opacity: 0.25,
        blendMode: 'normal',
        visible: true,
      };
    case 'layerBlur':
      return { type, radius: 4, visible: true };
    case 'backgroundBlur':
      return { type, radius: 8, visible: true };
  }
}

function toSwatchBg(color: Color): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${(color[3] / 255).toFixed(2)})`;
}

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  height: 'var(--space-5)',
  fontSize: 'var(--font-size-xs)',
  background: 'var(--color-surface-sunken)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-2)',
};

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

const EFFECT_TYPE_OPTIONS: { value: Effect['type']; label: string }[] = [
  { value: 'dropShadow', label: 'Drop Shadow' },
  { value: 'innerShadow', label: 'Inner Shadow' },
  { value: 'layerBlur', label: 'Layer Blur' },
  { value: 'backgroundBlur', label: 'Background Blur' },
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

  if (effectNodes.length === 0) return null;

  const minEffects = Math.min(...effectNodes.map((n) => n.effects.length));
  const countMixed = !effectNodes.every((n) => n.effects.length === minEffects);

  return (
    <DisclosureSection title="Effects">
      {effectNodes.every((n) => n.effects.length === 0) ? (
        <div
          style={{
            padding: 'var(--space-2) 0',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          No effects
        </div>
      ) : (
        Array.from({ length: minEffects }, (_, i) => (
          <EffectRow
            key={i}
            index={i}
            nodes={effectNodes}
            onChange={(updater) => updateEffect(i, updater)}
            onRemove={() => removeEffect(i)}
          />
        ))
      )}
      {countMixed && minEffects > 0 && (
        <div
          style={{
            padding: 'var(--space-1) 0',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          Some selected nodes have additional effects
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-1)', paddingTop: 'var(--space-1)' }}>
        <select
          aria-label="New effect type"
          value={newEffectType}
          style={{ ...SELECT_STYLE, flex: 1 }}
          onChange={(e) => setNewEffectType(e.target.value as Effect['type'])}
        >
          {EFFECT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button type="button" style={ADD_BTN} onClick={addEffect}>
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
}

function EffectRow({ index, nodes, onChange, onRemove }: EffectRowProps) {
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
          style={INLINE_BTN}
          aria-label={`${visibility ? 'Hide' : 'Show'} effect`}
          onClick={() => onChange((e) => ({ ...e, visible: !e.visible }))}
        >
          <Icon name={visibility ? 'Eye' : 'EyeOff'} label={undefined} size="0.85em" />
        </button>
        {type && type !== 'layerBlur' && type !== 'backgroundBlur' && (
          <ShadowColorSwatch nodes={nodes} index={index} />
        )}
        <span
          style={{ flex: 1, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
        >
          {typeLabel}
        </span>
        <button type="button" style={INLINE_BTN} aria-label="Remove effect" onClick={onRemove}>
          <Icon name="X" label={undefined} size="0.85em" />
        </button>
      </div>

      {type && <EffectParams type={type} nodes={nodes} index={index} onChange={onChange} />}
    </div>
  );
}

function ShadowColorSwatch({ nodes, index }: { nodes: EffectNode[]; index: number }) {
  const colorRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) return e.color;
    return [0, 0, 0, 255] as Color;
  });
  const color = isMixed(colorRaw) ? null : colorRaw;
  const swatchBg = color ? toSwatchBg(color) : 'transparent';

  return (
    <button
      type="button"
      aria-label="Effect colour"
      style={{ ...SWATCH_STYLE, background: swatchBg }}
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
    case 'layerBlur':
    case 'backgroundBlur':
      return <SingleBlurParam nodes={nodes} index={index} onChange={onChange} />;
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
      <div className="insp-field" style={{ gap: 'var(--space-1)' }}>
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
      <div className="insp-field" style={{ gap: 'var(--space-1)' }}>
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
        <select
          aria-label="Effect blend mode"
          value={isMixed(blendRaw) ? '' : blendRaw}
          style={SELECT_STYLE}
          onChange={(e) => {
            const v = e.target.value as BlendMode;
            onChange((eff) =>
              eff.type === 'dropShadow' || eff.type === 'innerShadow'
                ? { ...eff, blendMode: v }
                : eff,
            );
          }}
        >
          {isMixed(blendRaw) && <option value="">Mixed</option>}
          {BLEND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldRow>
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
