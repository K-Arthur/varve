import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const REVIEW_DIR = path.resolve('reports/ui-review/image-resize');
const FIXTURE = path.resolve('tests/e2e/fixtures/test-image.png');

test.describe('Image resize UI', () => {
  test('opens from Object, keeps controls coherent, and applies source-pixel resize', async ({
    page,
  }) => {
    test.setTimeout(120000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToEditor(page);

    await page.locator('#file-import-input').setInputFiles(FIXTURE);
    const layer = page.getByRole('treeitem').first();
    await expect(layer).toBeVisible({ timeout: 15000 });
    await layer.click();

    await page.getByRole('menuitem', { name: /^Object$/i }).click();
    await page.getByRole('menuitem', { name: /resize image/i }).click();

    const dialog = page.getByRole('dialog', { name: 'Resize image' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#resize-width')).toHaveValue('100');
    await expect(page.locator('#resize-height')).toHaveValue('100');
    await page.screenshot({ path: path.join(REVIEW_DIR, '01-open.png'), fullPage: false });

    await page.locator('#resize-width').fill('200');
    await expect(page.locator('#resize-height')).toHaveValue('200');

    await page.getByRole('button', { name: 'Unlock aspect ratio' }).click();
    await page.locator('#resize-height').fill('150');
    await expect(page.locator('#resize-width')).toHaveValue('200');
    await page.getByRole('combobox', { name: 'Resample method' }).click();
    await page.getByRole('option', { name: 'Lanczos 3', exact: true }).click();
    await page.screenshot({ path: path.join(REVIEW_DIR, '02-configured.png'), fullPage: false });

    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await expect(page.getByText('Source pixels', { exact: true })).toBeVisible();
    await expect(page.getByText('200 x 150 px', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(REVIEW_DIR, '03-applied.png'), fullPage: false });
  });
});
