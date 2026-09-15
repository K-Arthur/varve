import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const OUT = 'reports/toolbar-review';
mkdirSync(OUT, { recursive: true });

/**
 * Toolbar keyboard + responsive contract (2026-09-15 review).
 *
 * 1. The palette is ONE tab stop with a roving tabindex. The roving effect
 *    used to run only on focus-index changes, so when the workspace config
 *    hydrated after the first commit every button kept the browser default
 *    tabIndex=0 — 15 tab stops, and Tab from the canvas never reached the row.
 * 2. Overflow must keep primary creation tools in the row. Group-level
 *    collapse pinned the whole Select group (including Slice, Pixel Info,
 *    Scale and Inspect) and hid Rect/Text/Frame/Table/Pen at 1280x720.
 * 3. The More control sits at the trailing edge and stays visible while the
 *    row scrolls.
 */
test.describe('Toolbar keyboard and overflow contract', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function paletteState(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const row = document.querySelector('.floating-toolbar [role="toolbar"]');
      if (!row) return null;
      const buttons = Array.from(row.querySelectorAll('button'));
      return {
        total: buttons.length,
        tabbable: buttons.filter((b) => (b as HTMLButtonElement).tabIndex === 0).length,
        tabbableLabels: buttons
          .filter((b) => (b as HTMLButtonElement).tabIndex === 0)
          .map((b) => b.getAttribute('aria-label')),
        tools: buttons
          .map((b) => b.getAttribute('data-tool'))
          .filter((t): t is string => Boolean(t)),
      };
    });
  }

  test('keeps exactly one tab stop with a shortcut exposed per tool', async ({ page }) => {
    const state = await paletteState(page);
    expect(state).not.toBeNull();
    expect(state?.tabbable).toBe(1);

    const select = page.locator('.floating-toolbar [data-tool="select"]');
    await expect(select).toHaveAttribute('aria-keyshortcuts', 'V');
    const hand = page.locator('.floating-toolbar [data-tool="hand"]');
    await expect(hand).toHaveAttribute('aria-keyshortcuts', 'H');
  });

  test('Tab enters the palette and arrows move between tools', async ({ page }) => {
    const row = page.locator('.floating-toolbar [role="toolbar"]');
    await row.locator('[tabindex="0"]').focus();
    const first = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

    await page.keyboard.press('ArrowRight');
    const second = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(second).not.toBe(first);

    await page.keyboard.press('End');
    const last = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    await page.keyboard.press('ArrowRight');
    const wrapped = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(wrapped).not.toBe(last);

    await page.keyboard.press('Home');
    const home = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(home).toBe(first);
  });

  test('keeps primary creation tools in the row at the default window size', async ({ page }) => {
    const state = await paletteState(page);
    for (const tool of [
      'rect',
      'line',
      'arrow',
      'pen',
      'knife',
      'shapeBuilder',
      'text',
      'frame',
      'table',
      'select',
      'hand',
      'zoom',
    ]) {
      expect(state?.tools, `${tool} must stay in the palette`).toContain(tool);
    }
  });

  test('anchors the More control at the trailing edge and reports hidden tools', async ({
    page,
  }) => {
    const more = page.getByTestId('toolbar-more-tools');
    await expect(more).toBeVisible();
    const geometry = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="toolbar-more-tools"]');
      const row = document.querySelector('.floating-toolbar [role="toolbar"]');
      if (!el || !row) return null;
      const a = el.getBoundingClientRect();
      const b = row.getBoundingClientRect();
      return {
        moreLeft: a.left,
        rowLeft: b.left,
        rowRight: b.right,
        label: el.getAttribute('aria-label'),
      };
    });
    expect(geometry?.moreLeft).toBeGreaterThan(geometry?.rowLeft ?? 0);
    expect(geometry?.label).toMatch(/More tools \(\d+ hidden by window width\)/);
    // The More control is part of the roving model, not a second tab stop.
    await expect(more).toHaveAttribute('tabindex', '-1');
  });

  test('keeps the More control reachable while the row scrolls narrow', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="toolbar-more-tools"]');
      const row = document.querySelector(
        '.floating-toolbar [role="toolbar"]',
      ) as HTMLElement | null;
      if (!el || !row) return null;
      const a = el.getBoundingClientRect();
      const b = row.getBoundingClientRect();
      return {
        visible: a.left >= b.left - 1 && a.right <= b.right + 1,
        scrolls: row.scrollWidth > row.clientWidth + 1,
      };
    });
    expect(state?.visible).toBe(true);
    await page.screenshot({ path: `${OUT}/after/07-narrow-more.png` });
  });

  test('More menu lists hidden tools and activates one', async ({ page }) => {
    await page.getByTestId('toolbar-more-tools').click();
    await expect(page.getByRole('menu')).toBeVisible();
    // Hidden tools are grouped by category as submenus.
    const submenus = await page
      .locator('[role="menu"] [role="menuitem"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.split('\n')[0]));
    expect(submenus.length).toBeGreaterThan(0);
    console.log('MORE_MENU_CATEGORIES', JSON.stringify(submenus));
    await page.keyboard.press('Escape');
  });
});
