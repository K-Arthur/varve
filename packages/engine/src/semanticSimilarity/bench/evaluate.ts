/**
 * Semantic-similarity evaluation harness.
 *
 * Runs a model adapter over the Varve corpus and produces:
 *   - semantic-lane retrieval metrics (R@1/5/10, mAP, nDCG, MRR),
 *     overall, per-domain, and per-relation (variant robustness)
 *   - near-duplicate-lane precision/recall/FPR for the perceptual-hash
 *     path plus exact-content-only behavior
 *   - per-query ranking tables (for contact sheets and difficult-case
 *     review)
 *   - embedding latency (cold load, warm p50/p95, throughput)
 *
 * Output: reports/semantic-similarity/evaluation-<model>.json and
 * companion HTML contact sheets. Dev-only.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cosineSimilarity } from '../../inference/models/siglip';
import { dHash, hammingDistance, pHash } from '../../intelligence/perceptualHash';
import {
  type Corpus,
  type CorpusImage,
  decodeCorpusImage,
  duplicateRelevantSet,
  subjectRelevantSet,
} from './corpus';
import {
  computeRetrievalMetrics,
  type DuplicateDetectionMetrics,
  duplicateMetrics,
  type RetrievalMetrics,
} from './metrics';
import { type EmbeddingModelAdapter, percentile } from './models';

export interface RankedEntry {
  id: string;
  score: number;
  relation: string;
  domain: string;
  relevant: boolean;
}

export interface QueryReport {
  id: string;
  domain: string;
  base: string;
  relation: string;
  relevantCount: number;
  semantic: RankedEntry[];
  duplicate: RankedEntry[];
}

export interface EvaluationReport {
  generatedAt: string;
  model: { id: string; dimension: number; preprocessingVersion: string; modelPath: string };
  corpus: { imageCount: number; queryCount: number };
  embedding: {
    coldMs: number | null;
    warmP50Ms: number;
    warmP95Ms: number;
    throughputPerSec: number;
  };
  semantic: {
    overall: RetrievalMetrics;
    perDomain: Record<string, RetrievalMetrics>;
    perRelation: Record<string, RetrievalMetrics>;
  };
  duplicate: {
    threshold: { dHashBits: number; pHashBits: number };
    hashLane: DuplicateDetectionMetrics;
    exactContentLane: DuplicateDetectionMetrics;
    perRelationRecall: Record<string, number>;
  };
  queries: QueryReport[];
}

function cosineRank(
  queryId: string,
  query: Float32Array,
  images: CorpusImage[],
  vectors: Map<string, Float32Array>,
  relevant: Set<string>,
): RankedEntry[] {
  return images
    .filter((img) => img.id !== queryId)
    .map((img) => {
      const v = vectors.get(img.id);
      const score = v ? cosineSimilarity(query, v) : -1;
      return {
        id: img.id,
        score,
        relation: img.relation,
        domain: img.domain,
        relevant: relevant.has(img.id),
      };
    })
    .filter((e) => e.score >= 0)
    .sort((a, b) => b.score - a.score);
}

function hashDistanceRank(
  query: CorpusImage,
  queryHashes: { dHash: string; pHash: string },
  images: CorpusImage[],
  hashes: Map<string, { dHash: string; pHash: string }>,
  relevant: Set<string>,
): RankedEntry[] {
  return images
    .filter((img) => img.id !== query.id)
    .map((img) => {
      const h = hashes.get(img.id);
      if (!h) return null;
      const d = hammingDistance(queryHashes.dHash, h.dHash);
      const p = hammingDistance(queryHashes.pHash, h.pHash);
      return {
        id: img.id,
        score: 1 - (d + p) / 128,
        relation: img.relation,
        domain: img.domain,
        relevant: relevant.has(img.id),
      };
    })
    .filter((e): e is RankedEntry => e !== null)
    .sort((a, b) => b.score - a.score);
}

export async function evaluateModel(
  adapter: EmbeddingModelAdapter,
  corpus: Corpus,
  options: {
    threshold?: { dHashBits: number; pHashBits: number };
    /** Resume/save embeddings at this path (base64 float32 per image id). */
    cacheFile?: string;
  } = {},
): Promise<EvaluationReport> {
  const threshold = options.threshold ?? { dHashBits: 10, pHashBits: 12 };
  const vectors = new Map<string, Float32Array>();
  const hashes = new Map<string, { dHash: string; pHash: string }>();
  const imageFiles = new Map<string, string>();

  if (options.cacheFile) {
    try {
      const loaded = JSON.parse(readFileSync(options.cacheFile, 'utf-8')) as {
        modelId: string;
        vectors: Record<string, string>;
      };
      if (loaded.modelId === adapter.id) {
        for (const [id, base64] of Object.entries(loaded.vectors)) {
          const bytes = Buffer.from(base64, 'base64');
          const values = new Float32Array(bytes.byteLength / 4);
          new Uint8Array(values.buffer).set(bytes);
          vectors.set(id, values);
        }
      }
    } catch {
      // No usable cache; recompute everything.
    }
  }

  const coldStart = performance.now();
  for (const image of corpus.images) {
    decodeCorpusImage(image);
    imageFiles.set(image.id, image.file);
    if (!vectors.has(image.id)) {
      const vector = await adapter.embed(image.rgba!, image.width, image.height);
      vectors.set(image.id, vector);
    }
    const imageData = { data: image.rgba!, width: image.width, height: image.height } as ImageData;
    hashes.set(image.id, { dHash: dHash(imageData), pHash: pHash(imageData) });
  }
  const coldMs = performance.now() - coldStart;

  if (options.cacheFile && vectors.size > 0) {
    mkdirSync(dirname(options.cacheFile), { recursive: true });
    const payload: Record<string, string> = {};
    for (const [id, v] of vectors) payload[id] = Buffer.from(v.buffer).toString('base64');
    writeFileSync(
      options.cacheFile,
      JSON.stringify({ modelId: adapter.id, vectors: payload }, null, 1),
    );
  }

  const samples = [...adapter.timing.samplesMs].sort((a, b) => a - b);
  const warmP50 = percentile(samples, 50);
  const warmP95 = percentile(samples, 95);
  const throughput = samples.length / (samples.reduce((a, b) => a + b, 0) / 1000 || 1);

  const queries = corpus.images.filter((img) => img.relation === 'base');
  const queryReports: QueryReport[] = [];

  for (const query of queries) {
    const relevant = subjectRelevantSet(corpus, query);
    const semantic = cosineRank(query.id, vectors.get(query.id)!, corpus.images, vectors, relevant);
    const dupRelevant = duplicateRelevantSet(corpus, query);
    const duplicate = hashDistanceRank(
      query,
      hashes.get(query.id)!,
      corpus.images,
      hashes,
      dupRelevant,
    );
    queryReports.push({
      id: query.id,
      domain: query.domain,
      base: query.base,
      relation: query.relation,
      relevantCount: relevant.size,
      semantic,
      duplicate,
    });
  }

  const toMetric = (
    reports: QueryReport[],
    pick: (q: QueryReport) => RankedEntry[],
    relevantOf: (q: QueryReport) => Set<string>,
  ) =>
    computeRetrievalMetrics(
      reports.map((q) => ({
        id: q.id,
        ranked: pick(q).map((e) => ({ id: e.id, score: e.score })),
        relevant: relevantOf(q),
      })),
    );

  const overall = toMetric(
    queryReports,
    (q) => q.semantic,
    (q) => subjectRelevantSet(corpus, corpus.byId.get(q.id)!),
  );

  const perDomain: Record<string, RetrievalMetrics> = {};
  for (const domain of new Set(queryReports.map((q) => q.domain))) {
    perDomain[domain] = toMetric(
      queryReports.filter((q) => q.domain === domain),
      (q) => q.semantic,
      (q) => subjectRelevantSet(corpus, corpus.byId.get(q.id)!),
    );
  }

  const perRelation: Record<string, RetrievalMetrics> = {};
  for (const relation of [
    'exact',
    'resized',
    'jpeg-q60',
    'jpeg-q85',
    'png-jpeg-roundtrip',
    'hue-shifted',
    'monochrome',
    'mirrored',
    'crop-center',
    'crop-offset',
    'rotate-90',
    'badge-overlay',
    'text-overlay',
    'framing',
    'framing-2',
    'style',
  ]) {
    const relSet = (q: QueryReport) =>
      new Set(
        corpus.images
          .filter((i) => i.family === corpus.byId.get(q.id)!.family && i.relation === relation)
          .map((i) => i.id),
      );
    const reports = queryReports.filter((q) => relSet(q).size > 0);
    if (reports.length === 0) continue;
    perRelation[relation] = toMetric(reports, (q) => q.semantic, relSet);
  }

  // Near-duplicate lane confusion.
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  let tpExact = 0,
    fnExact = 0,
    tnExact = 0,
    fpExact = 0;
  const perRelationRecall: Record<string, { hits: number; total: number }> = {};
  for (const query of queries) {
    const relevant = duplicateRelevantSet(corpus, query);
    const queryHashes = hashes.get(query.id)!;
    for (const candidate of corpus.images) {
      if (candidate.id === query.id) continue;
      const h = hashes.get(candidate.id);
      if (!h) continue;
      const isRelevant = relevant.has(candidate.id);
      const d = hammingDistance(queryHashes.dHash, h.dHash);
      const p = hammingDistance(queryHashes.pHash, h.pHash);
      const hit = d <= threshold.dHashBits && p <= threshold.pHashBits;
      if (isRelevant) {
        if (hit) tp++;
        else fn++;
        perRelationRecall[candidate.relation] ??= { hits: 0, total: 0 };
        perRelationRecall[candidate.relation]!.total++;
        if (hit) perRelationRecall[candidate.relation]!.hits++;
        // exact-content lane: byte-identical pixels
        if (candidate.relation === 'exact') {
          if (hit) tpExact++;
          else fnExact++;
        }
      } else {
        if (hit) fp++;
        else tn++;
        if (candidate.relation === 'exact') {
          if (hit) fpExact++;
          else tnExact++;
        }
      }
    }
  }
  const hashLane = duplicateMetrics({
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
  });
  const exactContentLane = duplicateMetrics({
    truePositives: tpExact,
    falsePositives: fpExact,
    trueNegatives: tnExact,
    falseNegatives: fnExact,
  });
  const perRelationRecallFinal: Record<string, number> = {};
  for (const [relation, counts] of Object.entries(perRelationRecall)) {
    perRelationRecallFinal[relation] = counts.total > 0 ? counts.hits / counts.total : 0;
  }

  return {
    generatedAt: new Date().toISOString(),
    model: {
      id: adapter.id,
      dimension: adapter.dimension,
      preprocessingVersion: adapter.preprocessingVersion,
      modelPath: adapter.modelPath,
    },
    corpus: { imageCount: corpus.images.length, queryCount: queries.length },
    embedding: { coldMs, warmP50Ms: warmP50, warmP95Ms: warmP95, throughputPerSec: throughput },
    semantic: { overall, perDomain, perRelation },
    duplicate: { threshold, hashLane, exactContentLane, perRelationRecall: perRelationRecallFinal },
    queries: queryReports,
  };
}

export function writeEvaluationReport(
  report: EvaluationReport,
  root = resolve(process.cwd(), 'reports/semantic-similarity'),
): string {
  mkdirSync(root, { recursive: true });
  const file = join(root, `evaluation-${report.model.id}.json`);
  writeFileSync(file, JSON.stringify(report, null, 1));
  return file;
}

/** Compact markdown table renderer for terminal/CI summaries. */
export function summarizeReport(report: EvaluationReport): string {
  const s = report.semantic;
  const d = report.duplicate;
  const lines = [
    `model: ${report.model.id} (dim ${report.model.dimension}, ${report.model.preprocessingVersion})`,
    `  semantic  R@1 ${(s.overall.recallAt1 * 100).toFixed(1)}%  R@5 ${(s.overall.recallAt5 * 100).toFixed(1)}%  R@10 ${(s.overall.recallAt10 * 100).toFixed(1)}%  mAP ${(s.overall.mAP * 100).toFixed(1)}%  nDCG ${(s.overall.nDCG * 100).toFixed(1)}%  MRR ${(s.overall.mrr * 100).toFixed(1)}%`,
    `  dup-hash   P ${(d.hashLane.precision * 100).toFixed(1)}%  R ${(d.hashLane.recall * 100).toFixed(1)}%  FPR ${(d.hashLane.falsePositiveRate * 100).toFixed(1)}%  F1 ${(d.hashLane.f1 * 100).toFixed(1)}%`,
    `  dup-exact  R ${(d.exactContentLane.recall * 100).toFixed(1)}%  FPR ${(d.exactContentLane.falsePositiveRate * 100).toFixed(1)}%`,
    `  latency    cold ${report.embedding.coldMs?.toFixed(0)}ms  warm p50 ${report.embedding.warmP50Ms.toFixed(0)}ms  p95 ${report.embedding.warmP95Ms.toFixed(0)}ms  ${report.embedding.throughputPerSec.toFixed(1)} img/s`,
  ];
  for (const [domain, m] of Object.entries(s.perDomain)) {
    lines.push(
      `  ${domain.padEnd(14)} R@5 ${(m.recallAt5 * 100).toFixed(1)}%  R@10 ${(m.recallAt10 * 100).toFixed(1)}%  mAP ${(m.mAP * 100).toFixed(1)}%`,
    );
  }
  return lines.join('\n');
}
