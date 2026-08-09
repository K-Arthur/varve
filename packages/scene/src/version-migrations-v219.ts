/**
 * v2.18 → v2.19 migration: raster colour encoding metadata (ADR-0217).
 *
 * v2.19 adds the optional `colorEncoding` block to `ImageSourceMetadata`
 * (DocumentAsset.metadata) and optional header info (profileClass /
 * colorSpace / version / renderingIntent) to `IccProfileEntry` entries.
 *
 * Both additions are optional and only ever written by the ingestion
 * pipeline, so existing documents need no structural change. Critically,
 * this migration does NOT fabricate encodings for existing assets: a
 * document saved before metadata extraction cannot know what its image
 * pixels meant, and claiming `legacy-assumed-srgb` at migration time would
 * bloat every old document for no benefit. The assumption is applied at
 * read time (rendering/export/preflight) where it can be surfaced as a
 * finding instead of being silently baked into the file.
 */

export function migrateV218ToV219(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, formatVersion: '2.19' };
}
