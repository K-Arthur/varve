/**
 * Debug: dump a coarse color map of the content-layer canvas.
 */
import { test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test('debug canvas color map', async ({ page }) => {
  await navigateToEditor(page);
  await page.getByRole('button', { name: 'Table', exact: true }).first().click();
  await dragOnCanvas(page, 200, 160, 700, 460);
  await page.waitForTimeout(1200);

  const map = await page.evaluate(() => {
    const cvs = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!cvs) return 'no canvas';
    const ctx = cvs.getContext('2d');
    if (!ctx) return 'no ctx';
    const { width, height } = cvs;
    const img = ctx.getImageData(0, 0, width, height).data;
    const CELL = 20;
    const rows: string[] = [];
    const colorCounts: Record<string, number> = {};
    for (let cy = 0; cy < Math.ceil(height / CELL); cy++) {
      let row = '';
      for (let cx = 0; cx < Math.ceil(width / CELL); cx++) {
        const x = cx * CELL + 10;
        const y = cy * CELL + 10;
        const i = (y * width + x) * 4;
        const r = img[i]!;
        const g = img[i + 1]!;
        const b = img[i + 2]!;
        const key = `${r},${g},${b}`;
        colorCounts[key] = (colorCounts[key] ?? 0) + 1;
        if (Math.abs(r - 240) < 10 && Math.abs(g - 243) < 10 && Math.abs(b - 247) < 10) row += 'H';
        else if (r > 250 && g > 250 && b > 250) row += '.';
        else if (Math.abs(r - 205) < 15 && Math.abs(g - 211) < 15 && Math.abs(b - 222) < 15)
          row += '-';
        else if (r < 80 && g < 80 && b < 80) row += '#';
        else row += '?';
      }
      rows.push(`${cy * CELL}: ${row}`);
    }
    const top = Object.entries(colorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    return { rows: rows.join('\n'), topColors: top };
  });

  console.log(map);
});
