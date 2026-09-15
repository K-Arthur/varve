import { getModelLoader, runOcrPipeline } from '@varve/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  averageOcrConfidence,
  FONT_OCR_DETECTION_MODEL_ID,
  FONT_OCR_RECOGNITION_MODEL_ID,
  hasLocalFontOcr,
  recognizeFontTextLocally,
  textFromOcrResult,
} from './fontOcr';

vi.mock('@varve/engine', () => ({
  getModelLoader: vi.fn(),
  runOcrPipeline: vi.fn(),
}));

const result = {
  words: [
    { text: '  Hello ', confidence: 0.8 },
    { text: '', confidence: 0 },
    { text: 'world', confidence: 0.6 },
  ],
  executionProvider: 'wasm',
  processingTimeMs: 10,
  dictionaryAvailable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('font OCR adapter', () => {
  it('checks both local model assets without downloading them', async () => {
    const isModelAvailable = vi.fn().mockResolvedValue(true);
    vi.mocked(getModelLoader).mockReturnValue({ isModelAvailable } as never);
    const signal = new AbortController().signal;

    await expect(hasLocalFontOcr(signal)).resolves.toBe(true);
    expect(isModelAvailable).toHaveBeenCalledWith(FONT_OCR_DETECTION_MODEL_ID, signal);
    expect(isModelAvailable).toHaveBeenCalledWith(FONT_OCR_RECOGNITION_MODEL_ID, signal);
  });

  it('reports unavailable when either model is missing', async () => {
    const isModelAvailable = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(getModelLoader).mockReturnValue({ isModelAvailable } as never);

    await expect(hasLocalFontOcr()).resolves.toBe(false);
  });

  it('keeps OCR text editable and computes a truthful average confidence', () => {
    expect(textFromOcrResult(result as never)).toBe('Hello world');
    expect(averageOcrConfidence(result as never)).toBeCloseTo(0.7);
  });

  it('passes cancellation and progress through to the OCR pipeline', async () => {
    vi.mocked(runOcrPipeline).mockImplementation(async (_image, options) => {
      options?.onProgress?.('recognizing', 1, 2);
      return result as never;
    });
    const progress = vi.fn();
    const signal = new AbortController().signal;
    const image = new ImageData(4, 4);

    await expect(recognizeFontTextLocally(image, signal, progress)).resolves.toBe(result);
    expect(runOcrPipeline).toHaveBeenCalledWith(
      image,
      expect.objectContaining({
        signal,
        autoRotate: true,
        maxRegions: 8,
        recognitionModelId: FONT_OCR_RECOGNITION_MODEL_ID,
      }),
    );
    expect(progress).toHaveBeenCalledWith({ phase: 'recognizing', completed: 1, total: 2 });
  });
});
