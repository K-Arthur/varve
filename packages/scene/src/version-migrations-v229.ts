/**
 * v2.28 → v2.29 migration: reserve additive comic workflow metadata.
 *
 * All comic fields are optional, so legacy documents retain their behavior.
 * The version bump makes the document boundary explicit and gives future
 * readers a stable point at which to add defaults without changing artwork.
 */
export function migrateV228ToV229(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, formatVersion: '2.29' };
}
