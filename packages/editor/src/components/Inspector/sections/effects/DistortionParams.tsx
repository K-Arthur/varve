/**
 * DistortionParams — parameter editors for Chromatic Aberration and Glitch.
 */
import type {
  BlendMode,
  ChannelColors,
  ChannelOffset,
  ChromaticChannelSource,
  ChromaticContribution,
  Effect,
} from '@varve/scene';
import { Select } from '@varve/ui';
import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../../context';
import { groupBlendOptions } from '../../controls/blendModeOptionGroups';
import { FieldRow, InspectorFieldGroup } from '../../controls/FieldRow';
import { InspectorColorPopover } from '../../controls/InspectorColorPopover';
import { NumberField } from '../../controls/NumberField';
import { commonValue, isMixed, type MaybeMixed } from '../../selection/selectionState';
import { BLEND_OPTIONS, type EffectNode, getEffect, toSwatchBg } from './EffectTypes';

export const DEFAULT_CHROMATIC_CHANNEL_COLORS: ChannelColors = {
  red: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
  green: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
  blue: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
};

export const CHROMATIC_SOURCE_OPTIONS: { value: ChromaticChannelSource; label: string }[] = [
  { value: 'red', label: 'Red signal' },
  { value: 'green', label: 'Green signal' },
  { value: 'blue', label: 'Blue signal' },
  { value: 'luminance', label: 'Luminance' },
  { value: 'alpha', label: 'Glyph / alpha coverage' },
];

export function defaultChromaticContributions(
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

export function LinkedChannelOffsets({
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

export function ChromaticCustomChannels({
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

export function ChromaticAberrationParams({
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
      <InspectorFieldGroup columns={3}>
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
      <FieldRow label="Channels">
        <Select
          label="Chromatic channel mode"
          value={isMixed(modeRaw) ? '' : modeRaw}
          options={[
            ...(isMixed(modeRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            { value: 'rgb', label: 'RGB split' },
            { value: 'custom', label: 'Custom colour split' },
          ]}
          onChange={(channelMode) => {
            if (!channelMode) return;
            onChange((effect) => {
              if (effect.type !== 'chromaticAberration') return effect;
              if (channelMode === 'custom') {
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
          options={isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []}
          groups={groupBlendOptions(BLEND_OPTIONS)}
          onChange={(v) => {
            if (!v) return;
            onChange((e) =>
              e.type === 'chromaticAberration' ? { ...e, blendMode: v as BlendMode } : e,
            );
          }}
          placeholder="Mixed"
        />
      </FieldRow>
      {modeRaw === 'rgb' && offsets && (
        <LinkedChannelOffsets
          value={offsets}
          onChange={(next) =>
            onChange((e) => (e.type === 'chromaticAberration' ? { ...e, offsets: next } : e))
          }
        />
      )}
      {modeRaw === 'custom' && (
        <ChromaticCustomChannels nodes={nodes} index={index} onChange={onChange} />
      )}
    </div>
  );
}

export function GlitchDisplacementParams({
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
        labelWrap
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
      <FieldRow label="Channel Shift" wrapLabel>
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

export function GlitchParams({
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
          options={isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []}
          groups={groupBlendOptions(BLEND_OPTIONS)}
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
