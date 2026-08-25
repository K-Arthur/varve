import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Export panel — browser download path', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function selectExportTab(page: import('@playwright/test').Page) {
    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.waitFor({ state: 'visible', timeout: 5000 });
    await exportTab.click();
  }

  async function createExportableFrame(page: import('@playwright/test').Page) {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  }

  async function getExportMessage(page: import('@playwright/test').Page) {
    return page.locator('.spec-export__message');
  }

  test('Export tab is present and renders format options', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await expect(page.getByRole('tab', { name: /export/i })).toBeVisible();
    await expect(
      page.locator('.spec-export__group').first().getByRole('button', { name: 'PNG', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'JPEG', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'WebP', exact: true })).toBeVisible();
    await expect(
      page.locator('.spec-export__group').first().getByRole('button', { name: 'SVG', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();
  });

  test('SVG export succeeds without error', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'SVG', exact: true })
      .click();
    await page.getByRole('button', { name: /download/i }).click();

    const msg = await getExportMessage(page);
    await expect(msg).toBeVisible({ timeout: 15000 });
    await expect(msg).toHaveText(/exported/i, { timeout: 15000 });
    await expect(msg).not.toHaveText(/failed/i);
  });

  test('PNG export succeeds without error', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'PNG', exact: true })
      .click();
    await page.getByRole('button', { name: /download/i }).click();

    const msg = await getExportMessage(page);
    await expect(msg).toBeVisible({ timeout: 15000 });
    await expect(msg).toHaveText(/exported/i, { timeout: 15000 });
    await expect(msg).not.toHaveText(/failed/i);
  });

  test('JPEG export succeeds without error', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: 'JPEG', exact: true }).click();
    await page.getByRole('button', { name: /download/i }).click();

    const msg = await getExportMessage(page);
    await expect(msg).toBeVisible({ timeout: 15000 });
    await expect(msg).toHaveText(/exported/i, { timeout: 15000 });
    await expect(msg).not.toHaveText(/failed/i);
  });

  test('WebP export succeeds without error', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: 'WebP', exact: true }).click();
    await page.getByRole('button', { name: /download/i }).click();

    const msg = await getExportMessage(page);
    await expect(msg).toBeVisible({ timeout: 15000 });
    await expect(msg).toHaveText(/exported/i, { timeout: 15000 });
    await expect(msg).not.toHaveText(/failed/i);
  });

  test('2x scale and 1x scale both export successfully', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'PNG', exact: true })
      .click();

    await page.getByRole('button', { name: /^1x$/i }).click();
    await page.getByRole('button', { name: /download/i }).click();
    let msg = await getExportMessage(page);
    await expect(msg).toBeVisible({ timeout: 15000 });
    await expect(msg).toHaveText(/exported.*PNG at 1x/i, { timeout: 15000 });

    await page.getByRole('button', { name: /^2x$/i }).click();
    await page.getByRole('button', { name: /download/i }).click();
    msg = await getExportMessage(page);
    await expect(msg).toBeVisible({ timeout: 15000 });
    await expect(msg).toHaveText(/exported.*PNG at 2x/i, { timeout: 15000 });
  });

  test('Export message shows for a newly created shape node', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'PNG', exact: true })
      .click();
    await page.getByRole('button', { name: /download/i }).click();

    const msg = await getExportMessage(page);
    await expect(msg).toBeVisible({ timeout: 15000 });
    await expect(msg).not.toHaveText(/failed/i);
  });
});
