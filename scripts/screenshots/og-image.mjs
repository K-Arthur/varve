#!/usr/bin/env node
/**
 * OG / social-card image generator.
 *
 * Renders scripts/screenshots/og-template.html at exactly 1200x630 (the
 * Open Graph share-card size) and writes apps/website/public/og-image.png,
 * so the social preview is regenerable from source instead of a one-off
 * binary. No external assets, no fonts, no network requests.
 *
 *   pnpm screenshots:og
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const TEMPLATE = `file://${join(ROOT, 'scripts', 'screenshots', 'og-template.html')}`;
const OUT = join(ROOT, 'apps', 'website', 'public', 'og-image.png');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(TEMPLATE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const shot = await page.screenshot();
  writeFileSync(OUT, shot);
  console.log(`og-image written: ${OUT} (${shot.length} bytes)`);
} finally {
  await browser.close();
}
