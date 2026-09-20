/**
 * Slider canonicalization — multimodal evidence and contract.
 *
 * The `capture` block is a diagnostic harness: it walks every slider surface
 * this pass touches, records the rendered class/dimensions of each range
 * input, and writes screenshots to `reports/slider-canonicalization/`. It
 * never fails on styling, so it can run before the migration to produce a
 * baseline and after it to produce the comparison.
 *
 * The `contract` block is the regression test: after canonicalization every
 * user-facing range input must carry the single `varve-native-range` skin, and
 * the `@varve/ui` Slider must be a native range rather than a parallel
 * `role="slider"` div implementation.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor, switchWorkspace } from '../shared';

const REVIEW_DIR = path.resolve('reports/slider-canonicalization');
const IMAGE_FIXTURE = path.resolve('tests/e2e/fixtures/test-image.png');

mkdirSync(REVIEW_DIR, { recursive: true });

interface RangeMeasurement {
  cls: string;
  width: number;
  height: number;
  appearance: string;
  accentColor: string;
  ariaLabel: string | null;
  min: string;
  max: string;
  step: string;
  parent: string;
}

async function measureRanges(page: Page): Promise<RangeMeasurement[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type="range"]')).map((input) => {
      const cs = getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      return {
        cls: input.className,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        appearance: cs.appearance,
        accentColor: cs.accentColor,
        ariaLabel: input.getAttribute('aria-label'),
        min: input.min,
        max: input.max,
        step: input.step,
        parent: input.parentElement?.className ?? '',
      };
    }),
  );
}

async function expandAllDisclosures(page: Page, scope: string) {
  const triggers = page.locator(`${scope} .insp-disclosure__trigger[aria-expanded="false"]`);
  for (let i = 0; i < 12; i += 1) {
    const count = await triggers.count();
    if (count === 0) break;
    await triggers.first().click();
    await page.waitForTimeout(120);
  }
}

async function importImage(page: Page) {
  await page.locator('#file-import-input').setInputFiles(IMAGE_FIXTURE);
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach((d) => {
      (d as HTMLDialogElement).close();
    });
  });
  await page.waitForTimeout(200);
}

test.describe('slider capture', () => {
  test('capture adjustment sliders (RangeValueControl)', async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await importImage(page);
    await switchWorkspace(page, 'Photo');
    const tab = page.getByRole('tab', { name: 'Adjustments', exact: true });
    await tab.click();
    await page
      .locator('#insp-tabpanel-adjustments .insp-disclosure')
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
    await expandAllDisclosures(page, '#insp-tabpanel-adjustments');
    await page.locator('#insp-tabpanel-adjustments').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(200);
    await page
      .locator('#insp-tabpanel-adjustments')
      .screenshot({ path: path.join(REVIEW_DIR, 'adjustments.png') });
    const ranges = await measureRanges(page);
    // eslint-disable-next-line no-console
    console.log('ADJUSTMENT RANGES', JSON.stringify(ranges, null, 2));
  });

  test('capture vectorize sliders (@varve/ui Slider)', async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await importImage(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.locator('.vectorize__diagnostics') });
    await dialog.screenshot({ path: path.join(REVIEW_DIR, 'vectorize.png') });
    const ranges = await measureRanges(page);
    const sliderThumbs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.varve-slider')).map((slider) => {
        const thumb = slider.querySelector<HTMLElement>('[role="slider"]');
        const rect = thumb?.getBoundingClientRect();
        return {
          cls: slider.className,
          thumb: thumb ? { tag: thumb.tagName, w: rect?.width, h: rect?.height } : null,
        };
      }),
    );
    // eslint-disable-next-line no-console
    console.log('VECTORIZE RANGES', JSON.stringify(ranges, null, 2));
    // eslint-disable-next-line no-console
    console.log('VECTORIZE SLIDER THUMBS', JSON.stringify(sliderThumbs, null, 2));
  });

  test('capture document panel sliders (insp-range)', async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await page.locator('.editor-inspector').waitFor({ timeout: 15000 });
    await expandAllDisclosures(page, '.editor-inspector');
    await page.waitForTimeout(200);
    await page
      .locator('.editor-inspector')
      .screenshot({ path: path.join(REVIEW_DIR, 'document-panel.png') });
    const ranges = await measureRanges(page);
    // eslint-disable-next-line no-console
    console.log('DOCUMENT RANGES', JSON.stringify(ranges, null, 2));
  });
});

test.describe('slider contract', () => {
  test('adjustment sliders all use the canonical native-range skin', async ({ page }) => {
    test.setTimeout(240000);
    await navigateToEditor(page);
    await importImage(page);
    await switchWorkspace(page, 'Photo');
    await page.getByRole('tab', { name: 'Adjustments', exact: true }).click();
    await page
      .locator('#insp-tabpanel-adjustments .insp-disclosure')
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
    await expandAllDisclosures(page, '#insp-tabpanel-adjustments');
    const ranges = await measureRanges(page);
    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range.cls, `range ${range.ariaLabel ?? '(unlabelled)'}`).toContain(
        'varve-native-range',
      );
    }
  });

  test('the @varve/ui Slider is a native range, not a div role=slider', async ({ page }) => {
    test.setTimeout(240000);
    await navigateToEditor(page);
    await importImage(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 30000 });
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.locator('.vectorize__diagnostics') });
    const sliders = dialog.locator('.varve-slider');
    expect(await sliders.count()).toBeGreaterThan(0);
    const nonNative = await dialog
      .locator('.varve-slider [role="slider"]:not(input[type="range"])')
      .count();
    expect(nonNative).toBe(0);
    const ranges = await measureRanges(page);
    for (const range of ranges) {
      expect(range.cls).toContain('varve-native-range');
    }
  });
});
