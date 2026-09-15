/** v2.22 → v2.23 migration: introduce optional generative-edit provenance. */

export function migrateV222ToV223(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    formatVersion: '2.23',
    // v2.23 records used schema 1. Keep the raw collection intact here so
    // the v2.25 migration can upgrade it instead of the current validator
    // dropping it before the migration gets a chance to run.
    ...(raw.generativeEdits !== undefined ? { generativeEdits: raw.generativeEdits } : {}),
  };
}
