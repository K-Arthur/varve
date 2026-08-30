/**
 * Real pointer and context-menu workflows for copying node-local appearance
 * stacks between layers. Scene tests cover identity, mask, and node-kind
 * invariants; these browser tests prove the row badge reaches the intended
 * droppable target rather than starting an ordinary layer reparent operation.
 */

import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

type EffectStackKind = 'layer-effects' | 'object-filters';

async function openObjectFilters(page: Page, row: Locator): Promise<void> {
  await row.click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  const disclosure = page.getByRole('button', { name: 'Object Filters', exact: true });
  await expect(disclosure).toBeVisible();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') {
    await disclosure.click();
  }
}

async function addObjectFilter(page: Page, row: Locator, label: string): Promise<void> {
  await openObjectFilters(page, row);
  const select = page.getByLabel('Add Object Filter');
  await expect(select).toBeVisible();
  await select.click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await expect(row.locator('[data-effect-stack-kind="object-filters"]')).toBeVisible();
}

async function seededSourceAndTarget(page: Page): Promise<{ source: Locator; target: Locator }> {
  await seedLayers(page, 2);
  const rows = page.getByRole('treeitem');
  await expect(rows).toHaveCount(2);
  const sourceId = await rows.nth(0).getAttribute('data-node-id');
  const targetId = await rows.nth(1).getAttribute('data-node-id');
  if (!sourceId || !targetId) throw new Error('layer rows are missing durable node ids');
  return {
    source: page.locator(`[role="treeitem"][data-node-id="${sourceId}"]`),
    target: page.locator(`[role="treeitem"][data-node-id="${targetId}"]`),
  };
}

async function dragEffectStack(
  page: Page,
  source: Locator,
  target: Locator,
  kind: EffectStackKind,
  mode: 'replace' | 'append' = 'replace',
  modifierTiming: 'before-pickup' | 'after-activation' = 'before-pickup',
): Promise<void> {
  const badge = source.locator(`[data-effect-stack-kind="${kind}"]`);
  await expect(badge).toBeVisible();
  const sourceBox = await badge.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('effect stack drag geometry is unavailable');

  if (mode === 'append' && modifierTiming === 'before-pickup') await page.keyboard.down('Alt');
  try {
    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    const targetX = targetBox.x + targetBox.width / 2;
    const targetY = targetBox.y + targetBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    if (mode === 'append' && modifierTiming === 'after-activation') {
      await page.mouse.move(startX + 8, startY + 8, { steps: 2 });
      await page.keyboard.down('Alt');
    }
    await page.mouse.move(targetX, targetY, { steps: 8 });

    const stackName = kind === 'layer-effects' ? 'Layer Effects' : 'Object Filters';
    await expect(page.locator('.drag-overlay')).toContainText(
      mode === 'append' ? 'Append' : 'Copy',
    );
    await expect(target).toHaveClass(/layers-row--effect-stack-drop/);
    await expect(
      target.getByText(`${mode === 'append' ? 'Append' : 'Replace'} ${stackName}`),
    ).toBeVisible();
    await expect(page.getByTestId('layers-panel')).toHaveScreenshot(
      `effect-stack-transfer-${mode}-${kind}-hover.png`,
      { maxDiffPixels: 120 },
    );
    await page.mouse.up();
  } finally {
    if (mode === 'append') await page.keyboard.up('Alt');
  }
}

test.describe('Layers Panel — effect stack transfer', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
  });

  test('drags Object Filters to replace a matching target stack without moving the source layer', async ({
    page,
  }) => {
    const { source, target } = await seededSourceAndTarget(page);
    await addObjectFilter(page, source, 'Invert');

    await dragEffectStack(page, source, target, 'object-filters');

    await expect(source.locator('[data-effect-stack-kind="object-filters"]')).toBeVisible();
    await expect(target.locator('[data-effect-stack-kind="object-filters"]')).toBeVisible();
    await target.click();
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);

    await page.keyboard.press('Control+z');
    await expect(target.locator('[data-effect-stack-kind="object-filters"]')).toHaveCount(0);
    await expect(source.locator('[data-effect-stack-kind="object-filters"]')).toBeVisible();
  });

  test('uses Alt/Option drag to append instead of replacing Object Filters', async ({ page }) => {
    const { source, target } = await seededSourceAndTarget(page);
    await addObjectFilter(page, source, 'Invert');
    await addObjectFilter(page, target, 'Blur');

    await dragEffectStack(page, source, target, 'object-filters', 'append');

    await target.click();
    await expect(page.locator('.smart-filters__row')).toHaveCount(2);
    await expect(source.locator('[data-effect-stack-kind="object-filters"]')).toBeVisible();
  });

  test('switches to append when Alt/Option is pressed after pickup', async ({ page }) => {
    const { source, target } = await seededSourceAndTarget(page);
    await addObjectFilter(page, source, 'Invert');
    await addObjectFilter(page, target, 'Blur');

    await dragEffectStack(page, source, target, 'object-filters', 'append', 'after-activation');

    await target.click();
    await expect(page.locator('.smart-filters__row')).toHaveCount(2);
  });

  test('copies just Object Filters through the layer context menu', async ({ page }) => {
    const { source, target } = await seededSourceAndTarget(page);
    await addObjectFilter(page, source, 'Invert');

    await source.click({ button: 'right' });
    const sourceMenu = page.locator('.varve-ctxmenu');
    await expect(sourceMenu).toBeVisible();
    await sourceMenu.getByRole('menuitem', { name: 'Copy Object Filters', exact: true }).click();

    await target.click({ button: 'right' });
    const targetMenu = page.locator('.varve-ctxmenu');
    await expect(targetMenu).toBeVisible();
    await targetMenu.getByRole('menuitem', { name: 'Paste Object Filters', exact: true }).click();

    await expect(source.locator('[data-effect-stack-kind="object-filters"]')).toBeVisible();
    await expect(target.locator('[data-effect-stack-kind="object-filters"]')).toBeVisible();
    await target.click();
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);
  });
});
