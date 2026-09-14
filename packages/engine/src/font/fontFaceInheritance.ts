import type { FontReference } from './fontIdentity';

/**
 * Resolve the exact face reference for a rich-text run.
 *
 * A run inherits its parent's face only while it also inherits the family.
 * Once a run names another family, carrying the parent's artifact hash would
 * make storage, export, and missing-font recovery address the wrong bytes.
 * An explicit run reference always wins, including when the run keeps the
 * parent's family but selects another collection member.
 */
export function inheritedFontReference(
  baseFamily: string | undefined,
  baseReference: FontReference | undefined,
  overrideFamily: string | undefined,
  overrideReference: FontReference | undefined,
): FontReference | undefined {
  if (overrideReference) return overrideReference;
  if (!baseReference) return undefined;
  if (!overrideFamily || !baseFamily) return baseReference;
  return normalizeFamily(overrideFamily) === normalizeFamily(baseFamily)
    ? baseReference
    : undefined;
}

function normalizeFamily(value: string): string {
  return value.trim().toLocaleLowerCase();
}
