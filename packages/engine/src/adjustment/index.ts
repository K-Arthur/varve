import { applyCurve, buildCurveLUT } from './curves';
import {
  autoContrastParams,
  autoLevelsParams,
  autoWhiteBalanceParams,
  computeHistogram,
  computeHistogramStats,
} from './histogram';
import { applyHueSaturation } from './hueSaturation';
import { applyLevels, buildLevelsLUT } from './levels';
import { applySelectiveColor } from './selectiveColor';
import { applyShadowHighlight } from './shadowHighlight';

export type { CurvePoint } from './curves';
export type { Histogram, HistogramStats } from './histogram';
export type {
  HueSaturationParams,
  HueSaturationRange,
  HueSaturationRangeParams,
} from './hueSaturation';
export type { LevelParams } from './levels';
export type { SelectiveColorParams, SelectiveColorTarget } from './selectiveColor';
export type { ShadowHighlightParams } from './shadowHighlight';
export {
  applyCurve,
  applyHueSaturation,
  applyLevels,
  applySelectiveColor,
  applyShadowHighlight,
  autoContrastParams,
  autoLevelsParams,
  autoWhiteBalanceParams,
  buildCurveLUT,
  buildLevelsLUT,
  computeHistogram,
  computeHistogramStats,
};

export type AdjustmentChannel = 'rgb' | 'red' | 'green' | 'blue';

export interface AdjustmentParams {
  curves?: { channel: AdjustmentChannel; points: import('./curves').CurvePoint[] };
  levels?: { channel: AdjustmentChannel; params: Partial<import('./levels').LevelParams> };
  selectiveColor?: import('./selectiveColor').SelectiveColorParams[];
}

export function applyAdjustment(
  imageData: ImageData,
  type: string,
  params: AdjustmentParams,
): ImageData {
  switch (type) {
    case 'curves':
      if (params.curves) {
        const lut = buildCurveLUT(params.curves.points);
        return applyCurve(imageData, params.curves.channel, lut);
      }
      return imageData;
    case 'levels':
      if (params.levels) {
        return applyLevels(imageData, params.levels.channel, params.levels.params);
      }
      return imageData;
    case 'selectiveColor':
      if (params.selectiveColor) {
        return applySelectiveColor(imageData, params.selectiveColor);
      }
      return imageData;
    default:
      return imageData;
  }
}
