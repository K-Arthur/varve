/**
 * ShadowParams — unified shadow editor combining:
 * 1. Live EffectPreviewTile
 * 2. 1-click Elevation Presets (Subtle, Medium, Raised, Dramatic, Ambient, Graphic)
 * 3. Interactive 2D EffectLightPad
 * 4. Boxed Quad Grid (X, Y, Blur, Spread)
 * 5. Polar fields (Angle, Distance)
 * 6. Integrated Color, Opacity, and Blend Mode
 */
import type { BlendMode, Effect } from '@varve/scene';
import { Icon } from '@varve/ui';
import { useEditor } from '../../../../context';
import { InspectorFieldGroup } from '../../controls/FieldRow';
import { NumberField } from '../../controls/NumberField';
import { commonValue, isMixed } from '../../selection/selectionState';
import { EffectBlendRow, EffectColourOpacityRow } from './EffectControls';
import { EffectLightPad } from './EffectLightPad';
import { EffectPreviewTile } from './EffectPreviewTile';
import { type EffectNode, ELEVATION_PRESETS, getEffect } from './EffectTypes';

interface ShadowParamsProps {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}

export function ShadowParams({ nodes, index, onChange }: ShadowParamsProps) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();

  const firstEffect = getEffect(nodes[0]!, index);
  const currentEffect =
    firstEffect && (firstEffect.type === 'dropShadow' || firstEffect.type === 'innerShadow')
      ? firstEffect
      : undefined;

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
  const colorRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) return e.color;
    return { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };
  });

  const xVal = isMixed(xRaw) ? 0 : xRaw;
  const yVal = isMixed(yRaw) ? 0 : yRaw;
  const blurVal = isMixed(blurRaw) ? 0 : blurRaw;
  const spreadVal = isMixed(spreadRaw) ? 0 : spreadRaw;
  const opacityVal = isMixed(opacityRaw) ? 1 : opacityRaw;
  const colorVal = isMixed(colorRaw)
    ? { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 }
    : colorRaw;

  const angleRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) {
      if (e.x === 0 && e.y === 0) return 0;
      const deg = (Math.atan2(e.y, e.x) * 180) / Math.PI;
      return Math.round(deg < 0 ? deg + 360 : deg);
    }
    return 0;
  });
  const distanceRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'dropShadow' || e.type === 'innerShadow')) {
      return Math.round(Math.hypot(e.x, e.y));
    }
    return 0;
  });

  const angleVal = isMixed(angleRaw) ? 0 : angleRaw;
  const distanceVal = isMixed(distanceRaw) ? 0 : distanceRaw;

  // Active elevation preset detection
  const activePreset = ELEVATION_PRESETS.find(
    (p) =>
      p.x === xVal &&
      p.y === yVal &&
      p.blur === blurVal &&
      p.spread === spreadVal &&
      Math.abs(p.opacity - opacityVal) < 0.05,
  );

  const applyPreset = (preset: (typeof ELEVATION_PRESETS)[number]) => {
    onChange((e) => {
      if (e.type !== 'dropShadow' && e.type !== 'innerShadow') return e;
      return {
        ...e,
        x: preset.x,
        y: preset.y,
        blur: preset.blur,
        spread: preset.spread,
        opacity: preset.opacity,
      };
    });
  };

  const handleCoordsChange = (coords: {
    x: number;
    y: number;
    angle: number;
    distance: number;
  }) => {
    onChange((e) => {
      if (e.type !== 'dropShadow' && e.type !== 'innerShadow') return e;
      return {
        ...e,
        x: coords.x,
        y: coords.y,
      };
    });
  };

  return (
    <div className="insp-effect-params">
      {/* Live Preview */}
      <EffectPreviewTile
        effect={currentEffect}
        label={currentEffect?.type === 'innerShadow' ? 'Inner Shadow' : 'Drop Shadow'}
      />

      {/* 1-Click Elevation Presets */}
      <fieldset className="insp-elevation-presets" aria-label="Shadow elevation presets">
        {ELEVATION_PRESETS.map((p) => {
          const isActive = activePreset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`insp-elevation-preset-btn${isActive ? ' insp-elevation-preset-btn--active' : ''}`}
              title={`${p.label} (${p.description}) — X:${p.x} Y:${p.y} Blur:${p.blur}`}
              aria-pressed={isActive}
              onClick={() => applyPreset(p)}
            >
              <div className="insp-elevation-preset-btn__header">
                <span className="insp-elevation-preset-btn__name">{p.label}</span>
                <span className="insp-elevation-preset-btn__badge">{p.badge}</span>
              </div>
            </button>
          );
        })}
      </fieldset>

      {/* Direction: 2D light pad + polar fields share one block so the same
          vector is not presented as three disconnected control groups. */}
      <div className="insp-direction-block">
        <EffectLightPad angle={angleVal} distance={distanceVal} onChange={handleCoordsChange} />
        <InspectorFieldGroup columns={2}>
          <NumberField
            label="Angle"
            displayLabel="Angle"
            unit="deg"
            value={angleVal}
            mixed={isMixed(angleRaw)}
            step={1}
            onChange={(angle) =>
              onChange((e) => {
                if (e.type !== 'dropShadow' && e.type !== 'innerShadow') return e;
                const dist = Math.hypot(e.x, e.y);
                const rad = (angle * Math.PI) / 180;
                return {
                  ...e,
                  x: Math.round(Math.cos(rad) * dist),
                  y: Math.round(Math.sin(rad) * dist),
                };
              })
            }
          />
          <NumberField
            label="Distance"
            value={distanceVal}
            mixed={isMixed(distanceRaw)}
            step={1}
            min={0}
            onChange={(dist) =>
              onChange((e) => {
                if (e.type !== 'dropShadow' && e.type !== 'innerShadow') return e;
                const a = e.x === 0 && e.y === 0 ? 0 : Math.atan2(e.y, e.x);
                return {
                  ...e,
                  x: Math.round(Math.cos(a) * dist),
                  y: Math.round(Math.sin(a) * dist),
                };
              })
            }
          />
        </InspectorFieldGroup>
      </div>

      {/* Boxed Quad Grid (X, Y, Blur, Spread) */}
      <div className="insp-quad-grid">
        <div className="insp-icon-field">
          <Icon
            name="MoveHorizontal"
            label={undefined}
            size="0.85em"
            className="insp-icon-field__icon"
          />
          <NumberField
            label="X"
            value={xVal}
            mixed={isMixed(xRaw)}
            step={1}
            onChange={(v) =>
              onChange((e) =>
                e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, x: v } : e,
              )
            }
          />
        </div>
        <div className="insp-icon-field">
          <Icon
            name="MoveVertical"
            label={undefined}
            size="0.85em"
            className="insp-icon-field__icon"
          />
          <NumberField
            label="Y"
            value={yVal}
            mixed={isMixed(yRaw)}
            step={1}
            onChange={(v) =>
              onChange((e) =>
                e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, y: v } : e,
              )
            }
          />
        </div>
        <div className="insp-icon-field">
          <Icon name="Focus" label={undefined} size="0.85em" className="insp-icon-field__icon" />
          <NumberField
            label="Blur"
            value={blurVal}
            mixed={isMixed(blurRaw)}
            step={1}
            min={0}
            onChange={(v) =>
              onChange((e) =>
                e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, blur: v } : e,
              )
            }
          />
        </div>
        <div className="insp-icon-field">
          <Icon name="Expand" label={undefined} size="0.85em" className="insp-icon-field__icon" />
          <NumberField
            label="Spread"
            value={spreadVal}
            mixed={isMixed(spreadRaw)}
            step={1}
            min={-2048}
            onChange={(v) =>
              onChange((e) =>
                e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, spread: v } : e,
              )
            }
          />
        </div>
      </div>

      {/* Integrated Colour, Opacity & Blend Mode — shared vocabulary with
          every other effect editor. */}
      <EffectColourOpacityRow
        colourLabel="Shadow colour"
        colour={colorVal}
        colourMixed={isMixed(colorRaw)}
        opacity={opacityVal}
        opacityMixed={isMixed(opacityRaw)}
        onColourChange={(colour) =>
          onChange((e) =>
            e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, color: colour } : e,
          )
        }
        onOpacityChange={(opacity) =>
          onChange((e) =>
            e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, opacity } : e,
          )
        }
        documentColorMode={documentColorMode}
        onEditStart={beginTransaction}
        onEditEnd={commitTransaction}
      />

      <EffectBlendRow
        label="Effect blend mode"
        value={isMixed(blendRaw) ? 'normal' : (blendRaw as BlendMode)}
        mixed={isMixed(blendRaw)}
        onChange={(mode) =>
          onChange((e) =>
            e.type === 'dropShadow' || e.type === 'innerShadow' ? { ...e, blendMode: mode } : e,
          )
        }
      />
    </div>
  );
}
