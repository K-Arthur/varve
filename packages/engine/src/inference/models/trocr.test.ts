import { describe, expect, it } from 'vitest';
import { postprocessTrOcr, preprocessTrOcr, TROCR_INPUT_SIZE, validateTrOcrInput } from './trocr';

const CHARSET =
  ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?;:\'"-()[]{}@#$%^&*_+=/\\|~`<>';

describe('preprocessTrOcr', () => {
  it('returns tensor of correct shape', () => {
    const imageData = new ImageData(100, 50);
    const result = preprocessTrOcr(imageData);
    expect(result.tensor.length).toBe(1 * 3 * TROCR_INPUT_SIZE * TROCR_INPUT_SIZE);
    expect(result.originalWidth).toBe(100);
    expect(result.originalHeight).toBe(50);
  });

  it('preserves original dimensions', () => {
    const imageData = new ImageData(640, 480);
    const result = preprocessTrOcr(imageData);
    expect(result.originalWidth).toBe(640);
    expect(result.originalHeight).toBe(480);
  });

  it('handles very small images', () => {
    const imageData = new ImageData(15, 15);
    const result = preprocessTrOcr(imageData);
    expect(result.tensor.length).toBe(3 * TROCR_INPUT_SIZE * TROCR_INPUT_SIZE);
  });
});

describe('postprocessTrOcr', () => {
  const CHARSET_LEN = 95;

  it('decodes a simple word from logits', () => {
    const seqLen = 10;
    const logits = new Float32Array(seqLen * CHARSET_LEN);
    const word = 'hello';
    for (let i = 0; i < word.length; i++) {
      const ch = word[i]!;
      const idx = CHARSET.indexOf(ch);
      if (idx >= 0) {
        logits[i * CHARSET_LEN + idx] = 10;
      }
    }
    // Add high EOS logit at end (EOS = last character in charset)
    logits[word.length * CHARSET_LEN + CHARSET_LEN - 1] = 10;

    const result = postprocessTrOcr(logits, seqLen);
    expect(result.text.toLowerCase()).toBe('hello');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.charConfidences.length).toBeGreaterThan(0);
  });

  it('handles empty sequence', () => {
    const logits = new Float32Array(1 * CHARSET_LEN);
    logits[CHARSET_LEN - 1] = 10;
    const result = postprocessTrOcr(logits, 1);
    expect(result.text).toBe('');
    expect(result.confidence).toBe(0);
  });

  it('returns confidence scores between 0 and 1', () => {
    const seqLen = 5;
    const logits = new Float32Array(seqLen * CHARSET_LEN);
    logits[0 * CHARSET_LEN + 1] = 5;
    logits[1 * CHARSET_LEN + 2] = 3;

    const result = postprocessTrOcr(logits, seqLen);
    for (const conf of result.charConfidences) {
      expect(conf).toBeGreaterThanOrEqual(0);
      expect(conf).toBeLessThanOrEqual(1);
    }
  });
});

describe('validateTrOcrInput', () => {
  it('rejects null image data', () => {
    const err = validateTrOcrInput({ imageData: null as unknown as ImageData });
    expect(err).not.toBeNull();
  });

  it('rejects images smaller than 10x10', () => {
    const err = validateTrOcrInput({ imageData: new ImageData(5, 5) });
    expect(err).toContain('small');
  });

  it('accepts valid image sizes', () => {
    const err = validateTrOcrInput({ imageData: new ImageData(100, 50) });
    expect(err).toBeNull();
  });
});
