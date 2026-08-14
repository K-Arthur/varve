/**
 * Backend-neutral ranking for the Home asset browser.
 *
 * Search deliberately separates candidate generation from ranking. A backend
 * may provide a semantic rank map from a local image/text encoder later, but
 * filename, OCR, and metadata search remain useful when no model is present.
 * Semantic scores are never added to lexical scores: Reciprocal Rank Fusion
 * keeps the channels comparable and an exact name match gets an explicit
 * product-level override.
 */
import type { Asset } from './types';

export type AssetSearchLane = 'name' | 'ocr' | 'metadata' | 'semantic';

export interface AssetSearchOptions {
  /** One-based semantic ranks produced by a compatible local encoder. */
  semanticRanks?: ReadonlyMap<string, number>;
  topK?: number;
  rrfK?: number;
}

export interface AssetSearchReason {
  lane: AssetSearchLane;
  label: string;
}

export interface AssetSearchResult {
  asset: Asset;
  score: number;
  reasons: AssetSearchReason[];
}

export interface NormalizedAssetQuery {
  raw: string;
  normalized: string;
  tokens: string[];
  exactPhrase: string;
}

const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu;

export function normalizeAssetSearchQuery(raw: string): NormalizedAssetQuery {
  const normalized = raw.normalize('NFKC').trim().toLocaleLowerCase();
  const tokens = normalized.match(TOKEN_PATTERN) ?? [];
  return { raw, normalized, tokens, exactPhrase: normalized };
}

function searchableText(asset: Asset): { name: string; ocr: string; metadata: string } {
  return {
    name: asset.name.normalize('NFKC').toLocaleLowerCase(),
    ocr: asset.ocrText?.normalize('NFKC').toLocaleLowerCase() ?? '',
    metadata: [
      asset.kind,
      asset.mimeType,
      ...(asset.tags ?? []),
      asset.description ?? '',
      asset.path ?? '',
    ]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase(),
  };
}

function tokenScore(text: string, tokens: readonly string[]): number {
  if (!text || tokens.length === 0) return 0;
  return tokens.reduce((score, token) => {
    if (text === token) return score + 1;
    if (text.includes(` ${token} `) || text.startsWith(`${token} `)) return score + 0.8;
    if (text.includes(token)) return score + 0.45;
    return score;
  }, 0);
}

function laneRank(
  assets: readonly Asset[],
  query: NormalizedAssetQuery,
  lane: Exclude<AssetSearchLane, 'semantic'>,
): Map<string, { rank: number; reason: AssetSearchReason }> {
  const scored = assets
    .map((asset) => {
      const text = searchableText(asset)[lane];
      const exact = query.exactPhrase.length > 0 && text === query.exactPhrase;
      const phrase = query.exactPhrase.length > 1 && text.includes(query.exactPhrase);
      const score = exact ? 1000 : (phrase ? 100 : 0) + tokenScore(text, query.tokens);
      return { asset, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));

  return new Map(
    scored.map(({ asset }, index) => [
      asset.id,
      {
        rank: index + 1,
        reason: {
          lane,
          label:
            lane === 'name'
              ? 'Filename or path match'
              : lane === 'ocr'
                ? 'Recognized text match'
                : 'Metadata or tag match',
        },
      },
    ]),
  );
}

function addReason(reasons: AssetSearchReason[], reason: AssetSearchReason): void {
  if (!reasons.some((existing) => existing.lane === reason.lane)) reasons.push(reason);
}

/** Rank assets using lexical channels plus optional semantic ranks. */
export function searchAssets(
  assets: readonly Asset[],
  rawQuery: string,
  options: AssetSearchOptions = {},
): AssetSearchResult[] {
  const query = normalizeAssetSearchQuery(rawQuery);
  const topK = Math.max(1, (options.topK ?? assets.length) || 1);
  if (!query.normalized) {
    return assets
      .map((asset) => ({ asset, score: 0, reasons: [] }))
      .sort((a, b) => b.asset.updatedAt - a.asset.updatedAt || a.asset.id.localeCompare(b.asset.id))
      .slice(0, topK);
  }

  const laneRanks = [
    laneRank(assets, query, 'name'),
    laneRank(assets, query, 'ocr'),
    laneRank(assets, query, 'metadata'),
  ];
  const rrfK = Math.max(1, options.rrfK ?? 60);
  const semanticRanks = options.semanticRanks;
  const results = new Map<string, AssetSearchResult>();

  for (const asset of assets) {
    const result: AssetSearchResult = { asset, score: 0, reasons: [] };
    for (const ranks of laneRanks) {
      const hit = ranks.get(asset.id);
      if (!hit) continue;
      result.score += 1 / (rrfK + hit.rank);
      addReason(result.reasons, hit.reason);
    }
    const semanticRank = semanticRanks?.get(asset.id);
    if (semanticRank !== undefined && Number.isFinite(semanticRank) && semanticRank > 0) {
      result.score += 1 / (rrfK + semanticRank);
      addReason(result.reasons, { lane: 'semantic', label: 'Visual similarity match' });
    }

    // Preserve excellent exact retrieval for IDs and filenames. This is an
    // ordering guarantee, not a raw-score sum across incomparable channels.
    const name = searchableText(asset).name;
    const basename = name.slice(name.lastIndexOf('/') + 1);
    const stem = basename.replace(/\.[^./]+$/, '');
    if (
      name === query.exactPhrase ||
      name.endsWith(`/${query.exactPhrase}`) ||
      stem === query.exactPhrase
    ) {
      result.score += 2;
      result.reasons.unshift({ lane: 'name', label: 'Exact filename match' });
    }
    if (result.reasons.length > 0) results.set(asset.id, result);
  }

  return [...results.values()]
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id))
    .slice(0, topK);
}
