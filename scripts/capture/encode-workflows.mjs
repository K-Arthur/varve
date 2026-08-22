#!/usr/bin/env node
/** Encode already-verified workflow masters to MP4 without re-recording them. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { probe, toMp4 } from './core/ffmpeg.mjs';

const root = join(import.meta.dirname, '..', '..');
const out = join(root, 'docs', 'screenshots', 'workflows');
const publicOut = join(root, 'apps', 'website', 'public', 'screenshots', 'workflows');
const slugs = [
  'auto-layout',
  'component-variants',
  'prototype-interaction',
  'smart-animate',
  'motion-timeline',
  'export-react',
  'light-dark-ui',
];
const stage = join(root, `.capture-tmp-encode-${process.pid}-${Date.now()}`);
mkdirSync(stage, { recursive: true });

try {
  for (const slug of slugs) {
    const webmPath = join(out, `${slug}.webm`);
    const manifestPath = join(out, `${slug}.capture.json`);
    if (!existsSync(webmPath) || !existsSync(manifestPath)) {
      throw new Error(`${slug}: verified WebM and manifest are required before MP4 encoding`);
    }

    const mp4Stage = join(stage, `${slug}.mp4`);
    await toMp4(webmPath, mp4Stage, { fps: 30 });
    const webm = await probe(webmPath);
    const mp4 = await probe(mp4Stage);
    const findings = [];
    if (mp4.codec !== 'h264') findings.push(`codec ${mp4.codec}`);
    if (mp4.width !== 1440 || mp4.height !== 900) {
      findings.push(`dimensions ${mp4.width}x${mp4.height}`);
    }
    if (mp4.fps !== 30) findings.push(`fps ${mp4.fps}`);
    if (Math.abs(webm.duration - mp4.duration) > 0.15) {
      findings.push(`duration mismatch ${webm.duration.toFixed(2)} / ${mp4.duration.toFixed(2)}`);
    }
    if (findings.length)
      throw new Error(`${slug}: MP4 verification failed (${findings.join(', ')})`);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.outputs = {
      ...manifest.outputs,
      mp4: `docs/screenshots/workflows/${slug}.mp4`,
    };
    manifest.verification = {
      ...manifest.verification,
      clips: {
        ...manifest.verification?.clips,
        mp4: { pass: true, findings: [], info: mp4 },
      },
      findings: manifest.verification?.findings ?? [],
      pass: manifest.verification?.pass === true,
    };
    const manifestStage = join(stage, `${slug}.capture.json`);
    writeFileSync(manifestStage, `${JSON.stringify(manifest, null, 2)}\n`);

    const publish = (source, destination) => {
      const temporary = `${destination}.tmp-${process.pid}`;
      copyFileSync(source, temporary);
      renameSync(temporary, destination);
    };
    publish(mp4Stage, join(out, `${slug}.mp4`));
    publish(manifestStage, manifestPath);
    mkdirSync(publicOut, { recursive: true });
    publish(mp4Stage, join(publicOut, `${slug}.mp4`));
    console.log(`[${slug}] MP4 ${mp4.duration.toFixed(2)}s, 1440x900, 30fps`);
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}
