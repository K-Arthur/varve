/**
 * Auxiliary panel routing in the production `/try/` build.
 *
 * Unlike the root-based development server, the public demo is hosted below
 * the marketing site. A popup that navigates to `/index.html` lands on the
 * marketing origin instead of mounting the auxiliary app, so this workflow
 * must be exercised against the staged production artifact.
 */
import { expect, test } from '@playwright/test';

const DEMO_DIST_URL = process.env.VARVE_DEMO_DIST_URL?.replace(/\/+$/, '');

test('detached panel opens, hydrates and reattaches inside the /try app base', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  test.skip(
    !DEMO_DIST_URL,
    'set VARVE_DEMO_DIST_URL when running against the staged production /try build',
  );

  await page.goto(`${DEMO_DIST_URL}/try/`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-varve-editor-ready="true"]').waitFor({ timeout: 90_000 });

  const sourcePanel = page.locator('.editor__layers-panel .layers-panel');
  const detach = page.getByTestId('detach-layers');
  await expect(sourcePanel).toBeVisible({ timeout: 30_000 });
  await expect(detach).toBeVisible();

  const popupPage = context.waitForEvent('page', { timeout: 30_000 });
  await detach.click();
  const popup = await popupPage;

  await expect.poll(() => new URL(popup.url()).pathname).toBe('/try/index.html');
  // Auxiliary windows mount the lightweight AuxiliaryShell, not App.tsx's
  // editor-ready wrapper. Wait for the real hosted panel and its transferred
  // document instead of the main-window-only readiness marker.
  const auxiliaryLayers = popup.locator('section[data-panel-root="layers"]');
  await expect(auxiliaryLayers).toBeVisible({
    timeout: 90_000,
  });
  const layerTree = auxiliaryLayers.getByRole('tree', { name: 'Layers' });
  await expect(layerTree).toBeVisible({ timeout: 30_000 });
  await expect(layerTree.getByRole('treeitem')).toHaveCount(10);
  await expect(layerTree.getByRole('treeitem', { name: /Poster/ })).toBeVisible();
  await expect(sourcePanel).toBeHidden({ timeout: 30_000 });

  const popupClosed = popup.waitForEvent('close', { timeout: 30_000 });
  await popup.getByTestId('reattach-panel').click();
  await popupClosed.catch(() => undefined);
  await expect(sourcePanel).toBeVisible({ timeout: 30_000 });
});
