#!/usr/bin/env node
/** Verify the seven canonical deliverables without recording another run. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probe } from './core/ffmpeg.mjs';

const root = join(import.meta.dirname, '..', '..');
const out = join(root, 'docs', 'screenshots', 'workflows');
const slugs = [
  'raster-to-vector',
  'bezier-node-edit',
  'poster-to-print',
  'rgb-to-cmyk',
  'variable-font',
  'text-on-path',
  'export-svg',
];
let failed = false;
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
process.exitCode = failed ? 1 : 0;
