import type { OcrResult } from '@varve/engine';
import { getModelLoader, runOcrPipeline } from '@varve/engine';

/**
 * Font identification may use OCR only when its model assets are already
 * present. Checking availability is deliberately separate from downloading:
 * opening the inspector must never start a network request.
 */
export const FONT_OCR_DETECTION_MODEL_ID = 'paddleocr-det-v4';
export const FONT_OCR_RECOGNITION_MODEL_ID = 'tr-ocr-base-printed';

export interface FontOcrProgress {
  phase: 'orienting' | 'detecting' | 'recognizing' | 'done';
  completed: number;
  total: number;
}

export async function hasLocalFontOcr(signal?: AbortSignal): Promise<boolean> {
  const loader = getModelLoader(signal);
  const [detector, recognizer] = await Promise.all([
    loader.isModelAvailable(FONT_OCR_DETECTION_MODEL_ID, signal),
    loader.isModelAvailable(FONT_OCR_RECOGNITION_MODEL_ID, signal),
  ]);
  return detector && recognizer;
}

export async function recognizeFontTextLocally(
  imageData: ImageData,
  signal: AbortSignal,
  onProgress?: (progress: FontOcrProgress) => void,
): Promise<OcrResult> {
  return runOcrPipeline(imageData, {
    signal,
    autoRotate: true,
    maxRegions: 8,
    recognitionModelId: FONT_OCR_RECOGNITION_MODEL_ID,
    onProgress: (phase, completed, total) => onProgress?.({ phase, completed, total }),
  });
}

export function textFromOcrResult(result: OcrResult): string {
  return result.words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function averageOcrConfidence(result: OcrResult): number | undefined {
  const words = result.words.filter((word) => word.text.trim().length > 0);
  if (words.length === 0) return undefined;
  return words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
}
