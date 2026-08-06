/**
 * V2.15 → V2.16 migration: sanitize the warp modifier stack.
 *
 * The `warps` field on nodes and `warpSettings` are validated on ingest —
 * malformed known entries are dropped, unknown future kinds are preserved
 * inert, and limits are enforced — so every reader can assume well-typed,
 * finite warp data after migration.
 */

import { validateWarpModifiers, validateWarpSettings } from '@varve/engine';

export function migrateV215ToV216(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw, formatVersion: '2.16' } as Record<string, unknown>;
  const nodes = result.nodes as Record<string, Record<string, unknown>> | undefined;
  if (!nodes) return result;
  const sanitized: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (typeof node !== 'object' || node === null) {
      sanitized[id] = node;
      continue;
    }
    const next = { ...node };
    if (next.warps !== undefined) {
      const { modifiers } = validateWarpModifiers(next.warps);
      if (modifiers.length > 0) next.warps = modifiers;
      else delete next.warps;
    }
    if (next.warpSettings !== undefined) {
      const { settings } = validateWarpSettings(next.warpSettings);
      if (settings && Object.keys(settings).length > 0) next.warpSettings = settings;
      else delete next.warpSettings;
    }
    sanitized[id] = next;
  }
  result.nodes = sanitized;
  return result;
}
