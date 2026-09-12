/**
 * ChromeOS Stage 4 acceptance: responsive workspace and device interaction.
 *
 * Everything here runs in an emulated browser context. It is regression
 * coverage for layout, target geometry, and the app's own pointer pipeline —
 * NOT evidence of USI Pen 2 pressure, ChromeOS palm rejection, or real
 * virtual-keyboard behavior. Those require the Duet hardware checklist in
 * `docs/audits/chromeos-stage4-input-responsive-2026-09-12.md`.
 *
 * Emulated coverage:
 *  - responsive viewport matrix (no horizontal drift, canvas/toolbar alive)
 *  - CSS-pixel target floor at coarse pointers (WCAG 2.2 SC 2.5.8: >= 24px)
 *  - one-finger touch routes to the active tool
 *  - two-finger pinch zooms the canvas without page zoom
 *  - pen pointer events (CDP, synthetic force) create a stroke
 *  - keyboard/visual-viewport inset publication and floating-surface offset
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

interface MatrixEntry {
  name: string;
  width: number;
  height: number;
}

/**
 * Coverage samples from the Stage 4 brief. The 1920x1200 Duet panel is not a
 * CSS viewport; these are representative sizes, not device defaults.
 * `zoom200-equivalent-640x400` stands in for browser zoom at 200% on
 * 1280x800: browser zoom halves the CSS viewport, and CSS px geometry must
 * stay correct at that effective size.
 */
const VIEWPORT_MATRIX: MatrixEntry[] = [
  { name: 'laptop-960x600', width: 960, height: 600 },
  { name: 'laptop-1200x750', width: 1200, height: 750 },
  { name: 'laptop-1280x800', width: 1280, height: 800 },
  { name: 'portrait-600x960', width: 600, height: 960 },
  { name: 'portrait-800x1280', width: 800, height: 1280 },
  { name: 'split-480x640', width: 480, height: 640 },
  { name: 'zoom200-equivalent-640x400', width: 640, height: 400 },
];

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });
  // Layout/input acceptance is not a crash-recovery test. Under heavy
  // concurrent load `navigateToEditor` can retry page loads within one browser
  // context, and the app's crash-loop detector then correctly shows safe mode
  // ("closed unexpectedly several times in a row"). Mark the session clean and
  // clear the loop store before each navigation so this spec tests what it
  // says it tests; crash recovery has dedicated specs.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('strata-clean-shutdown', 'true');
      localStorage.removeItem('varve:crash-loop');
    } catch {
      // Storage unavailable: the app's in-memory fallback already applies.
    }
  });
});

async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Read the editor's document node count through the React context. The Layers
 * drawer does not render its virtualized rows at <=899px, so a treeitem
 * assertion cannot observe a commit at those widths; the serialized document
 * is the authoritative state.
 */
async function documentNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) throw new Error('React root not found');
    const key = Object.keys(root).find(
      (name) => name.startsWith('__reactContainer$') || name.startsWith('__reactFiber$'),
    );
    if (!key) throw new Error('React fiber not found');
    interface EditorLike {
      serializeDocument?: () => string;
    }
    interface FiberLike {
      memoizedProps?: { value?: EditorLike };
      child?: unknown;
      sibling?: unknown;
    }
    function find(fiber: unknown): EditorLike | null {
      if (!fiber || typeof fiber !== 'object') return null;
      const candidate = fiber as FiberLike;
      if (typeof candidate.memoizedProps?.value?.serializeDocument === 'function') {
        return candidate.memoizedProps.value;
      }
      return find(candidate.child) ?? find(candidate.sibling);
    }
    const editor = find((root as unknown as Record<string, unknown>)[key]);
    if (!editor?.serializeDocument) throw new Error('Missing editor context');
    const serializedDocument = JSON.parse(editor.serializeDocument()) as {
      nodes?: Record<string, unknown>;
    };
    return Object.keys(serializedDocument.nodes ?? {}).length;
  });
}

interface ViewportMetrics {
  viewport: { width: number; height: number; dpr: number };
  documentScrollWidth: number;
  documentClientWidth: number;
  bodyScrollWidth: number;
  canvas: { x: number; y: number; width: number; height: number } | null;
  shellHeight: number | null;
  toolbar: { width: number; height: number } | null;
  overflowing: Array<{ tag: string; cls: string; left: number; right: number; width: number }>;
}

async function readViewportMetrics(page: Page): Promise<ViewportMetrics> {
  return page.evaluate(() => {
    const rectOf = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const overflowing: Array<{
      tag: string;
      cls: string;
      left: number;
      right: number;
      width: number;
    }> = [];
    for (const element of document.querySelectorAll('body *')) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0) continue;
      // Fixed-position boxes (closed drawers translated offscreen) do not
      // contribute to the document's scrollable overflow.
      if (getComputedStyle(element).position === 'fixed') continue;
      if (rect.right > window.innerWidth + 1 || rect.left < -1) {
        overflowing.push({
          tag: element.tagName.toLowerCase(),
          cls: typeof element.className === 'string' ? element.className.slice(0, 80) : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        });
      }
    }
    overflowing.sort((a, b) => b.right - a.right);
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      canvas: rectOf('canvas.editor-canvas__content-layer'),
      shellHeight: rectOf('.editor-shell')?.height ?? null,
      toolbar: rectOf('[data-testid="toolbar"]'),
      overflowing: overflowing.slice(0, 15),
    };
  });
}

interface ChromeRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

interface BottomChromeGeometry {
  toolbar: ChromeRect;
  fabs: Array<{ cls: string; rect: ChromeRect }>;
}

async function readBottomChromeGeometry(page: Page): Promise<BottomChromeGeometry | null> {
  return page.evaluate(() => {
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    const toolbar = document.querySelector('[data-testid="toolbar"]');
    if (!toolbar) return null;
    const toolbarRect = rect(toolbar);
    const fabs = [...document.querySelectorAll('.editor__fab')]
      .map((fab) => ({ cls: fab.className, rect: rect(fab) }))
      .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0);
    return { toolbar: toolbarRect, fabs };
  });
}

function bottomChromeOverlaps(
  geometry: BottomChromeGeometry | null,
): Array<{ cls: string; width: number; height: number }> {
  if (!geometry) return [];
  return geometry.fabs
    .map(({ cls, rect: f }) => {
      const t = geometry.toolbar;
      const width = Math.min(t.right, f.right) - Math.max(t.left, f.left);
      const height = Math.min(t.bottom, f.bottom) - Math.max(t.top, f.top);
      return width > 0 && height > 0 ? { cls, width, height } : null;
    })
    .filter((entry): entry is { cls: string; width: number; height: number } => Boolean(entry));
}

test.describe('responsive viewport matrix', () => {
  for (const entry of VIEWPORT_MATRIX) {
    test(`${entry.name}: no drift, live canvas and toolbar`, async ({ page }, testInfo) => {
      await navigateToEditor(page);
      await page.setViewportSize({ width: entry.width, height: entry.height });
      await settleLayout(page);

      const metrics = await readViewportMetrics(page);
      expect(metrics.viewport.width).toBe(entry.width);
      expect(
        metrics.documentScrollWidth,
        `horizontal drift; overflowing elements: ${JSON.stringify(metrics.overflowing)}`,
      ).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
      expect(
        metrics.bodyScrollWidth,
        `body horizontal drift; overflowing elements: ${JSON.stringify(metrics.overflowing)}`,
      ).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
      expect(metrics.canvas).not.toBeNull();
      expect(metrics.canvas?.width ?? 0).toBeGreaterThan(120);
      expect(metrics.canvas?.height ?? 0).toBeGreaterThan(120);
      expect(metrics.shellHeight ?? 0).toBeLessThanOrEqual(entry.height + 1);
      expect(metrics.toolbar?.width ?? 0).toBeGreaterThan(0);

      // The floating toolbar and the drawer FABs share the lower canvas edge.
      // They must not overlap: an overlapped control loses its hit area.
      const chromeGeometry = await readBottomChromeGeometry(page);
      expect(
        bottomChromeOverlaps(chromeGeometry),
        `bottom chrome overlap at ${entry.name}: ${JSON.stringify(chromeGeometry)}`,
      ).toEqual([]);

      const screenshotPath = testInfo.outputPath(`matrix-${entry.name}.png`);
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach(`matrix-${entry.name}`, {
        path: screenshotPath,
        contentType: 'image/png',
      });
      expect(pageErrors).toEqual([]);
    });
  }
});

test.describe('bottom chrome clearance', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'keyboard workspace switch runs on Chromium',
  );
  test.use({ viewport: { width: 800, height: 1280 } });

  test('drawer FABs clear the floating toolbar in Design and Draw modes', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    const design = await readBottomChromeGeometry(page);
    expect(bottomChromeOverlaps(design), `design-mode overlap: ${JSON.stringify(design)}`).toEqual(
      [],
    );

    // Draw mode adds the brush controls block below the main tool row; the
    // FABs must clear the taller palette too.
    await page.keyboard.press('Control+Shift+3');
    await page.waitForTimeout(500);
    await settleLayout(page);

    const draw = await readBottomChromeGeometry(page);
    expect(bottomChromeOverlaps(draw), `draw-mode overlap: ${JSON.stringify(draw)}`).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('fractional device pixel ratio', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'deviceScaleFactor emulation is Chromium-only in this suite',
  );
  test.use({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1.25 });

  test('keeps the canvas backing store proportional', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    const ratio = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      if (!canvas) return null;
      const cssWidth = canvas.clientWidth;
      const backingWidth = canvas.width;
      return cssWidth > 0 ? backingWidth / cssWidth : null;
    });
    expect(ratio).not.toBeNull();
    expect(Math.abs((ratio ?? 0) - 1.25)).toBeLessThan(0.05);

    const metrics = await readViewportMetrics(page);
    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('coarse pointer targets', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'touch emulation runs on Chromium');
  test.use({ hasTouch: true, viewport: { width: 800, height: 1280 } });

  test('primary chrome meets the 24 CSS px target floor at 800x1280', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await settleLayout(page);

    const measurements = await page.evaluate(() => {
      const roots = [
        '.editor-menubar',
        '.editor-status',
        '[data-testid="toolbar"]',
        '.editor__fab',
      ];
      const seen = new Set<Element>();
      const results: Array<{
        tag: string;
        label: string;
        width: number;
        height: number;
        inViewport: boolean;
      }> = [];
      for (const root of roots) {
        for (const element of document.querySelectorAll(
          `${root} button, ${root} [role="button"], ${root} [role="tab"]`,
        )) {
          if (seen.has(element)) continue;
          seen.add(element);
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const inViewport =
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth;
          results.push({
            tag: element.tagName.toLowerCase(),
            label:
              element.getAttribute('aria-label') ??
              element.getAttribute('title') ??
              element.textContent?.trim().slice(0, 40) ??
              '',
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
            inViewport,
          });
        }
      }
      return results;
    });

    expect(measurements.length).toBeGreaterThan(8);
    await testInfo.attach('coarse-target-measurements.json', {
      body: Buffer.from(JSON.stringify(measurements, null, 2)),
      contentType: 'application/json',
    });
    const undersized = measurements.filter((m) => m.inViewport && (m.width < 24 || m.height < 24));
    expect(
      undersized,
      `controls below the 24px WCAG 2.2 SC 2.5.8 floor: ${JSON.stringify(undersized)}`,
    ).toEqual([]);
  });
});

test.describe('touch interaction', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP input dispatch runs on Chromium');
  test.use({ hasTouch: true, viewport: { width: 800, height: 1280 } });

  test('one-finger touch draws with the active tool', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    const beforeCount = await documentNodeCount(page);
    const beforePixels = await contentCanvas.screenshot();

    await page.keyboard.press('r');
    const box = await contentCanvas.boundingBox();
    if (!box) throw new Error('content canvas not laid out');
    const session = await page.context().newCDPSession(page);
    const start = { x: box.x + 120, y: box.y + 120 };
    const end = { x: box.x + 320, y: box.y + 260 };

    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...start, id: 1 }],
      });
      for (let step = 1; step <= 6; step += 1) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: start.x + ((end.x - start.x) * step) / 6,
              y: start.y + ((end.y - start.y) * step) / 6,
              id: 1,
            },
          ],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session.detach();
    }

    await expect
      .poll(() => documentNodeCount(page), { timeout: 10000 })
      .toBeGreaterThan(beforeCount);
    await expect
      .poll(async () => Buffer.compare(beforePixels, await contentCanvas.screenshot()), {
        timeout: 10000,
      })
      .not.toBe(0);
    expect(pageErrors).toEqual([]);
  });

  test('two-finger pinch zooms the canvas without page zoom', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    const zoomBefore = Number.parseFloat(await page.locator('#menubar-zoom').inputValue());
    expect(zoomBefore).toBeGreaterThan(0);

    const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!box) throw new Error('content canvas not laid out');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const session = await page.context().newCDPSession(page);

    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: cx - 60, y: cy, id: 1 },
          { x: cx + 60, y: cy, id: 2 },
        ],
      });
      for (let step = 1; step <= 5; step += 1) {
        const spread = 60 + step * 24;
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: cx - spread, y: cy, id: 1 },
            { x: cx + spread, y: cy, id: 2 },
          ],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session.detach();
    }
    await page.waitForTimeout(200);

    const zoomAfter = Number.parseFloat(await page.locator('#menubar-zoom').inputValue());
    expect(zoomAfter).toBeGreaterThan(zoomBefore * 1.1);
    const pageScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageScale).toBeCloseTo(1, 2);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('pen interaction', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP input dispatch runs on Chromium');
  test.use({ viewport: { width: 960, height: 600 } });

  test('pen pointer events with force create a stroke', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    await page.keyboard.press('Shift+p');
    const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!box) throw new Error('content canvas not laid out');
    const session = await page.context().newCDPSession(page);
    const start = { x: box.x + 120, y: box.y + 140 };
    const end = { x: box.x + 360, y: box.y + 260 };

    try {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: start.x,
        y: start.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
        pointerType: 'pen',
        force: 0.15,
      });
      for (let step = 1; step <= 8; step += 1) {
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: start.x + ((end.x - start.x) * step) / 8,
          y: start.y + ((end.y - start.y) * step) / 8,
          button: 'left',
          buttons: 1,
          pointerType: 'pen',
          force: 0.15 + step * 0.1,
          tiltX: 10,
          tiltY: -5,
        });
      }
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: end.x,
        y: end.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        pointerType: 'pen',
        force: 0,
      });
    } finally {
      await session.detach();
    }

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/path|vector shape/i);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('keyboard inset publication', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'VirtualKeyboard API is Chromium-only',
  );
  test.use({ viewport: { width: 480, height: 640 } });

  test('publishes keyboard geometry and lifts bottom-anchored chrome', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    const initial = await page.evaluate(() => ({
      inset: getComputedStyle(document.documentElement)
        .getPropertyValue('--keyboard-inset-bottom')
        .trim(),
      fabBottom: getComputedStyle(document.querySelector('.editor__fab--layers')!).bottom,
      hasVirtualKeyboard: 'virtualKeyboard' in navigator,
    }));
    expect(initial.inset).toBe('0px');
    expect(initial.fabBottom).not.toBe('auto');

    test.skip(!initial.hasVirtualKeyboard, 'Chromium build without VirtualKeyboard API');
    const keyboardChanged = await page.evaluate(() => {
      const keyboard = (
        navigator as Navigator & {
          virtualKeyboard?: {
            boundingRect: DOMRect;
            dispatchEvent: (event: Event) => boolean;
          };
        }
      ).virtualKeyboard;
      if (!keyboard) return false;
      Object.defineProperty(keyboard, 'boundingRect', {
        configurable: true,
        get: () => new DOMRect(0, window.innerHeight - 300, window.innerWidth, 300),
      });
      keyboard.dispatchEvent(new Event('geometrychange'));
      return true;
    });
    expect(keyboardChanged).toBe(true);
    await page.waitForTimeout(120);

    const withKeyboard = await page.evaluate(() => ({
      inset: getComputedStyle(document.documentElement)
        .getPropertyValue('--keyboard-inset-bottom')
        .trim(),
      fabBottom: getComputedStyle(document.querySelector('.editor__fab--layers')!).bottom,
      visualHeight: getComputedStyle(document.documentElement)
        .getPropertyValue('--visual-viewport-height')
        .trim(),
    }));
    expect(withKeyboard.inset).toBe('300px');
    expect(withKeyboard.visualHeight).not.toBe('');

    const bottomBefore = Number.parseFloat(initial.fabBottom);
    const bottomWithKeyboard = Number.parseFloat(withKeyboard.fabBottom);
    expect(bottomWithKeyboard - bottomBefore).toBeCloseTo(300, 0);

    await page.evaluate(() => {
      const keyboard = (
        navigator as Navigator & {
          virtualKeyboard?: { dispatchEvent: (event: Event) => boolean };
        }
      ).virtualKeyboard;
      if (!keyboard) return;
      Reflect.deleteProperty(keyboard, 'boundingRect');
      keyboard.dispatchEvent(new Event('geometrychange'));
    });
    await page.waitForTimeout(120);
    const restored = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset-bottom').trim(),
    );
    expect(restored).toBe('0px');
    expect(pageErrors).toEqual([]);
  });
});
