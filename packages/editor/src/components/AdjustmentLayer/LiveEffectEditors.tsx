/**
 * Editors for the live effects family (dither, paletteSnap, bloom, rgbSplit,
 * crt, vhs, lightShafts, lensFlare, lightLeak, caustics).
 *
 * All controls reuse the existing adjustment editor classes
 * (adj-editor__*) so the panel styling, transaction batching (drag = one
 * undo entry), and accessibility conventions apply uniformly. Presets are
 * plain parameter objects from the engine preset registry — the same
 * rendering code, no special branches.
 */

import {
  type Adjustment,
  type AdjustmentKind,
  type BloomAdjustment,
  type CausticsAdjustment,
  type ColorMetric,
  type CrtAdjustment,
  type DitherAdjustment,
  type DitherAlgorithm,
  type EffectQualityParam,
  type LensFlareAdjustment,
  type LightLeakAdjustment,
  type LightShaftsAdjustment,
  nextDeterministicSeed,
  type PaletteSnapAdjustment,
  presetsForKind,
  type RgbSplitAdjustment,
  type VhsAdjustment,
} from '@varve/engine';
import type { Document } from '@varve/scene';
import { swatchesToPalette } from '@varve/scene';
import { paletteFileFormat, parsePaletteFile } from '@varve/shared';
import { Select } from '@varve/ui';
import { useCallback, useMemo, useRef, useState } from 'react';

export interface LiveEffectEditorProps {
  adjustment: Adjustment;
  onChange: (patch: Partial<Adjustment>) => void;
  doc?: Document;
}

type Patch = Record<string, unknown>;

function patchOf(p: Patch): Partial<Adjustment> {
  return p as Partial<Adjustment>;
}

// ── Shared control primitives ─────────────────────────────────────────────

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className="adj-editor__slider-row">
      <div className="adj-editor__slider-label">
        <span>{label}</span>
        <span>{format ? format(value) : String(value)}</span>
      </div>
      <input
        type="range"
        className="adj-editor__slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        disabled={disabled}
      />
    </div>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="adj-editor__row">
      <span className="adj-editor__label">{label}</span>
      <Select label={ariaLabel} value={value} options={options} onChange={onChange} />
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <div className="adj-editor__row">
      <label className="adj-editor__label" htmlFor={ariaLabel.replace(/\s+/g, '-')}>
        <input
          id={ariaLabel.replace(/\s+/g, '-')}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={ariaLabel}
        />
        {label}
      </label>
    </div>
  );
}

function SeedRow({
  seed,
  onChange,
  ariaLabel,
}: {
  seed: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="adj-editor__row">
      <span className="adj-editor__label">Seed</span>
      <input
        type="number"
        className="adj-editor__number"
        value={seed}
        onChange={(e) => {
          const v = Number.parseInt(e.target.value, 10);
          if (!Number.isNaN(v)) onChange(v);
        }}
        step={1}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        className="adj-panel__effect-action"
        onClick={() => onChange(nextDeterministicSeed(seed))}
        aria-label="Shuffle seed"
      >
        Shuffle
      </button>
    </div>
  );
}

const QUALITY_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'interactive', label: 'Interactive' },
  { value: 'normal', label: 'Normal' },
  { value: 'export', label: 'Export' },
];

function QualityRow({
  value,
  onChange,
}: {
  value: EffectQualityParam;
  onChange: (v: EffectQualityParam) => void;
}) {
  return (
    <SelectRow
      label="Quality"
      value={value}
      options={QUALITY_OPTIONS}
      onChange={(v) => onChange(v as EffectQualityParam)}
      ariaLabel="Render quality tier"
    />
  );
}

const METRIC_OPTIONS = [
  { value: 'rgb', label: 'RGB' },
  { value: 'linear-rgb', label: 'Linear RGB' },
  { value: 'lab', label: 'Lab' },
  { value: 'oklab', label: 'OKLab' },
];

const DITHER_ALGORITHM_OPTIONS = [
  { value: 'floyd-steinberg', label: 'Floyd-Steinberg' },
  { value: 'atkinson', label: 'Atkinson' },
  { value: 'jarvis-judice-ninke', label: 'Jarvis-Judice-Ninke' },
  { value: 'stucki', label: 'Stucki' },
  { value: 'sierra', label: 'Sierra' },
  { value: 'bayer', label: 'Bayer (ordered)' },
  { value: 'blue-noise', label: 'Blue noise' },
];

function PresetRow({ kind, onChange }: { kind: AdjustmentKind; onChange: (p: Patch) => void }) {
  const presets = useMemo(() => presetsForKind(kind), [kind]);
  if (presets.length === 0) return null;
  return (
    <div className="adj-editor__row">
      <span className="adj-editor__label">Preset</span>
      <Select
        label={`${kind} preset`}
        value=""
        placeholder="Custom"
        options={presets.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(v) => {
          const preset = presets.find((p) => p.id === v);
          if (preset) onChange(preset.params as Patch);
        }}
      />
    </div>
  );
}

/** Shared palette editor: swatch strip + text edit + file import. */
function PaletteEditor({
  colors,
  onChange,
  doc,
  allowSwatches,
}: {
  colors: readonly (readonly number[])[];
  onChange: (colors: [number, number, number][]) => void;
  doc?: Document;
  allowSwatches: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const text = useMemo(() => colors.map((c) => `${c[0]} ${c[1]} ${c[2]}`).join('\n'), [colors]);

  const handleTextChange = (value: string) => {
    const parsed: [number, number, number][] = [];
    for (const line of value.split('\n')) {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 3) continue;
      const r = Number.parseInt(parts[0]!, 10);
      const g = Number.parseInt(parts[1]!, 10);
      const b = Number.parseInt(parts[2]!, 10);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
      parsed.push([clamp255(r), clamp255(g), clamp255(b)]);
      if (parsed.length >= 256) break;
    }
    onChange(parsed);
  };

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const format = paletteFileFormat(file.name);
          const isText = format === 'gpl';
          const data = isText
            ? typeof reader.result === 'string'
              ? reader.result
              : new TextDecoder().decode(reader.result as ArrayBuffer)
            : (reader.result as ArrayBuffer);
          const parsed = parsePaletteFile(file.name, data);
          if (parsed.colors.length === 0) {
            setStatus('No colors found in file');
          } else {
            onChange(
              parsed.colors.map(
                (c) => [clamp255(c[0]), clamp255(c[1]), clamp255(c[2])] as [number, number, number],
              ),
            );
            setStatus(`Imported ${parsed.colors.length} colors (${format.toUpperCase()})`);
          }
        } catch (err) {
          setStatus(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
        e.target.value = '';
      };
      reader.onerror = () => setStatus('Failed to read file');
      if (file.name.toLowerCase().endsWith('.gpl')) reader.readAsText(file);
      else reader.readAsArrayBuffer(file);
    },
    [onChange],
  );

  const importSwatches = () => {
    if (!doc) return;
    const hexes = swatchesToPalette(doc.swatches ?? []);
    if (hexes.length === 0) {
      setStatus('Document has no swatches');
      return;
    }
    const colors: [number, number, number][] = hexes
      .map((hex) => hexToRgb(hex))
      .filter((c): c is [number, number, number] => c !== null);
    onChange(colors.slice(0, 256));
    setStatus(`Imported ${Math.min(256, colors.length)} swatches`);
  };

  return (
    <div className="adj-lut-editor">
      <input
        ref={fileRef}
        type="file"
        accept=".gpl,.act,.ase,.aco"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <div className="adj-panel__effect-actions" style={{ marginBottom: 6 }}>
        <button
          type="button"
          className="adj-panel__effect-action"
          onClick={() => fileRef.current?.click()}
        >
          Import palette (.gpl .act .ase .aco)
        </button>
        {allowSwatches && (
          <button type="button" className="adj-panel__effect-action" onClick={importSwatches}>
            From document swatches
          </button>
        )}
      </div>
      <div className="adj-editor__swatch-grid">
        {colors.slice(0, 32).map((c, i) => (
          <button
            key={c.join(',')}
            type="button"
            className={`adj-editor__swatch${i === activeIndex ? ' adj-editor__swatch--active' : ''}`}
            style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}
            onClick={() => setActiveIndex(activeIndex === i ? -1 : i)}
            aria-label={`Palette color ${i + 1}: rgb(${c[0]}, ${c[1]}, ${c[2]})`}
          />
        ))}
      </div>
      <div className="adj-editor__palette-meta">
        <span>{colors.length} colors</span>
        {status && <span>{status}</span>}
      </div>
      <textarea
        className="adj-editor__palette-input"
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        aria-label="Palette colors, one per line (r g b)"
        spellCheck={false}
      />
      <div className="adj-editor__hint">
        One color per line: &quot;r g b&quot; (0-255). Loaded palettes stay embedded in the document
        — no external file is needed to render.
      </div>
    </div>
  );
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const value = Number.parseInt(m[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function Color3Row({
  label,
  value,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: readonly [number, number, number] | null;
  onChange: (v: readonly [number, number, number] | null) => void;
  ariaLabel: string;
}) {
  const c = value ?? [255, 255, 255];
  return (
    <div className="adj-editor__row">
      <span className="adj-editor__label">{label}</span>
      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        {(['R', 'G', 'B'] as const).map((ch, i) => (
          <input
            key={ch}
            type="number"
            className="adj-editor__number"
            style={{ width: '100%', minWidth: 0 }}
            value={c[i]}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              if (Number.isNaN(v)) return;
              const next: [number, number, number] = [c[0], c[1], c[2]];
              next[i] = clamp255(v);
              onChange(next);
            }}
            min={0}
            max={255}
            aria-label={`${ariaLabel} ${ch}`}
          />
        ))}
        <button
          type="button"
          className="adj-panel__effect-action"
          onClick={() => onChange(null)}
          title="Clear tint"
          aria-label={`Clear ${ariaLabel}`}
        >
          x
        </button>
      </div>
    </div>
  );
}

// ── Per-effect editors ────────────────────────────────────────────────────

export function DitherEditor({ adjustment, onChange }: LiveEffectEditorProps) {
  const adj = adjustment as DitherAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  return (
    <div className="adj-editor__group">
      <PresetRow kind="dither" onChange={p} />
      <SelectRow
        label="Algorithm"
        value={adj.algorithm}
        options={DITHER_ALGORITHM_OPTIONS}
        onChange={(v) => p({ algorithm: v as DitherAlgorithm })}
        ariaLabel="Dither algorithm"
      />
      <SelectRow
        label="Quantize"
        value={adj.paletteMode}
        options={[
          { value: 'levels', label: 'Bit depth' },
          { value: 'custom', label: 'Custom palette' },
          { value: 'none', label: 'Off (no quantization)' },
        ]}
        onChange={(v) => p({ paletteMode: v as DitherAdjustment['paletteMode'] })}
        ariaLabel="Quantization mode"
      />
      {adj.paletteMode === 'levels' && (
        <SliderRow
          label="Bits per channel"
          value={adj.levels}
          min={1}
          max={8}
          step={1}
          onChange={(v) => p({ levels: v })}
          ariaLabel="Bits per channel"
        />
      )}
      {adj.paletteMode === 'custom' && (
        <>
          <SelectRow
            label="Metric"
            value={adj.metric}
            options={METRIC_OPTIONS}
            onChange={(v) => p({ metric: v as ColorMetric })}
            ariaLabel="Color metric"
          />
          <PaletteEditor
            colors={adj.colors}
            onChange={(colors) => p({ colors })}
            allowSwatches={false}
          />
        </>
      )}
      {adj.algorithm === 'bayer' && (
        <SliderRow
          label="Bayer size"
          value={adj.bayerSize}
          min={2}
          max={8}
          step={2}
          onChange={(v) => p({ bayerSize: v })}
          ariaLabel="Bayer matrix size"
        />
      )}
      {(adj.algorithm === 'bayer' || adj.algorithm === 'blue-noise') && (
        <SliderRow
          label="Cell size (px)"
          value={adj.cellSize}
          min={1}
          max={16}
          step={1}
          onChange={(v) => p({ cellSize: v })}
          ariaLabel="Pattern cell size"
        />
      )}
      <CheckboxRow
        label="Serpentine"
        checked={adj.serpentine}
        onChange={(v) => p({ serpentine: v })}
        ariaLabel="Serpentine scanning"
      />
      <SliderRow
        label="Strength"
        value={adj.strength}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ strength: v })}
        ariaLabel="Dither strength"
      />
      <SliderRow
        label="Alpha cutoff"
        value={adj.alphaCutoff}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ alphaCutoff: v })}
        ariaLabel="Alpha cutoff"
      />
      <SeedRow seed={adj.seed} onChange={(v) => p({ seed: v })} ariaLabel="Dither seed" />
    </div>
  );
}

export function PaletteSnapEditor({ adjustment, onChange, doc }: LiveEffectEditorProps) {
  const adj = adjustment as PaletteSnapAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  return (
    <div className="adj-editor__group">
      <PresetRow kind="paletteSnap" onChange={p} />
      <SelectRow
        label="Metric"
        value={adj.metric}
        options={METRIC_OPTIONS}
        onChange={(v) => p({ metric: v as ColorMetric })}
        ariaLabel="Color metric"
      />
      <PaletteEditor
        colors={adj.colors}
        onChange={(colors) => p({ colors })}
        doc={doc}
        allowSwatches
      />
      <SliderRow
        label="Amount"
        value={adj.amount}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ amount: v })}
        ariaLabel="Palette snap amount"
      />
      <CheckboxRow
        label="Dither"
        checked={adj.dither}
        onChange={(v) => p({ dither: v })}
        ariaLabel="Dither quantization error"
      />
      {adj.dither && (
        <>
          <SelectRow
            label="Dither algorithm"
            value={adj.ditherAlgorithm}
            options={DITHER_ALGORITHM_OPTIONS}
            onChange={(v) => p({ ditherAlgorithm: v as DitherAlgorithm })}
            ariaLabel="Palette snap dither algorithm"
          />
          <SliderRow
            label="Dither amount"
            value={adj.ditherStrength}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => p({ ditherStrength: v })}
            ariaLabel="Palette snap dither amount"
          />
        </>
      )}
      <SliderRow
        label="Alpha cutoff"
        value={adj.alphaCutoff}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ alphaCutoff: v })}
        ariaLabel="Alpha cutoff"
      />
      <SeedRow seed={adj.seed} onChange={(v) => p({ seed: v })} ariaLabel="Palette snap seed" />
    </div>
  );
}

export function BloomEditor({ adjustment, onChange }: LiveEffectEditorProps) {
  const adj = adjustment as BloomAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  return (
    <div className="adj-editor__group">
      <PresetRow kind="bloom" onChange={p} />
      <SliderRow
        label="Threshold"
        value={adj.threshold}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ threshold: v })}
        ariaLabel="Bloom threshold"
      />
      <SliderRow
        label="Soft knee"
        value={adj.softKnee}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ softKnee: v })}
        ariaLabel="Bloom soft knee"
      />
      <SliderRow
        label="Intensity"
        value={adj.intensity}
        min={0}
        max={4}
        step={0.05}
        onChange={(v) => p({ intensity: v })}
        ariaLabel="Bloom intensity"
      />
      <SliderRow
        label="Radius"
        value={adj.radius}
        min={0}
        max={256}
        step={1}
        format={(v) => `${v}px`}
        onChange={(v) => p({ radius: v })}
        ariaLabel="Bloom radius"
      />
      <SliderRow
        label="Diffusion"
        value={adj.diffusion}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ diffusion: v })}
        ariaLabel="Bloom diffusion"
      />
      <SelectRow
        label="Composite"
        value={adj.composite}
        options={[
          { value: 'screen', label: 'Screen' },
          { value: 'add', label: 'Additive' },
        ]}
        onChange={(v) => p({ composite: v as BloomAdjustment['composite'] })}
        ariaLabel="Bloom composite mode"
      />
      <Color3Row
        label="Tint"
        value={adj.tint}
        onChange={(v) => p({ tint: v })}
        ariaLabel="Bloom tint"
      />
      {adj.tint && (
        <SliderRow
          label="Tint amount"
          value={adj.tintAmount}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => p({ tintAmount: v })}
          ariaLabel="Bloom tint amount"
        />
      )}
      <CheckboxRow
        label="Anamorphic streak"
        checked={adj.streakEnabled}
        onChange={(v) => p({ streakEnabled: v })}
        ariaLabel="Anamorphic streak mode"
      />
      {adj.streakEnabled && (
        <>
          <SliderRow
            label="Streak angle"
            value={adj.streakAngle}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${v}°`}
            onChange={(v) => p({ streakAngle: v })}
            ariaLabel="Streak angle"
          />
          <SliderRow
            label="Streak length"
            value={adj.streakLength}
            min={0}
            max={512}
            step={1}
            format={(v) => `${v}px`}
            onChange={(v) => p({ streakLength: v })}
            ariaLabel="Streak length"
          />
          <SliderRow
            label="Streak intensity"
            value={adj.streakIntensity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => p({ streakIntensity: v })}
            ariaLabel="Streak intensity"
          />
          <SliderRow
            label="Streak aspect"
            value={adj.streakAspect}
            min={1}
            max={8}
            step={0.1}
            onChange={(v) => p({ streakAspect: v })}
            ariaLabel="Streak aspect ratio"
          />
        </>
      )}
      <QualityRow value={adj.quality} onChange={(v) => p({ quality: v })} />
    </div>
  );
}

export function RgbSplitEditor({ adjustment, onChange }: LiveEffectEditorProps) {
  const adj = adjustment as RgbSplitAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  return (
    <div className="adj-editor__group">
      <PresetRow kind="rgbSplit" onChange={p} />
      <SelectRow
        label="Mode"
        value={adj.mode}
        options={[
          { value: 'offset', label: 'Channel offset' },
          { value: 'radial', label: 'Radial (lens fringe)' },
        ]}
        onChange={(v) => p({ mode: v as RgbSplitAdjustment['mode'] })}
        ariaLabel="RGB split mode"
      />
      {adj.mode === 'offset' ? (
        (['red', 'green', 'blue'] as const).map((ch) => (
          <div key={ch} className="adj-editor__row">
            <span className="adj-editor__label">{ch[0]!.toUpperCase() + ch.slice(1)} offset</span>
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              <input
                type="number"
                className="adj-editor__number"
                style={{ width: '100%' }}
                value={adj[`${ch}X`]}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value);
                  if (!Number.isNaN(v)) p({ [`${ch}X`]: v } as Patch);
                }}
                step={0.5}
                aria-label={`${ch} X offset`}
              />
              <input
                type="number"
                className="adj-editor__number"
                style={{ width: '100%' }}
                value={adj[`${ch}Y`]}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value);
                  if (!Number.isNaN(v)) p({ [`${ch}Y`]: v } as Patch);
                }}
                step={0.5}
                aria-label={`${ch} Y offset`}
              />
            </div>
          </div>
        ))
      ) : (
        <>
          <SliderRow
            label="Amount"
            value={adj.amount}
            min={0}
            max={64}
            step={0.5}
            format={(v) => `${v}px`}
            onChange={(v) => p({ amount: v })}
            ariaLabel="Radial aberration amount"
          />
          <SliderRow
            label="Center X"
            value={adj.centerX}
            min={0}
            max={1}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => p({ centerX: v })}
            ariaLabel="Optical center X"
          />
          <SliderRow
            label="Center Y"
            value={adj.centerY}
            min={0}
            max={1}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => p({ centerY: v })}
            ariaLabel="Optical center Y"
          />
          <SliderRow
            label="Falloff"
            value={adj.falloff}
            min={0}
            max={3}
            step={0.05}
            onChange={(v) => p({ falloff: v })}
            ariaLabel="Radial falloff"
          />
          <SliderRow
            label="Fringe angle"
            value={adj.fringeAngle}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${v}°`}
            onChange={(v) => p({ fringeAngle: v })}
            ariaLabel="Fringe angle"
          />
        </>
      )}
      <SelectRow
        label="Border"
        value={adj.borderMode}
        options={[
          { value: 'transparent', label: 'Transparent' },
          { value: 'clamp', label: 'Clamp' },
          { value: 'mirror', label: 'Mirror' },
          { value: 'wrap', label: 'Wrap' },
        ]}
        onChange={(v) => p({ borderMode: v as RgbSplitAdjustment['borderMode'] })}
        ariaLabel="Border mode"
      />
      <SliderRow
        label="Intensity"
        value={adj.intensity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ intensity: v })}
        ariaLabel="RGB split intensity"
      />
    </div>
  );
}

export function CrtEditor({ adjustment, onChange }: LiveEffectEditorProps) {
  const adj = adjustment as CrtAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  return (
    <div className="adj-editor__group">
      <PresetRow kind="crt" onChange={p} />
      <SliderRow
        label="Curvature"
        value={adj.curvature}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ curvature: v })}
        ariaLabel="Screen curvature"
      />
      <SliderRow
        label="Corner radius"
        value={adj.cornerRadius}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ cornerRadius: v })}
        ariaLabel="Corner rounding"
      />
      <SliderRow
        label="Scanline period"
        value={adj.scanlinePeriod}
        min={1.5}
        max={12}
        step={0.5}
        format={(v) => `${v}px`}
        onChange={(v) => p({ scanlinePeriod: v })}
        ariaLabel="Scanline period"
      />
      <SliderRow
        label="Scanline strength"
        value={adj.scanlineStrength}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ scanlineStrength: v })}
        ariaLabel="Scanline strength"
      />
      <SliderRow
        label="Scanline softness"
        value={adj.scanlineSoftness}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ scanlineSoftness: v })}
        ariaLabel="Scanline softness"
      />
      <SelectRow
        label="Phosphor mask"
        value={adj.phosphorMask}
        options={[
          { value: 'none', label: 'None' },
          { value: 'rgb-stripe', label: 'RGB stripe' },
          { value: 'bgr-stripe', label: 'BGR stripe' },
          { value: 'aperture-grille', label: 'Aperture grille' },
          { value: 'shadow-mask', label: 'Shadow mask' },
        ]}
        onChange={(v) => p({ phosphorMask: v as CrtAdjustment['phosphorMask'] })}
        ariaLabel="Phosphor mask type"
      />
      {adj.phosphorMask !== 'none' && (
        <>
          <SliderRow
            label="Phosphor pitch"
            value={adj.phosphorPitch}
            min={1}
            max={16}
            step={0.5}
            format={(v) => `${v}px`}
            onChange={(v) => p({ phosphorPitch: v })}
            ariaLabel="Phosphor pitch"
          />
          <SliderRow
            label="Phosphor intensity"
            value={adj.phosphorIntensity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => p({ phosphorIntensity: v })}
            ariaLabel="Phosphor intensity"
          />
        </>
      )}
      <SliderRow
        label="Glow"
        value={adj.glow}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ glow: v })}
        ariaLabel="CRT glow"
      />
      <SliderRow
        label="Vignette"
        value={adj.vignette}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ vignette: v })}
        ariaLabel="Vignette"
      />
      <SliderRow
        label="Convergence X"
        value={adj.convergenceX}
        min={-8}
        max={8}
        step={0.1}
        onChange={(v) => p({ convergenceX: v })}
        ariaLabel="Horizontal convergence"
      />
      <SliderRow
        label="Convergence Y"
        value={adj.convergenceY}
        min={-8}
        max={8}
        step={0.1}
        onChange={(v) => p({ convergenceY: v })}
        ariaLabel="Vertical convergence"
      />
      <SliderRow
        label="Brightness"
        value={adj.brightness}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => p({ brightness: v })}
        ariaLabel="CRT brightness"
      />
      <SliderRow
        label="Contrast"
        value={adj.contrast}
        min={0}
        max={2}
        step={0.01}
        onChange={(v) => p({ contrast: v })}
        ariaLabel="CRT contrast"
      />
    </div>
  );
}

export function VhsEditor({ adjustment, onChange }: LiveEffectEditorProps) {
  const adj = adjustment as VhsAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  const noise = (
    key:
      | 'lumaNoise'
      | 'chromaNoise'
      | 'chromaBleed'
      | 'jitter'
      | 'tracking'
      | 'dropouts'
      | 'headSwitching'
      | 'tearing'
      | 'signalBlur'
      | 'timeInstability',
  ) => (
    <SliderRow
      label={key.charAt(0).toUpperCase() + key.slice(1).replace(/[A-Z]/g, (m) => ` ${m}`)}
      value={adj[key]}
      min={0}
      max={1}
      step={0.01}
      format={(v) => `${Math.round(v * 100)}%`}
      onChange={(v) => p({ [key]: v } as Patch)}
      ariaLabel={key.replace(/[A-Z]/g, (m) => ` ${m}`)}
    />
  );
  return (
    <div className="adj-editor__group">
      <PresetRow kind="vhs" onChange={p} />
      {noise('lumaNoise')}
      {noise('chromaNoise')}
      {noise('chromaBleed')}
      {noise('jitter')}
      {noise('tracking')}
      {noise('dropouts')}
      {noise('headSwitching')}
      {noise('tearing')}
      {noise('signalBlur')}
      {noise('timeInstability')}
      <SliderRow
        label="Time (s)"
        value={adj.time}
        min={0}
        max={10}
        step={0.01}
        format={(v) => `${v.toFixed(2)}s`}
        onChange={(v) => p({ time: v })}
        ariaLabel="VHS time"
      />
      <SelectRow
        label="Frame rate"
        value={String(adj.frameRate)}
        options={[
          { value: '12', label: '12 fps' },
          { value: '24', label: '24 fps' },
          { value: '30', label: '30 fps' },
          { value: '60', label: '60 fps' },
        ]}
        onChange={(v) => p({ frameRate: Number(v) })}
        ariaLabel="VHS frame rate"
      />
      <SeedRow seed={adj.seed} onChange={(v) => p({ seed: v })} ariaLabel="VHS seed" />
      <QualityRow value={adj.quality} onChange={(v) => p({ quality: v })} />
    </div>
  );
}

export function LightShaftsEditor({ adjustment, onChange }: LiveEffectEditorProps) {
  const adj = adjustment as LightShaftsAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  return (
    <div className="adj-editor__group">
      <PresetRow kind="lightShafts" onChange={p} />
      <SelectRow
        label="Light type"
        value={adj.lightType}
        options={[
          { value: 'point', label: 'Point' },
          { value: 'directional', label: 'Directional' },
        ]}
        onChange={(v) => p({ lightType: v as LightShaftsAdjustment['lightType'] })}
        ariaLabel="Light type"
      />
      <SliderRow
        label="Light X"
        value={adj.lightX}
        min={-0.2}
        max={1.2}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => p({ lightX: v })}
        ariaLabel="Light position X"
      />
      <SliderRow
        label="Light Y"
        value={adj.lightY}
        min={-0.2}
        max={1.2}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => p({ lightY: v })}
        ariaLabel="Light position Y"
      />
      {adj.lightType === 'directional' && (
        <SliderRow
          label="Direction"
          value={adj.direction}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${v}°`}
          onChange={(v) => p({ direction: v })}
          ariaLabel="Light direction"
        />
      )}
      <SelectRow
        label="Occlusion"
        value={adj.occlusionSource}
        options={[
          { value: 'luminance', label: 'Brightness' },
          { value: 'alpha', label: 'Layer alpha' },
        ]}
        onChange={(v) => p({ occlusionSource: v as LightShaftsAdjustment['occlusionSource'] })}
        ariaLabel="Occlusion source"
      />
      <SliderRow
        label="Intensity"
        value={adj.intensity}
        min={0}
        max={3}
        step={0.05}
        onChange={(v) => p({ intensity: v })}
        ariaLabel="Shaft intensity"
      />
      <SliderRow
        label="Exposure"
        value={adj.exposure}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => p({ exposure: v })}
        ariaLabel="Shaft exposure"
      />
      <SliderRow
        label="Decay"
        value={adj.decay}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => p({ decay: v })}
        ariaLabel="Ray decay"
      />
      <SliderRow
        label="Density"
        value={adj.density}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => p({ density: v })}
        ariaLabel="Ray density"
      />
      <SliderRow
        label="Weight"
        value={adj.weight}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => p({ weight: v })}
        ariaLabel="Occlusion weight"
      />
      <SliderRow
        label="Sample count"
        value={adj.sampleCount}
        min={8}
        max={96}
        step={1}
        onChange={(v) => p({ sampleCount: v })}
        ariaLabel="Ray march sample count"
      />
      <SliderRow
        label="Scattering"
        value={adj.scattering}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => p({ scattering: v })}
        ariaLabel="Scattering spread"
      />
      <Color3Row
        label="Tint"
        value={adj.tint}
        onChange={(v) => p({ tint: v })}
        ariaLabel="Shaft tint"
      />
      <QualityRow value={adj.quality} onChange={(v) => p({ quality: v })} />
      <div className="adj-editor__hint">
        Screen-space radial light scattering (not ray tracing). Rays march from each pixel toward
        the light, sampling occlusion.
      </div>
    </div>
  );
}

export function LensFlareEditor({ adjustment, onChange }: LiveEffectEditorProps) {
  const adj = adjustment as LensFlareAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  return (
    <div className="adj-editor__group">
      <PresetRow kind="lensFlare" onChange={p} />
      <SliderRow
        label="Source X"
        value={adj.sourceX}
        min={-1}
        max={1.2}
        step={0.01}
        format={(v) => (v < 0 ? 'Auto' : v.toFixed(2))}
        onChange={(v) => p({ sourceX: v })}
        ariaLabel="Flare source X (negative = auto)"
      />
      <SliderRow
        label="Source Y"
        value={adj.sourceY}
        min={-1}
        max={1.2}
        step={0.01}
        format={(v) => (v < 0 ? 'Auto' : v.toFixed(2))}
        onChange={(v) => p({ sourceY: v })}
        ariaLabel="Flare source Y (negative = auto)"
      />
      <SliderRow
        label="Brightness"
        value={adj.brightness}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => p({ brightness: v })}
        ariaLabel="Flare brightness"
      />
      <SliderRow
        label="Scale"
        value={adj.scale}
        min={0.1}
        max={2}
        step={0.05}
        onChange={(v) => p({ scale: v })}
        ariaLabel="Flare scale"
      />
      <SliderRow
        label="Ghosts"
        value={adj.ghostCount}
        min={0}
        max={8}
        step={1}
        onChange={(v) => p({ ghostCount: v })}
        ariaLabel="Ghost count"
      />
      <SliderRow
        label="Ghost spacing"
        value={adj.ghostSpacing}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => p({ ghostSpacing: v })}
        ariaLabel="Ghost spacing"
      />
      <SliderRow
        label="Halo"
        value={adj.halo}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ halo: v })}
        ariaLabel="Halo intensity"
      />
      <SliderRow
        label="Aperture blades"
        value={adj.apertureBlades}
        min={0}
        max={12}
        step={1}
        format={(v) => (v === 0 ? 'Off' : String(v))}
        onChange={(v) => p({ apertureBlades: v })}
        ariaLabel="Aperture blades"
      />
      {adj.apertureBlades >= 3 && (
        <SliderRow
          label="Aperture rotation"
          value={adj.apertureRotation}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${v}°`}
          onChange={(v) => p({ apertureRotation: v })}
          ariaLabel="Aperture rotation"
        />
      )}
      <SliderRow
        label="Streak intensity"
        value={adj.streakIntensity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ streakIntensity: v })}
        ariaLabel="Flare streak intensity"
      />
      <SliderRow
        label="Anamorphic"
        value={adj.anamorphicRatio}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ anamorphicRatio: v })}
        ariaLabel="Anamorphic ratio"
      />
      <SliderRow
        label="Dispersion"
        value={adj.chromaticDispersion}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ chromaticDispersion: v })}
        ariaLabel="Chromatic dispersion"
      />
      <SeedRow seed={adj.seed} onChange={(v) => p({ seed: v })} ariaLabel="Flare seed" />
      <QualityRow value={adj.quality} onChange={(v) => p({ quality: v })} />
    </div>
  );
}

export function LightLeakEditor({ adjustment, onChange }: LiveEffectEditorProps) {
  const adj = adjustment as LightLeakAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  return (
    <div className="adj-editor__group">
      <PresetRow kind="lightLeak" onChange={p} />
      <SliderRow
        label="X"
        value={adj.x}
        min={0}
        max={1}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => p({ x: v })}
        ariaLabel="Leak position X"
      />
      <SliderRow
        label="Y"
        value={adj.y}
        min={0}
        max={1}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => p({ y: v })}
        ariaLabel="Leak position Y"
      />
      <SliderRow
        label="Angle"
        value={adj.angle}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${v}°`}
        onChange={(v) => p({ angle: v })}
        ariaLabel="Leak orientation"
      />
      <SliderRow
        label="Size"
        value={adj.size}
        min={0.1}
        max={2}
        step={0.05}
        onChange={(v) => p({ size: v })}
        ariaLabel="Leak size"
      />
      <SliderRow
        label="Softness"
        value={adj.softness}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ softness: v })}
        ariaLabel="Leak softness"
      />
      <SliderRow
        label="Noise scale"
        value={adj.noiseScale}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ noiseScale: v })}
        ariaLabel="Leak noise scale"
      />
      <SliderRow
        label="Hue"
        value={adj.hue}
        min={0}
        max={360}
        step={1}
        format={(v) => `${v}°`}
        onChange={(v) => p({ hue: v })}
        ariaLabel="Leak hue"
      />
      <SliderRow
        label="Saturation"
        value={adj.saturation}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ saturation: v })}
        ariaLabel="Leak saturation"
      />
      <SliderRow
        label="Lightness"
        value={adj.lightness}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ lightness: v })}
        ariaLabel="Leak lightness"
      />
      <SliderRow
        label="Intensity"
        value={adj.intensity}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => p({ intensity: v })}
        ariaLabel="Leak intensity"
      />
      <SeedRow seed={adj.seed} onChange={(v) => p({ seed: v })} ariaLabel="Leak seed" />
    </div>
  );
}

export function CausticsEditor({ adjustment, onChange }: LiveEffectEditorProps) {
  const adj = adjustment as CausticsAdjustment;
  const p = (patch: Patch) => onChange(patchOf(patch));
  return (
    <div className="adj-editor__group">
      <PresetRow kind="caustics" onChange={p} />
      <SliderRow
        label="Scale"
        value={adj.scale}
        min={4}
        max={128}
        step={1}
        format={(v) => `${v}px`}
        onChange={(v) => p({ scale: v })}
        ariaLabel="Caustic wave scale"
      />
      <SliderRow
        label="Depth"
        value={adj.depth}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ depth: v })}
        ariaLabel="Water depth"
      />
      <SliderRow
        label="Wave count"
        value={adj.waveCount}
        min={2}
        max={8}
        step={1}
        onChange={(v) => p({ waveCount: v })}
        ariaLabel="Wave count"
      />
      <SliderRow
        label="Complexity"
        value={adj.complexity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ complexity: v })}
        ariaLabel="Caustic complexity"
      />
      <SliderRow
        label="Sharpness"
        value={adj.sharpness}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ sharpness: v })}
        ariaLabel="Caustic sharpness"
      />
      <SliderRow
        label="Light angle"
        value={adj.lightAngle}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${v}°`}
        onChange={(v) => p({ lightAngle: v })}
        ariaLabel="Light angle"
      />
      <SliderRow
        label="Brightness"
        value={adj.brightness}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => p({ brightness: v })}
        ariaLabel="Caustic brightness"
      />
      <SliderRow
        label="Contrast"
        value={adj.contrast}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => p({ contrast: v })}
        ariaLabel="Caustic contrast"
      />
      <SliderRow
        label="Refraction"
        value={adj.refractionAmount}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ refractionAmount: v })}
        ariaLabel="Refraction amount"
      />
      <SliderRow
        label="Distortion"
        value={adj.distortionAmount}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ distortionAmount: v })}
        ariaLabel="Refraction distortion"
      />
      <SliderRow
        label="Dispersion"
        value={adj.dispersion}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => p({ dispersion: v })}
        ariaLabel="Caustic dispersion"
      />
      <SelectRow
        label="Output"
        value={adj.output}
        options={[
          { value: 'combined', label: 'Combined' },
          { value: 'lighting', label: 'Lighting only' },
          { value: 'refraction', label: 'Refraction only' },
        ]}
        onChange={(v) => p({ output: v as CausticsAdjustment['output'] })}
        ariaLabel="Caustic output"
      />
      <Color3Row
        label="Water tint"
        value={adj.waterTint}
        onChange={(v) => p({ waterTint: v })}
        ariaLabel="Water tint"
      />
      <Color3Row
        label="Surface tint"
        value={adj.surfaceTint}
        onChange={(v) => p({ surfaceTint: v })}
        ariaLabel="Surface tint"
      />
      <SliderRow
        label="Time (s)"
        value={adj.time}
        min={0}
        max={10}
        step={0.01}
        format={(v) => `${v.toFixed(2)}s`}
        onChange={(v) => p({ time: v })}
        ariaLabel="Caustic time"
      />
      <SliderRow
        label="Animation speed"
        value={adj.animationSpeed}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => p({ animationSpeed: v })}
        ariaLabel="Caustic animation speed"
      />
      <CheckboxRow
        label="Tileable"
        checked={adj.tileable}
        onChange={(v) => p({ tileable: v })}
        ariaLabel="Seamless tileable caustics"
      />
      <SeedRow seed={adj.seed} onChange={(v) => p({ seed: v })} ariaLabel="Caustic seed" />
      <QualityRow value={adj.quality} onChange={(v) => p({ quality: v })} />
    </div>
  );
}
