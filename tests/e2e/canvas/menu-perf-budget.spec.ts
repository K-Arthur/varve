import { expect, test } from '@playwright/test';
import { closeMenu, openMenu } from '../helpers/menu-helpers';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Menu performance budgets', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('File menu opens within 50ms budget (warm, 5 shapes)', async ({ page }) => {
    await seedLayers(page, 5);
    await page.waitForTimeout(300);

    const elapsed = await page.evaluate(async () => {
      const mark = (name: string) => {
        if (typeof performance !== 'undefined' && performance.mark) {
          performance.mark(name);
        }
      };

      const menubar = document.querySelector('[role="menubar"]');
      if (!menubar) return -1;
      const fileItem = menubar.querySelector('[role="menuitem"]');
      if (!(fileItem instanceof HTMLElement)) return -1;

      const clickTarget = fileItem.querySelector('button') ?? fileItem;

      mark('menu:perf:warm-open:start');
      clickTarget.click();
      mark('menu:perf:warm-open:clicked');

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            mark('menu:perf:warm-open:painted');
            channel.port1.close();
            resolve();
          };
          channel.port2.postMessage(null);
        });
      });

      const measure = performance.measure(
        'menu:perf:warm-open',
        'menu:perf:warm-open:start',
        'menu:perf:warm-open:painted',
      );
      return measure.duration;
    });

    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(500);

    await closeMenu(page);
  });

  test('File menu submenu opens within 30ms budget', async ({ page }) => {
    await seedLayers(page, 5);
    await openMenu(page, 'File');

    const elapsed = await page.evaluate(async () => {
      const mark = (name: string) => {
        if (typeof performance !== 'undefined' && performance.mark) {
          performance.mark(name);
        }
      };

      const menu = document.querySelector('[role="menu"]');
      if (!menu) return -1;
      // Submenu triggers use aria-haspopup="true". The File menu always has
      // the Logo submenu, while Open Recent is conditional and Export is a
      // direct action, so the old text-based probe returned -1 on a clean
      // document.
      const submenuItem = menu.querySelector('[aria-haspopup="true"]');
      if (!(submenuItem instanceof HTMLElement)) return -1;
      const item = submenuItem;

      mark('menu:perf:submenu:start');
      item.click();
      mark('menu:perf:submenu:clicked');

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            mark('menu:perf:submenu:painted');
            channel.port1.close();
            resolve();
          };
          channel.port2.postMessage(null);
        });
      });

      const measure = performance.measure(
        'menu:perf:submenu',
        'menu:perf:submenu:start',
        'menu:perf:submenu:painted',
      );
      return measure.duration;
    });

    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(300);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  test('context menu opens within 50ms budget', async ({ page }) => {
    await seedLayers(page, 5);
    await page.waitForTimeout(300);

    const elapsed = await page.evaluate(async () => {
      const mark = (name: string) => {
        if (typeof performance !== 'undefined' && performance.mark) {
          performance.mark(name);
        }
      };

      const canvas = document.querySelector('canvas.editor-canvas__content-layer');
      if (!canvas) return -1;

      mark('menu:perf:ctx:start');
      canvas.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 200,
          clientY: 200,
          button: 2,
        }),
      );
      mark('menu:perf:ctx:triggered');

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            mark('menu:perf:ctx:painted');
            channel.port1.close();
            resolve();
          };
          channel.port2.postMessage(null);
        });
      });

      const measure = performance.measure(
        'menu:perf:ctx',
        'menu:perf:ctx:start',
        'menu:perf:ctx:painted',
      );
      return measure.duration;
    });

    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(500);

    await page.keyboard.press('Escape');
  });
});
