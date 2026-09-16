/**
 * Separator system — forced-colors survivability and rendered evidence.
 *
 * Backgrounds drawn with author colors disappear in forced-colors mode (the
 * UA replaces the background channel), and gradients are reverted entirely.
 * The separator system depends on the token remap in
 * `packages/ui/src/tokens/tokens.css` plus the fade fallback in
 * `packages/ui/src/components/Separator.css`. These specs pin both the
 * mechanism and the real editor surfaces so a future token regeneration or
 * recipe change cannot silently make dividers invisible again.
 *
 * Evidence artifacts are written to the Playwright output directory; the
 * reviewed copies live under docs/screenshots/2026-09-15-separators/.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

const uiSrc = path.resolve('packages/ui/src');
const tokensCss = readFileSync(path.join(uiSrc, 'tokens/tokens.css'), 'utf8');
const separatorCss = readFileSync(path.join(uiSrc, 'components/Separator.css'), 'utf8');
const componentsCss = readFileSync(path.join(uiSrc, 'components/components.css'), 'utf8');

interface Painted {
  backgroundColor: string;
  borderTopColor: string;
  borderTopWidth: string;
  opacity: string;
  height: number;
  width: number;
}

async function painted(page: Page, selector: string): Promise<Painted> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      backgroundColor: cs.backgroundColor,
      borderTopColor: cs.borderTopColor,
      borderTopWidth: cs.borderTopWidth,
      opacity: cs.opacity,
      height: rect.height,
      width: rect.width,
    };
  }, selector);
}

/** Solid, non-transparent channel check against the mode's canvas color. */
function assertVisible(paint: Painted, canvas: string, label: string) {
  const channels = [paint.backgroundColor, paint.borderTopColor];
  const painted = channels.filter((c) => c !== 'rgba(0, 0, 0, 0)' && c !== canvas);
  expect(painted.length, `${label} must paint a channel distinct from the canvas`).toBeGreaterThan(
    0,
  );
}

async function renderSeparatorGallery(page: Page, theme: 'light' | 'dark' | 'high-contrast') {
  await page.emulateMedia({
    forcedColors: 'active',
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  await page.setViewportSize({ width: 520, height: 340 });
  await page.setContent(`
    <html data-theme="${theme}">
      <body style="margin:0;background:var(--color-surface-base);color:var(--color-text-primary);font:14px sans-serif">
        <div style="padding:20px;width:320px">
          <p style="margin:0 0 4px">solid / default</p>
          <hr id="solid" class="varve-separator varve-separator--horizontal varve-separator--solid varve-separator--default">
          <p style="margin:12px 0 4px">dashed / default</p>
          <hr id="dashed" class="varve-separator varve-separator--horizontal varve-separator--dashed varve-separator--default">
          <p style="margin:12px 0 4px">fade / default</p>
          <hr id="fade" class="varve-separator varve-separator--horizontal varve-separator--fade varve-separator--default">
          <p style="margin:12px 0 4px">menu separator (varve-menu__sep)</p>
          <hr id="menu-sep" class="varve-menu__sep">
          <p style="margin:12px 0 4px">border-token rule (menubar divider recipe)</p>
          <div id="rule-token" style="height:1px;background:var(--color-border-subtle)"></div>
          <p style="margin:12px 0 4px">vertical / accent</p>
          <div style="height:24px;display:flex">
            <span class="varve-separator varve-separator--vertical varve-separator--solid varve-separator--accent" id="vertical-accent"></span>
          </div>
        </div>
        <div id="canvas-reference" style="height:1px;background:Canvas"></div>
      </body>
    </html>
  `);
  await page.addStyleTag({ content: tokensCss });
  await page.addStyleTag({ content: separatorCss });
  await page.addStyleTag({ content: componentsCss });
}

test.describe('separator system — forced-colors', () => {
  test('system-color backgrounds survive forcing, author colors do not (mechanism)', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setContent(`
      <style>
        :root { --probe-token: CanvasText; }
        #canvas { height: 4px; background: Canvas; }
        #system-bg { height: 4px; background: CanvasText; }
        #token-bg { height: 4px; background: var(--probe-token); }
        #author-bg { height: 4px; background: oklch(0.5 0 0); }
      </style>
      <div id="canvas"></div><div id="system-bg"></div>
      <div id="token-bg"></div><div id="author-bg"></div>
    `);
    const canvas = (await painted(page, '#canvas')).backgroundColor;
    const system = (await painted(page, '#system-bg')).backgroundColor;
    const viaToken = (await painted(page, '#token-bg')).backgroundColor;
    const author = (await painted(page, '#author-bg')).backgroundColor;

    expect(system).not.toBe(canvas);
    expect(viaToken).toBe(system);
    expect(author).toBe(canvas);
  });

  for (const theme of ['light', 'dark', 'high-contrast'] as const) {
    test(`${theme}: every separator channel stays visible in forced-colors`, async ({ page }) => {
      await renderSeparatorGallery(page, theme);
      const canvas = (await painted(page, '#canvas-reference')).backgroundColor;

      assertVisible(await painted(page, '#solid'), canvas, 'solid separator');
      assertVisible(await painted(page, '#dashed'), canvas, 'dashed separator');
      assertVisible(await painted(page, '#fade'), canvas, 'fade separator');
      assertVisible(await painted(page, '#menu-sep'), canvas, 'menu separator');
      assertVisible(await painted(page, '#rule-token'), canvas, 'border-token rule');

      await page.screenshot({
        path: `test-results/separators/forced-colors-${theme}.png`,
        fullPage: false,
      });
    });
  }

  test('light baseline: separator channels keep the subtle palette', async ({ page }) => {
    await page.setContent(`
      <html data-theme="light">
        <body style="margin:0;background:var(--color-surface-base)">
          <div style="padding:16px;width:240px">
            <hr id="solid" class="varve-separator varve-separator--horizontal varve-separator--solid varve-separator--default">
            <hr id="dashed" class="varve-separator varve-separator--horizontal varve-separator--dashed varve-separator--default">
            <hr id="fade" class="varve-separator varve-separator--horizontal varve-separator--fade varve-separator--default">
          </div>
        </body>
      </html>
    `);
    await page.addStyleTag({ content: tokensCss });
    await page.addStyleTag({ content: separatorCss });
    const solid = await painted(page, '#solid');
    expect(solid.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(solid.height).toBe(1);
    const dashed = await painted(page, '#dashed');
    expect(dashed.borderTopWidth).toBe('1px');
    expect(dashed.borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
    const fade = await painted(page, '#fade');
    expect(fade.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('separator system — real editor surfaces', () => {
  test('shorthand border tokens paint a real line (runtime declaration check)', async ({
    page,
  }) => {
    const mockupsCss = readFileSync(
      path.resolve('packages/editor/src/components/Inspector/sections/MockupsSection.css'),
      'utf8',
    );
    await page.setContent(`
      <div id="fixed-probe" class="mockups-section__actions"></div>
      <div id="broken-probe" style="border-top: 1px solid var(--border-micro)"></div>
    `);
    await page.addStyleTag({ content: tokensCss });
    await page.addStyleTag({ content: mockupsCss });

    const fixed = await painted(page, '#fixed-probe');
    expect(fixed.borderTopWidth).toBe('1px');
    expect(fixed.borderTopColor).not.toBe('rgba(0, 0, 0, 0)');

    // Negative control: the historical nesting is invalid and paints nothing.
    const broken = await painted(page, '#broken-probe');
    expect(broken.borderTopWidth).toBe('0px');
  });

  test('menubar menu separators render in all themes and survive forced-colors', async ({
    page,
  }, testInfo) => {
    test.setTimeout(600000);
    await page.setViewportSize({ width: 1440, height: 900 });
    // Establish the origin before writing the theme preference.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 300000 });

    for (const scenario of [
      { theme: 'light', forced: false },
      { theme: 'dark', forced: false },
      { theme: 'high-contrast', forced: false },
      { theme: 'light', forced: true },
    ] as const) {
      await page.evaluate((theme) => localStorage.setItem('varve-theme', theme), scenario.theme);
      await navigateToEditor(page, '/', { startupTimeout: 120000 });
      await page.emulateMedia({ forcedColors: scenario.forced ? 'active' : 'none' });
      await page.waitForTimeout(150);

      await openMenu(page, 'File');
      const menu = page.locator('[role="menu"][aria-label="File"]');
      await expect(menu).toBeVisible();
      const separator = menu.locator('.editor-menubar__menu-sep').first();
      await expect(separator).toBeAttached();

      const paint = await separator.evaluate((el) => {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          backgroundColor: cs.backgroundColor,
          borderTopColor: cs.borderTopColor,
          borderTopWidth: cs.borderTopWidth,
          height: rect.height,
          width: rect.width,
        };
      });
      const canvas = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.background = 'Canvas';
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });

      expect(paint.width, `${scenario.theme} separator must span the menu`).toBeGreaterThan(50);
      const channels = [paint.backgroundColor, paint.borderTopColor].filter(
        (c) => c !== 'rgba(0, 0, 0, 0)' && c !== canvas,
      );
      expect(
        channels.length,
        `${scenario.theme}${scenario.forced ? ' (forced)' : ''} separator must be visible`,
      ).toBeGreaterThan(0);

      const suffix = `${scenario.theme}${scenario.forced ? '-forced-colors' : ''}`;
      await page.screenshot({ path: testInfo.outputPath(`file-menu-${suffix}.png`) });
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    }
  });
});
