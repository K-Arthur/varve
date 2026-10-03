import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

function overlaps(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

test('installed library selection and uninstall stay separate keyboard controls', async ({
  page,
}) => {
  await navigateToEditor(page);
  await page.keyboard.press('Control+Alt+L');

  const resources = page.locator('.resources-panel');
  await expect(resources).toBeVisible();
  await expect(page.locator('.editor__library-panel')).not.toHaveAttribute('aria-modal', 'true');
  await resources.getByRole('tab', { name: 'Libraries' }).click();
  const manager = resources.getByRole('region', { name: 'Library manager' });

  const fileChooserPromise = page.waitForEvent('filechooser');
  await manager.getByRole('button', { name: 'Import File' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'review-library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        library: {
          id: 'lib-review-controls',
          name: 'Review Library',
          description: 'Browser control review',
          version: '1.0.0',
          components: [],
          styles: [],
          nodeBundles: {},
          publishedAt: '2026-09-25T00:00:00.000Z',
        },
      }),
    ),
  });

  const select = manager.getByRole('button', { name: 'View Review Library details' });
  const uninstall = manager.getByRole('button', { name: 'Uninstall Review Library' });
  await expect(select).toBeVisible();
  await expect(uninstall).toBeVisible();
  await expect(manager.locator('.library-panel__item button button')).toHaveCount(0);

  await select.focus();
  await page.keyboard.press('Enter');
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  const version = manager.getByText('Version: 1.0.0');
  await expect(version).toBeVisible();
  await expect(version).toBeInViewport();
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.editor__library-panel');
    const toolbar = document.querySelector<HTMLElement>('.floating-toolbar');
    if (!panel || !toolbar) throw new Error('Resources panel or floating toolbar is missing');
    const rect = (element: HTMLElement) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      panel: rect(panel),
      toolbar: rect(toolbar),
      panelZ: getComputedStyle(panel).zIndex,
      toolbarZ: getComputedStyle(toolbar).zIndex,
    };
  });
  expect(overlaps(geometry.toolbar, geometry.panel), JSON.stringify(geometry)).toBe(false);
  expect(
    await version.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === element || element.contains(hit);
    }),
  ).toBe(true);

  if (process.env.VARVE_DESIGN_VISUAL_QA_DIR) {
    await page.screenshot({
      path: `${process.env.VARVE_DESIGN_VISUAL_QA_DIR}/library-panel-after.png`,
    });
  }

  const resize = resources.getByRole('separator', { name: 'Resize resources panel' });
  await resize.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => {
      const bounds = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.editor__library-panel');
        const toolbar = document.querySelector<HTMLElement>('.floating-toolbar');
        if (!panel || !toolbar) throw new Error('Resources panel or floating toolbar is missing');
        const rect = (element: HTMLElement) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        };
        return { panel: rect(panel), toolbar: rect(toolbar) };
      });
      return !overlaps(bounds.toolbar, bounds.panel);
    })
    .toBe(true);

  await uninstall.focus();
  await page.keyboard.press('Space');
  await expect(manager.getByText('No libraries installed')).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Import File' })).toBeFocused();

  await page.keyboard.press('Control+z');
  await expect(select).toBeVisible();
});
