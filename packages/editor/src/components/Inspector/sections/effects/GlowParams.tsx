/**
 * GlowParams — unified glow editor for outerGlow and innerGlow effects.
 * Supports solid and gradient modes, choke/spread tuning, contour shaping,
 * and origin selection with live preview.
 */
import type { BlendMode, Effect, EffectGradient, ManagedColor } from '@varve/scene';
import { Select } from '@varve/ui';
import { useEditor } from '../../../../context';
import { groupBlendOptions } from '../../controls/blendModeOptionGroups';
import { FieldRow, InspectorFieldGroup } from '../../controls/FieldRow';
import { InspectorColorPopover } from '../../controls/InspectorColorPopover';
import { NumberField } from '../../controls/NumberField';
import { commonValue, isMixed } from '../../selection/selectionState';
import { EffectPreviewTile } from './EffectPreviewTile';
import { BLEND_OPTIONS, type EffectNode, getEffect, toSwatchBg } from './EffectTypes';

interface GlowParamsProps {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}

type GlowContour = 'linear' | 'smooth' | 'sharp';
type InnerGlowOrigin = 'edge' | 'center';

const COLOR_TREATMENT_OPTIONS = [
  { value: 'solid', label: 'Solid colour' },
  { value: 'gradient', label: 'Gradient ramp' },
];

const CONTOUR_OPTIONS: { value: GlowContour; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Soft gaussian' },
  { value: 'sharp', label: 'Sharp edge' },
];

const ORIGIN_OPTIONS: { value: InnerGlowOrigin; label: string }[] = [
  { value: 'edge', label: 'From edge' },
  { value: 'center', label: 'From center' },
];

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

export function GlowParams({ nodes, index, onChange }: GlowParamsProps) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();

  const firstEffect = getEffect(nodes[0]!, index);
  const currentEffect =
    firstEffect && (firstEffect.type === 'outerGlow' || firstEffect.type === 'innerGlow')
      ? firstEffect
      : undefined;

  const colorRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.color;
    return { space: 'rgb' as const, r: 255, g: 200, b: 100, a: 255 };
  });
  const colorModeRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.colorMode ?? 'solid';
    return 'solid';
  });
  const opacityRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.opacity ?? 1;
    return 1;
  });
  const spreadRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.spread ?? 8;
    return 8;
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
    if (e && e.type === 'innerGlow') return e.origin ?? 'edge';
    return 'edge';
  });
  const blendRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'outerGlow' || e.type === 'innerGlow')) return e.blendMode ?? 'screen';
    return 'screen';
  });

  const colorVal = isMixed(colorRaw)
    ? { space: 'rgb' as const, r: 255, g: 200, b: 100, a: 255 }
    : colorRaw;

  return (
    <div className="insp-effect-params">
      <EffectPreviewTile
        effect={currentEffect}
        label={currentEffect?.type === 'innerGlow' ? 'Inner Glow' : 'Outer Glow'}
      />

      <FieldRow label="Color treatment">
        <Select
          label="Glow color treatment"
          value={isMixed(colorModeRaw) ? '' : colorModeRaw}
          options={COLOR_TREATMENT_OPTIONS}
          onChange={(mode) => {
            onChange((e) => {
              if (e.type !== 'outerGlow' && e.type !== 'innerGlow') return e;
              if (mode === 'gradient') {
                return {
                  ...e,
                  colorMode: 'gradient',
                  gradient: glowGradientFor(nodes, index),
                };
              }
              return { ...e, colorMode: 'solid' };
            });
          }}
        />
      </FieldRow>

      {colorModeRaw === 'solid' && (
        <FieldRow label="Colour & Opacity">
          <InspectorColorPopover
            label="Glow colour"
            className="insp-swatch insp-swatch--round"
            value={colorVal}
            onChange={(c) =>
              onChange((e) =>
                e.type === 'outerGlow' || e.type === 'innerGlow'
                  ? { ...e, color: c as ManagedColor }
                  : e,
              )
            }
            swatchStyle={{ background: toSwatchBg(colorVal) }}
            documentColorMode={documentColorMode}
            onEditStart={beginTransaction}
            onEditEnd={commitTransaction}
          />
          <NumberField
            label="Opacity"
            displayLabel="Opacity"
            unit="%"
            value={isMixed(opacityRaw) ? 100 : Math.round(opacityRaw * 100)}
            mixed={isMixed(opacityRaw)}
            step={1}
            min={0}
            max={100}
            onChange={(v) =>
              onChange((e) =>
                e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, opacity: v / 100 } : e,
              )
            }
          />
        </FieldRow>
      )}

      {colorModeRaw === 'gradient' && (
        <FieldRow label="Gradient colors" wrapLabel>
          <InspectorColorPopover
            label="Glow gradient start"
            value={glowGradientFor(nodes, index).stops[0]!.color}
            onChange={(color) => onChange((e) => updateGlowGradientStop(e, 0, color))}
            swatchStyle={{ background: toSwatchBg(glowGradientFor(nodes, index).stops[0]!.color) }}
            documentColorMode={documentColorMode}
            onEditStart={beginTransaction}
            onEditEnd={commitTransaction}
          />
          <InspectorColorPopover
            label="Glow gradient end"
            value={glowGradientFor(nodes, index).stops[1]!.color}
            onChange={(color) => onChange((e) => updateGlowGradientStop(e, 1, color))}
            swatchStyle={{ background: toSwatchBg(glowGradientFor(nodes, index).stops[1]!.color) }}
            documentColorMode={documentColorMode}
            onEditStart={beginTransaction}
            onEditEnd={commitTransaction}
          />
          <NumberField
            label="Opacity"
            displayLabel="Opacity"
            unit="%"
            value={isMixed(opacityRaw) ? 100 : Math.round(opacityRaw * 100)}
            mixed={isMixed(opacityRaw)}
            step={1}
            min={0}
            max={100}
            onChange={(v) =>
              onChange((e) =>
                e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, opacity: v / 100 } : e,
              )
            }
          />
        </FieldRow>
      )}

      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Spread"
          value={isMixed(spreadRaw) ? 8 : spreadRaw}
          mixed={isMixed(spreadRaw)}
          step={1}
          min={0}
          onChange={(v) =>
            onChange((e) =>
              e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, spread: v } : e,
            )
          }
        />
        <NumberField
          label="Choke"
          value={isMixed(chokeRaw) ? 0 : chokeRaw}
          mixed={isMixed(chokeRaw)}
          step={1}
          min={0}
          max={100}
          onChange={(v) =>
            onChange((e) =>
              e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, choke: v } : e,
            )
          }
        />
      </InspectorFieldGroup>

      <InspectorFieldGroup columns={firstEffect?.type === 'innerGlow' ? 2 : 1}>
        <Select
          label="Glow contour"
          value={isMixed(contourRaw) ? '' : contourRaw}
          options={CONTOUR_OPTIONS}
          onChange={(c) =>
            onChange((e) =>
              e.type === 'outerGlow' || e.type === 'innerGlow'
                ? { ...e, contour: c as GlowContour }
                : e,
            )
          }
        />
        {firstEffect?.type === 'innerGlow' && (
          <Select
            label="Inner glow origin"
            value={isMixed(originRaw) ? '' : originRaw}
            options={ORIGIN_OPTIONS}
            onChange={(origin) =>
              onChange((e) =>
                e.type === 'innerGlow' ? { ...e, origin: origin as InnerGlowOrigin } : e,
              )
            }
          />
        )}
      </InspectorFieldGroup>

      <FieldRow label="Blend">
        <Select
          label="Effect blend mode"
          value={isMixed(blendRaw) ? '' : (blendRaw as string)}
          options={isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []}
          groups={groupBlendOptions(BLEND_OPTIONS)}
          onChange={(v) => {
            if (!v) return;
            const mode = v as BlendMode;
            onChange((eff) =>
              eff.type === 'outerGlow' || eff.type === 'innerGlow'
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
