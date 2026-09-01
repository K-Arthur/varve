import { tagDefinition, tagLabel } from './semanticOntology';
import { parseFontSemanticQuery } from './semanticQuery';
import type {
  FontSearchReason,
  FontSearchResult,
  FontSemanticQuery,
  FontSemanticRecord,
  NumericConstraint,
  SemanticConstraint,
} from './semanticTypes';

export type ConstraintState = 'satisfied' | 'unsatisfied' | 'unknown';

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parentChain(tagId: string): string[] {
  const result: string[] = [];
  let current = tagDefinition(tagId)?.parent;
  while (current) {
    result.push(current);
    current = tagDefinition(current)?.parent;
  }
  return result;
}

function recordAssignments(record: FontSemanticRecord): Set<string> {
  const ids = new Set(
    record.profile.assignments
      .filter((item) => !record.profile.unknownFields.includes(item.tagId))
      .map((item) => item.tagId),
  );
  for (const tag of record.userTags) ids.add(`user:${normalize(tag)}`);
  for (const tag of record.projectTags) ids.add(`project:${normalize(tag)}`);
  return ids;
}

function assignmentEvidence(
  record: FontSemanticRecord,
  tagId: string,
): FontSearchReason | undefined {
  const assignment = record.profile.assignments.find((item) => item.tagId === tagId);
  if (!assignment) return undefined;
  const evidence = assignment.evidence?.[0];
  return {
    kind:
      assignment.source === 'measured'
        ? 'visual-feature'
        : assignment.source === 'provider'
          ? 'required-constraint'
          : 'semantic-tag',
    label: tagLabel(tagId),
    provenance: evidence?.label ?? assignment.source,
    contribution: assignment.confidence,
  };
}

function hasTag(record: FontSemanticRecord, tagId: string): boolean {
  const ids = recordAssignments(record);
  if (ids.has(tagId)) return true;
  return [...ids].some((candidate) => parentChain(candidate).includes(tagId));
}

function sourceMatches(record: FontSemanticRecord, id: string): ConstraintState {
  switch (id) {
    case 'source.fontsource':
      return record.providerId === 'fontsource' ? 'satisfied' : 'unsatisfied';
    case 'source.installed':
      return record.installed ? 'satisfied' : 'unsatisfied';
    case 'source.downloadable':
      return record.downloadable ? 'satisfied' : 'unsatisfied';
    case 'source.open-source':
      return record.license
        ? record.license.includes('Open') ||
          record.license.includes('Apache') ||
          record.license.includes('Ubuntu')
          ? 'satisfied'
          : 'unsatisfied'
        : 'unknown';
    default:
      return 'unknown';
  }
}

function coverageMatches(record: FontSemanticRecord, id: string): ConstraintState {
  const value = id.split('.').at(-1);
  if (!value) return 'unknown';
  if (id.startsWith('coverage.language.')) {
    if (record.languages.includes(value)) return 'satisfied';
    return record.profile.unknownFields.includes('coverage')
      ? 'unknown'
      : record.languages.length > 0
        ? 'unsatisfied'
        : 'unknown';
  }
  if (record.scripts.includes(value)) return 'satisfied';
  if (record.profile.unknownFields.includes('coverage')) return 'unknown';
  return record.scripts.length > 0 ? 'unsatisfied' : 'unknown';
}

function featureMatches(record: FontSemanticRecord, id: string): ConstraintState {
  if (hasTag(record, id)) return 'satisfied';
  if (id === 'feature.tnum' && record.openTypeFeatures.includes('tnum')) return 'satisfied';
  if (id === 'feature.onum' && record.openTypeFeatures.includes('onum')) return 'satisfied';
  if (id === 'feature.small-caps' && record.openTypeFeatures.includes('smcp')) return 'satisfied';
  if (id === 'feature.liga' && record.openTypeFeatures.includes('liga')) return 'satisfied';
  return record.openTypeFeatures.length > 0 || record.faceProfiles.length > 0
    ? 'unsatisfied'
    : 'unknown';
}

function numericMatches(
  record: FontSemanticRecord,
  constraint: NumericConstraint,
): ConstraintState {
  if (constraint.field === 'weight') {
    const axis = record.axes.find((item) => item.tag === 'wght');
    const min = axis?.min ?? record.weights[0];
    const max = axis?.max ?? record.weights.at(-1);
    if (min === undefined || max === undefined) return 'unknown';
    return min <= (constraint.min ?? min) && max >= (constraint.max ?? max)
      ? 'satisfied'
      : 'unsatisfied';
  }
  const value =
    constraint.field === 'x-height'
      ? record.profile.visualFeatures.xHeightRatio
      : constraint.field === 'average-width'
        ? record.profile.visualFeatures.averageAdvance
        : record.profile.visualFeatures.widthRatio;
  if (value === undefined) return 'unknown';
  const min = constraint.min === undefined ? Number.NEGATIVE_INFINITY : constraint.min;
  const max = constraint.max === undefined ? Number.POSITIVE_INFINITY : constraint.max;
  return value >= min && value <= max ? 'satisfied' : 'unsatisfied';
}

function constraintMatches(
  record: FontSemanticRecord,
  constraint: SemanticConstraint,
): ConstraintState {
  switch (constraint.kind) {
    case 'source':
    case 'availability':
      return sourceMatches(record, constraint.id);
    case 'coverage':
      return coverageMatches(record, constraint.id);
    case 'feature':
      return featureMatches(record, constraint.id);
    case 'category':
    case 'tag':
      return hasTag(record, constraint.id)
        ? 'satisfied'
        : record.profile.unknownFields.includes(constraint.id)
          ? 'unknown'
          : 'unsatisfied';
    case 'numeric':
      return numericMatches(record, {
        field: constraint.id as NumericConstraint['field'],
        raw: String(constraint.value),
      });
    default:
      return 'unknown';
  }
}

function addReason(reasons: FontSearchReason[], reason: FontSearchReason): void {
  if (
    !reasons.some((candidate) => candidate.label === reason.label && candidate.kind === reason.kind)
  )
    reasons.push(reason);
}

function lexicalScore(
  record: FontSemanticRecord,
  query: FontSemanticQuery,
  reasons: FontSearchReason[],
): number {
  const family = normalize(record.familyName);
  const aliases = record.aliases.map(normalize);
  const fields = [
    family,
    ...aliases,
    normalize(record.vendor ?? ''),
    normalize(record.designer ?? ''),
    normalize(record.foundry ?? ''),
    ...record.userTags.map(normalize),
    ...record.projectTags.map(normalize),
  ];
  let score = 0;
  for (const term of query.exactTerms) {
    const normalizedTerm = normalize(term);
    if (family === normalizedTerm || aliases.includes(normalizedTerm)) {
      score += 220;
      addReason(reasons, { kind: 'exact-match', label: 'Exact family match', contribution: 220 });
    } else if (family.startsWith(normalizedTerm)) {
      score += 120;
      addReason(reasons, {
        kind: 'exact-match',
        label: 'Family name starts with query',
        contribution: 120,
      });
    } else if (fields.some((field) => field.includes(normalizedTerm))) {
      score += 45;
      addReason(reasons, {
        kind: 'semantic-tag',
        label: 'Metadata matches query',
        contribution: 45,
      });
    }
  }
  for (const tag of record.userTags) {
    if (query.exactTerms.some((term) => normalize(term) === normalize(tag))) {
      score += 90;
      addReason(reasons, {
        kind: 'user-preference',
        label: `Your tag: ${tag}`,
        contribution: 90,
        provenance: 'user',
      });
    }
  }
  return score;
}

function preferredScore(
  record: FontSemanticRecord,
  query: FontSemanticQuery,
  reasons: FontSearchReason[],
): number {
  let score = 0;
  for (const preference of query.preferred) {
    if (preference.id.startsWith('user:')) continue;
    if (!hasTag(record, preference.id)) continue;
    const assignment = assignmentEvidence(record, preference.id);
    score += 18;
    addReason(
      reasons,
      assignment ?? {
        kind: preference.kind === 'use-case' ? 'use-case' : 'semantic-tag',
        label: preference.label,
        contribution: 18,
      },
    );
  }
  return score;
}

function diversify(results: FontSearchResult[]): FontSearchResult[] {
  const seen = new Map<string, number>();
  return results
    .map((result) => {
      const kind = result.record.providerCategory ?? result.record.source;
      const count = seen.get(kind) ?? 0;
      seen.set(kind, count + 1);
      return count > 2 ? { ...result, score: result.score - Math.min(count * 1.5, 8) } : result;
    })
    .sort(compareResults);
}

function compareResults(a: FontSearchResult, b: FontSearchResult): number {
  return (
    b.score - a.score ||
    a.record.familyName.localeCompare(b.record.familyName) ||
    a.record.familyId.localeCompare(b.record.familyId)
  );
}

function availabilityConstraint(
  record: FontSemanticRecord,
  availability: FontSemanticQuery['availability'],
): ConstraintState {
  if (!availability) return 'satisfied';
  if (availability === 'installed') return record.installed ? 'satisfied' : 'unsatisfied';
  if (availability === 'downloadable') return record.downloadable ? 'satisfied' : 'unsatisfied';
  if (availability === 'project')
    return record.sourceKinds.includes('project') ? 'satisfied' : 'unsatisfied';
  return record.source === 'missing' ? 'satisfied' : 'unsatisfied';
}

/** Deterministic ranking with explicit unknown hard-constraint handling. */
export function searchFontSemanticRecords(
  records: readonly FontSemanticRecord[],
  input: string | FontSemanticQuery,
  options: {
    limit?: number;
    strictness?: FontSemanticQuery['strictness'];
    diversity?: boolean;
  } = {},
): FontSearchResult[] {
  const query = typeof input === 'string' ? parseFontSemanticQuery(input) : input;
  const strictness = options.strictness ?? query.strictness;
  const results: FontSearchResult[] = [];
  for (const record of records) {
    const reasons: FontSearchReason[] = [];
    const unknownRequired: string[] = [];
    const excludedMatches: string[] = [];
    const available = availabilityConstraint(record, query.availability);
    if (available === 'unsatisfied') continue;
    if (available === 'satisfied' && query.availability)
      addReason(reasons, {
        kind: 'availability',
        label: tagLabel(`source.${query.availability}`),
        contribution: 26,
        provenance: 'runtime state',
      });

    let score = lexicalScore(record, query, reasons) + preferredScore(record, query, reasons);
    let rejected = false;
    for (const constraint of query.required) {
      const state = constraintMatches(record, constraint);
      if (state === 'unsatisfied') {
        rejected = true;
        break;
      }
      if (state === 'unknown') {
        unknownRequired.push(constraint.label);
        if (strictness === 'strict') {
          rejected = true;
          break;
        }
        addReason(reasons, {
          kind: 'unknown',
          label: `${constraint.label} not verified`,
          provenance: 'metadata unavailable',
        });
        score -= strictness === 'exploratory' ? 4 : 9;
      } else {
        score += 32;
        const evidence = assignmentEvidence(record, constraint.id);
        addReason(
          reasons,
          evidence ?? {
            kind:
              constraint.kind === 'coverage'
                ? 'coverage'
                : constraint.kind === 'feature'
                  ? 'feature'
                  : 'required-constraint',
            label: constraint.label,
            contribution: 32,
            provenance: 'local metadata',
          },
        );
      }
    }
    if (rejected) continue;
    for (const constraint of query.excluded) {
      if (constraintMatches(record, constraint) === 'satisfied')
        excludedMatches.push(constraint.label);
    }
    if (excludedMatches.length > 0) continue;
    for (const numeric of query.numericRanges) {
      const state = numericMatches(record, numeric);
      if (state === 'unsatisfied') {
        rejected = true;
        break;
      }
      if (state === 'unknown') {
        unknownRequired.push(numeric.raw);
        if (strictness === 'strict') {
          rejected = true;
          break;
        }
        addReason(reasons, {
          kind: 'unknown',
          label: `${numeric.raw} not verified`,
          provenance: 'measurement unavailable',
        });
      } else {
        score += 26;
        addReason(reasons, {
          kind: 'visual-feature',
          label: numeric.raw,
          contribution: 26,
          provenance: 'measured font metrics',
        });
      }
    }
    if (rejected) continue;
    results.push({
      record,
      score,
      reasons: reasons.slice(0, 8),
      unknownRequired,
      excludedMatches,
      status: unknownRequired.length > 0 ? 'unknown' : 'match',
    });
  }
  const ordered = options.diversity === false ? results.sort(compareResults) : diversify(results);
  return ordered.slice(0, options.limit ?? 50);
}

export { normalize as normalizeFontSemanticText };
