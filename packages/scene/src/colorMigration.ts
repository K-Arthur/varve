/**
 * Legacy text-color tuple migration (schema 2.13 → 2.14).
 *
 * `CharacterFormat.color` and `ParagraphFormat.columnRuleColor` were stored
 * as `[r, g, b, a]` sRGB tuples before 2.14. The migration converts them to
 * `ManagedColor` (`space: 'rgb'`) at load time.
 *
 * Semantics:
 * - Tuples were ALWAYS interpreted as sRGB RGBA (documented in
 *   colorManagement.ts); the migration preserves that interpretation and
 *   attaches no profile — the document working space applies at read
 *   boundaries, so it never depends on the installed ICC profile set.
 * - Alpha is preserved unchanged.
 * - Objects that already carry a `space` discriminant are left alone
 * (idempotence for partially or already migrated documents).
 * - Non-tuple values (undefined, malformed) are left untouched so readers
 *   can surface them rather than silently rewriting data.
 */

/** Structurally compatible with `DocumentMigration` (avoids a circular
 *  import with version.ts). */
export interface TextColorDocumentMigration {
  from: string;
  to: string;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

/** True when the value is a legacy 4-number sRGB tuple. */
export function isLegacyColorTuple(
  value: unknown,
): value is readonly [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Convert a legacy tuple to a ManagedColor rgb value (0-255, uint8 scale). */
export function legacyColorTupleToManaged(value: readonly [number, number, number, number]): {
  space: 'rgb';
  r: number;
  g: number;
  b: number;
  a: number;
} {
  return { space: 'rgb', r: value[0], g: value[1], b: value[2], a: value[3] };
}

/** Migrate every legacy color tuple found in a document's text runs. */
export function migrateLegacyTextColorTuples(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...raw, formatVersion: '2.14' } as Record<string, unknown>;
  const nodes = result.nodes as Record<string, unknown> | undefined;
  if (!nodes) return result;

  for (const node of Object.values(nodes)) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    if (n.kind !== 'text') continue;
    const rich = n.richText;
    if (!rich || typeof rich !== 'object') continue;
    const paragraphs = (rich as Record<string, unknown>).paragraphs;
    if (!Array.isArray(paragraphs)) continue;

    for (const para of paragraphs) {
      if (!para || typeof para !== 'object') continue;
      const p = para as Record<string, unknown>;
      const paraFormat = p.format;
      if (paraFormat && typeof paraFormat === 'object') {
        const pf = paraFormat as Record<string, unknown>;
        if (isLegacyColorTuple(pf.columnRuleColor)) {
          pf.columnRuleColor = legacyColorTupleToManaged(pf.columnRuleColor);
        }
      }
      const runs = p.runs;
      if (!Array.isArray(runs)) continue;
      for (const run of runs) {
        if (!run || typeof run !== 'object') continue;
        const format = (run as Record<string, unknown>).format;
        if (!format || typeof format !== 'object') continue;
        const f = format as Record<string, unknown>;
        if (isLegacyColorTuple(f.color)) {
          f.color = legacyColorTupleToManaged(f.color);
        }
      }
    }
  }
  return result;
}

/** The 2.13 → 2.14 migration step. */
export const textColorMigration: TextColorDocumentMigration = {
  from: '2.13',
  to: '2.14',
  migrate: migrateLegacyTextColorTuples,
};
