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

async function installIntoDialog(
  dialog: Awaited<ReturnType<typeof openPluginManager>>,
  file: string,
  name: string,
) {
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

async function installPackage(page: Page, file: string, name: string) {
  const dialog = await openPluginManager(page);
  return installIntoDialog(dialog, file, name);
}

/** Creates a committed text layer at canvas-relative coordinates. */
async function createTextAt(page: Page, x: number, y: number, text: string): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('editor canvas has no bounds');
  const editor = page.getByRole('textbox', { name: /editing text/i });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('t');
    await page.mouse.click(box.x + x, box.y + y);
    const appeared = await editor
      .waitFor({ state: 'visible', timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      await page.keyboard.insertText(text);
      await page.keyboard.press('Escape');
      await editor.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(120);
      return;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  throw new Error(`text editor did not appear at ${x},${y}`);
}

/** After reload the editor may restore the document or return to Home. */
async function reopenEditorAfterReload(page: Page): Promise<void> {
  if (
    !(await page
      .locator('.editor-shell')
      .isVisible({ timeout: 10000 })
      .catch(() => false))
  ) {
    await navigateToEditor(page);
    return;
  }
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
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

  test('analyzes a mixed vector, ellipse, and text selection', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    // beforeEach left one selected rectangle; add two more node kinds.
    await page.keyboard.press('o');
    await dragOnCanvas(page, 380, 150, 560, 320);
    await createTextAt(page, 80, 430, 'Mixed label');
    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(3);
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    await rows.nth(2).click({ modifiers: ['Control'] });
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(3);

    const { card } = await installPackage(page, analysisPackage, 'Selection Style Readiness');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByText(/Selection style audit: 3 layers/)).toBeVisible({
      timeout: 20000,
    });
    // Vector shapes share the 'shape' kind in the guest snapshot; the mixed
    // selection itself is proven by the layers tree and the font lines.
    await expect(card.getByText(/Selected objects by kind: shape 2, text 1/)).toBeVisible();
    await expect(rows.filter({ hasText: 'Ellipse' })).toHaveCount(1);
    await expect(card.getByText('Font family: no text layers selected.')).toHaveCount(0);
    await expect(card.getByText(/Font family:/).first()).toBeVisible();
    await expect(card.getByText(/Locked layers: 0/)).toBeVisible();
    // The same analysis reaches the host-rendered Inspector contribution.
    await card.getByRole('button', { name: 'Run', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('plugin-mixed-analysis.png'),
      fullPage: true,
    });
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    const inspectorContribution = page.locator('.insp-plugin-sections');
    await expect(inspectorContribution).toContainText('Selection readiness');
    await expect(inspectorContribution).toContainText('Selection style audit: 3 layers');
    await expect(page.getByRole('treeitem')).toHaveCount(3);
  });

  test('hides a contributed panel, keeps the preference across reload, and shows it again', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const { dialog, card } = await installPackage(
      page,
      analysisPackage,
      'Selection Style Readiness',
    );
    const inspectorContribution = page.locator('.insp-plugin-sections');
    await expect(inspectorContribution).toContainText('Selection readiness');

    await card.getByRole('button', { name: 'Hide Selection readiness Inspector panel' }).click();
    await expect(
      card.getByRole('button', { name: 'Show Selection readiness Inspector panel' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(inspectorContribution).toHaveCount(0);

    await page.reload({ timeout: 120000 });
    await reopenEditorAfterReload(page);
    const reopened = await openPluginManager(page);
    const reopenedCard = reopened
      .locator('.plugin-manager__card')
      .filter({ hasText: 'Selection Style Readiness' });
    await expect(
      reopenedCard.getByRole('button', { name: 'Show Selection readiness Inspector panel' }),
    ).toBeVisible();
    await reopenedCard
      .getByRole('button', { name: 'Show Selection readiness Inspector panel' })
      .click();
    await expect(
      reopenedCard.getByRole('button', { name: 'Hide Selection readiness Inspector panel' }),
    ).toBeVisible();
    await reopened.getByRole('button', { name: 'Close dialog' }).click();

    // With a selection present again, the shown panel renders its section.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 320, 280);
    await page.keyboard.press('Control+a');
    await expect(inspectorContribution).toContainText('Selection readiness');
  });

  test('runs two installed plugins without cross-talk', async ({ page }) => {
    test.setTimeout(120000);
    const { dialog, card: auditCard } = await installPackage(
      page,
      analysisPackage,
      'Selection Style Readiness',
    );
    const { card: loopCard } = await installIntoDialog(
      dialog,
      loopPackage,
      'Controlled Loop Fixture',
    );

    await auditCard.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(auditCard.getByText(/Selection style audit/)).toBeVisible({ timeout: 20000 });

    // A second plugin can occupy the other job slot while the first result stays.
    await loopCard.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(loopCard).toContainText('Running');
    await expect(auditCard.getByText(/Selection style audit/)).toBeVisible();
    await expect(auditCard).toContainText('Ready');

    await loopCard.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(loopCard).toContainText('Ready');
    // Stopping one plugin must not clear the other plugin's committed result.
    await expect(auditCard.getByText(/Selection style audit/)).toBeVisible();
    await expect(auditCard).toContainText('Ready');
  });

  test('renames only unlocked layers and keeps undo/redo coherent', async ({ page }) => {
    test.setTimeout(120000);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 420, 160, 560, 300);
    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(2);

    // The freshly drawn layer is selected; lock the other one so exactly one
    // of the two selected layers is off-limits to the rename plugin.
    let lockIndex = -1;
    for (let index = 0; index < 2; index++) {
      if ((await rows.nth(index).getAttribute('aria-selected')) !== 'true') {
        lockIndex = index;
        break;
      }
    }
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    const unlockedIndex = lockIndex === 0 ? 1 : 0;
    await rows.nth(lockIndex).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Lock', exact: true }).click();
    await rows.nth(unlockedIndex).click();
    await rows.nth(lockIndex).click({ modifiers: ['Control'] });
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(2);

    const { dialog, card } = await installPackage(page, renamePackage, 'Number Selected Layers');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Preview' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Apply 1 rename' })).toBeVisible();
    await card.getByRole('button', { name: 'Apply 1 rename' }).click();
    await expect(rows.filter({ hasText: /01 ·/ })).toHaveCount(1);
    await expect(rows.nth(lockIndex)).not.toContainText('·');
    await expect(rows.nth(unlockedIndex)).toContainText('01 ·');

    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.keyboard.press('Control+z');
    await expect(rows.filter({ hasText: /01 ·/ })).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(rows.filter({ hasText: /01 ·/ })).toHaveCount(1);
    await expect(rows.nth(lockIndex)).not.toContainText('·');
  });
});
