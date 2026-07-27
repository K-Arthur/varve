/**
 * Icon subsystem — barrel export.
 *
 * Provides SVG sanitization for untrusted icon content and the icon provider
 * abstraction for online icon discovery.
 */

export { createIconifyProvider, IconifyProvider, IconProviderError } from './iconifyProvider';
export type {
  IconLicense,
  IconPackInfo,
  IconProvider,
  IconProviderIconDetails,
  IconProviderResult,
  IconProviderSearchOptions,
  IconStyle,
  IconVariantInfo,
} from './iconProviders';
export {
  getIconProviderRegistry,
  IconProviderRegistry,
  iconProviderRegistry,
  registerIconProvider,
} from './iconProviders';
export type {
  SanitizeOptions,
  SanitizeResult,
  SanitizeWarning,
  SanitizeWarningCode,
} from './svgSanitize';
export {
  applyCurrentColor,
  isSvgSafe,
  normalizeViewBox,
  SanitizeError,
  sanitizeSvg,
} from './svgSanitize';
