/**
 * Human-review capture matrix for application theme chrome.
 *
 * These are deliberately review artifacts, not self-approving snapshot
 * baselines. Set VARVE_THEME_VISUAL_QA_DIR to retain the images at a known
 * path, open them after the run, and record the visual judgment separately.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

type ThemePreference = 'system' | 'light' | 'dark' | 'high-contrast';

const outputDir =
  process.env.VARVE_THEME_VISUAL_QA_DIR ?? `test-results/theme-visual-qa-${process.pid}`;

async function seedTheme(
  page: import('@playwright/test').Page,
  preference: ThemePreference,
  colorScheme: 'light' | 'dark',
) {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.addInitScript((value: ThemePreference) => {
    localStorage.setItem('varve-theme', value);
  }, preference);
}

async function openAppearanceSettings(page: import('@playwright/test').Page) {
  await navigateToEditor(page);
  await page.evaluate(() => {
    const file = [...document.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === 'File',
    );
    (file as HTMLElement | undefined)?.click();
  });
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const dialog = page.locator('dialog.varve-dialog--settings[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Theme' })).toBeVisible();
  return dialog;
}

for (const scenario of [
  { preference: 'light', colorScheme: 'dark' },
  { preference: 'dark', colorScheme: 'light' },
  { preference: 'high-contrast', colorScheme: 'light' },
  { preference: 'system', colorScheme: 'dark' },
] as const) {
  test(`${scenario.preference}: editor and Appearance settings`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedTheme(page, scenario.preference, scenario.colorScheme);
    const dialog = await openAppearanceSettings(page);

    const expectedTheme =
      scenario.preference === 'system' ? scenario.colorScheme : scenario.preference;
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', scenario.preference);
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
    await expect(dialog.getByRole('combobox', { name: 'Theme' })).toContainText(
      scenario.preference === 'high-contrast'
        ? 'High Contrast'
        : `${scenario.preference[0]!.toUpperCase()}${scenario.preference.slice(1)}`,
    );

    await page.screenshot({
      path: `${outputDir}/editor-settings-${scenario.preference}.png`,
      fullPage: false,
    });
  });
}

test('high-contrast: detached-window invalid-route state', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await seedTheme(page, 'high-contrast', 'light');
  await page.goto('/?surface=panel-window');

  await expect(page.getByRole('main', { name: 'Panel window unavailable' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  await page.screenshot({
    path: `${outputDir}/auxiliary-invalid-route-high-contrast.png`,
    fullPage: false,
  });
});

/**
 * Selection and layers-panel review case.
 *
 * The empty-document captures above never exercise a selected overlay, a layers
 * row thumbnail, or a portal-rendered menu, which is where theme bugs hide:
 * selection marks must stay visible over artwork, row placeholders must stay
 * visible against the row, and a menu must inherit the root theme rather than
 * the surface it was opened from. Capture all three per theme.
 *
 * Also asserts the observable contract, so a regression fails the run rather
 * than only looking wrong in a retained image:
 *   - the selection overlay exists and its stroke resolves to the canvas
 *     selection role (not the interface accent, which the document-derived
 *     accent mode may re-tint),
 *   - the opened menu is themed (its background is not transparent).
 */
for (const theme of ['light', 'dark', 'high-contrast'] as const) {
  test(`${theme}: selection overlay, layers row, and open menu`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedTheme(page, theme, theme === 'dark' ? 'dark' : 'light');
    await navigateToEditor(page);

    await page.keyboard.press('r');
    await dragOnCanvas(page, 180, 200, 460, 420);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Select so the transform overlay, handles, and row selection state render.
    // Deliberately leave the selection in place: an escaped selection would
    // hide the very overlay this capture exists to review.
    await page.keyboard.press('v');
    await dragOnCanvas(page, 300, 300, 320, 320);
    await page.waitForTimeout(150);

    /* The selection overlay marks read the dedicated canvas token rather than
     * the interface accent, so the optional document-derived accent mode can
     * never recolour the marks users steer by. Assert the token resolves to a
     * real paint, not just that an element exists. */
    const selectionMark = page
      .locator('svg[role="presentation"] [stroke="var(--color-canvas-selection)"]')
      .first();
    await expect(selectionMark).toBeVisible({ timeout: 10000 });
    const resolvedStroke = await selectionMark.evaluate(
      (element) => getComputedStyle(element).stroke,
    );
    expect(resolvedStroke, 'canvas selection token must resolve to a paint').not.toBe('none');
    expect(resolvedStroke).not.toBe('');

    await page.screenshot({
      path: `${outputDir}/${theme}-canvas-selection-layers.png`,
      fullPage: false,
    });

    const collapseLayers = page.getByRole('button', {
      name: /Collapse Layers panel/i,
    });
    await expect(collapseLayers, 'Layers panel collapse control must be visible').toBeVisible();
    await collapseLayers.click();
    await expect(page.locator('[data-panel="layers"]')).toHaveAttribute('data-collapsed', 'true');
    await page.screenshot({
      path: `${outputDir}/${theme}-canvas-selection-layers-collapsed.png`,
      fullPage: false,
    });
    const expandLayers = page.getByRole('button', { name: /Expand layers panel/i });
    await expect(expandLayers, 'Layers panel restore control must be visible').toBeVisible();
    await expandLayers.click();
    await expect(page.locator('[data-panel="layers"]')).not.toHaveAttribute('data-collapsed');

    // Portal check: the menubar menu renders in a floating layer.
    await page.evaluate(() => {
      const trigger = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === 'View',
      );
      (trigger as HTMLElement | undefined)?.click();
    });
    const menu = page.locator('[role="menu"]:visible').first();
    await expect(menu).toBeVisible();

    /* The real portal check: an open menu must be *on the correct side of the
     * theme*, not merely painted. A menu that keeps a light surface under
     * [data-theme="dark"] is the classic symptom of a floating layer rendered
     * outside the themed root.
     *
     * Resolving the paint through a canvas is the only reliable read: computed
     * colours come back as oklch(), and string parsing silently fell through to
     * an ancestor (a teal hover row) instead of the menu surface. Painting the
     * colour and reading the pixel uses the same path the compositor does. */
    const luminance = await menu.evaluate((element) => {
      const toLinear = (channel: number) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      const ctx = probe.getContext('2d');
      if (!ctx) return null;
      let node: HTMLElement | null = element as HTMLElement;
      while (node) {
        const value = getComputedStyle(node).backgroundColor;
        if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = value;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          if (!a) {
            node = node.parentElement;
            continue;
          }
          return 0.2126 * toLinear(r!) + 0.7152 * toLinear(g!) + 0.0722 * toLinear(b!);
        }
        node = node.parentElement;
      }
      return null;
    });
    expect(luminance, 'menu background must resolve').not.toBeNull();
    if (theme === 'light') {
      expect(luminance!, 'light-theme menu must be a light surface').toBeGreaterThan(0.5);
    } else {
      expect(luminance!, `${theme} menu must be a dark surface`).toBeLessThan(0.25);
    }
    await page.screenshot({
      path: `${outputDir}/${theme}-open-menu.png`,
      fullPage: false,
    });
  });
}
