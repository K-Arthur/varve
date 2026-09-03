import { expect, test } from '@playwright/test';
import {
  FIXTURES,
  MOTION_FIXTURES,
  type MotionVisualFixture,
  makePathologicalFixture,
  type VisualFixture,
} from './fixtures';

const ALL_FIXTURES: VisualFixture[] = [...FIXTURES, makePathologicalFixture(1500)];

async function renderFixture(page: import('@playwright/test').Page, fixture: VisualFixture) {
  await page.goto('/visual-harness.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    {
      timeout: 15000,
    },
  );
  const renderedSize = await page.evaluate(
    async ({ items, width, height }) => {
      await (
        window as unknown as {
          __renderFixture: (items: unknown[], w: number, h: number) => Promise<void>;
        }
      ).__renderFixture(items, width, height);
      const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    },
    { items: fixture.items, width: fixture.width, height: fixture.height },
  );
  expect(renderedSize).toEqual({ width: fixture.width, height: fixture.height });
}

async function renderMotionFixture(
  page: import('@playwright/test').Page,
  fixture: MotionVisualFixture,
) {
  await page.goto('/visual-harness.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    { timeout: 15000 },
  );
  await page.evaluate(
    async ({ fixture, width, height }) => {
      await (
        window as unknown as {
          __renderMotionFixture: (
            value: MotionVisualFixture,
            w: number,
            h: number,
          ) => Promise<void>;
        }
      ).__renderMotionFixture(fixture, width, height);
    },
    { fixture, width: fixture.width, height: fixture.height },
  );
}

for (const fixture of ALL_FIXTURES) {
  test(`replay visual: ${fixture.name}`, async ({ page }, testInfo) => {
    // DPR label comes from the project (see playwright.config.ts's
    // chromium-visual-1x/2x/3x projects), not a hardcoded suffix, so the
    // same spec produces per-DPR baselines without duplicating test bodies.
    const dprLabel = testInfo.project.name.replace('chromium-visual-', '');
    await renderFixture(page, fixture);
    await expect(page.locator('#harness-canvas')).toHaveScreenshot(
      `${fixture.name}-${dprLabel}.png`,
      {
        // Higher DPR means more real pixels for the same tolerance budget to
        // cover — scale the pixel-count tolerance by deviceScaleFactor^2,
        // not a flat number, or 2x/3x baselines would be far stricter than
        // 1x for the identical rendered content.
        maxDiffPixels: Math.round(
          fixture.maxDiffPixels * (testInfo.project.use.deviceScaleFactor ?? 1) ** 2,
        ),
      },
    );
  });
}

for (const fixture of MOTION_FIXTURES) {
  test(`replay visual: ${fixture.name}`, async ({ page }, testInfo) => {
    const dprLabel = testInfo.project.name.replace('chromium-visual-', '');
    await renderMotionFixture(page, fixture);
    await expect(page.locator('#harness-canvas')).toHaveScreenshot(
      `${fixture.name}-${dprLabel}.png`,
      {
        maxDiffPixels: Math.round(
          fixture.maxDiffPixels * (testInfo.project.use.deviceScaleFactor ?? 1) ** 2,
        ),
      },
    );
  });
}
