import { expect, type Page } from '@playwright/test';

/** Built-in side-panel boundaries, with the grid fallback for compact hosts. */
export function panelResizeHandle(page: Page, side: 'layers' | 'inspector') {
  const split = side === 'layers' ? 'layers-main' : 'center-inspector';
  return page
    .getByTestId(`dock-splitter-${split}`)
    .or(page.getByRole('separator', { name: `Resize ${side} panel`, exact: true }));
}

export async function resizePanelTo(
  page: Page,
  side: 'layers' | 'inspector',
  bound: 'minimum' | 'expanded',
) {
  const handle = panelResizeHandle(page, side);
  await handle.focus();
  const docked = (await handle.getAttribute('data-testid'))?.startsWith('dock-splitter-');
  // A dock ratio sizes its FIRST child. Inspector is the second child,
  // whereas the grid fallback directly sizes the named panel in pixels.
  const minimumKey = side === 'inspector' && docked ? 'End' : 'Home';
  await handle.press(bound === 'minimum' ? minimumKey : minimumKey === 'Home' ? 'End' : 'Home');
}

/** Resize the live panel through its pointer splitter, then measure the result. */
export async function resizePanelToWidth(page: Page, side: 'layers' | 'inspector', width: number) {
  const panel = page.locator(`.editor__${side}-panel`);
  const handle = panelResizeHandle(page, side);
  await expect(handle).toBeVisible();
  const [panelBox, handleBox] = await Promise.all([panel.boundingBox(), handle.boundingBox()]);
  if (!panelBox || !handleBox) throw new Error(`Missing ${side} panel resize geometry`);
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const delta = (width - panelBox.width) * (side === 'inspector' ? -1 : 1);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + delta, startY, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await panel.boundingBox())!.width - width), {
      message: `${side} panel must reach its requested ${width}px width`,
    })
    .toBeLessThanOrEqual(1);
}
