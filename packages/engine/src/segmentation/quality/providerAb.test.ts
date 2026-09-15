// @vitest-environment node
/**
 * Promptable-provider A/B harness (manual, gated).
 *
 * Runs the shared license-safe corpus through every locally pinned provider
 * with onnxruntime-node and writes per-fixture metrics, latency, and memory to
 * JSON for the routing validation table and the provider-promotion record.
 *
 * This is deliberately the same corpus and the same production encode/decode
 * functions the app uses, so a routing decision can cite one comparable
 * measurement instead of a marketing quality number.
 *
 * Enable per provider:
 *   VARVE_SAM2_REAL_MODEL_DIR       dir with sam2_hiera_tiny.encoder.repaired.onnx + sam2_hiera_tiny.decoder.onnx
 *   VARVE_MOBILE_SAM_MODEL_DIR      dir with mobile_sam_image_encoder.onnx + sam_mask_decoder_multi.onnx
 *   VARVE_EFFICIENT_SAM_MODEL_DIR   dir with efficientsam_ti_encoder.onnx + efficientsam_ti_decoder.onnx
 *
 * Results default to /tmp/opencode/provider-ab-results.json.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Tensor } from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import {
  decodeEfficientSamDecoderOutput,
  encodeEfficientSamPrompts,
  preprocessEfficientSamImageData,
} from '../../inference/models/efficientSam';
import {
  decodeMobileSamDecoderOutput,
  encodeMobileSamPrompts,
  preprocessMobileSamImageData,
} from '../../inference/models/mobileSam';
import {
  decodeSam2DecoderOutput,
  encodeSam2Prompts,
  SAM2_INPUT_SIZE,
  SAM2_TENSOR_SPEC,
} from '../../inference/models/sam2';
import { validateMeasurementRecord } from '../../validation/measurementRecord';
import {
  type CandidateRankingCase,
  type CandidateRankingPolicyId,
  computeCandidateRankingFeatures,
  evaluateRankingPolicy,
  evaluateRankingPolicyByCategory,
} from '../candidateRanking';
import { PROMPTED_CRITICAL_CATEGORIES } from '../promptedRouting';
import type { SegmentationCorpusFixture } from './corpus';
import {
  buildProviderQualityRecord,
  derivePromptedQualityValidation,
  encodeMaskRle,
  type ProviderAbEvidence,
  type ProviderCategoryMeasurement,
} from './evidenceRecord';
import { computeSegmentationQuality, type SegmentationQualityMetrics } from './metrics';

if (typeof globalThis.ImageData === 'undefined') {
  class NodeImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as unknown as { ImageData: typeof NodeImageData }).ImageData = NodeImageData;
}

const SAM2_DIR = process.env.VARVE_SAM2_REAL_MODEL_DIR ?? '';
const MOBILE_DIR = process.env.VARVE_MOBILE_SAM_MODEL_DIR ?? '';
const EFFICIENT_DIR = process.env.VARVE_EFFICIENT_SAM_MODEL_DIR ?? '';
const RESULTS_PATH =
  process.env.VARVE_PROVIDER_AB_RESULTS_PATH ?? '/tmp/opencode/provider-ab-results.json';
const EVIDENCE_FIXTURE_PATH =
  process.env.VARVE_PROVIDER_AB_EVIDENCE_PATH ?? '/tmp/opencode/provider-ab-evidence.json';
const RANKING_FIXTURE_PATH =
  process.env.VARVE_RANKING_FIXTURE_PATH ?? '/tmp/opencode/ranking-candidates.json';

type OrtModule = typeof import('onnxruntime-node');

type ProviderResult = {
  selected: { mask: Uint8Array; score: number };
  candidateMasks: Uint8Array[];
  candidateCount: number;
  selectedIndex: number;
  scores: number[];
  encoderMs: number;
  decoderMs: number;
  rssBytes: number;
};

type Provider = {
  id: string;
  label: string;
  coldStartMs: number;
  /** Artifact files that define this provider's byte identity. */
  artifacts: Record<string, string>;
  prepare: (fixture: SegmentationCorpusFixture) => Promise<ProviderResult>;
};

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function normalizedFixturePrompts(fixture: SegmentationCorpusFixture): {
  points: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
} {
  return {
    points: fixture.prompts.points.map((point) => ({
      x: point.x / fixture.width,
      y: point.y / fixture.height,
      label: point.label,
    })),
    ...(fixture.prompts.box
      ? {
          box: {
            x1: fixture.prompts.box.x1 / fixture.width,
            y1: fixture.prompts.box.y1 / fixture.height,
            x2: fixture.prompts.box.x2 / fixture.width,
            y2: fixture.prompts.box.y2 / fixture.height,
          },
        }
      : {}),
  };
}

function currentCodeRevision(): string {
  if (process.env.VARVE_AB_CODE_REVISION) return process.env.VARVE_AB_CODE_REVISION;
  try {
    return execSync('git rev-parse HEAD', { cwd: process.cwd() }).toString().trim();
  } catch {
    return 'unknown-revision';
  }
}

function letterboxNchw(imageData: ImageData): {
  data: Float32Array;
  offsetX: number;
  offsetY: number;
} {
  const size = SAM2_INPUT_SIZE;
  const { width: sourceWidth, height: sourceHeight, data: rgba } = imageData;
  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  const contentWidth = Math.round(sourceWidth * scale);
  const contentHeight = Math.round(sourceHeight * scale);
  const offsetX = Math.floor((size - contentWidth) / 2);
  const offsetY = Math.floor((size - contentHeight) / 2);
  const plane = size * size;
  const data = new Float32Array(plane * 3);
  const [meanR, meanG, meanB] = SAM2_TENSOR_SPEC.mean;
  const [stdR, stdG, stdB] = SAM2_TENSOR_SPEC.std;
  const sample = (x: number, y: number, channel: number): number => {
    const cx = Math.max(0, Math.min(sourceWidth - 1, x));
    const cy = Math.max(0, Math.min(sourceHeight - 1, y));
    return rgba[(cy * sourceWidth + cx) * 4 + channel]! / 255;
  };
  for (let y = 0; y < size; y += 1) {
    const sy = (y - offsetY + 0.5) / scale - 0.5;
    for (let x = 0; x < size; x += 1) {
      const sx = (x - offsetX + 0.5) / scale - 0.5;
      let r = 0;
      let g = 0;
      let b = 0;
      if (sx >= -0.5 && sy >= -0.5 && sx <= sourceWidth - 0.5 && sy <= sourceHeight - 0.5) {
        const x0 = Math.max(0, Math.min(sourceWidth - 1, Math.floor(sx)));
        const y0 = Math.max(0, Math.min(sourceHeight - 1, Math.floor(sy)));
        const x1 = Math.max(0, Math.min(sourceWidth - 1, x0 + 1));
        const y1 = Math.max(0, Math.min(sourceHeight - 1, y0 + 1));
        const tx = Math.max(0, Math.min(1, sx - x0));
        const ty = Math.max(0, Math.min(1, sy - y0));
        const topR = sample(x0, y0, 0) * (1 - tx) + sample(x1, y0, 0) * tx;
        const topG = sample(x0, y0, 1) * (1 - tx) + sample(x1, y0, 1) * tx;
        const topB = sample(x0, y0, 2) * (1 - tx) + sample(x1, y0, 2) * tx;
        const bottomR = sample(x0, y1, 0) * (1 - tx) + sample(x1, y1, 0) * tx;
        const bottomG = sample(x0, y1, 1) * (1 - tx) + sample(x1, y1, 1) * tx;
        const bottomB = sample(x0, y1, 2) * (1 - tx) + sample(x1, y1, 2) * tx;
        r = topR * (1 - ty) + bottomR * ty;
        g = topG * (1 - ty) + bottomG * ty;
        b = topB * (1 - ty) + bottomB * ty;
      }
      const index = y * size + x;
      data[index] = (r - meanR!) / stdR!;
      data[plane + index] = (g - meanG!) / stdG!;
      data[plane * 2 + index] = (b - meanB!) / stdB!;
    }
  }
  return { data, offsetX, offsetY };
}

async function loadSam2Provider(ort: OrtModule): Promise<Provider> {
  const coldStart = performance.now();
  const enc = await ort.InferenceSession.create(
    join(SAM2_DIR, 'sam2_hiera_tiny.encoder.repaired.onnx'),
    { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
  );
  const dec = await ort.InferenceSession.create(join(SAM2_DIR, 'sam2_hiera_tiny.decoder.onnx'), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  const coldStartMs = performance.now() - coldStart;
  return {
    id: 'sam2-hiera-tiny',
    label: 'SAM2 Hiera Tiny',
    artifacts: {
      encoder: join(SAM2_DIR, 'sam2_hiera_tiny.encoder.repaired.onnx'),
      decoder: join(SAM2_DIR, 'sam2_hiera_tiny.decoder.onnx'),
    },
    coldStartMs,
    prepare: async (fixture) => {
      const { data, offsetX, offsetY } = letterboxNchw(fixture.image);
      const encoderStarted = performance.now();
      const encoderOutputs = (await enc.run({
        [enc.inputNames[0]!]: new ort.Tensor('float32', data, [
          1,
          3,
          SAM2_INPUT_SIZE,
          SAM2_INPUT_SIZE,
        ]),
      })) as unknown as Record<string, Tensor>;
      const encoderMs = performance.now() - encoderStarted;
      const encoded = encodeSam2Prompts(
        {
          points: fixture.prompts.points.map((point) => ({
            x: point.x / fixture.width,
            y: point.y / fixture.height,
            label: point.label,
          })),
          box: fixture.prompts.box
            ? {
                x1: fixture.prompts.box.x1 / fixture.width,
                y1: fixture.prompts.box.y1 / fixture.height,
                x2: fixture.prompts.box.x2 / fixture.width,
                y2: fixture.prompts.box.y2 / fixture.height,
              }
            : undefined,
        },
        { offsetX, offsetY },
      );
      const decoderStarted = performance.now();
      const outputs = (await dec.run({
        image_embed: encoderOutputs.image_embed!,
        high_res_feats_0: encoderOutputs.high_res_feats_0!,
        high_res_feats_1: encoderOutputs.high_res_feats_1!,
        point_coords: new ort.Tensor('float32', encoded.pointCoords.data, encoded.pointCoords.dims),
        point_labels: new ort.Tensor('float32', encoded.pointLabels.data, encoded.pointLabels.dims),
        mask_input: new ort.Tensor('float32', encoded.maskInput.data, encoded.maskInput.dims),
        has_mask_input: new ort.Tensor(
          'float32',
          encoded.hasMaskInput.data,
          encoded.hasMaskInput.dims,
        ),
      })) as unknown as Record<string, Tensor>;
      const decoderMs = performance.now() - decoderStarted;
      const tensors = Object.values(outputs);
      const masks = tensors.find((tensor) => tensor.dims.length === 4)!;
      const iou = tensors.find((tensor) => tensor.dims.length === 2);
      const decoded = decodeSam2DecoderOutput(
        masks.data as Float32Array,
        [...masks.dims],
        (iou?.data as Float32Array | undefined) ?? null,
        iou ? [...iou.dims] : null,
        fixture.width,
        fixture.height,
        { offsetX, offsetY },
      );
      const selected = decoded.masks[decoded.selectedIndex]!;
      return {
        selected: { mask: selected.mask, score: selected.iouScore },
        candidateMasks: decoded.masks.map((candidate) => candidate.mask),
        candidateCount: decoded.masks.length,
        selectedIndex: decoded.selectedIndex,
        scores: decoded.masks.map((candidate) => candidate.iouScore),
        encoderMs,
        decoderMs,
        rssBytes: process.memoryUsage().rss,
      };
    },
  };
}

async function loadMobileSamProvider(ort: OrtModule): Promise<Provider> {
  const coldStart = performance.now();
  const enc = await ort.InferenceSession.create(join(MOBILE_DIR, 'mobile_sam_image_encoder.onnx'), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  const dec = await ort.InferenceSession.create(join(MOBILE_DIR, 'sam_mask_decoder_multi.onnx'), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  const coldStartMs = performance.now() - coldStart;
  return {
    id: 'mobile-sam',
    label: 'MobileSAM',
    artifacts: {
      encoder: join(MOBILE_DIR, 'mobile_sam_image_encoder.onnx'),
      decoder: join(MOBILE_DIR, 'sam_mask_decoder_multi.onnx'),
    },
    coldStartMs,
    prepare: async (fixture) => {
      const input = preprocessMobileSamImageData(fixture.image);
      const encoderStarted = performance.now();
      const encoderOutputs = (await enc.run({
        [enc.inputNames[0]!]: new ort.Tensor('float32', input.tensor, [
          input.height,
          input.width,
          3,
        ]),
      })) as unknown as Record<string, Tensor>;
      const encoderMs = performance.now() - encoderStarted;
      const embedding = encoderOutputs.image_embeddings!;
      const encoded = encodeMobileSamPrompts(
        {
          points: fixture.prompts.points.map((point) => ({
            x: point.x / fixture.width,
            y: point.y / fixture.height,
            label: point.label,
          })),
          box: fixture.prompts.box
            ? {
                x1: fixture.prompts.box.x1 / fixture.width,
                y1: fixture.prompts.box.y1 / fixture.height,
                x2: fixture.prompts.box.x2 / fixture.width,
                y2: fixture.prompts.box.y2 / fixture.height,
              }
            : undefined,
        },
        fixture.width,
        fixture.height,
      );
      const decoderStarted = performance.now();
      const outputs = (await dec.run({
        image_embeddings: embedding,
        point_coords: new ort.Tensor(
          'float32',
          encoded.point_coords!.data,
          encoded.point_coords!.dims,
        ),
        point_labels: new ort.Tensor(
          'float32',
          encoded.point_labels!.data,
          encoded.point_labels!.dims,
        ),
        mask_input: new ort.Tensor('float32', encoded.mask_input!.data, encoded.mask_input!.dims),
        has_mask_input: new ort.Tensor(
          'float32',
          encoded.has_mask_input!.data,
          encoded.has_mask_input!.dims,
        ),
        orig_im_size: new ort.Tensor(
          'float32',
          encoded.orig_im_size!.data,
          encoded.orig_im_size!.dims,
        ),
      })) as unknown as Record<string, Tensor>;
      const decoderMs = performance.now() - decoderStarted;
      const masks = outputs.masks!;
      const scores = outputs.iou_predictions!;
      const lowRes = outputs.low_res_masks;
      const decoded = decodeMobileSamDecoderOutput(
        masks.data as Float32Array,
        [...masks.dims],
        scores.data as Float32Array,
        [...scores.dims],
        fixture.width,
        fixture.height,
        lowRes?.data as Float32Array | undefined,
        lowRes ? [...lowRes.dims] : undefined,
      );
      const selected = decoded.masks[decoded.selectedIndex]!;
      return {
        selected: { mask: selected.mask, score: selected.score },
        candidateMasks: decoded.masks.map((candidate) => candidate.mask),
        candidateCount: decoded.masks.length,
        selectedIndex: decoded.selectedIndex,
        scores: decoded.masks.map((candidate) => candidate.score),
        encoderMs,
        decoderMs,
        rssBytes: process.memoryUsage().rss,
      };
    },
  };
}

async function loadEfficientSamProvider(ort: OrtModule): Promise<Provider> {
  const coldStart = performance.now();
  const enc = await ort.InferenceSession.create(
    join(EFFICIENT_DIR, 'efficientsam_ti_encoder.onnx'),
    { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
  );
  const dec = await ort.InferenceSession.create(
    join(EFFICIENT_DIR, 'efficientsam_ti_decoder.onnx'),
    { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
  );
  const coldStartMs = performance.now() - coldStart;
  return {
    id: 'efficient-sam-ti',
    label: 'EfficientSAM-Ti',
    artifacts: {
      encoder: join(EFFICIENT_DIR, 'efficientsam_ti_encoder.onnx'),
      decoder: join(EFFICIENT_DIR, 'efficientsam_ti_decoder.onnx'),
    },
    coldStartMs,
    prepare: async (fixture) => {
      const input = preprocessEfficientSamImageData(fixture.image);
      const encoderStarted = performance.now();
      const encoderOutputs = (await enc.run({
        [enc.inputNames[0]!]: new ort.Tensor('float32', input.tensor, [
          1,
          3,
          input.height,
          input.width,
        ]),
      })) as unknown as Record<string, Tensor>;
      const encoderMs = performance.now() - encoderStarted;
      const embedding = encoderOutputs.image_embeddings!;
      const encoded = encodeEfficientSamPrompts(
        {
          points: fixture.prompts.points.map((point) => ({
            x: point.x / fixture.width,
            y: point.y / fixture.height,
            label: point.label,
          })),
          box: fixture.prompts.box
            ? {
                x1: fixture.prompts.box.x1 / fixture.width,
                y1: fixture.prompts.box.y1 / fixture.height,
                x2: fixture.prompts.box.x2 / fixture.width,
                y2: fixture.prompts.box.y2 / fixture.height,
              }
            : undefined,
        },
        fixture.width,
        fixture.height,
      );
      const decoderStarted = performance.now();
      const outputs = (await dec.run({
        image_embeddings: embedding,
        batched_point_coords: new ort.Tensor(
          'float32',
          encoded.batched_point_coords.data,
          encoded.batched_point_coords.dims,
        ),
        batched_point_labels: new ort.Tensor(
          'float32',
          encoded.batched_point_labels.data,
          encoded.batched_point_labels.dims,
        ),
        orig_im_size: new ort.Tensor('int64', encoded.orig_im_size.data, encoded.orig_im_size.dims),
      })) as unknown as Record<string, Tensor>;
      const decoderMs = performance.now() - decoderStarted;
      const masks = outputs.output_masks!;
      const scores = outputs.iou_predictions!;
      const decoded = decodeEfficientSamDecoderOutput(
        masks.data as Float32Array,
        [...masks.dims],
        scores.data as Float32Array,
        [...scores.dims],
        fixture.width,
        fixture.height,
      );
      const selected = decoded.masks[decoded.selectedIndex]!;
      return {
        selected: { mask: selected.mask, score: selected.score },
        candidateMasks: decoded.masks.map((candidate) => candidate.mask),
        candidateCount: decoded.masks.length,
        selectedIndex: decoded.selectedIndex,
        scores: decoded.masks.map((candidate) => candidate.score),
        encoderMs,
        decoderMs,
        rssBytes: process.memoryUsage().rss,
      };
    },
  };
}

describe('promptable provider A/B (gated)', () => {
  const hasSam2 =
    SAM2_DIR.length > 0 && existsSync(join(SAM2_DIR, 'sam2_hiera_tiny.encoder.repaired.onnx'));
  const hasMobile =
    MOBILE_DIR.length > 0 &&
    existsSync(join(MOBILE_DIR, 'mobile_sam_image_encoder.onnx')) &&
    existsSync(join(MOBILE_DIR, 'sam_mask_decoder_multi.onnx'));
  const hasEfficient =
    EFFICIENT_DIR.length > 0 &&
    existsSync(join(EFFICIENT_DIR, 'efficientsam_ti_encoder.onnx')) &&
    existsSync(join(EFFICIENT_DIR, 'efficientsam_ti_decoder.onnx'));
  it.skipIf(!hasSam2 && !hasMobile && !hasEfficient)(
    'runs the shared corpus through every available provider and records metrics',
    async () => {
      const { SEGMENTATION_CORPUS } = await import('./corpus');
      const ort = await import('onnxruntime-node');
      const require = createRequire(import.meta.url);
      const ortVersion = (require('onnxruntime-node/package.json') as { version: string }).version;
      const providers: Provider[] = [];
      if (hasSam2) providers.push(await loadSam2Provider(ort));
      if (hasMobile) providers.push(await loadMobileSamProvider(ort));
      if (hasEfficient) providers.push(await loadEfficientSamProvider(ort));
      const codeRevision = currentCodeRevision();
      const evidenceProviderFixtures: Array<Record<string, unknown>> = [];
      const rankingProviderFixtures: Array<Record<string, unknown>> = [];

      const payload: Record<string, unknown> = {
        corpusVersion: 'object-selection-corpus-v1',
        ortVersion,
        generatedAt: new Date().toISOString(),
        providers: [],
      };
      const providerRows: Array<Record<string, unknown>> = [];

      for (const provider of providers) {
        const rows: Array<Record<string, unknown>> = [];
        const evidenceRows: ProviderCategoryMeasurement[] = [];
        const rankingCases: CandidateRankingCase[] = [];
        const rankingCaseFixtures: Array<Record<string, unknown>> = [];
        for (const fixture of SEGMENTATION_CORPUS) {
          const result = await provider.prepare(fixture);
          const metrics = computeSegmentationQuality(
            result.selected.mask,
            fixture.oracleMask,
            fixture.width,
            fixture.height,
          );
          const candidateIoUs = result.candidateMasks.map(
            (mask) =>
              computeSegmentationQuality(mask, fixture.oracleMask, fixture.width, fixture.height)
                .iou,
          );
          const oracleBestIndex = candidateIoUs.indexOf(Math.max(...candidateIoUs));
          const prompts = normalizedFixturePrompts(fixture);
          const candidateFeatures = result.candidateMasks.map((mask, index) => {
            const score = result.scores[index];
            if (score === undefined || !Number.isFinite(score)) {
              throw new Error(
                `Provider '${provider.id}' returned candidate ${index} without a finite score.`,
              );
            }
            return computeCandidateRankingFeatures(
              mask,
              fixture.width,
              fixture.height,
              prompts,
              score,
            );
          });
          const selectedIoU = candidateIoUs[result.selectedIndex] ?? 0;
          const bestAvailableIou = Math.max(...candidateIoUs);
          rankingCases.push({
            caseId: fixture.id,
            category: fixture.category,
            features: candidateFeatures,
            candidateIoU: candidateIoUs,
            providerSelectedIndex: result.selectedIndex,
          });
          rankingCaseFixtures.push({
            caseId: fixture.id,
            category: fixture.category,
            width: fixture.width,
            height: fixture.height,
            prompts,
            scores: result.scores,
            candidateIoUs,
            providerSelectedIndex: result.selectedIndex,
            candidateRle: result.candidateMasks.map((mask) => encodeMaskRle(mask)),
          });
          evidenceRows.push({
            category: fixture.category,
            iou: metrics.iou,
            boundaryF: metrics.boundaryF,
            bestAvailableIou,
            regret: bestAvailableIou - selectedIoU,
            rankingMatch: result.selectedIndex === oracleBestIndex ? 1 : 0,
          });
          rows.push({
            caseId: fixture.id,
            category: fixture.category,
            width: fixture.width,
            height: fixture.height,
            metrics,
            candidateIoUs,
            oracleBestIndex,
            rankingMatchesOracle: result.selectedIndex === oracleBestIndex,
            selectedIndex: result.selectedIndex,
            candidateCount: result.candidateCount,
            scores: result.scores,
            encoderMs: result.encoderMs,
            decoderMs: result.decoderMs,
            rssBytes: result.rssBytes,
          });
          console.log(
            `AB ${provider.id.padEnd(16)} ${fixture.id.padEnd(18)} IoU ${metrics.iou.toFixed(3)} BF ${metrics.boundaryF.toFixed(3)} enc ${Math.round(result.encoderMs)}ms dec ${Math.round(result.decoderMs)}ms`,
          );
        }
        const mean = (pick: (row: Record<string, unknown>) => number): number =>
          rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
        const metricsOf = (row: Record<string, unknown>): SegmentationQualityMetrics =>
          row.metrics as SegmentationQualityMetrics;
        const summary = {
          providerId: provider.id,
          coldStartMs: provider.coldStartMs,
          meanIou: mean((row) => metricsOf(row).iou),
          meanDice: mean((row) => metricsOf(row).dice),
          meanBoundaryF: mean((row) => metricsOf(row).boundaryF),
          worstIou: Math.min(...rows.map((row) => metricsOf(row).iou)),
          worstBoundaryF: Math.min(...rows.map((row) => metricsOf(row).boundaryF)),
          meanEncoderMs: mean((row) => row.encoderMs as number),
          meanDecoderMs: mean((row) => row.decoderMs as number),
          peakRssBytes: Math.max(...rows.map((row) => row.rssBytes as number)),
          // Candidate-ranking calibration: does the provider's own top pick
          // match the oracle-best candidate, and how much IoU does a mismatch
          // cost? This is evidence about predicted-IoU reliability, not a
          // cross-provider score comparison.
          topCandidateAccuracy:
            rows.filter((row) => row.rankingMatchesOracle === true).length / rows.length,
          meanSelectedMinusBestIou: mean((row) => {
            const ious = row.candidateIoUs as number[];
            const selected = row.selectedIndex as number;
            return Math.max(...ious) - ious[selected]!;
          }),
        };
        console.log(
          `AB SUMMARY ${provider.id} cold ${Math.round(summary.coldStartMs)}ms meanIoU ${summary.meanIou.toFixed(3)} meanBF ${summary.meanBoundaryF.toFixed(3)} worstIoU ${summary.worstIou.toFixed(3)} worstBF ${summary.worstBoundaryF.toFixed(3)} enc ${Math.round(summary.meanEncoderMs)}ms dec ${Math.round(summary.meanDecoderMs)}ms rss ${Math.round(summary.peakRssBytes / 1e6)}MB topCand ${(summary.topCandidateAccuracy * 100).toFixed(0)}% rankGap ${summary.meanSelectedMinusBestIou.toFixed(3)}`,
        );
        providerRows.push({ ...summary, rows });

        const policies: CandidateRankingPolicyId[] = [
          'provider',
          'score',
          'guarded-band-box',
          'guarded-band-area',
        ];
        const evaluations = Object.fromEntries(
          policies.map((policy) => [policy, evaluateRankingPolicy(rankingCases, policy)]),
        );
        const evaluationsByCategory = Object.fromEntries(
          policies.map((policy) => [policy, evaluateRankingPolicyByCategory(rankingCases, policy)]),
        );
        for (const policy of policies) {
          const evaluation = evaluations[policy]!;
          console.log(
            `AB RANKING ${provider.id.padEnd(16)} ${policy.padEnd(18)} top1 ${evaluation.meanTop1IoU.toFixed(3)} best ${evaluation.meanBestAvailableIoU.toFixed(3)} regret ${evaluation.meanRegret.toFixed(4)} worst ${evaluation.worstRegret.toFixed(4)} accept ${(evaluation.top1AcceptableRate * 100).toFixed(0)}% coverage ${(evaluation.coverageRate * 100).toFixed(0)}%`,
          );
        }

        const artifactChecksums = Object.fromEntries(
          Object.entries(provider.artifacts).map(([name, path]) => {
            if (!existsSync(path)) {
              throw new Error(`Artifact '${name}' for ${provider.id} is missing: ${path}`);
            }
            return [name, sha256File(path)];
          }),
        );
        const evidence: ProviderAbEvidence = {
          providerId: provider.id,
          label: provider.label,
          runtimeEnvironment: `onnxruntime-node ${ortVersion} · CPU · ${process.platform} ${process.arch} · ${SEGMENTATION_CORPUS.length} fixtures · onnxruntime-node default intra-op threads (recorded as unspecified)`,
          measuredAt: payload.generatedAt as string,
          codeRevision,
          artifactChecksums,
          requiredCategories: [...new Set(rankingCases.map((item) => item.category))].sort(),
          criticalCategories: PROMPTED_CRITICAL_CATEGORIES,
          rows: evidenceRows,
          caseIds: rankingCases.map((item) => item.caseId),
        };
        const record = buildProviderQualityRecord(evidence);
        const verified = validateMeasurementRecord(record);
        expect(verified.status).toBe('verified');
        const validation = derivePromptedQualityValidation(evidence, record, verified);
        evidenceProviderFixtures.push({
          ...evidence,
          validation,
          recordSummary: verified.summary,
          recordWorstCritical: verified.worstCritical,
        });
        rankingProviderFixtures.push({
          providerId: provider.id,
          label: provider.label,
          runtimeEnvironment: evidence.runtimeEnvironment,
          artifactChecksums,
          evaluatedAt: evidence.measuredAt,
          codeRevision,
          cases: rankingCaseFixtures,
          evaluations,
          evaluationsByCategory,
        });
      }
      payload.providers = providerRows;

      const corpusHash = sha256File(join(dirname(new URL(import.meta.url).pathname), 'corpus.ts'));
      const evidencePayload = {
        fixtureVersion: 1,
        corpusVersion: 'object-selection-corpus-v1',
        corpusHash,
        ortVersion,
        nodeVersion: process.version,
        codeRevision,
        generatedAt: payload.generatedAt,
        providers: evidenceProviderFixtures,
      };
      const rankingPayload = {
        fixtureVersion: 1,
        corpusVersion: 'object-selection-corpus-v1',
        corpusHash,
        codeRevision,
        generatedAt: payload.generatedAt,
        providers: rankingProviderFixtures,
      };

      mkdirSync(dirname(RESULTS_PATH), { recursive: true });
      writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2));
      writeFileSync(EVIDENCE_FIXTURE_PATH, JSON.stringify(evidencePayload, null, 2));
      writeFileSync(RANKING_FIXTURE_PATH, JSON.stringify(rankingPayload, null, 2));
      expect(providerRows.length).toBeGreaterThan(0);
      expect(evidenceProviderFixtures.length).toBeGreaterThan(0);
    },
    1_800_000,
  );
});
