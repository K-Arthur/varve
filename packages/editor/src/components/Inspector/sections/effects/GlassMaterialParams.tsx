/**
 * GlassMaterialParams — structured glass material editor.
 * Groups parameters into Backdrop & Refraction, Tint & Noise, and Edge Specular Highlight.
 */
import type { Effect, ManagedColor } from '@varve/scene';
import { useEditor } from '../../../../context';
import { FieldRow, InspectorFieldGroup } from '../../controls/FieldRow';
import { InspectorColorPopover } from '../../controls/InspectorColorPopover';
import { NumberField } from '../../controls/NumberField';
import { commonValue, isMixed } from '../../selection/selectionState';
import { EffectPreviewTile } from './EffectPreviewTile';
import { type EffectNode, getEffect, toSwatchBg } from './EffectTypes';

interface GlassMaterialParamsProps {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}

export function GlassMaterialParams({ nodes, index, onChange }: GlassMaterialParamsProps) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();

  const firstEffect = getEffect(nodes[0]!, index);
  const currentEffect = firstEffect?.type === 'glassMaterial' ? firstEffect : undefined;

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
  const edgeColorRaw = commonValue(nodes, (n) => {
    const effect = getEffect(n, index);
    return effect?.type === 'glassMaterial'
      ? effect.edgeHighlightColor
      : ({ space: 'rgb', r: 255, g: 255, b: 255, a: 120 } as ManagedColor);
  });
  const edgeColor = isMixed(edgeColorRaw)
    ? ({ space: 'rgb', r: 255, g: 255, b: 255, a: 120 } as ManagedColor)
    : edgeColorRaw;

  return (
    <div className="insp-effect-params">
      <EffectPreviewTile effect={currentEffect} label="Glass Material" />

      {/* Refraction & Surface Blur */}
      <NumberField
        label="Blur"
        value={isMixed(blurRaw) ? 0 : blurRaw}
        mixed={isMixed(blurRaw)}
        step={1}
        min={0}
        unit="px"
        onChange={(v) => onChange((e) => (e.type === 'glassMaterial' ? { ...e, blur: v } : e))}
      />

      <InspectorFieldGroup columns={2}>
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
      </InspectorFieldGroup>

      {/* Tint & Grain Texture */}
      <InspectorFieldGroup columns={2}>
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
          label="Noise"
          value={isMixed(noiseRaw) ? 0 : noiseRaw}
          mixed={isMixed(noiseRaw)}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => onChange((e) => (e.type === 'glassMaterial' ? { ...e, noise: v } : e))}
        />
      </InspectorFieldGroup>

      {/* Edge Specular Highlight */}
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
            unit="px"
            onChange={(v) =>
              onChange((e) => (e.type === 'glassMaterial' ? { ...e, edgeHighlightWidth: v } : e))
            }
          />
        ) : null}
      </InspectorFieldGroup>

      {(isMixed(edgeHighlightRaw) || edgeHighlightRaw) && (
        <FieldRow label="Edge colour">
          <InspectorColorPopover
            label="Glass edge highlight colour"
            value={edgeColor}
            onChange={(next) =>
              onChange((effect) =>
                effect.type === 'glassMaterial' ? { ...effect, edgeHighlightColor: next } : effect,
              )
            }
            swatchStyle={{ background: toSwatchBg(edgeColor) }}
            documentColorMode={documentColorMode}
            onEditStart={beginTransaction}
            onEditEnd={commitTransaction}
          />
        </FieldRow>
      )}
    </div>
  );
}
