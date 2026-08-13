import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Background removal — all modes', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    // Dismiss ALL overlays: Welcome dialog + Getting Started panel
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => {
        (d as HTMLDialogElement).close();
      });
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const dismiss = page.getByRole('button', { name: /dismiss/i });
    if (await dismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
      await dismiss.click();
    }
    await page.waitForTimeout(300);
  });

  async function importTestImage(
    page: import('@playwright/test').Page,
    dimensions: { width: number; height: number } = { width: 200, height: 200 },
  ) {
    const imageDataUrl = await page.evaluate(({ width, height }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#0066cc';
      ctx.fillRect(0, 0, width, height);
      ctx.beginPath();
      ctx.ellipse(width / 2, height / 2, width * 0.22, height * 0.32, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#cc0033';
      ctx.fill();
      ctx.fillStyle = '#33aa33';
      ctx.fillRect(width * 0.15, height * 0.15, width * 0.2, height * 0.2);
      return c.toDataURL('image/png');
    }, dimensions);
    const base64 = imageDataUrl.split(',')[1]!;
    const tmpFile = path.join('/tmp', `test-${Date.now()}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(base64, 'base64'));
    await page.locator('#file-import-input').setInputFiles(tmpFile);
    await page.waitForTimeout(3000);
    // Close any dialogs that re-appeared after import
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => {
        (d as HTMLDialogElement).close();
      });
    });
    await page.waitForTimeout(300);
    fs.unlinkSync(tmpFile);
  }

  async function importDisconnectedSubjectsImage(page: import('@playwright/test').Page) {
    const imageDataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 200;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#f5f5f5';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#b51f3c';
      context.beginPath();
      context.arc(65, 100, 38, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#17324d';
      context.fillRect(205, 55, 62, 90);
      return canvas.toDataURL('image/png');
    });
    const tmpFile = path.join('/tmp', `quick-disconnected-${Date.now()}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(imageDataUrl.split(',')[1]!, 'base64'));
    await page.locator('#file-import-input').setInputFiles(tmpFile);
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((dialog) => {
        (dialog as HTMLDialogElement).close();
      });
    });
    fs.unlinkSync(tmpFile);
  }

  test('Quick toolbar — heuristic bg removal', async ({ page }) => {
    await importTestImage(page);
    const btn = page
      .getByTestId('selection-quick-bar')
      .getByRole('button', { name: 'Remove background' });
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.click();
    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 15000 });
    await expect(review.getByText(/Nothing has been added to the document yet/i)).toBeVisible();
    const contentCanvas = page.getByTestId('editor-canvas');
    const beforeApply = await contentCanvas.screenshot();
    await review.getByRole('button', { name: 'Apply result' }).click();
    await expect(review).toBeHidden();

    await expect
      .poll(async () => (await contentCanvas.screenshot()).equals(beforeApply), {
        message: 'applying the generated mask should change the rendered image pixels',
      })
      .toBe(false);

    // Verify: canvas should still be visible, no error alerts
    await expect(contentCanvas).toBeVisible();
    const alerts = page.locator('[role="alert"]');
    for (let i = 0; i < (await alerts.count()); i++) {
      const t = await alerts.nth(i).textContent();
      expect(t || '').not.toMatch(/failed|unavailable/i);
    }
  });

  test('Quick mode bypasses subject selection for disconnected foreground regions', async ({
    page,
  }) => {
    await importDisconnectedSubjectsImage(page);
    const contentCanvas = page.getByTestId('editor-canvas');
    const beforeApply = await contentCanvas.screenshot();
    await page
      .getByTestId('selection-quick-bar')
      .getByRole('button', { name: 'Remove background' })
      .click();

    await expect(page.getByRole('dialog', { name: 'Select subjects' })).toHaveCount(0);
    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({
      timeout: 15000,
    });
    await expect(review.getByRole('img', { name: 'Isolated subject preview' })).toBeVisible();
    await review.getByRole('button', { name: 'Apply result' }).click();
    await expect(review).toBeHidden();
    await expect
      .poll(async () => (await contentCanvas.screenshot()).equals(beforeApply), {
        message: 'Quick should apply the disconnected-subject mask to the canvas',
      })
      .toBe(false);
  });

  test('Inspector — AI Balanced bg removal', async ({ page }) => {
    await importTestImage(page);
    await page.getByRole('tab', { name: 'Adjustments' }).click();
    const backgroundRemovalSection = page.getByRole('button', { name: 'Background Removal' });
    if ((await backgroundRemovalSection.getAttribute('aria-expanded')) === 'false') {
      await backgroundRemovalSection.click();
    }
    const methodSelect = page.getByRole('combobox', { name: 'Background removal method' });
    await methodSelect.waitFor({ state: 'visible', timeout: 5000 });
    await methodSelect.click();
    await page.getByRole('option', { name: /AI Balanced/i }).click();

    // Click the inspector's Remove Background button
    const btn = page.getByRole('button', { name: 'Remove background from image' });
    await btn.click({ force: true });

    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 30000 });
    const contentCanvas = page.getByTestId('editor-canvas');
    const beforeApply = await contentCanvas.screenshot();
    await review.getByRole('button', { name: 'Apply result' }).click();
    await expect(review).toBeHidden();
    await expect(page.getByRole('button', { name: 'Re-apply background removal' })).toBeVisible();
    await expect
      .poll(async () => (await contentCanvas.screenshot()).equals(beforeApply), {
        message: 'applying an AI mask should change the rendered image pixels',
      })
      .toBe(false);

    // Verify: no errors, canvas visible
    const errors = page.locator('.insp-hint--error');
    expect(await errors.count()).toBe(0);
    await expect(page.locator('.error-boundary')).toHaveCount(0);
    await expect(contentCanvas).toBeVisible();
  });

  test('No crash after bg removal', async ({ page }) => {
    await importTestImage(page);
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    await page
      .getByTestId('selection-quick-bar')
      .getByRole('button', { name: 'Remove background' })
      .click();
    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 15000 });
    await review.getByRole('button', { name: 'Apply result' }).click();

    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
  });

  test('large panoramic image applies through the bounded mask render path', async ({ page }) => {
    test.setTimeout(60000);
    await importTestImage(page, { width: 3000, height: 600 });
    const contentCanvas = page.getByTestId('editor-canvas');
    const beforeApply = await contentCanvas.screenshot();

    await page
      .getByTestId('selection-quick-bar')
      .getByRole('button', { name: 'Remove background' })
      .click();
    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 30000 });
    await review.getByRole('button', { name: 'Apply result' }).click();
    await expect(review).toBeHidden({ timeout: 5000 });

    await expect
      .poll(async () => (await contentCanvas.screenshot()).equals(beforeApply), {
        message: 'the large-image render proxy should visibly apply its mask',
        timeout: 15000,
      })
      .toBe(false);
    await expect(page.getByRole('button', { name: 'Edit mask' })).toBeVisible();
  });

  test('Properties exposes the complete mask editing workflow', async ({ page }) => {
    await importTestImage(page);
    await page
      .getByTestId('selection-quick-bar')
      .getByRole('button', { name: 'Remove background' })
      .click();
    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 15000 });
    await review.getByRole('button', { name: 'Apply result' }).click();

    const contentCanvas = page.getByTestId('editor-canvas');
    const overlayCanvas = page.getByTestId('canvas-overlay');
    const overlayBeforeEditing = await overlayCanvas.screenshot();
    const editMask = page.getByRole('button', { name: 'Edit mask' });
    await expect(editMask).toBeVisible();
    await editMask.click();
    const editor = page.locator('#background-mask-editor');
    await expect(editor).toBeVisible();
    await expect(contentCanvas).toHaveCSS('cursor', 'crosshair');
    await expect
      .poll(async () => (await overlayCanvas.screenshot()).equals(overlayBeforeEditing), {
        message: 'opening the mask editor should render its canvas preview overlay',
      })
      .toBe(false);
    await expect(editor.getByLabel('Mask preview mode')).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Refine Mask' })).toBeVisible();
    await expect(editor.getByRole('button', { name: /Refine hair and fur edges/i })).toBeVisible();
    await expect(editor.getByRole('button', { name: /Edit trimap/i })).toBeVisible();

    const selectionBounds = await page
      .locator('.editor-canvas svg[role="presentation"] > rect[fill="none"]')
      .first()
      .boundingBox();
    expect(selectionBounds).not.toBeNull();
    const beforeStroke = await contentCanvas.screenshot();
    const strokeX = selectionBounds!.x + selectionBounds!.width / 2;
    const strokeY = selectionBounds!.y + selectionBounds!.height / 2;
    await page.waitForTimeout(300);
    await page.keyboard.down('Alt');
    await page.mouse.move(strokeX - 6, strokeY);
    await page.mouse.down();
    await page.mouse.move(strokeX + 6, strokeY, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect
      .poll(async () => (await contentCanvas.screenshot()).equals(beforeStroke), {
        message: 'painting in the mask editor should update the rendered mask',
      })
      .toBe(false);

    await editor.getByRole('button', { name: 'Done' }).click();
    await expect(editor).toBeHidden();
    await expect(contentCanvas).toHaveCSS('cursor', 'default');
    await expect(page.locator('.error-boundary')).toHaveCount(0);
  });
});
