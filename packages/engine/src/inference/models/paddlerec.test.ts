import { describe, expect, it } from 'vitest';
import {
  ctcDecode,
  PADDLE_REC_CTC_BLANK,
  PADDLE_REC_INPUT_HEIGHT,
  PADDLE_REC_NUM_CLASSES,
  packRecTensor,
  preprocessPaddleRec,
  validatePaddleRecInput,
} from './paddlerec';

function makeImageData(width: number, height: number, fill = 200): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill;
    data[i * 4 + 1] = Math.min(255, fill + 10);
    data[i * 4 + 2] = Math.min(255, fill + 20);
    data[i * 4 + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
}

describe('ctcDecode', () => {
  // Build a synthetic [T, C] output where each timestep has a known argmax.
  function makeLogits(seq: Array<{ cls: number; prob: number }>, T: number): Float32Array {
    const out = new Float32Array(T * PADDLE_REC_NUM_CLASSES).fill(-10);
    for (let t = 0; t < T; t++) {
      const { cls, prob } = seq[t] ?? { cls: 0, prob: 0 };
      out[t * PADDLE_REC_NUM_CLASSES + cls] = prob;
    }
    return out;
  }

  it('decodes a simple sequence with no repeats or blanks', () => {
    // dict: index 0 -> 'a' (class 1), index 1 -> 'b' (class 2), etc.
    const dict = ['a', 'b', 'c', 'd'];
    const logits = makeLogits(
      [
        { cls: 1, prob: 0.9 }, // a
        { cls: 2, prob: 0.8 }, // b
        { cls: 3, prob: 0.7 }, // c
      ],
      3,
    );
    const result = ctcDecode(logits, 3, dict);
    expect(result.text).toBe('abc');
    expect(result.confidence).toBeCloseTo(0.8, 1);
  });

  it('collapses consecutive duplicates (CTC rule)', () => {
    const dict = ['a', 'b'];
    const logits = makeLogits(
      [
        { cls: 1, prob: 0.9 }, // a
        { cls: 1, prob: 0.85 }, // a (dup -> dropped)
        { cls: 2, prob: 0.7 }, // b
      ],
      3,
    );
    expect(ctcDecode(logits, 3, dict).text).toBe('ab');
  });

  it('drops CTC blank (class 0)', () => {
    const dict = ['a', 'b'];
    const logits = makeLogits(
      [
        { cls: 1, prob: 0.9 }, // a
        { cls: PADDLE_REC_CTC_BLANK, prob: 0.95 }, // blank -> dropped
        { cls: 1, prob: 0.8 }, // a (not dup, preceded by blank)
      ],
      3,
    );
    expect(ctcDecode(logits, 3, dict).text).toBe('aa');
  });

  it('returns empty text for all-blank sequences', () => {
    const dict = ['a'];
    const logits = makeLogits([{ cls: 0, prob: 0.99 }], 3);
    const result = ctcDecode(logits, 3, dict);
    expect(result.text).toBe('');
    expect(result.confidence).toBe(0);
  });

  it('handles out-of-range class index gracefully', () => {
    const dict = ['a']; // only class 1 valid
    const logits = makeLogits([{ cls: 99, prob: 0.9 }], 1);
    // class 99 -> dict[98] = undefined -> empty char appended (no crash).
    expect(() => ctcDecode(logits, 1, dict)).not.toThrow();
  });

  it('computes mean confidence over kept characters only', () => {
    const dict = ['a', 'b'];
    const logits = makeLogits(
      [
        { cls: 1, prob: 0.6 }, // a
        { cls: 0, prob: 0.99 }, // blank
        { cls: 2, prob: 0.8 }, // b
      ],
      3,
    );
    const result = ctcDecode(logits, 3, dict);
    expect(result.text).toBe('ab');
    expect(result.confidence).toBeCloseTo(0.7, 1); // (0.6+0.8)/2
  });
});

describe('preprocessPaddleRec', () => {
  it('resizes to fixed height 48 with preserved aspect ratio', () => {
    const img = makeImageData(96, 48);
    const result = preprocessPaddleRec(img);
    expect(result.height).toBe(PADDLE_REC_INPUT_HEIGHT);
    expect(result.width).toBe(96); // aspect 2:1 -> w = 48*2
  });

  it('clamps width to maxWidth', () => {
    const img = makeImageData(1000, 50); // very wide
    const result = preprocessPaddleRec(img, 100);
    expect(result.width).toBeLessThanOrEqual(100);
  });

  it('normalizes to [-1, 1] range (mean/std=0.5) via pure pack', () => {
    // packRecTensor is the pure path (jsdom's OffscreenCanvas mock returns
    // zero-filled bitmaps, so we test the packing math directly).
    const img = new ImageData(new Uint8ClampedArray(8 * 48 * 4).fill(255), 8, 48);
    const tensor = packRecTensor(img.data, 8, 48);
    // white: (255/255 - 0.5)/0.5 = 1
    expect(tensor[0]).toBeCloseTo(1, 5);
    // black would be -1
  });

  it('black normalizes to -1', () => {
    const data = new Uint8ClampedArray(8 * 48 * 4); // all 0
    const tensor = packRecTensor(data, 8, 48);
    expect(tensor[0]).toBeCloseTo(-1, 5);
  });

  it('produces tensor of correct length (w*h*3)', () => {
    const img = makeImageData(20, 48);
    const result = preprocessPaddleRec(img);
    expect(result.tensor.length).toBe(result.width * result.height * 3);
  });

  it('NCHW layout: first w*h entries are R channel (pure pack)', () => {
    // Solid red: R=100, G=0, B=0 -> R plane constant, G/B planes != R plane.
    const data = new Uint8ClampedArray(8 * 48 * 4);
    for (let i = 0; i < 8 * 48; i++) {
      data[i * 4] = 100;
      data[i * 4 + 3] = 255;
    }
    const tensor = packRecTensor(data, 8, 48);
    const pixelCount = 8 * 48;
    // R plane (indices 0..pixelCount-1) constant:
    expect(tensor[5]).toBeCloseTo(tensor[0]!, 5);
    // G plane (starts at pixelCount) is different from R plane:
    expect(tensor[pixelCount]).not.toBeCloseTo(tensor[0]!, 1);
  });
});

describe('validatePaddleRecInput', () => {
  it('accepts valid input', () => {
    expect(validatePaddleRecInput({ imageData: makeImageData(10, 48) })).toBeNull();
  });
  it('rejects null', () => {
    expect(validatePaddleRecInput(null)).toBeTruthy();
  });
  it('rejects missing imageData', () => {
    expect(validatePaddleRecInput({})).toBeTruthy();
  });
  it('rejects zero dimensions', () => {
    expect(validatePaddleRecInput({ imageData: makeImageData(0, 0) })).toBeTruthy();
  });
});
