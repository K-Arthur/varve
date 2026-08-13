/**
 * Offline-first acceptance: the editor must be fully usable with the network
 * severed, the offline banner must tell the truth (local-first copy, no fake
 * sync), and the on-device Design Assistant must keep working.
 *
 * Network emulation: Chromium-only CDP `Network.emulateNetworkConditions`.
 * Skip (test.skip) on other projects — the offline semantics are
 * renderer-agnostic and covered by unit tests elsewhere.
 */
import { expect, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

test.describe('offline-first', () => {
  test('editing, saving, reopening and the assistant work with no network', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CDP network emulation is Chromium-only');
    await navigateToCleanEditor(page);

    // Create a shape so there is real document content.
    await page.keyboard.press('r'); // Rectangle tool
    const canvas = page.locator('canvas').first();
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
    const banner = page.getByRole('status');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/all tools keep working locally/i);
    await expect(banner).not.toContainText(/sync/i);

    // Undo/redo still work offline (they are local history operations).
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');

    // The on-device Design Assistant still answers (it never used the network).
    await page.keyboard.press('Control+Alt+l'); // Resources panel
    await page.getByRole('tab', { name: 'Assistant' }).click();
    const textarea = page.getByLabel('Chat message');
    await textarea.fill('scan for design debt');
    await page.getByLabel('Send message').click();
    await expect(page.locator('.ai-panel__bubble--assistant').last()).toContainText(
      /design debt/i,
      { timeout: 10000 },
    );

    // Reconnect: the banner hides again.
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await expect(banner).toBeHidden();
  });
});
