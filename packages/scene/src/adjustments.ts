/**
 * Nondestructive image adjustment layer model.
 *
 * The concrete adjustment value types live in @strata/engine/filters because
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
  BlurAdjustment,
  BrightnessAdjustment,
  ChannelMixerAdjustment,
  ColorBalanceAdjustment,
  ColorBalanceTriplet,
  ContrastAdjustment,
  CurvesAdjustment,
  CurvesPoint,
  ExposureAdjustment,
  FilterIR,
  GrayscaleAdjustment,
  HueRotateAdjustment,
  InvertAdjustment,
  LevelsAdjustment,
  OpacityAdjustment,
  PhotoFilterAdjustment,
  SaturationAdjustment,
  SelectiveColorAdjustment,
  SepiaAdjustment,
  SharpenAdjustment,
  TemperatureAdjustment,
  TintAdjustment,
  VibranceAdjustment,
} from '@strata/engine';

import type { Adjustment, AdjustmentBlendMode } from '@strata/engine';

export { adjustmentDefaults, makeAdjustment } from '@strata/engine';

export interface AdjustmentLayerNode {
  id: string;
  kind: 'adjustment';
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: AdjustmentBlendMode;
  /** Adjustments applied to the composited result of all layers below this node. */
  adjustments: Adjustment[];
  /** Optional clipping mask (a child node or external shape id). */
  clipMaskId?: string;
  /** Bounds that limit where the adjustment is applied. */
  bounds?: { x: number; y: number; w: number; h: number };
}

export function visibleAdjustments(adjustments: Adjustment[]): Adjustment[] {
  return adjustments.filter((a) => a.visible && a.opacity > 0);
}

export function adjustmentEnabledCount(adjustments: Adjustment[]): number {
  return visibleAdjustments(adjustments).length;
}
