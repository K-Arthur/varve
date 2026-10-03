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

test('shared Logo and Code panels stay reachable beside the canvas in a narrow window', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  const updateDepthErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Maximum update depth exceeded/i.test(message.text())) {
      updateDepthErrors.push(message.text());
    }
  });
  await page.setViewportSize({ width: 936, height: 908 });
  await navigateToEditor(page);

  // 936 px still fits the visible Layers, canvas, and Inspector panes at
  // their registered minimums. Exercise the actual drawer restore affordance
  // below the responsive breakpoint, then return to the desktop-sized compact
  // layout for the shared-panel geometry checks.
  await page.setViewportSize({ width: 768, height: 908 });
  const showLayers = page.getByRole('button', { name: 'Show layers panel' });
  await expect(showLayers).toBeVisible();
  await showLayers.click();
  await expect(page.locator('#editor-layers-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor-layers-panel')).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 908 });
  await page.setInputFiles('#file-open-input', 'scripts/screenshots/fixtures/poster.varve');
  await expect(page.locator('.editor-tabs__tab').filter({ hasText: 'poster.varve' })).toBeVisible();
  await page
    .getByRole('button', { name: /fit all to viewport/i })
    .first()
    .click();
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 936, height: 908 });
  const zoomInput = page.locator('#status-zoom');
  await zoomInput.fill('30');
  await zoomInput.press('Enter');
  await zoomInput.evaluate((input) => input.blur());

  const code = page.locator('[data-panel="codegen"]');
  const canvas = page.locator('.editor-canvas');
  const logo = page.locator('[data-panel="logo"]');
  await page.keyboard.press('Control+Shift+7');
  await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute(
    'data-mode',
    'design',
  );
  await expect(logo).toBeVisible();
  await logo.getByRole('button', { name: /Start a logo project/i }).click();
  const brandName = logo.getByLabel('Brand name');
  await expect(brandName).toBeVisible();
  await brandName.fill('Varve');
  await brandName.evaluate((input) => input.blur());
  await page.keyboard.press('Control+Shift+8');
  await expect(code).toBeVisible();
  await expect(page.locator('.editor-shell')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForTimeout(700);
  expect(updateDepthErrors).toEqual([]);
  await page.mouse.move(4, 4);
  expect(updateDepthErrors).toEqual([]);
  await page.evaluate(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
  });
  expect(updateDepthErrors).toEqual([]);
  await page.waitForTimeout(300);
  expect(pageErrors).toEqual([]);
  expect(updateDepthErrors).toEqual([]);

  await page.keyboard.press('Control+Shift+6');
  await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute('data-mode', 'email');
  expect(updateDepthErrors).toEqual([]);
  await expect(page.locator('#insp-tab-email')).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByTestId('email-panel').getByRole('button', { name: 'Enable email template' }),
  ).toBeVisible();
  await expect(page.locator('.workspace-bottom-panels__email-preview')).toContainText(
    'Sandboxed browser preview',
  );

  await page.keyboard.press('Control+Shift+8');
  await expect(code).toBeVisible();
  expect(updateDepthErrors).toEqual([]);
  const codeViews = page.getByRole('tablist', { name: 'Code panel views' });
  await expect(codeViews.getByRole('tab', { name: 'Output' })).toBeVisible();
  await expect(codeViews.getByRole('tab', { name: 'Codegen' })).toHaveCount(0);
  const codeBounds = await code.boundingBox();
  const canvasBounds = await canvas.boundingBox();
  const shellBounds = await page.locator('.editor-shell').boundingBox();
  expect(codeBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();
  expect(shellBounds).not.toBeNull();
  expect(canvasBounds!.width).toBeGreaterThanOrEqual(320);
  expect(codeBounds!.x).toBeGreaterThanOrEqual(shellBounds!.x);
  expect(codeBounds!.x + codeBounds!.width).toBeLessThanOrEqual(
    shellBounds!.x + shellBounds!.width + 1,
  );
  // The dock places Code to the right of the canvas. Compare rectangles, not
  // their top edges: the docked panel may extend higher than the canvas body.
  expect(codeBounds!.x).toBeGreaterThanOrEqual(canvasBounds!.x + canvasBounds!.width - 1);
  expect(overlaps(codeBounds!, canvasBounds!)).toBe(false);

  const emailPreview = page.locator('.workspace-bottom-panels__email-preview');
  const previewBounds = await emailPreview.boundingBox();
  expect(previewBounds).not.toBeNull();
  expect(overlaps(codeBounds!, previewBounds!)).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath('email-code-narrow.png'),
    animations: 'disabled',
  });
  expect(updateDepthErrors).toEqual([]);

  await page.keyboard.press('Control+Shift+7');
  await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute(
    'data-mode',
    'design',
  );
  expect(updateDepthErrors).toEqual([]);
  await expect(logo).toBeVisible();
  await expect(brandName).toHaveValue('Varve');
  await expect(page.locator('.editor-shell')).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: /Maximum update depth exceeded/i }),
  ).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(updateDepthErrors).toEqual([]);
  const logoBounds = await logo.boundingBox();
  const designCanvasBounds = await canvas.boundingBox();
  const designShellBounds = await page.locator('.editor-shell').boundingBox();
  const designCodeBounds = await code.boundingBox();
  expect(logoBounds).not.toBeNull();
  expect(designCanvasBounds).not.toBeNull();
  expect(designShellBounds).not.toBeNull();
  expect(designCodeBounds).not.toBeNull();
  expect(designCanvasBounds!.width).toBeGreaterThanOrEqual(320);
  expect(logoBounds!.width).toBeGreaterThanOrEqual(240);
  expect(designCodeBounds!.width).toBeGreaterThanOrEqual(260);
  expect(logoBounds!.x).toBeGreaterThanOrEqual(designShellBounds!.x);
  expect(logoBounds!.x + logoBounds!.width).toBeLessThanOrEqual(designCanvasBounds!.x + 1);
  expect(designCodeBounds!.x).toBeGreaterThanOrEqual(
    designCanvasBounds!.x + designCanvasBounds!.width - 1,
  );
  expect(logoBounds!.y).toBeGreaterThan(80);
  expect(logoBounds!.y + logoBounds!.height).toBeLessThanOrEqual(
    designShellBounds!.y + designShellBounds!.height - 24,
  );
  expect(overlaps(logoBounds!, designCanvasBounds!)).toBe(false);
  expect(overlaps(designCodeBounds!, designCanvasBounds!)).toBe(false);
  expect(overlaps(logoBounds!, designCodeBounds!)).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath('design-logo-narrow.png'),
    animations: 'disabled',
  });
});
