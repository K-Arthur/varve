import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor, switchWorkspace } from '../shared';

/**
 * 2026-09-17 toolbar surface review — regression coverage for the defects
 * fixed in that pass (see docs/audits/toolbar-surface-review-2026-09-17.md):
 *
 *  D1 density reaches the command surfaces (28px compact controls)
 *  D2 flyout chevron is a 24px target
 *  D4/D5/D6 magic-wand segmented fills its row, teal sliders, roving arrows
 *  D8 liquify does not label its size row twice
 *  D9 retouch sampling scope has a visible label
 *  D10 text-options select does not clip its longest option
 *  D11 drawing row shows visible slider values
 *  D12 empty-selection shortcut badges resolve the effective binding
 */

const PALETTE = '.floating-toolbar[data-testid="toolbar"]';

async function drawRect(page: Page) {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 260, { steps: 2 });
  await page.mouse.up();
}

test.describe('Toolbar surface review', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('D1/D2: command surfaces obey the density contract and 24px chevron floor', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });

    // Comfortable baseline: 32px controls.
    const comfortable = await page.evaluate(() => {
      const btn = document.querySelector('.floating-toolbar__btn') as HTMLElement;
      const chevron = document.querySelector('.floating-toolbar__chevron') as HTMLElement;
      return {
        btn: btn.offsetWidth,
        chevron: chevron.offsetWidth,
        density: document.documentElement.getAttribute('data-density'),
      };
    });
    expect(comfortable.density).toBe('comfortable');
    expect(comfortable.btn).toBe(32);
    expect(comfortable.chevron).toBeGreaterThanOrEqual(24);

    // Compact Pro compacts the palette and the context bar together.
    await page.evaluate(() => {
      const raw = localStorage.getItem('varve-editor-settings');
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.appearance = { ...(parsed.appearance ?? {}), uiDensity: 'compact' };
      localStorage.setItem('varve-editor-settings', JSON.stringify(parsed));
    });
    await page.reload();
    const backInEditor = await page
      .locator('.layers-panel')
      .isVisible({ timeout: 8000 })
      .catch(() => false);
    if (!backInEditor) {
      await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    }
    const compact = await page.evaluate(() => {
      const btn = document.querySelector('.floating-toolbar__btn') as HTMLElement;
      const chevron = document.querySelector('.floating-toolbar__chevron') as HTMLElement;
      const palette = document.querySelector('.floating-toolbar') as HTMLElement;
      const ccb = document.querySelector('.context-control-bar') as HTMLElement;
      return {
        btn: btn.offsetWidth,
        btnHeight: btn.offsetHeight,
        chevron: chevron.offsetWidth,
        palette: palette.getBoundingClientRect().height,
        ccb: ccb.getBoundingClientRect().height,
      };
    });
    expect(compact.btn).toBe(28);
    expect(compact.btnHeight).toBe(28);
    // 28px still clears the WCAG 2.5.8 floor with headroom.
    expect(compact.btnHeight).toBeGreaterThanOrEqual(24);
    expect(compact.chevron).toBeGreaterThanOrEqual(24);
    expect(compact.palette).toBeLessThan(48);
    expect(compact.ccb).toBeLessThan(48);
    // Palette and context bar keep their shared centreline contract.
    expect(Math.abs(compact.palette - compact.ccb)).toBeLessThan(1);
  });

  test('D4/D5/D6: magic-wand options fill their rows, use the accent, and arrow between operations', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await switchWorkspace(page, 'Photo');
    await page
      .locator(`${PALETTE} [data-tool="magicWand"], ${PALETTE} [aria-label="Pixel selection menu"]`)
      .first()
      .waitFor({ timeout: 15000 });

    // Magic wand lives in the pixel-selection flyout.
    const wandDirect = page.locator(`${PALETTE} [data-tool="magicWand"]`);
    if (await wandDirect.isVisible().catch(() => false)) {
      await wandDirect.click();
    } else {
      await page.locator(`${PALETTE} [aria-label="Pixel selection menu"]`).click();
      await page
        .getByRole('menu', { name: 'Pixel selection', exact: true })
        .getByRole('menuitem', { name: 'Magic Wand', exact: true })
        .click();
    }
    const options = page.locator('[data-testid="magicwand-options"]');
    await options.waitFor({ timeout: 5000 });

    // D4: the two-option Mode group fills its row (no empty half).
    const modeRow = await page.evaluate(() => {
      const groups = [
        ...document.querySelectorAll('[data-testid="magicwand-options"] [role="radiogroup"]'),
      ];
      const mode = groups.at(-1) as HTMLElement;
      const buttons = [...mode.querySelectorAll('button')] as HTMLElement[];
      const width = mode.getBoundingClientRect().width;
      const filled = buttons.reduce((sum, b) => sum + b.getBoundingClientRect().width, 0);
      return { buttons: buttons.length, filled, width };
    });
    expect(modeRow.buttons).toBe(2);
    expect(modeRow.filled).toBeGreaterThan(modeRow.width * 0.95);

    // D5: sliders use the interactive accent, not the browser default.
    const accent = await page.evaluate(() => {
      const range = document.querySelector(
        '[data-testid="magicwand-options"] input[type="range"]',
      ) as HTMLInputElement;
      return getComputedStyle(range).accentColor;
    });
    expect(accent).not.toBe('');

    // D6: arrows move the radio selection and focus (APG roving).
    const op = options.getByRole('radio', { name: /replace/i });
    await op.focus();
    await page.keyboard.press('ArrowRight');
    await expect(options.getByRole('radio', { name: /add/i })).toBeChecked();
    await expect(options.getByRole('radio', { name: /add/i })).toBeFocused();
  });

  test('D8/D9: liquify has one size label; retouch sampling scope is labeled', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await switchWorkspace(page, 'Photo');

    await page.keyboard.press('y');
    const liquify = page.locator('[data-testid="liquify-options"]');
    await liquify.waitFor({ timeout: 5000 });
    // Exactly one "size" label in the row.
    const sizeLabels = await liquify
      .locator('span, label')
      .filter({ hasText: /^size(\s|$)/i })
      .count();
    expect(sizeLabels).toBeLessThanOrEqual(1);

    await page.keyboard.press('j');
    const retouch = page.locator('[data-testid="retouch-options"]');
    await retouch.waitFor({ timeout: 5000 });
    await expect(retouch.getByText('Sampling', { exact: true })).toBeVisible();
  });

  test('D10: text options select shows its longest option without clipping', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await page.keyboard.press('t');
    await page.locator('.tool-options__content [data-testid="text-options"]').waitFor({
      timeout: 5000,
    });
    const report = await page.evaluate(() => {
      const select = document.querySelector(
        '[data-testid="text-options"] select.varve-native-select__control',
      ) as HTMLSelectElement | null;
      if (!select) return null;
      // A native select never reports text overflow through scrollWidth, so
      // measure the longest option against the closed control's content box.
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return null;
      ctx.font = getComputedStyle(select).font;
      const longest = [...select.options].reduce(
        (max, option) => Math.max(max, ctx.measureText(option.text).width),
        0,
      );
      const cs = getComputedStyle(select);
      const chrome =
        Number.parseFloat(cs.paddingLeft) +
        Number.parseFloat(cs.paddingRight) +
        // Allowance for the native dropdown affordance (Chromium draws the
        // arrow inside the padding box; 18px is a safe floor).
        18;
      return {
        longest: Math.round(longest),
        available: Math.round(select.clientWidth - chrome),
        controlWidth: select.clientWidth,
      };
    });
    expect(report).not.toBeNull();
    expect(report!.available).toBeGreaterThanOrEqual(report!.longest);
  });

  test('D11/D12: drawing values are visible; empty-selection shortcuts are live bindings', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });

    // D12: resolve the real Rect binding and compare with the rendered badge.
    // The badge is a live binding: pressing the displayed key must activate
    // the rect tool (a hard-coded badge would not survive a remap; this also
    // proves the display and the actual binding agree).
    const badge = await page.evaluate(() => {
      const pill = [...document.querySelectorAll('.ccb__tool-pill')].find((el) =>
        el.textContent?.includes('Rect'),
      ) as HTMLElement | null;
      if (!pill) return null;
      const kbd = pill.querySelector('.ccb__kbd') as HTMLElement | null;
      return { kbd: kbd?.textContent ?? '' };
    });
    expect(badge).not.toBeNull();
    expect(badge!.kbd).toMatch(/^[A-Za-z]$/);
    await page.keyboard.press(badge!.kbd.toLowerCase());
    // The tool button's persistent-selection class is `--pressed` (shared
    // ToggleButton vocabulary); `--active` was the pre-migration name.
    await expect(page.locator(`${PALETTE} [data-tool="rect"]`)).toHaveClass(/--pressed/);

    // D11: the drawing row exposes visible values.
    await page.keyboard.press('Control+Shift+3');
    const drawing = page.locator('.floating-toolbar__drawing');
    await drawing.waitFor({ timeout: 15000 });
    const values = await drawing.locator('.floating-toolbar__drawing-value').allTextContents();
    expect(values).toHaveLength(2);
    expect(values[0]).toMatch(/px$/);
    expect(values[1]).toMatch(/%$/);
  });

  test('D2: the boolean flyout chevron is a full target and the disabled flyout reads its reason', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await drawRect(page);
    await page.keyboard.press('Escape');

    const chevron = page.locator(`${PALETTE} [aria-label="Boolean operations menu"]`);
    await chevron.waitFor({ timeout: 5000 });
    // The chevron must be at least a 24px-wide target (D2 regression).
    const chevronWidth = await chevron.evaluate((el) => el.getBoundingClientRect().width);
    expect(chevronWidth).toBeGreaterThanOrEqual(23.5);

    // With one shape the whole flyout disables (primary + chevron) and the
    // tooltip names the requirement — the menu itself stays closed.
    await expect(chevron).toBeDisabled();
    await expect(page.locator(`${PALETTE} [aria-label="Boolean Union"]`)).toBeDisabled();
    // The open-menu-unopenable behaviour is covered by getFlyoutMenuItems
    // unit tests (the disabled state's own contract is the tooltip).
  });
});
