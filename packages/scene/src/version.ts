export const CURRENT_DOCUMENT_VERSION = '1.0';

export const SUPPORTED_VERSIONS = ['1.0'];

export interface DocumentMigration {
  from: string;
  to: string;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

const migrations: DocumentMigration[] = [
  {
    from: '0.9',
    to: '1.0',
    migrate: (raw) => ({
      ...raw,
      formatVersion: '1.0',
      canvasWidth: raw.canvasWidth ?? 1440,
      canvasHeight: raw.canvasHeight ?? 1024,
    }),
  },
];

export interface MigrationResult {
  document: Record<string, unknown>;
  fromVersion: string;
  toVersion: string;
  migrated: boolean;
  warnings: string[];
}

function parseVersion(v: string): number[] {
  return v.split('.').map((s) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

function isVersionLessThan(a: string, b: string): boolean {
  const [aMajor = 0, aMinor = 0] = parseVersion(a);
  const [bMajor = 0, bMinor = 0] = parseVersion(b);
  return aMajor < bMajor || (aMajor === bMajor && aMinor < bMinor);
}

export function stampVersion<T extends { formatVersion?: string }>(
  doc: T,
): T & { formatVersion: string } {
  return { ...doc, formatVersion: CURRENT_DOCUMENT_VERSION };
}

export function isForwardCompatible(fileVersion: string): boolean {
  const [fMajor = 0, fMinor = 0] = parseVersion(fileVersion);
  const [cMajor = 0, cMinor = 0] = parseVersion(CURRENT_DOCUMENT_VERSION);
  return fMajor < cMajor || (fMajor === cMajor && fMinor <= cMinor);
}

export function detectForwardCompatWarning(fileVersion: string): string | null {
  if (!isForwardCompatible(fileVersion)) {
    return `File version ${fileVersion} is newer than current version ${CURRENT_DOCUMENT_VERSION}. Some features may not be supported.`;
  }
  return null;
}

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

  return result;
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
    document: result,
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
