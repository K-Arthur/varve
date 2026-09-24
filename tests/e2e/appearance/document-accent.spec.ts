/**
 * Document-derived accent — real-browser lifecycle through production controls.
 *
 * Proves, through the real Settings dialog, Inspector fill picker, and canvas:
 *  - an empty/grayscale page keeps the fixed accent (honest fallback),
 *  - a saturated page derives an accent (data-accent-source + changed
 *    --color-accent-primary) after the trailing debounce,
 *  - the canvas pixels are byte-identical before/after the accent change,
 *  - the preference is application state (undo still targets the document
 *    only; no dirty marking),
 *  - the preference persists across reload.
 *
 * The extraction math itself is covered by unit tests; this spec proves the
 * user-facing path works end to end through the contextual fill controls.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const SETTINGS_DIALOG = 'dialog.varve-dialog--settings';

async function openSettings(page: Page) {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim() === 'File' && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim().toLowerCase().startsWith('settings') && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await expect(page.locator(SETTINGS_DIALOG)).toHaveAttribute('open', '', { timeout: 10000 });
}

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator(SETTINGS_DIALOG)).not.toHaveAttribute('open');
}

async function chooseAccentSource(page: Page, mode: 'Fixed' | 'From document') {
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.locator(SETTINGS_DIALOG).getByRole('combobox', { name: 'Accent source' }).click();
  await page.getByRole('option', { name: mode, exact: true }).click();
}

async function readAccentVar(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent-primary').trim(),
  );
}

/** Stash the content canvas pixels inside the page for a later in-page diff
 *  (authoritative ImageData comparison, immune to capture timing). */
async function stashCanvasPixels(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('content canvas 2d context unavailable');
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    (window as unknown as { __accentPixelProbe: ImageData }).__accentPixelProbe = image;
  });
}

async function expectCanvasPixelsUnchanged(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('content canvas 2d context unavailable');
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const before = (window as unknown as { __accentPixelProbe: ImageData | null })
      .__accentPixelProbe;
    if (!before) throw new Error('pixel probe was never stashed');
    let differing = 0;
    for (let i = 0; i < after.data.length; i++) {
      if (after.data[i] !== before.data[i]) differing++;
    }
    (window as unknown as { __accentPixelProbe: ImageData | null }).__accentPixelProbe = null;
    return differing;
  });
  expect(result).toBe(0);
}

/** Draw one rectangle through the real tool, then recolour it saturated red
 *  through the contextual toolbar's fill picker. */
async function drawSaturatedRectangle(page: Page) {
  const historyWarnings: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'warning' &&
      message.text().includes('[history] updateDoc called outside transaction')
    ) {
      historyWarnings.push(message.text());
    }
  });
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 220);
  await page.mouse.move(box.x + 320, box.y + 320);
  await page.mouse.up();
  await page.getByRole('treeitem').first().waitFor({ timeout: 5000 });

  await page
    .getByRole('toolbar', { name: 'Contextual properties' })
    .getByRole('button', { name: 'Fill colour' })
    .click();
  const hex = page.getByRole('textbox', { name: 'Hex color' });
  await hex.waitFor({ timeout: 5000 });
  await hex.fill('#e74c3c');
  await hex.press('Enter');
  await page.keyboard.press('Escape'); // close the popover
  await page.keyboard.press('Escape'); // deselect
  expect(historyWarnings).toEqual([]);
}

test('an empty page keeps the fixed accent while the mode is on', async ({ page }) => {
  await navigateToEditor(page);
  const before = await readAccentVar(page);

  await openSettings(page);
  await chooseAccentSource(page, 'From document');
  await closeSettings(page);

  // Give the trailing debounce + extraction time to run against the empty
  // page; the honest result is the fixed accent (no override, no attribute).
  await page.waitForTimeout(1500);
  expect(await readAccentVar(page)).toBe(before);
  expect(await page.evaluate(() => document.documentElement.dataset.accentSource)).toBeUndefined();
  expect(await page.locator('#varve-doc-accent').count()).toBe(0);
});

test('a saturated document derives an accent without touching canvas pixels, history, or saved state', async ({
  page,
}) => {
  await navigateToEditor(page);
  await drawSaturatedRectangle(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(300);
  await stashCanvasPixels(page);
  const accentBefore = await readAccentVar(page);
  const saveBefore = await page.evaluate(
    () => document.querySelector('.save-status')?.textContent?.trim() ?? '(missing)',
  );

  await openSettings(page);
  await chooseAccentSource(page, 'From document');
  await closeSettings(page);

  await page.waitForSelector('[data-accent-source="document"]', { timeout: 8000 });
  const accentAfter = await readAccentVar(page);
  expect(accentAfter).not.toBe(accentBefore);

  // Toggling the preference added no save-state transition of its own.
  const saveToggled = await page.evaluate(
    () => document.querySelector('.save-status')?.textContent?.trim() ?? '(missing)',
  );
  expect(saveToggled).toBe(saveBefore);

  // Canvas pixels are untouched by an interface preference (in-page ImageData
  // diff of the live surface, per the render-pipeline reuse oracle).
  await page.waitForTimeout(300);
  await expectCanvasPixelsUnchanged(page);

  // The preference is application state: the document carries exactly two
  // edits (create rectangle, recolour fill). Two undos must empty the tree —
  // if the accent toggle had created an undo entry, the rectangle would
  // still be present after them.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const treeItems = await page.getByRole('treeitem').count();
  expect(treeItems).toBe(0);

  // Restore the shape (undo the two edits); the derived accent must survive
  // document edits.
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(600);
  expect(await page.getByRole('treeitem').count()).toBe(1);
  expect(await page.locator('[data-accent-source="document"]').count()).toBe(1);
});

test('the accent-source preference persists across reload', async ({ page }) => {
  await navigateToEditor(page);
  await drawSaturatedRectangle(page);

  await openSettings(page);
  await chooseAccentSource(page, 'From document');
  await closeSettings(page);
  await page.waitForSelector('[data-accent-source="document"]', { timeout: 8000 });

  // The unsaved document is deliberately not re-entered after reload; the
  // persistence contract is about the preference, which must survive the
  // reload and stay reflected by the real Settings control.
  await page.reload();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('varve-editor-settings') ?? '{}'),
  );
  expect(stored?.appearance?.accentSource).toBe('document');

  await navigateToEditor(page);
  await openSettings(page);
  await page.getByRole('tab', { name: 'Appearance' }).click();
  // Playwright's expect has no toHaveTextContent; toContainText is the
  // equivalent for the combobox's selected-value label.
  await expect(
    page.locator(SETTINGS_DIALOG).getByRole('combobox', { name: 'Accent source' }),
  ).toContainText('From document');
});
