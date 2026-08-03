import type { BitDepth, ColorMode, ColorProfileRef, ManagedColor } from '@strata/scene';
import { isCmykColor, isGrayColor, isSpotColor } from '@strata/scene';
import {
  cmykToRgb,
  denormalizeChannel,
  managedColorKey,
  managedColorToRgba,
  normalizeChannel,
  rgbToCmyk,
} from '@strata/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SegmentedOption } from '../SegmentedControl';
import { SegmentedControl } from '../SegmentedControl';
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
  /** Current bit depth for high-precision workflows. */
  bitDepth?: BitDepth;
  /** Called when the user changes the bit depth. */
  onBitDepthChange?: (bitDepth: BitDepth) => void;
  /**
   * Optional gesture hooks. When provided, `onInteractionStart` fires on the
   * first pointerdown inside the picker and `onInteractionEnd` fires when the
   * gesture completes (pointerup / pointercancel / dialog dismissal). Hosts
   * use these to group a continuous drag into a single undo transaction.
   */
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  /** Document swatches shown in the picker's swatch section. */
  documentColors?: Color[];
  /** Recently used colors shown in the picker's swatch section. */
  recentColors?: Color[];
  /**
   * Document CMYK working profile. Shown as context in the CMYK view and
   * attached to newly authored CMYK values in CMYK-mode documents.
   */
  cmykProfile?: ColorProfileRef | null;
  /**
   * Color shown in the previous-color half of the preview. Hosts pass the
   * value the picker opened with so users can compare before/after edits.
   */
  previousColor?: Color;
}

function managedColorToRgbTuple(c: ManagedColor): Color {
  return managedColorToRgba(c) as unknown as Color;
}

const CMYK_PROFILE_NAMES: Record<string, string> = {
  fogra39: 'Fogra39 (ISO Coated v2 300%)',
  fogra51: 'Fogra51 (PSO Coated v3)',
  gracol2006: 'GRACoL 2006',
  'swop-coated': 'SWOP Coated v2',
  'swop-uncoated': 'SWOP Uncoated v2',
  'japan-color-2011': 'Japan Color 2011 Coated',
};

function initialSpace(c: ManagedColor, documentColorMode?: ColorMode): ColorSpace {
  if (isCmykColor(c)) return 'cmyk';
  if (isGrayColor(c)) return 'gray';
  if (isSpotColor(c)) return 'spot';
  // Default to document colour mode when the value is plain RGB
  if (documentColorMode === 'cmyk') return 'cmyk';
  if (documentColorMode === 'grayscale') return 'gray';
  return 'rgb';
}

function reinterpretBitDepth(color: ManagedColor, newBitDepth: BitDepth): ManagedColor {
  // Convert channels to normalized 0-1 float first, then denormalize to target depth
  const toNormalized = (v: number, fromDepth: BitDepth) => normalizeChannel(v, fromDepth);
  const toTarget = (v: number, toDepth: BitDepth) => denormalizeChannel(v, toDepth);

  // Spot colors don't have bit depth — return unchanged
  if (color.space === 'spot' || color.space === 'registration' || color.space === 'unresolved') {
    return color;
  }

  // Lab/LCH: bit depth only scales alpha; channels stay float.
  if (color.space === 'lab' || color.space === 'lch') {
    return { ...color, bitDepth: newBitDepth };
  }

  const sourceDepth: BitDepth = color.bitDepth ?? 'uint8';

  if (color.space === 'rgb') {
    const nR = toNormalized(color.r, sourceDepth);
    const nG = toNormalized(color.g, sourceDepth);
    const nB = toNormalized(color.b, sourceDepth);
    const nA = toNormalized(color.a, sourceDepth);
    return {
      space: 'rgb',
      bitDepth: newBitDepth,
      r: toTarget(nR, newBitDepth),
      g: toTarget(nG, newBitDepth),
      b: toTarget(nB, newBitDepth),
      a: toTarget(nA, newBitDepth),
      profile: color.profile,
    };
  }

  if (color.space === 'cmyk') {
    return { ...color, bitDepth: newBitDepth };
  }

  if (color.space === 'gray') {
    return { ...color, bitDepth: newBitDepth };
  }

  return color;
}

/**
 * Convert 0-255 uint8-scale channels into the storage range of `bitDepth`.
 * uint8 passes through; uint16 scales to 0-65535; float depths keep 0-1.
 */
function toStorageDepth(v: number, bitDepth: BitDepth): number {
  if (bitDepth === 'uint8') return Math.round(v);
  return denormalizeChannel(v / 255, bitDepth);
}

/**
 * Build an rgb/cmyk/gray ManagedColor with channels written in the given
 * bit depth. `channels` are 0-255 uint8-scale [c0, c1, c2, c3] where the
 * fourth channel is K for CMYK (unused otherwise); `alpha` is 0-1 normalized.
 */
function buildColor(
  space: 'rgb' | 'cmyk' | 'gray',
  channels: [number, number, number, number],
  alpha: number,
  bitDepth: BitDepth,
  profile?: string,
): ManagedColor {
  const [c0, c1, c2, c3] = channels;
  const base = {
    a: denormalizeChannel(alpha, bitDepth),
    profile,
    ...(bitDepth !== 'uint8' ? { bitDepth } : {}),
  };
  if (space === 'cmyk') {
    return {
      space: 'cmyk',
      c: toStorageDepth(c0, bitDepth),
      m: toStorageDepth(c1, bitDepth),
      y: toStorageDepth(c2, bitDepth),
      k: toStorageDepth(c3, bitDepth),
      ...base,
    };
  }
  if (space === 'gray') {
    return { space: 'gray', v: toStorageDepth(c0, bitDepth), ...base };
  }
  return {
    space: 'rgb',
    r: toStorageDepth(c0, bitDepth),
    g: toStorageDepth(c1, bitDepth),
    b: toStorageDepth(c2, bitDepth),
    ...base,
  };
}

export function ColorPicker({
  value,
  onChange,
  bgColor,
  documentColorMode,
  bitDepth,
  onBitDepthChange,
  onInteractionStart,
  onInteractionEnd,
  documentColors,
  recentColors,
  cmykProfile,
  previousColor,
}: ColorPickerProps) {
  const [space, setSpace] = useState<ColorSpace>(() => initialSpace(value, documentColorMode));

  const bitDepthEffective =
    bitDepth ?? ('bitDepth' in value ? value.bitDepth : undefined) ?? 'uint8';

  const rgbTuple = useMemo(() => managedColorToRgbTuple(value), [value]);
  const [h, s, v] = useMemo(() => rgbToHsv(rgbTuple[0], rgbTuple[1], rgbTuple[2]), [rgbTuple]);
  const [draftSat, setDraftSat] = useState(s);
  const [draftVal, setDraftVal] = useState(v);
  const [draftHue, setDraftHue] = useState(h);

  const sat = draftSat;
  const val = draftVal;
  const hue = draftHue;

  // Authoring space: the space in which edits are stored. Display space is a
  // view only. Edits are stored in the color's native space (CMYK stays CMYK),
  // unless the document working mode is CMYK/grayscale, in which case RGB
  // values are authored in that working space (intentional document-level
  // conversion, not a display-mode side effect).
  const authoringSpace = useMemo<ColorSpace>(() => {
    if (isCmykColor(value)) return 'cmyk';
    if (isGrayColor(value)) return 'gray';
    if (documentColorMode === 'cmyk') return 'cmyk';
    if (documentColorMode === 'grayscale') return 'gray';
    return 'rgb';
  }, [value, documentColorMode]);

  const spotProfile = 'profile' in value ? value.profile : undefined;
  const valueKey = useMemo(() => managedColorKey(value), [value]);
  const lastEmittedRef = useRef<string | null>(null);

  // Resync draft HSV when the canonical value changes externally (undo, redo,
  // selection change, gradient-stop switch). If the incoming value is our own
  // echo of a just-emitted color (same canonical key), keep the user's drafts.
  useEffect(() => {
    if (lastEmittedRef.current === valueKey) return;
    const [nr, ng, nb] = rgbTuple;
    const [nh, ns, nv] = rgbToHsv(nr, ng, nb);
    setDraftHue(nh);
    setDraftSat(ns);
    setDraftVal(nv);
  }, [valueKey, rgbTuple]);

  const emit = useCallback(
    (c: ManagedColor) => {
      lastEmittedRef.current = managedColorKey(c);
      onChange(c);
    },
    [onChange],
  );

  // `alpha` is 0-1 normalized; RGB/CMYK/gray channels are 0-255 uint8 scale.
  const authorProfile = useMemo(
    () =>
      spotProfile ??
      (documentColorMode === 'cmyk' && authoringSpace === 'cmyk' ? cmykProfile?.id : undefined),
    [spotProfile, documentColorMode, authoringSpace, cmykProfile],
  );

  const emitRgb = useCallback(
    (r: number, g: number, b: number, alpha: number) => {
      if (authoringSpace === 'cmyk') {
        const [c, m, y, k] = rgbToCmyk(r, g, b);
        emit(buildColor('cmyk', [c, m, y, k], alpha, bitDepthEffective, authorProfile));
      } else if (authoringSpace === 'gray') {
        const lum = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
        emit(buildColor('gray', [lum, 0, 0, 0], alpha, bitDepthEffective, spotProfile));
      } else {
        emit(buildColor('rgb', [r, g, b, 0], alpha, bitDepthEffective, spotProfile));
      }
    },
    [authoringSpace, bitDepthEffective, authorProfile, spotProfile, emit],
  );

  const setDraftsFromRgb = useCallback((r: number, g: number, b: number) => {
    const [nh, ns, nv] = rgbToHsv(r, g, b);
    setDraftHue(nh);
    setDraftSat(ns);
    setDraftVal(nv);
  }, []);

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
      applyColor(hue, newSat, newVal, normalizeChannel(rgbTuple[3], 'uint8'));
    },
    [hue, rgbTuple, applyColor],
  );

  const handleHueChange = useCallback(
    (newHue: number) => {
      setDraftHue(newHue);
      applyColor(newHue, sat, val, normalizeChannel(rgbTuple[3], 'uint8'));
    },
    [sat, val, rgbTuple, applyColor],
  );

  const handleAlphaChange = useCallback(
    (newAlpha: number) => {
      const [r, g, b] = hsvToRgb(hue, sat, val);
      emitRgb(r, g, b, newAlpha);
    },
    [hue, sat, val, emitRgb],
  );

  const handleFieldsChange = useCallback(
    (newColor: Color) => {
      setDraftsFromRgb(newColor[0], newColor[1], newColor[2]);
      emitRgb(newColor[0], newColor[1], newColor[2], normalizeChannel(newColor[3], 'uint8'));
    },
    [setDraftsFromRgb, emitRgb],
  );

  const handleSwatchSelect = useCallback(
    (c: Color) => {
      setDraftsFromRgb(c[0], c[1], c[2]);
      emitRgb(c[0], c[1], c[2], normalizeChannel(c[3], 'uint8'));
    },
    [setDraftsFromRgb, emitRgb],
  );

  const handleEyeDropper = useCallback(
    (c: Color) => {
      setDraftsFromRgb(c[0], c[1], c[2]);
      emitRgb(c[0], c[1], c[2], normalizeChannel(c[3], 'uint8'));
    },
    [setDraftsFromRgb, emitRgb],
  );

  const handleCmykChange = useCallback(
    (c: ManagedColor) => {
      const tuple = managedColorToRgba(c);
      setDraftsFromRgb(tuple[0], tuple[1], tuple[2]);
      if (authoringSpace === 'cmyk') {
        emit(c);
      } else if (c.space === 'cmyk') {
        // Display-only CMYK: convert back to the canonical space so the
        // stored color is not silently reinterpreted as native CMYK.
        const to255 = (v: number) =>
          denormalizeChannel(normalizeChannel(v, c.bitDepth ?? 'uint8'), 'uint8');
        const [r, g, b] = cmykToRgb(to255(c.c), to255(c.m), to255(c.y), to255(c.k));
        emitRgb(r, g, b, normalizeChannel(tuple[3], 'uint8'));
      }
    },
    [authoringSpace, setDraftsFromRgb, emit, emitRgb],
  );

  const handleGrayChange = useCallback(
    (c: ManagedColor) => {
      if (authoringSpace === 'gray') {
        emit(c);
      } else {
        const tuple = managedColorToRgba(c);
        emitRgb(tuple[0], tuple[0], tuple[0], normalizeChannel(tuple[3], 'uint8'));
      }
    },
    [authoringSpace, emit, emitRgb],
  );

  const handleSpotSelect = useCallback(
    (c: ManagedColor) => {
      setSpace('spot');
      emit(c);
    },
    [emit],
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

  const handleBitDepthChange = useCallback(
    (newBitDepth: BitDepth) => {
      onBitDepthChange?.(newBitDepth);
      // Reinterpret the current color at the new precision
      const reinterpreted = reinterpretBitDepth(value, newBitDepth);
      emit(reinterpreted);
    },
    [value, emit, onBitDepthChange],
  );

  // Gesture lifecycle: hosts wrap a continuous drag in one undo transaction.
  const gestureActiveRef = useRef(false);
  const handleRootPointerDown = useCallback(() => {
    if (gestureActiveRef.current) return;
    gestureActiveRef.current = true;
    onInteractionStart?.();
  }, [onInteractionStart]);
  const endGesture = useCallback(() => {
    if (!gestureActiveRef.current) return;
    gestureActiveRef.current = false;
    onInteractionEnd?.();
  }, [onInteractionEnd]);
  const handleRootPointerUp = useCallback(() => endGesture(), [endGesture]);

  const overlayColor: Color = [rgbTuple[0], rgbTuple[1], rgbTuple[2], 255];
  const alphaVal = normalizeChannel(value.a, bitDepthEffective);

  const contrastInfo = useMemo(() => {
    if (!bgColor) return null;
    const l1 = relativeLuminance(rgbTuple[0], rgbTuple[1], rgbTuple[2]);
    const l2 = relativeLuminance(bgColor[0], bgColor[1], bgColor[2]);
    const ratio = contrastRatio(l1, l2);
    const level = wcagLevel(ratio, false);
    return { ratio, level, text: `${formatContrast(ratio)} ${level.toUpperCase()}` };
  }, [rgbTuple, bgColor]);

  const showAreaAndSliders = space !== 'gray' && space !== 'spot';

  const bitDepthOptions: SegmentedOption<BitDepth>[] = [
    { value: 'uint8', label: '8-bit' },
    { value: 'uint16', label: '16-bit' },
    { value: 'float16', label: '16f' },
    { value: 'float32', label: '32f' },
  ];

  const cmykDisplayValue = useMemo<ManagedColor & { space: 'cmyk' }>(() => {
    if (isCmykColor(value)) return value;
    const [c, m, y, k] = rgbToCmyk(rgbTuple[0], rgbTuple[1], rgbTuple[2]);
    return buildColor(
      'cmyk',
      [c, m, y, k],
      normalizeChannel(rgbTuple[3], 'uint8'),
      bitDepthEffective,
      spotProfile,
    ) as ManagedColor & { space: 'cmyk' };
  }, [value, rgbTuple, bitDepthEffective, spotProfile]);

  const cmykProfileNote = useMemo(() => {
    if (isCmykColor(value)) {
      const label = value.profile
        ? (CMYK_PROFILE_NAMES[value.profile] ?? value.profile)
        : cmykProfile?.name;
      return label ? `Profile: ${label}` : null;
    }
    return cmykProfile
      ? `Approximate conversion for ${cmykProfile.name}`
      : 'Approximate conversion (no profile assigned)';
  }, [value, cmykProfile]);

  const grayDisplayValue = useMemo<ManagedColor & { space: 'gray' }>(() => {
    if (isGrayColor(value)) return value;
    const lum = Math.round(rgbTuple[0] * 0.299 + rgbTuple[1] * 0.587 + rgbTuple[2] * 0.114);
    return buildColor(
      'gray',
      [lum, 0, 0, 0],
      normalizeChannel(rgbTuple[3], 'uint8'),
      bitDepthEffective,
      spotProfile,
    ) as ManagedColor & { space: 'gray' };
  }, [value, rgbTuple, bitDepthEffective, spotProfile]);

  return (
    <div
      className="color-picker"
      onPointerDownCapture={handleRootPointerDown}
      onPointerUpCapture={handleRootPointerUp}
      onPointerCancelCapture={handleRootPointerUp}
    >
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
          className="color-picker__preview-pair"
          role="img"
          aria-label="Current and previous color"
        >
          <div
            className="color-picker__preview color-picker__preview--current"
            style={{
              background: `rgba(${rgbTuple[0]},${rgbTuple[1]},${rgbTuple[2]},${alphaVal.toFixed(2)})`,
            }}
          />
          {previousColor &&
            (previousColor[0] !== rgbTuple[0] ||
              previousColor[1] !== rgbTuple[1] ||
              previousColor[2] !== rgbTuple[2] ||
              previousColor[3] !== rgbTuple[3]) && (
              <div
                className="color-picker__preview color-picker__preview--previous"
                title="Previous color"
                style={{
                  background: `rgba(${previousColor[0]},${previousColor[1]},${previousColor[2]},${(
                    previousColor[3] / 255
                  ).toFixed(2)})`,
                }}
              />
            )}
        </div>
        <div style={{ flex: 1 }}>
          <span className="color-picker__hex">
            {rgbToHex(rgbTuple[0], rgbTuple[1], rgbTuple[2])}
            {alphaVal < 1 ? ` (${Math.round(alphaVal * 100)}%)` : ''}
          </span>
        </div>
        {space !== 'gray' && space !== 'spot' && (
          <GamutWarning
            r={rgbTuple[0]}
            g={rgbTuple[1]}
            b={rgbTuple[2]}
            bitDepth={bitDepth}
            documentColorMode={documentColorMode}
          />
        )}
        <EyeDropperButton onPick={handleEyeDropper} />
      </div>

      {bitDepth && onBitDepthChange && (
        <>
          <span className="color-picker__field-label">Bit depth</span>
          <SegmentedControl
            label="Bit depth"
            value={bitDepth}
            options={bitDepthOptions}
            onChange={handleBitDepthChange}
          />
        </>
      )}

      {space === 'rgb' && <ColorFields color={rgbTuple} onChange={handleFieldsChange} />}

      {space === 'cmyk' && (
        <>
          <CmykColorFields value={cmykDisplayValue} onChange={handleCmykChange} />
          <div className="color-picker__profile-note" role="note">
            {cmykProfileNote}
          </div>
        </>
      )}

      {space === 'gray' && <GrayColorFields value={grayDisplayValue} onChange={handleGrayChange} />}

      {space === 'spot' && <SpotColorBrowser onSelect={handleSpotSelect} />}

      {space !== 'spot' && (
        <div className="color-picker__swatch-section">
          <SwatchPalette
            onSelect={handleSwatchSelect}
            documentColors={documentColors}
            recentColors={recentColors}
          />
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
