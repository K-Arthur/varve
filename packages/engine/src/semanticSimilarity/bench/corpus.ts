/**
 * Corpus loader for the semantic-similarity evaluation harness.
 * Reads the generated Varve corpus (tests/fixtures/semantic-corpus) —
 * manifest plus decoded RGBA buffers. Dev-only (pngjs/jpeg-js).
 */

import { readFileSync } from 'node:fs';
/* eslint-disable @typescript-eslint/no-require-imports */
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

export interface CorpusImage {
  id: string;
  file: string;
  domain: string;
  base: string;
  relation: string;
  family: string;
  layoutTwinOf?: string;
  size: [number, number];
  /** Decoded RGBA (lazily populated). */
  rgba: Uint8ClampedArray | null;
  width: number;
  height: number;
}

export interface Corpus {
  root: string;
  images: CorpusImage[];
  byId: Map<string, CorpusImage>;
}

const DEFAULT_CORPUS_ROOT = resolve(process.cwd(), 'tests/fixtures/semantic-corpus');

export function corpusRoot(env = process.env): string {
  return env.VARVE_SEMANTIC_CORPUS ?? DEFAULT_CORPUS_ROOT;
}

export function loadCorpusManifest(root = corpusRoot()): Corpus {
  const raw = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8')) as {
    images: Array<{
      id: string;
      file: string;
      domain: string;
      base: string;
      relation: string;
      family: string;
      layoutTwinOf?: string;
      size: [number, number];
    }>;
  };
  const images: CorpusImage[] = raw.images.map((i) => ({
    ...i,
    rgba: null,
    width: i.size[0]!,
    height: i.size[1]!,
  }));
  const byId = new Map(images.map((i) => [i.id, i]));
  return { root, images, byId };
}

export function decodeCorpusImage(image: CorpusImage): void {
  if (image.rgba) return;
  const buf = readFileSync(join(corpusRoot(), image.file));
  const { data, width, height } = decodeRgba(buf);
  image.rgba = data;
  image.width = width;
  image.height = height;
}

export function decodeRgba(buf: Buffer): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) {
    const { PNG } = require('pngjs');
    const png = PNG.sync.read(buf);
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  }
  const jpeg = require('jpeg-js');
  const jpg = jpeg.decode(buf, { useTArray: true });
  return { data: new Uint8ClampedArray(jpg.data), width: jpg.width, height: jpg.height };
}

/** Pixel-close variant relations for the near-duplicate lane. */
export const PIXEL_CLOSE_RELATIONS: ReadonlySet<string> = new Set([
  'exact',
  'resized',
  'resized-up',
  'jpeg-q60',
  'jpeg-q85',
  'png-jpeg-roundtrip',
  'hue-shifted',
  'hue-shifted-neg',
  'monochrome',
  'mirrored',
  'crop-center',
  'crop-offset',
  'rotate-90',
  'badge-overlay',
  'text-overlay',
]);

/** Exact-copy relations (byte-identical pixels). */
export const EXACT_COPY_RELATIONS: ReadonlySet<string> = new Set(['exact']);

/** Relations that share the same subject with the base image. */
export function subjectRelevantSet(corpus: Corpus, image: CorpusImage): Set<string> {
  const set = new Set<string>();
  for (const other of corpus.images) {
    if (other.id === image.id) continue;
    if (other.family === image.family) set.add(other.id);
  }
  return set;
}

/** Pixel-close relevance for duplicate detection, per query family. */
export function duplicateRelevantSet(corpus: Corpus, image: CorpusImage): Set<string> {
  const set = new Set<string>();
  for (const other of corpus.images) {
    if (other.id === image.id) continue;
    if (other.family === image.family && PIXEL_CLOSE_RELATIONS.has(other.relation))
      set.add(other.id);
  }
  return set;
}

/** Layout-relevance: images generated from the same scene skeleton. */
export function layoutRelevantSet(corpus: Corpus, image: CorpusImage): Set<string> {
  const set = new Set<string>();
  for (const other of corpus.images) {
    if (other.id === image.id) continue;
    const sharesLayout =
      other.base === image.base ||
      other.layoutTwinOf === image.base ||
      other.base === (image.layoutTwinOf ?? '') ||
      other.layoutTwinOf === (image.layoutTwinOf ?? '');
    if (sharesLayout) set.add(other.id);
  }
  return set;
}
