import { allSemanticSynonyms, tagDefinition, tagIdForTerm, tagLabel } from './semanticOntology';
import type {
  FontReference,
  FontSemanticQuery,
  NumericConstraint,
  SemanticConstraint,
  SemanticPreference,
} from './semanticTypes';

const MAX_QUERY_LENGTH = 1000;

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function constraintForTag(tagId: string, label = tagLabel(tagId)): SemanticConstraint | undefined {
  const definition = tagDefinition(tagId);
  if (!definition) return undefined;
  const kind =
    definition.facet === 'coverage'
      ? 'coverage'
      : definition.facet === 'feature'
        ? 'feature'
        : definition.facet === 'source'
          ? 'source'
          : definition.facet === 'classification'
            ? 'category'
            : 'tag';
  return { kind, id: tagId, label, hard: true };
}

function preferenceForTag(tagId: string, label = tagLabel(tagId)): SemanticPreference {
  const definition = tagDefinition(tagId);
  return {
    kind: definition?.facet === 'use' ? 'use-case' : 'tag',
    id: tagId,
    label,
  };
}

function addUnique<T extends { id: string }>(items: T[], item: T): void {
  if (!items.some((candidate) => candidate.id === item.id)) items.push(item);
}

function addChip(
  chips: FontSemanticQuery['chips'],
  label: string,
  kind: 'required' | 'preferred' | 'excluded' | 'ambiguous',
): void {
  if (!chips.some((chip) => chip.label === label && chip.kind === kind))
    chips.push({ label, kind });
}

function addKnownTerm(
  query: FontSemanticQuery,
  _term: string,
  tagId: string,
  excluded: boolean,
  requiredContext: boolean,
): void {
  const definition = tagDefinition(tagId);
  if (!definition) return;
  const label = definition.label;
  if (excluded) {
    const constraint = constraintForTag(tagId, label);
    if (constraint) {
      addUnique(query.excluded, constraint);
      addChip(query.chips, label, 'excluded');
    }
    return;
  }
  const constraint = constraintForTag(tagId, label);
  if (constraint && (requiredContext || constraint.kind !== 'tag')) {
    addUnique(query.required, constraint);
    addChip(query.chips, label, 'required');
    return;
  }
  addUnique(query.preferred, preferenceForTag(tagId, label));
  addChip(query.chips, label, 'preferred');
  if (definition.facet === 'use') query.intendedRole?.push(tagId);
}

function parseReference(value: string): FontReference | undefined {
  const familyName = value.trim().replace(/^['"]|['"]$/g, '');
  if (!familyName) return undefined;
  return { familyName, normalizedName: normalize(familyName) };
}

function parseRange(
  text: string,
  field: NumericConstraint['field'],
  ranges: NumericConstraint[],
): void {
  const pattern = new RegExp(
    `\\b${field === 'x-height' ? 'x[- ]?height' : field === 'average-width' ? '(?:average )?width' : field}\\s*(\\d+(?:\\.\\d+)?)\\s*(?:-|to)\\s*(\\d+(?:\\.\\d+)?)`,
    'i',
  );
  const match = text.match(pattern);
  if (!match) return;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return;
  if (!ranges.some((range) => range.field === field && range.min === min && range.max === max)) {
    ranges.push({ field, min, max, raw: match[0] });
  }
}

/** Parse design language into a bounded, explainable local query AST. */
export function parseFontSemanticQuery(input: string): FontSemanticQuery {
  if (typeof input !== 'string') throw new Error('Font search query must be text');
  if (input.length > MAX_QUERY_LENGTH)
    throw new Error(`Font search query exceeds ${MAX_QUERY_LENGTH} characters`);
  const text = input.trim();
  const lower = normalize(text);
  const query: FontSemanticQuery = {
    text,
    exactTerms: [],
    required: [],
    preferred: [],
    excluded: [],
    numericRanges: [],
    strictness: /\bstrict\b|installed only|downloadable only/.test(lower) ? 'strict' : 'balanced',
    chips: [],
    ambiguities: [],
    intendedRole: [],
  };

  const similarMatch = text.match(/\b(?:similar to|like)\s+(.+?)(?=\s+(?:with|for|but|and)\b|$)/i);
  if (similarMatch?.[1]) {
    const reference = parseReference(similarMatch[1]);
    if (reference) {
      query.similarityTarget = reference;
      query.similarityRelation = 'similar';
    }
  }
  const sameWidthMatch = text.match(/\bsame width as\s+(.+?)(?=\s+(?:with|for|but|and)\b|$)/i);
  if (sameWidthMatch?.[1]) {
    const reference = parseReference(sameWidthMatch[1]);
    if (reference) {
      query.similarityTarget = reference;
      query.similarityRelation = 'same-width';
    }
  }
  const lessFormalMatch = text.match(/\bless formal than\s+(.+?)(?=\s+(?:with|for|but|and)\b|$)/i);
  if (lessFormalMatch?.[1]) {
    const reference = parseReference(lessFormalMatch[1]);
    if (reference) {
      query.similarityTarget = reference;
      query.similarityRelation = 'less-formal';
    }
    const formal = constraintForTag('tone.formal');
    if (formal) {
      query.excluded.push(formal);
      addChip(query.chips, formal.label, 'excluded');
    }
  }

  const availability: Array<[RegExp, FontSemanticQuery['availability'], string]> = [
    [/\binstalled only\b/, 'installed', 'Installed only'],
    [/\bdownloadable only\b|\bavailable to download\b/, 'downloadable', 'Downloadable only'],
    [/\bproject fonts?\b/, 'project', 'Project fonts'],
  ];
  for (const [pattern, value, label] of availability) {
    if (!pattern.test(lower)) continue;
    query.availability = value;
    addChip(query.chips, label, 'required');
  }

  parseRange(lower, 'weight', query.numericRanges);
  parseRange(lower, 'width', query.numericRanges);
  parseRange(lower, 'x-height', query.numericRanges);
  if (query.numericRanges.length > 0) {
    for (const range of query.numericRanges) addChip(query.chips, range.raw, 'required');
  }

  const exclusionPatterns = [
    ...lower.matchAll(
      /\b(?:without|not|excluding|except)\s+([\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2})/gu,
    ),
  ];
  const exclusions = new Set<string>();
  for (const match of exclusionPatterns) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    const tagId = tagIdForTerm(candidate) ?? tagIdForTerm(candidate.split(' ')[0] ?? '');
    if (tagId) {
      exclusions.add(tagId);
      addKnownTerm(query, candidate, tagId, true, false);
    }
  }

  const synonyms = new Set<string>(lower.split(/[^\p{L}\p{N}-]+/u).filter(Boolean));
  // Longest aliases first prevents a multi-word alias from being consumed as
  // two unrelated words if a future alias is added.
  for (const term of allSemanticSynonyms().keys()) {
    if (term.includes(' ') && lower.includes(term)) synonyms.add(term);
  }
  const terms = [...synonyms].sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const tagId = tagIdForTerm(term);
    if (!tagId || exclusions.has(tagId)) continue;
    const index = lower.indexOf(term);
    const prefix = index > 0 ? lower.slice(Math.max(0, index - 10), index) : '';
    const requiredContext = /\bwith\s*$/.test(prefix) || /\b(?:and|plus)\s*$/.test(prefix);
    addKnownTerm(query, term, tagId, false, requiredContext);
  }

  if (/\bfontsource\b/.test(lower)) {
    const source = constraintForTag('source.fontsource');
    if (source) {
      addUnique(query.required, source);
      addChip(query.chips, source.label, 'required');
    }
  }
  if (/\bscript\b/.test(lower) && !/\bscript typeface\b/.test(lower)) {
    query.ambiguities.push({
      term: 'script',
      suggestions: ['Script typeface', 'Writing-system coverage'],
    });
    addChip(query.chips, 'Script: typeface or coverage?', 'ambiguous');
  }
  if (/\bmodern\b/.test(lower)) {
    query.ambiguities.push({
      term: 'modern',
      suggestions: ['Didone / modern serif', 'Contemporary tone'],
    });
    addChip(query.chips, 'Modern: construction or tone?', 'ambiguous');
  }
  if (/\bdisplay\b/.test(lower)) {
    query.ambiguities.push({
      term: 'display',
      suggestions: ['Display construction', 'Display role'],
    });
  }

  const consumed = new Set<string>([
    ...query.required.map((item) => item.label.toLocaleLowerCase()),
    ...query.preferred.map((item) => item.label.toLocaleLowerCase()),
  ]);
  for (const term of terms) {
    if (!tagIdForTerm(term) && !consumed.has(term) && term.length > 1) query.exactTerms.push(term);
  }
  const stopwords = new Set([
    'a',
    'an',
    'and',
    'as',
    'for',
    'in',
    'like',
    'of',
    'on',
    'the',
    'to',
    'with',
  ]);
  const referenceTerms = new Set(query.similarityTarget?.normalizedName.split(' ') ?? []);
  query.exactTerms = query.exactTerms.filter(
    (term) => !stopwords.has(term) && !referenceTerms.has(term),
  );
  if (query.exactTerms.length === 0 && lower && !query.similarityTarget)
    query.exactTerms.push(lower);
  query.intendedRole = [...new Set(query.intendedRole)];
  return query;
}

export function semanticQueryLabel(query: FontSemanticQuery): string {
  if (query.required.length === 0 && query.preferred.length === 0 && query.excluded.length === 0)
    return 'All fonts';
  return [...query.required, ...query.preferred, ...query.excluded]
    .map((item) => item.label)
    .join(' · ');
}

export const FONT_QUERY_LIMITS = { maxLength: MAX_QUERY_LENGTH, maxSynonyms: 64 } as const;

export { normalize as normalizeFontSemanticText };
