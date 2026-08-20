/**
 * Font management subsystem — barrel export.
 *
 * Provides the complete font architecture: identity, catalog, parsing,
 * providers, downloading, loading, resolution, caching, licensing,
 * and usage tracking.
 *
 * Usage:
 *   import { FontCatalog, FontResolver, FontLoader } from '@varve/engine/font';
 */

export type { UnifiedFontInfo } from './fontBridge';
// Bridge between FontRegistry and FontCatalog
export { FontBridge } from './fontBridge';
export type { FontCacheConfig, FontCacheEntry } from './fontCache';
// Caching
export { FontBinaryCache, FontMetadataCache } from './fontCache';
export type {
  FontCatalogEntry,
  FontCatalogFilter,
  FontCatalogSort,
} from './fontCatalog';
// Searchable catalog
export { diffCatalogs, FontCatalog } from './fontCatalog';
// Font data collector (binary retrieval for export)
export type { FontCollectOptions, FontDataRecord } from './fontDataCollector';
export { collectAllStoredFonts, collectFontData } from './fontDataCollector';
export type {
  DownloadJob,
  DownloadManagerConfig,
  DownloadManagerEvents,
} from './fontDownloadManager';
// Download manager
export { FontDownloadManager } from './fontDownloadManager';
// Identity and types
export type {
  EmbeddingRights,
  FontCategory,
  FontFormat,
  FontIdentity,
  FontSourceKind,
  ParsedAxis,
  ParsedFontMetadata,
  ParsedNamedInstance,
} from './fontIdentity';
export { detectFontFormat, fontIdentityKey, sameFontFace } from './fontIdentity';
export type {
  FontLicenseInfo,
  FontOperation,
  FontPermissions,
  PolicyDecision,
} from './fontLicensePolicy';
// License policy
export {
  FontLicensePolicy,
  getLicenseFromEmbeddingRights,
  KNOWN_LICENSES,
} from './fontLicensePolicy';
// Loading and registration
export type { FontLoaderConfig, LoadResult, SystemFontFace } from './fontLoader';
export {
  detectSystemFonts,
  enumerateSystemFonts,
  FontLoader,
  getCachedLocalFontMetadata,
  hasQueryLocalFonts,
  resetSystemFontCache,
} from './fontLoader';
export type {
  BuildManifestOptions,
  FontManifest,
  FontManifestStatus,
} from './fontManifest';
// Document font manifest
export {
  buildDocumentFontManifest,
  resolveManifestAgainstCatalog,
} from './fontManifest';
// Font file parsing
export { parseFontData } from './fontParser';
export type { FontPersistenceResult } from './fontPersistence';
// Document font manifest persistence (save/load integration)
export {
  attachFontManifestToDocument,
  resolveFontManifestForLoadedDocument,
} from './fontPersistence';
export type {
  FontLicense,
  FontProvider,
  FontProviderDownload,
  FontProviderFamily,
  FontProviderResult,
  FontProviderSearchOptions,
} from './fontProviders';
// Provider system
export { FontProviderRegistry, FontsourceProvider, GoogleFontsProvider } from './fontProviders';
export type {
  FontReplacement,
  FontSubstitute,
  MissingFontInfo,
  ResolverDocument,
} from './fontResolver';
// Missing font resolution
export { FONT_COMPAT_MAP, FontResolver } from './fontResolver';
// Tauri filesystem font storage adapter
export type { FontStorageFsMeta } from './fontStorageFs';
export {
  getFilesystemFontStorageUsage,
  isFilesystemFontStorageAvailable,
  listFilesystemFonts,
  loadFontFromFilesystem,
  removeFontFromFilesystem,
  storeFontOnFilesystem,
} from './fontStorageFs';
export type { FontUsage } from './fontUsageIndex';
// Document font usage tracking
export { FontUsageIndex, migrateLegacyFontRefs } from './fontUsageIndex';
