/**
 * OCR pipeline types — shared contracts between the orchestrator (pipeline.ts),
 * the UI surfaces, and the native provider.
 */

import type { TextRegion } from '../inference/models/paddleocr';
import type { PaddleRecResult } from '../inference/models/paddlerec';

/** A recognized text region: where it is + what it says + how sure. */
export interface OcrWord {
  /** Axis-aligned bounding box in SOURCE IMAGE coordinates (preprocessed
   *  detection space, see pipeline.ts for the crop/transform mapping). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Detector confidence that this region contains text (0-1). */
  detectionConfidence: number;
  /** Recognized text content. */
  text: string;
  /** Recognition confidence (mean per-char, 0-1). */
  confidence: number;
  /** Per-character confidence scores. */
  charConfidences: number[];
  /** Orientation angle applied before recognition (degrees). */
  orientationCorrected?: number;
}

/** Aggregated result of running OCR on an image. */
export interface OcrResult {
  words: OcrWord[];
  /** Provider that executed the inference. */
  executionProvider: string;
  /** Total processing time in ms. */
  processingTimeMs: number;
  /** Whether a character dictionary was available for decoding. */
  dictionaryAvailable: boolean;
  /** Detected orientation of the source image (degrees). */
  detectedOrientation?: number;
  /** Orientation correction confidence (0-1). */
  orientationConfidence?: number;
  /** Which recognition model was used. */
  recognitionModelId?: string;
  /** Whether orientation was corrected before recognition. */
  orientationCorrected?: boolean;
}

export interface OcrOptions {
  /** Language/dictionary to use (currently only 'en' ships). */
  language?: string;
  /** Whether to attempt orientation detection and correction. */
  autoRotate?: boolean;
  /** Which recognition model to use. Defaults to paddleocr-rec-v4. */
  recognitionModelId?: string;
  signal?: AbortSignal;
  onProgress?: (
    phase: 'detecting' | 'recognizing' | 'done' | 'orienting',
    completed: number,
    total: number,
  ) => void;
}

/**
 * OCR model configuration — single source of truth for dictionary contracts.
 */
export interface OcrModelConfig {
  modelId: string;
  /** Total output classes including CTC blank. */
  numClasses: number;
  /** Index of the CTC blank token (-1 if no blank). */
  ctcBlankIndex: number;
  /** URL to download the character dictionary. */
  dictionaryUrl: string;
  /** Expected number of dictionary entries (0 = no check). */
  expectedDictionarySize: number;
  /** Languages this model supports. */
  supportedLanguages: string[];
  /** Model input height in pixels. */
  inputHeight: number;
  /** Pixel normalization parameters. */
  normalization: { mean: [number, number, number]; std: [number, number, number] };
  /** True if the charset is built into the code (no external dict needed). */
  usesBuiltInCharset?: boolean;
}

/** Internal: a recognized region still in progress (detect done, rec pending). */
export interface PendingRegion {
  region: TextRegion;
  crop: ImageData;
  recResult: PaddleRecResult | null;
}

/** Orientation detection result. */
export interface OrientationResult {
  /** Detected orientation in degrees (0, 90, 180, 270). */
  angle: number;
  /** Confidence of the detection (0-1). */
  confidence: number;
}
