/**
 * @strata/engine/lut — LUT colour transform subsystem.
 *
 * Provides data types, parsers, interpolation, application, and export
 * for 1D and 3D lookup tables.
 */

export { applyLutToImageData } from './apply';
export type { BakeOptions, BakeResult } from './bake';
export { bakeFiltersToLut } from './bake';
export { exportLutToCube } from './exportCube';
export {
  applyLut1D,
  sampleLut1D,
  sampleLut3D,
  sampleLut3DTetrahedral,
  sampleLut3DTrilinear,
} from './interpolate';
export type { LutFileFormat, LutImportResult } from './lutService';
export {
  deserializeLutFromDocument,
  detectLutFormat,
  estimateLutMemoryUsage,
  fingerprintLut,
  MAX_LUT_TEXT_LENGTH,
  parseLutFile,
  serializeLutForDocument,
} from './lutService';
export type { Parse3dlResult } from './parse3dl';
export { Parse3dlError, parse3dlData } from './parse3dl';
export type { ParseCubeError, ParseCubeResult } from './parseCube';
export { CubeParseError, parseCubeData } from './parseCube';
export type {
  Lut1D,
  Lut3D,
  LutAdjustmentParams,
  LutExportDomain,
  LutInputSpace,
  LutInterpolation,
  LutMetadata,
  LutTransform,
  LutType,
  Shaper3D,
} from './types';
export {
  DEFAULT_LUT_INTERPOLATION,
  LUT_FORMAT_LABELS,
  LUT_INPUT_SPACE_LABELS,
  LUT_SUPPORTED_EXTENSIONS,
  lutFormatSupports,
  makeIdentityLut1D,
  makeIdentityLut3D,
} from './types';
