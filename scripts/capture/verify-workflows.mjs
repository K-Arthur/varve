#!/usr/bin/env node
/** Verify the seven canonical deliverables without recording another run. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probe } from './core/ffmpeg.mjs';

const root = join(import.meta.dirname, '..', '..');
const out = join(root, 'docs', 'screenshots', 'workflows');
const publicOut = join(root, 'apps', 'website', 'public', 'screenshots', 'workflows');
const slugs = [
  'raster-to-vector',
  'bezier-node-edit',
  'poster-to-print',
  'rgb-to-cmyk',
  'variable-font',
  'text-on-path',
  'export-svg',
];
const VIDEO_WARN = 5_000_000;
const VIDEO_FAIL = 10_000_000;
const POSTER_WARN = 1_000_000;
const POSTER_FAIL = 2_000_000;
const TOTAL_FAIL = 60_000_000;
let failed = false;
let canonicalBytes = 0;

function checkBudget(slug, label, path, warn, limit) {
  const bytes = readFileSync(path).length;
  canonicalBytes += bytes;
  if (bytes > limit) {
    console.error(
      `[${slug}] ${label} is ${(bytes / 1e6).toFixed(2)} MB (limit ${(limit / 1e6).toFixed(0)} MB)`,
    );
    failed = true;
  } else if (bytes > warn) {
    console.warn(
      `[${slug}] WARN ${label} is ${(bytes / 1e6).toFixed(2)} MB (review threshold ${(warn / 1e6).toFixed(0)} MB)`,
    );
  }
}

function checkPng(slug, path) {
  const buf = readFileSync(path);
  const valid =
    buf.length >= 24 &&
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).equals(buf.subarray(0, 8));
  const width = valid ? buf.readUInt32BE(16) : 0;
  const height = valid ? buf.readUInt32BE(20) : 0;
  if (!valid || width !== 1440 || height !== 900) {
    console.error(`[${slug}] poster is not a 1440x900 PNG`);
    failed = true;
  }
}

function checkWebsiteCopy(slug, fileName, canonicalPath) {
  const publicPath = join(publicOut, fileName);
  if (!existsSync(publicPath)) {
    console.error(`[${slug}] website copy missing ${fileName}`);
    failed = true;
    return;
  }
  if (!readFileSync(canonicalPath).equals(readFileSync(publicPath))) {
    console.error(`[${slug}] website copy differs from canonical ${fileName}`);
    failed = true;
  }
}

for (const dir of [out, publicOut]) {
  for (const fileName of readdirSync(dir)) {
    if (fileName.endsWith('.gif')) {
      console.error(`[media] GIF workflow output is not allowed: ${join(dir, fileName)}`);
      failed = true;
    }
  }
}

for (const slug of slugs) {
  const manifestPath = join(out, `${slug}.capture.json`);
  const webmPath = join(out, `${slug}.webm`);
  const mp4Path = join(out, `${slug}.mp4`);
  const posterPath = join(out, `${slug}-poster.png`);
  const missing = [manifestPath, webmPath, mp4Path, posterPath].filter((path) => !existsSync(path));
  if (missing.length) {
    console.error(`[${slug}] missing ${missing.map((path) => path.split('/').pop()).join(', ')}`);
    failed = true;
    continue;
  }
  const [webm, mp4] = await Promise.all([probe(webmPath), probe(mp4Path)]);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  checkBudget(slug, 'WebM', webmPath, VIDEO_WARN, VIDEO_FAIL);
  checkBudget(slug, 'MP4', mp4Path, VIDEO_WARN, VIDEO_FAIL);
  checkBudget(slug, 'poster', posterPath, POSTER_WARN, POSTER_FAIL);
  checkPng(slug, posterPath);
  checkWebsiteCopy(slug, `${slug}.webm`, webmPath);
  checkWebsiteCopy(slug, `${slug}.mp4`, mp4Path);
  checkWebsiteCopy(slug, `${slug}-poster.png`, posterPath);
  const findings = [];
  if (webm.codec !== 'vp9') findings.push(`webm codec ${webm.codec}`);
  if (mp4.codec !== 'h264') findings.push(`mp4 codec ${mp4.codec}`);
  if (webm.width !== 1440 || webm.height !== 900)
    findings.push(`webm dimensions ${webm.width}x${webm.height}`);
  if (mp4.width !== 1440 || mp4.height !== 900)
    findings.push(`mp4 dimensions ${mp4.width}x${mp4.height}`);
  if (webm.fps !== 30) findings.push(`webm fps ${webm.fps}`);
  if (mp4.fps !== 30) findings.push(`mp4 fps ${mp4.fps}`);
  if (Math.abs(webm.duration - mp4.duration) > 0.15)
    findings.push(`duration mismatch ${webm.duration.toFixed(2)} / ${mp4.duration.toFixed(2)}`);
  if (manifest.outputs?.mp4 !== `docs/screenshots/workflows/${slug}.mp4`)
    findings.push('manifest MP4 output is missing or incorrect');
  if (manifest.outputs?.webm !== `docs/screenshots/workflows/${slug}.webm`)
    findings.push('manifest WebM output is missing or incorrect');
  if (manifest.outputs?.poster !== `docs/screenshots/workflows/${slug}-poster.png`)
    findings.push('manifest poster output is missing or incorrect');
  if (manifest.viewport !== '1440x900' || manifest.fps !== 30)
    findings.push(`manifest capture settings are ${manifest.viewport} at ${manifest.fps}fps`);
  if (
    typeof manifest.deliveredDuration === 'number' &&
    Math.abs(manifest.deliveredDuration - mp4.duration) > 0.15
  ) {
    findings.push(
      `manifest duration mismatch ${manifest.deliveredDuration.toFixed(2)} / ${mp4.duration.toFixed(2)}`,
    );
  }
  if (manifest.verification?.pass !== true) findings.push('manifest verification is not passing');
  if (manifest.verification?.clips?.mp4?.pass !== true)
    findings.push('manifest MP4 verification is not passing');
  if (findings.length) {
    console.error(`[${slug}] ${findings.join('; ')}`);
    failed = true;
  } else {
    console.log(`[${slug}] OK ${webm.duration.toFixed(2)}s, 1440x900, 30fps`);
  }
}
if (canonicalBytes > TOTAL_FAIL) {
  console.error(
    `[media] canonical workflow set is ${(canonicalBytes / 1e6).toFixed(2)} MB (limit ${TOTAL_FAIL / 1e6} MB)`,
  );
  failed = true;
}
process.exitCode = failed ? 1 : 0;
