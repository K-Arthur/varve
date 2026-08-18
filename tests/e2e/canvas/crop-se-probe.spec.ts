import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

test.describe('crop se handle probe', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('probe elements under the se handle', async ({ page }) => {
    const fileInput = page.locator('#file-import-input');
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, 'test-image.png'));
    await page.getByRole('treeitem').first().waitFor({ timeout: 15000 });
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);
    await page.keyboard.press('c');
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });

    const seHandle = page.getByRole('button', { name: 'Resize crop se', exact: true });
    await expect(seHandle).toBeVisible();
    const box = await seHandle.boundingBox();
    if (!box) throw new Error('se handle not found');
    const probe = await page.evaluate(
      ({ x, y }) => {
        const all = document
          .elementsFromPoint(x, y)
          .slice(0, 6)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return {
              tag: e.tagName,
              cls: (e as HTMLElement).className?.toString().slice(0, 80) ?? '',
              aria: (e as HTMLElement).getAttribute?.('aria-label') ?? '',
              testid: (e as HTMLElement).getAttribute?.('data-testid') ?? '',
              role: e.getAttribute?.('role') ?? '',
              rect: { x: r.x, y: r.y, w: r.width, h: r.height },
              overflow: (e as HTMLElement).style?.overflow ?? '',
            };
          });
        return {
          handleBox: { x, y },
          viewport: { w: window.innerWidth, h: window.innerHeight },
          all,
        };
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    console.log('PROBE>>>', JSON.stringify(probe, null, 2));
    expect(probe.all.length).toBeGreaterThan(0);

    const ancestors = await page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="crop-overlay"]') as HTMLElement | null;
      if (!overlay) return null;
      const out: { tag: string; cls: string; cs: string; z: string }[] = [];
      let el: HTMLElement | null = overlay;
      while (el) {
        const cs = getComputedStyle(el);
        const props = ['transform', 'filter', 'opacity', 'will-change', 'contain', 'zIndex'];
        const interesting = props
          .filter((p) => {
            const v = (cs as unknown as Record<string, string>)[p];
            return p === 'contain' ? v !== 'none' : v !== 'none' && v !== 'auto' && v !== '1';
          })
          .map((p) => `${p}:${(cs as unknown as Record<string, string>)[p]}`)
          .join(' ');
        out.push({
          tag: el.tagName,
          cls: el.className?.toString().slice(0, 60) ?? '',
          cs: interesting,
          z: cs.zIndex,
        });
        el = el.parentElement;
      }
      return out;
    });
    console.log('ANCESTORS>>>', JSON.stringify(ancestors, null, 2));

    const layoutCheck = await page.evaluate(() => {
      const rect = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const win = document.querySelector('.crop-overlay__window') as HTMLElement | null;
      const par = win?.offsetParent as HTMLElement | null;
      return {
        canvasSection: rect('.editor-canvas'),
        canvasContent: rect('canvas.editor-canvas__content-layer'),
        cropWindow: rect('.crop-overlay__window'),
        computedLeft: win ? getComputedStyle(win).left : null,
        computedTop: win ? getComputedStyle(win).top : null,
        offsetParentTag: par?.tagName ?? null,
        offsetParentCls: par?.className?.toString().slice(0, 60) ?? null,
        offsetParentRect: par ? rect('.' + (par.className?.toString().split(' ')[0] ?? '')) : null,
        toolbar: rect('.floating-toolbar [role="toolbar"]'),
      };
    });
    console.log('LAYOUT>>>', JSON.stringify(layoutCheck, null, 2));

    const raised = await page.evaluate(
      ({ x, y }) => {
        const overlay = document.querySelector(
          '[data-testid="crop-overlay"]',
        ) as HTMLElement | null;
        if (!overlay) return null;
        overlay.style.zIndex = '60';
        const all = document
          .elementsFromPoint(x, y)
          .slice(0, 3)
          .map((e) => ({
            tag: e.tagName,
            cls: (e as HTMLElement).className?.toString().slice(0, 60) ?? '',
            aria: (e as HTMLElement).getAttribute?.('aria-label') ?? '',
          }));
        return all;
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    console.log('RAISED>>>', JSON.stringify(raised, null, 2));
    expect(raised).not.toBeNull();
  });
});
