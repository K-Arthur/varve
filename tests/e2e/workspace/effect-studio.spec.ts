/**
 * Curated Effect Studio dialog.
 *
 * Covers the streamlined primary inspector, controlled in-app dialog launch,
 * and direct numeric treatment tuning against the live editor selection.
 */

import { expect, type Page, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

async function createSelectedRectangle(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('r');
  await dragOnCanvas(page, 140, 140, 360, 300);
  await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('open-effect-studio')).toBeVisible({ timeout: 30_000 });
}

async function createSelectedVectorPath(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not laid out for the Pen tool');

  await page.keyboard.press('p');
  await page.mouse.click(box.x + 150, box.y + 150);
  await page.waitForTimeout(350);
  await page.mouse.click(box.x + 310, box.y + 170);
  await page.waitForTimeout(350);
  await page.mouse.click(box.x + 240, box.y + 300);
  await page.keyboard.press('Enter');

  const pathRow = page.getByRole('treeitem').first();
  await expect(pathRow).toContainText(/path|vector shape/i, { timeout: 30_000 });
  await pathRow.click();
  await expect(page.getByTestId('open-effect-studio')).toBeVisible({ timeout: 30_000 });
}

async function switchToPhotoWorkspace(page: Page) {
  await page.keyboard.press('Control+Shift+4');
  await expect(page.getByRole('radio', { name: /^Photo workspace$/ })).toBeChecked();
}

test.describe('Effect Studio dialog', () => {
  test('keeps the inspector compact and tunes a treatment in the primary editor', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);

    const launcher = page.getByTestId('open-effect-studio');
    const appearance = page.locator('.insp-disclosure').filter({ has: launcher });
    await expect(appearance).toHaveScreenshot('effect-studio-launcher.png', {
      maxDiffPixels: 200,
    });
    await expect(page.locator('[data-effect-studio]')).toHaveCount(0);

    const initialPageCount = page.context().pages().length;
    await launcher.click();
    const studio = page.getByTestId('effect-studio-dialog');

    await expect(studio).toBeVisible({ timeout: 30_000 });
    expect(page.context().pages()).toHaveLength(initialPageCount);
    await expect(studio).toHaveScreenshot('effect-studio-dialog.png', { maxDiffPixels: 300 });

    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Adjust Reticulation recipe' }).click();

    const precision = studio.getByRole('spinbutton', {
      name: /Reticulation Cluster density value/,
    });
    await precision.fill('42');
    await precision.press('Enter');
    await expect(studio.getByRole('slider', { name: 'Reticulation Cluster density' })).toHaveValue(
      '42',
    );

    await studio.getByRole('button', { name: 'Preview', exact: true }).click();
    const original = studio.getByAltText('Original selected object without Object Filters');
    const effects = studio.getByAltText('Selected object with its Object Filters');
    await expect(original).toHaveAttribute('src', /^data:image\//);
    await expect(effects).toHaveAttribute('src', /^data:image\//);
    await expect(studio.getByTestId('effect-studio-preview-stage')).toHaveAttribute(
      'data-view',
      'compare',
    );
    await expect(studio.getByRole('button', { name: 'Before this edit' })).toBeEnabled();
    await expect(studio.getByRole('button', { name: 'Current candidate' })).toBeEnabled();
    expect(await original.getAttribute('src')).not.toBe(await effects.getAttribute('src'));
    await expect(studio.getByTestId('effect-studio-preview-stage')).toHaveScreenshot(
      'effect-studio-before-after.png',
      { maxDiffPixels: 200 },
    );
    const split = studio.getByRole('slider', { name: 'Before and after split' });
    await split.focus();
    await split.press('ArrowRight');
    await expect(studio.getByText('51% before')).toBeVisible();

    await studio.getByRole('button', { name: 'Keep treatment' }).click();
    await expect(studio.getByRole('button', { name: 'Reset controls' })).toBeVisible();
    await precision.fill('58');
    await precision.press('Enter');
    await expect(precision).toHaveValue('58');
    const appliedReticulationStack = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(appliedReticulationStack).toContainText('Reticulation');
    await expect(appliedReticulationStack).toContainText('2 derived effects');

    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('halftone pattern');
    await studio.getByRole('button', { name: 'Apply Halftone Pattern' }).click();
    const appliedTreatments = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(appliedTreatments.locator('li')).toHaveCount(2);
    await studio.getByRole('button', { name: 'Tune Halftone Pattern' }).click();
    // Opening Tune must be read-only. This guards the regression where the
    // applied Object Filter stack disappeared before a control was changed.
    await expect(appliedTreatments).toContainText('Reticulation');
    await expect(appliedTreatments).toContainText('Halftone Pattern');
    await expect(appliedTreatments.locator('li')).toHaveCount(2);
    const dotSize = studio.getByRole('slider', { name: 'Halftone Pattern Dot size' });
    await dotSize.focus();
    await dotSize.press('ArrowRight');
    await expect(dotSize).toHaveValue('3');
    await expect(appliedReticulationStack).toContainText('Halftone Pattern');
    await expect(appliedReticulationStack.locator('li')).toHaveCount(2);
    await studio.getByRole('button', { name: 'Move Halftone Pattern up' }).click();
    const namedStack = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(namedStack.locator('li').first()).toContainText('Halftone Pattern');

    await studio.getByRole('button', { name: 'Close dialog' }).click();
    await expect(studio).not.toBeVisible();
  });

  test('keeps primary Effect Studio actions legible in dark mode', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);
    await page.evaluate(() => {
      localStorage.setItem('varve-theme', 'dark');
      document.documentElement.dataset.theme = 'dark';
    });
    await page.waitForTimeout(150);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByRole('searchbox', { name: 'Search treatments' })).toBeFocused();
    await expect(studio.locator('.effect-studio__inspector')).toHaveCSS('position', 'sticky');
    const apply = studio.getByRole('button', { name: /Apply / }).first();
    await expect(apply).toBeVisible();
    const colors = await apply.evaluate((button) => {
      const style = getComputedStyle(button);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(colors.background).not.toBe(colors.color);
    await expect(studio).toHaveScreenshot('effect-studio-dialog-dark.png', { maxDiffPixels: 350 });
  });

  test('renders a real effect comparison for a Pen vector path', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Adjust Reticulation recipe' }).click();
    await studio.getByRole('button', { name: 'Preview', exact: true }).click();

    const original = studio.getByAltText('Original selected object without Object Filters');
    const effects = studio.getByAltText('Selected object with its Object Filters');
    await expect(original).toHaveAttribute('src', /^data:image\//);
    await expect(effects).toHaveAttribute('src', /^data:image\//);
    expect(await original.getAttribute('src')).not.toBe(await effects.getAttribute('src'));
    await expect(studio.getByTestId('effect-studio-preview-stage')).toHaveScreenshot(
      'effect-studio-vector-path-before-after.png',
      { maxDiffPixels: 200 },
    );
  });

  test('applies a curated treatment to a Pen vector path without flattening it', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Apply Reticulation' }).click();

    const applied = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(applied).toContainText('Reticulation');
    await expect(applied).toContainText('2 derived effects');
    await expect(studio.getByText(/raster \+ vector/i)).toBeVisible();

    await page.waitForTimeout(250);
    const after = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
    expect(after).not.toBe(before);

    await studio.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('treeitem').first()).toContainText(/path|vector shape/i);
    await expect(page.getByTestId('open-effect-studio')).toBeVisible();
  });

  test('stacks consecutive applied treatments', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });

    const search = studio.getByRole('searchbox', { name: 'Search treatments' });
    await search.fill('reticulation');
    await studio.getByRole('button', { name: 'Apply Reticulation' }).click();
    const applied = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(applied.locator('li')).toHaveCount(1);
    await expect(applied).toContainText('Reticulation');

    await search.fill('halftone pattern');
    await studio.getByRole('button', { name: 'Apply Halftone Pattern' }).click();
    await expect(applied.locator('li')).toHaveCount(2);
    await expect(applied).toContainText('Reticulation');
    await expect(applied).toContainText('Halftone Pattern');
  });

  test('cancels a draft without removing the accepted stack and makes duplication explicit', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    const search = studio.getByRole('searchbox', { name: 'Search treatments' });
    const applied = studio.getByRole('list', { name: 'Applied treatments' });

    await search.fill('reticulation');
    await studio.getByRole('button', { name: 'Apply Reticulation' }).click();
    await expect(applied.locator('li')).toHaveCount(1);

    await search.fill('halftone pattern');
    await studio.getByRole('button', { name: 'Preview Halftone Pattern' }).click();
    await studio.getByRole('button', { name: 'Cancel preview' }).click();
    await expect(applied.locator('li')).toHaveCount(1);
    await expect(applied).toContainText('Reticulation');
    await expect(applied).not.toContainText('Halftone Pattern');

    await search.fill('reticulation');
    await expect(studio.getByRole('button', { name: 'Add another Reticulation' })).toBeVisible();
    await studio.getByRole('button', { name: 'Add another Reticulation' }).click();
    await expect(applied.locator('li')).toHaveCount(2);
  });

  test('keeps a previewed treatment when applying a different recipe', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    const search = studio.getByRole('searchbox', { name: 'Search treatments' });

    await search.fill('reticulation');
    await studio.getByRole('button', { name: 'Preview Reticulation' }).click();
    await expect(studio.getByRole('button', { name: 'Keep treatment' })).toBeVisible();

    await search.fill('halftone pattern');
    await studio.getByRole('button', { name: 'Apply Halftone Pattern' }).click();
    const applied = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(applied.locator('li')).toHaveCount(2);
    await expect(applied).toContainText('Reticulation');
    await expect(applied).toContainText('Halftone Pattern');
  });

  test('keeps the vector Adjustments surface compact while exposing the full Studio modal', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await switchToPhotoWorkspace(page);
    await createSelectedVectorPath(page);

    const initialStudio = page.getByTestId('effect-studio-dialog');
    await page.getByTestId('open-effect-studio').click();
    await expect(initialStudio).toBeVisible({ timeout: 30_000 });
    await initialStudio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await initialStudio.getByRole('button', { name: 'Apply Reticulation' }).click();
    await expect(initialStudio.getByRole('list', { name: 'Applied treatments' })).toContainText(
      'Reticulation',
    );
    await initialStudio.getByRole('button', { name: 'Close dialog' }).click();

    const adjustmentsTab = page
      .locator('[role="tablist"] [role="tab"]')
      .filter({ hasText: /^Adjustments$/i });
    await expect(adjustmentsTab).toBeVisible();
    await adjustmentsTab.click();
    await expect(page.getByText('Image Tuning is raster-only')).not.toBeVisible();
    await expect(page.getByText('Curated editable treatments')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Effect Studio' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Object Filters', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Layer Effects', exact: true })).toBeVisible();
    await expect(page.getByText('Applied treatments: Reticulation')).toBeVisible();
    await expect(page.locator('[data-panel="inspector"]')).toHaveScreenshot(
      'effect-studio-vector-adjustments-compact.png',
      { maxDiffPixels: 300 },
    );
    await page.getByRole('button', { name: 'Object Filters', exact: true }).click();
    await expect(page.getByText('Advanced stack editor')).toBeVisible();
    await expect(page.getByText('Raw filters, order, opacity, and blending')).toBeVisible();
    await page.getByRole('button', { name: 'Open Effect Studio' }).click();
    const reopenedStudio = page.getByTestId('effect-studio-dialog');
    await expect(reopenedStudio).toBeVisible();
    await expect(reopenedStudio.getByRole('list', { name: 'Applied treatments' })).toContainText(
      'Reticulation',
    );
  });
});
