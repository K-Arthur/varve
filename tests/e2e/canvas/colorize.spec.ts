import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Colorize production workflow', () => {
  test('previews, commits, and exports a deterministic recolor without a model', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    page.on('pageerror', (error) =>
      console.log(`[colorize pageerror] ${error.stack ?? error.message}`),
    );
    page.on('console', (message) => {
      if (message.type() === 'error') console.log(`[colorize console] ${message.text()}`);
    });
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();
    const colorizeTrigger = inspector
      .locator('button.insp-disclosure__trigger')
      .filter({ hasText: 'Colorize' })
      .first();
    await expect(colorizeTrigger).toBeVisible();
    const colorize = inspector;
    const trigger = colorizeTrigger;
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();
    const before = await canvas.screenshot();
    await testInfo.attach('colorize-before', { body: before, contentType: 'image/png' });

    await expect(colorize.getByRole('button', { name: 'Generate colorize preview' })).toBeEnabled();
    await colorize.getByRole('button', { name: 'Generate colorize preview' }).click();
    const preview = colorize.getByRole('region', { name: 'Colorize preview' });
    await expect(preview).toBeVisible({ timeout: 30000 });
    await expect(preview.getByRole('img', { name: 'Colorize preview' })).toBeVisible();
    await testInfo.attach('colorize-preview', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // The preview is compared against the untouched source; the reveal slider
    // drives the overlay clip without changing the committed result.
    await expect(preview.getByRole('img', { name: 'Original source for comparison' })).toBeVisible();
    const reveal = preview.getByRole('slider', { name: /Reveal colorize preview/ });
    await expect(reveal).toBeVisible();
    const overlay = preview.locator('.colorize-section__compare-overlay');
    const beforeReveal = await overlay.evaluate((element) => element.getAttribute('style'));
    await reveal.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '20');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect
      .poll(async () => overlay.evaluate((element) => element.getAttribute('style')))
      .not.toBe(beforeReveal);
    await testInfo.attach('colorize-compare', {
      body: await preview.screenshot(),
      contentType: 'image/png',
    });

    await preview.getByRole('button', { name: 'Apply colorization at full resolution' }).click();
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 30000 });
    const after = await canvas.screenshot();
    await testInfo.attach('colorize-after', { body: after, contentType: 'image/png' });
    expect(after.equals(before)).toBe(false);

    await page.keyboard.press('Control+Z');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
    await page.keyboard.press('Control+Shift+Z');
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 30000 });

    const exportTab = inspector.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    if (await exportTab.isVisible().catch(() => false)) {
      await exportTab.click();
    } else {
      await page.getByRole('button', { name: /^More inspector tabs/ }).click();
      await page
        .getByRole('menu', { name: 'More inspector tabs' })
        .getByRole('menuitem', { name: 'Export', exact: true })
        .click();
    }
    const exportGroup = inspector.locator('.spec-export__group').filter({ hasText: 'PNG' }).first();
    await exportGroup.getByRole('button', { name: 'PNG', exact: true }).click();
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await inspector.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const exported = await readFile(downloadPath!);
    expect(exported.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
      true,
    );
    await testInfo.attach('colorize-export.png', { body: exported, contentType: 'image/png' });
  });
});
