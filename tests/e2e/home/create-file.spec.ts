import { expect, test } from '@playwright/test';

/**
 * Opening the New Design dialog: the dialog opens on the New button's click
 * and its native <dialog> backdrop covers the button, so the shared force-
 * click pattern (see tests/e2e/shared.ts) is used for the trigger.
 */
async function openNewDesign(page: import('@playwright/test').Page) {
  const btn = page.getByRole('button', { name: /^new$/i });
  await btn.waitFor({ state: 'visible', timeout: 45000 });
  await btn.click({ force: true, timeout: 15000 });
  const dialog = page.locator('dialog.varve-dialog[open]');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseStartMode(
  dialog: import('@playwright/test').Locator,
  label: string,
): Promise<void> {
  await dialog.locator('label.new-design__start-card').filter({ hasText: label }).click();
}

test.describe('New Design dialog', () => {
  test.beforeEach(async ({ page }) => {
    // The app's crash-loop detector counts unclean startups per context;
    // test page loads (including vite HMR reloads) can accumulate 3+ boots
    // and pop the Safe Mode screen over the dialog. Reset the counter so
    // tests exercise the dialog, not the crash recovery UI.
    await page.addInitScript(() => localStorage.removeItem('varve:crash-loop'));
    await page.goto('/');
    await page.waitForSelector('.varve-home', { timeout: 45000 });
  });

  test('clicking New opens the dialog with a name field', async ({ page }) => {
    const dialog = await openNewDesign(page);
    await expect(dialog.locator('.varve-dialog__title')).toContainText(/new design/i);
    // Document name field with a generated untitled default.
    const nameInput = dialog.getByLabel('Document name');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue(/Untitled \d+/);
  });

  test('empty document is the default starting point', async ({ page }) => {
    const dialog = await openNewDesign(page);
    // Empty-document radio is pre-selected; no preset catalogue required.
    await expect(dialog.getByRole('radio', { name: /empty document/i })).toBeChecked();
    await expect(dialog.getByText(/infinite canvas/i)).toBeVisible();
  });

  test('starting with a frame shows the searchable preset picker', async ({ page }) => {
    const dialog = await openNewDesign(page);

    await chooseStartMode(dialog, 'Start with a frame');
    await expect(dialog.getByPlaceholder('Search presets...')).toBeVisible();
    await expect(dialog.getByText('Instagram Post')).toBeVisible();
    await expect(dialog.getByText('A4')).toBeVisible();

    await dialog.getByPlaceholder('Search presets...').fill('Instagram');
    await expect(dialog.getByText('Instagram Post')).toBeVisible();
    await expect(dialog.getByText('A4')).not.toBeVisible();
  });

  test('templates starting point shows templates', async ({ page }) => {
    const dialog = await openNewDesign(page);

    await chooseStartMode(dialog, 'Template');
    await expect(dialog.locator('.templates-gallery')).toBeVisible();
  });

  test('creating an empty document navigates to the editor', async ({ page }) => {
    const dialog = await openNewDesign(page);

    await dialog.getByRole('button', { name: /create design/i }).click();
    await page.waitForSelector('.layers-panel', { timeout: 10000 });

    await expect(page.locator('.layers-panel')).toBeVisible();
    // The document is named after the untitled default.
    await expect(page.locator('.editor-menubar__doc-name-text')).toHaveText(/Untitled \d+/);
  });

  test('creating with a mobile frame creates a document with an initial frame', async ({
    page,
  }) => {
    const dialog = await openNewDesign(page);

    await chooseStartMode(dialog, 'Start with a frame');
    await dialog.getByPlaceholder('Search presets...').fill('iPhone 15 Pro');
    await dialog.locator('.preset-tile', { hasText: 'iPhone 15 Pro' }).first().click();
    await dialog.getByRole('button', { name: /create design/i }).click();

    await page.waitForSelector('.layers-panel', { timeout: 10000 });
    // The initial frame appears in the layers panel.
    await expect(page.locator('.layers-panel')).toContainText('iPhone 15 Pro');
  });

  test('cancel closes the dialog without creating', async ({ page }) => {
    const dialog = await openNewDesign(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.varve-home')).toBeVisible();
  });
});
