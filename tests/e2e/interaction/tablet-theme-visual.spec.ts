import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const themes = ['dark', 'high-contrast'] as const;

test.describe('tablet theme and reduced-motion visual review', () => {
  test.use({ hasTouch: true, viewport: { width: 960, height: 600 } });

  for (const theme of themes) {
    test(`${theme} keeps tablet controls and Inspector visible`, async ({ page }, testInfo) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('varve-theme', selectedTheme);
        localStorage.setItem('strata-clean-shutdown', 'true');
        localStorage.removeItem('varve:crash-loop');
      }, theme);
      await page.emulateMedia({
        colorScheme: theme === 'dark' ? 'dark' : 'light',
        reducedMotion: 'reduce',
      });
      await navigateToEditor(page);
      await page.setViewportSize({ width: 960, height: 600 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );

      await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const inspector = page.locator('.editor__inspector-panel');
      await expect(inspector).toBeVisible();
      await expect(inspector).not.toHaveAttribute('aria-modal', 'true');

      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const bounds = element.getBoundingClientRect();
          return {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            right: bounds.right,
            bottom: bounds.bottom,
          };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          documentScrollWidth: document.documentElement.scrollWidth,
          inspector: rect('.editor__inspector-panel'),
          inspectorTransition: getComputedStyle(document.querySelector('.editor__inspector-panel')!)
            .transitionDuration,
          canvas: rect('canvas.editor-canvas__content-layer'),
          floatingToolbar: rect('[data-testid="toolbar"]'),
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      });
      expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewport.width + 1);
      expect(geometry.inspector?.width ?? 0).toBeGreaterThanOrEqual(220);
      expect(geometry.canvas?.width ?? 0).toBeGreaterThan(120);
      expect(geometry.reducedMotion).toBe(true);
      expect(Number.parseFloat(geometry.inspectorTransition)).toBe(0);

      const evidenceRoot = process.env.VARVE_TABLET_SCREENSHOT_DIR;
      const fileName = `tablet-${theme}-reduced-motion-960x600.png`;
      if (evidenceRoot) {
        const screenshotPath = join(resolve(evidenceRoot), fileName);
        await mkdir(dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath });
        await writeFile(
          screenshotPath.replace(/\.png$/i, '.json'),
          `${JSON.stringify(
            {
              browser: page.context().browser()?.browserType().name() ?? 'unknown',
              browserVersion: page.context().browser()?.version() ?? 'unknown',
              userAgent: await page.evaluate(() => navigator.userAgent),
              theme,
              ...geometry,
            },
            null,
            2,
          )}\n`,
        );
        await testInfo.attach(fileName, { path: screenshotPath, contentType: 'image/png' });
      } else {
        await page.screenshot({ path: testInfo.outputPath(fileName) });
      }
    });
  }
});
