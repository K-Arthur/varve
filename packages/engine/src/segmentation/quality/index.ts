/**
 * Object-selection quality harness: corpus + metrics + a backend-agnostic
 * evaluation seam.
 *
 * - `SEGMENTATION_CORPUS` — license-safe synthetic fixtures (generated from
 *   code, no third-party assets; categories map to editor-relevant cases).
 * - `computeSegmentationQuality` / `evaluateCorpus` — IoU, Dice, boundary
 *   F-score; any backend adapter (worker-backed SAM2, a future Candle
 *   backend, a mock) plugs in through the `predict` function.
 *
 * See docs/quality/object-selection-parity.md for the release-gate
 * procedure (tolerances, real-model run, latency matrix).
 */

export { SEGMENTATION_CORPUS, type SegmentationCorpusFixture } from './corpus';
export {
  boundaryFScore,
  computeSegmentationQuality,
  evaluateCorpus,
  maskDice,
  maskIoU,
  type SegmentationQualityMetrics,
} from './metrics';
