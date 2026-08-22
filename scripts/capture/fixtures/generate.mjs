#!/usr/bin/env node
/**
 * Rasterises the committed SVG sources in this directory to the PNG bitmaps
 * the capture fixtures import.
 *
 * Chromium does the rendering because it is already a dependency of this
 * repo — a system rsvg or ImageMagick would make the bytes depend on which
 * machine ran the script. The PNGs are committed alongside their sources, so
 * a capture never needs this to have been run.
 *
 *   node scripts/capture/fixtures/generate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

/** [source, output, width, height] — sizes match each SVG's viewBox. */
// Deliberately small. The trace is real work on real pixels, and at 900x700
// it ran for minutes — which cannot sit inside a twenty-second clip however
// well it succeeds. A quarter of the pixels traces in a fraction of the time
// and reads identically at the size the video is watched.
const SOURCES = [['botanical.svg', 'botanical.png', 460, 358]];

const browser = await chromium.launch();
try {
  for (const [src, out, width, height] of SOURCES) {
    const svg = readFileSync(join(HERE, src), 'utf8');
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;padding:0}</style>${svg}`, {
      waitUntil: 'load',
    });
    const buffer = await page.screenshot({ type: 'png' });
    writeFileSync(join(HERE, out), buffer);
    await page.close();
    console.log(`${out}  ${width}x${height}  ${(buffer.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
}
