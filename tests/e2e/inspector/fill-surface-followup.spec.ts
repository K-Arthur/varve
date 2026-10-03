import { expect, type Page, test } from '@playwright/test';
import { resizePanelToWidth } from '../helpers/panel-resize';
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

function expectPointerCenterInViewport(
  center: { x: number; y: number },
  viewport: { width: number; height: number },
  description: string,
): void {
  expect(center.x, `${description} center x`).toBeGreaterThanOrEqual(0);
  expect(center.x, `${description} center x`).toBeLessThan(viewport.width);
  expect(center.y, `${description} center y`).toBeGreaterThanOrEqual(0);
  expect(center.y, `${description} center y`).toBeLessThan(viewport.height);
}

test('keeps opacity controls readable in their row tracks across inspector rails', async ({
  page,
}) => {
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

  for (const width of [240, 320, 480, 640]) {
    await resizePanelToWidth(page, 'inspector', width);

    const railMetrics = await page.evaluate(() => {
      const appearance = document.querySelector('[aria-label="Opacity (%)"]');
      const fill = document.querySelector('[aria-label="Fill opacity (%)"]');
      const type = document.querySelector('.insp-paint-type-select');
      const row = document.querySelector('.insp-fill-row .insp-paint-row');
      const fillCard = document.querySelector('.insp-fill-row');
      if (!appearance || !fill || !type || !row || !fillCard) return null;
      const read = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      const controlMetrics = (element: Element) => {
        const input = element as HTMLInputElement;
        const control = element.closest('.insp-field__control');
        if (!control) throw new Error('opacity field has no owning control track');
        const style = getComputedStyle(input);
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return {
          track: read(control),
          readableWidth:
            context.measureText(input.value).width +
            Number.parseFloat(style.paddingLeft) +
            Number.parseFloat(style.paddingRight) +
            Number.parseFloat(style.borderLeftWidth) +
            Number.parseFloat(style.borderRightWidth),
        };
      };
      const rowStyle = getComputedStyle(row);
      const cardStyle = getComputedStyle(fillCard);
      return {
        appearance: read(appearance),
        fill: read(fill),
        appearanceControl: controlMetrics(appearance),
        fillControl: controlMetrics(fill),
        type: read(type),
        row: { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth },
        rowDisplay: rowStyle.display,
        // .insp-fill-row is a bordered card (visually groups one paint's
        // controls, including the drag handle used for reordering) with its
        // own right padding/border — the per-fill value sits inset from the
        // section edge by exactly that card inset, not flush with it like a
        // plain field row. That inset is real, deliberate, and independent
        // of this assertion, so we measure it instead of assuming zero.
        cardInsetRight:
          Number.parseFloat(cardStyle.paddingRight) + Number.parseFloat(cardStyle.borderRightWidth),
      };
    });

    expect(railMetrics, `missing paint geometry at ${width}px`).not.toBeNull();
    // Appearance fills its inline row column; per-fill opacity has a stacked
    // label in the paint property's fixed track. Each must fill its own track
    // and display the complete value, rather than borrowing the other's width.
    for (const [input, control] of [
      [railMetrics!.appearance, railMetrics!.appearanceControl],
      [railMetrics!.fill, railMetrics!.fillControl],
    ] as const) {
      expect(Math.abs(input.width - control.track.width)).toBeLessThanOrEqual(2);
      expect(input.width).toBeGreaterThanOrEqual(control.readableWidth);
      expect(input.left).toBeGreaterThanOrEqual(control.track.left - 1);
      expect(input.right).toBeLessThanOrEqual(control.track.right + 1);
    }
    expect(railMetrics!.appearance.height).toBe(railMetrics!.fill.height);
    const observedGap = railMetrics!.appearance.right - railMetrics!.fill.right;
    expect(Math.abs(observedGap - railMetrics!.cardInsetRight)).toBeLessThanOrEqual(2);
    expect(railMetrics!.type.width).toBeGreaterThanOrEqual(width < 280 ? 64 : 96);
    expect(railMetrics!.row.scrollWidth).toBeLessThanOrEqual(railMetrics!.row.clientWidth + 1);
  }
});

test('supports pointer and keyboard fill-stack reorder plus fill removal', async ({
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
  await secondHandle.scrollIntoViewIfNeeded();
  const source = await secondHandle.boundingBox();
  const destination = await firstHandle.boundingBox();
  if (!source || !destination) throw new Error('fill drag handles not measurable');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('browser viewport size unavailable');
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const destinationCenter = {
    x: destination.x + destination.width / 2,
    y: destination.y + destination.height / 2,
  };
  expectPointerCenterInViewport(sourceCenter, viewport, 'source handle');
  expectPointerCenterInViewport(destinationCenter, viewport, 'destination handle');
  await page.mouse.move(sourceCenter.x, sourceCenter.y);
  await page.mouse.down();
  await page.mouse.move(destinationCenter.x, destinationCenter.y - 10, { steps: 8 });
  await page.mouse.up();

  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText('Gradient');
  await expect(rows.nth(1).locator('.insp-swatch__value')).toHaveText(/^#[0-9A-F]{6}$/);

  // The drag is one undoable document operation, not a stream of row swaps.
  await page.keyboard.press('Control+z');
  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText(/^#[0-9A-F]{6}$/);
  await page.keyboard.press('Control+Shift+z');
  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText('Gradient');

  // The direct row controls provide a non-drag path for pointer, keyboard,
  // and touch users; they must produce the same single-step stack update.
  await rows.nth(0).getByRole('button', { name: 'Move fill down' }).click();
  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText(/^#[0-9A-F]{6}$/);
  await expect(rows.nth(1).locator('.insp-swatch__value')).toHaveText('Gradient');
  await page.keyboard.press('Control+z');
  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText('Gradient');
  await page.keyboard.press('Control+Shift+z');
  await expect(rows.nth(1).locator('.insp-swatch__value')).toHaveText('Gradient');

  // Removal remains an explicit, named row action; the low-frequency Fill
  // actions menu contains blend/link/harmony commands, not stack reordering.
  await rows.nth(1).getByRole('button', { name: 'Remove fill 2' }).click();
  await expect(rows).toHaveCount(1);

  // Removal is a single reversible document operation.
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(rows).toHaveCount(1);

  // The named row action is keyboard-accessible as well as pointer-accessible.
  await addFill('Linear gradient');
  const moveDown = rows.nth(0).getByRole('button', { name: 'Move fill down' });
  await moveDown.focus();
  await page.keyboard.press('Enter');
  await expect(rows.nth(0).locator('.insp-swatch__value')).toHaveText('Gradient');

  const opacity = rows.nth(0).getByRole('spinbutton', { name: 'Fill opacity (%)' });
  await opacity.click();
  await opacity.fill('65');
  await opacity.press('Enter');
  await expect(opacity).toHaveValue('65');

  await page.screenshot({ path: testInfo.outputPath('paint-stack-reordered-and-removed.png') });
});
