import type {
  FontArtifactDescriptor,
  FontsourceCatalogRecord,
  FontsourceCatalogStore,
  MissingFontInfo,
} from '@varve/engine/font';

export interface MissingFontRecoveryMatch {
  artifact: FontArtifactDescriptor;
  record: FontsourceCatalogRecord;
  matchedByAlias: boolean;
  exactFace: boolean;
}

function normalizeFamily(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_\s]+/g, ' ')
    .trim();
}

function nearestWeight(weights: readonly number[], requested = 400): number | undefined {
  return [...weights].sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || a - b)[0];
}

/**
 * Resolve a missing document family to an exact local Fontsource catalog
 * identity. Fuzzy semantic results are deliberately excluded: installing a
 * substitute must remain a separate, reviewable replacement action.
 */
export function findMissingFontRecoveryMatch(
  missing: MissingFontInfo,
  catalog: FontsourceCatalogStore,
): MissingFontRecoveryMatch | undefined {
  const references = new Set(
    [missing.familyName, missing.originalReference].map(normalizeFamily).filter(Boolean),
  );
  const record = catalog.families().find((candidate) => {
    if (
      references.has(normalizeFamily(candidate.familyName)) ||
      references.has(normalizeFamily(candidate.familyId))
    ) {
      return true;
    }
    return candidate.aliases.some((alias) => references.has(normalizeFamily(alias)));
  });
  if (!record) return undefined;

  const requestedStyle = missing.requestedStyle === 'italic' ? 'italic' : 'normal';
  const style = record.styles.includes(requestedStyle) ? requestedStyle : record.styles[0];
  const weight = nearestWeight(record.weights, missing.requestedWeight);
  if (!style || weight === undefined) return undefined;

  try {
    const artifact = catalog.resolve({ familyId: record.familyId, weight, style });
    const canonical = normalizeFamily(record.familyName);
    return {
      artifact,
      record,
      matchedByAlias: !references.has(canonical),
      exactFace:
        (missing.requestedWeight === undefined || missing.requestedWeight === weight) &&
        (missing.requestedStyle === undefined || requestedStyle === style),
    };
  } catch {
    return undefined;
  }
}

export function fontFaceLabel(match: MissingFontRecoveryMatch): string {
  const weight = match.artifact.weight ?? 'Variable';
  const style = match.artifact.style === 'italic' ? ' italic' : '';
  return `${weight}${style}`;
}
