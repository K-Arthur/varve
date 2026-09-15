import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/** Real-pointer coverage for the Stroke inspector and its rendered result. */
test.describe('Stroke workflow', () => {
  test('adds and edits a stroke with advanced geometry controls', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await navigateToEditor(page);

    await page.keyboard.press('r');
    await dragOnCanvas(page, 120, 120, 420, 320);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 270, box.y + 220);

    const strokeTrigger = page.getByRole('button', { name: 'Stroke', exact: true });
    await strokeTrigger.scrollIntoViewIfNeeded();
    await expect(strokeTrigger).toBeVisible();
    if ((await strokeTrigger.getAttribute('aria-expanded')) !== 'true') {
      await strokeTrigger.click();
    }

    const strokeSection = strokeTrigger.locator('..');
    await strokeSection.getByRole('button', { name: /add stroke/i }).click();
    const advanced = strokeSection.getByRole('button', { name: 'Advanced', exact: true });
    await advanced.click();

    await expect(strokeSection.getByLabel('Stroke dash pattern')).toBeVisible();
    await strokeSection.getByLabel('Stroke dash pattern').fill('18, 8');
    await strokeSection.getByLabel('Stroke dash pattern').press('Enter');
    await expect(strokeSection.getByLabel('Stroke dash pattern')).toHaveValue('18, 8');
    await expect(strokeSection.getByText('Per-side')).toBeVisible();

    await strokeSection.screenshot({ path: testInfo.outputPath('stroke-inspector.png') });
    await page.screenshot({ path: testInfo.outputPath('stroke-workflow.png'), fullPage: false });

    const exportTab = page.getByRole('tab', { name: /^export$/i });
    await exportTab.click();
    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'SVG', exact: true })
      .click();
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const svg = await readFile((await download.path())!, 'utf8');
    expect(svg).toContain('stroke-dasharray="18 8"');

    // Remove the selection overlay before capturing the rendered artwork so
    // the screenshot reviews the actual dash geometry, not just handles.
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 650, box.y + 470);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    await canvas.screenshot({ path: testInfo.outputPath('stroke-canvas.png') });
  });
});
