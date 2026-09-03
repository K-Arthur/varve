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

const PIXEL_RESIZE_DOCUMENT = {
  ...RESIZE_EDGE_SNAP_DOCUMENT,
  id: 'pixel-resize-document',
  name: 'Pixel resize',
  rootChildren: ['source'],
  nodes: {
    source: {
      ...RESIZE_EDGE_SNAP_DOCUMENT.nodes.source,
      transform: [1, 0, 0, 1, 160.2, 120],
    },
  },
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

async function openFixtureAndSelectSource(
  page: import('@playwright/test').Page,
  fixture: { name: string } = RESIZE_EDGE_SNAP_DOCUMENT,
) {
  await navigateToEditor(page);
  await page.locator('#file-open-input').setInputFiles({
    name: `${fixture.name}.strata`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await closeOpenDialogs(page);
  await page.getByRole('treeitem', { name: /\bSource\b/ }).click();
}

test.describe('Selection resize edge snapping', () => {
  test('snaps the dragged east edge without moving the west edge', async ({ page }) => {
    await openFixtureAndSelectSource(page);

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

  test('keeps the full fractional aspect-lock result in the inspector', async ({ page }) => {
    await openFixtureAndSelectSource(page);

    const lock = page.locator('.insp-proportion-lock');
    await lock.click();
    await expect(page.getByRole('checkbox', { name: 'Constrain proportions' })).toBeChecked();

    const width = page.getByRole('spinbutton', { name: 'W (px)', exact: true });
    await width.fill('133.3333');
    await width.press('Enter');

    const height = page.getByRole('spinbutton', { name: 'H (px)', exact: true });
    await expect.poll(async () => Number(await height.inputValue())).toBeCloseTo(106.66664, 6);
  });

  test('pixel-grid snapping rounds only the moving resize edge', async ({ page }) => {
    await openFixtureAndSelectSource(page, PIXEL_RESIZE_DOCUMENT);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'No selection' })).toBeVisible();

    await page.getByRole('button', { name: 'Document Grid' }).click();
    const pixelSnap = page.getByRole('checkbox', { name: /snap to pixels/i });
    await pixelSnap.check();
    await expect(pixelSnap).toBeChecked();

    await page.getByRole('treeitem', { name: /\bSource\b/ }).click();
    const leftBefore = await handleCenter(page, 'Left resize handle');
    const rightBefore = await handleCenter(page, 'Right resize handle');
    const screenScale = (rightBefore.x - leftBefore.x) / 100;

    // Start at world x=260.2 and drag to 307.4. Pixel snap must correct the
    // moving edge to 307 while retaining the x=160.2 west edge.
    await page.mouse.move(rightBefore.x, rightBefore.y);
    await page.mouse.down();
    await page.mouse.move(rightBefore.x + 47.2 * screenScale, rightBefore.y);
    await page.mouse.up();

    const leftAfter = await handleCenter(page, 'Left resize handle');
    const rightAfter = await handleCenter(page, 'Right resize handle');
    expect(leftAfter.x).toBeCloseTo(leftBefore.x, 0);
    expect(rightAfter.x - leftAfter.x).toBeCloseTo(146.8 * screenScale, 0);
  });
});
