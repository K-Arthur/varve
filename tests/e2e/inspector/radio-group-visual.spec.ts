/**
 * Radio-group system — rendered geometry and keyboard contracts.
 *
 * Guards the 2026-09-20 review: inset segment radii (never a square selected
 * chip inside a rounded track), pill concentricity, content-width wrapping in
 * the Inspector, radiogroup role ownership, and the APG keyboard model for
 * purpose-built groups. Captures evidence screenshots under
 * docs/screenshots/2026-09-20-radio-group-review/.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const DIR = resolve(__dirname, '../../../docs/screenshots/2026-09-20-radio-group-review');
mkdirSync(DIR, { recursive: true });

const CIRCLE_RADIUS = 100;

function parseRadius(value: string): number {
  return Number.parseFloat(value.replace('px', ''));
}

async function segmentGeometry(page: Page, label: string) {
  return page.evaluate((name) => {
    const group = [...document.querySelectorAll<HTMLElement>('.varve-segmented')].find(
      (element) => element.getAttribute('aria-label') === name,
    );
    if (!group) throw new Error(`no segmented control named ${name}`);
    const track = getComputedStyle(group);
    const buttons = [...group.querySelectorAll<HTMLElement>('.varve-segmented__btn')].map(
      (button) => {
        const style = getComputedStyle(button);
        const labelElement = button.querySelector<HTMLElement>('.varve-segmented__label');
        return {
          text: (button.textContent ?? '').trim(),
          checked: button.querySelector('input')?.checked ?? false,
          radius: style.borderRadius,
          width: button.getBoundingClientRect().width,
          labelWidth: labelElement?.getBoundingClientRect().width ?? 0,
          title: button.getAttribute('title'),
        };
      },
    );
    const columns = getComputedStyle(group).gridTemplateColumns;
    return {
      trackRadius: track.borderRadius,
      buttons,
      columnCount: columns === 'none' ? 1 : columns.split(' ').length,
    };
  }, label);
}

async function openIsometricGrid(page: Page) {
  const header = page.getByRole('button', { name: /isometric grid/i });
  await header.scrollIntoViewIfNeeded();
  await header.click();
  await page.waitForTimeout(200);
}

async function drawFrame(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('f');
  await page.mouse.move(box.x + 140, box.y + 140);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 360, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 160, box.y + 160);
  await page.waitForTimeout(300);
}

test.describe('radio-group system', () => {
  test('segments derive their radius from the track and never hard-clip labels', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await openIsometricGrid(page);

    const group = page.getByRole('radiogroup', { name: 'Active construction plane' });
    await group.scrollIntoViewIfNeeded();

    // The reference rail from the report: the four options wrap into a
    // balanced grid instead of shrinking below their labels.
    await page.locator('.editor-shell').evaluate((shell) => {
      (shell as HTMLElement).style.setProperty('--inspector-width', '513px');
    });
    await page.waitForTimeout(150);

    const geometry = await segmentGeometry(page, 'Active construction plane');
    const track = parseRadius(geometry.trackRadius);
    expect(track).toBeGreaterThan(0);
    expect(geometry.buttons).toHaveLength(4);
    for (const button of geometry.buttons) {
      const radius = parseRadius(button.radius);
      expect(radius, `${button.text} radius`).toBeGreaterThan(0);
      expect(radius, `${button.text} radius below track`).toBeLessThan(track);
      // A squeezed segment must still expose its full name via the tooltip.
      if (button.labelWidth > button.width) {
        expect(button.title, `${button.text} tooltip`).toBeTruthy();
      }
    }
    const checked = geometry.buttons.find((button) => button.checked);
    expect(checked?.text).toBe('Top');
    expect(parseRadius(checked?.radius ?? '0px')).toBeGreaterThan(0);
    expect(geometry.columnCount).toBeGreaterThan(1);

    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await page.locator('.editor-inspector').screenshot({
      path: resolve(DIR, '01-construction-plane-dark.png'),
    });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await page.waitForTimeout(150);
    await group.screenshot({ path: resolve(DIR, '02-construction-plane-light.png') });

    // Narrow rail: options wrap instead of clipping; still at least one column.
    await page.locator('.editor-shell').evaluate((shell) => {
      (shell as HTMLElement).style.setProperty('--inspector-width', '240px');
    });
    await page.waitForTimeout(150);
    const narrow = await segmentGeometry(page, 'Active construction plane');
    expect(narrow.columnCount).toBeGreaterThanOrEqual(1);
    for (const button of narrow.buttons) {
      expect(parseRadius(button.radius)).toBeGreaterThan(0);
      if (button.labelWidth > button.width) expect(button.title).toBeTruthy();
    }
    await group.screenshot({ path: resolve(DIR, '03-construction-plane-narrow.png') });
  });

  test('pill variant rounds the track and the thumb together', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const pill = page.locator('.varve-segmented--pill').first();
    await expect(pill).toBeVisible({ timeout: 10_000 });
    const geometry = await segmentGeometry(page, 'View mode');
    expect(parseRadius(geometry.trackRadius)).toBeGreaterThanOrEqual(CIRCLE_RADIUS);
    for (const button of geometry.buttons) {
      expect(parseRadius(button.radius)).toBeGreaterThanOrEqual(CIRCLE_RADIUS);
    }
    await pill.screenshot({ path: resolve(DIR, '04-view-mode-pill.png') });
  });

  test('alignment and justification are icon pickers with full names', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await drawFrame(page);

    const layoutMode = page.getByRole('combobox', { name: 'Layout mode' });
    await layoutMode.scrollIntoViewIfNeeded();
    await layoutMode.click();
    await page.getByRole('option', { name: 'Flex' }).click();
    await page.waitForTimeout(300);

    const justify = page.getByRole('radiogroup', { name: 'Justify content' });
    await justify.scrollIntoViewIfNeeded();
    await expect(justify.getByRole('radio')).toHaveCount(6);
    for (const name of [
      'Justify to start',
      'Justify center',
      'Justify to end',
      'Space between',
      'Space around',
      'Space evenly',
    ]) {
      await expect(justify.getByRole('radio', { name })).toHaveCount(1);
    }
    // One tab stop; arrows move selection and focus.
    const start = justify.getByRole('radio', { name: 'Justify to start' });
    await expect(start).toHaveAttribute('tabindex', '0');
    const columns = await justify.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    );
    expect(columns, 'icon pickers stay on a row instead of stacking').toBeGreaterThan(2);
    await start.focus();
    await page.keyboard.press('ArrowRight');
    await expect(justify.getByRole('radio', { name: 'Justify center' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    await page.keyboard.press('End');
    await expect(justify.getByRole('radio', { name: 'Space evenly' })).toBeFocused();

    await page.locator('.editor-inspector').screenshot({
      path: resolve(DIR, '05-layout-icon-pickers-light.png'),
    });
  });

  test('purpose-built groups keep radiogroup ownership and arrow keys', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    // Every radiogroup in the app contains only radios.
    const ownership = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const group of document.querySelectorAll('[role="radiogroup"]')) {
        const invalid = group.querySelectorAll(
          '[aria-pressed], button:not([role="radio"]), a[href]',
        );
        if (invalid.length > 0) {
          offenders.push(
            `${group.getAttribute('aria-label') ?? group.className}: ${invalid.length}`,
          );
        }
      }
      return offenders;
    });
    expect(ownership).toEqual([]);

    // The alignment reference is a labelled group of pressed buttons, not a radiogroup.
    // Draw one shape so the Align & Distribute section is present.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 140, box.y + 140);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 260, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('.insp-align-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[role="radiogroup"][aria-label="Alignment reference"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[role="group"][aria-label="Alignment reference"]')).toHaveCount(1);

    // Crop overlay: APG roving radiogroups.
    const fileInput = page.locator('#file-import-input');
    await fileInput.setInputFiles(resolve(__dirname, '../fixtures/test-image.png'));
    await page.getByRole('treeitem').first().waitFor({ timeout: 15_000 });
    await page.getByRole('treeitem').first().click();
    await page.keyboard.press('c');
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5_000 });

    const aspect = page.getByRole('radiogroup', { name: 'Aspect ratio' });
    const free = aspect.getByRole('radio', { name: 'Free' });
    await free.focus();
    await page.keyboard.press('ArrowRight');
    await expect(aspect.getByRole('radio', { name: 'Original' })).toBeFocused();
    await expect(aspect.getByRole('radio', { name: 'Original' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.locator('.crop-toolbar').screenshot({
      path: resolve(DIR, '06-crop-toolbar.png'),
    });
  });

  test('forced colors keep the selected segment distinguishable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await openIsometricGrid(page);
    await page.emulateMedia({ forcedColors: 'active' });
    await page.waitForTimeout(200);
    const group = page.getByRole('radiogroup', { name: 'Active construction plane' });
    await group.scrollIntoViewIfNeeded();
    const contrast = await page.evaluate(() => {
      const group = [...document.querySelectorAll<HTMLElement>('.varve-segmented')].find(
        (element) => element.getAttribute('aria-label') === 'Active construction plane',
      );
      if (!group) throw new Error('no group');
      const checked = group.querySelector<HTMLElement>('.varve-segmented__btn:has(input:checked)');
      const unchecked = group.querySelector<HTMLElement>(
        '.varve-segmented__btn:not(:has(input:checked))',
      );
      if (!checked || !unchecked) throw new Error('no segments');
      return {
        checkedBg: getComputedStyle(checked).backgroundColor,
        checkedColor: getComputedStyle(checked).color,
        uncheckedBg: getComputedStyle(unchecked).backgroundColor,
      };
    });
    expect(contrast.checkedBg).not.toBe(contrast.uncheckedBg);
    await group.screenshot({ path: resolve(DIR, '07-construction-plane-forced-colors.png') });
    await page.emulateMedia({ forcedColors: 'none' });
  });
});
