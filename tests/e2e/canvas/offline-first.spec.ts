/**
 * Offline-first acceptance: the editor must be fully usable with the network
 * severed, the offline banner must tell the truth (local-first copy, no fake
 * sync), and the on-device Design Assistant must keep working.
 *
 * Network emulation: Chromium-only CDP `Network.emulateNetworkConditions`.
 * Skip (test.skip) on other projects — the offline semantics are
 * renderer-agnostic and covered by unit tests elsewhere.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

async function assertOfflineMenuIsReachable(page: Page) {
  const banner = page.locator('.editor-offline-banner');
  const file = page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true });
  const bannerBox = await banner.boundingBox();
  const fileBox = await file.boundingBox();
  expect(bannerBox).toBeTruthy();
  expect(fileBox).toBeTruthy();
  expect(fileBox!.y).toBeGreaterThanOrEqual(bannerBox!.y + bannerBox!.height);
  await file.click({ timeout: 10000 });
  await expect(
    page.getByRole('menu').getByRole('menuitem', { name: /^Save\b(?! As| a Copy)/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
}

test.describe('offline-first', () => {
  test('editing, saving, reopening and the assistant work with no network', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CDP network emulation is Chromium-only');
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // Exercise the real browser save coordinator without requiring an OS
    // picker in headless Chromium. Durable library mirroring is not mocked.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          let bytes = '';
          return {
            name: 'offline-design.varve',
            queryPermission: async () => 'granted',
            requestPermission: async () => 'granted',
            getFile: async () => new File([bytes], 'offline-design.varve'),
            createWritable: async () => ({
              write: async (data: string) => {
                bytes = data;
              },
              close: async () => {},
            }),
          };
        },
      });
    });
    await navigateToCleanEditor(page);

    // Create a shape so there is real document content.
    await page.keyboard.press('r'); // Rectangle tool
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + 300, box!.y + 200);
    await page.mouse.down();
    await page.mouse.move(box!.x + 420, box!.y + 300);
    await page.mouse.up();

    // Cut the network entirely.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });

    // The banner appears and its copy is honest: local-first, no fake sync.
    const banner = page.locator('.editor-offline-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/all tools keep working locally/i);
    await expect(banner).not.toContainText(/sync/i);
    await assertOfflineMenuIsReachable(page);

    // Undo/redo still work offline (they are local history operations).
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByRole('treeitem')).toHaveCount(1);

    // The on-device Design Assistant still answers (it never used the network).
    await page.keyboard.press('Control+Alt+l'); // Resources panel
    await page.getByRole('tab', { name: 'Assistant' }).click();
    const textarea = page.locator('.ai-panel__textarea');
    await textarea.fill('scan for design debt');
    // Submit from the field so the floating canvas toolbar cannot intercept
    // the send button at this viewport.
    await textarea.press('Control+Enter');
    await expect(page.locator('.ai-panel__bubble--assistant').last()).toContainText(
      /design debt/i,
      { timeout: 10000 },
    );

    // Save the real document while offline through the File menu, then close
    // its editor session and reopen the actual IndexedDB mirror from Home.
    await page
      .getByRole('menubar')
      .getByRole('menuitem', { name: 'File', exact: true })
      .click({ timeout: 10000 });
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: /^Save\b(?! As| a Copy)/ })
      .click({ timeout: 10000 });
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: /^Close Document\b/ })
      .click();
    await expect(page.locator('.varve-home')).toBeVisible();
    await page.getByRole('gridcell').first().dblclick();
    await expect(page.locator('.editor-shell')).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(banner).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('offline-library-reopened.png') });

    // Reconnect: the banner hides again.
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await expect(banner).toHaveAttribute('aria-hidden', 'true');
    expect(pageErrors).toEqual([]);
  });

  for (const viewport of [
    { width: 320, height: 400, textScale: 1 },
    { width: 640, height: 400, textScale: 1 },
    { width: 640, height: 800, textScale: 2 },
  ]) {
    test(`offline notice keeps menus and panel drawers reachable at ${viewport.width}×${viewport.height}, ${viewport.textScale * 100}% text`, async ({
      page,
      context,
    }, testInfo) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await navigateToCleanEditor(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate((scale) => {
        const root = document.documentElement;
        root.style.fontSize = `${Number.parseFloat(getComputedStyle(root).fontSize) * scale}px`;
      }, viewport.textScale);
      await context.setOffline(true);
      await expect(page.locator('.editor-offline-banner')).toBeVisible();
      await assertOfflineMenuIsReachable(page);
      const canvas = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
      expect(canvas!.height).toBeGreaterThanOrEqual(120);
      await page.getByRole('button', { name: 'Show layers panel', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Layers', exact: true });
      await expect(drawer).toBeVisible();
      // Visible becomes true during the slide-in transition. Wait for the
      // actual drawer to reach its on-screen position before checking and
      // capturing the layout, rather than photographing a partial frame.
      await expect.poll(async () => (await drawer.boundingBox())!.x).toBeGreaterThanOrEqual(-1);
      const drawerBox = await drawer.boundingBox();
      const tabs = await page.getByRole('tablist', { name: 'Open documents' }).boundingBox();
      expect(drawerBox!.y).toBeGreaterThanOrEqual(tabs!.y + tabs!.height - 1);
      expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      await page.mouse.move(viewport.width / 2, 5);
      await testInfo.attach('offline-layout-geometry', {
        body: JSON.stringify({ viewport, drawer: drawerBox, tabs, canvas }),
        contentType: 'application/json',
      });
      await page.screenshot({ path: testInfo.outputPath('offline-compact-drawer.png') });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Dismiss offline notice' }).click();
      await expect(page.locator('.editor-offline-banner')).toHaveAttribute('aria-hidden', 'true');
      await expect
        .poll(() =>
          page
            .locator('.editor-shell')
            .evaluate((shell) =>
              getComputedStyle(shell).getPropertyValue('--editor-offline-notice-height').trim(),
            ),
        )
        .toBe('0px');
      expect(pageErrors).toEqual([]);
    });
  }
});
