/**
 * Action-state theming — one source of truth for pressed/selected button state.
 *
 * The 2026-09-19 consolidation removed per-feature `--active` class plumbing
 * from the action surfaces (context bar, floating toolbars, selection quick
 * bar, timeline, status bar, crop, spec units, archive, upscale) and made
 * `aria-pressed` / `aria-checked` the single state source. This spec pins the
 * consequence: the painted pressed state must resolve to the shared
 * interaction tokens in every theme, and the converted `NativeSelect` fields
 * must paint the theme surface token rather than a UA default.
 *
 * Evidence artifacts are written to the Playwright output directory.
 */
import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

const THEMES = ['dark', 'light', 'high-contrast'] as const;

/**
 * Resolve a CSS custom property the same way the browser serializes computed
 * colors, so oklch/color-mix tokens compare exactly without hard-coding values.
 */
async function backgroundMatchesToken(page: Page, selector: string, token: string) {
  return page.evaluate(
    ({ selector, token }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      const probe = document.createElement('div');
      probe.style.background = token;
      document.body.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual: getComputedStyle(el).backgroundColor, expected };
    },
    { selector, token },
  );
}

async function ensurePressed(page: Page, selector: string) {
  const control = page.locator(selector);
  if ((await control.getAttribute('aria-pressed')) !== 'true') {
    await control.click();
  }
  await expect(control).toHaveAttribute('aria-pressed', 'true');
}

test.describe('action-state theming', () => {
  test('pressed controls paint theme tokens in dark, light, and high contrast', async ({
    page,
  }, testInfo) => {
    test.setTimeout(900000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 300000 });

    for (const theme of THEMES) {
      await page.evaluate((value) => localStorage.setItem('varve-theme', value), theme);
      await navigateToEditor(page, '/', { startupTimeout: 120000 });
      await page.waitForTimeout(150);

      // Status bar: pressed toggle resolves to the interactive-default token.
      const pixelGridSelector = '[aria-label="Toggle pixel grid"]';
      await ensurePressed(page, pixelGridSelector);
      const status = await backgroundMatchesToken(
        page,
        pixelGridSelector,
        'var(--color-interactive-default)',
      );
      expect(status.expected, `${theme}: --color-interactive-default must resolve`).not.toBe(
        'rgba(0, 0, 0, 0)',
      );
      expect(status.actual, `${theme}: pressed status toggle background`).toBe(status.expected);

      // Floating toolbar: the active tool uses the checked-surface token.
      const activeToolSelector = '.floating-toolbar__btn[aria-pressed="true"]';
      await expect(page.locator(activeToolSelector).first()).toBeVisible();
      const tool = await backgroundMatchesToken(
        page,
        activeToolSelector,
        'var(--color-interactive-checked-surface)',
      );
      expect(tool.expected, `${theme}: --color-interactive-checked-surface must resolve`).not.toBe(
        'rgba(0, 0, 0, 0)',
      );
      expect(tool.actual, `${theme}: active tool background`).toBe(tool.expected);
      await page.screenshot({
        path: testInfo.outputPath(`buttons-${theme}.png`),
        animations: 'disabled',
      });

      // Quick Convert: the canonical NativeSelect keeps the theme surface.
      await openMenu(page, 'File');
      await page.getByRole('menuitem', { name: 'Quick Convert…', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Quick Convert' });
      await expect(dialog).toBeVisible();
      const select = await backgroundMatchesToken(
        page,
        '#quick-convert-output-format',
        'var(--color-surface)',
      );
      expect(select.expected, `${theme}: --color-surface must resolve`).not.toBe(
        'rgba(0, 0, 0, 0)',
      );
      expect(select.actual, `${theme}: quick convert select background`).toBe(select.expected);
      await page.screenshot({
        path: testInfo.outputPath(`quick-convert-${theme}.png`),
        animations: 'disabled',
      });
      await dialog.getByRole('button', { name: 'Close dialog' }).click();
      await expect(dialog).toBeHidden();

      // Restore the default state so the next theme starts clean.
      await page.locator(pixelGridSelector).click();
    }
  });
});
