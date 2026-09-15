/**
 * Client-side ranking for the website search index.
 *
 * The corpus is small enough (about a hundred pages) that an honest linear
 * scan with clear scoring beats an inverted index: ranking is deterministic,
 * there is no index-build step beyond the JSON the build already writes, and
 * every rule is unit-testable. Query work is O(corpus), which measured under
 * a few milliseconds per keystroke on the built site.
 *
 * Matching tiers, in descending confidence:
 *   1. exact substring in the page title / section heading / body,
 *   2. token prefix (so "typo" finds "typography"),
 *   3. bounded edit distance on title and heading tokens only (so a
 *      misspelling still lands somewhere useful without body-level noise).
 *
 * All terms in a multi-word query must match (AND); a whole-query phrase hit
 * ranks above scattered terms. See docs/audits/website-search-and-section-links-2026-09-14.md
 * for the research basis and the real queries used to validate the ranking.
 */

import type { SearchIndex, SearchPage, SearchResult } from './types';

const MAX_TERMS = 6;
const FUZZY_MIN_LENGTH = 4;
const DEFAULT_RESULT_LIMIT = 12;
const BODY_HIT_BASE = 8;
const BODY_HIT_EXTRA = 2;
const BODY_HIT_EXTRA_CAP = 4;

export interface PreparedSection {
  heading: string;
  headingNorm: string;
  anchor: string;
  text: string;
  textNorm: string;
}

export interface PreparedPage {
  page: SearchPage;
  url: string;
  titleNorm: string;
  titleWords: string[];
  descriptionNorm: string;
  haystack: string;
  sections: PreparedSection[];
  /** All title + heading tokens, the only candidates for fuzzy matching. */
  fuzzyCandidates: string[];
}

export interface PreparedIndex {
  pages: PreparedPage[];
}

/** Case- and diacritic-insensitive normalization used for all matching. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Bounded Damerau-Levenshtein distance. Returns -1 once the distance is
 * known to exceed `maxDistance`, so callers never pay full-matrix cost for
 * unrelated words. Mirrors the editor's layer-search implementation
 * (packages/editor/src/components/LayersPanel/fuzzySearch.ts); consolidating
 * both into @varve/shared is tracked as follow-up work, not done here to
 * avoid coupling this feature to an actively-changing package.
 */
export function boundedDamerauLevenshtein(a: string, b: string, maxDistance: number): number {
  const aLen = a.length;
  const bLen = b.length;
  if (Math.abs(aLen - bLen) > maxDistance) return -1;
  if (a === b) return 0;
  if (aLen === 0) return bLen <= maxDistance ? bLen : -1;
  if (bLen === 0) return aLen <= maxDistance ? aLen : -1;

  let prev2 = new Uint8Array(bLen + 1);
  let prev1 = new Uint8Array(bLen + 1);
  for (let j = 0; j <= bLen; j += 1) prev1[j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    const current = new Uint8Array(bLen + 1);
    current[0] = i;
    let rowBest = i;
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (prev1[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (prev1[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (prev2[j - 2] ?? 0) + cost);
      }
      current[j] = value;
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > maxDistance) return -1;
    prev2 = prev1;
    prev1 = current;
  }
  return (prev1[bLen] ?? -1) <= maxDistance ? (prev1[bLen] ?? -1) : -1;
}

/**
 * Edit-distance allowance by term length. One edit for ordinary words, two
 * for long words; short words must match exactly because the typo space is
 * too dense to disambiguate.
 */
export function fuzzyDistanceFor(term: string): number {
  if (term.length >= 8) return 2;
  return 1;
}

function fuzzyMatch(term: string, candidates: readonly string[]): boolean {
  if (term.length < FUZZY_MIN_LENGTH) return false;
  const maxDistance = fuzzyDistanceFor(term);
  return candidates.some((candidate) => {
    if (Math.abs(candidate.length - term.length) > maxDistance) return false;
    return boundedDamerauLevenshtein(term, candidate, maxDistance) >= 0;
  });
}

export function prepareIndex(index: SearchIndex): PreparedIndex {
  const pages = index.pages.map((page) => {
    const titleNorm = normalizeText(page.title);
    const titleWords = tokenize(titleNorm);
    const descriptionNorm = normalizeText(page.description);
    const sections: PreparedSection[] = page.sections.map((section) => ({
      heading: section.heading,
      headingNorm: normalizeText(section.heading),
      anchor: section.anchor,
      text: section.text,
      textNorm: normalizeText(section.text),
    }));
    const headingWords = sections.flatMap((section) => tokenize(section.headingNorm));
    const haystack = normalizeText(
      [
        page.title,
        page.description,
        ...page.sections.map((section) => `${section.heading} ${section.text}`),
      ].join(' '),
    );
    return {
      page,
      url: page.url,
      titleNorm,
      titleWords,
      descriptionNorm,
      haystack,
      sections,
      fuzzyCandidates: [...titleWords, ...headingWords],
    };
  });
  return { pages };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function buildSnippet(section: PreparedSection, terms: readonly string[]): string {
  const source = section.text;
  if (!source) return '';
  let best = -1;
  for (const term of terms) {
    const index = section.textNorm.indexOf(term);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  if (best < 0) {
    const plain = source.slice(0, 200).trim();
    return source.length > 200 ? `${plain}…` : plain;
  }
  let start = Math.max(0, best - 70);
  let end = Math.min(source.length, best + 190);
  if (start > 0) {
    const space = source.indexOf(' ', start);
    if (space >= 0 && space < best) start = space + 1;
  }
  if (end < source.length) {
    const space = source.lastIndexOf(' ', end);
    if (space > best) end = space;
  }
  const excerpt = source.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${excerpt}${end < source.length ? '…' : ''}`;
}

interface TermMatch {
  term: string;
  exact: boolean;
  fuzzy: boolean;
}

function matchTerms(page: PreparedPage, terms: readonly string[]): TermMatch[] | null {
  const matches: TermMatch[] = [];
  for (const term of terms) {
    if (page.haystack.includes(term)) {
      matches.push({ term, exact: true, fuzzy: false });
      continue;
    }
    if (fuzzyMatch(term, page.fuzzyCandidates)) {
      matches.push({ term, exact: false, fuzzy: true });
      continue;
    }
    return null;
  }
  return matches;
}

function scoreSection(section: PreparedSection, terms: readonly string[], phrase: string): number {
  let score = 0;
  for (const term of terms) {
    if (section.headingNorm.includes(term)) score += 45;
    else if (fuzzyMatch(term, tokenize(section.headingNorm))) score += 20;
    const occurrences = countOccurrences(section.textNorm, term);
    if (occurrences > 0) {
      score += BODY_HIT_BASE + Math.min(occurrences - 1, BODY_HIT_EXTRA_CAP) * BODY_HIT_EXTRA;
    }
  }
  if (phrase.length > 3) {
    if (section.headingNorm.includes(phrase)) score += 60;
    else if (section.textNorm.includes(phrase)) score += 24;
  }
  return score;
}

function scorePage(page: PreparedPage, terms: readonly string[], phrase: string): number {
  let score = 0;
  if (page.titleNorm === phrase) score += 240;
  else if (page.titleNorm.startsWith(phrase)) score += 160;
  else if (page.titleNorm.includes(phrase)) score += 120;
  for (const term of terms) {
    if (page.titleWords.includes(term)) score += 50;
    else if (page.titleWords.some((word) => word.startsWith(term))) score += 40;
    else if (page.titleNorm.includes(term)) score += 30;
    else if (fuzzyMatch(term, page.titleWords)) score += 18;
    if (page.descriptionNorm.includes(term)) score += 10;
  }
  for (const section of page.sections) {
    score += Math.max(scoreSection(section, terms, phrase), 0);
  }
  return score;
}

/**
 * The best-scoring section, or `null` when nothing scored — a page-level
 * match must link to the page, not to a section that happened to come first.
 */
function bestSectionFor(
  page: PreparedPage,
  terms: readonly string[],
  phrase: string,
): PreparedSection | null {
  let best: PreparedSection | null = null;
  let bestScore = 0;
  for (const section of page.sections) {
    const score = scoreSection(section, terms, phrase);
    if (score > bestScore) {
      bestScore = score;
      best = section;
    }
  }
  return best;
}

export function searchPrepared(
  prepared: PreparedIndex,
  query: string,
  limit: number = DEFAULT_RESULT_LIMIT,
): SearchResult[] {
  const normalizedQuery = normalizeText(query).trim().replace(/\s+/g, ' ');
  if (!normalizedQuery) return [];
  const terms = [...new Set(normalizedQuery.split(' ').filter(Boolean))].slice(0, MAX_TERMS);
  const phrase = normalizedQuery;

  const results: SearchResult[] = [];
  for (const page of prepared.pages) {
    if (!matchTerms(page, terms)) continue;
    const score = scorePage(page, terms, phrase);
    if (score <= 0) continue;
    const section = bestSectionFor(page, terms, phrase);
    results.push({
      url: section?.anchor ? `${page.url}#${section.anchor}` : page.url,
      title: page.page.title || page.page.url,
      heading: section?.heading ?? '',
      snippet: section ? buildSnippet(section, terms) : '',
      score,
    });
  }

  results.sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.url.localeCompare(b.url),
  );
  return results.slice(0, limit);
}
