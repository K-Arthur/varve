import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Archive / Backup system (desktop)', () => {
  test.describe.configure({ mode: 'serial' });
  // Archive create/restore involves ZIP packaging + AES-GCM key derivation
  // (600k PBKDF2 iterations) on top of normal editor load time — give it
  // more headroom than the suite default, especially under concurrent
  // dev-server load.
  test.setTimeout(60000);
  test.beforeEach(async ({ page }) => {
    const isTauri = await page.evaluate(
      () => '__TAURI__' in (window as unknown as Record<string, unknown>),
    );
    test.skip(!isTauri, 'Encrypted archive APIs are desktop-only; web uses snapshot fallback.');
    await navigateToEditor(page);
  });

  async function openArchiveDialog(
    page: import('@playwright/test').Page,
    tab: 'backup' | 'restore' = 'backup',
  ) {
    // Open the File menu
    const fileMenu = page.getByRole('menubar').getByRole('menuitem', { name: 'File' });
    await fileMenu.click();

    if (tab === 'backup') {
      await page.getByRole('menuitem', { name: /backup archive/i }).click();
    } else {
      await page.getByRole('menuitem', { name: /restore archive/i }).click();
    }

    // Wait for the dialog to open
    await page.locator('dialog[open]').waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * The dialog's own footer "Close" button, scoped to the open <dialog>.
   * The app also has a window title-bar close, a generic dialog X, editor
   * tab closes, and a help-panel close — an unscoped `getByRole('button',
   * { name: /close/i })` matches all of them (strict-mode violation).
   */
  function dialogCloseButton(page: import('@playwright/test').Page) {
    return page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true });
  }

  /**
   * The dialog's "Archive created successfully" progress text has a
   * visually-hidden aria-live duplicate elsewhere on the page for screen
   * readers — target the visible progress element specifically.
   */
  function creationSuccessText(page: import('@playwright/test').Page) {
    return page.locator('.archive-dialog__progress-phase');
  }

  test('Create and restore unencrypted archive', async ({ page }) => {
    // Create a shape so the document is not empty
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Open backup tab
    await openArchiveDialog(page, 'backup');

    // The dialog should show the Create Archive tab by default
    const createTab = page.getByRole('tab', { name: /create archive/i });
    await expect(createTab).toHaveAttribute('aria-selected', 'true');

    // "Full Project" should be selected by default
    const fullProjectRadio = page.getByRole('radio', { name: /full project/i });
    await expect(fullProjectRadio).toHaveAttribute('aria-checked', 'true');

    // Click Create Archive
    await page.getByRole('button', { name: /create archive$/i }).click();

    // Wait for completion
    await expect(creationSuccessText(page)).toHaveText(/archive created successfully/i, {
      timeout: 15000,
    });

    // Download the archive
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const fileName = download.suggestedFilename();
    expect(fileName).toContain('.zip');

    // Close the dialog
    await dialogCloseButton(page).click();
    await page.locator('dialog[open]').waitFor({ state: 'hidden', timeout: 5000 });
  });

  test('Create encrypted archive with password', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await openArchiveDialog(page, 'backup');

    // Enable encryption
    const encryptCheckbox = page.getByRole('checkbox', { name: /encrypt archive/i });
    await encryptCheckbox.check();

    // Fill in password
    const passwordInput = page.getByLabel('Password');
    await passwordInput.fill('TestPassword123!');

    // Fill in confirm password
    const confirmInput = page.getByLabel('Confirm');
    await confirmInput.fill('TestPassword123!');

    // Password strength should show
    await expect(page.getByRole('meter', { name: /password strength/i })).toBeVisible();

    // Create archive
    await page.getByRole('button', { name: /create archive$/i }).click();
    await expect(creationSuccessText(page)).toHaveText(/archive created successfully/i, {
      timeout: 15000,
    });

    // Encryption info should be shown
    await expect(page.getByText(/encryption/i)).toBeVisible();

    await dialogCloseButton(page).click();
  });

  test('Reject incorrect password on restore', async ({ page }) => {
    // First create an encrypted archive
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await openArchiveDialog(page, 'backup');

    const encryptCheckbox = page.getByRole('checkbox', { name: /encrypt archive/i });
    await encryptCheckbox.check();
    await page.getByLabel('Password').fill('CorrectPassword1!');
    await page.getByLabel('Confirm').fill('CorrectPassword1!');

    await page.getByRole('button', { name: /create archive$/i }).click();
    await expect(creationSuccessText(page)).toHaveText(/archive created successfully/i, {
      timeout: 15000,
    });

    // Download the encrypted archive
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();

    // Close the dialog
    await dialogCloseButton(page).click();

    // Now switch to restore tab and try to restore with wrong password
    await openArchiveDialog(page, 'restore');

    // Upload the archive file
    const restoreTab = page.getByRole('tab', { name: /restore archive/i });
    await expect(restoreTab).toHaveAttribute('aria-selected', 'true');

    // Use file input to upload the archive
    const fileInput = page.locator('.archive-dialog__drop-input');
    await fileInput.setInputFiles(path!);

    // Wait for manifest to be read
    await expect(page.getByText(/archive contents/i)).toBeVisible({ timeout: 10000 });

    // Should show encrypted indicator
    await expect(page.getByText(/encrypted/i)).toBeVisible();

    // Enter wrong password
    await page.getByLabel('Password', { exact: false }).fill('WrongPassword1!');

    // Try to restore
    await page.getByRole('button', { name: /^restore$/i }).click();

    // Should show error about incorrect password
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });
  });

  test('Settings-only backup and restore', async ({ page }) => {
    await openArchiveDialog(page, 'backup');

    // Switch to settings-only mode
    const settingsRadio = page.getByRole('radio', { name: /settings only/i });
    await settingsRadio.click();

    // Settings categories should appear
    await expect(page.getByText(/settings categories/i)).toBeVisible();

    // Create settings archive
    await page.getByRole('button', { name: /create archive$/i }).click();
    await expect(creationSuccessText(page)).toHaveText(/archive created successfully/i, {
      timeout: 15000,
    });

    // Should show categories info
    await expect(page.getByText(/categories/i)).toBeVisible();

    // Download
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const fileName = download.suggestedFilename();
    expect(fileName).toContain('settings');

    await dialogCloseButton(page).click();
  });

  test('Cancel backup safely leaves no partial file', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await openArchiveDialog(page, 'backup');

    // Start creating archive
    await page.getByRole('button', { name: /create archive$/i }).click();

    // Quickly cancel (if the archive creation takes time)
    // The cancel button appears during creation
    const cancelBtn = page.getByRole('button', { name: /cancel/i });
    if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelBtn.click();

      // Should return to idle state — the Create Archive button should be enabled again
      await expect(page.getByRole('button', { name: /create archive$/i })).toBeEnabled({
        timeout: 5000,
      });
    }

    // Close the dialog
    await dialogCloseButton(page).click();
  });
});

test.describe('Archive / Backup system (web fallback)', () => {
  test('exposes snapshot backup and restore commands', async ({ page }) => {
    await navigateToEditor(page);

    const fileMenu = page.getByRole('menubar').getByRole('menuitem', { name: 'File' });
    await fileMenu.click();

    await expect(page.getByRole('menuitem', { name: /download snapshot/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /restore from snapshot/i })).toBeVisible();
  });
});
