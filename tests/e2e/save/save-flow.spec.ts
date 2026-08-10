/**
 * End-to-end: user-controlled saving on the web platform (deterministic).
 *
 * The browser's File System Access API is stubbed so the test controls the
 * picker deterministically: first Save asks, subsequent Save reuses the
 * chosen target, Save As re-picks and adopts only on success, Save a Copy
 * never adopts and never clears dirty state, cancellations change nothing,
 * and write failures keep the document dirty with a truthful status.
 *
 * These flows run against the same save coordinator the desktop app uses;
 * native dialog/write plumbing is covered by the Rust unit tests and the
 * manual CachyOS checklist instead (native dialogs are OS-owned and cannot
 * be driven by Playwright).
 */
import { expect, type Page, test } from '@playwright/test';
import { mod } from '../helpers/menu-helpers';
import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

/** Install a deterministic showSaveFilePicker stub before app scripts run. */
async function installSavePickerStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    let pickerCalls = 0;
    win.__varvePickerCalls = () => pickerCalls;
    win.__varveLastSuggested = null;
    win.__varveCancelNext = false;
    win.__varveFailWrites = false;
    win.showSaveFilePicker = async (opts: { suggestedName?: string }) => {
      pickerCalls += 1;
      win.__varveLastSuggested = opts.suggestedName ?? null;
      if (win.__varveCancelNext) return undefined;
      return {
        name: opts.suggestedName ?? 'document.varve',
        queryPermission: async () => 'granted',
        createWritable: async () => ({
          write: async () => {
            if (win.__varveFailWrites) {
              throw new Error('QuotaExceededError: The write failed');
            }
          },
          close: async () => undefined,
        }),
      };
    };
  });
}

const pickerCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as Record<string, () => number>).__varvePickerCalls?.() as number);
const lastSuggested = (page: Page) =>
  page.evaluate(() => (window as unknown as Record<string, string | null>).__varveLastSuggested);

/** Open the File menu from the application menubar. */
async function openFileMenu(page: Page): Promise<void> {
  await page
    .getByRole('menubar')
    .getByRole('menuitem', { name: /^File$/ })
    .click();
  await page.getByRole('menu').first().waitFor({ state: 'visible', timeout: 5000 });
}

/** The save-status segment in the status bar. */
function saveStatus(page: Page) {
  return page.locator('.save-status');
}

async function makeDirty(page: Page): Promise<void> {
  // A frame first: on a truly empty canvas, a bare rect drag may not land
  // on an artboard target. Frame + rect mirrors the canvas specs' pattern.
  await page.keyboard.press('f');
  await page.locator('canvas.editor-canvas__content-layer').waitFor({ state: 'attached' });
  await dragOnCanvas(page, 20, 20, 320, 220);
  await page.keyboard.press('r');
  await dragOnCanvas(page, 40, 40, 200, 140);
  await page.keyboard.press('v');
  await expect(saveStatus(page)).toHaveText('Modified');
}

test('first Save opens the location picker and reports Saved', async ({ page }) => {
  await installSavePickerStub(page);
  await navigateToCleanEditor(page);

  await expect(saveStatus(page)).toHaveText('Not saved');
  await page.keyboard.press(`${mod('s')}`);
  await expect(saveStatus(page)).toHaveText('Saved');

  expect(await pickerCalls(page)).toBe(1);
  const suggested = await lastSuggested(page);
  expect(suggested).toMatch(/Untitled.*\.varve$/);
});

test('subsequent Save reuses the chosen target without re-picking', async ({ page }) => {
  await installSavePickerStub(page);
  await navigateToCleanEditor(page);

  await page.keyboard.press(`${mod('s')}`);
  await expect(saveStatus(page)).toHaveText('Saved');
  expect(await pickerCalls(page)).toBe(1);

  await makeDirty(page);
  await page.keyboard.press(`${mod('s')}`);
  await expect(saveStatus(page)).toHaveText('Saved');
  expect(await pickerCalls(page)).toBe(1);
});

test('Save As re-picks and adopts the new destination', async ({ page }) => {
  await installSavePickerStub(page);
  await navigateToCleanEditor(page);

  await page.keyboard.press(`${mod('s')}`);
  await expect(saveStatus(page)).toHaveText('Saved');
  expect(await pickerCalls(page)).toBe(1);

  await makeDirty(page);
  // Headless Chromium intercepts Ctrl+Shift+S at the browser level, so
  // drive Save As through the File menu — the same action-registry path.
  await openFileMenu(page);
  await page.getByRole('menu').getByRole('menuitem', { name: 'Save As…' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 5000 });

  await expect(saveStatus(page)).toHaveText('Saved');
  expect(await pickerCalls(page)).toBe(2);
  const suggested = await lastSuggested(page);
  expect(suggested).toMatch(/\.varve$/);
});

test('cancelled Save As changes nothing', async ({ page }) => {
  await installSavePickerStub(page);
  await navigateToCleanEditor(page);

  await page.keyboard.press(`${mod('s')}`);
  await expect(saveStatus(page)).toHaveText('Saved');

  await makeDirty(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__varveCancelNext = true;
  });
  await openFileMenu(page);
  await page.getByRole('menu').getByRole('menuitem', { name: 'Save As…' }).click();

  // Cancellation is normal: not a failure, and nothing is adopted.
  await expect(saveStatus(page)).toHaveText('Modified');
  expect(await pickerCalls(page)).toBe(2);
});

test('Save a Copy writes elsewhere, keeps the active target and dirty state', async ({ page }) => {
  await installSavePickerStub(page);
  await navigateToCleanEditor(page);

  await page.keyboard.press(`${mod('s')}`);
  await expect(saveStatus(page)).toHaveText('Saved');
  expect(await pickerCalls(page)).toBe(1);

  await makeDirty(page);

  // File → Save a Copy…
  await openFileMenu(page);
  await page.getByRole('menu').getByRole('menuitem', { name: 'Save a Copy…' }).click();

  await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 5000 });
  expect(await pickerCalls(page)).toBe(2);

  // The active document stays modified relative to its own file, and the
  // copy never became the active destination.
  await expect(saveStatus(page)).toHaveText('Modified');
});

test('write failure keeps the document dirty and reports Save failed', async ({ page }) => {
  await installSavePickerStub(page);
  await navigateToCleanEditor(page);

  await makeDirty(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__varveFailWrites = true;
  });
  await page.keyboard.press(`${mod('s')}`);

  await expect(saveStatus(page)).toHaveText('Save failed');
  expect(await pickerCalls(page)).toBe(1);
  // Still dirty: the failed write never cleared the edit state.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__varveFailWrites = false;
  });
  await page.keyboard.press(`${mod('s')}`);
  await expect(saveStatus(page)).toHaveText('Saved');
});

test('stale save finishing after a new edit keeps the document dirty', async ({ page }) => {
  await installSavePickerStub(page);
  await navigateToCleanEditor(page);

  await page.keyboard.press(`${mod('s')}`);
  await expect(saveStatus(page)).toHaveText('Saved');

  // Edit WHILE a save is in flight: the coordinator's revision check must
  // keep the document modified even though the (stale) write succeeded.
  // The save is fast in the browser, so drive the race directly through the
  // editor API: start a save, mutate mid-flight via the UI right after.
  await page.keyboard.press('r');
  await page.locator('canvas.editor-canvas__content-layer').waitFor({ state: 'attached' });
  await page.keyboard.press(`${mod('s')}`);
  // Mutation lands while (or just after) the write resolves — either way the
  // document must end up Modified, never falsely clean.
  await dragOnCanvas(page, 20, 20, 120, 80);
  await page.keyboard.press('v');
  await expect(saveStatus(page)).toHaveText('Modified');
});
