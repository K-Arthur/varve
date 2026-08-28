import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const RESIZE_EDGE_SNAP_DOCUMENT = {
  id: 'resize-edge-snap-document',
  formatVersion: '2.0',
  name: 'Resize edge snap',
  rootChildren: ['source', 'target'],
  nodes: {
    source: {
      id: 'source',
      kind: 'shape',
      name: 'Source',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 160, 120],
      fill: { space: 'rgb', r: 40, g: 150, b: 220, a: 255 },
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    },
    target: {
      id: 'target',
      kind: 'shape',
      name: 'Target',
      layerColor: null,
      order: 'a1',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 310, 120],
      fill: { space: 'rgb', r: 220, g: 100, b: 80, a: 255 },
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    },
  },
  components: {},
  nextId: 3,
};

async function closeOpenDialogs(page: import('@playwright/test').Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) return;
    await openDialogs.last().getByRole('button', { name: /close/i }).first().click({ force: true });
    await page.waitForTimeout(50);
  }
}

async function handleCenter(page: import('@playwright/test').Page, name: string) {
  const box = await page.getByLabel(name, { exact: true }).boundingBox();
  if (!box) throw new Error(`${name} has no rendered bounds`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('Selection resize edge snapping', () => {
  test('snaps the dragged east edge without moving the west edge', async ({ page }) => {
    await navigateToEditor(page);
    await page.locator('#file-open-input').setInputFiles({
      name: 'resize-edge-snap.strata',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(RESIZE_EDGE_SNAP_DOCUMENT)),
    });
    await closeOpenDialogs(page);
    await page.getByRole('treeitem', { name: /\bSource\b/ }).click();

    const leftBefore = await handleCenter(page, 'Left resize handle');
    const rightBefore = await handleCenter(page, 'Right resize handle');
    const screenScale = (rightBefore.x - leftBefore.x) / 100;
    expect(screenScale).toBeGreaterThan(0);

    // The target's left edge is 50 world units to the right. Stop four CSS
    // pixels short: the threshold is deliberately screen-space, so a fixed
    // world-space shortfall would fail at this document's fitted zoom.
    await page.mouse.move(rightBefore.x, rightBefore.y);
    await page.mouse.down();
    await page.mouse.move(rightBefore.x + 50 * screenScale - 4, rightBefore.y);
    await page.mouse.up();

    await expect
      .poll(() => page.getByRole('spinbutton', { name: 'W (px)', exact: true }).inputValue())
      .toBe('150');

    const leftAfter = await handleCenter(page, 'Left resize handle');
    const rightAfter = await handleCenter(page, 'Right resize handle');
    expect(leftAfter.x).toBeCloseTo(leftBefore.x, 0);
    expect(rightAfter.x - leftAfter.x).toBeCloseTo(150 * screenScale, 0);
  });
});
