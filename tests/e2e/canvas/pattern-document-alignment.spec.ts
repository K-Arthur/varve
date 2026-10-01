import { expect, type Page, test } from '@playwright/test';
import { selectFillType } from '../helpers/editor-helpers';
import { navigateToCleanEditor } from '../helpers/nav';

async function createPatternedRect(page: Page) {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('canvas has no bounds');
  await page.mouse.move(bounds.x + 150, bounds.y + 150);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 450, bounds.y + 350);
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.click(bounds.x + 300, bounds.y + 250);
  await selectFillType(page, 'Pattern');
  await page.getByRole('button', { name: /generate pattern/i }).click();
  await expect(page.getByRole('combobox', { name: /Generator/i })).toBeVisible();
  await page.getByRole('combobox', { name: /Generator/i }).click();
  await page.getByRole('option', { name: 'Dots', exact: true }).click();
  await page.waitForTimeout(1000);
  return { bounds };
}

async function interiorSignature(page: Page, origin: { x: number; y: number }): Promise<string> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) throw new Error('pattern canvas is unavailable');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    let hash = 2166136261;
    for (let row = 0; row < 13; row++) {
      for (let column = 0; column < 19; column++) {
        const pixel = context.getImageData(
          Math.round((x + 175 + column * 13 - rect.left) * dpr),
          Math.round((y + 170 + row * 13 - rect.top) * dpr),
          1,
          1,
        ).data;
        for (const channel of pixel) {
          hash ^= channel ?? 0;
          hash = Math.imul(hash, 16777619);
        }
      }
    }
    return (hash >>> 0).toString(16);
  }, origin);
}

test('document alignment changes the real canvas field and exposes its anchor in the inspector', async ({
  page,
}) => {
  test.setTimeout(180000);
  await navigateToCleanEditor(page);
  const { bounds } = await createPatternedRect(page);
  const alignment = page.getByRole('combobox', { name: 'Pattern alignment' });
  await expect(alignment).toContainText('Object');
  const objectSignature = await interiorSignature(page, bounds);

  await alignment.click();
  await page.getByRole('option', { name: 'Document/page', exact: true }).click();
  await expect(alignment).toContainText('Document/page');
  await expect
    .poll(() => interiorSignature(page, bounds), { timeout: 10000 })
    .not.toBe(objectSignature);

  // Keep the object selected for its placement controls, but leave drawing
  // mode so the contextual "click and drag" hint does not cover the pattern.
  await page.keyboard.press('v');
  await expect(alignment).toContainText('Document/page');
  await page.getByRole('button', { name: 'Dismiss hint' }).click();
  await expect(page.locator('.micro-hint')).toBeHidden();

  await page.screenshot({
    path: 'docs/screenshots/pattern-system-2026-09-30/app-document-alignment.png',
  });
});
