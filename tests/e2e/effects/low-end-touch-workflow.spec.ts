import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

test.describe('Effect Studio portrait touch workflow', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });

  test('keeps preview, cancel, apply, and reorder actions touch-sized and reachable', async ({
    page,
  }, testInfo) => {
    await navigateToCleanEditor(page);
    await expect
      .poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches))
      .toBe(true);

    await page.keyboard.press('r');
    await dragOnCanvas(page, 140, 140, 330, 290);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('open-effect-studio').click();

    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    const search = studio.getByRole('searchbox', { name: 'Search treatments' });
    await search.fill('reticulation');
    await studio.getByRole('button', { name: 'Adjust Reticulation recipe' }).click();

    const numberField = studio.getByRole('spinbutton', {
      name: /Reticulation Cluster density value/,
    });
    await expect(numberField).toBeVisible();
    await assertTouchTarget(numberField);

    const preview = studio.getByRole('button', { name: 'Preview', exact: true });
    await expect(preview).toBeVisible();
    await assertTouchTarget(preview);
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toBeInViewport();
    await preview.click();

    const cancel = studio.getByRole('button', { name: 'Cancel preview' });
    await expect(cancel).toBeVisible({ timeout: 30_000 });
    await assertTouchTarget(cancel);
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath('effect-studio-touch-portrait.png'),
      fullPage: false,
      animations: 'disabled',
    });
    await cancel.click();

    await search.fill('reticulation');
    const apply = studio.getByRole('button', { name: 'Apply Reticulation' });
    await expect(apply).toBeVisible();
    await assertTouchTarget(apply);
    await apply.scrollIntoViewIfNeeded();
    await expect(apply).toBeInViewport();
    await apply.click();

    const stack = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(stack).toContainText('Reticulation');
    const reorder = studio.getByRole('button', { name: 'Move Reticulation down' });
    await expect(reorder).toBeVisible();
    await assertTouchTarget(reorder);
    await reorder.scrollIntoViewIfNeeded();
    await expect(reorder).toBeInViewport();

    await studio.getByRole('button', { name: 'Close dialog' }).click();
    const documentName = page.locator('.editor-menubar__doc-name-text');
    await documentName.click();
    const documentNameInput = page.getByRole('textbox', { name: 'Document name', exact: true });
    await documentNameInput.fill('Low-end touch fixture');
    await documentNameInput.press('Enter');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 60_000 });

    await page.reload({ timeout: 120_000, waitUntil: 'commit' });
    const savedCard = page.getByRole('gridcell', { name: /Low-end touch fixture/ });
    await expect(savedCard).toBeVisible({ timeout: 30_000 });
    await savedCard.dblclick();
    await page.locator('.layers-panel').waitFor({ timeout: 60_000 });
    await page.locator('.layers-panel__tree [role="treeitem"]').first().click();
    await page.getByTestId('open-effect-studio').click();
    const reopenedStudio = page.getByTestId('effect-studio-dialog');
    await expect(reopenedStudio).toContainText('Reticulation');
    await page.screenshot({
      path: testInfo.outputPath('effect-studio-touch-reopened-screen.png'),
      fullPage: false,
      animations: 'disabled',
    });
    await reopenedStudio.getByRole('button', { name: 'Close dialog' }).click();

    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
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
    await page.getByRole('radio', { name: 'PNG', exact: true }).first().click();
    const pendingDownload = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const download = await pendingDownload;
    const exportPath = testInfo.outputPath('effect-studio-touch-reopened.png');
    await download.saveAs(exportPath);
    const exported = await readFile(exportPath);
    expect(exported.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(exported.byteLength).toBeGreaterThan(100);
  });
});

async function assertTouchTarget(locator: import('@playwright/test').Locator) {
  const size = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(size.width, 'touch target width').toBeGreaterThanOrEqual(44);
  expect(size.height, 'touch target height').toBeGreaterThanOrEqual(44);
}
