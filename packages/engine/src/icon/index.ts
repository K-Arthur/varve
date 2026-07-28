/**
 * Icon subsystem — barrel export.
 *
 * Provides SVG sanitization, icon provider abstraction, online discovery,
 * icon auditing, variant management, export, and licensing.
 */

// Icon auditing
export type { IconAuditFinding, IconAuditResult, IconAuditSeverity } from './iconAudit';
export { auditIconCollection, auditIconSvg } from './iconAudit';
// Icon export
export type { IconExportFormat, IconExportOptions } from './iconExport';
export { exportIcon } from './iconExport';
// Provider abstraction
export { createIconifyProvider, IconifyProvider, IconProviderError } from './iconifyProvider';
// Icon licensing
export type { IconAttributionEntry, IconLicence, IconLicenceType } from './iconLicence';
export {
  canUseCommercially,
  generateAttributionReport,
  ICON_LICENCES,
  parseIconLicence,
} from './iconLicence';
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
// Icon variants
export type {
  IconState,
  IconVariantDefinition,
  IconVariantFamily,
  IconVariantStyle,
} from './iconVariants';
export {
  createIconVariant,
  createIconVariantFamily,
  getAvailableStates,
  getAvailableStyles,
  resolveVariant,
} from './iconVariants';
// SVG sanitization
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
