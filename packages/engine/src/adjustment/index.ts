import { buildCurveLUT, applyCurve } from './curves';
import { buildLevelsLUT, applyLevels } from './levels';
import { applySelectiveColor } from './selectiveColor';
import { computeHistogram, autoLevelsParams, computeHistogramStats } from './histogram';

export { buildCurveLUT, applyCurve };
export type { CurvePoint } from './curves';
export { buildLevelsLUT, applyLevels };
export type { LevelParams } from './levels';
export { applySelectiveColor };
export type { SelectiveColorParams, SelectiveColorTarget } from './selectiveColor';
export { computeHistogram, autoLevelsParams, computeHistogramStats };
export type { Histogram, HistogramStats } from './histogram';

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
