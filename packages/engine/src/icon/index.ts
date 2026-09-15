/**
 * Icon subsystem — barrel export.
 *
 * Provides SVG sanitization, icon provider abstraction, the Iconify API
 * client, online discovery, curated catalogue, icon auditing, variant
 * management, export, and licensing.
 */

// Provider bootstrap
export { ensureIconProviders } from './ensureProviders';
// Icon auditing
export type { IconAuditFinding, IconAuditResult, IconAuditSeverity } from './iconAudit';
export { auditIconCollection, auditIconSvg } from './iconAudit';
export type {
  IconCatalogueEntry,
  IconCatalogueGroup,
  IconCatalogueGroupId,
} from './iconCatalogue';
// Curated catalogue
export {
  DEFAULT_CATALOGUE_PREFIXES,
  ICON_CATALOGUE,
  ICON_CATALOGUE_GROUPS,
  isBrandPack,
} from './iconCatalogue';
// Icon export
export type { IconExportFormat, IconExportOptions } from './iconExport';
export { exportIcon } from './iconExport';
export type {
  IconifyClientDiagnostic,
  IconifyClientErrorCode,
  IconifyClientOptions,
  IconifyCollectionInfo,
  IconifyCollectionResponse,
  IconifyIconData,
  IconifyIconsResponse,
  IconifyKeywordsResponse,
  IconifyRequestOptions,
  IconifySearchResponse,
} from './iconifyClient';
// Iconify API client
export {
  getIconifyClient,
  ICONIFY_BACKUP_HOSTS,
  ICONIFY_CSP_HOSTS,
  ICONIFY_HOSTS,
  ICONIFY_PRIMARY_HOST,
  IconifyClient,
  IconifyClientError,
  setDefaultClient,
} from './iconifyClient';
// Iconify provider
export { buildSvgFromIconData, createIconifyProvider, IconifyProvider } from './iconifyProvider';
// Icon licensing
export type {
  IconAttributionEntry,
  IconLicence,
  IconLicenceSnapshot,
  IconLicenceType,
  LicencePolicyProfile,
} from './iconLicence';
export {
  canUseCommercially,
  generateAttributionMarkdown,
  generateAttributionReport,
  ICON_LICENCE_POLICY,
  ICON_LICENCES,
  isCommercialSafe,
  parseIconLicence,
  resolveLicenceSnapshot,
} from './iconLicence';
// Provider abstraction
export type {
  IconPackInfo,
  IconPaletteType,
  IconProvider,
  IconProviderCapability,
  IconProviderErrorCode,
  IconProviderSearchOptions,
  IconSearchPage,
  IconSourceDescriptor,
  IconStyle,
} from './iconProviders';
export {
  descriptorMatchesQuery,
  expandSearchTokens,
  getIconProviderRegistry,
  ICON_PROVIDER_CAPABILITIES,
  IconProviderError,
  IconProviderRegistry,
  normalizeIconQuery,
  registerIconProvider,
  resetIconProviderRegistry,
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
  rewriteSvgIds,
  SanitizeError,
  sanitizeSvg,
} from './svgSanitize';
