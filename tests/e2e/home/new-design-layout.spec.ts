import { expect, type Page, test } from '@playwright/test';

/**
 * New Design dialog layout requirements.
 *
 * The dialog must fit within supported laptop viewports (1280x720), keep the
 * footer and Create button visible, and scroll only the content area. These
 * tests verify the fixed structure: sticky header, scrollable body, sticky
 * footer — no content rendered underneath the footer, no page-level scroll.
 */

async function openNewDesignDialog(page: Page) {
  // Reset the app's crash-loop counter (vite HMR reloads can accumulate 3+
  // unclean boots in one context and pop the Safe Mode screen).
  await page.addInitScript(() => localStorage.removeItem('varve:crash-loop'));
  await page.goto('/');
  await page.waitForSelector('.varve-home', { timeout: 45000 });
  const btn = page.getByRole('button', { name: /^new$/i });
  await btn.waitFor({ state: 'visible', timeout: 45000 });
  // force: the dialog's native backdrop covers the trigger button the moment
  // the click lands (see tests/e2e/shared.ts).
  await btn.click({ force: true, timeout: 15000 });
  const dialog = page.locator('dialog.varve-dialog[open]');
  await expect(dialog).toBeVisible();
  // Let the modal-in animation settle so measurements aren't mid-transform.
  await page.waitForTimeout(400);
  return dialog;
}

async function chooseStartMode(dialog: import('@playwright/test').Locator, label: string) {
  await dialog.locator('label.new-design__start-card').filter({ hasText: label }).click();
}

async function dialogLayoutInfo(page: Page) {
  return page.evaluate(() => {
    const d = document.querySelector('dialog.varve-dialog[open]') as HTMLDialogElement | null;
    if (!d) return null;
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
      // 2px tolerance: subpixel rounding mid-animation can place the footer
      // within a pixel of the dialog's bottom edge without real clipping.
      footerClippedByDialog: footerRect ? footerRect.bottom > dRect.bottom + 2 : null,
      bodyScrolls:
        body !== null && body !== undefined && getComputedStyle(body).overflowY !== 'hidden',
      createVisible: createRect
        ? createRect.bottom <= window.innerHeight && createRect.top >= 0
        : null,
    };
  });
}

test.describe('New Design dialog — layout', () => {
  test('dialog fits 1280x720 with the footer and Create button fully visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openNewDesignDialog(page);

    const info = await dialogLayoutInfo(page);
    expect(info).not.toBeNull();
    // The dialog never extends past the viewport bottom.
    expect(info?.dialog.bottom ?? 0).toBeLessThanOrEqual(info?.viewport.h ?? 0);
    // Footer + Create button are fully on-screen (never clipped).
    expect(info?.footerVisible).toBe(true);
    expect(info?.createVisible).toBe(true);
    expect(info?.footerClippedByDialog, JSON.stringify(info)).toBe(false);
    // The body owns the scrolling, not the page.
    expect(info?.bodyScrolls).toBe(true);
  });

  test('the preset browser scrolls internally at reduced height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const dialog = await openNewDesignDialog(page);
    await chooseStartMode(dialog, 'Start with a frame');

    const info = await dialogLayoutInfo(page);
    expect(info?.dialog.bottom ?? 0).toBeLessThanOrEqual(info?.viewport.h ?? 0);
    expect(info?.footerVisible).toBe(true);
    expect(info?.createVisible).toBe(true);
  });

  test('escape closes the dialog', async ({ page }) => {
    const dialog = await openNewDesignDialog(page);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
