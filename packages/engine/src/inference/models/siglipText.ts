/**
 * SigLIP text-side tokenizer and input contract.
 *
 * The upstream tokenizer is SentencePiece Unigram. We load its small JSON
 * vocabulary only after the user explicitly enables text search; the ONNX
 * graph remains a separately verified model artifact. Keeping tokenization
 * here makes the worker contract testable without coupling it to a UI.
 */

import { SIGLIP_TEXT_MAX_LENGTH } from './siglip';

export const SIGLIP_TOKENIZER_URL =
  'https://huggingface.co/Xenova/siglip-base-patch16-224/resolve/main/tokenizer.json';
export const SIGLIP_TOKENIZER_LOCAL_URL = '/models/siglip-tokenizer.json';
export const SIGLIP_TOKENIZER_CACHE = 'varve-siglip-tokenizer-v1';

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

async function fetchTokenizer(url: string, signal?: AbortSignal): Promise<TokenizerJson | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    if (!isTokenizerJson(json)) return null;
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(SIGLIP_TOKENIZER_CACHE);
        await cache.put(SIGLIP_TOKENIZER_LOCAL_URL, new Response(JSON.stringify(json)));
      } catch {
        // Cache API is optional in Tauri and some test environments.
      }
    }
    return json;
  } catch {
    return null;
  }
}

/** Load the tokenizer from the local cache, bundled path, or pinned upstream. */
export async function loadSiglipTokenizer(signal?: AbortSignal): Promise<SiglipTokenizer> {
  const cached = await readCachedTokenizer();
  const json = cached ?? (await fetchTokenizer(SIGLIP_TOKENIZER_LOCAL_URL, signal));
  const resolved = json ?? (await fetchTokenizer(SIGLIP_TOKENIZER_URL, signal));
  if (!resolved) throw new Error('SigLIP tokenizer is unavailable while offline');
  return new SiglipTokenizer(resolved);
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
    const normalized = `▁${text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replaceAll(' ', '▁')}`;
    const chars = Array.from(normalized);
    const bestScore = new Array<number>(chars.length + 1).fill(Number.NEGATIVE_INFINITY);
    const bestPath: Array<{ previous: number; piece: TokenPiece } | undefined> = new Array(
      chars.length + 1,
    );
    bestScore[0] = 0;
    for (let offset = 0; offset < chars.length; offset += 1) {
      if (!Number.isFinite(bestScore[offset])) continue;
      const pieces = this.piecesByFirst.get(chars[offset]!) ?? [];
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
        const score = bestScore[offset]! + piece.score;
        if (score > bestScore[end]!) {
          bestScore[end] = score;
          bestPath[end] = { previous: offset, piece };
        }
      }
      if (!Number.isFinite(bestScore[offset + 1]!)) {
        const bytes = new TextEncoder().encode(chars[offset]!);
        const byteId = bytes.length === 1 ? this.byteIds.get(bytes[0]!) : undefined;
        const piece: TokenPiece = {
          chars: [chars[offset]!],
          id: byteId ?? this.unkId,
          score: -100,
        };
        bestScore[offset + 1] = bestScore[offset]! + piece.score;
        bestPath[offset + 1] = { previous: offset, piece };
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
    ids[0] = BigInt(selected.length > 0 ? selected[0]!.id : this.unkId);
    for (let index = 1; index < selected.length; index += 1) {
      ids[index] = BigInt(selected[index]!.id);
    }
    ids[Math.min(selected.length, maxLength - 1)] = 1n;
    return { inputIds: ids, tokens: selected.map((piece) => piece.chars.join('')) };
  }
}
