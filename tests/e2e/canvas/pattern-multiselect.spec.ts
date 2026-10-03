import { expect, test } from '@playwright/test';
import { selectFillType } from '../helpers/editor-helpers';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToCleanEditor } from '../helpers/nav';

test('pattern placement shows mixed values and applies absolute versus relative edits', async ({
  page,
}) => {
  test.setTimeout(120000);
  await navigateToCleanEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('canvas is not available');

  const panelWidth = Math.min(150, Math.floor(bounds.width / 4));
  const panelHeight = Math.min(170, Math.floor(bounds.height / 2));
  const startX = bounds.x + Math.max(24, (bounds.width - panelWidth * 2 - 70) / 2);
  const startY = bounds.y + Math.max(70, (bounds.height - panelHeight) / 2);
  const panels = [
    { x: startX, y: startY },
    { x: startX + panelWidth + 70, y: startY },
  ];

  for (const panel of panels) {
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(panel.x, panel.y);
    await page.mouse.down();
    await page.mouse.move(panel.x + panelWidth, panel.y + panelHeight);
    await page.mouse.up();
  }

  await page.keyboard.press('v');
  const rows = page.getByRole('treeitem');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2);
  await selectFillType(page, 'Pattern');
  await page.getByRole('button', { name: /generate pattern/i }).click();

  const setField = async (row: number, name: string, value: number) => {
    await rows.nth(row).click();
    const input = page.getByRole('spinbutton', { name, exact: true });
    await input.fill(String(value));
    await input.press('Enter');
    await expect(input).toHaveValue(String(value));
  };
  await setField(0, 'Rotation (deg)', 10);
  await setField(1, 'Rotation (deg)', 30);
  await setField(0, 'Phase across (px)', -3);
  await setField(1, 'Phase across (px)', 11);

  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2);

  const phase = page.getByRole('spinbutton', { name: 'Phase across (px)', exact: true });
  const rotation = page.getByRole('spinbutton', { name: 'Rotation (deg)', exact: true });
  await expect(phase).toHaveAttribute('aria-valuetext', 'Mixed values');
  await expect(rotation).toHaveAttribute('aria-valuetext', 'Mixed values');
  await expect(page.getByText(/Preview shows the first selected fill/)).toBeVisible();
  await rotation.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: evidencePath('pattern-system-2026-09-30/app-multiselect-placement.png'),
  });

  await phase.fill('-6');
  await phase.press('Enter');
  await expect(phase).toHaveValue('-6');
  await expect(phase).toHaveAttribute('aria-valuetext', '-6px');
  await rotation.press('ArrowUp');
  await expect(rotation).toHaveAttribute('aria-valuetext', 'Mixed values');
});
