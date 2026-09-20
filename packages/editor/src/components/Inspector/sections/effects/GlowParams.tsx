/**
 * GlowParams — unified glow editor for outerGlow and innerGlow effects.
 * Supports solid and gradient modes, choke/spread tuning, contour shaping,
 * and origin selection with live preview.
 *
 * Control order follows the shared effect vocabulary: preview, geometry,
 * closed-set quality choices, colour, then blend. Contour and origin are
 * segmented choices with shape/position icons instead of two-click selects
 * (Photoshop presents the same parity as radio groups).
 */
import type { BlendMode, Effect, EffectGradient, ManagedColor } from '@varve/scene';
import type { SegmentedOption } from '@varve/ui';
import { useEditor } from '../../../../context';
import { FieldRow, InspectorFieldGroup } from '../../controls/FieldRow';
import { InspectorColorPopover } from '../../controls/InspectorColorPopover';
import { NumberField } from '../../controls/NumberField';
import { commonValue, isMixed } from '../../selection/selectionState';
import {
  EffectBlendRow,
  EffectChoiceRow,
  EffectColourOpacityRow,
  EffectPercentField,
} from './EffectControls';
import { EffectPreviewTile } from './EffectPreviewTile';
import { type EffectNode, getEffect, toSwatchBg } from './EffectTypes';

interface GlowParamsProps {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}

type GlowContour = 'linear' | 'smooth' | 'sharp';
type InnerGlowOrigin = 'edge' | 'center';

const COLOR_TREATMENT_OPTIONS: readonly SegmentedOption<'solid' | 'gradient'>[] = [
  { value: 'solid', label: 'Solid colour' },
  { value: 'gradient', label: 'Gradient ramp' },
];

const CONTOUR_OPTIONS: readonly {
  value: GlowContour;
  label: string;
  icon: 'Minus' | 'Spline' | 'Zap';
}[] = [
  { value: 'linear', label: 'Linear', icon: 'Minus' },
  { value: 'smooth', label: 'Soft', icon: 'Spline' },
  { value: 'sharp', label: 'Sharp', icon: 'Zap' },
];

const ORIGIN_OPTIONS: readonly {
  value: InnerGlowOrigin;
  label: string;
  icon: 'Scan' | 'CircleDot';
}[] = [
  { value: 'edge', label: 'Edge', icon: 'Scan' },
  { value: 'center', label: 'Center', icon: 'CircleDot' },
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
  const opacityVal = isMixed(opacityRaw) ? 1 : opacityRaw;
  const isInnerGlow = firstEffect?.type === 'innerGlow';

  return (
    <div className="insp-effect-params">
      <EffectPreviewTile
        effect={currentEffect}
        label={currentEffect?.type === 'innerGlow' ? 'Inner Glow' : 'Outer Glow'}
      />

      <EffectChoiceRow
        label="Glow colour treatment"
        value={isMixed(colorModeRaw) ? 'solid' : (colorModeRaw as 'solid' | 'gradient')}
        mixed={isMixed(colorModeRaw)}
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
          unit="%"
          displayLabel="Choke"
          onChange={(v) =>
            onChange((e) =>
              e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, choke: v } : e,
            )
          }
        />
      </InspectorFieldGroup>

      <EffectChoiceRow
        label="Glow contour"
        value={isMixed(contourRaw) ? 'smooth' : (contourRaw as GlowContour)}
        mixed={isMixed(contourRaw)}
        options={CONTOUR_OPTIONS}
        onChange={(contour) =>
          onChange((e) =>
            e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, contour } : e,
          )
        }
      />

      {isInnerGlow && (
        <EffectChoiceRow
          label="Inner glow origin"
          value={isMixed(originRaw) ? 'edge' : (originRaw as InnerGlowOrigin)}
          mixed={isMixed(originRaw)}
          options={ORIGIN_OPTIONS}
          onChange={(origin) => onChange((e) => (e.type === 'innerGlow' ? { ...e, origin } : e))}
        />
      )}

      {colorModeRaw === 'solid' && (
        <EffectColourOpacityRow
          colourLabel="Glow colour"
          colour={colorVal}
          colourMixed={isMixed(colorRaw)}
          opacity={opacityVal}
          opacityMixed={isMixed(opacityRaw)}
          onColourChange={(colour) =>
            onChange((e) =>
              e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, color: colour } : e,
            )
          }
          onOpacityChange={(opacity) =>
            onChange((e) =>
              e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, opacity } : e,
            )
          }
          documentColorMode={documentColorMode}
          onEditStart={beginTransaction}
          onEditEnd={commitTransaction}
        />
      )}

      {colorModeRaw === 'gradient' && (
        <FieldRow label="Gradient colours" wrapLabel>
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
          <EffectPercentField
            label="Opacity"
            value={opacityVal}
            mixed={isMixed(opacityRaw)}
            onChange={(opacity) =>
              onChange((e) =>
                e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, opacity } : e,
              )
            }
          />
        </FieldRow>
      )}

      <EffectBlendRow
        label="Effect blend mode"
        value={isMixed(blendRaw) ? 'screen' : (blendRaw as BlendMode)}
        mixed={isMixed(blendRaw)}
        onChange={(mode) =>
          onChange((e) =>
            e.type === 'outerGlow' || e.type === 'innerGlow' ? { ...e, blendMode: mode } : e,
          )
        }
      />
    </div>
  );
}
