/**
 * SigLIP text-side tokenizer and input contract.
 *
 * Reproduces the reference SigLIP tokenization pipeline (transformers
 * `SiglipTokenizer` over google/siglip-base-patch16-224) so text queries
 * produce embeddings in the same space as the image encoder:
 *
 *   lowercase
 *   → remove punctuation [!",\#$%&'()*+,-.:;=?@[\]^_`{|}~]
 *   → collapse whitespace runs to one space, strip ends
 *   → apply the nmt_nfkc precompiled charsmap (SIGLIP_T5_CHARMAP)
 *   → collapse double spaces the charsmap may have produced
 *   → Metaspace: prefix ▁ and turn spaces into ▁
 *   → SentencePiece Unigram Viterbi over the pinned vocabulary,
 *     with per-byte fallback pieces for characters outside the vocab
 *   → append </s> (id 1), pad to SIGLIP_TEXT_MAX_LENGTH with </s>
 *
 * The vocabulary and charmap are loaded from the pinned tokenizer.json
 * (google/siglip-base-patch16-224, sha256 pinned in the model manifest as
 * the `siglip-tokenizer` entry). The ONNX graph remains a separately
 * verified model artifact.
 */

import { SIGLIP_TEXT_MAX_LENGTH } from './siglip';
import { SIGLIP_T5_CHARMAP } from './siglipT5Charmap';

export const SIGLIP_TOKENIZER_MODEL_ID = 'siglip-tokenizer';
export const SIGLIP_TOKENIZER_URL =
  'https://huggingface.co/google/siglip-base-patch16-224/resolve/main/tokenizer.json';
/** sha256 of the pinned tokenizer.json (matches the manifest entry). */
export const SIGLIP_TOKENIZER_SHA256 =
  'c6e405cb7c670d56636a9402c81023a55bc6c3c53d89cf02b92f5c5005bfe920';
export const SIGLIP_TOKENIZER_LOCAL_URL = '/models/siglip-tokenizer.json';
export const SIGLIP_TOKENIZER_CACHE = 'varve-siglip-tokenizer-v2';
/** Regex mirror of the reference Replace normalizer step. */
const PUNCTUATION_PATTERN = /[!"\\#$%&'()*+,\-.:;=?@[\]^_`{|}~]/g;
/** Metaspace replacement marker (SentencePiece whitespace escape). */
const METASPACE = '▁';

interface TokenizerJson {
  model?: {
    type?: string;
    unk_id?: number;
    vocab?: Array<[string, number]>;
  };
}

interface TokenPiece {
  chars: string[];
  id: number;
  score: number;
  /** Additional ids emitted for byte-fallback characters (one per byte). */
  extraIds?: number[];
}

export interface SiglipTokenizedText {
  inputIds: BigInt64Array;
  tokens: string[];
}

function isTokenizerJson(value: unknown): value is TokenizerJson {
  const model = (value as TokenizerJson | null)?.model;
  return (
    model?.type === 'Unigram' &&
    Array.isArray(model.vocab) &&
    model.vocab.length > 0 &&
    model.vocab.every(
      (entry) => Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(entry[1]),
    )
  );
}

async function readCachedTokenizer(): Promise<TokenizerJson | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(SIGLIP_TOKENIZER_CACHE);
    const response = await cache.match(SIGLIP_TOKENIZER_LOCAL_URL);
    if (!response) return null;
    const json: unknown = await response.json();
    return isTokenizerJson(json) ? json : null;
  } catch {
    return null;
  }
}

/** Load the tokenizer from the local cache, bundled path, or pinned upstream. */
export async function loadSiglipTokenizer(signal?: AbortSignal): Promise<SiglipTokenizer> {
  const cached = await readCachedTokenizer();
  if (cached) return new SiglipTokenizer(cached);
  const json =
    (await fetchTokenizerJson(SIGLIP_TOKENIZER_LOCAL_URL, signal)) ??
    (await fetchTokenizerJson(SIGLIP_TOKENIZER_URL, signal));
  if (!json) throw new Error('SigLIP tokenizer is unavailable while offline');
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(SIGLIP_TOKENIZER_CACHE);
      await cache.put(SIGLIP_TOKENIZER_LOCAL_URL, new Response(JSON.stringify(json)));
    } catch {
      // Cache API is optional in Tauri and some test environments.
    }
  }
  return new SiglipTokenizer(json);
}

async function fetchTokenizerJson(
  url: string,
  signal?: AbortSignal,
): Promise<TokenizerJson | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    if (!isTokenizerJson(json)) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Apply the reference normalizer sequence to a raw query:
 * lowercase → punctuation removal → whitespace collapse → charsmap →
 * double-space collapse. Result is the string the Metaspace pre-tokenizer
 * would see.
 */
export function normalizeSiglipText(text: string): string {
  const lower = text.toLowerCase().replace(PUNCTUATION_PATTERN, '');
  let mapped = '';
  for (const ch of lower.replace(/\s+/g, ' ').trim()) {
    mapped += SIGLIP_T5_CHARMAP.get(ch) ?? ch;
  }
  return mapped.replace(/ {2,}/g, ' ');
}

/** SentencePiece Unigram tokenizer sufficient for SigLIP's single-text input. */
export class SiglipTokenizer {
  private readonly piecesByFirst = new Map<string, TokenPiece[]>();
  private readonly byteIds = new Map<number, number>();
  private readonly unkId: number;

  constructor(json: TokenizerJson) {
    const model = json.model;
    if (!model?.vocab) throw new Error('Invalid SigLIP tokenizer vocabulary');
    this.unkId = model.unk_id ?? 2;
    model.vocab.forEach(([token, score], id) => {
      const byteMatch = /^<0x([0-9A-F]{2})>$/.exec(token);
      if (byteMatch) {
        this.byteIds.set(Number.parseInt(byteMatch[1]!, 16), id);
        return;
      }
      if (token.startsWith('<')) return;
      const chars = Array.from(token);
      if (chars.length === 0) return;
      const first = chars[0]!;
      const list = this.piecesByFirst.get(first) ?? [];
      list.push({ chars, id, score });
      this.piecesByFirst.set(first, list);
    });
    for (const list of this.piecesByFirst.values()) {
      list.sort((a, b) => b.chars.length - a.chars.length || b.score - a.score);
    }
  }

  encode(text: string, maxLength = SIGLIP_TEXT_MAX_LENGTH): SiglipTokenizedText {
    if (!Number.isInteger(maxLength) || maxLength < 2) {
      throw new Error('SigLIP token sequence must allow an EOS token');
    }
    const normalized = normalizeSiglipText(text);
    if (normalized.length === 0) {
      // The reference tokenizer emits no tokens for an empty query: the
      // entire sequence is </s> padding.
      const ids = new BigInt64Array(maxLength);
      ids.fill(1n);
      return { inputIds: ids, tokens: [] };
    }
    const marked = `${METASPACE}${normalized.replaceAll(' ', METASPACE)}`;
    const chars = Array.from(marked);
    const bestScore = new Array<number>(chars.length + 1).fill(Number.NEGATIVE_INFINITY);
    const bestPath: Array<{ previous: number; piece: TokenPiece } | undefined> = new Array(
      chars.length + 1,
    );
    bestScore[0] = 0;
    for (let offset = 0; offset < chars.length; offset += 1) {
      if (!Number.isFinite(bestScore[offset]!)) continue;
      const pieces = this.piecesByFirst.get(chars[offset]!) ?? [];
      let matched = false;
      for (const piece of pieces) {
        const end = offset + piece.chars.length;
        if (end > chars.length) continue;
        let matches = true;
        for (let index = 0; index < piece.chars.length; index += 1) {
          if (chars[offset + index] !== piece.chars[index]) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
        matched = true;
        const score = bestScore[offset]! + piece.score;
        if (score > bestScore[end]!) {
          bestScore[end] = score;
          bestPath[end] = { previous: offset, piece };
        }
      }
      if (!matched && !Number.isFinite(bestScore[offset + 1]!)) {
        // Byte fallback: a character outside the vocabulary decomposes into
        // its UTF-8 bytes, one <0xXX> piece per byte (score 0, matching the
        // reference tokenizer's byte_fallback behavior). The fallback is
        // atomic: it consumes exactly this character in one Viterbi step so
        // later pieces cannot absorb parts of the byte sequence.
        const bytes = new TextEncoder().encode(chars[offset]!);
        const byteIds: number[] = [];
        for (const byte of bytes) {
          const id = this.byteIds.get(byte);
          if (id === undefined) {
            byteIds.length = 0;
            break;
          }
          byteIds.push(id);
        }
        if (byteIds.length > 0) {
          const piece: TokenPiece = {
            chars: [chars[offset]!],
            id: byteIds[0]!,
            extraIds: byteIds.slice(1),
            score: 0,
          };
          bestScore[offset + 1] = bestScore[offset]! + piece.score;
          bestPath[offset + 1] = { previous: offset, piece };
          continue;
        }
        bestScore[offset + 1] = bestScore[offset]! + -100;
        bestPath[offset + 1] = {
          previous: offset,
          piece: { chars: [chars[offset]!], id: this.unkId, score: -100 },
        };
      }
    }

    const pieces: TokenPiece[] = [];
    for (let cursor = chars.length; cursor > 0; ) {
      const step = bestPath[cursor];
      if (!step) {
        pieces.unshift({ chars: [chars[cursor - 1]!], id: this.unkId, score: -100 });
        cursor -= 1;
      } else {
        pieces.unshift(step.piece);
        cursor = step.previous;
      }
    }
    const selected = pieces.slice(0, maxLength - 1);
    const ids = new BigInt64Array(maxLength);
    ids.fill(1n); // SigLIP uses </s> as both EOS and padding.
    let cursor = 0;
    for (const piece of selected) {
      ids[cursor] = BigInt(piece.id);
      cursor += 1;
      if (piece.extraIds) {
        for (const id of piece.extraIds) {
          ids[cursor] = BigInt(id);
          cursor += 1;
        }
      }
      if (cursor >= maxLength - 1) break;
    }
    if (cursor >= maxLength) cursor = maxLength - 1;
    ids[cursor] = 1n;
    return { inputIds: ids, tokens: selected.map((piece) => piece.chars.join('')) };
  }
}
