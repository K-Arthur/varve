/**
 * Render the unmodified Style Dictionary artifact in an independent browser
 * page and verify both emitted and omitted aliases against actual pixels.
 *
 * Run from the repository root with:
 *   node scripts/quality/heavy-lease.mjs "e2e: DTCG consumer CSS" -- \
 *     node scripts/tokens/verify-consumer-css.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(resolve('package.json'));
const { chromium } = require('@playwright/test');
const fixtureDirectory = resolve('docs/tokens/fixtures');
const screenshotPath = resolve(
  'docs/screenshots/dtcg-runtime-2026-09-25/independent-css-consumer.png',
);
const resultPath = resolve('docs/tokens/fixtures/runtime-export-consumer-render.json');

mkdirSync(resolve('docs/screenshots/dtcg-runtime-2026-09-25'), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 650 },
    deviceScaleFactor: 1,
  });
  await page.goto(
    pathToFileURL(resolve(fixtureDirectory, 'runtime-export-consumer-sample.html')).href,
  );
  const observed = await page.evaluate(() => {
    const swatches = [...document.querySelectorAll('.sample')].map((element) => {
      const background = getComputedStyle(element).backgroundColor;
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas pixel sampler is unavailable.');
      context.fillStyle = background;
      context.fillRect(0, 0, 1, 1);
      return {
        label: element.textContent?.trim() ?? '',
        background,
        rgba: [...context.getImageData(0, 0, 1, 1).data],
      };
    });
    const samples = document.querySelector('.samples');
    if (!samples) throw new Error('Sample layout is unavailable.');
    return {
      swatches,
      emittedPointerAlias: getComputedStyle(document.documentElement)
        .getPropertyValue('--semantic-brand-pointer-alias')
        .trim(),
      gap: getComputedStyle(samples).gap,
      rootFont: getComputedStyle(document.documentElement).fontSize,
    };
  });
  const expectedRgb = [204, 51, 26, 255];
  if (
    observed.swatches.length !== 4 ||
    observed.swatches
      .slice(0, 3)
      .some((swatch) =>
        swatch.rgba.some((channel, index) => Math.abs(channel - expectedRgb[index]) > 1),
      ) ||
    observed.swatches[3]?.rgba[3] !== 0 ||
    observed.emittedPointerAlias !== '' ||
    observed.gap !== '20px' ||
    observed.rootFont !== '16px'
  ) {
    throw new Error(JSON.stringify(observed, null, 2));
  }

  await page.screenshot({ path: screenshotPath });
  writeFileSync(
    resultPath,
    `${JSON.stringify(
      {
        browser: await browser.version(),
        observed,
        screenshot: '../../screenshots/dtcg-runtime-2026-09-25/independent-css-consumer.png',
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${JSON.stringify(observed)}\n`);
} finally {
  await browser.close();
}
