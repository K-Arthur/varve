/**
 * Responsive contract for the selection path (`.selection-breadcrumb`) and the
 * canvas rulers — the canvas-anchored chrome that the dock geometry hook does
 * not place itself.
 *
 * `useEditorDockGeometry` positions the canvas dock, the Layers rail and the
 * Inspector with absolute rects. Chrome that anchored to the shell's `canvas`
 * *grid area* instead tracked the panel track tokens, which are a different
 * rectangle: at 1920px the path bar began 134px left of the canvas (painting
 * its leading levels under the Layers rail) and ran 69px past the canvas's
 * right edge, and at 900px it started 66px inside the canvas. The bar now
 * lives inside the dock, in a row of its own.
 *
 * The rulers are anchored to `.editor-canvas` itself. Their strips were
 * `position: sticky` and therefore in flow: the vertical ruler was solved from
 * the canvas element's intrinsic 2:1 ratio — a 20x10px stub, so its markers
 * could not be placed against the artwork at all — and the top strip started
 * at the container origin, where the selection path bar (drawn above it)
 * covered it whenever a selection existed.
 *
 * Every assertion below failed on real measurements before the fix.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
}

const WIDTHS = [1920, 1440, 1280, 1160, 1000, 936, 900, 768, 641];

/** Draw a frame with a child rect inside it, then deep-select the child. */
async function selectDeep(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  await page.keyboard.press('f');
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 120, { steps: 5 });
  await page.mouse.move(box.x + 340, box.y + 220, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  await page.keyboard.press('r');
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 200, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  await page.keyboard.press('v');
  await page.waitForTimeout(150);

  // Deep-select the child so the path has more than one level.
  await page.keyboard.down('Control');
  await page.mouse.click(box.x + 180, box.y + 160);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
}

/** Nest five frames inside each other and deep-select a rect in the innermost. */
async function selectVeryDeep(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  for (let level = 0; level < 5; level += 1) {
    const inset = 40 + level * 24;
    await page.keyboard.press('f');
    await page.mouse.move(box.x + inset, box.y + inset);
    await page.mouse.down();
    await page.mouse.move(box.x + inset + 120, box.y + inset + 60, { steps: 4 });
    await page.mouse.move(box.x + inset + 240, box.y + inset + 140, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }

  await page.keyboard.press('r');
  await page.mouse.move(box.x + 190, box.y + 190);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 240, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  await page.keyboard.press('v');
  await page.waitForTimeout(150);
  await page.keyboard.down('Control');
  await page.mouse.click(box.x + 215, box.y + 215);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
}

function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    };
    const dock = document.querySelector('.editor-shell__canvas-dock');
    const bar = document.querySelector('.selection-breadcrumb');
    const canvas = document.querySelector('.editor-canvas');
    const shell = document.querySelector('.editor-shell');
    // The y where the shell grid's `canvas` row starts — the layout authority
    // for where the dock (and every panel it places) belongs.
    const rows = shell ? getComputedStyle(shell).gridTemplateRows.trim().split(/\s+/) : [];
    const rowHeight = (index: number) => {
      const parsed = Number.parseFloat(rows[index] ?? '');
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const canvasRowTop = rows.length >= 2 ? rowHeight(0) + rowHeight(1) : 0;
    const boxOf = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        right: r.right,
        bottom: r.bottom,
        // Compact widths park the rails off-canvas as drawers; those are not
        // asserted against the viewport.
        visible: cs.display !== 'none' && cs.visibility === 'visible' && r.width > 0,
      };
    };
    const dockBox = box(dock);
    const segments = Array.from(document.querySelectorAll('.selection-breadcrumb__segment')).map(
      (el) => {
        const r = el.getBoundingClientRect();
        const nameEl = el.querySelector(
          '.selection-breadcrumb__segment-name',
        ) as HTMLElement | null;
        return {
          text: (el.textContent ?? '').trim(),
          right: r.right,
          nameRight: nameEl ? nameEl.getBoundingClientRect().right : r.right,
          nameClipped: nameEl ? nameEl.scrollWidth - nameEl.clientWidth : 0,
        };
      },
    );
    const rulerCorner = document.querySelector('.ruler-corner');
    const overflowBtn = document.querySelector('.selection-breadcrumb__overflow-btn');
    const leftRulerCanvas = document.querySelector<HTMLCanvasElement>('.ruler-canvas--left');
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      canvasRowTop,
      shellClientTop: shell ? (shell as HTMLElement).clientTop : null,
      layersPanel: boxOf('.editor__layers-panel'),
      inspectorPanel: boxOf('.editor__inspector-panel'),
      dock: dockBox ? { ...dockBox, position: getComputedStyle(dock!).position } : null,
      bar: box(bar),
      barScroll: bar ? { scroll: bar.scrollWidth, client: bar.clientWidth } : null,
      canvas: box(canvas),
      canvasSize: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null,
      ruler: box(document.querySelector('.ruler-container')),
      rulerTop: box(document.querySelector('.ruler-top-wrapper')),
      rulerLeft: box(document.querySelector('.ruler-left-wrapper')),
      rulerCorner: box(rulerCorner),
      topCanvas: box(document.querySelector('.ruler-canvas--top')),
      leftCanvas: box(leftRulerCanvas),
      leftCanvasLayout: leftRulerCanvas
        ? {
            inlineHeight: leftRulerCanvas.style.height,
            computedHeight: getComputedStyle(leftRulerCanvas).height,
            attributeHeight: leftRulerCanvas.height,
            parentClientHeight: leftRulerCanvas.parentElement?.clientHeight ?? null,
            parentRectHeight: leftRulerCanvas.parentElement?.getBoundingClientRect().height ?? null,
          }
        : null,
      segments,
      overflowLabel: overflowBtn?.getAttribute('aria-label') ?? null,
      barIsDockChild: bar
        ? bar.parentElement?.classList.contains('editor-shell__canvas-dock')
        : null,
    };
  });
}

test.describe('selection path + rulers responsive contract', () => {
  test.use({ viewport: { width: 1920, height: 730 } });

  test('path bar and rulers share the canvas rectangle at every width', async ({ page }) => {
    test.setTimeout(300_000);
    await navigateToEditor(page);
    await selectDeep(page);
    await expect(page.locator('.selection-breadcrumb')).toBeVisible();

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width === 1920 ? 730 : 800 });
      await page.waitForTimeout(250);
      const m = await measure(page);
      const near = (a: number, b: number, tolerance = 1) => Math.abs(a - b) <= tolerance;

      expect(m.bar, `path bar missing at ${width}px`).not.toBeNull();
      expect(m.dock, `canvas dock missing at ${width}px`).not.toBeNull();
      expect(m.ruler, `ruler container missing at ${width}px`).not.toBeNull();

      // 1. The bar owns the canvas column exactly — never the rails, never a
      //    narrower grid track.
      expect(near(m.bar!.x, m.dock!.x), `bar left at ${width}px`).toBe(true);
      expect(near(m.bar!.right, m.dock!.right), `bar right at ${width}px`).toBe(true);

      // 1b. No band opens between the tab strip and the panels/canvas: the dock
      //     starts exactly where the shell grid's canvas row starts. The
      //     geometry hook used to read `.editor-canvas`'s top as that reference
      //     — a value *inside* the dock it positions — so every measurement
      //     pass added the rows above the canvas (the path row) to it and
      //     pushed the dock, the rails and the canvas further down, leaving a
      //     growing empty band under the open tabs.
      expect(
        near(m.dock!.y, m.canvasRowTop + (m.shellClientTop ?? 0), 1.5),
        `dock top at ${width}px: ${JSON.stringify({ dock: m.dock!.y, canvasRowTop: m.canvasRowTop, shellClientTop: m.shellClientTop })}`,
      ).toBe(true);
      expect(
        near(m.canvas!.y, m.bar!.bottom, 1),
        `canvas follows the path row at ${width}px: ${JSON.stringify({ canvas: m.canvas!.y, barBottom: m.bar!.bottom })}`,
      ).toBe(true);
      // The rails are placed from the same bounds as the dock, so a docked rail
      // never intrudes into the canvas rectangle and never leaves the viewport.
      // Compact widths turn them into drawers; those are intentionally parked
      // off-canvas when closed, so only visible rails are asserted.
      for (const [name, panel] of [
        ['layers', m.layersPanel],
        ['inspector', m.inspectorPanel],
      ] as const) {
        if (!panel?.visible) continue;
        expect(panel.x, `${name} panel inside the viewport at ${width}px`).toBeGreaterThanOrEqual(
          -1,
        );
        expect(panel.right, `${name} panel inside the viewport at ${width}px`).toBeLessThanOrEqual(
          m.viewport.w + 1,
        );
        expect(
          panel.bottom,
          `${name} panel bottom at ${width}px: ${JSON.stringify({ panel: panel.bottom, viewport: m.viewport.h })}`,
        ).toBeLessThanOrEqual(m.viewport.h + 1);
      }
      if (m.layersPanel?.visible) {
        expect(
          m.layersPanel.right,
          `layers rail overlaps the canvas at ${width}px: ${JSON.stringify({ panel: m.layersPanel.right, dock: m.dock!.x })}`,
        ).toBeLessThanOrEqual(m.dock!.x + 1);
      }
      if (m.inspectorPanel?.visible) {
        expect(
          m.inspectorPanel.x,
          `inspector overlaps the canvas at ${width}px: ${JSON.stringify({ panel: m.inspectorPanel.x, dock: m.dock!.right })}`,
        ).toBeGreaterThanOrEqual(m.dock!.right - 1);
      }

      // 2. The bar is its own row above the canvas: it must not cover the
      //    rulers, which are anchored to the canvas's top edge.
      expect(m.bar!.bottom, `bar overlaps canvas at ${width}px`).toBeLessThanOrEqual(
        m.canvas!.y + 1,
      );
      expect(m.rulerTop!.y, `top ruler under the bar at ${width}px`).toBeGreaterThanOrEqual(
        m.bar!.bottom - 1,
      );

      // 3. The ruler strips are anchored to the canvas rectangle...
      expect(near(m.ruler!.x, m.canvas!.x), `ruler left at ${width}px`).toBe(true);
      expect(near(m.ruler!.y, m.canvas!.y), `ruler top at ${width}px`).toBe(true);
      expect(near(m.ruler!.right, m.canvas!.right), `ruler right at ${width}px`).toBe(true);

      // 4. ...and are laid out as a top strip plus a full-height left strip
      //    (the left ruler was a 20x10px stub: it was solved from the canvas
      //    element's intrinsic ratio, so its markers could not be placed).
      expect(m.rulerLeft!.h, `left ruler height at ${width}px`).toBeGreaterThanOrEqual(
        m.canvas!.h - 21,
      );
      expect(m.rulerLeft!.w, `left ruler width at ${width}px`).toBeGreaterThanOrEqual(19);
      expect(m.rulerTop!.w, `top ruler width at ${width}px`).toBeGreaterThanOrEqual(
        m.canvas!.w - 1,
      );
      expect(m.rulerCorner, `ruler corner at ${width}px`).not.toBeNull();

      // 5. Both ruler canvases are drawn at the full strip size, so their
      //    world-to-screen mapping matches the canvas viewport above/left of
      //    the artwork.
      expect(
        near(m.topCanvas!.w, m.canvas!.w, 1.5),
        `top ruler canvas width at ${width}px: ${JSON.stringify({ ruler: m.topCanvas!.w, canvas: m.canvas!.w })}`,
      ).toBe(true);
      expect(
        near(m.leftCanvas!.h, m.canvas!.h, 1.5),
        `left ruler canvas height at ${width}px: ${JSON.stringify({ ruler: m.leftCanvas!.h, canvas: m.canvas!.h, wrapper: m.rulerLeft!.h, layout: m.leftCanvasLayout })}`,
      ).toBe(true);

      // 6. Every level of the path stays inside the bar and is readable: names
      //    ellipsize inside their own segment rather than spilling across it,
      //    and the bar never clips levels behind an unreachable edge.
      for (const segment of m.segments) {
        expect(
          segment.right,
          `segment "${segment.text}" past the bar edge at ${width}px`,
        ).toBeLessThanOrEqual(m.bar!.right + 1);
        expect(
          segment.nameRight,
          `segment "${segment.text}" name spills at ${width}px`,
        ).toBeLessThanOrEqual(segment.right + 1);
      }
      expect(m.barScroll!.scroll, `path clipped at ${width}px`).toBeLessThanOrEqual(
        m.barScroll!.client + 1,
      );
      // The leaf must stay visible: it is what the path identifies.
      const leaf = m.segments.at(-1);
      expect(leaf, `path leaf at ${width}px`).toBeDefined();
      expect(page.locator('.selection-breadcrumb__segment').last()).toBeVisible();
    }

    // The bar is only aligned because it lives in the geometry-owned dock.
    const last = await measure(page);
    expect(last.barIsDockChild).toBe(true);
  });

  test('a path longer than the inline limit folds its middle levels into the menu once', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await navigateToEditor(page);
    await selectVeryDeep(page);

    const bar = page.locator('.selection-breadcrumb');
    await expect(bar).toBeVisible();

    const overflow = bar.locator('.selection-breadcrumb__overflow-btn');
    await expect(overflow).toBeVisible();

    const visibleNames = await bar
      .locator('.selection-breadcrumb__segment')
      .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
    const hiddenCount = await bar
      .locator('.selection-breadcrumb__overflow-btn')
      .getAttribute('aria-label');
    const hiddenMatch = /^(\d+) more levels$/.exec(hiddenCount ?? '');
    expect(hiddenMatch, `overflow label was "${hiddenCount}"`).not.toBeNull();
    expect(Number(hiddenMatch![1])).toBeGreaterThan(0);

    await overflow.click();
    const menu = page.getByRole('menu', { name: 'Selection path' });
    await expect(menu).toBeVisible();
    const items = menu.getByRole('menuitem');
    await expect(items).toHaveCount(Number(hiddenMatch![1]));
    const menuNames = await items.allInnerTexts();

    // The menu must offer exactly the levels the bar does not show: no level
    // is dropped, and none is listed twice (it used to re-list the two
    // leading levels the bar already rendered).
    for (const name of menuNames) {
      const levelName = (name.split(': ').at(-1) ?? name).trim();
      const alreadyInline = visibleNames.some((visible) => visible.endsWith(levelName));
      expect(alreadyInline, `menu level "${levelName}" is already inline`).toBe(false);
    }
    expect(new Set(menuNames).size).toBe(menuNames.length);
  });
});
