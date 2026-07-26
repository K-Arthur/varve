// COMPLEXITY: 15 — entry point re-exports + migrateDocument, migrateDocumentDetailed,
// migrateDocumentJson. All three functions are thin iteration loops over migrations.
import { migrations, rehydrateEmbeddedAssetSrc } from './version-migrations';
import {
  CURRENT_DOCUMENT_VERSION,
  detectForwardCompatWarning,
  isVersionLessThan,
  type MigrationResult,
} from './version-utils';

export {
  migrations,
  normalizeLegacyBackgroundRemoval,
  rehydrateEmbeddedAssetSrc,
} from './version-migrations';
export type { DocumentMigration, MigrationResult } from './version-utils';
export {
  CURRENT_DOCUMENT_VERSION,
  detectForwardCompatWarning,
  isForwardCompatible,
  SUPPORTED_VERSIONS,
  serializeDocument,
  stampVersion,
} from './version-utils';

export function migrateDocument(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  const currentVersion = (doc.formatVersion as string) || '0.9';

  let result = { ...doc };

  for (const migration of migrations) {
    if (
      !isVersionLessThan(migration.to, currentVersion) &&
      isVersionLessThan(currentVersion, migration.to)
    ) {
      result = migration.migrate(result);
    }
  }

  if (!result.formatVersion) {
    result.formatVersion = CURRENT_DOCUMENT_VERSION;
  }

  return rehydrateEmbeddedAssetSrc(result);
}

export function migrateDocumentDetailed(raw: unknown): MigrationResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  const fromVersion = (doc.formatVersion as string) || '0.9';
  const warnings: string[] = [];

  const fwdWarn = detectForwardCompatWarning(fromVersion);
  if (fwdWarn) warnings.push(fwdWarn);

  let result = { ...doc };
  let migrated = false;

  for (const migration of migrations) {
    if (
      !isVersionLessThan(migration.to, fromVersion) &&
      isVersionLessThan(fromVersion, migration.to)
    ) {
      result = migration.migrate(result);
      migrated = true;
    }
  }

  if (!result.formatVersion) {
    result.formatVersion = CURRENT_DOCUMENT_VERSION;
  }

  return {
    document: rehydrateEmbeddedAssetSrc(result),
    fromVersion,
    toVersion: result.formatVersion as string,
    migrated,
    warnings,
  };
}

export function migrateDocumentJson(json: string): Record<string, unknown> | null {
  try {
    const trimmed = json.replace(/^\uFEFF/, '').trim();
    if (!trimmed) return null;
    const raw = JSON.parse(trimmed);
    return migrateDocument(raw);
  } catch {
    return null;
  }
}
