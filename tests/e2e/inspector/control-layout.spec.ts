import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Inspector control layout', () => {
  test('keeps inputs and dropdowns contained at supported rail widths', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 1);
    await page.locator('[role="treeitem"][data-layer-type="shape"]').first().click();
    await page.getByRole('tab', { name: 'Design' }).click();

    // Expand every rendered section so the audit covers the same controls users
    // can reach, not only the initially visible Layout fields.
    const collapsed = page.locator(
      '.editor-inspector .insp-disclosure__trigger[aria-expanded="false"]',
    );
    while ((await collapsed.count()) > 0) {
      await collapsed.first().click();
    }

    const host = page.locator('.editor__inspector-panel');
    const inspector = page.locator('.editor-inspector');
    for (const width of [240, 320, 480, 640]) {
      await host.evaluate((element, nextWidth) => {
        const node = element as HTMLElement;
        node.style.width = `${nextWidth}px`;
        node.style.minWidth = '0';
        node.style.maxWidth = `${nextWidth}px`;
      }, width);

      const metrics = await inspector.evaluate((root) => {
        const rootRect = root.getBoundingClientRect();
        const scrollBox = root.querySelector<HTMLElement>(':scope > .insp-panel');
        const controls = Array.from(
          root.querySelectorAll<HTMLElement>(
            'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, [role="combobox"]',
          ),
        ).filter((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
        });
        const offenders = controls
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label: element.getAttribute('aria-label') ?? element.tagName,
              left: Math.round(rect.left * 100) / 100,
              right: Math.round(rect.right * 100) / 100,
              rootLeft: Math.round(rootRect.left * 100) / 100,
              rootRight: Math.round(rootRect.right * 100) / 100,
            };
          })
          .filter(({ left, right }) => left < rootRect.left - 1 || right > rootRect.right + 1);

        return {
          rootWidth: Math.round(rootRect.width),
          scrollWidth: scrollBox?.scrollWidth ?? 0,
          clientWidth: scrollBox?.clientWidth ?? 0,
          offenders,
        };
      });

      expect(metrics.offenders, `controls escaped the ${width}px inspector`).toEqual([]);
      expect(
        metrics.scrollWidth,
        `inspector created horizontal overflow at ${width}px`,
      ).toBeLessThanOrEqual(metrics.clientWidth + 1);
    }
  });
});
