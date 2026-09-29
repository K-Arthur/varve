import { normalizePresentationMetadata } from './presentation/normalize';

/** v2.30 → v2.31 migration for optional presentation deck metadata. */
export function migrateV230ToV231(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...raw, formatVersion: '2.31' };
  const presentation = normalizePresentationMetadata(raw.presentation);
  return presentation ? { ...migrated, presentation } : migrated;
}
