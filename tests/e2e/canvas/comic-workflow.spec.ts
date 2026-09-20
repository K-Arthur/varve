import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { importImageFile } from '../helpers/editor-helpers';
import { navigateToEditor } from '../shared';

/**
 * Real comic-workflow scenarios over a real photograph, not synthetic shapes.
 *
 * Covers the workflow half of the comic system: importing a photo, laying out
 * panels, wrapping dialogue in a burst balloon, applying an SFX text-effect
 * preset, and editing a balloon's dialogue by double-clicking the balloon
 * itself. Captures land in docs/screenshots/comic-workflow/.
 */
const SHOT_DIR = 'docs/screenshots/comic-workflow';

async function activatePanelTool(page: import('@playwright/test').Page) {
  const toolbar = page.getByTestId('toolbar');
  const directPanelTool = toolbar.locator('[data-tool="panel"]');
  if (await directPanelTool.isVisible().catch(() => false)) {
    await directPanelTool.click();
    return;
  }
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  const overflow = page.locator('.varve-ctxmenu');
  await overflow.getByText('Layout', { exact: true }).click();
  await page
    .getByRole('menu', { name: 'Layout submenu', exact: true })
    .getByText('Panel', { exact: true })
    .click();
}

async function dragOnCanvas(
  page: import('@playwright/test').Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('editor canvas has no bounds');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function createTextAt(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  text: string,
): Promise<void> {
  const editor = page.getByRole('textbox', { name: /editing text/i });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('t');
    await page.mouse.click(x, y);
    const appeared = await editor
      .waitFor({ state: 'visible', timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      await page.keyboard.insertText(text);
      await page.keyboard.press('Escape');
      await editor.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(120);
      return;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  throw new Error(`text editor did not appear at ${x},${y}`);
}

async function chooseOption(
  page: import('@playwright/test').Page,
  comboboxName: RegExp,
  optionName: string,
) {
  await page.getByRole('combobox', { name: comboboxName }).click();
  // Options carry a description in their accessible name; match by text.
  await page.getByRole('option').filter({ hasText: optionName }).first().click();
}

test.describe('Comic workflow over a real photograph', () => {
  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test('a photo becomes a paged comic panel layout with lettering and SFX', async ({ page }) => {
    test.setTimeout(240000);
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    // Lay out the panel grid first, then bring the real photograph in.
    await activatePanelTool(page);
    await dragOnCanvas(page, 60, 60, 360, 280);
    await expect(page.getByRole('treeitem', { name: /panel/i }).first()).toBeVisible({
      timeout: 10000,
    });

    // Divide the panel into a real comic grid.
    await page.getByRole('button', { name: 'Four-panel', exact: true }).click();
    for (let i = 0; i < 6; i++) {
      const expand = page.getByRole('button', { name: 'Expand' }).first();
      if (!(await expand.isVisible().catch(() => false))) break;
      await expand.click();
    }
    await page.waitForTimeout(200);

    // A real 196 KB photograph, not a generated fixture.
    await importImageFile(page, 'photo-fixture.jpg');
    await expect(page.getByRole('treeitem').first()).toBeVisible();
    // The hidden file input keeps focus after import; return it to the canvas.
    await page.mouse.click(box.x + 60, box.y + 60);

    await page.screenshot({ path: `${SHOT_DIR}/01-panels-from-photo.png`, fullPage: false });

    // Dialogue wrapped into a balloon, then switched to a burst shape. Placed
    // on open canvas beside the grid so the render is not panel-clipped.
    await createTextAt(page, box.x + 460, box.y + 360, 'The signal is coming from the ridge.');
    await page.keyboard.press('v');
    await page.getByRole('treeitem', { name: /text:/i }).first().click();
    await page.getByRole('button', { name: 'Add speech balloon', exact: true }).click();
    const balloonLayer = page.getByRole('treeitem', { name: /speech balloon/i }).first();
    await expect(balloonLayer).toBeVisible({ timeout: 10000 });
    await balloonLayer.click();
    await chooseOption(page, /balloon style/i, 'Burst');
    await expect(page.getByRole('combobox', { name: /balloon style/i })).toHaveText('Burst');
    await expect(page.getByRole('treeitem', { name: /burst outline/i }).first()).toBeVisible({
      timeout: 10000,
    });

    // SFX display lettering on a second line of real text.
    await createTextAt(page, box.x + 430, box.y + 130, 'BOOM');
    await page.keyboard.press('v');
    await page.getByRole('treeitem', { name: /BOOM/i }).first().click();
    await chooseOption(page, /text effect preset/i, 'Sound effect');
    await page.waitForTimeout(200);

    await page.screenshot({ path: `${SHOT_DIR}/02-burst-balloon-and-sfx.png`, fullPage: false });
    await expect(page.getByRole('combobox', { name: /text effect preset/i })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /burst outline/i }).first()).toBeVisible();
  });

  test('double-clicking a balloon body edits its dialogue', async ({ page }) => {
    test.setTimeout(180000);
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await createTextAt(page, box.x + 420, box.y + 320, 'We leave at dawn.');
    await page.keyboard.press('v');
    await page.getByRole('treeitem', { name: /text:/i }).first().click();
    await page.getByRole('button', { name: 'Add speech balloon', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: /speech balloon/i }).first()).toBeVisible({
      timeout: 10000,
    });

    // Deselect, then double-click the balloon's top padding — away from the
    // resize handles and above the text box.
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 60, box.y + 60);
    await page.mouse.dblclick(box.x + 450, box.y + 310);

    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeVisible({ timeout: 10000 });
    await expect(editor).toHaveValue('We leave at dawn.');
    await page.screenshot({
      path: `${SHOT_DIR}/03-double-click-edit-balloon.png`,
      fullPage: false,
    });
  });
});
