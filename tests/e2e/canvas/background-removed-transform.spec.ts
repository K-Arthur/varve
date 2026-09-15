import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const CUTOUT_DOCUMENT = {
  id: 'cutout-transform-document',
  formatVersion: '2.0',
  name: 'Background removed transform',
  rootChildren: ['cutout'],
  nodes: {
    cutout: {
      id: 'cutout',
      kind: 'shape',
      name: 'Background removed image',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 160, 120],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      fills: [
        {
          type: 'image',
          image: {
            src: PNG,
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 300,
            imageHeight: 180,
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 300, h: 180 },
      backgroundRemoval: {
        maskDataUrl: PNG,
        method: 'quick',
        confidence: 1,
        appliedAt: 1,
      },
    },
  },
  components: {},
  nextId: 2,
};

async function handleBox(page: import('@playwright/test').Page, name: string) {
  const box = await page.getByLabel(name, { exact: true }).boundingBox();
  if (!box) throw new Error(`${name} has no rendered bounds`);
  return box;
}

async function closeOpenDialogs(page: import('@playwright/test').Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) return;
    await openDialogs.last().getByRole('button', { name: /close/i }).first().click({ force: true });
    await page.waitForTimeout(50);
  }
}

test.describe('background-removed image transforms', () => {
  test('edge resize supports Alt/Ctrl and undo/redo restores exact handle geometry', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await page.locator('#file-open-input').setInputFiles({
      name: 'background-removed.strata',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(CUTOUT_DOCUMENT)),
    });
    const layer = page.getByRole('treeitem', { name: /Background removed image/i });
    await expect(layer).toBeVisible();
    await closeOpenDialogs(page);
    await layer.click();

    const initialLeft = await handleBox(page, 'Left resize handle');
    const initialRight = await handleBox(page, 'Right resize handle');
    const startX = initialRight.x + initialRight.width / 2;
    const startY = initialRight.y + initialRight.height / 2;
    await page.keyboard.down('Alt');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 50, startY);
    await page.mouse.up();
    await page.keyboard.up('Alt');

    const centeredLeft = await handleBox(page, 'Left resize handle');
    const centeredRight = await handleBox(page, 'Right resize handle');
    const centeredWidth = Number(
      await page.getByRole('spinbutton', { name: 'W (px)' }).inputValue(),
    );
    expect(centeredLeft.x).toBeGreaterThan(initialLeft.x + 20);
    expect(centeredRight.x).toBeLessThan(initialRight.x - 20);

    await closeOpenDialogs(page);
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page
      .locator('[role="menu"]')
      .getByRole('menuitem', { name: /^Undo\b/ })
      .click();

    const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
    await expect(redoButton).toBeEnabled();
    await redoButton.click();
    await layer.click();
    await expect
      .poll(async () => Number(await page.getByRole('spinbutton', { name: 'W (px)' }).inputValue()))
      .toBeCloseTo(centeredWidth, 0);

    const ctrlStart = await handleBox(page, 'Right resize handle');
    const ctrlX = ctrlStart.x + ctrlStart.width / 2;
    const ctrlY = ctrlStart.y + ctrlStart.height / 2;
    await page.keyboard.down('Control');
    await page.mouse.move(ctrlX, ctrlY);
    await page.mouse.down();
    await page.mouse.move(ctrlX - 30, ctrlY);
    await page.mouse.up();
    await page.keyboard.up('Control');
    expect((await handleBox(page, 'Right resize handle')).x).toBeLessThan(ctrlStart.x - 15);
  });
});
