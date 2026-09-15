import { describe, expect, it } from 'vitest';
import {
  basicTokenize,
  bertTokenize,
  buildGroundingDinoInputs,
  decodeGroundingDinoOutput,
  locatePhraseSpans,
  normalizeGroundingQuery,
  parseBertVocab,
  preprocessGroundingDinoImage,
  suppressDuplicateDetections,
  wordPiece,
  type GroundingDetection,
} from './groundingDino';

const VOCAB_TEXT = [
  '[PAD]',
  '[UNK]',
  '[CLS]',
  '[SEP]',
  '[MASK]',
  'a',
  'cat',
  'the',
  'red',
  'mug',
  'person',
  'dog',
  '.',
  '##s',
  'blue',
  'cafe',
  'table',
].join('\n');

const VOCAB = parseBertVocab(VOCAB_TEXT);

function detection(partial: Partial<GroundingDetection>): GroundingDetection {
  return {
    id: 'gd-test',
    phrase: 'cat',
    phraseIndex: null,
    tokenIndices: [1, 2],
    score: 0.9,
    box: { x1: 0, y1: 0, x2: 10, y2: 10 },
    normalizedBox: { x1: 0, y1: 0, x2: 0.25, y2: 0.25 },
    ...partial,
  };
}

describe('bert vocab and tokenization', () => {
  it('parses vocab.txt with line numbers as ids', () => {
    expect(VOCAB.get('[CLS]')).toBe(2);
    expect(VOCAB.get('cat')).toBe(6);
    expect(VOCAB.get('##s')).toBe(13);
  });

  it('lowercases, strips accents, and splits punctuation', () => {
    expect(basicTokenize('A Cat. Café').map((token) => token.text)).toEqual([
      'a',
      'cat',
      '.',
      'cafe',
    ]);
  });

  it('applies WordPiece greedy longest-match with ## continuations', () => {
    expect(wordPiece('cats', VOCAB)).toEqual(['cat', '##s']);
    expect(wordPiece('cat', VOCAB)).toEqual(['cat']);
    expect(wordPiece('zzz', VOCAB)).toBeNull();
  });

  it('adds [CLS]/[SEP] and truncates at the model maximum', () => {
    const result = bertTokenize('the cat', VOCAB);
    expect(result.ids).toEqual([2, 7, 6, 3]);
    expect(result.tokens).toEqual(['[CLS]', 'the', 'cat', '[SEP]']);
    expect(result.truncated).toBe(false);
    const truncated = bertTokenize('the cat the cat the cat the cat', VOCAB, 5);
    expect(truncated.ids.length).toBe(5);
    expect(truncated.truncated).toBe(true);
  });

  it('normalizes queries into lowercase period-separated phrases', () => {
    expect(normalizeGroundingQuery('Red Mug. Blue  Mug.')).toEqual({
      normalized: 'red mug. blue mug.',
      phrases: ['red mug', 'blue mug'],
    });
    expect(normalizeGroundingQuery('   ')).toEqual({ normalized: '', phrases: [] });
  });

  it('locates phrase spans in the concatenated sequence', () => {
    const query = normalizeGroundingQuery('the cat. dog.');
    const tokenization = bertTokenize(query.normalized, VOCAB);
    const spans = locatePhraseSpans(tokenization, query.phrases, VOCAB);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ phraseIndex: 0 });
    expect(spans[1]).toMatchObject({ phraseIndex: 1 });
    // "the cat" occupies tokens 1-2, "dog" token 4 (after the period at 3).
    expect(spans[0]!.start).toBe(1);
    expect(spans[1]!.start).toBe(4);
  });
});

describe('grounding preprocessing and inputs', () => {
  it('stretches to 800x800 with ImageNet normalization and int64 text feeds', () => {
    const data = new Uint8ClampedArray(2 * 4 * 4);
    for (let i = 0; i < 2 * 4; i += 1) {
      data[i * 4] = 255;
      data[i * 4 + 3] = 255;
    }
    const preprocessed = preprocessGroundingDinoImage({ data, width: 4, height: 2 });
    expect(preprocessed.width).toBe(800);
    expect(preprocessed.height).toBe(800);
    const redAt = (1 - 0.485) / 0.229;
    expect(preprocessed.tensor[0]).toBeCloseTo(redAt, 5);
    expect(preprocessed.tensor[800 * 800]).toBeCloseTo((0 - 0.456) / 0.224, 5);

    const tokenization = bertTokenize('cat', VOCAB);
    const inputs = buildGroundingDinoInputs({ data, width: 4, height: 2 }, tokenization);
    expect(inputs.pixel_values?.dims).toEqual([1, 3, 800, 800]);
    expect(inputs.input_ids?.dtype).toBe('int64');
    expect(inputs.input_ids?.dims).toEqual([1, 256]);
    expect((inputs.input_ids!.data as BigInt64Array)[0]).toBe(2n);
    expect((inputs.attention_mask!.data as BigInt64Array)[3]).toBe(0n);
    expect(inputs.pixel_mask?.dims).toEqual([1, 800, 800]);
    expect(inputs.pixel_mask?.dtype).toBe('int64');
    expect((inputs.pixel_mask!.data as BigInt64Array)[0]).toBe(1n);
  });
});

describe('grounding postprocessing', () => {
  const tokenization = bertTokenize('cat', VOCAB);
  const catToken = tokenization.tokens.indexOf('cat');
  const catId = VOCAB.get('cat')!;
  const dims = [1, 900, 256];
  const boxDims = [1, 900, 4];

  it('keeps only boxes above both thresholds and scales them to source pixels', () => {
    const logits = new Float32Array(900 * 256).fill(-20);
    const boxes = new Float32Array(900 * 4);
    // Query 5: "cat" scores high, box center 0.5/0.5 size 0.25x0.5.
    logits[5 * 256 + catToken] = 4;
    boxes[5 * 4] = 0.5;
    boxes[5 * 4 + 1] = 0.5;
    boxes[5 * 4 + 2] = 0.25;
    boxes[5 * 4 + 3] = 0.5;
    const detections = decodeGroundingDinoOutput(
      logits,
      dims,
      boxes,
      boxDims,
      tokenization,
      400,
      200,
    );
    expect(detections).toHaveLength(1);
    expect(detections[0]!.phrase).toBe('cat');
    expect(detections[0]!.score).toBeCloseTo(1 / (1 + Math.exp(-4)), 5);
    expect(detections[0]!.box.x1).toBeCloseTo(0.375 * 400, 3);
    expect(detections[0]!.box.y1).toBeCloseTo(0.25 * 200, 3);
    expect(detections[0]!.box.x2).toBeCloseTo(0.625 * 400, 3);
    expect(detections[0]!.box.y2).toBeCloseTo(0.75 * 200, 3);
  });

  it('uses the text threshold separately and attributes phrase spans', () => {
    const query = normalizeGroundingQuery('cat. dog.');
    const full = bertTokenize(query.normalized, VOCAB);
    const spans = locatePhraseSpans(full, query.phrases, VOCAB);
    const catIndex = full.tokens.indexOf('cat');
    const dogIndex = full.tokens.indexOf('dog');
    const logits = new Float32Array(900 * 256).fill(-20);
    const boxes = new Float32Array(900 * 4);
    boxes[1 * 4 + 2] = 0.1;
    boxes[1 * 4 + 3] = 0.1;
    // Best score at "dog", but "cat" also above the text threshold.
    logits[1 * 256 + dogIndex] = 5;
    logits[1 * 256 + catIndex] = 1;
    const detections = decodeGroundingDinoOutput(logits, dims, boxes, boxDims, full, 100, 100, {
      phraseSpans: spans,
    });
    expect(detections).toHaveLength(1);
    expect(detections[0]!.phrase.trim()).toBe('cat dog');
    // The first matched token is "cat", so the detection attributes to phrase 0.
    expect(detections[0]!.phraseIndex).toBe(0);
    expect(detections[0]!.tokenIndices).toEqual([catIndex, dogIndex]);

    const strictText = decodeGroundingDinoOutput(logits, dims, boxes, boxDims, full, 100, 100, {
      textThreshold: 0.99,
    });
    expect(strictText[0]!.phrase).toBe('dog');
  });

  it('ignores -Infinity padded logits without producing -Infinity scores', () => {
    const logits = new Float32Array(900 * 256).fill(Number.NEGATIVE_INFINITY);
    logits[3 * 256 + catToken] = 2;
    const boxes = new Float32Array(900 * 4);
    const detections = decodeGroundingDinoOutput(
      logits,
      dims,
      boxes,
      boxDims,
      tokenization,
      10,
      10,
    );
    expect(detections).toHaveLength(1);
    expect(Number.isFinite(detections[0]!.score)).toBe(true);
    expect(detections[0]!.tokenIndices).toEqual([catToken]);
    expect(catId).toBe(VOCAB.get('cat'));
  });

  it('rejects malformed output shapes', () => {
    expect(() =>
      decodeGroundingDinoOutput(
        new Float32Array(10),
        [1, 10, 10],
        new Float32Array(10),
        [1, 10, 4],
        tokenization,
        10,
        10,
      ),
    ).toThrow();
  });

  it('deduplicates only same-phrase near-identical boxes', () => {
    const kept = suppressDuplicateDetections([
      detection({ id: 'a', phrase: 'person', score: 0.9, box: { x1: 0, y1: 0, x2: 10, y2: 10 } }),
      detection({
        id: 'b',
        phrase: 'person',
        score: 0.8,
        box: { x1: 0.2, y1: 0.2, x2: 10.2, y2: 10.2 },
      }),
      // Overlapping but different phrase: two objects, keep both.
      detection({ id: 'c', phrase: 'dog', score: 0.7, box: { x1: 0, y1: 0, x2: 10, y2: 10 } }),
      // Same phrase but mostly disjoint: two people, keep both.
      detection({
        id: 'd',
        phrase: 'person',
        score: 0.6,
        box: { x1: 20, y1: 0, x2: 30, y2: 10 },
      }),
    ]);
    expect(kept.map((item) => item.id)).toEqual(['a', 'c', 'd']);
  });
});
