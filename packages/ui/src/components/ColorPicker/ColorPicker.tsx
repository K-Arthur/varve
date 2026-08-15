import type { BitDepth, ColorMode, ColorProfileRef, ManagedColor } from '@varve/scene';
import { isCmykColor, isGrayColor, isLabColor, isLchColor, isSpotColor } from '@varve/scene';
import {
  applyProofToRgba,
  cmykToRgb,
  denormalizeChannel,
  isColorOutOfProofGamut,
  labToLch,
  labToXyz,
  lchToLab,
  managedColorKey,
  managedColorToRgba,
  normalizeChannel,
  normalizeHueDegrees,
  rgbToCmyk,
  rgbToLab,
  xyzD65ToLinearRgb,
} from '@varve/shared';
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
import { hsvToRgbNormalized, rgbToHex, rgbToHsvFloat } from './color-utils';
import { contrastRatio, formatContrast, relativeLuminance, wcagLevel } from './contrast';
import { EyeDropperButton } from './EyeDropperButton';
import { GamutWarning } from './GamutWarning';
import { GrayColorFields } from './GrayColorFields';
import { type LabChannelValues, LabColorFields } from './LabColorFields';
import { type LchChannelValues, LchColorFields } from './LchColorFields';
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
  /** Document swatches shown in the picker's swatch section (canonical). */
  documentColors?: ManagedColor[];
  /** Recently used colors shown in the picker's swatch section (canonical). */
  recentColors?: ManagedColor[];
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
  /** Display-only proof configuration (soft proofing). */
  proofConfig?: import('@varve/shared').ProofTransformConfig | null;
  /** Session-scoped proof toggle. */
  proofEnabled?: boolean;
  onProofToggle?: (enabled: boolean) => void;
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
  if (isLabColor(c)) return 'lab';
  if (isLchColor(c)) return 'lch';
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
  proofConfig,
  proofEnabled = false,
  onProofToggle,
}: ColorPickerProps) {
  const [space, setSpace] = useState<ColorSpace>(() => initialSpace(value, documentColorMode));

  const bitDepthEffective =
    bitDepth ?? ('bitDepth' in value ? value.bitDepth : undefined) ?? 'uint8';

  const rgbTuple = useMemo(() => managedColorToRgbTuple(value), [value]);

  // Canonical normalized (0-1) channels of the value — used as the source
  // for untouched channels in the numeric fields. Only RGB-space values
  // map 1:1; CMYK/gray/Lab values fall back to the display tuple.
  const canonicalRgbNormalized = useMemo<[number, number, number, number] | undefined>(() => {
    if (value.space !== 'rgb') return undefined;
    const depth = value.bitDepth ?? 'uint8';
    return [
      normalizeChannel(value.r, depth),
      normalizeChannel(value.g, depth),
      normalizeChannel(value.b, depth),
      normalizeChannel(value.a, depth),
    ];
  }, [value]);

  // HSV drafts are seeded from the canonical normalized value (not the 8-bit
  // display tuple) so slider/area edits of a high-precision color do not
  // collapse channels to the 8-bit lattice.
  const hsvSeed = useMemo(() => {
    const base = canonicalRgbNormalized ?? [
      rgbTuple[0] / 255,
      rgbTuple[1] / 255,
      rgbTuple[2] / 255,
    ];
    return rgbToHsvFloat(base[0], base[1], base[2]);
  }, [canonicalRgbNormalized, rgbTuple]);
  const [h, s, v] = hsvSeed;
  const [draftSat, setDraftSat] = useState(s);
  const [draftVal, setDraftVal] = useState(v);
  const [draftHue, setDraftHue] = useState(h);

  // Lab/LCH draft values. Seeded from the canonical value without a
  // round-trip when the value is already Lab/LCH; otherwise derived from
  // the sRGB preview. The alpha channel is percent (0-100) display form.
  const [draftLab, setDraftLab] = useState<LabChannelValues>(() => {
    if (isLabColor(value)) {
      return {
        l: value.l,
        av: value.av,
        b: value.b,
        alpha: normalizeChannel(value.a, value.bitDepth ?? 'uint8') * 100,
      };
    }
    const [lr, lg, lb] = rgbToLab(rgbTuple[0], rgbTuple[1], rgbTuple[2]);
    return { l: lr, av: lg, b: lb, alpha: normalizeChannel(rgbTuple[3], 'uint8') * 100 };
  });
  const [draftLch, setDraftLch] = useState<LchChannelValues>(() => {
    if (isLchColor(value)) {
      return {
        l: value.l,
        c: value.c,
        h: value.h,
        alpha: normalizeChannel(value.a, value.bitDepth ?? 'uint8') * 100,
      };
    }
    const [lr, lg, lb] = isLabColor(value)
      ? [value.l, value.av, value.b]
      : rgbToLab(rgbTuple[0], rgbTuple[1], rgbTuple[2]);
    const [cl, cc, ch] = labToLch([lr, lg, lb]);
    return { l: cl, c: cc, h: ch, alpha: normalizeChannel(rgbTuple[3], 'uint8') * 100 };
  });

  // Achromatic hue memory: while chroma is (near) zero the hue is
  // perceptually undefined, but the LAST meaningful hue is retained so
  // users can re-add chroma without a hue jump.
  const lastHueRef = useRef<number>(draftLch.h);
  if (draftLch.c > 0.1) lastHueRef.current = draftLch.h;

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
    const [nh, ns, nv] = hsvSeed;
    setDraftHue(nh);
    setDraftSat(ns);
    setDraftVal(nv);
  }, [valueKey, hsvSeed]);

  // Same resync for Lab/LCH drafts. Values that ARE Lab/LCH seed directly
  // (no sRGB round trip) so external edits do not accumulate drift.
  useEffect(() => {
    if (lastEmittedRef.current === valueKey) return;
    const [nr, ng, nb, na] = rgbTuple;
    let labSeed: [number, number, number];
    if (isLabColor(value)) {
      labSeed = [value.l, value.av, value.b];
    } else if (isLchColor(value)) {
      labSeed = lchToLab([value.l, value.c, value.h]);
    } else {
      labSeed = rgbToLab(nr, ng, nb);
    }
    const alpha = normalizeChannel(na, 'uint8') * 100;
    setDraftLab({ l: labSeed[0], av: labSeed[1], b: labSeed[2], alpha });
    const [cl, cc, ch] = labToLch(labSeed);
    setDraftLch({ l: cl, c: cc, h: ch, alpha });
  }, [valueKey, rgbTuple, value]);

  const emit = useCallback(
    (c: ManagedColor) => {
      lastEmittedRef.current = managedColorKey(c);
      onChange(c);
    },
    [onChange],
  );

  // `alpha` is 0-1 normalized. `emitRgbNormalized` takes normalized RGB
  // (0-1) and alpha (0-1); it is the precision-preserving emit used by the
  // HSV area/slider drafts and the bit-depth-aware numeric fields. The
  // legacy `emitRgb` (0-255 uint8-scale channels) delegates to it and is
  // only used by inherently 8-bit inputs (hex, eyedropper, legacy swatches).
  const authorProfile = useMemo(
    () =>
      spotProfile ??
      (documentColorMode === 'cmyk' && authoringSpace === 'cmyk' ? cmykProfile?.id : undefined),
    [spotProfile, documentColorMode, authoringSpace, cmykProfile],
  );

  const emitRgbNormalized = useCallback(
    (r: number, g: number, b: number, alpha: number) => {
      const toStorage = (v: number) => denormalizeChannel(v, bitDepthEffective);
      if (authoringSpace === 'cmyk') {
        const [c, m, y, k] = rgbToCmyk(r * 255, g * 255, b * 255);
        emit(buildColor('cmyk', [c, m, y, k], alpha, bitDepthEffective, authorProfile));
      } else if (authoringSpace === 'gray') {
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        emit(buildColor('gray', [lum * 255, 0, 0, 0], alpha, bitDepthEffective, spotProfile));
      } else {
        emit({
          space: 'rgb',
          bitDepth: bitDepthEffective !== 'uint8' ? bitDepthEffective : undefined,
          r: toStorage(r),
          g: toStorage(g),
          b: toStorage(b),
          a: toStorage(alpha),
          ...(spotProfile ? { profile: spotProfile } : {}),
        });
      }
    },
    [authoringSpace, bitDepthEffective, authorProfile, spotProfile, emit],
  );

  const emitRgb = useCallback(
    (r: number, g: number, b: number, alpha: number) => {
      emitRgbNormalized(r / 255, g / 255, b / 255, alpha);
    },
    [emitRgbNormalized],
  );

  const setDraftsFromRgb = useCallback((r01: number, g01: number, b01: number) => {
    const [nh, ns, nv] = rgbToHsvFloat(r01, g01, b01);
    setDraftHue(nh);
    setDraftSat(ns);
    setDraftVal(nv);
  }, []);

  const applyColor = useCallback(
    (hue: number, sat: number, val: number, alpha: number) => {
      const [r, g, b] = hsvToRgbNormalized(hue, sat, val);
      emitRgbNormalized(r, g, b, alpha);
    },
    [emitRgbNormalized],
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

  const handleFieldsChange = useCallback(
    (r01: number, g01: number, b01: number, a01: number) => {
      setDraftsFromRgb(r01, g01, b01);
      emitRgbNormalized(r01, g01, b01, a01);
    },
    [setDraftsFromRgb, emitRgbNormalized],
  );

  // Legacy 0-255 tuple emit — retained for callers that don't use the
  // normalized path (standalone ColorFields usage).
  const handleFieldsChangeLegacy = useCallback(
    (newColor: Color) => {
      handleFieldsChange(
        newColor[0] / 255,
        newColor[1] / 255,
        newColor[2] / 255,
        newColor[3] / 255,
      );
    },
    [handleFieldsChange],
  );

  // Swatch selection carries the canonical ManagedColor: a swatch in its
  // native space (matching the authoring space) is emitted unchanged at full
  // precision; an RGB swatch is emitted through the normalized path so
  // uint16/float channel values survive; other spaces convert via the
  // display tuple into the authoring space.
  const handleSwatchSelect = useCallback(
    (c: ManagedColor) => {
      if (c.space === authoringSpace && c.space !== 'rgb') {
        const tuple = managedColorToRgba(c);
        setDraftsFromRgb(tuple[0] / 255, tuple[1] / 255, tuple[2] / 255);
        emit(c);
        return;
      }
      if (c.space === 'rgb') {
        const depth = c.bitDepth ?? 'uint8';
        const r01 = normalizeChannel(c.r, depth);
        const g01 = normalizeChannel(c.g, depth);
        const b01 = normalizeChannel(c.b, depth);
        const a01 = normalizeChannel(c.a, depth);
        setDraftsFromRgb(r01, g01, b01);
        emitRgbNormalized(r01, g01, b01, a01);
        return;
      }
      const tuple = managedColorToRgba(c);
      setDraftsFromRgb(tuple[0] / 255, tuple[1] / 255, tuple[2] / 255);
      emitRgb(tuple[0], tuple[1], tuple[2], normalizeChannel(tuple[3], 'uint8'));
    },
    [authoringSpace, emit, emitRgb, emitRgbNormalized, setDraftsFromRgb],
  );

  const handleEyeDropper = useCallback(
    (c: Color) => {
      setDraftsFromRgb(c[0] / 255, c[1] / 255, c[2] / 255);
      emitRgb(c[0], c[1], c[2], normalizeChannel(c[3], 'uint8'));
    },
    [setDraftsFromRgb, emitRgb],
  );

  const handleCmykChange = useCallback(
    (c: ManagedColor) => {
      const tuple = managedColorToRgba(c);
      setDraftsFromRgb(tuple[0] / 255, tuple[1] / 255, tuple[2] / 255);
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
        setDraftsFromRgb(tuple[0] / 255, tuple[0] / 255, tuple[0] / 255);
        emitRgb(tuple[0], tuple[0], tuple[0], normalizeChannel(tuple[3], 'uint8'));
      }
    },
    [authoringSpace, emit, emitRgb, setDraftsFromRgb],
  );

  // Lab authoring: emit a canonical LabColor (device-independent; valid in
  // any document mode). Alpha is scaled to the color's bit depth. Lab values
  // may be out of the display gamut — they are stored unclipped and only
  // the preview clips.
  const handleLabChange = useCallback(
    (next: LabChannelValues) => {
      const alpha = denormalizeChannel(next.alpha / 100, bitDepthEffective);
      const bitDepth = bitDepthEffective !== 'uint8' ? bitDepthEffective : undefined;
      emit({
        space: 'lab',
        l: next.l,
        av: next.av,
        b: next.b,
        a: alpha,
        ...(bitDepth ? { bitDepth } : {}),
        ...(spotProfile ? { profile: spotProfile } : {}),
      });
    },
    [bitDepthEffective, spotProfile, emit],
  );

  // LCH authoring: chroma normalized to >= 0, hue wrapped to [0, 360).
  // Achromatic drafts keep the last meaningful hue for editing continuity
  // but the serialized value is valid at any chroma.
  const handleLchChange = useCallback(
    (next: LchChannelValues) => {
      const alpha = denormalizeChannel(next.alpha / 100, bitDepthEffective);
      const bitDepth = bitDepthEffective !== 'uint8' ? bitDepthEffective : undefined;
      emit({
        space: 'lch',
        l: next.l,
        c: Math.max(0, next.c),
        h: normalizeHueDegrees(next.h),
        a: alpha,
        ...(bitDepth ? { bitDepth } : {}),
        ...(spotProfile ? { profile: spotProfile } : {}),
      });
    },
    [bitDepthEffective, spotProfile, emit],
  );

  const handleAlphaChange = useCallback(
    (newAlpha: number) => {
      if (space === 'lab') {
        handleLabChange({ ...draftLab, alpha: newAlpha * 100 });
        return;
      }
      if (space === 'lch') {
        handleLchChange({ ...draftLch, alpha: newAlpha * 100 });
        return;
      }
      const [r, g, b] = hsvToRgbNormalized(hue, sat, val);
      emitRgbNormalized(r, g, b, newAlpha);
    },
    [space, draftLab, draftLch, hue, sat, val, handleLabChange, handleLchChange, emitRgbNormalized],
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

  const showAreaAndSliders = space === 'rgb' || space === 'cmyk';

  // Lab/LCH gamut status vs the sRGB display space: true when the
  // authoritative value falls outside the display gamut. The preview is
  // clipped but the stored value is never touched. Text-based notice, not
  // color-only. Tolerance 1e-3 absorbs round-trip noise at the gamut
  // boundary (colors exactly on the boundary must not be flagged).
  const labLchOutOfGamut = useMemo(() => {
    if (space !== 'lab' && space !== 'lch') return false;
    const lab: [number, number, number] =
      space === 'lab'
        ? [draftLab.l, draftLab.av, draftLab.b]
        : lchToLab([draftLch.l, draftLch.c, draftLch.h]);
    const linear = xyzD65ToLinearRgb(labToXyz(lab));
    return linear.some((v) => v < -1e-3 || v > 1 + 1e-3);
  }, [space, draftLab, draftLch]);

  // Soft-proof preview: display-only transform of the current color under
  // the proof condition. Never mutates the selected color.
  const proofResult = useMemo(() => {
    if (!proofEnabled || !proofConfig) return null;
    return applyProofToRgba(
      [rgbTuple[0], rgbTuple[1], rgbTuple[2], Math.round(alphaVal * 255)],
      proofConfig,
    );
  }, [proofEnabled, proofConfig, rgbTuple, alphaVal]);

  // Proof-condition gamut status (replaces the heuristic warning when a
  // profile converter is registered).
  const proofGamutStatus = useMemo(() => {
    if (!proofConfig) return null;
    return isColorOutOfProofGamut([rgbTuple[0], rgbTuple[1], rgbTuple[2], 255], proofConfig);
  }, [proofConfig, rgbTuple]);

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
        {proofResult && (
          <div
            className="color-picker__proof"
            title={
              proofResult.kind === 'unavailable'
                ? 'Accurate soft proofing is unavailable in this runtime'
                : `Proofed for ${proofConfig?.profileName ?? proofConfig?.profileId}`
            }
          >
            <span
              className="color-picker__proof-swatch"
              style={{
                background: `rgba(${proofResult.rgba[0]},${proofResult.rgba[1]},${proofResult.rgba[2]},${(
                  proofResult.rgba[3] / 255
                ).toFixed(2)})`,
              }}
            />
            <span className="color-picker__proof-label">
              {proofResult.kind === 'unavailable'
                ? 'Proof unavailable'
                : `Proof: ${proofConfig?.profileName ?? proofConfig?.profileId}`}
            </span>
          </div>
        )}
        {proofConfig && onProofToggle && (
          <button
            type="button"
            className={`color-picker__proof-toggle${proofEnabled ? ' color-picker__proof-toggle--active' : ''}`}
            aria-pressed={proofEnabled}
            onClick={() => onProofToggle(!proofEnabled)}
          >
            Proof
          </button>
        )}
        {space !== 'gray' &&
          space !== 'spot' &&
          space !== 'lab' &&
          space !== 'lch' &&
          proofConfig == null && (
            <GamutWarning
              r={rgbTuple[0]}
              g={rgbTuple[1]}
              b={rgbTuple[2]}
              bitDepth={bitDepth}
              documentColorMode={documentColorMode}
            />
          )}
        {proofConfig != null && proofGamutStatus === true && (
          <span className="color-picker__proof-gamut" role="note">
            Out of proof gamut
          </span>
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

      {space === 'rgb' && (
        <ColorFields
          color={rgbTuple}
          bitDepth={bitDepthEffective}
          canonicalNormalized={canonicalRgbNormalized}
          onChangeNormalized={handleFieldsChange}
          onChange={handleFieldsChangeLegacy}
        />
      )}

      {space === 'cmyk' && (
        <>
          <CmykColorFields value={cmykDisplayValue} onChange={handleCmykChange} />
          <div className="color-picker__profile-note" role="note">
            {cmykProfileNote}
          </div>
        </>
      )}

      {space === 'gray' && <GrayColorFields value={grayDisplayValue} onChange={handleGrayChange} />}

      {space === 'lab' && (
        <>
          <div className="color-picker__sliders">
            <ColorSlider
              channel="alpha"
              value={alphaVal}
              baseColor={overlayColor}
              onChange={handleAlphaChange}
            />
          </div>
          <LabColorFields
            value={draftLab}
            onChange={handleLabChange}
            outOfGamut={labLchOutOfGamut}
          />
        </>
      )}

      {space === 'lch' && (
        <>
          <div className="color-picker__sliders">
            <ColorSlider
              channel="hue"
              value={draftLch.h}
              onChange={(h) => handleLchChange({ ...draftLch, h })}
            />
            <ColorSlider
              channel="alpha"
              value={alphaVal}
              baseColor={overlayColor}
              onChange={handleAlphaChange}
            />
          </div>
          <LchColorFields
            value={draftLch}
            onChange={handleLchChange}
            outOfGamut={labLchOutOfGamut}
          />
        </>
      )}

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
