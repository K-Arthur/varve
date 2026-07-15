import type { ColorMode, ManagedColor } from '@strata/scene';
import { isCmykColor, isGrayColor, isRgbColor, isSpotColor } from '@strata/scene';
import { managedColorToRgba, rgbToCmyk } from '@strata/shared';
import { useCallback, useMemo, useState } from 'react';
import { CmykColorFields } from './CmykColorFields';
import { ColorArea } from './ColorArea';
import { ColorFields } from './ColorFields';
import { ColorSlider } from './ColorSlider';
import type { ColorSpace } from './ColorSpaceSelector';
import { ColorSpaceSelector } from './ColorSpaceSelector';
import type { Color } from './color-utils';
import { hsvToRgb, rgbToHex, rgbToHsv } from './color-utils';
import { contrastRatio, formatContrast, relativeLuminance, wcagLevel } from './contrast';
import { EyeDropperButton } from './EyeDropperButton';
import { GamutWarning } from './GamutWarning';
import { GrayColorFields } from './GrayColorFields';
import { SpotColorBrowser } from './SpotColorBrowser';
import { SwatchPalette } from './SwatchPalette';

export interface ColorPickerProps {
  value: ManagedColor;
  onChange: (color: ManagedColor) => void;
  bgColor?: Color;
  /** Document colour mode — when set, default initial space to match document mode. */
  documentColorMode?: ColorMode;
}

function managedColorToRgbTuple(c: ManagedColor): Color {
  return managedColorToRgba(c) as unknown as Color;
}

function initialSpace(c: ManagedColor, documentColorMode?: ColorMode): ColorSpace {
  if (isCmykColor(c)) return 'cmyk';
  if (isGrayColor(c)) return 'gray';
  if (isSpotColor(c)) return 'spot';
  // Default to document colour mode when the value is plain RGB
  if (documentColorMode === 'cmyk') return 'cmyk';
  if (documentColorMode === 'grayscale') return 'gray';
  return 'rgb';
}

export function ColorPicker({ value, onChange, bgColor, documentColorMode }: ColorPickerProps) {
  const [space, setSpace] = useState<ColorSpace>(() => initialSpace(value, documentColorMode));

  const rgbTuple = useMemo(() => managedColorToRgbTuple(value), [value]);
  const [h, s, v] = useMemo(() => rgbToHsv(rgbTuple[0], rgbTuple[1], rgbTuple[2]), [rgbTuple]);
  const [draftSat, setDraftSat] = useState(s);
  const [draftVal, setDraftVal] = useState(v);
  const [draftHue, setDraftHue] = useState(h);

  const sat = draftSat;
  const val = draftVal;
  const hue = draftHue;

  const emitRgb = useCallback(
    (r: number, g: number, b: number, a: number) => {
      if (space === 'cmyk') {
        const [c, m, y, k] = rgbToCmyk(r, g, b);
        onChange({ space: 'cmyk', c, m, y, k, a } as ManagedColor);
      } else {
        onChange({ space: 'rgb', r, g, b, a } as ManagedColor);
      }
    },
    [space, onChange],
  );

  const applyColor = useCallback(
    (hue: number, sat: number, val: number, alpha: number) => {
      const [r, g, b] = hsvToRgb(hue, sat, val);
      emitRgb(r, g, b, alpha);
    },
    [emitRgb],
  );

  const handleAreaChange = useCallback(
    (newSat: number, newVal: number) => {
      setDraftSat(newSat);
      setDraftVal(newVal);
      applyColor(hue, newSat, newVal, value.a);
    },
    [hue, value, applyColor],
  );

  const handleHueChange = useCallback(
    (newHue: number) => {
      setDraftHue(newHue);
      applyColor(newHue, sat, val, value.a);
    },
    [sat, val, value, applyColor],
  );

  const handleAlphaChange = useCallback(
    (newAlpha: number) => {
      const [r, g, b] = hsvToRgb(hue, sat, val);
      emitRgb(r, g, b, Math.round(newAlpha * 255));
    },
    [hue, sat, val, emitRgb],
  );

  const handleFieldsChange = useCallback(
    (newColor: Color) => {
      const [nh, ns, nv] = rgbToHsv(newColor[0], newColor[1], newColor[2]);
      setDraftHue(nh);
      setDraftSat(ns);
      setDraftVal(nv);
      emitRgb(newColor[0], newColor[1], newColor[2], newColor[3]);
    },
    [emitRgb],
  );

  const handleSwatchSelect = useCallback(
    (c: Color) => {
      const [nh, ns, nv] = rgbToHsv(c[0], c[1], c[2]);
      setDraftHue(nh);
      setDraftSat(ns);
      setDraftVal(nv);
      emitRgb(c[0], c[1], c[2], c[3]);
    },
    [emitRgb],
  );

  const handleEyeDropper = useCallback(
    (c: Color) => {
      const [nh, ns, nv] = rgbToHsv(c[0], c[1], c[2]);
      setDraftHue(nh);
      setDraftSat(ns);
      setDraftVal(nv);
      emitRgb(c[0], c[1], c[2], c[3]);
    },
    [emitRgb],
  );

  const handleCmykChange = useCallback(
    (c: ManagedColor) => {
      const tuple = managedColorToRgba(c);
      const [nh, ns, nv] = rgbToHsv(tuple[0], tuple[1], tuple[2]);
      setDraftHue(nh);
      setDraftSat(ns);
      setDraftVal(nv);
      onChange(c);
    },
    [onChange],
  );

  const handleGrayChange = useCallback(
    (c: ManagedColor) => {
      onChange(c);
    },
    [onChange],
  );

  const handleSpotSelect = useCallback(
    (c: ManagedColor) => {
      setSpace('spot');
      onChange(c);
    },
    [onChange],
  );

  const handleSpaceChange = useCallback((newSpace: ColorSpace) => {
    // Display-only change: switch the editing representation without
    // emitting a new colour value.  The canonical stored colour is
    // only updated when the user edits a channel value, not when they
    // switch the viewing mode.  This prevents:
    //   1. Unnecessary parent re-renders that could dismiss the picker
    //   2. Destructive round-trip drift (CMYK → RGB → CMYK → RGB)
    setSpace(newSpace);
  }, []);

  const overlayColor: Color = [rgbTuple[0], rgbTuple[1], rgbTuple[2], 255];
  const alphaVal = value.a / 255;

  const contrastInfo = useMemo(() => {
    if (!bgColor) return null;
    const l1 = relativeLuminance(rgbTuple[0], rgbTuple[1], rgbTuple[2]);
    const l2 = relativeLuminance(bgColor[0], bgColor[1], bgColor[2]);
    const ratio = contrastRatio(l1, l2);
    const level = wcagLevel(ratio, false);
    return { ratio, level, text: `${formatContrast(ratio)} ${level.toUpperCase()}` };
  }, [rgbTuple, bgColor]);

  const showAreaAndSliders = space !== 'gray' && space !== 'spot';

  return (
    <div className="color-picker">
      <ColorSpaceSelector active={space} onChange={handleSpaceChange} />

      {showAreaAndSliders && (
        <>
          <ColorArea hue={hue} saturation={sat} value={val} onChange={handleAreaChange} />

          <div className="color-picker__sliders">
            <ColorSlider channel="hue" value={hue} onChange={handleHueChange} />
            <ColorSlider
              channel="alpha"
              value={alphaVal}
              baseColor={overlayColor}
              onChange={handleAlphaChange}
            />
          </div>
        </>
      )}

      {space === 'spot' && (
        <div className="color-picker__sliders">
          <ColorSlider
            channel="alpha"
            value={alphaVal}
            baseColor={overlayColor}
            onChange={handleAlphaChange}
          />
        </div>
      )}

      <div className="color-picker__preview-row">
        <div
          className="color-picker__preview"
          style={{
            background: `rgba(${rgbTuple[0]},${rgbTuple[1]},${rgbTuple[2]},${alphaVal.toFixed(2)})`,
          }}
        />
        <div style={{ flex: 1 }}>
          <span className="color-picker__hex">
            {rgbToHex(rgbTuple[0], rgbTuple[1], rgbTuple[2])}
            {alphaVal < 1 ? ` (${Math.round(alphaVal * 100)}%)` : ''}
          </span>
        </div>
        {isRgbColor(value) && <GamutWarning r={value.r} g={value.g} b={value.b} />}
        {!isRgbColor(value) && space !== 'gray' && space !== 'spot' && (
          <GamutWarning r={rgbTuple[0]} g={rgbTuple[1]} b={rgbTuple[2]} />
        )}
        <EyeDropperButton onPick={handleEyeDropper} />
      </div>

      {space === 'rgb' && <ColorFields color={rgbTuple} onChange={handleFieldsChange} />}

      {space === 'cmyk' && (
        <CmykColorFields
          value={
            isCmykColor(value)
              ? value
              : (() => {
                  const [c, m, y, k] = rgbToCmyk(rgbTuple[0], rgbTuple[1], rgbTuple[2]);
                  return { space: 'cmyk' as const, c, m, y, k, a: value.a };
                })()
          }
          onChange={handleCmykChange}
        />
      )}

      {space === 'gray' && (
        <GrayColorFields
          value={
            isGrayColor(value)
              ? value
              : {
                  space: 'gray' as const,
                  v: Math.round((rgbTuple[0] + rgbTuple[1] + rgbTuple[2]) / 3),
                  a: value.a,
                }
          }
          onChange={handleGrayChange}
        />
      )}

      {space === 'spot' && <SpotColorBrowser onSelect={handleSpotSelect} />}

      {space !== 'spot' && (
        <div className="color-picker__swatch-section">
          <SwatchPalette onSelect={handleSwatchSelect} />
        </div>
      )}

      {contrastInfo && (
        <div className="color-picker__contrast" role="status" aria-live="polite">
          Contrast: {contrastInfo.text}
        </div>
      )}
    </div>
  );
}
