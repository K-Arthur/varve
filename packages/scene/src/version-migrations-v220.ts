/**
 * v2.19 → v2.20 migration: animated image media metadata (ADR-0215).
 *
 * v2.20 adds two optional blocks:
 *  - `DocumentAsset.animated?: AnimatedAssetMetadata` — probed container
 *    facts (kind, frame count, canvas dims, loop count, per-frame timing/
 *    rects/blend/disposal) written only by the import pipeline for
 *    animated GIF/APNG/WebP imports.
 *  - `ImageFillData.media?: MediaFillSettings` — per-usage playback
 *    overrides (loop mode, rate, offset, in/out trim, poster frame) written
 *    only when a user edits media playback.
 *
 * Both additions are optional and additive: existing documents — including
 * every static image document — need no structural change, and no animated
 * structures are fabricated for static assets. The migration is a pure
 * version stamp, matching the v2.15→v2.16 and v2.18→v2.19 precedents.
 */

export function migrateV219ToV220(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, formatVersion: '2.20' };
}
