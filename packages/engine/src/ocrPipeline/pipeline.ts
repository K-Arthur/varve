/**
 * PaddleOCR v4 pipeline orchestration — detect text regions, recognize each,
 * map coordinates back to the source image.
 *
 * Architecture (mirrors RapidOCR / the official PaddleOCR inference scripts):
 *   1. Orientation detection (optional): analyze text regions or pixel gradients
 *      to detect 0/90/180/270 degree rotation; rotate if needed.
 *   2. Detection:    DB++ model -> per-pixel probability map -> threshold
 *                    flood-fill -> axis-aligned boxes.
 *   3. Recognition:  per-box crop -> H=48 aspect resize -> NCHW tensor ->
 *                    CRNN model -> CTC decode -> text + confidence.
 *
 * Dictionary routing:
 *   - 'paddleocr-rec-v4' expects the full ppocr_keys_v1.txt (6624 chars).
 *     The 64-char en_dict.txt is NOT compatible — using it would produce
 *     garbage. For English-only recognition, use 'tr-ocr-base-printed'.
 *   - 'tr-ocr-base-printed' has a built-in charset; no dict needed.
 *
 * Coordinate flow:
 *   1. Detector runs on padded image (stride-32 alignment).
 *   2. decodeTextRegions() rescales boxes back to unpadded image space.
 *   3. If orientation was corrected, words' coordinates are mapped back
 *      through the rotation to the original image space.
 *   4. The pipeline consumer (UI / layer generator) applies the ImageNode's
 *      world transform on top of that.
 *
 * Limitations (documented, not hidden):
 *   - Orientation correction uses heuristic analysis (not a dedicated cls
 *     model), so it may be less reliable on complex layouts.
 *   - Recognition quality depends on tight, well-cropped, upright text.
 *     Detection returns axis-aligned boxes; strongly rotated or
 *     perspective-distorted text will be misread.
 *   - Large cardinality: a dense page can yield hundreds of boxes. The
 *     pipeline caps generated output via maxRegions to bound work.
 */

import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import { decodeTextRegions, padToStride } from '../inference/models/paddleocr';
import { ctcDecode, preprocessPaddleRec } from '../inference/models/paddlerec';
import { postprocessTrOcr, preprocessTrOcr } from '../inference/models/trocr';
import { loadOcrDictionary } from '../inference/ocrDictionary';
import { getOcrModelConfig, validateDictionary } from './modelMetadata';
import {
  detectOrientationFromPixels,
  detectOrientationFromRegions,
  mapCoordsThroughRotation,
} from './orientation';
import type { OcrOptions, OcrResult, OcrWord, OrientationResult } from './types';

const DET_MODEL_ID = 'paddleocr-det-v4';
const REC_MODEL_ID = 'paddleocr-rec-v4';
const DEFAULT_MAX_REGIONS = 200;
const DEFAULT_PROB_THRESHOLD = 0.3;
const DEFAULT_ORIENTATION_CONFIDENCE_THRESHOLD = 0.3;

export interface PipelineOptions extends OcrOptions {
  /** Max text regions to process (bounding work for dense pages). */
  maxRegions?: number;
  /** Detector probability threshold (0-1). */
  probThreshold?: number;
  /** Skip recognition — return detection boxes only (fast preview). */
  detectOnly?: boolean;
  /** Minimum confidence for orientation detection to apply correction. */
  orientationConfidenceThreshold?: number;
}

/**
 * Run the full OCR pipeline on a source image.
 *
 * @param source  The full image (RGBA ImageData) to OCR.
 * @param options Pipeline options.
 */
export async function runOcrPipeline(
  source: ImageData,
  options: PipelineOptions = {},
): Promise<OcrResult> {
  const start = performance.now();
  const {
    signal,
    onProgress,
    maxRegions = DEFAULT_MAX_REGIONS,
    probThreshold = DEFAULT_PROB_THRESHOLD,
    detectOnly = false,
    autoRotate = false,
    recognitionModelId = REC_MODEL_ID,
    orientationConfidenceThreshold = DEFAULT_ORIENTATION_CONFIDENCE_THRESHOLD,
  } = options;

  if (signal?.aborted) throw new Error('cancelled');

  // ── 0. Orientation detection ──────────────────────────────────────────
  let orientation: OrientationResult = { angle: 0, confidence: 0 };
  let correctedSource = source;
  let orientationCorrected = false;

  if (autoRotate) {
    onProgress?.('orienting', 0, 1);

    // First pass: quick detection to get region distribution
    const quickRegions = await runDetectionOnly(source, signal, probThreshold);
    orientation = detectOrientationFromRegions(quickRegions, source.width, source.height);

    // Fall back to pixel-based analysis if region heuristic is inconclusive
    if (orientation.confidence < orientationConfidenceThreshold) {
      const pixelOrientation = detectOrientationFromPixels(source);
      if (pixelOrientation.confidence > orientation.confidence) {
        orientation = pixelOrientation;
      }
    }

    onProgress?.('orienting', 1, 1);

    if (orientation.confidence >= orientationConfidenceThreshold && orientation.angle !== 0) {
      const { rotateImageData } = await import('./orientation');
      correctedSource = rotateImageData(source, orientation.angle as 0 | 90 | 180 | 270);
      orientationCorrected = true;
    }
  }

  if (signal?.aborted) throw new Error('cancelled');

  // ── 1. Detection ──────────────────────────────────────────────────
  onProgress?.('detecting', 0, 1);
  const paddedW = padToStride(correctedSource.width);
  const paddedH = padToStride(correctedSource.height);
  const padCanvas = document.createElement('canvas');
  padCanvas.width = paddedW;
  padCanvas.height = paddedH;
  const padCtx = padCanvas.getContext('2d')!;
  padCtx.putImageData(correctedSource, 0, 0);

  const host = getInferenceWorkerHost();
  const detPath = await modelPath(DET_MODEL_ID, signal);
  const detResult = await host.infer(
    {
      type: 'infer',
      modelType: 'paddleocr-det',
      modelPath: detPath,
      modelId: DET_MODEL_ID,
      imageData: padCtx.getImageData(0, 0, paddedW, paddedH),
      reuseSession: true,
    },
    { signal, timeoutMs: 45_000 },
  );

  if (signal?.aborted) throw new Error('cancelled');

  const detOutputKey = Object.keys(detResult.outputs).find(
    (k) =>
      k !== 'executionProvider' &&
      !k.startsWith('original') &&
      !k.startsWith('padded') &&
      k !== 'letterbox',
  );
  if (!detOutputKey) throw new Error('OCR detection produced no output');
  const detOutput = detResult.outputs[detOutputKey] as { data: Float32Array; dims: number[] };
  const mapH = detOutput.dims[2] as number;
  const mapW = detOutput.dims[3] as number;

  const regions = decodeTextRegions(
    detOutput.data,
    mapW,
    mapH,
    correctedSource.width,
    correctedSource.height,
    probThreshold,
  );
  onProgress?.('detecting', 1, 1);

  // Map regions back through orientation correction, preserving confidence
  const mappedRegions = orientationCorrected
    ? regions.map((r) => ({
        ...mapCoordsThroughRotation(
          r.x,
          r.y,
          r.width,
          r.height,
          source.width,
          source.height,
          orientation.angle as 0 | 90 | 180 | 270,
        ),
        confidence: r.confidence,
      }))
    : regions;

  // Early-out: detection-only mode (fast preview with boxes, no text).
  if (detectOnly || mappedRegions.length === 0) {
    const elapsed = performance.now() - start;
    return {
      words: mappedRegions.map((r) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        detectionConfidence: r.confidence ?? 1,
        text: '',
        confidence: 0,
        charConfidences: [],
        orientationCorrected: orientationCorrected ? orientation.angle : undefined,
      })),
      executionProvider: (detResult.outputs.executionProvider as string) ?? 'wasm',
      processingTimeMs: elapsed,
      dictionaryAvailable: false,
      detectedOrientation: orientationCorrected ? orientation.angle : undefined,
      orientationConfidence: orientation.confidence,
      orientationCorrected,
      recognitionModelId: recognitionModelId,
    };
  }

  // Cap work for dense pages.
  const capped = mappedRegions.slice(0, maxRegions);

  // ── 2. Recognition ─────────────────────────────────────────────────
  // Route recognition based on model choice:
  //   'paddleocr-rec-v4' -> Paddle CRNN + dictionary
  //   'tr-ocr-base-printed' -> TrOCR (built-in charset, no dict)
  const recModelConfig = getOcrModelConfig(recognitionModelId);

  if (recognitionModelId === 'tr-ocr-base-printed') {
    // TrOCR: no dictionary needed, built-in charset
    const words = await runTrOcrRecognition(correctedSource, capped, signal, host);

    const elapsed = performance.now() - start;
    return {
      words,
      executionProvider: (detResult.outputs.executionProvider as string) ?? 'wasm',
      processingTimeMs: elapsed,
      dictionaryAvailable: true,
      detectedOrientation: orientationCorrected ? orientation.angle : undefined,
      orientationConfidence: orientation.confidence,
      orientationCorrected,
      recognitionModelId: recognitionModelId,
    };
  }

  // PaddleOCR recognition with dictionary
  const lang = options.language ?? 'en';

  if (lang !== 'zh' && lang !== 'en') {
    // Fall back to detection-only for unsupported languages
    const elapsed = performance.now() - start;
    return {
      words: mappedRegions.map((r) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        detectionConfidence: r.confidence ?? 1,
        text: '',
        confidence: 0,
        charConfidences: [],
      })),
      executionProvider: (detResult.outputs.executionProvider as string) ?? 'wasm',
      processingTimeMs: elapsed,
      dictionaryAvailable: false,
      detectedOrientation: orientationCorrected ? orientation.angle : undefined,
      orientationCorrected,
      recognitionModelId: recognitionModelId,
    };
  }

  // For English-only with PaddleOCR: warn that the full dict is needed
  const dictUrl = recModelConfig?.dictionaryUrl;

  if (!dictUrl) {
    throw new Error(`No dictionary configured for recognition model '${recognitionModelId}'`);
  }

  let dict: readonly string[];
  try {
    dict = await loadOcrDictionary(dictUrl, 0, signal);
    validateDictionary(recognitionModelId, dict);
  } catch (err) {
    throw new Error(
      `OCR dictionary for model '${recognitionModelId}' is not available. ` +
        `Download it first. (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (signal?.aborted) throw new Error('cancelled');

  // ── 3. Recognition per region ─────────────────────────────────────
  const recPath = await modelPath(recognitionModelId, signal);
  const words: OcrWord[] = [];

  for (let i = 0; i < capped.length; i++) {
    if (signal?.aborted) throw new Error('cancelled');
    const region = capped[i]!;
    onProgress?.('recognizing', i, capped.length);

    const crop = cropRegion(correctedSource, region);
    const recOut = await recognizeWithPaddle(crop, recPath, recognitionModelId, dict, host, signal);

    words.push({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      detectionConfidence: region.confidence ?? 1,
      text: recOut.text,
      confidence: recOut.confidence,
      charConfidences: recOut.charConfidences,
      orientationCorrected: orientationCorrected ? orientation.angle : undefined,
    });
  }

  if (signal?.aborted) throw new Error('cancelled');
  onProgress?.('done', capped.length, capped.length);

  const elapsed = performance.now() - start;
  return {
    words,
    executionProvider: (detResult.outputs.executionProvider as string) ?? 'wasm',
    processingTimeMs: elapsed,
    dictionaryAvailable: true,
    detectedOrientation: orientationCorrected ? orientation.angle : undefined,
    orientationConfidence: orientation.confidence,
    orientationCorrected,
    recognitionModelId: recognitionModelId,
  };
}

/**
 * Run detection only (no recognition) for orientation analysis pass.
 */
async function runDetectionOnly(
  source: ImageData,
  signal: AbortSignal | undefined,
  probThreshold: number,
): Promise<Array<{ x: number; y: number; width: number; height: number; confidence: number }>> {
  const paddedW = padToStride(source.width);
  const paddedH = padToStride(source.height);
  const padCanvas = document.createElement('canvas');
  padCanvas.width = paddedW;
  padCanvas.height = paddedH;
  const padCtx = padCanvas.getContext('2d')!;
  padCtx.putImageData(source, 0, 0);

  const host = getInferenceWorkerHost();
  const detPath = await modelPath(DET_MODEL_ID, signal);
  const detResult = await host.infer(
    {
      type: 'infer',
      modelType: 'paddleocr-det',
      modelPath: detPath,
      modelId: DET_MODEL_ID,
      imageData: padCtx.getImageData(0, 0, paddedW, paddedH),
      reuseSession: true,
    },
    { signal, timeoutMs: 45_000 },
  );

  const detOutputKey = Object.keys(detResult.outputs).find(
    (k) =>
      k !== 'executionProvider' &&
      !k.startsWith('original') &&
      !k.startsWith('padded') &&
      k !== 'letterbox',
  );
  if (!detOutputKey) return [];

  const detOutput = detResult.outputs[detOutputKey] as { data: Float32Array; dims: number[] };
  const mapH = detOutput.dims[2] as number;
  const mapW = detOutput.dims[3] as number;

  return decodeTextRegions(detOutput.data, mapW, mapH, source.width, source.height, probThreshold);
}

/**
 * Route recognition through TrOCR model (built-in charset, no dictionary).
 */
async function runTrOcrRecognition(
  source: ImageData,
  regions: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  signal: AbortSignal | undefined,
  host: ReturnType<typeof getInferenceWorkerHost>,
): Promise<OcrWord[]> {
  const recPath = await modelPath('tr-ocr-base-printed', signal);
  const words: OcrWord[] = [];

  for (let i = 0; i < regions.length; i++) {
    if (signal?.aborted) throw new Error('cancelled');
    const region = regions[i]!;

    const crop = cropRegion(source, region);
    const pre = preprocessTrOcr(crop);

    const recResult = await host.infer(
      {
        type: 'infer',
        modelType: 'trocr',
        modelPath: recPath,
        modelId: 'tr-ocr-base-printed',
        tensors: {
          pixel_values: {
            data: pre.tensor,
            dims: [1, 3, 384, 384],
          },
        },
        reuseSession: true,
      },
      { signal, timeoutMs: 60_000 },
    );

    if (signal?.aborted) throw new Error('cancelled');

    const logitsKey = Object.keys(recResult.outputs).find(
      (k) => k !== 'executionProvider' && !k.startsWith('original'),
    );
    if (!logitsKey) {
      words.push({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        detectionConfidence: 1,
        text: '',
        confidence: 0,
        charConfidences: [],
      });
      continue;
    }

    const logits = recResult.outputs[logitsKey] as { data: Float32Array; dims: number[] };
    const sequenceLength = logits.dims[1] as number;
    const decoded = postprocessTrOcr(logits.data, sequenceLength);

    words.push({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      detectionConfidence: 1,
      text: decoded.text,
      confidence: decoded.confidence,
      charConfidences: decoded.charConfidences,
    });
  }

  return words;
}

/** Crop a (possibly padded/clamped) region from the source image. */
function cropRegion(
  source: ImageData,
  region: { x: number; y: number; width: number; height: number },
): ImageData {
  const x = Math.max(0, Math.round(region.x));
  const y = Math.max(0, Math.round(region.y));
  const w = Math.min(Math.round(region.width), source.width - x);
  const h = Math.min(Math.round(region.height), source.height - y);
  const out = new ImageData(w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const si = ((y + row) * source.width + (x + col)) * 4;
      const di = (row * w + col) * 4;
      out.data[di] = source.data[si]!;
      out.data[di + 1] = source.data[si + 1]!;
      out.data[di + 2] = source.data[si + 2]!;
      out.data[di + 3] = source.data[si + 3]!;
    }
  }
  return out;
}

/** Recognize a single cropped text line using PaddleOCR recognition model. */
async function recognizeWithPaddle(
  imageData: ImageData,
  recPath: string,
  recModelId: string,
  dict: readonly string[],
  host: ReturnType<typeof getInferenceWorkerHost>,
  signal?: AbortSignal,
) {
  const pre = preprocessPaddleRec(imageData);
  const recResult = await host.infer(
    {
      type: 'infer',
      modelType: 'paddleocr-rec',
      modelPath: recPath,
      modelId: recModelId,
      tensors: { x: { data: pre.tensor, dims: [1, 3, pre.height, pre.width] } },
      reuseSession: true,
    },
    { signal, timeoutMs: 60_000 },
  );

  if (signal?.aborted) throw new Error('cancelled');

  const recOutputKey = Object.keys(recResult.outputs).find(
    (k) =>
      k !== 'executionProvider' &&
      !k.startsWith('original') &&
      !k.startsWith('padded') &&
      k !== 'letterbox',
  );
  if (!recOutputKey) throw new Error('OCR recognition produced no output');
  const recOutput = recResult.outputs[recOutputKey] as { data: Float32Array; dims: number[] };
  const T = recOutput.dims[1] as number;

  return ctcDecode(recOutput.data, T, dict);
}

/** Resolve a model path via the shared model loader (bundled-probe + IDB). */
async function modelPath(modelId: string, signal?: AbortSignal): Promise<string> {
  const { getModelLoader } = await import('../backgroundRemoval/modelLoader');
  const loader = getModelLoader(signal);
  const path = await loader.getModelPath(modelId, signal);
  if (!path) throw new Error(`OCR model '${modelId}' is not downloaded.`);
  return path;
}
