import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

// Scoped scans for the dialog family touched by the PromptDialog/ConfirmDialog
// migration onto @varve/ui's shared Dialog/AlertDialog (see git history for
// packages/editor/src/components/PromptDialog.tsx) and the PageNav context
// menu's new "Move page left/right" commands.

test.describe('Page context menu - axe-core scan', () => {
  test('publishing page navigation settles before pointer input', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await navigateToEditor(page);
    await page.getByRole('radio', { name: 'Print workspace' }).click();
    await page.getByRole('button', { name: 'Add publishing page' }).click();
    const pageTab = page.getByRole('tab', { name: /^Publishing page:/i }).first();
    await expect(pageTab).toBeVisible();
    await page.waitForTimeout(1000);

    const samples = await pageTab.evaluate(async (element) => {
      const samples: Array<{
        x: number;
        y: number;
        width: number;
        height: number;
        position: string;
      }> = [];
      for (let frame = 0; frame < 90; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const rect = element.getBoundingClientRect();
        const navigator = element.closest('.page-nav-container');
        samples.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          position: navigator ? getComputedStyle(navigator).position : 'missing',
        });
      }
      return samples;
    });
    const geometryPath = testInfo.outputPath('page-navigator-geometry.json');
    await writeFile(geometryPath, JSON.stringify(samples, null, 2));
    await testInfo.attach('page-navigator-geometry', {
      path: geometryPath,
      contentType: 'application/json',
    });
    for (const axis of ['x', 'y', 'width', 'height'] as const) {
      const values = samples.map((sample) => sample[axis]);
      expect(
        Math.max(...values) - Math.min(...values),
        `settled publishing tab ${axis}`,
      ).toBeLessThan(0.5);
    }
    await pageTab.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Rename Page', exact: true })).toBeVisible();
  });

  test('page tab context menu has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await page.getByRole('radio', { name: 'Print workspace' }).click();

    const historyWarnings: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('updateDoc called outside transaction')) {
        historyWarnings.push(message.text());
      }
    });
    await page.getByRole('button', { name: 'Add publishing page' }).click();
    const pageTab = page.getByRole('tab', { name: /^Publishing page:/i }).first();
    await pageTab.waitFor({ state: 'visible' });
    expect(historyWarnings).toEqual([]);
    await pageTab.click({ button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Move page left' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[role="menu"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('PromptDialog - axe-core scan', () => {
  test('rename-page prompt has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await page.getByRole('radio', { name: 'Print workspace' }).click();

    await page.getByRole('button', { name: 'Add publishing page' }).click();
    const pageTab = page.getByRole('tab', { name: /^Publishing page:/i }).first();
    await pageTab.waitFor({ state: 'visible' });
    await pageTab.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename page' }).click();

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    // Regression guard for the Enter-key/label fixes: the input must have an
    // accessible name and must not be role-less.
    await expect(dialog.getByRole('textbox')).toHaveAccessibleName(/./);

    const results = await new AxeBuilder({ page })
      .include('dialog[open]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
