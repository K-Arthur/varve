import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const fixture = readFileSync('tests/e2e/fixtures/published-v021/poster-embedded.varve');
async function chooser(page: Page, action: 'Open' | 'Import', keyboard = false) {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  const item = page
    .getByRole('menu', { name: 'File', exact: true })
    .getByRole('menuitem', { name: new RegExp(`^${action}…`) });
  const pending = page.waitForEvent('filechooser', { timeout: 10000 });
  if (keyboard) {
    await expect(
      page.getByRole('menu', { name: 'File', exact: true }).getByRole('menuitem').first(),
    ).toBeFocused();
    for (let step = 0; step < 10; step += 1) {
      if (await item.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('ArrowDown');
    }
    await expect(item).toBeFocused();
    await page.keyboard.press('Enter');
  } else await item.click();
  const result = await pending;
  expect(await result.element().getAttribute('id')).toBe(
    action === 'Open' ? 'file-open-input' : 'file-import-input',
  );
  return result;
}

test.beforeEach(async ({ page }) => {
  await navigateToEditor(page);
});
test('real pointer Open survives cancellation and repeated Unicode selection', async ({ page }) => {
  const tabs = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
  const initial = await tabs.count();
  await (await chooser(page, 'Open')).setFiles([]);
  await expect(tabs).toHaveCount(initial);
  const file = { name: 'Migrated save β.varve', mimeType: 'application/json', buffer: fixture };
  await (await chooser(page, 'Open')).setFiles(file);
  await expect(tabs).toHaveCount(initial + 1);
  await expect(page.getByRole('treeitem', { name: /^Published embedded image/ })).toBeVisible();
  await (await chooser(page, 'Open')).setFiles(file);
  await expect(tabs).toHaveCount(initial + 2);
  await expect(page.getByRole('treeitem', { name: /^Published embedded image/ })).toBeVisible();
});
test('keyboard Open and pointer Import activate separate real browser pickers', async ({
  page,
}) => {
  const document = await chooser(page, 'Open', true);
  expect(await document.element().getAttribute('accept')).toMatch(/\.varve/);
  await document.setFiles([]);
  const artwork = await chooser(page, 'Import');
  expect(await artwork.element().getAttribute('accept')).toMatch(/\.png/);
  expect(await artwork.element().getAttribute('accept')).not.toMatch(/\.varve/);
  await artwork.setFiles([]);
});
