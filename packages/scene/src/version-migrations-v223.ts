/** v2.22 → v2.23 migration: introduce optional generative-edit provenance. */
import { normalizeGenerativeEdits } from './generativeEdit';

export function migrateV222ToV223(raw: Record<string, unknown>): Record<string, unknown> {
  const generativeEdits = normalizeGenerativeEdits(raw.generativeEdits);
  return {
    ...raw,
    formatVersion: '2.23',
    ...(generativeEdits ? { generativeEdits } : { generativeEdits: undefined }),
  };
}
