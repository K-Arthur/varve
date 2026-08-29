import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO_FIXTURE = path.resolve('tests/e2e/fixtures/photo-fixture.jpg');
const REVIEW_DIR = path.resolve('reports/ui-review/image-tuning');

async function openImageTuning(page: Page): Promise<Locator> {
  await page.locator('#file-import-input').setInputFiles(PHOTO_FIXTURE);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
  await page.waitForTimeout(250);

  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();

  const trigger = inspector.getByRole('button', { name: 'Image Tuning', exact: true });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }

  const section = inspector.locator('.image-tuning');
  await expect(section).toBeVisible();
  return section;
}

async function forceFullRedraw(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as {
        __varvePerf?: { forceFullRedraw?: () => void };
      }
    ).__varvePerf?.forceFullRedraw?.();
  });
  await page.waitForTimeout(500);
}

test.describe('Image Tuning', () => {
  test('applies Edge Falloff to an imported image and bypasses it without removing the value', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await navigateToEditor(page);
    const section = await openImageTuning(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();

    const edgeFalloff = section.locator('[data-image-treatment="edgeFalloff-strength"]');
    const slider = edgeFalloff.getByRole('slider', { name: 'Edge Falloff' });
    await expect(slider).toHaveValue('0');
    await expect(edgeFalloff.getByRole('button', { name: 'Disable Edge Falloff' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await forceFullRedraw(page);
    const before = await canvas.screenshot();
    await canvas.screenshot({
      path: path.join(REVIEW_DIR, `edge-falloff-before-${testInfo.project.name}.png`),
    });

    // This changes the actual range control, rather than patching document
    // state, so it crosses the inspector -> smart-filter -> canvas path.
    await slider.fill('-80');
    await expect(slider).toHaveValue('-80');
    await expect(edgeFalloff.getByRole('button', { name: 'Disable Edge Falloff' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await forceFullRedraw(page);
    const applied = await canvas.screenshot();
    expect(Buffer.compare(applied, before)).not.toBe(0);
    await testInfo.attach('edge-falloff-applied', { body: applied, contentType: 'image/png' });
    await canvas.screenshot({
      path: path.join(REVIEW_DIR, `edge-falloff-applied-${testInfo.project.name}.png`),
    });
    await page.screenshot({
      path: path.join(REVIEW_DIR, `image-tuning-panel-${testInfo.project.name}.png`),
      fullPage: false,
    });

    // Bypass must preserve the entry and its parameter rather than reset or
    // destructively bake it into the imported bitmap.
    const disable = edgeFalloff.getByRole('button', { name: 'Disable Edge Falloff' });
    await disable.click();
    await expect(edgeFalloff.getByRole('button', { name: 'Enable Edge Falloff' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(slider).toHaveValue('-80');

    await forceFullRedraw(page);
    const bypassed = await canvas.screenshot();
    expect(Buffer.compare(bypassed, before)).toBe(0);
    await testInfo.attach('edge-falloff-bypassed', { body: bypassed, contentType: 'image/png' });
    await canvas.screenshot({
      path: path.join(REVIEW_DIR, `edge-falloff-bypassed-${testInfo.project.name}.png`),
    });
  });

  test('records a tuning edit in undo history', async ({ page }) => {
    test.setTimeout(120000);
    await navigateToEditor(page);
    const section = await openImageTuning(page);
    const microDetail = section.locator('[data-image-treatment="microDetail-amount"]');
    const slider = microDetail.getByRole('slider', { name: 'Micro Detail' });

    await expect(slider).toHaveValue('0');
    await slider.fill('40');
    await expect(slider).toHaveValue('40');
    await expect(microDetail.getByRole('button', { name: 'Disable Micro Detail' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Re-selecting the image proves the inspector reads the persisted filter
    // entry, not an uncontrolled local slider value.
    await page.getByRole('treeitem').first().click();
    await expect(slider).toHaveValue('40');

    await page.keyboard.press('Control+z');
    await expect(slider).toHaveValue('0');
    await expect(microDetail.getByRole('button', { name: 'Disable Micro Detail' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
