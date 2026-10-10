#!/usr/bin/env node

/**
 * WebP/AVIF screenshot derivatives.
 *
 * The capture pipeline writes PNG sources. This module encodes reviewed
 * compressed copies at the source size and, when the source is wider than
 * 720 CSS pixels, a 720-wide candidate. ffmpeg (`libwebp` / `libaom-av1`)
 * is the encoder so the website does not take a Sharp runtime dependency.
 *
 *   node scripts/screenshots/variants.mjs
 *   node scripts/screenshots/variants.mjs --scenes workspace,vector
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../is-main-module.mjs';
import { analyseImage } from './lib/image-analysis.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_PATH = join(ROOT, 'apps', 'website', 'src', 'data', 'screenshot-manifest.json');
const PUBLIC_DIR = join(ROOT, 'apps', 'website', 'public', 'screenshots');
const CANONICAL_DIR = join(ROOT, 'docs', 'screenshots', 'product');

export const VARIANT_FORMATS = ['webp', 'avif'];
export const VARIANT_MAX_EXTRA_WIDTH = 720;

export function variantStem(file) {
  return file.replace(/\.png$/i, '');
}

export function variantFileName(pngFile, width, format) {
  return `${variantStem(pngFile)}-${width}.${format}`;
}

export function variantWidthsFor(sourceWidth) {
  const widths = [sourceWidth];
  if (sourceWidth > VARIANT_MAX_EXTRA_WIDTH) widths.unshift(VARIANT_MAX_EXTRA_WIDTH);
  return [...new Set(widths)].filter((width) => width > 0 && width <= sourceWidth);
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function writeFileAtomicSync(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function requireFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    throw new Error('ffmpeg is required to encode screenshot WebP/AVIF variants');
  }
}

function encodeWithFfmpeg(pngBytes, { width, height, format }) {
  const id = randomBytes(8).toString('hex');
  const input = join(tmpdir(), `varve-shot-${id}.png`);
  const output = join(tmpdir(), `varve-shot-${id}.${format}`);
  writeFileSync(input, pngBytes);
  const args = ['-y', '-i', input, '-vf', `scale=${width}:${height}`];
  if (format === 'webp') {
    args.push('-c:v', 'libwebp', '-quality', '78', '-compression_level', '4');
  } else {
    args.push('-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '35', '-cpu-used', '6');
  }
  args.push(output);
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  try {
    if (result.status !== 0 || !existsSync(output)) {
      throw new Error(result.stderr?.trim() || `ffmpeg failed to encode ${format}`);
    }
    return readFileSync(output);
  } finally {
    rmSync(input, { force: true });
    rmSync(output, { force: true });
  }
}

export async function createVariantEncoder() {
  requireFfmpeg();
  return {
    async encode(pngBytes, options) {
      return encodeWithFfmpeg(pngBytes, options);
    },
    async close() {},
  };
}

/**
 * Encode and write every declared derivative for one captured scene.
 * Returns the variant records to store on the manifest entry.
 */
export async function writeSceneVariants(scene, pngBytes, dirs, encoder) {
  const sourceWidth = scene.width;
  const sourceHeight = scene.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error(`scene ${scene.file} is missing measured dimensions`);
  }
  const next = [];
  const keep = new Set();
  for (const width of variantWidthsFor(sourceWidth)) {
    const height = Math.max(1, Math.round(sourceHeight * (width / sourceWidth)));
    for (const format of VARIANT_FORMATS) {
      const file = variantFileName(scene.file, width, format);
      const bytes = await encoder.encode(pngBytes, { width, height, format });
      const analysis = analyseImage(bytes);
      if (!analysis.valid || analysis.format !== format) {
        throw new Error(
          `${file}: encoder produced ${analysis.format ?? 'unknown'} (${analysis.errors.join('; ')})`,
        );
      }
      if (analysis.width !== width || analysis.height !== height) {
        throw new Error(
          `${file}: encoder size ${analysis.width}x${analysis.height} != ${width}x${height}`,
        );
      }
      for (const dir of dirs) writeFileAtomicSync(join(dir, file), bytes);
      keep.add(file);
      next.push({ file, width, height, sha256: sha256Hex(bytes) });
    }
  }
  for (const stale of scene.variants ?? []) {
    if (keep.has(stale.file)) continue;
    for (const dir of dirs) rmSync(join(dir, stale.file), { force: true });
  }
  return next;
}

export function removeSceneVariants(scene, dirs) {
  for (const variant of scene.variants ?? []) {
    if (!variant?.file) continue;
    for (const dir of dirs) rmSync(join(dir, variant.file), { force: true });
  }
}

export async function applyVariantsToManifest(
  manifest,
  { dirs, onlyIds, encoder, publicDir = PUBLIC_DIR } = {},
) {
  const owned = encoder ? null : await createVariantEncoder();
  const active = encoder ?? owned;
  try {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      if (onlyIds && !onlyIds.has(id)) continue;
      if (scene.status !== 'captured' || !scene.file) continue;
      const pngPath = join(publicDir, scene.file);
      if (!existsSync(pngPath)) {
        throw new Error(`${id}: missing published PNG ${scene.file}`);
      }
      scene.variants = await writeSceneVariants(scene, readFileSync(pngPath), dirs, active);
    }
  } finally {
    if (owned) await owned.close();
  }
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  const scenesFlag = args.indexOf('--scenes');
  const onlyIds = new Set(
    (scenesFlag === -1 ? '' : (args[scenesFlag + 1] ?? ''))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  await applyVariantsToManifest(manifest, {
    dirs: [PUBLIC_DIR, CANONICAL_DIR],
    onlyIds: onlyIds.size > 0 ? onlyIds : undefined,
  });
  writeFileAtomicSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  const count = Object.values(manifest.scenes)
    .filter((scene) => scene.status === 'captured')
    .reduce((sum, scene) => sum + (scene.variants?.length ?? 0), 0);
  console.log(`wrote ${count} screenshot variant(s) → ${MANIFEST_PATH}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
