import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('keyboardless tablet editing controls', () => {
  test.use({ hasTouch: true, viewport: { width: 1200, height: 750 } });

  test('keeps the modifier popover reachable after landscape-to-portrait reflow', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const coachmarkDismiss = page.getByRole('button', { name: /don't show again/i });
    if (await coachmarkDismiss.isVisible({ timeout: 500 }).catch(() => false)) {
      await coachmarkDismiss.click();
    }

    let latchedConstrain: boolean | undefined;
    for (const viewport of [
      { name: 'landscape', width: 1200, height: 750 },
      { name: 'portrait', width: 600, height: 960 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

      const trigger = page.getByRole('button', { name: 'Tablet editing controls' });
      await expect(trigger).toBeVisible();
      const target = await trigger.boundingBox();
      expect(target?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
      await trigger.click();

      const panel = page.getByRole('dialog', { name: 'Tablet editing controls' });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Constrain movement' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'From centre' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Bypass snapping' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Deep select next tap' })).toBeVisible();

      const modifiers = [
        panel.getByRole('button', { name: 'Constrain movement' }),
        panel.getByRole('button', { name: 'From centre' }),
        panel.getByRole('button', { name: 'Bypass snapping' }),
      ];
      const targets = await Promise.all(modifiers.map((button) => button.boundingBox()));
      for (const target of targets) {
        expect(target?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      const panelBounds = await panel.boundingBox();
      expect(panelBounds).not.toBeNull();
      expect(panelBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect(panelBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((panelBounds?.x ?? 0) + (panelBounds?.width ?? 0)).toBeLessThanOrEqual(
        viewport.width + 1,
      );
      expect((panelBounds?.y ?? 0) + (panelBounds?.height ?? 0)).toBeLessThanOrEqual(
        viewport.height + 1,
      );

      const constrain = panel.getByRole('button', { name: 'Constrain movement' });
      if (latchedConstrain !== undefined) {
        await expect(constrain).toHaveAttribute('aria-pressed', String(latchedConstrain));
      }
      await constrain.click();
      latchedConstrain = !(latchedConstrain ?? false);
      await expect(constrain).toHaveAttribute('aria-pressed', String(latchedConstrain));
      const screenshotPath = testInfo.outputPath(`tablet-controls-${viewport.name}.png`);
      await page.screenshot({
        path: screenshotPath,
        animations: 'disabled',
      });
      await testInfo.attach(`tablet-controls-${viewport.name}`, {
        path: screenshotPath,
        contentType: 'image/png',
      });
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
  });
});
