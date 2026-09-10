/**
 * SigLIP text tokenizer parity: the TypeScript normalizer + Unigram Viterbi
 * must reproduce the reference transformers `SiglipTokenizer` ids for the
 * committed golden fixture (scripts/semantic-corpus/reference-text-tokens.py).
 * The vocabulary is loaded from the pinned tokenizer.json in the model cache
 * (the same artifact the app downloads, verified by sha256); the test skips
 * when the artifact is absent.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIGLIP_TEXT_MAX_LENGTH } from '../../inference/models/siglip';
import { SiglipTokenizer } from '../../inference/models/siglipText';

interface GoldenFixture {
  runtime: string;
  tokenizerSource: string;
  maxLength: number;
  queries: Record<string, number[]>;
  embeddings?: Record<string, string>;
  embeddingRuntime?: string;
}

const FIXTURE_PATH = resolve(__dirname, '../bench/__fixtures__/reference/siglip-text-tokens.json');
const MODELS_DIR = resolve(
  process.env.VARVE_MODEL_CACHE ?? join(process.env.HOME ?? '/tmp', '.cache/varve/models'),
);

function loadGolden(): GoldenFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as GoldenFixture;
}

describe('siglip text tokenizer parity vs transformers', () => {
  const golden = loadGolden();
  let tokenizerPath: string;
  try {
    tokenizerPath = join(MODELS_DIR, 'siglip-tokenizer.json');
    readFileSync(tokenizerPath);
  } catch {
    describe.skip('tokenizer artifact not present (fetch via scripts/semantic-corpus/fetch-models.sh)', () => {
      it('skipped', () => expect(true).toBe(true));
    });
    return;
  }

  it(`reproduces reference ids for ${Object.keys(golden.queries).length} queries`, () => {
    const json = JSON.parse(readFileSync(tokenizerPath, 'utf-8')) as {
      model: { type: string; unk_id: number; vocab: Array<[string, number]> };
    };
    const tokenizer = new SiglipTokenizer(json);
    const mismatches: string[] = [];
    for (const [query, expected] of Object.entries(golden.queries)) {
      const { inputIds } = tokenizer.encode(query, golden.maxLength);
      const actual = Array.from(inputIds);
      if (
        actual.length !== expected.length ||
        actual.some((id, index) => id !== BigInt(expected[index]!))
      ) {
        mismatches.push(
          `${JSON.stringify(query)}:\n  expected ${expected.slice(0, 24)}\n  actual   ${actual.slice(0, 24)}`,
        );
      }
    }
    expect(mismatches, `divergences:\n${mismatches.join('\n')}`).toEqual([]);
  });

  it('reproduces reference embeddings through the text tower', { timeout: 300_000 }, async () => {
    const json = JSON.parse(readFileSync(tokenizerPath, 'utf-8')) as {
      model: { type: string; unk_id: number; vocab: Array<[string, number]> };
    };
    const golden = loadGolden();
    if (!golden.embeddings || !golden.embeddingRuntime) {
      expect.fail('Golden fixture has no embeddings — regenerate via reference-text-tokens.py');
    }
    const tokenizer = new SiglipTokenizer(json);
    const modelPath = join(MODELS_DIR, 'siglip-base-patch16-224-text.onnx');
    const modelExists = (() => {
      try {
        readFileSync(modelPath);
        return true;
      } catch {
        return false;
      }
    })();
    if (!modelExists) return;
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const ort = require('onnxruntime-node') as {
      InferenceSession: {
        create(
          path: string,
          options: { executionProviders: string[] },
        ): Promise<{
          run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
        }>;
      };
      Tensor: new (type: string, data: BigInt64Array, dims: number[]) => unknown;
    };
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
    const mismatches: string[] = [];
    for (const [query, expectedB64] of Object.entries(golden.embeddings!)) {
      const { inputIds } = tokenizer.encode(query, golden.maxLength);
      const out = await session.run({
        input_ids: new ort.Tensor('int64', inputIds, [1, golden.maxLength]),
      });
      const raw = out.pooler_output?.data;
      if (!raw) {
        expect.fail('Text tower produced no pooler_output tensor');
        continue;
      }
      const bytes = Buffer.from(expectedB64, 'base64');
      const reference = new Float32Array(bytes.byteLength / 4);
      new Uint8Array(reference.buffer).set(bytes);
      expect(raw.length).toBe(reference.length);
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < raw.length; i += 1) {
        dot += raw[i]! * reference[i]!;
        normA += raw[i]! * raw[i]!;
        normB += reference[i]! * reference[i]!;
      }
      const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB));
      if (1 - cos > 1e-4) {
        mismatches.push(`${JSON.stringify(query)}: 1-cos=${(1 - cos).toExponential(3)}`);
      }
    }
    expect(mismatches, `embedding divergences:\n${mismatches.join('\n')}`).toEqual([]);
  });

  it('is deterministic for identical inputs', () => {
    const json = JSON.parse(readFileSync(tokenizerPath, 'utf-8')) as {
      model: { type: string; unk_id: number; vocab: Array<[string, number]> };
    };
    const tokenizer = new SiglipTokenizer(json);
    const a = Array.from(
      tokenizer.encode('orange sunset over mountains', SIGLIP_TEXT_MAX_LENGTH).inputIds,
    );
    const b = Array.from(
      tokenizer.encode('orange sunset over mountains', SIGLIP_TEXT_MAX_LENGTH).inputIds,
    );
    expect(a).toEqual(b);
  });
});
