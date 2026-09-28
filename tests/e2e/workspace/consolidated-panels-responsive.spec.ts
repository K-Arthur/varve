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
  await page.setViewportSize({ width: 936, height: 908 });

  await page.keyboard.press('Control+Shift+6');
  await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute('data-mode', 'email');
  await expect(page.locator('#insp-tab-email')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.workspace-bottom-panels__email-preview')).toContainText(
    /Enable the email template from the Email authoring tab/,
  );

  await page.keyboard.press('Control+Shift+8');
  const code = page.locator('[data-panel="codegen"]');
  const canvas = page.locator('.editor-canvas');
  await expect(code).toBeVisible();
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
  expect(codeBounds!.y).toBeGreaterThan(canvasBounds!.y - 1);

  const emailPreview = page.locator('.workspace-bottom-panels__email-preview');
  const previewBounds = await emailPreview.boundingBox();
  expect(previewBounds).not.toBeNull();
  expect(overlaps(codeBounds!, previewBounds!)).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath('email-code-narrow.png'),
    animations: 'disabled',
  });

  await page.keyboard.press('Control+Shift+7');
  await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute(
    'data-mode',
    'design',
  );
  const logo = page.locator('[data-panel="logo"]');
  await expect(logo).toBeVisible();
  await page.keyboard.press('Control+Shift+8');
  await expect(code).toBeVisible();
  const logoBounds = await logo.boundingBox();
  const designCanvasBounds = await canvas.boundingBox();
  const designShellBounds = await page.locator('.editor-shell').boundingBox();
  const designCodeBounds = await code.boundingBox();
  expect(logoBounds).not.toBeNull();
  expect(designCanvasBounds).not.toBeNull();
  expect(designShellBounds).not.toBeNull();
  expect(designCodeBounds).not.toBeNull();
  expect(logoBounds!.x).toBeGreaterThanOrEqual(designShellBounds!.x);
  expect(logoBounds!.x + logoBounds!.width).toBeLessThanOrEqual(
    designShellBounds!.x + designShellBounds!.width + 1,
  );
  expect(logoBounds!.y).toBeGreaterThan(80);
  expect(logoBounds!.y + logoBounds!.height).toBeLessThanOrEqual(
    designShellBounds!.y + designShellBounds!.height - 24,
  );
  expect(overlaps(logoBounds!, designCodeBounds!)).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath('design-logo-narrow.png'),
    animations: 'disabled',
  });
});
