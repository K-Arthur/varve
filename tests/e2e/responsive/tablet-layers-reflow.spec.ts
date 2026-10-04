import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('tablet Layers panel reflow', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 520 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('strata-clean-shutdown', 'true');
        localStorage.removeItem('varve:crash-loop');
        localStorage.setItem(
          'varve-editor-settings',
          JSON.stringify({ appearance: { layoutPreference: 'tablet' } }),
        );
      } catch {
        // The editor's in-memory defaults still apply when storage is blocked.
      }
    });
  });

  test('drawer content and layer actions remain inside the panel at tablet sizes', async ({
    page,
  }) => {
    await navigateToEditor(page);
    const launcher = page.locator('.editor__fab--layers');
    await expect(launcher).toBeVisible();
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas has no bounds');
    for (let index = 0; index < 4; index++) {
      const x = canvasBox.x + 80 + index * 64;
      const y = canvasBox.y + 100;
      await page.keyboard.press('r');
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 32, y + 32);
      await page.mouse.up();
      await expect.poll(() => page.locator('.layers-row').count()).toBe(index + 1);
    }

    await launcher.click();
    const panel = page.locator('#editor-layers-panel');
    await expect(panel).toBeVisible();
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().x))
      .toBeGreaterThanOrEqual(-1);
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().x))
      .toBeLessThanOrEqual(1);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

    for (const viewport of [
      { width: 820, height: 520 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);

      await expect(panel).toBeVisible();
      await panel.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const content = panel.locator('.layers-panel__content');
      const tree = panel.locator('.layers-panel__tree');
      await content.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await tree.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const rowCount = await panel.locator('.layers-row').count();
      expect(rowCount).toBe(4);
      for (let index = 0; index < rowCount; index++) {
        const row = panel.locator('.layers-row').nth(index);
        await row.scrollIntoViewIfNeeded();
        const [rowBox, contentBox, treeBox] = await Promise.all([
          row.boundingBox(),
          content.boundingBox(),
          tree.boundingBox(),
        ]);
        expect(rowBox).not.toBeNull();
        expect(contentBox).not.toBeNull();
        expect(treeBox).not.toBeNull();
        expect(
          rowBox!.y,
          `${viewport.width}px row ${index} must be reachable above the fold`,
        ).toBeGreaterThanOrEqual(contentBox!.y - 1);
        expect(
          rowBox!.y + rowBox!.height,
          `${viewport.width}px row ${index} must fit inside the Layers content viewport`,
        ).toBeLessThanOrEqual(contentBox!.y + contentBox!.height + 1);
        expect(
          rowBox!.y,
          `${viewport.width}px row ${index} must be inside the tree viewport`,
        ).toBeGreaterThanOrEqual(treeBox!.y - 1);
        expect(
          rowBox!.y + rowBox!.height,
          `${viewport.width}px row ${index} must fit inside the tree viewport`,
        ).toBeLessThanOrEqual(treeBox!.y + treeBox!.height + 1);
      }

      if (viewport.height <= 600) {
        await expect
          .poll(() => content.evaluate((element) => getComputedStyle(element).overflowY))
          .toBe('auto');
      }

      const layout = await page.evaluate(() => {
        const rect = (el: Element | null | undefined) => {
          const r = el?.getBoundingClientRect();
          return r
            ? { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
            : null;
        };
        const panel = document.querySelector<HTMLElement>('#editor-layers-panel');
        const content = panel?.querySelector<HTMLElement>('.layers-panel__content');
        const tree = panel?.querySelector<HTMLElement>('.layers-panel__tree');
        return {
          viewport: { width: innerWidth, height: innerHeight },
          panel: rect(panel),
          panelScrollWidth: panel?.scrollWidth ?? 0,
          panelClientWidth: panel?.clientWidth ?? 0,
          content: rect(content),
          contentScrollWidth: content?.scrollWidth ?? 0,
          contentClientWidth: content?.clientWidth ?? 0,
          contentScrollHeight: content?.scrollHeight ?? 0,
          contentClientHeight: content?.clientHeight ?? 0,
          tree: rect(tree),
          rows: [...(panel?.querySelectorAll<HTMLElement>('.layers-row') ?? [])].map((row) => ({
            rect: rect(row),
            scrollWidth: row.scrollWidth,
            clientWidth: row.clientWidth,
            actions: [...row.querySelectorAll<HTMLElement>('.layers-row__toggle')].map((action) =>
              rect(action),
            ),
          })),
        };
      });
      expect(layout.panel).not.toBeNull();
      expect(layout.tree).not.toBeNull();
      expect(layout.panel!.x).toBeGreaterThanOrEqual(-1);
      expect(layout.panel!.right).toBeLessThanOrEqual(viewport.width + 1);
      for (const [index, row] of layout.rows.entries()) {
        expect(
          row.scrollWidth,
          `${viewport.width}px layer row ${index} must not overflow its clip box`,
        ).toBeLessThanOrEqual(row.clientWidth + 1);
        for (const action of row.actions) {
          if (!action || action.width === 0) continue;
          expect(
            action.right,
            `${viewport.width}px layer action ${index} must remain inside the panel`,
          ).toBeLessThanOrEqual(layout.panel!.right + 1);
        }
      }
      await page.screenshot({
        path: test.info().outputPath(`tablet-layers-${viewport.width}x${viewport.height}.png`),
      });
    }
  });
});
