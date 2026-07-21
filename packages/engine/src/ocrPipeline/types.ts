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
}

export interface OcrOptions {
  /** Language/dictionary to use (currently only 'en' ships). */
  language?: string;
  /** Whether to attempt 180-degree rotation correction (cls model). */
  autoRotate?: boolean;
  signal?: AbortSignal;
  onProgress?: (
    phase: 'detecting' | 'recognizing' | 'done',
    completed: number,
    total: number,
  ) => void;
}

/** Internal: a recognized region still in progress (detect done, rec pending). */
export interface PendingRegion {
  region: TextRegion;
  crop: ImageData;
  recResult: PaddleRecResult | null;
}
