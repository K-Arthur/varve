import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Real pointer-driven drag & drop through the Layers panel.
 *
 * The existing layers-dnd.spec.ts only checks that handles/rows exist — it
 * never performs an actual drag. Per the repo's UI-testing rule, canvas/
 * pointer interactions must be driven through real PointerEvents.
 *
 * Every test also fails on ANY uncaught page error or crash-consent dialog,
 * so a regression that surfaces as "a crash report opened" is caught here.
 */

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function expectNoCrashDialog(page: Page) {
  const crashDialog = page
    .locator('dialog[open]')
    .filter({ hasText: /closed unexpectedly|trouble starting/i });
  const visible = await crashDialog
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (visible) {
    const text = await crashDialog
      .first()
      .innerText()
      .catch(() => '<unreadable>');
    throw new Error(`Crash dialog appeared during DnD:\n${text}`);
  }
}

async function rowNames(page: Page): Promise<string[]> {
  return page.getByRole('treeitem').evaluateAll((rows) =>
    rows.map((r) => {
      const label =
        r.querySelector('.layers-row__name')?.textContent ??
        r.querySelector('[class*="name"]')?.textContent ??
        r.textContent ??
        '';
      return label.trim();
    }),
  );
}

function rowByName(page: Page, name: string): Locator {
  return page.locator('[role="treeitem"]').filter({ hasText: name }).first();
}

async function drawEmptyFrame(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  // Keep both ends inside the actual surface and clear of the seeded shapes
  // and floating toolbar. Fixed 760×600 offsets land on chrome after docking.
  await page.keyboard.press('f');
  await page.mouse.move(box.x + box.width * 0.76, box.y + box.height * 0.36);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.66, { steps: 6 });
  await page.mouse.up();
  await expect(rowByName(page, 'Frame')).toBeVisible();
  await page.keyboard.press('Escape');
}

function parseCanvasPosition(labels: string[], name: string): [number, number] {
  const label = labels.find((candidate) => candidate.trim().includes(`${name},`));
  const match = label?.match(/at \((-?[\d.]+),\s*(-?[\d.]+)\)/);
  if (!match) throw new Error(`canvas position for ${name} unavailable`);
  return [Number(match[1]), Number(match[2])];
}

/** Drag one row onto another with real pointer events. offsetFraction -0.35
 *  targets the before band, +0.35 the after band, 0 the into (middle) band. */
async function dragRowToRow(
  page: Page,
  fromName: string,
  toName: string,
  offsetFraction: number,
  screenshotName?: string,
  expectedIndicator?: string,
) {
  const from = rowByName(page, fromName);
  await from.scrollIntoViewIfNeeded();
  const fromHandle = from.locator('.layers-row__drag-handle');
  const to = rowByName(page, toName);
  await to.scrollIntoViewIfNeeded();
  const fromBox = await fromHandle.boundingBox();
  if (!fromBox) throw new Error(`source row ${fromName} not visible`);
  const toBox = await to.boundingBox();
  if (!toBox) throw new Error(`target row ${toName} not visible`);
  // Grab by the labeled handle; dnd-kit PointerSensor needs >5px travel.
  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  await page.mouse.move(startX, startY);
  const sourceHit = await page.evaluate(
    ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.layers-row__drag-handle')),
    { x: startX, y: startY },
  );
  if (!sourceHit) throw new Error(`drag handle for ${fromName} is clipped or covered`);
  await page.mouse.down();
  await page.mouse.move(startX, startY - 12);

  const targetY = toBox.y + toBox.height * (0.5 + offsetFraction);
  const targetX = toBox.x + toBox.width / 2;
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(
      startX + ((targetX - startX) * i) / 6,
      startY - 12 + ((targetY - (startY - 12)) * i) / 6,
    );
  }
  await page.waitForTimeout(120);
  if (screenshotName) {
    await page.getByTestId('layers-panel').screenshot({
      path: test.info().outputPath(`${screenshotName}.png`),
    });
  }
  if (expectedIndicator) {
    const indicator = page.locator(`.${expectedIndicator}`);
    try {
      await expect(indicator).toBeVisible({ timeout: 1500 });
    } catch (error) {
      const diagnostics = await page.evaluate(
        ({ x, y }) => {
          const tree = document.querySelector<HTMLElement>('.layers-panel__tree');
          const content = tree?.firstElementChild as HTMLElement | null | undefined;
          const rect = (element: Element | null | undefined) =>
            element?.getBoundingClientRect().toJSON() ?? null;
          return {
            pointer: { x, y },
            hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 240) ?? null,
            tree: rect(tree),
            content: rect(content),
            dragOverlay: document.querySelector('.drag-overlay')?.textContent ?? null,
            rows: Array.from(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []).map(
              (row) => ({
                name: row.querySelector('.layers-row__name')?.textContent?.trim(),
                bounds: rect(row),
                wrapperClass: row.parentElement?.className,
                wrapperOpacity: row.parentElement
                  ? getComputedStyle(row.parentElement).opacity
                  : null,
              }),
            ),
          };
        },
        { x: targetX, y: targetY },
      );
      console.error(`[layers-dnd] drop-target diagnostics: ${JSON.stringify(diagnostics)}`);
      throw error;
    }
  }
  await page.mouse.up();
}

test.describe('Layers Panel — real drag & drop', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = await collectErrors(page);
    await navigateToEditor(page);
    // Seed three sibling rectangles via the canvas.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15_000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('r');
      await page.waitForTimeout(80);
      await page.mouse.move(box.x + 100 + i * 140, box.y + 100 + i * 40);
      await page.mouse.down();
      await page.mouse.move(box.x + 160 + i * 140, box.y + 160 + i * 40);
      await page.mouse.move(box.x + 220 + i * 140, box.y + 220 + i * 40);
      await page.mouse.up();
      await page.waitForTimeout(80);
    }
    await page.getByRole('treeitem').first().waitFor({ timeout: 8000 });
  });

  test.afterEach(async ({ page }) => {
    await expectNoCrashDialog(page);
    expect(errors, 'uncaught page errors during DnD').toEqual([]);
  });

  test('dragging a row above another reorders the tree', async ({ page }) => {
    const names = await rowNames(page);
    expect(names.length).toBeGreaterThanOrEqual(3);
    // Panel shows front-most first: last created ("Rectangle 3") on top.
    const lastName = names[names.length - 1];
    const firstName = names[0];
    if (!lastName || !firstName) throw new Error('missing row names');

    await dragRowToRow(page, lastName, firstName, -0.35, 'layers-dnd-visual-before');
    await page.waitForTimeout(250);

    const after = await rowNames(page);
    expect(after[0]).toBe(lastName);
  });

  test('dragging a row below another shows the after target and reorders the tree', async ({
    page,
  }) => {
    const names = await rowNames(page);
    const firstName = names[0];
    const secondName = names[1];
    if (!firstName || !secondName) throw new Error('missing row names');

    await dragRowToRow(page, firstName, secondName, 0.35, 'layers-dnd-visual-after');
    await page.waitForTimeout(250);

    const after = await rowNames(page);
    expect(after[1]).toBe(firstName);
  });

  test('dropping into a frame reparents the layer', async ({ page }) => {
    // Create an empty frame off to the side of the seeded shapes.
    await drawEmptyFrame(page);

    const frameRow = rowByName(page, 'Frame');
    await frameRow.waitFor({ timeout: 5000 });

    const rectBefore = rowByName(page, 'Rectangle');
    const levelBefore = await rectBefore.getAttribute('aria-level');

    await dragRowToRow(page, 'Rectangle', 'Frame', 0, 'layers-dnd-visual-into');
    await page.waitForTimeout(300);

    const namesAfter = await rowNames(page);
    const frameIdx = namesAfter.findIndex((n) => n.includes('Frame'));
    const rectIdx = namesAfter.findIndex((n) => n.includes('Rectangle'));
    expect(frameIdx).toBeGreaterThanOrEqual(0);
    expect(rectIdx).toBeGreaterThan(frameIdx);

    // Reparent must deepen the row's tree level exactly once.
    const levelAfter = await rowByName(page, 'Rectangle').getAttribute('aria-level');
    const before = Number(levelBefore ?? 1);
    const after = Number(levelAfter ?? 1);
    expect(after).toBe(before + 1);
  });

  test('multi-selection drag moves both rows together', async ({ page }) => {
    // Keep all sibling rows visible for this ordering assertion; virtual-list
    // auto-scroll while a drag is active has its own dedicated coverage.
    await page.setViewportSize({ width: 1280, height: 900 });
    const names = await rowNames(page);
    expect(names.length).toBeGreaterThanOrEqual(3);
    const top = names[0];
    const second = names[1];
    const bottom = names[names.length - 1];
    if (!top || !second || !bottom) throw new Error('missing row names');

    await rowByName(page, top).click();
    await rowByName(page, second).click({ modifiers: ['Control'] });
    await page.waitForTimeout(150);

    await dragRowToRow(page, top, bottom, 0.35, undefined, 'layers-row--drop-after');
    await page.waitForTimeout(250);

    const after = await rowNames(page);
    // Visual order is front-most-first: dragging [top, second] preserves that
    // stacking, so they land as [top, second] at the end.
    expect(after.slice(-2)).toEqual([top, second]);
  });

  test('multi-selection handoff to the canvas stays owned by the canvas', async ({
    page,
  }, testInfo) => {
    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(3);
    const first = rows.nth(0);
    const second = rows.nth(1);
    const firstName = (await first.locator('.layers-row__name').textContent())?.trim();
    const secondName = (await second.locator('.layers-row__name').textContent())?.trim();
    if (!firstName || !secondName) throw new Error('handoff layer names unavailable');
    const canvasObjects = page.getByRole('list', { name: 'Canvas objects' });
    await expect.poll(async () => canvasObjects.getByRole('listitem').count()).toBe(3);
    const readCanvasLabels = () =>
      canvasObjects
        .getByRole('listitem')
        .evaluateAll((items) =>
          items.map((item) => item.getAttribute('aria-label') ?? item.textContent ?? ''),
        );
    const beforeCanvasLabels = await readCanvasLabels();
    const beforeFirst = parseCanvasPosition(beforeCanvasLabels, firstName);
    const beforeSecond = parseCanvasPosition(beforeCanvasLabels, secondName);
    const beforeGap: [number, number] = [
      beforeSecond[0] - beforeFirst[0],
      beforeSecond[1] - beforeFirst[1],
    ];
    await first.click();
    await second.click({ modifiers: ['Control'] });
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2);

    const handle = first.locator('.layers-row__drag-handle');
    const handleBox = await handle.boundingBox();
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!handleBox || !canvasBox) throw new Error('handoff geometry unavailable');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const targetX = canvasBox.x + canvasBox.width * 0.72;
    const targetY = canvasBox.y + canvasBox.height * 0.48;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 12);
    await page.mouse.move(targetX, targetY, { steps: 10 });

    // Read ownership while the pointer is still held. A layer indicator here
    // means the panel retained the gesture after the pointer crossed the
    // surface boundary; the canvas drop state is the terminal owner.
    await expect(page.locator('.editor-canvas--dnd-over')).toBeVisible();
    await expect(
      page.locator('.layers-row--drop-before, .layers-row--drop-after, .layers-row--drop-into'),
    ).toHaveCount(0);
    await expect(page.locator('.drag-overlay')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('layers-to-canvas-dragging.png'),
      fullPage: false,
    });

    await page.mouse.up();
    await expect(page.locator('.drag-overlay')).toHaveCount(0);
    await expect(page.locator('.editor-canvas--dnd-over')).toHaveCount(0);
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2);
    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await expect.poll(async () => canvasObjects.getByRole('listitem').count()).toBe(3);
    await expect
      .poll(async () => {
        const labels = await readCanvasLabels();
        const afterFirst = parseCanvasPosition(labels, firstName);
        const afterSecond = parseCanvasPosition(labels, secondName);
        return [afterSecond[0] - afterFirst[0], afterSecond[1] - afterFirst[1]];
      })
      .toEqual(beforeGap);
    await page.getByTestId('layers-panel').screenshot({
      path: testInfo.outputPath('layers-to-canvas-after.png'),
    });
  });

  test('escape-cancelled drag leaves order untouched and no stuck indicator', async ({ page }) => {
    const names = await rowNames(page);
    const firstName = names[0];
    const secondName = names[1];
    if (!firstName || !secondName) throw new Error('missing row names');

    const from = rowByName(page, firstName);
    const fromBox = await from.boundingBox();
    if (!fromBox) throw new Error('row not visible');
    const handle = from.locator('.layers-row__drag-handle');
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('drag handle not visible');
    const startX = handleBox.x + handleBox.width / 2;
    const startY = fromBox.y + fromBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 12);
    const to = rowByName(page, secondName);
    const toBox = await to.boundingBox();
    if (!toBox) throw new Error('target row not visible');
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect(await rowNames(page)).toEqual(names);
    const stuck = await page
      .locator('.layers-row--drop-before, .layers-row--drop-after, .layers-row--drop-into')
      .count();
    expect(stuck).toBe(0);
  });

  test('locked row cannot be reparented through the Layers panel', async ({ page }) => {
    const rows = page.getByRole('treeitem');
    const source = rows.nth(0);
    const before = await rowNames(page);
    await source.locator('[class*="toggle--locked-off"]').click();
    // A locked source must be shown as an invalid drop *before* release, not
    // silently refused by reparentNode after the fact.
    await dragRowToRow(
      page,
      before[0]!,
      before[1]!,
      0.35,
      'layers-dnd-visual-locked',
      'layers-row--drop-invalid',
    );
    expect(await rowNames(page)).toEqual(before);
  });

  test('locked row skips rename and delete but still toggles visibility', async ({ page }) => {
    const row = page.getByRole('treeitem').first();
    const originalName = (await row.locator('.layers-row__name').textContent())?.trim();
    if (!originalName) throw new Error('locked row name unavailable');
    await row.locator('[class*="toggle--locked-off"]').click();

    await row.click();
    await page.keyboard.press('F2');
    const renameInput = row.locator('input[aria-label^="Rename "]');
    await expect(renameInput).toHaveCount(0);
    await expect(row.locator('.layers-row__name')).toHaveText(originalName);

    await row.click();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('treeitem')).toHaveCount(3);

    const visibility = row.locator('.layers-row__toggle--visibility-on');
    await visibility.click();
    await expect(row).toHaveClass(/layers-row--hidden/);
    await row.locator('.layers-row__toggle--visibility-off').click();
    await expect(row).not.toHaveClass(/layers-row--hidden/);
  });

  test('auto-scrolls a virtualized tree while dragging at the panel edge', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas not found');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('r');
      await page.mouse.move(canvasBox.x + 80 + (i % 4) * 110, canvasBox.y + 80 + (i % 5) * 70);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + 120 + (i % 4) * 110, canvasBox.y + 120 + (i % 5) * 70);
      await page.mouse.up();
      await page.waitForTimeout(100);
    }
    await expect(page.locator('.layers-panel__count')).toHaveText('43');
    await expect(
      page.getByRole('list', { name: 'Canvas objects' }).getByRole('listitem'),
    ).toHaveCount(43);
    expect(await page.getByRole('treeitem').count()).toBeLessThan(43);
    const tree = page.getByRole('tree', { name: /layers/i });
    // At shorter heights the outer rail scrolls to preserve the tree's
    // minimum height. Bring its whole viewport on screen before using its
    // bottom edge as a pointer target.
    await tree.scrollIntoViewIfNeeded();
    // Fractional rail borders can shave a subpixel from the intersection.
    // Prove the actual inset drop point receives input instead of requiring
    // the outer border to have a mathematically exact intersection ratio.
    await expect
      .poll(() =>
        tree.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(bounds.x + bounds.width / 2, bounds.bottom - 4),
          );
        }),
      )
      .toBe(true);
    const source = page.getByRole('treeitem').first();
    const handleBox = await source.locator('.layers-row__drag-handle').boundingBox();
    const treeBox = await tree.boundingBox();
    if (!handleBox || !treeBox) throw new Error('virtualized drag geometry unavailable');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 12);
    for (let i = 0; i < 18; i++) {
      await page.mouse.move(treeBox.x + treeBox.width / 2, treeBox.y + treeBox.height - 4);
      await page.waitForTimeout(45);
    }
    await expect.poll(async () => tree.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page
      .getByTestId('layers-panel')
      .screenshot({ path: test.info().outputPath('layers-dnd-visual-autoscroll.png') });
    await page.mouse.up();
  });

  test('rejects a cycle with visible invalid feedback', async ({ page }) => {
    await drawEmptyFrame(page);

    const frame = rowByName(page, 'Frame');
    await frame.waitFor({ timeout: 5000 });
    await dragRowToRow(page, 'Rectangle', 'Frame', 0);
    const child = rowByName(page, 'Rectangle');
    const before = await rowNames(page);
    await dragRowToRow(
      page,
      'Frame',
      'Rectangle',
      0,
      'layers-dnd-visual-invalid',
      'layers-row--drop-invalid',
    );
    expect(await rowNames(page)).toEqual(before);
    await expect(child).toHaveAttribute('aria-level', '2');
  });
});
