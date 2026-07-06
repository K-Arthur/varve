import type { Page } from '@playwright/test';

/** Open the editor from the home screen via New File dialog. */
export async function navigateToEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /new file/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /new file/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page.locator('.editor-shell').waitFor({ timeout: 10000 });
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
}

/** Ensure the timeline panel is visible (Ctrl+Alt+T toggles). */
export async function ensureTimelinePanelVisible(page: Page): Promise<void> {
  const panel = page.locator('.timeline-panel');
  if (!(await panel.isVisible())) {
    await page.keyboard.press('Control+Alt+t');
  }
  await panel.waitFor({ state: 'visible', timeout: 5000 });
}

/** Create a timeline via the exposed timeline panel UI. */
export async function createTimelineInEditor(page: Page): Promise<void> {
  await ensureTimelinePanelVisible(page);
  const createBtn = page
    .getByTestId('timeline-create-empty')
    .or(page.getByTestId('timeline-create'));
  await createBtn.first().click();
  await page.locator('.timeline-ruler').waitFor({ state: 'visible', timeout: 5000 });
}

/** Open File > Export from the menubar. */
export async function openExportDialog(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^Export/i }).click();
  await page.getByRole('dialog', { name: 'Export' }).waitFor({ state: 'visible' });
}
