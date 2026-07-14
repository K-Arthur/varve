/**
 * Font management subsystem — barrel export.
 *
 * Provides the complete font architecture: identity, catalog, parsing,
 * providers, downloading, loading, resolution, caching, licensing,
 * and usage tracking.
 *
 * Usage:
 *   import { FontCatalog, FontResolver, FontLoader } from '@strata/engine/font';
 */

// Identity and types
export type {
  FontIdentity,
  FontSourceKind,
  FontFormat,
  FontCategory,
  EmbeddingRights,
  ParsedFontMetadata,
  ParsedAxis,
  ParsedNamedInstance,
} from './fontIdentity';
export { fontIdentityKey, sameFontFace } from './fontIdentity';

// Font file parsing
export { parseFontData } from './fontParser';
export { detectFontFormat } from './fontIdentity';

// Searchable catalog
export { FontCatalog, diffCatalogs } from './fontCatalog';
export type {
  FontCatalogEntry,
  FontCatalogFilter,
  FontCatalogSort,
} from './fontCatalog';

// Provider system
export { GoogleFontsProvider, FontProviderRegistry } from './fontProviders';
export type {
  FontProvider,
  FontProviderSearchOptions,
  FontProviderResult,
  FontProviderFamily,
  FontProviderDownload,
  FontLicense,
} from './fontProviders';

// Missing font resolution
export { FontResolver, FONT_COMPAT_MAP } from './fontResolver';
export type { MissingFontInfo, FontSubstitute, FontReplacement } from './fontResolver';

// Document font usage tracking
export { FontUsageIndex, migrateLegacyFontRefs } from './fontUsageIndex';
export type { FontUsage } from './fontUsageIndex';

// License policy
export {
  FontLicensePolicy,
  KNOWN_LICENSES,
  getLicenseFromEmbeddingRights,
} from './fontLicensePolicy';
export type {
  FontLicenseInfo,
  FontPermissions,
  FontOperation,
  PolicyDecision,
} from './fontLicensePolicy';

// Caching
export { FontMetadataCache, FontBinaryCache } from './fontCache';
export type { FontCacheConfig, FontCacheEntry } from './fontCache';

// Loading and registration
export { FontLoader, detectSystemFonts } from './fontLoader';
export type { FontLoaderConfig, LoadResult } from './fontLoader';

// Download manager
export { FontDownloadManager } from './fontDownloadManager';
export type {
  DownloadJob,
  DownloadManagerConfig,
  DownloadManagerEvents,
} from './fontDownloadManager';
