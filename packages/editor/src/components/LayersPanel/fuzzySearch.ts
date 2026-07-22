/**
 * Bounded fuzzy matching for layer search.
 *
 * All operations are deterministic and require no ML or network.
 *
 * Research basis: Damerau-Levenshtein distance (transposition-aware edit
 * distance); Unicode segmentation (UAX #29 grapheme clusters for CJK,
 * whitespace-delimited words for script systems).
 */

/** Match tier for relevance scoring */
export type MatchTier = 'exact' | 'prefix' | 'fuzzy' | 'none';

export interface FuzzyMatch {
  tier: MatchTier;
  score: number;
}

/**
 * Bounded Damerau-Levenshtein distance.
 * Returns -1 when the distance exceeds `maxDist` (early exit).
 * Uses full matrix for correctness with transposition support.
 */
export function boundedDamerauLevenshtein(a: string, b: string, maxDist: number): number {
  const aLen = a.length;
  const bLen = b.length;

  if (Math.abs(aLen - bLen) > maxDist) return -1;
  if (a === b) return 0;

  if (aLen === 0) return bLen <= maxDist ? bLen : -1;
  if (bLen === 0) return aLen <= maxDist ? aLen : -1;

  // Use full (3 x cols) rolling matrix to support d[i-2][j-2] transposition lookups
  const cols = bLen + 1;
  const d0 = new Uint8Array(cols);
  const d1 = new Uint8Array(cols);
  const d2 = new Uint8Array(cols);
  const rows = [d0, d1, d2];

  // Row 0: i = 0
  for (let j = 0; j < cols; j++) d0[j] = j;

  for (let i = 1; i <= aLen; i++) {
    const cur = rows[i % 3]!;
    const prev = rows[(i - 1) % 3]!;
    const prevPrev = rows[(i - 2) % 3]!;

    cur[0] = i;
    let rowMin = i;

    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      let val = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);

      // Transposition (swap two adjacent chars = 1 operation)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, prevPrev[j - 2]! + 1);
      }

      cur[j] = val;
      if (val < rowMin) rowMin = val;
    }

    if (rowMin > maxDist) return -1;
  }

  const result = rows[aLen % 3]![bLen]!;
  return result <= maxDist ? result : -1;
}

/**
 * Compute a normalised fuzzy score (0..1) between a query token and a
 * candidate word. 1.0 = exact match, descending to 0 at maxDist.
 */
export function tokenFuzzyScore(query: string, candidate: string): FuzzyMatch {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();

  if (q === c) return { tier: 'exact', score: 1.0 };
  if (c.startsWith(q)) return { tier: 'prefix', score: 0.9 };
  if (c.includes(q)) return { tier: 'prefix', score: 0.85 };

  const maxDist = Math.max(1, Math.floor(q.length * 0.3));
  const dist = boundedDamerauLevenshtein(q, c, maxDist);
  if (dist >= 0 && dist <= maxDist) {
    return {
      tier: 'fuzzy',
      score: Math.max(0, 0.7 - (dist / maxDist) * 0.5),
    };
  }

  return { tier: 'none', score: 0 };
}

/** Unicode-aware tokenization for index construction. */
export function tokenize(text: string): string[] {
  const tokens = new Set<string>();

  if (!text) return [];

  // CJK characters: each is its own token
  const cjkPattern =
    /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\uaa00-\uaa4f]/g;
  let match: RegExpExecArray | null;
  while ((match = cjkPattern.exec(text)) !== null) {
    tokens.add(match[0]);
  }

  // Remove CJK for western tokenization
  const western = text.replace(cjkPattern, ' ');

  // Split on whitespace, separators, and non-alphanumeric boundaries
  const parts = western.split(/[\s\-_./\\()[\]{}#@!+*~'"`|:;<>]+/);

  for (const part of parts) {
    const cleaned = part.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    if (cleaned.length === 0) continue;
    tokens.add(cleaned.toLowerCase());

    // CamelCase extraction
    const camelParts = cleaned.split(/(?<=[a-z])(?=[A-Z])/);
    for (const cp of camelParts) {
      if (cp.length > 0) tokens.add(cp.toLowerCase());
    }
  }

  return [...tokens];
}

/**
 * Determine whether a fuzzy search should be attempted based on query length.
 * Queries shorter than 2 chars only do prefix matching (too many false positives).
 */
export function shouldFuzzySearch(query: string): boolean {
  return query.length >= 3;
}

/**
 * Score a full query (multiple tokens) against a set of indexed tokens.
 * Uses AND-of-ORs: each query token must match at least one indexed token,
 * with the overall score being the average of the best match per query token.
 */
export function scoreQuery(
  queryTokens: string[],
  indexedTokens: string[],
): { score: number; tier: MatchTier } {
  if (queryTokens.length === 0 || indexedTokens.length === 0) {
    return { score: 0, tier: 'none' };
  }

  let totalScore = 0;
  let worstTier: MatchTier = 'exact';
  let matchedAny = false;

  for (const qt of queryTokens) {
    let bestScore = 0;
    let bestTier: MatchTier = 'none';

    for (const it of indexedTokens) {
      const result = tokenFuzzyScore(qt, it);
      if (result.score > bestScore) {
        bestScore = result.score;
        bestTier = result.tier;
      }
      if (bestScore >= 1.0) break;
    }

    if (bestScore > 0) {
      totalScore += bestScore;
      matchedAny = true;
      if (tierRank(bestTier) < tierRank(worstTier)) {
        worstTier = bestTier;
      }
    } else {
      // AND semantics: every query token must match at least something
      return { score: 0, tier: 'none' };
    }
  }

  return {
    score: matchedAny ? totalScore / queryTokens.length : 0,
    tier: matchedAny ? worstTier : 'none',
  };
}

function tierRank(t: MatchTier): number {
  switch (t) {
    case 'exact':
      return 4;
    case 'prefix':
      return 3;
    case 'fuzzy':
      return 2;
    case 'none':
      return 1;
  }
}
