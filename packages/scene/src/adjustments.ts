/**
 * Nondestructive image adjustment layer model.
 *
 * The concrete adjustment value types live in @varve/engine/filters because
 * they are part of the render IR contract. This module re-exports them and adds
 * the scene-level adjustment layer node + helpers.
 *
 * Research basis: Adobe Photoshop adjustment layers, CSS filter functions,
 * SVG filters, WebGPU compute-based color grading.
 */

export type {
  Adjustment,
  AdjustmentBase,
  AdjustmentBlendMode,
  AdjustmentKind,
  BlackAndWhiteAdjustment,
  BloomAdjustment,
  BlurAdjustment,
  BrightnessAdjustment,
  CausticsAdjustment,
  ChannelMixerAdjustment,
  ColorBalanceAdjustment,
  ColorBalanceTriplet,
  ContrastAdjustment,
  CrtAdjustment,
  CurvesAdjustment,
  CurvesPoint,
  DitherAdjustment,
  DuotoneAdjustment,
  ExposureAdjustment,
  FilterIR,
  GradientMapAdjustment,
  GradientMapStop,
  GrayscaleAdjustment,
  HalftoneAdjustment,
  HalftonePreset,
  HueRotateAdjustment,
  InvertAdjustment,
  LensFlareAdjustment,
  LevelsAdjustment,
  LightLeakAdjustment,
  LightShaftsAdjustment,
  OpacityAdjustment,
  PaletteSnapAdjustment,
  PhotoFilterAdjustment,
  PosterizeAdjustment,
  RgbSplitAdjustment,
  SaturationAdjustment,
  SelectiveColorAdjustment,
  SepiaAdjustment,
  SharpenAdjustment,
  TemperatureAdjustment,
  ThresholdAdjustment,
  TintAdjustment,
  TritoneAdjustment,
  VhsAdjustment,
  VibranceAdjustment,
} from '@varve/engine';

import type { Adjustment } from '@varve/engine';

export { adjustmentDefaults, makeAdjustment } from '@varve/engine';

// Note: the scene-level adjustment-layer node type is `AdjustmentNode`
// (defined in ./types, part of the `SceneNode` union). This module used to
// define a second, structurally incompatible `AdjustmentLayerNode` interface
// that also claimed `kind: 'adjustment'` but was never part of `SceneNode` —
// consumers cast between the two unsafely. Use `AdjustmentNode` instead; its
// `adjustments` field is optional (`Adjustment[] | undefined`), so treat an
// absent stack as `[]` rather than assuming it is always populated.

export function visibleAdjustments(adjustments: Adjustment[]): Adjustment[] {
  return adjustments.filter((a) => a.visible && a.opacity > 0);
}

export function adjustmentEnabledCount(adjustments: Adjustment[]): number {
  return visibleAdjustments(adjustments).length;
}
