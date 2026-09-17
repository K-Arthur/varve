import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function drawRectangle(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 340, box.y + 300, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
}

async function openRectangleInspector(page: Page): Promise<void> {
  await navigateToEditor(page);
  await drawRectangle(page);
  await page
    .getByRole('treeitem')
    .filter({ hasText: /Rectangle/ })
    .first()
    .click();
  await page.getByRole('tab', { name: 'Design' }).click();
  await expect(page.locator('#insp-tabpanel-properties')).toBeVisible({ timeout: 10_000 });
}

test('keeps Appearance and per-fill opacity geometry aligned across inspector rails', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRectangleInspector(page);

  const appearanceOpacity = page
    .getByRole('group', { name: 'Appearance' })
    .getByRole('spinbutton', { name: 'Opacity (%)' });
  const fillOpacity = page
    .getByRole('group', { name: 'Fill' })
    .getByRole('spinbutton', { name: 'Fill opacity (%)' });
  await expect(appearanceOpacity).toBeVisible();
  await expect(fillOpacity).toBeVisible();

  const metrics = await page.evaluate(() => {
    const read = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        flex: style.flex,
      };
    };
    const appearance = document.querySelector('[aria-label="Opacity (%)"], [aria-label="Opacity"]');
    const fill = document.querySelector('[aria-label="Fill opacity (%)"]');
    const properties = document.querySelector('.insp-fill-row__properties');
    const ancestors = (element: Element | null) => {
      const result: Array<Record<string, unknown>> = [];
      let current = element;
      for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
        const rect = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        result.push({
          tag: current.tagName,
          className: current.className,
          rect: { left: rect.left, right: rect.right, width: rect.width },
          paddingInline: `${style.paddingLeft} ${style.paddingRight}`,
          display: style.display,
          gridTemplateColumns: style.gridTemplateColumns,
        });
      }
      return result;
    };
    return {
      appearance: appearance ? read(appearance) : null,
      fill: fill ? read(fill) : null,
      properties: properties ? read(properties) : null,
      fillAncestors: ancestors(fill),
      appearanceAncestors: ancestors(appearance),
    };
  });
  console.log(`paint geometry baseline: ${JSON.stringify(metrics)}`);

  await page.screenshot({
    path: testInfo.outputPath('paint-geometry-baseline.png'),
    fullPage: false,
  });

  for (const width of [240, 320, 480, 640]) {
    await page.locator('.editor-shell').evaluate((shell, nextWidth) => {
      shell.style.setProperty('--inspector-width', `${nextWidth}px`);
    }, width);
    await expect(page.locator('.editor__inspector-panel')).toHaveCSS('width', `${width}px`);

    const railMetrics = await page.evaluate(() => {
      const appearance = document.querySelector('[aria-label="Opacity (%)"]');
      const fill = document.querySelector('[aria-label="Fill opacity (%)"]');
      const type = document.querySelector('.insp-paint-type-select');
      const row = document.querySelector('.insp-fill-row .insp-paint-row');
      if (!appearance || !fill || !type || !row) return null;
      const read = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      const rowStyle = getComputedStyle(row);
      return {
        appearance: read(appearance),
        fill: read(fill),
        type: read(type),
        row: { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth },
        rowDisplay: rowStyle.display,
      };
    });

    expect(railMetrics, `missing paint geometry at ${width}px`).not.toBeNull();
    expect(railMetrics!.appearance.width).toBe(railMetrics!.fill.width);
    expect(railMetrics!.appearance.height).toBe(railMetrics!.fill.height);
    expect(Math.abs(railMetrics!.appearance.right - railMetrics!.fill.right)).toBeLessThanOrEqual(
      2,
    );
    expect(railMetrics!.type.width).toBeGreaterThanOrEqual(width < 280 ? 64 : 96);
    expect(railMetrics!.row.scrollWidth).toBeLessThanOrEqual(railMetrics!.row.clientWidth + 1);
  }
});

test('supports real fill-stack reorder, keyboard/menu fallback, and overflow removal', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRectangleInspector(page);

  const addFill = async (label: string) => {
    await page.getByRole('button', { name: 'Add fill' }).click();
    await page.getByRole('menuitem', { name: label }).click();
    await page.waitForTimeout(250);
  };

  await addFill('Linear gradient');
  const rows = page.locator('.insp-fill-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('.insp-paint-row__remove-btn')).toHaveCount(0);
  await expect(rows.first().locator('.insp-paint-row__reorder-btn')).toHaveCount(0);

  const handles = page.getByRole('button', { name: /drag fill(?: 2)? to reorder/i });
  await expect(handles).toHaveCount(2);

  // Drag the bottom gradient above the first fill through the real dnd-kit
  // pointer sensor. The row's semantic value is the observable order.
  const firstHandle = handles.nth(0);
  const secondHandle = handles.nth(1);
  const source = await secondHandle.boundingBox();
  const destination = await firstHandle.boundingBox();
  if (!source || !destination) throw new Error('fill drag handles not measurable');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height / 2 - 10,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText('Gradient');
  await expect(rows.nth(1).locator('.insp-swatch__value')).toHaveText(/^#[0-9A-F]{6}$/);

  // The drag is one undoable document operation, not a stream of row swaps.
  await page.keyboard.press('Control+z');
  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText(/^#[0-9A-F]{6}$/);
  await page.keyboard.press('Control+Shift+z');
  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText('Gradient');

  // The same move remains available from the labelled menu for keyboard and
  // users who do not discover direct manipulation.
  await rows.nth(0).getByRole('button', { name: 'Fill actions' }).click();
  await expect(page.getByRole('menuitem', { name: /Move fill down/i })).toBeVisible();
  await page.getByRole('menuitem', { name: /Move fill down/i }).click();
  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText(/^#[0-9A-F]{6}$/);
  await expect(rows.nth(1).locator('.insp-swatch__value')).toHaveText('Gradient');

  // Removal is intentionally in the same labelled overflow menu, so the
  // primary row has one action policy and no destructive icon duplication.
  await rows.nth(1).getByRole('button', { name: 'Fill 2 actions' }).click();
  await page.getByRole('menuitem', { name: /Remove fill 2/i }).click();
  await expect(rows).toHaveCount(1);

  // Removal is also a single reversible operation, including when invoked
  // from the destructive overflow command.
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(rows).toHaveCount(1);

  // Keyboard sensor parity: Space starts the handle gesture, ArrowUp moves
  // within the stack, and Space commits the same document transaction.
  await addFill('Linear gradient');
  const keyboardHandles = page.getByRole('button', { name: /drag fill(?: 2)? to reorder/i });
  await keyboardHandles.nth(1).focus();
  await page.keyboard.press('Space');
  // dnd-kit attaches the keyboard sensor listeners on the next task after
  // activation; give that listener a turn before sending the move key.
  await page.waitForTimeout(50);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(50);
  await page.keyboard.press('Space');
  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText('Gradient');

  const opacity = rows.nth(0).getByRole('spinbutton', { name: 'Fill opacity (%)' });
  await opacity.click();
  await opacity.fill('65');
  await opacity.press('Enter');
  await expect(opacity).toHaveValue('65');

  await page.screenshot({ path: testInfo.outputPath('paint-stack-reordered-and-removed.png') });
});
