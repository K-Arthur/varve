/**
 * OCR model metadata — maps model IDs to their dictionary contracts.
 *
 * The recognition model outputs class indices; to decode them we need
 * the exact dictionary the model was trained with. This module is the
 * single source of truth for which dictionary each model expects.
 *
 * Research basis: PaddleOCR model documentation, TrOCR paper.
 */
import type { OcrModelConfig } from './types';

/**
 * PP-OCRv4 recognition model metadata.
 * Output: 6625 classes = 6624 chars + CTC blank at index 0.
 * The full dictionary is ppocr_keys_v1.txt (6623 chars + 1 extra
 * for the model's specific training set = 6624).
 */
export const PADDLE_REC_V4_CONFIG: OcrModelConfig = {
  modelId: 'paddleocr-rec-v4',
  numClasses: 6625,
  ctcBlankIndex: 0,
  dictionaryUrl:
    'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.7/ppocr/utils/ppocr_keys_v1.txt',
  expectedDictionarySize: 6624,
  supportedLanguages: ['zh', 'en', 'ja', 'ko'],
  inputHeight: 48,
  normalization: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
};

/**
 * TrOCR base printed model metadata.
 * Uses a hardcoded charset (no external dictionary needed).
 */
export const TROCR_CONFIG: OcrModelConfig = {
  modelId: 'tr-ocr-base-printed',
  numClasses: 95,
  ctcBlankIndex: -1,
  dictionaryUrl: '',
  expectedDictionarySize: 0,
  supportedLanguages: ['en'],
  inputHeight: 384,
  normalization: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
  usesBuiltInCharset: true,
};

/**
 * English-only PP-OCRv4 recognition dict (for English-only models).
 * The en_dict.txt has 64 characters (letters + digits + common symbols).
 * This is NOT compatible with ch_PP-OCRv4_rec.
 * Reserved for future English-specific recognition models.
 */
export const EN_ONLY_REC_CONFIG: OcrModelConfig = {
  modelId: 'paddleocr-rec-v4-en',
  numClasses: 65,
  ctcBlankIndex: 0,
  dictionaryUrl:
    'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.7/ppocr/utils/dict/en_dict.txt',
  expectedDictionarySize: 64,
  supportedLanguages: ['en'],
  inputHeight: 48,
  normalization: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
};

/**
 * Get model config by model ID.
 */
export function getOcrModelConfig(modelId: string): OcrModelConfig | undefined {
  const configs: Record<string, OcrModelConfig> = {
    'paddleocr-rec-v4': PADDLE_REC_V4_CONFIG,
    'tr-ocr-base-printed': TROCR_CONFIG,
    'paddleocr-rec-v4-en': EN_ONLY_REC_CONFIG,
  };
  return configs[modelId];
}

/**
 * Validate that a loaded dictionary matches the model's expected size.
 * Throws on mismatch to prevent silently producing garbage output.
 */
export function validateDictionary(modelId: string, dictionary: readonly string[]): void {
  const config = getOcrModelConfig(modelId);
  if (!config) return;
  if (config.usesBuiltInCharset) return;
  if (config.expectedDictionarySize > 0 && dictionary.length !== config.expectedDictionarySize) {
    throw new Error(
      `OCR dictionary for model '${modelId}' has ${dictionary.length} entries, ` +
        `expected ${config.expectedDictionarySize}. ` +
        `The model and dictionary are incompatible — recognition would produce garbage.`,
    );
  }
}
