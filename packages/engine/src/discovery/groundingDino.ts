/**
 * Grounding DINO Tiny — local text-conditioned object discovery.
 *
 * Upstream contract (verified 2026-09-15 against
 * `onnx-community/grounding-dino-tiny-ONNX` @ ff690b0a8050566c290287545bd059350f3e9096,
 * which mirrors IDEA-Research/grounding-dino-tiny and is Apache-2.0):
 *
 *   Graph inputs: `pixel_values` float32 [1,3,800,800],
 *   `input_ids` int64 [1,S], `token_type_ids` int64 [1,S],
 *   `attention_mask` int64 [1,S], `pixel_mask` int64 [1,800,800].
 *   Graph outputs: `logits` float32 [1,900,256], `pred_boxes` float32 [1,900,4].
 *
 *   Preprocessing (GroundingDinoImageProcessor): rescale 1/255, ImageNet
 *   normalization, resize to exactly 800x800 (a stretch, no padding because
 *   `pad_size` is inferred as the resize size), and an all-ones `pixel_mask`.
 *
 *   Postprocessing (`GroundingDinoProcessor.post_process_grounded_object_detection`):
 *   sigmoid the logits, take the per-query maximum as the score, convert boxes
 *   from normalized center/size to corner format, scale by the original size,
 *   and extract the phrase tokens whose probability exceeds `text_threshold`.
 *
 * This module implements that contract without a Python/transformers.js
 * dependency. The text side owns its own BERT WordPiece tokenizer because the
 * ONNX graph expects pre-tokenized ids; nothing here is a fixed-class detector
 * or a CLIP similarity lookup.
 */

export const GROUNDING_DINO_MODEL_ID = 'grounding-dino-tiny';
export const GROUNDING_DINO_TOKENIZER_ID = 'grounding-dino-tokenizer';
export const GROUNDING_DINO_INPUT_SIZE = 800;
export const GROUNDING_DINO_MAX_TEXT_LEN = 256;
export const GROUNDING_DINO_NUM_QUERIES = 900;
export const GROUNDING_DINO_NUM_TEXT_TOKENS = 256;
export const GROUNDING_DINO_MAX_DETECTIONS = 64;
export const GROUNDING_DINO_PREPROCESSING_VERSION = 'grounding-dino-tiny-800-stretch-imagenet-v1';

export const GROUNDING_DINO_SPECIAL_TOKENS = {
  pad: 0,
  cls: 101,
  sep: 102,
  unk: 100,
} as const;

/**
 * Parse a BERT `vocab.txt` into a token → id map. The file is one token per
 * line, so line number is the id.
 */
export function parseBertVocab(vocabText: string): Map<string, number> {
  const vocab = new Map<string, number>();
  const lines = vocabText.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const token = lines[index];
    if (token === undefined) break;
    const trimmed = token.endsWith('\r') ? token.slice(0, -1) : token;
    if (trimmed.length === 0 && index === lines.length - 1) break;
    vocab.set(trimmed, index);
  }
  return vocab;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: BERT control-character cleanup
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const PUNCTUATION_PATTERN =
  /[!"/#$%&'()*+,\-.:;<=>?@[\\\]^_`{|}~\u2018\u2019\u201c\u201d\u00ab\u00bb]/;
const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

function isPunctuation(char: string): boolean {
  if (PUNCTUATION_PATTERN.test(char)) return true;
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

/** Strip combining marks after NFD decomposition (BERT accent stripping). */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

type BasicToken = { text: string; start: number; end: number };

/**
 * BERT BasicTokenizer (uncased): clean control characters, lowercase, strip
 * accents, split on whitespace/punctuation, and split CJK characters
 * individually. Character offsets refer to the cleaned string so callers can
 * build phrase spans.
 */
export function basicTokenize(text: string): BasicToken[] {
  const cleaned = stripAccents(text.replace(CONTROL_CHAR_PATTERN, ' ').toLowerCase());
  const tokens: BasicToken[] = [];
  let current = '';
  let start = 0;
  const flush = (end: number) => {
    if (current.length > 0) {
      tokens.push({ text: current, start, end });
      current = '';
    }
    void end;
  };
  const chars = Array.from(cleaned);
  let offset = 0;
  for (const char of chars) {
    const charStart = offset;
    const charEnd = offset + char.length;
    offset = charEnd;
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      flush(charStart);
      continue;
    }
    if (CJK_PATTERN.test(char)) {
      flush(charStart);
      tokens.push({ text: char, start: charStart, end: charEnd });
      continue;
    }
    if (isPunctuation(char)) {
      flush(charStart);
      tokens.push({ text: char, start: charStart, end: charEnd });
      continue;
    }
    if (current.length === 0) start = charStart;
    current += char;
  }
  flush(cleaned.length);
  return tokens;
}

/** WordPiece greedy longest-match; returns subword strings (with `##` marks). */
export function wordPiece(token: string, vocab: Map<string, number>): string[] | null {
  if (token.length > 100) return null;
  const pieces: string[] = [];
  let start = 0;
  while (start < token.length) {
    let end = token.length;
    let matched: string | null = null;
    while (start < end) {
      const candidate = `${start > 0 ? '##' : ''}${token.slice(start, end)}`;
      if (vocab.has(candidate)) {
        matched = candidate;
        break;
      }
      end -= 1;
    }
    if (matched === null) return null;
    pieces.push(matched);
    start = end;
  }
  return pieces;
}

export interface BertTokenization {
  /** Token ids including [CLS]/[SEP]. */
  ids: number[];
  /** Token strings aligned with ids. */
  tokens: string[];
  /** Character span in the cleaned text for each non-special token. */
  spans: Array<{ start: number; end: number }>;
  /** True when the input exceeded the model's maximum and was truncated. */
  truncated: boolean;
}

/**
 * Full BERT uncased tokenization with [CLS]/[SEP] and a truncation cap.
 *
 * `maxLength` includes the two special tokens, matching the tokenizer's
 * `max_length` semantics. The caller pads to the model width.
 */
export function bertTokenize(
  text: string,
  vocab: Map<string, number>,
  maxLength = GROUNDING_DINO_MAX_TEXT_LEN,
): BertTokenization {
  const clsId = vocab.get('[CLS]') ?? GROUNDING_DINO_SPECIAL_TOKENS.cls;
  const sepId = vocab.get('[SEP]') ?? GROUNDING_DINO_SPECIAL_TOKENS.sep;
  const unkId = vocab.get('[UNK]') ?? GROUNDING_DINO_SPECIAL_TOKENS.unk;
  const ids: number[] = [clsId];
  const tokens: string[] = ['[CLS]'];
  const spans: Array<{ start: number; end: number }> = [{ start: 0, end: 0 }];
  const unknowns = new Set<number>([unkId]);
  let truncated = false;
  const capacity = Math.max(1, maxLength - 2);
  for (const basic of basicTokenize(text)) {
    const pieces = wordPiece(basic.text, vocab);
    const list = pieces ?? ['[UNK]'];
    for (const piece of list) {
      if (ids.length - 1 >= capacity) {
        truncated = true;
        break;
      }
      const id = vocab.get(piece);
      if (id === undefined) {
        ids.push(unkId);
        tokens.push('[UNK]');
      } else {
        ids.push(id);
        tokens.push(piece);
      }
      spans.push({ start: basic.start, end: basic.end });
      if (unknowns.has(ids[ids.length - 1]!)) {
        // Nothing further: unknown ids are still real tokens for the model.
      }
    }
    if (truncated) break;
  }
  ids.push(sepId);
  tokens.push('[SEP]');
  spans.push({ start: text.length, end: text.length });
  return { ids, tokens, spans, truncated };
}

/** Normalize a user query into lowercased, period-separated phrases. */
export function normalizeGroundingQuery(query: string): {
  normalized: string;
  phrases: string[];
} {
  const phrases = query
    .split(/[.\n;]/)
    .map((phrase) =>
      stripAccents(phrase.replace(CONTROL_CHAR_PATTERN, ' ').toLowerCase())
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((phrase) => phrase.length > 0);
  return { normalized: phrases.join('. ') + (phrases.length > 0 ? '.' : ''), phrases };
}

export interface GroundingDinoPreprocessedImage {
  tensor: Float32Array;
  width: number;
  height: number;
}

/**
 * Rescale + ImageNet-normalize + stretch to 800x800, packed NCHW.
 *
 * The reference processor resizes the image to exactly 800x800 (no aspect
 * preservation; `pad_size` is inferred from the resize size, so padding is a
 * no-op). Normalized detections therefore map linearly back to the source.
 */
export function preprocessGroundingDinoImage(imageData: {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): GroundingDinoPreprocessedImage {
  if (
    imageData.width <= 0 ||
    imageData.height <= 0 ||
    imageData.data.length < imageData.width * imageData.height * 4
  ) {
    throw new Error('Grounding DINO source image data does not match its dimensions');
  }
  const size = GROUNDING_DINO_INPUT_SIZE;
  const plane = size * size;
  const tensor = new Float32Array(plane * 3);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.min(imageData.height - 1, Math.floor((y * imageData.height) / size));
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(imageData.width - 1, Math.floor((x * imageData.width) / size));
      const at = (sourceY * imageData.width + sourceX) * 4;
      const index = y * size + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = (imageData.data[at + channel] ?? 0) / 255;
        tensor[channel * plane + index] = (value - mean[channel]!) / std[channel]!;
      }
    }
  }
  return { tensor, width: size, height: size };
}

export interface GroundingDinoWorkerTensor {
  data: Float32Array | BigInt64Array;
  dims: number[];
  dtype?: 'float32' | 'int64';
}

/** Build every graph feed for one query. */
export function buildGroundingDinoInputs(
  imageData: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  tokenization: BertTokenization,
  maxLength = GROUNDING_DINO_MAX_TEXT_LEN,
): Record<string, GroundingDinoWorkerTensor> {
  const preprocessed = preprocessGroundingDinoImage(imageData);
  const ids = new BigInt64Array(maxLength);
  const attention = new BigInt64Array(maxLength);
  const tokenTypes = new BigInt64Array(maxLength);
  for (let index = 0; index < tokenization.ids.length && index < maxLength; index += 1) {
    ids[index] = BigInt(tokenization.ids[index]!);
    attention[index] = 1n;
  }
  const maskPixels = GROUNDING_DINO_INPUT_SIZE * GROUNDING_DINO_INPUT_SIZE;
  const pixelMask = new BigInt64Array(maskPixels).fill(1n);
  return {
    pixel_values: {
      data: preprocessed.tensor,
      dims: [1, 3, preprocessed.height, preprocessed.width],
    },
    input_ids: { data: ids, dims: [1, maxLength], dtype: 'int64' },
    token_type_ids: { data: tokenTypes, dims: [1, maxLength], dtype: 'int64' },
    attention_mask: { data: attention, dims: [1, maxLength], dtype: 'int64' },
    pixel_mask: {
      data: pixelMask,
      dims: [1, GROUNDING_DINO_INPUT_SIZE, GROUNDING_DINO_INPUT_SIZE],
      dtype: 'int64',
    },
  };
}

export interface GroundingDetection {
  /** Stable within a discovery run: query slot + phrase hint. */
  id: string;
  /** Decoded phrase tokens the model matched, e.g. "a cat" or "dog". */
  phrase: string;
  phraseIndex: number | null;
  tokenIndices: number[];
  /** Sigmoid probability of the best matching text token; not calibrated intent. */
  score: number;
  /** Source-pixel corners. */
  box: { x1: number; y1: number; x2: number; y2: number };
  /** Normalized corners in the preprocessed frame (0-1), for provenance. */
  normalizedBox: { x1: number; y1: number; x2: number; y2: number };
}

export interface GroundingDinoDecodeOptions {
  boxThreshold?: number;
  textThreshold?: number;
  maxDetections?: number;
  /** Phrase token spans (from `bertTokenize` of each phrase) for association. */
  phraseSpans?: ReadonlyArray<{ start: number; end: number; phraseIndex: number }>;
}

function sigmoid(value: number): number {
  if (value <= -60) return 0;
  if (value >= 60) return 1;
  return 1 / (1 + Math.exp(-value));
}

function decodeTokens(tokens: readonly string[]): string {
  let text = '';
  for (const token of tokens) {
    if (token === '[CLS]' || token === '[SEP]' || token === '[PAD]') continue;
    if (token.startsWith('##')) {
      text += token.slice(2);
    } else {
      if (text.length > 0) text += ' ';
      text += token;
    }
  }
  return text.trim();
}

/**
 * Decode logits + boxes into reviewable detections.
 *
 * `logits` and `boxes` are the raw graph outputs. Boxes arrive as normalized
 * center/size in the 800x800 frame and are converted to source-pixel corners
 * through the same stretch mapping the preprocessor used.
 */
export function decodeGroundingDinoOutput(
  logits: Float32Array,
  logitsDims: readonly number[],
  boxes: Float32Array,
  boxesDims: readonly number[],
  tokenization: BertTokenization,
  sourceWidth: number,
  sourceHeight: number,
  options: GroundingDinoDecodeOptions = {},
): GroundingDetection[] {
  const boxThreshold = options.boxThreshold ?? 0.3;
  const textThreshold = options.textThreshold ?? 0.3;
  const maxDetections = options.maxDetections ?? GROUNDING_DINO_MAX_DETECTIONS;
  if (
    logitsDims.length !== 3 ||
    logitsDims[0] !== 1 ||
    logitsDims[1] !== GROUNDING_DINO_NUM_QUERIES ||
    logitsDims[2] !== GROUNDING_DINO_NUM_TEXT_TOKENS
  ) {
    throw new Error(`Grounding DINO logits have an unsupported shape [${logitsDims.join(', ')}]`);
  }
  if (
    boxesDims.length !== 3 ||
    boxesDims[0] !== 1 ||
    boxesDims[1] !== GROUNDING_DINO_NUM_QUERIES ||
    boxesDims[2] !== 4
  ) {
    throw new Error(`Grounding DINO boxes have an unsupported shape [${boxesDims.join(', ')}]`);
  }
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)) {
    throw new Error('Grounding DINO source dimensions must be integers');
  }
  const numQueries = GROUNDING_DINO_NUM_QUERIES;
  const numTokens = GROUNDING_DINO_NUM_TEXT_TOKENS;
  const detections: GroundingDetection[] = [];

  for (let query = 0; query < numQueries; query += 1) {
    const offset = query * numTokens;
    let bestLogit = Number.NEGATIVE_INFINITY;
    const matched: number[] = [];
    for (let token = 0; token < numTokens; token += 1) {
      const logit = logits[offset + token]!;
      if (logit > bestLogit) bestLogit = logit;
      if (token > 0 && token < numTokens - 1) {
        const probability = sigmoid(logit);
        if (probability > textThreshold) matched.push(token);
      }
    }
    const score = sigmoid(bestLogit);
    if (score <= boxThreshold || !Number.isFinite(score)) continue;

    const boxOffset = query * 4;
    const centerX = boxes[boxOffset]!;
    const centerY = boxes[boxOffset + 1]!;
    const width = boxes[boxOffset + 2]!;
    const height = boxes[boxOffset + 3]!;
    const x1 = Math.max(0, Math.min(1, centerX - width / 2));
    const y1 = Math.max(0, Math.min(1, centerY - height / 2));
    const x2 = Math.max(0, Math.min(1, centerX + width / 2));
    const y2 = Math.max(0, Math.min(1, centerY + height / 2));
    const tokens = matched.map((index) => tokenization.tokens[index] ?? '[UNK]');
    const phrase = decodeTokens(tokens);
    let phraseIndex: number | null = null;
    if (options.phraseSpans && matched.length > 0) {
      const first = matched[0]!;
      const span = options.phraseSpans.find(
        (candidate) => first >= candidate.start && first <= candidate.end,
      );
      phraseIndex = span?.phraseIndex ?? null;
    }
    detections.push({
      id: `gd-${query}-${matched[0] ?? 'none'}`,
      phrase,
      phraseIndex,
      tokenIndices: matched,
      score,
      box: {
        x1: x1 * sourceWidth,
        y1: y1 * sourceHeight,
        x2: x2 * sourceWidth,
        y2: y2 * sourceHeight,
      },
      normalizedBox: { x1, y1, x2, y2 },
    });
  }

  return suppressDuplicateDetections(detections, maxDetections);
}

/**
 * Drop near-identical boxes for the same phrase only.
 *
 * Two overlapping detections of the *same* class can be two real objects
 * (people standing together), so overlap alone is never a duplicate: the same
 * phrase and an IoU >= 0.9 keeps the higher-scoring box, while different
 * phrases or lower overlap stay distinct.
 */
export function suppressDuplicateDetections(
  detections: GroundingDetection[],
  limit = GROUNDING_DINO_MAX_DETECTIONS,
): GroundingDetection[] {
  const sorted = [...detections].sort((left, right) => right.score - left.score);
  const kept: GroundingDetection[] = [];
  for (const candidate of sorted) {
    const duplicate = kept.find(
      (existing) =>
        existing.phrase === candidate.phrase && boxIou(existing.box, candidate.box) >= 0.9,
    );
    if (!duplicate) kept.push(candidate);
    if (kept.length >= limit) break;
  }
  return kept;
}

function boxIou(
  left: { x1: number; y1: number; x2: number; y2: number },
  right: { x1: number; y1: number; x2: number; y2: number },
): number {
  const x1 = Math.max(left.x1, right.x1);
  const y1 = Math.max(left.y1, right.y1);
  const x2 = Math.min(left.x2, right.x2);
  const y2 = Math.min(left.y2, right.y2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection <= 0) return 0;
  const leftArea = Math.max(0, left.x2 - left.x1) * Math.max(0, left.y2 - left.y1);
  const rightArea = Math.max(0, right.x2 - right.x1) * Math.max(0, right.y2 - right.y1);
  const union = leftArea + rightArea - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Compute phrase token spans in the concatenated query tokenization.
 *
 * Phrases are tokenized independently and located in order in the full
 * sequence so a detection's matched tokens can be attributed to the phrase
 * that produced them. Returns no spans when alignment is ambiguous.
 */
export function locatePhraseSpans(
  tokenization: BertTokenization,
  phrases: readonly string[],
  vocab: Map<string, number>,
): Array<{ start: number; end: number; phraseIndex: number }> {
  const spans: Array<{ start: number; end: number; phraseIndex: number }> = [];
  let cursor = 1;
  for (const [phraseIndex, phrase] of phrases.entries()) {
    const phraseTokens = bertTokenize(phrase, vocab, GROUNDING_DINO_MAX_TEXT_LEN).ids.slice(1, -1);
    if (phraseTokens.length === 0) continue;
    let found = -1;
    for (
      let start = cursor;
      start + phraseTokens.length <= tokenization.tokens.length - 1;
      start += 1
    ) {
      let match = true;
      for (let offset = 0; offset < phraseTokens.length; offset += 1) {
        if (tokenization.ids[start + offset] !== phraseTokens[offset]) {
          match = false;
          break;
        }
      }
      if (match) {
        found = start;
        break;
      }
    }
    if (found < 0) continue;
    spans.push({
      start: found,
      end: found + phraseTokens.length - 1,
      phraseIndex,
    });
    cursor = found + phraseTokens.length;
  }
  return spans;
}
