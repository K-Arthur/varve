import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function openLayersPanel(page: Page) {
  const launcher = page.getByRole('button', { name: 'Show layers panel', exact: true });
  if (await launcher.isVisible().catch(() => false)) await launcher.click();
  const header = page.locator('.layers-panel__header');
  await expect(header).toBeVisible({ timeout: 15_000 });
  return header;
}

async function openWorkspaceCustomization(page: Page) {
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('Customize Workspace');
  await palette.getByRole('option', { name: /^Customize Workspace$/ }).click();
  const dialog = page.getByRole('dialog', { name: /Customize Design workspace/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function dragHeader(page: Page, header: Locator) {
  const box = await header.boundingBox();
  if (!box) throw new Error('Layers header has no visible bounds');
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 12, box.y + box.height + 48, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.panel-detach-overlay')).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
}

test.describe('panel detach presentation', () => {
  test.setTimeout(240_000);

  test('desktop browser detachment remains available and responds to compact resizing', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'desktop');

    const detachButton = page.getByTestId('detach-layers');
    await expect(detachButton).toBeVisible();
    let header = await openLayersPanel(page);
    await header.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Detach Layers Panel' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 760, height: 768 });
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'compact');
    await expect(detachButton).toHaveCount(0);
    header = await openLayersPanel(page);
    await header.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Detach Layers Panel' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await dragHeader(page, header);

    // Removing window-detach affordances must not remove the supported
    // keyboard/touch route for changing panel location or ordering.
    const customize = await openWorkspaceCustomization(page);
    await expect(customize.getByRole('combobox', { name: 'Panel to move' })).toBeVisible();
    await expect(customize.getByRole('combobox', { name: 'Panel placement' })).toBeVisible();
    await expect(customize.getByRole('button', { name: 'Move panel', exact: true })).toBeVisible();
    await customize.getByRole('button', { name: 'Done' }).click();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'desktop');
    await expect(detachButton).toBeVisible();
    header = await openLayersPanel(page);
    await header.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Detach Layers Panel' })).toBeVisible();
  });
});

test.describe('touch-first tablet input', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('uses tablet affordances at a width that remains desktop-sized', async ({ page }) => {
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');
    await expect(page.getByTestId('detach-layers')).toHaveCount(0);
    const header = await openLayersPanel(page);
    await header.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Detach Layers Panel' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const box = await header.boundingBox();
    if (!box) throw new Error('Layers header has no visible bounds');
    await header.dispatchEvent('pointerdown', {
      pointerId: 31,
      pointerType: 'touch',
      button: 0,
      clientX: box.x + 12,
      clientY: box.y + box.height / 2,
    });
    await header.dispatchEvent('pointermove', {
      pointerId: 31,
      pointerType: 'touch',
      button: 0,
      clientX: box.x + 12,
      clientY: box.y + box.height + 48,
    });
    await header.dispatchEvent('pointerup', {
      pointerId: 31,
      pointerType: 'touch',
      button: 0,
      clientX: box.x + 12,
      clientY: box.y + box.height + 48,
    });
    await expect(page.locator('.panel-detach-overlay')).toHaveCount(0);
    expect(page.context().pages()).toHaveLength(1);

    const customize = await openWorkspaceCustomization(page);
    await expect(customize.getByRole('combobox', { name: 'Panel to move' })).toBeVisible();
    await expect(customize.getByRole('combobox', { name: 'Panel placement' })).toBeVisible();
    await expect(customize.getByRole('button', { name: 'Move panel', exact: true })).toBeVisible();
  });
});
