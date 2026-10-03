import { expect, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToCleanEditor } from '../helpers/nav';

async function createEllipse(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('o');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('canvas is not available');
  await page.mouse.move(bounds.x + 150, bounds.y + 150);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 450, bounds.y + 350);
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.click(bounds.x + 300, bounds.y + 250);
  await expect(page.getByRole('treeitem')).toHaveCount(1);
}

async function openPatternLibrary(page: import('@playwright/test').Page): Promise<void> {
  const paintLibrary = page.getByRole('button', { name: 'Paint Library', exact: true });
  await expect(paintLibrary).toBeVisible({ timeout: 10000 });
  if ((await paintLibrary.getAttribute('aria-expanded')) === 'false') await paintLibrary.click();
  await expect(paintLibrary).toHaveAttribute('aria-expanded', 'true');
  const patternLibrary = page.getByRole('button', { name: 'Pattern Library', exact: true });
  await expect(patternLibrary).toBeVisible({ timeout: 10000 });
  if ((await patternLibrary.getAttribute('aria-expanded')) === 'false') {
    await patternLibrary.click();
  }
  await expect(patternLibrary).toHaveAttribute('aria-expanded', 'true');
}

async function canvasHash(canvas: import('@playwright/test').Locator): Promise<string> {
  return canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('pattern preview has no 2D context');
    const bytes = context.getImageData(0, 0, target.width, target.height).data;
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  });
}

test('embedded vector pattern definition and applied fill reopen offline', async ({ page }) => {
  test.setTimeout(240000);
  await navigateToCleanEditor(page);
  await createEllipse(page);
  await openPatternLibrary(page);
  await page.getByRole('button', { name: /create from selection/i }).click();

  const entry = page.locator('ul[aria-label="Reusable patterns"] > li').first();
  const name = await entry.locator('.insp-paint-library__name').innerText();
  await expect(entry).toContainText('vector');
  await entry.getByRole('button', { name: `Apply ${name} to selection` }).click();
  await entry.getByRole('button', { name: `Edit ${name} source motifs` }).click();

  const sourceEditor = entry.getByRole('region', { name: `Edit ${name} source` });
  await sourceEditor.getByRole('spinbutton', { name: 'Motif translation X' }).fill('24');
  await sourceEditor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(sourceEditor).toBeHidden();
  const originalPreview = await canvasHash(entry.locator('.insp-pattern-library__swatch canvas'));

  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.varve-home__toolbar').waitFor({ timeout: 30000 });

  // The document and its pattern resources are local. Keep the already-loaded
  // app shell available, then open the saved library document with networking
  // disabled so an external asset or service cannot satisfy the assertion.
  await page.context().setOffline(true);
  await page.getByRole('gridcell').first().dblclick();
  await page.locator('.layers-panel').waitFor({ timeout: 60000 });
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.getByRole('treeitem').first().click();
  await expect(page.getByRole('button', { name: 'Paint Library', exact: true })).toBeVisible();
  await openPatternLibrary(page);

  const reopenedEntry = page
    .locator('ul[aria-label="Reusable patterns"] > li')
    .filter({ hasText: name });
  await expect(reopenedEntry).toHaveCount(1);
  await expect(reopenedEntry).toContainText('1 use');
  await expect
    .poll(() => canvasHash(reopenedEntry.locator('.insp-pattern-library__swatch canvas')))
    .toBe(originalPreview);
  await reopenedEntry.getByRole('button', { name: `Edit ${name} source motifs` }).click();
  const reopenedEditor = reopenedEntry.getByRole('region', { name: `Edit ${name} source` });
  await expect(reopenedEditor.getByRole('spinbutton', { name: 'Motif translation X' })).toHaveValue(
    '24',
  );
  await reopenedEditor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(reopenedEditor).toBeHidden();
  await page.screenshot({
    path: evidencePath('pattern-system-2026-09-30/app-pattern-offline-reopen.png'),
  });
});
