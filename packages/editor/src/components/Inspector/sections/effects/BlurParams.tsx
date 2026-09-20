/**
 * BlurParams — unified blur parameters for layerBlur, backgroundBlur,
 * spatial blur gallery types (gaussian, field, iris, tilt-shift, path, spin),
 * and depthBlur. Includes quick radius chips and live preview.
 */
import type { Effect } from '@varve/scene';
import { FieldRow, InspectorFieldGroup } from '../../controls/FieldRow';
import { NumberField } from '../../controls/NumberField';
import { commonValue, isMixed } from '../../selection/selectionState';
import { EffectToggleRow } from './EffectControls';
import { EffectPreviewTile } from './EffectPreviewTile';
import { type EffectNode, getEffect, QUICK_BLUR_PRESETS } from './EffectTypes';

export type SpatialBlurType =
  | 'gaussianBlur'
  | 'fieldBlur'
  | 'irisBlur'
  | 'tiltShiftBlur'
  | 'pathBlur'
  | 'spinBlur';

export function SingleBlurParam({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const firstEffect = getEffect(nodes[0]!, index);
  const currentEffect =
    firstEffect && (firstEffect.type === 'layerBlur' || firstEffect.type === 'backgroundBlur')
      ? firstEffect
      : undefined;

  const radiusRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && (e.type === 'layerBlur' || e.type === 'backgroundBlur')) return e.radius;
    return 0;
  });

  const radiusVal = isMixed(radiusRaw) ? 0 : radiusRaw;

  return (
    <div className="insp-effect-params">
      <EffectPreviewTile
        effect={currentEffect}
        label={currentEffect?.type === 'backgroundBlur' ? 'Background Blur' : 'Layer Blur'}
      />

      {/* Quick Radius Presets */}
      <fieldset className="insp-radius-chips" aria-label="Blur radius presets">
        {QUICK_BLUR_PRESETS.map((preset) => {
          const isActive = radiusVal === preset;
          return (
            <button
              key={preset}
              type="button"
              className={`insp-radius-chip${isActive ? ' insp-radius-chip--active' : ''}`}
              aria-pressed={isActive}
              onClick={() =>
                onChange((e) =>
                  e.type === 'layerBlur' || e.type === 'backgroundBlur'
                    ? { ...e, radius: preset }
                    : e,
                )
              }
            >
              {preset}px
            </button>
          );
        })}
      </fieldset>

      <FieldRow label="Radius">
        <NumberField
          label="Radius"
          value={radiusVal}
          mixed={isMixed(radiusRaw)}
          step={1}
          min={0}
          unit="px"
          onChange={(v) =>
            onChange((e) =>
              e.type === 'layerBlur' || e.type === 'backgroundBlur' ? { ...e, radius: v } : e,
            )
          }
        />
      </FieldRow>
    </div>
  );
}

export function SpatialBlurParams({
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
        <EffectPreviewTile effect={effect} label="Gaussian Blur" />
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
        <EffectPreviewTile effect={effect} label="Field Blur" />
        <NumberField
          label="Maximum pin blur"
          labelWrap
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
        <EffectPreviewTile
          effect={effect}
          label={type === 'irisBlur' ? 'Iris Blur' : 'Tilt-Shift Blur'}
        />
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
        <EffectPreviewTile effect={effect} label="Path Blur" />
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
      <EffectPreviewTile effect={effect} label="Spin Blur" />
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

export function DepthBlurParams({
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
  const firstEffect = getEffect(nodes[0]!, index);
  const currentEffect = firstEffect?.type === 'depthBlur' ? firstEffect : undefined;
  return (
    <div className="insp-effect-params">
      <EffectPreviewTile effect={currentEffect} label="Depth Blur" />
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
      <InspectorFieldGroup columns={1}>
        <NumberField
          label="Edge protection"
          labelWrap
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
      </InspectorFieldGroup>
      <EffectToggleRow
        label="Invert depth"
        checked={isMixed(invertRaw) ? false : invertRaw}
        mixed={isMixed(invertRaw)}
        onChange={(enabled) =>
          onChange((effect) =>
            effect.type === 'depthBlur' ? { ...effect, invert: enabled } : effect,
          )
        }
      />
    </div>
  );
}
