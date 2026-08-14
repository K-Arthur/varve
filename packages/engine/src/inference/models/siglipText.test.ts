import { describe, expect, it } from 'vitest';
import { SIGLIP_TEXT_MAX_LENGTH } from './siglip';
import { SiglipTokenizer } from './siglipText';

function tokenizer(vocab: Array<[string, number]>) {
  return new SiglipTokenizer({ model: { type: 'Unigram', unk_id: 2, vocab } });
}

describe('SigLIP text tokenizer', () => {
  it('uses the SentencePiece prefix marker and appends EOS/padding', () => {
    const result = tokenizer([
      ['<pad>', 0],
      ['</s>', 0],
      ['<unk>', 0],
      ['▁orange', -1],
      ['▁sunset', -1],
    ]).encode('orange sunset', 8);

    expect(result.tokens).toEqual(['▁orange', '▁sunset']);
    expect(Array.from(result.inputIds)).toEqual([3n, 4n, 1n, 1n, 1n, 1n, 1n, 1n]);
  });

  it('chooses the highest-scoring Unigram path', () => {
    const result = tokenizer([
      ['<pad>', 0],
      ['</s>', 0],
      ['<unk>', 0],
      ['▁', -8],
      ['a', -8],
      ['▁a', -1],
    ]).encode('a', SIGLIP_TEXT_MAX_LENGTH);

    expect(result.tokens).toEqual(['▁a']);
  });

  it('falls back to byte or unknown tokens instead of returning an empty query', () => {
    const result = tokenizer([
      ['<pad>', 0],
      ['</s>', 0],
      ['<unk>', 0],
      ['<0xC3>', 0],
      ['<0xA9>', 0],
    ]).encode('é', 8);

    // é is outside the vocabulary: the Metaspace ▁ marker (not in this
    // mini-vocab) falls back to <unk>, then é emits one <0xXX> piece per
    // UTF-8 byte (C3 A9), then EOS/padding.
    expect(result.tokens).toEqual(['▁', 'é']);
    expect(Array.from(result.inputIds)).toEqual([2n, 3n, 4n, 1n, 1n, 1n, 1n, 1n]);
  });

  it('is deterministic and pads to the reference max length', () => {
    const vocab: Array<[string, number]> = [
      ['<pad>', 0],
      ['</s>', 0],
      ['<unk>', 0],
      ['▁orange', -1],
      ['▁sunset', -1],
    ];
    const a = tokenizer(vocab).encode('orange sunset', 64);
    const b = tokenizer(vocab).encode('orange sunset', 64);
    expect(a.inputIds).toEqual(b.inputIds);
    expect(a.inputIds.length).toBe(64);
  });
});
