import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Canvas name labels', () => {
  test('labels artwork but never exposes the active page content root', async ({ page }) => {
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('f');
    await page.mouse.move(box.x + 200, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 340);
    await page.mouse.up();

    const zoom = page.locator('.editor-menubar__zoom-input');
    await zoom.fill('20');
    await zoom.press('Enter');

    const labels = page.locator('.canvas-name-labels');
    await expect(labels.getByText('Frame 1', { exact: true })).toBeVisible();
    await expect(labels.getByText(/Page 1 content/i)).toHaveCount(0);
    await expect(page.locator('.selection-info-bar').getByText(/Page 1 content/i)).toHaveCount(0);
  });

  test('keeps visible labels, accessibility, and minimap on the active Design Canvas', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    const canvasBox = box;

    async function drawNamedFrame(name: string, x: number, y: number) {
      await page.keyboard.press('f');
      await page.mouse.move(canvasBox.x + x, canvasBox.y + y);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + x + 220, canvasBox.y + y + 140);
      await page.mouse.up();
      const row = page.locator('.layers-row--selected').first();
      await expect(row).toBeVisible();
      await row.click();
      await page.keyboard.press('F2');
      const input = row.locator('.layers-row__name-input');
      await expect(input).toBeVisible();
      await input.fill(name);
      await input.press('Enter');
      await expect(row.locator('.layers-row__name')).toHaveText(name);
    }

    await drawNamedFrame('A_ONLY_FRAME', 120, 120);

    const navigator = page.getByRole('region', { name: 'Design Canvases' });
    await navigator.getByRole('button', { name: 'Add Design Canvas' }).click();
    await drawNamedFrame('B_ONLY_FRAME', 120, 120);

    const canvasA = navigator.locator('button.design-canvas-panel__select').filter({
      hasText: 'Canvas 1',
    });
    const canvasB = navigator.locator('button.design-canvas-panel__select').filter({
      hasText: 'Canvas 2',
    });
    await canvasA.click();

    async function assertSurface(expectedName: string, absentName: string, surfaceKey: string) {
      const labelSurface = page.locator('.canvas-name-labels');
      await expect(labelSurface).toHaveAttribute('data-surface-key', surfaceKey);
      await expect(
        labelSurface.locator('text[data-node-id]', { hasText: expectedName }),
      ).toBeVisible();
      await expect(labelSurface.locator('text[data-node-id]', { hasText: absentName })).toHaveCount(
        0,
      );

      await expect(
        page.locator(`.editor-canvas .sr-only li[aria-label*="${expectedName}"]`),
      ).toHaveCount(1);
      await expect(
        page.locator(`.editor-canvas .sr-only li[aria-label*="${absentName}"]`),
      ).toHaveCount(0);

      const minimap = page.getByTestId('minimap-panel');
      await expect(minimap).toHaveAttribute('data-surface-key', surfaceKey);
      await page.getByTestId('editor-canvas').screenshot({
        path: testInfo.outputPath(`${expectedName.toLowerCase()}.png`),
      });
    }

    const surfaceA = await page.locator('.canvas-name-labels').getAttribute('data-surface-key');
    if (!surfaceA) throw new Error('Design Canvas A scope hook not found');
    await assertSurface('A_ONLY_FRAME', 'B_ONLY_FRAME', surfaceA);

    await canvasB.click();
    const surfaceB = await page.locator('.canvas-name-labels').getAttribute('data-surface-key');
    if (!surfaceB || surfaceB === surfaceA) throw new Error('Design Canvas B scope did not commit');
    await assertSurface('B_ONLY_FRAME', 'A_ONLY_FRAME', surfaceB);

    const observed = await page.evaluate(async () => {
      const snapshots: Array<{ surface: string | null; names: string[] }> = [];
      for (let frame = 0; frame < 4; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const labels = document.querySelector<SVGElement>('.canvas-name-labels');
        snapshots.push({
          surface: labels?.getAttribute('data-surface-key') ?? null,
          names: [...(labels?.querySelectorAll('text') ?? [])].map(
            (node) => node.textContent ?? '',
          ),
        });
      }
      return snapshots;
    });
    expect(
      observed.every((snapshot) => snapshot.names.every((name) => !name.includes('A_ONLY_FRAME'))),
    ).toBe(true);
  });
});
