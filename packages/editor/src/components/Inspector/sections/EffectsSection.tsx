/**
 * EffectsSection — stacked effect controls (shadows, blurs) for the Inspector.
 *
 * Multi-select: matches effects by index, shows "Mixed" for differing
 * properties. Property edits batch across all selected nodes in one undo step.
 *
 * Research basis: Figma / Sketch effects panel, APG Disclosure pattern.
 */
import type {
  BlendMode,
  Effect,
  FrameNode,
  ManagedColor,
  SceneNode,
  ShapeNode,
  TextNode,
} from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';
import { Icon } from '@strata/ui';
import { ColorPicker } from '@strata/ui/components/ColorPicker';
import { useCallback, useMemo, useRef, useState } from 'react';
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
  }
}

function toSwatchBg(color: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

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
      <div style={{ display: 'flex', gap: 'var(--space-1)', paddingTop: 'var(--space-1)' }}>
        <select
          aria-label="New effect type"
          value={newEffectType}
          className="insp-select"
          onChange={(e) => setNewEffectType(e.target.value as Effect['type'])}
        >
          {EFFECT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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
        {type && type !== 'layerBlur' && type !== 'backgroundBlur' && (
          <ShadowColorSwatch nodes={nodes} index={index} onChange={onChange} />
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

function ShadowColorSwatch({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const colorRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) return e.color;
    return { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };
  });
  const color = isMixed(colorRaw) ? null : colorRaw;
  const swatchBg = color ? toSwatchBg(color) : 'transparent';
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Effect colour"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="insp-swatch"
        style={{ background: swatchBg }}
      />
      {open && triggerRef.current && (
        <div
          role="dialog"
          aria-label="Pick effect colour"
          className="insp-picker-popover"
          style={{
            top: triggerRef.current.getBoundingClientRect().bottom + 4,
            left: triggerRef.current.getBoundingClientRect().left,
          }}
        >
          <ColorPicker
            value={color ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }}
            onChange={(c) =>
              onChange((e) =>
                e.type === 'dropShadow' || e.type === 'innerShadow'
                  ? { ...e, color: c as ManagedColor }
                  : e,
              )
            }
          />
          <button
            type="button"
            aria-label="Close colour picker"
            onClick={() => setOpen(false)}
            className="insp-picker-done"
          >
            Done
          </button>
        </div>
      )}
    </>
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
        <select
          aria-label="Effect blend mode"
          value={isMixed(blendRaw) ? '' : blendRaw}
          className="insp-select"
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
