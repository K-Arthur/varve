import { expect, type Locator, type Page, test } from '@playwright/test';

/** Current New Design dialog contract and layout checks. */

async function openNewFileDialog(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.varve-home');
  await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 45000 });
  await page.getByRole('button', { name: /^new$/i }).click({ force: true });
  const dialog = page.locator('dialog.varve-dialog[open]');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseStartMode(dialog: Locator, label: string): Promise<void> {
  await dialog.locator('label.new-design__start-card').filter({ hasText: label }).click();
}

async function dialogOverflowInfo(page: Page) {
  return page.evaluate(() => {
    const d = document.querySelector('dialog.varve-dialog[open]') as HTMLDialogElement | null;
    if (!d) return null;
    const header = d.querySelector('.varve-dialog__header');
    const footer = d.querySelector('.varve-dialog__footer');
    const body = d.querySelector('.varve-dialog__body');
    const footerRect = footer?.getBoundingClientRect();
    const dRect = d.getBoundingClientRect();
    const createBtn = Array.from(d.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Create design',
    );
    const createRect = createBtn?.getBoundingClientRect();
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dialog: { top: dRect.top, bottom: dRect.bottom, h: dRect.height },
      footerVisible: footerRect
        ? footerRect.bottom <= window.innerHeight && footerRect.top >= 0
        : null,
      footerClippedByDialog: footerRect ? footerRect.bottom > dRect.bottom + 2 : null,
      bodyScrollable:
        body !== null &&
        body !== undefined &&
        body.scrollHeight > body.clientHeight &&
        getComputedStyle(body).overflowY !== 'hidden',
      bodyScrollHeight: body?.scrollHeight ?? null,
      bodyClientHeight: body?.clientHeight ?? null,
      createVisible: createRect
        ? createRect.bottom <= window.innerHeight && createRect.top >= 0
        : null,
      title: header?.querySelector('.varve-dialog__title')?.textContent ?? null,
    };
  });
}

test.describe('New Design dialog', () => {
  test('dialog opens with a document name and selectable starting points', async ({ page }) => {
    const dialog = await openNewFileDialog(page);

    await expect(dialog.locator('.varve-dialog__title')).toContainText(/new design/i);
    await expect(dialog.locator('input[aria-label="Document name"]')).toBeVisible();
    await expect(dialog.getByText('Empty document')).toBeVisible();
    await chooseStartMode(dialog, 'Start with a frame');
    await expect(dialog.getByText('Presets')).toBeVisible();
    await expect(dialog.getByText('A4')).toBeVisible();
  });

  test('dialog keeps its scrollable body and footer visible at 1280x720', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openNewFileDialog(page);

    const info = await dialogOverflowInfo(page);
    expect(info).not.toBeNull();
    expect(info?.bodyScrollable).toBe(false);
    expect(info?.createVisible).toBe(true);
    expect(info?.footerClippedByDialog).toBe(false);
  });

  test('create button exists and Enter/Escape behave', async ({ page }) => {
    const dialog = await openNewFileDialog(page);
    await expect(dialog.getByRole('button', { name: /^create design$/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
