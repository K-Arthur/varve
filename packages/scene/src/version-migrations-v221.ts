/**
 * v2.20 → v2.21 migration: Email template support.
 *
 * Adds optional `emailProfile` and `emailSemantics` fields to the document.
 * Both are optional — existing documents have none and work unchanged.
 * No per-node changes are required.
 */
export function migrateV220ToV221(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    formatVersion: '2.21',
    // emailProfile and emailSemantics are optional — undefined is correct
    // for documents that don't use the email template system.
  };
}
