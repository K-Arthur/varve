import { expect, test } from '@playwright/test';
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
  await expect(paintLibrary).toBeVisible();
  if ((await paintLibrary.getAttribute('aria-expanded')) === 'false') await paintLibrary.click();
  const patternLibrary = page.getByRole('button', { name: 'Pattern Library', exact: true });
  await expect(patternLibrary).toBeVisible();
  if ((await patternLibrary.getAttribute('aria-expanded')) === 'false') {
    await patternLibrary.click();
  }
}

test('dragging a motif from a repeated neighbor edits the canonical source', async ({ page }) => {
  test.setTimeout(180000);
  await navigateToCleanEditor(page);
  await createEllipse(page);
  await openPatternLibrary(page);
  await page.getByRole('button', { name: /create from selection/i }).click();

  const entry = page.locator('ul[aria-label="Reusable patterns"] > li').first();
  const name = await entry.locator('.insp-paint-library__name').innerText();
  await entry.getByRole('button', { name: `Apply ${name} to selection` }).click();
  await entry.getByRole('button', { name: `Edit ${name} definition settings` }).click();
  await entry.getByRole('checkbox', { name: 'Mirror columns' }).check();
  await entry.getByRole('button', { name: `Edit ${name} source motifs` }).click();

  const session = entry.getByRole('region', { name: `Edit ${name} source` });
  await expect(session).toHaveClass(/insp-pattern-source-editor/);
  const preview = session.locator('canvas.insp-pattern-preview__canvas--editable');
  await expect(preview).toBeVisible();
  await preview.scrollIntoViewIfNeeded();
  const translationX = session.getByRole('spinbutton', { name: 'Motif translation X' });
  await expect(translationX).toHaveValue('0');
  const bounds = await preview.boundingBox();
  if (!bounds) throw new Error('editable pattern preview is unavailable');

  // This path crosses from repeat column -2 into column -1, which changes the
  // mirror parity. Verify the gesture keeps one source transform instead of
  // reversing at the boundary or editing an independent ghost.
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.6, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await translationX.inputValue()), { timeout: 10000 })
    .toBeGreaterThan(100);
  await session.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.mouse.move(24, 24);
  await page.screenshot({
    path: 'docs/screenshots/pattern-system-2026-09-30/app-source-ghost-drag-desktop.png',
  });
  await preview.screenshot({
    path: 'docs/screenshots/pattern-system-2026-09-30/app-source-ghost-preview.png',
  });

  await session.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(session).toBeHidden();
  await entry.getByRole('button', { name: `Edit ${name} source motifs` }).click();
  const reopened = entry.getByRole('region', { name: `Edit ${name} source` });
  await expect(reopened.getByRole('spinbutton', { name: 'Motif translation X' })).toHaveValue('0');
  await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();
});
