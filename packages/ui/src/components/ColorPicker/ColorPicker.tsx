import { useCallback, useMemo, useState } from 'react';
import { ColorArea } from './ColorArea';
import { ColorFields } from './ColorFields';
import { ColorSlider } from './ColorSlider';
import type { Color } from './color-utils';
import { hsvToRgb, rgbToHex, rgbToHsv } from './color-utils';
import { contrastRatio, formatContrast, relativeLuminance, wcagLevel } from './contrast';
import { EyeDropperButton } from './EyeDropperButton';
import { SwatchPalette } from './SwatchPalette';

export interface ColorPickerProps {
  value: Color;
  onChange: (color: Color) => void;
  bgColor?: Color;
}

export function ColorPicker({ value, onChange, bgColor }: ColorPickerProps) {
  const [h, s, v] = useMemo(() => rgbToHsv(value[0], value[1], value[2]), [value]);
  const [draftSat, setDraftSat] = useState(s);
  const [draftVal, setDraftVal] = useState(v);
  const [draftHue, setDraftHue] = useState(h);

  const sat = draftSat;
  const val = draftVal;
  const hue = draftHue;

  const applyColor = useCallback(
    (hue: number, sat: number, val: number, alpha: number) => {
      const [r, g, b] = hsvToRgb(hue, sat, val);
      onChange([r, g, b, alpha]);
    },
    [onChange],
  );

  const handleAreaChange = useCallback(
    (newSat: number, newVal: number) => {
      setDraftSat(newSat);
      setDraftVal(newVal);
      applyColor(hue, newSat, newVal, value[3]);
    },
    [hue, value, applyColor],
  );

  const handleHueChange = useCallback(
    (newHue: number) => {
      setDraftHue(newHue);
      applyColor(newHue, sat, val, value[3]);
    },
    [sat, val, value, applyColor],
  );

  const handleAlphaChange = useCallback(
    (newAlpha: number) => {
      const [r, g, b] = hsvToRgb(hue, sat, val);
      onChange([r, g, b, Math.round(newAlpha * 255)]);
    },
    [hue, sat, val, onChange],
  );

  const handleFieldsChange = useCallback(
    (newColor: Color) => {
      const [nh, ns, nv] = rgbToHsv(newColor[0], newColor[1], newColor[2]);
      setDraftHue(nh);
      setDraftSat(ns);
      setDraftVal(nv);
      onChange(newColor);
    },
    [onChange],
  );

  const handleSwatchSelect = useCallback(
    (c: Color) => {
      const [nh, ns, nv] = rgbToHsv(c[0], c[1], c[2]);
      setDraftHue(nh);
      setDraftSat(ns);
      setDraftVal(nv);
      onChange(c);
    },
    [onChange],
  );

  const handleEyeDropper = useCallback(
    (c: Color) => {
      const [nh, ns, nv] = rgbToHsv(c[0], c[1], c[2]);
      setDraftHue(nh);
      setDraftSat(ns);
      setDraftVal(nv);
      onChange(c);
    },
    [onChange],
  );

  const overlayColor: Color = [value[0], value[1], value[2], 255];

  const alphaVal = value[3] / 255;

  const contrastInfo = useMemo(() => {
    if (!bgColor) return null;
    const l1 = relativeLuminance(value[0], value[1], value[2]);
    const l2 = relativeLuminance(bgColor[0], bgColor[1], bgColor[2]);
    const ratio = contrastRatio(l1, l2);
    const level = wcagLevel(ratio, false);
    return { ratio, level, text: `${formatContrast(ratio)} ${level.toUpperCase()}` };
  }, [value, bgColor]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-3)',
        background: 'var(--color-surface-overlay)',
        borderRadius: 'var(--radius-md)',
        minWidth: 220,
      }}
    >
      <ColorArea hue={hue} saturation={sat} value={val} onChange={handleAreaChange} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <ColorSlider channel="hue" value={hue} onChange={handleHueChange} />
        <ColorSlider
          channel="alpha"
          value={alphaVal}
          baseColor={overlayColor}
          onChange={handleAlphaChange}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        <div
          style={{
            width: 'var(--space-5)',
            height: 'var(--space-5)',
            borderRadius: 'var(--radius-sm)',
            background: `rgba(${value[0]},${value[1]},${value[2]},${alphaVal.toFixed(2)})`,
            border: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1 }}>
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-muted)',
              fontFamily: 'monospace',
            }}
          >
            {rgbToHex(value[0], value[1], value[2])}
            {alphaVal < 1 ? ` (${Math.round(alphaVal * 100)}%)` : ''}
          </span>
        </div>
        <EyeDropperButton onPick={handleEyeDropper} />
      </div>

      <ColorFields color={value} onChange={handleFieldsChange} />

      <div
        style={{
          borderTop: '1px solid var(--color-border-subtle)',
          paddingTop: 'var(--space-2)',
        }}
      >
        <SwatchPalette onSelect={handleSwatchSelect} />
      </div>

      {contrastInfo && (
        <div
          role="status"
          aria-live="polite"
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
            paddingTop: 'var(--space-1)',
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          Contrast: {contrastInfo.text}
        </div>
      )}
    </div>
  );
}
