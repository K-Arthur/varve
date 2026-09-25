import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { dragOnCanvas, navigateToEditor } from '../shared';

const analysisPackage = path.join(
  process.cwd(),
  'tests/e2e/plugins/fixtures/style-audit.varveplugin',
);
const renamePackage = path.join(
  process.cwd(),
  'tests/e2e/plugins/fixtures/batch-rename.varveplugin',
);
const loopPackage = path.join(process.cwd(), 'tests/e2e/plugins/fixtures/fault-loop.varveplugin');
const analysisUpdatePackage = path.join(
  process.cwd(),
  'tests/e2e/plugins/fixtures/style-audit-update.varveplugin',
);

async function openPluginManager(page: Page) {
  await openMenu(page, 'File');
  await page.getByRole('menuitem', { name: /Manage Plugins/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tab', { name: 'Plugins' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  return dialog;
}

async function installPackage(page: Page, file: string, name: string) {
  const dialog = await openPluginManager(page);
  await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(file);
  const review = dialog.getByRole('heading', { name: 'Review installation' });
  await expect(review).toBeVisible();
  const section = dialog.locator('.plugin-manager__review');
  await expect(section).toContainText(name);
  for (const checkbox of await section.getByRole('checkbox').all()) await checkbox.check();
  await section.getByRole('button', { name: 'Install and enable' }).click();
  const card = dialog.locator('.plugin-manager__card').filter({ hasText: name });
  await expect(card).toContainText('Ready');
  return { dialog, card };
}

test.describe('local application plugins', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1);
  });

  test('reviews, runs, disables, and reopens a read-only analysis package', async ({
    page,
  }, testInfo) => {
    const { dialog, card } = await installPackage(
      page,
      analysisPackage,
      'Selection Style Readiness',
    );
    await page.screenshot({ path: testInfo.outputPath('plugin-installed.png'), fullPage: true });
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByText(/Opacity:/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    const inspectorContribution = page.locator('.insp-plugin-sections');
    await expect(inspectorContribution).toContainText('Selection readiness');
    await inspectorContribution.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('plugin-inspector.png'), fullPage: true });
    await openPluginManager(page);
    await card.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(card).toContainText('Disabled');
    await expect(card.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('plugin-disabled.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await page.reload();
    if (
      !(await page
        .locator('.editor-shell')
        .isVisible({ timeout: 10000 })
        .catch(() => false))
    ) {
      await navigateToEditor(page);
    }
    const reopened = await openPluginManager(page);
    await expect(
      reopened.locator('.plugin-manager__card').filter({ hasText: 'Selection Style Readiness' }),
    ).toContainText('Disabled');
  });

  test('previews and applies an undoable rename, then removes its package', async ({
    page,
  }, testInfo) => {
    const { dialog, card } = await installPackage(page, renamePackage, 'Number Selected Layers');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Preview' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Apply 1 rename' })).toBeVisible();
    await card.getByRole('button', { name: 'Apply 1 rename' }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('plugin-rename-preview.png'),
      fullPage: true,
    });
    await card.getByRole('button', { name: 'Apply 1 rename' }).click();
    await expect(page.getByRole('treeitem').first()).toContainText('01 ·');
    await card.getByRole('button', { name: 'Remove', exact: true }).click();
    await card.getByRole('button', { name: 'Remove plugin' }).click();
    await expect(dialog.locator('.plugin-manager__card')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem').first()).toContainText('Rectangle');
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByRole('treeitem').first()).toContainText('01 ·');

    // The browser fallback writes the portable document to the Home mirror.
    // Reopen it with no plugin installed: the canonical layer name must survive.
    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    });
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.reload({ timeout: 120000 });
    const savedDocument = page.locator('[role="gridcell"]').first();
    await savedDocument.waitFor({ state: 'visible', timeout: 30000 });
    await savedDocument.dblclick();
    await page.locator('.layers-panel').waitFor({ timeout: 60000 });
    await expect(page.getByRole('treeitem').first()).toContainText('01 ·');
    const reopened = await openPluginManager(page);
    await expect(reopened.locator('.plugin-manager__card')).toHaveCount(0);
  });

  test('keeps the permission review readable in a narrow dark window', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const dialog = await openPluginManager(page);
    await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Theme' }).click();
    await page
      .getByRole('listbox', { name: 'Theme' })
      .getByRole('option', { name: 'Dark' })
      .click();
    await dialog.getByRole('tab', { name: 'Plugins', exact: true }).click();
    await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(renamePackage);
    const review = dialog.locator('.plugin-manager__review');
    await expect(review).toContainText('Read the current selection');
    await expect(review).toContainText('Change the open document');
    await review.getByRole('button', { name: 'Install and enable' }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('plugin-review-dark-1024.png'),
      fullPage: true,
    });
    const overflow = await dialog
      .locator('.settings-dialog__content')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await review.getByRole('button', { name: 'Cancel' }).click();
    await expect(review).toHaveCount(0);
  });

  test('stops a noncooperative guest and quarantines a timed-out retry', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const { dialog, card } = await installPackage(page, loopPackage, 'Controlled Loop Fixture');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(card).toContainText('Ready');
    await expect(dialog.getByText('Stop Controlled Loop Fixture complete.')).toBeVisible();
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card).toContainText('Failed', { timeout: 15000 });
    await expect(card).toContainText('time limit');
    await expect(card.getByRole('button', { name: 'Retry' })).toBeVisible();
    await card.getByRole('button', { name: 'Retry' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('plugin-failed.png'), fullPage: true });
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('shows new access on update and restores the last working package', async ({ page }) => {
    const { dialog, card } = await installPackage(
      page,
      analysisPackage,
      'Selection Style Readiness',
    );
    await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(analysisUpdatePackage);
    const review = dialog.locator('.plugin-manager__review');
    await expect(review.getByRole('heading', { name: 'Review update' })).toBeVisible();
    await expect(review).toContainText('New access requested: Change the open document');
    await expect(
      review.getByRole('checkbox', { name: /Change the open document/ }),
    ).not.toBeChecked();
    await review.getByRole('button', { name: 'Update and enable' }).click();
    await expect(card).toContainText('v1.1.0');
    await expect(card.getByRole('button', { name: 'Restore v1.0.0' })).toBeVisible();
    await card.getByRole('button', { name: 'Restore v1.0.0' }).click();
    await expect(card).toContainText('v1.0.0');
    await expect(card.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  });

  test('revokes selection access while a guest is running', async ({ page }) => {
    const { card } = await installPackage(page, loopPackage, 'Controlled Loop Fixture');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Access', exact: true }).click();
    const access = card.getByRole('region', { name: /Access for Controlled Loop Fixture/ });
    await access.getByRole('checkbox', { name: /Read the current selection/ }).uncheck();
    await access.getByRole('button', { name: 'Save access' }).click();
    await expect(card).toContainText('Needs permission');
    await expect(card.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
    await page.waitForTimeout(5500);
    await expect(card).not.toContainText('Failed');
  });
});
