/**
 * PaddleOCR v4 pipeline orchestration — detect text regions, recognize each,
 * map coordinates back to the source image.
 *
 * Architecture (mirrors RapidOCR / the official PaddleOCR inference scripts):
 *   1. Detection:    DB++ model -> per-pixel probability map -> threshold
 *                    flood-fill -> axis-aligned boxes (existing decodeTextRegions).
 *   2. Recognition:  per-box crop -> H=48 aspect resize -> NCHW tensor ->
 *                    CRNN model -> CTC decode -> text + confidence.
 *
 * Coordinate flow: the detector runs on a padded image (stride-32 alignment).
 * decodeTextRegions() rescales boxes back to the unpadded (original) image
 * space, so OcrWord boxes are already in the original image's pixel
 * coordinates. The pipeline's consumer (UI / layer generator) applies the
 * ImageNode's own world transform on top of that.
 *
 * Limitations (documented, not hidden):
 *   - No angle-classification / rotation correction yet (would need the
 *     separate cls model; rotated text decodes poorly). autoRotate is a stub.
 *   - Recognition quality depends on tight, well-cropped, upright text.
 *     Detection returns axis-aligned boxes; strongly rotated or
 *     perspective-distorted text will be misread.
 *   - Large cardinality: a dense page can yield hundreds of boxes. The
 *     pipeline caps generated output via maxRegions to bound work.
 */

import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import { decodeTextRegions, padToStride, type TextRegion } from '../inference/models/paddleocr';
import { ctcDecode, type PaddleRecInput, preprocessPaddleRec } from '../inference/models/paddlerec';
import { loadOcrDictionary } from '../inference/ocrDictionary';
import type { OcrOptions, OcrResult, OcrWord } from './types';

const DET_MODEL_ID = 'paddleocr-det-v4';
const REC_MODEL_ID = 'paddleocr-rec-v4';
const EN_DICT_URL =
  'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.7/ppocr/utils/dict/en_dict.txt';
const DEFAULT_MAX_REGIONS = 200;
const DEFAULT_PROB_THRESHOLD = 0.3;

/** Per-language config. Extend as additional dicts ship. */
const LANGUAGE_CONFIG: Record<string, { url: string; expectedLines: number }> = {
  en: { url: EN_DICT_URL, expectedLines: 64 },
};

export interface PipelineOptions extends OcrOptions {
  /** Max text regions to process (bounding work for dense pages). */
  maxRegions?: number;
  /** Detector probability threshold (0-1). */
  probThreshold?: number;
  /** Skip recognition — return detection boxes only (fast preview). */
  detectOnly?: boolean;
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
  } = options;

  if (signal?.aborted) throw new Error('cancelled');

  // ── 1. Detection ──────────────────────────────────────────────────
  onProgress?.('detecting', 0, 1);
  const paddedW = padToStride(source.width);
  const paddedH = padToStride(source.height);
  const padCanvas = document.createElement('canvas');
  padCanvas.width = paddedW;
  padCanvas.height = paddedH;
  const padCtx = padCanvas.getContext('2d')!;
  // Edge-clamp padding (replicate border) so the detector's stride-32
  // sampling sees content, not black, at the borders.
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
    source.width,
    source.height,
    probThreshold,
  );
  onProgress?.('detecting', 1, 1);

  // Early-out: detection-only mode (fast preview with boxes, no text).
  if (detectOnly || regions.length === 0) {
    const elapsed = performance.now() - start;
    return {
      words: regions.map((r) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        detectionConfidence: r.confidence,
        text: '',
        confidence: 0,
        charConfidences: [],
      })),
      executionProvider: (detResult.outputs.executionProvider as string) ?? 'wasm',
      processingTimeMs: elapsed,
      dictionaryAvailable: false,
    };
  }

  // Cap work for dense pages.
  const capped = regions.slice(0, maxRegions);

  // ── 2. Load dictionary ────────────────────────────────────────────
  const lang = options.language ?? 'en';
  const langConfig = LANGUAGE_CONFIG[lang];
  let dict: readonly string[] = [];
  let dictionaryAvailable = false;
  if (langConfig) {
    try {
      dict = await loadOcrDictionary(langConfig.url, langConfig.expectedLines, signal);
      dictionaryAvailable = true;
    } catch {
      // No dict -> recognition produces garbage; fail visibly.
      throw new Error(`OCR dictionary for language '${lang}' is not available. Download it first.`);
    }
  } else {
    throw new Error(
      `OCR language '${lang}' is not supported. Supported: ${Object.keys(LANGUAGE_CONFIG).join(', ')}`,
    );
  }

  if (signal?.aborted) throw new Error('cancelled');

  // ── 3. Recognition per region ─────────────────────────────────────
  const recPath = await modelPath(REC_MODEL_ID, signal);
  const words: OcrWord[] = [];

  for (let i = 0; i < capped.length; i++) {
    if (signal?.aborted) throw new Error('cancelled');
    const region = capped[i]!;
    onProgress?.('recognizing', i, capped.length);

    const crop = cropRegion(source, region);
    const recInput: PaddleRecInput = { imageData: crop };
    const recOut = await recognizeSingle(recInput, recPath, REC_MODEL_ID, dict, host, signal);

    words.push({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      detectionConfidence: region.confidence,
      text: recOut.text,
      confidence: recOut.confidence,
      charConfidences: recOut.charConfidences,
    });
  }

  if (signal?.aborted) throw new Error('cancelled');
  onProgress?.('done', capped.length, capped.length);

  const elapsed = performance.now() - start;
  return {
    words,
    executionProvider: (detResult.outputs.executionProvider as string) ?? 'wasm',
    processingTimeMs: elapsed,
    dictionaryAvailable,
  };
}

/** Crop a (possibly padded/clamped) region from the source image. */
function cropRegion(source: ImageData, region: TextRegion): ImageData {
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

/** Recognize a single cropped text line. */
async function recognizeSingle(
  input: PaddleRecInput,
  recPath: string,
  recModelId: string,
  dict: readonly string[],
  host: ReturnType<typeof getInferenceWorkerHost>,
  signal?: AbortSignal,
) {
  const pre = preprocessPaddleRec(input.imageData);
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
