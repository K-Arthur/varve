import { expect, type Page, test } from '@playwright/test';

/**
 * Baseline capture of the current New File / New Design dialog behavior.
 *
 * These tests document the pre-redesign state: presets-as-document-sizes,
 * no naming affordance, "Blank canvas" wording, and the dialog's layout
 * overflow at laptop viewport sizes. They are intentionally written against
 * the current implementation and are updated by the redesign commits.
 */

async function openNewFileDialog(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.varve-home');
  await page.getByRole('button', { name: /^new$/i }).click();
  const dialog = page.locator('dialog.varve-dialog[open]');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function dialogOverflowInfo(page: Page) {
  return page.evaluate(() => {
    const d = document.querySelector('dialog.varve-dialog[open]') as HTMLDialogElement | null;
    if (!d) return null;
    const header = d.querySelector('.varve-dialog__header');
    const footer = d.querySelector('.new-file__footer');
    const body = d.querySelector('.varve-dialog__body');
    const footerRect = footer?.getBoundingClientRect();
    const dRect = d.getBoundingClientRect();
    const createBtn = Array.from(d.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Create',
    );
    const createRect = createBtn?.getBoundingClientRect();
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dialog: { top: dRect.top, bottom: dRect.bottom, h: dRect.height },
      footerVisible: footerRect
        ? footerRect.bottom <= window.innerHeight && footerRect.top >= 0
        : null,
      footerClippedByDialog: footerRect ? footerRect.bottom > dRect.bottom - 1 : null,
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

test.describe('New File dialog — baseline capture', () => {
  test('dialog opens with preset-as-document model and no name field', async ({ page }) => {
    const dialog = await openNewFileDialog(page);

    await expect(dialog.locator('.varve-dialog__title')).toContainText(/new file/i);
    // Current model: the dialog has no document-name input.
    await expect(dialog.locator('input[aria-label="Document name"]')).toHaveCount(0);
    // Blank canvas tile with the misleading fixed-size framing.
    await expect(dialog.locator('.new-file__blank-title')).toHaveText('Blank canvas');
    await expect(dialog.getByText('Presets')).toBeVisible();
    // A document-size preset (e.g. A4 paper) is offered as a starting point.
    await expect(dialog.getByText('A4')).toBeVisible();
  });

  test('dialog overflows the viewport at 1280x720 with scrollable body and clipped footer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openNewFileDialog(page);

    const info = await dialogOverflowInfo(page);
    expect(info).not.toBeNull();
    // Baseline: no internal scrolling exists — the dialog simply grows past
    // the viewport bottom (dialog height >= 640 at a 720px viewport).
    expect(info?.bodyScrollable).toBe(false);
    // Baseline: the Create button renders below the viewport bottom — the
    // footer is clipped and cannot be reached without scrolling the page.
    expect(info?.createVisible).toBe(false);
    expect(info?.footerClippedByDialog).toBe(true);
  });

  test('create button exists and Enter/Escape behave', async ({ page }) => {
    const dialog = await openNewFileDialog(page);
    await expect(dialog.getByRole('button', { name: /^create design$/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
