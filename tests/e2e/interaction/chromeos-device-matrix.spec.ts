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
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
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
  { name: 'landscape-899x600', width: 899, height: 600 },
  { name: 'landscape-900x600', width: 900, height: 600 },
  { name: 'landscape-1024x640', width: 1024, height: 640 },
  { name: 'landscape-1025x640', width: 1025, height: 640 },
  { name: 'landscape-1094x700', width: 1094, height: 700 },
  { name: 'landscape-1095x700', width: 1095, height: 700 },
  { name: 'laptop-1200x750', width: 1200, height: 750 },
  { name: 'laptop-1280x800', width: 1280, height: 800 },
  { name: 'portrait-600x960', width: 600, height: 960 },
  { name: 'portrait-800x1280', width: 800, height: 1280 },
  { name: 'split-480x640', width: 480, height: 640 },
  { name: 'zoom200-equivalent-640x400', width: 640, height: 400 },
];

async function captureTabletEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  const root = process.env.VARVE_TABLET_SCREENSHOT_DIR;
  const screenshotPath = root ? join(resolve(root), name) : testInfo.outputPath(name);
  // A hot reload can replace the page context between separate metadata reads
  // and capture. Wait for the editor shell again and read browser metadata in
  // one evaluation so a transient navigation cannot split those reads.
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 15000 });
  const { userAgent, devicePixelRatio } = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
  }));
  const report = {
    browser: page.context().browser()?.browserType().name() ?? 'unknown',
    browserVersion: page.context().browser()?.version() ?? 'unknown',
    userAgent,
    devicePixelRatio,
    ...evidence,
  };
  if (root) {
    await mkdir(dirname(screenshotPath), { recursive: true });
    await writeFile(
      screenshotPath.replace(/\.png$/i, '.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
  await testInfo.attach(name.replace(/\.png$/i, '.json'), {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
}

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
 * Read the editor's serialized document through the React context. The Layers
 * drawer does not render its virtualized rows at <=899px, so a treeitem
 * assertion cannot observe a commit at those widths; the serialized document
 * is the authoritative state.
 */
async function serializeEditorDocument(page: Page): Promise<string> {
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
    return editor.serializeDocument();
  });
}

async function documentNodeCount(page: Page): Promise<number> {
  const serialized = JSON.parse(await serializeEditorDocument(page)) as {
    nodes?: Record<string, unknown>;
  };
  return Object.keys(serialized.nodes ?? {}).length;
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

async function readPanelLauncherOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pairings = [
      ['.editor__layers-panel', '.editor__fab--layers', 'Layers'],
      ['.editor__inspector-panel', '.editor__fab--inspector', 'Inspector'],
      ['.editor__library-panel', '.editor__fab--library', 'Resources'],
    ] as const;
    const overlaps: string[] = [];
    for (const [panelSelector, triggerSelector, label] of pairings) {
      const panel = document.querySelector(panelSelector);
      const trigger = document.querySelector(triggerSelector);
      if (!panel || !trigger) continue;
      const panelRect = panel.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const panelStyle = getComputedStyle(panel);
      const triggerStyle = getComputedStyle(trigger);
      if (
        panelStyle.display !== 'none' &&
        panelStyle.visibility !== 'hidden' &&
        panelRect.width > 0 &&
        panelRect.height > 0 &&
        !panel.hasAttribute('data-collapsed') &&
        triggerStyle.display !== 'none' &&
        triggerStyle.visibility !== 'hidden' &&
        triggerRect.width > 0 &&
        triggerRect.height > 0 &&
        Math.min(panelRect.right, triggerRect.right) > Math.max(panelRect.left, triggerRect.left) &&
        Math.min(panelRect.bottom, triggerRect.bottom) > Math.max(panelRect.top, triggerRect.top)
      ) {
        overlaps.push(`${label} panel intersects its launcher`);
      }
    }
    return overlaps;
  });
}

async function readTopChromeGeometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.display === 'none' || bounds.width <= 0 || bounds.height <= 0) return null;
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    return {
      documentName: rect('.editor-menubar__doc-name'),
      menuRail: rect('.editor-menubar__side'),
      workspaceDock: rect('.workspace-dock__bar'),
    };
  });
}

function topChromeOverlap(geometry: Awaited<ReturnType<typeof readTopChromeGeometry>>): number {
  const { documentName } = geometry;
  if (!documentName) return 0;
  return [geometry.menuRail, geometry.workspaceDock].reduce((largestOverlap, obstacle) => {
    if (!obstacle) return largestOverlap;
    const width =
      Math.min(documentName.right, obstacle.right) - Math.max(documentName.left, obstacle.left);
    const height =
      Math.min(documentName.bottom, obstacle.bottom) - Math.max(documentName.top, obstacle.top);
    return width > 0 && height > 0 ? Math.max(largestOverlap, width * height) : largestOverlap;
  }, 0);
}

function fabTargetOverlaps(geometry: BottomChromeGeometry | null): string[] {
  if (!geometry) return [];
  const overlaps: string[] = [];
  for (let left = 0; left < geometry.fabs.length; left += 1) {
    for (let right = left + 1; right < geometry.fabs.length; right += 1) {
      const a = geometry.fabs[left]!;
      const b = geometry.fabs[right]!;
      if (
        Math.min(a.rect.right, b.rect.right) > Math.max(a.rect.left, b.rect.left) &&
        Math.min(a.rect.bottom, b.rect.bottom) > Math.max(a.rect.top, b.rect.top)
      ) {
        overlaps.push(`${a.cls} intersects ${b.cls}`);
      }
    }
  }
  return overlaps;
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
  test.use({ hasTouch: true });

  for (const entry of VIEWPORT_MATRIX) {
    test(`${entry.name}: no drift, live canvas and toolbar`, async ({ page }, testInfo) => {
      await navigateToEditor(page);
      await page.setViewportSize({ width: entry.width, height: entry.height });
      await settleLayout(page);
      await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

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
      const undersizedTabletTargets = (chromeGeometry?.fabs ?? []).filter(
        ({ rect }) => rect.width < 44 || rect.height < 44,
      );
      expect(
        undersizedTabletTargets,
        `tablet FABs below the chosen 44px comfort target at ${entry.name}: ${JSON.stringify(chromeGeometry)}`,
      ).toEqual([]);
      expect(
        fabTargetOverlaps(chromeGeometry),
        `tablet FAB hit regions overlap at ${entry.name}: ${JSON.stringify(chromeGeometry)}`,
      ).toEqual([]);
      expect(
        await readPanelLauncherOverlaps(page),
        `a visible panel intersects its floating launcher at ${entry.name}`,
      ).toEqual([]);
      let touchModifier: {
        width: number;
        height: number;
        right: number;
        rowRight: number;
        compactCaption: string;
      } | null = null;
      if (entry.width <= 1280) {
        touchModifier = await page.evaluate(() => {
          const button = document.querySelector<HTMLElement>(
            '[data-testid="touch-multiselect-toggle"]',
          );
          const row = document.querySelector('.floating-toolbar__row');
          if (!button || !row) return null;
          const buttonRect = button.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          return {
            width: buttonRect.width,
            height: buttonRect.height,
            right: buttonRect.right,
            rowRight: rowRect.right,
            compactCaption: getComputedStyle(button, '::after').content,
          };
        });
        expect(
          touchModifier,
          'touch multi-select remains reachable beside a constrained canvas',
        ).not.toBeNull();
        expect(touchModifier?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(touchModifier?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(touchModifier?.right ?? 0).toBeLessThanOrEqual((touchModifier?.rowRight ?? 0) + 1);
        expect(touchModifier?.compactCaption).toBe('"Multi"');
      }
      const topChromeGeometry = await readTopChromeGeometry(page);
      if (entry.width <= 1094) {
        expect(
          topChromeGeometry.documentName,
          `the duplicate menubar title should yield to menus and workspace controls at ${entry.name}`,
        ).toBeNull();
      }
      expect(
        topChromeOverlap(topChromeGeometry),
        `document title overlaps menu or workspace switcher at ${entry.name}: ${JSON.stringify(topChromeGeometry)}`,
      ).toBe(0);

      await captureTabletEvidence(page, testInfo, `matrix-${entry.name}.png`, {
        viewport: metrics.viewport,
        documentScrollWidth: metrics.documentScrollWidth,
        bodyScrollWidth: metrics.bodyScrollWidth,
        canvas: metrics.canvas,
        toolbar: metrics.toolbar,
        bottomChrome: chromeGeometry,
        panelLauncherOverlaps: await readPanelLauncherOverlaps(page),
        touchModifier,
        topChrome: topChromeGeometry,
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
    // The committed document must serialize deterministically after a touch
    // interaction (no half-applied transaction, no unstable ids).
    const serializedOnce = await serializeEditorDocument(page);
    const serializedTwice = await serializeEditorDocument(page);
    expect(serializedTwice).toBe(serializedOnce);
    expect(pageErrors).toEqual([]);
  });

  test('a tap selects without moving the object', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    // Draw a rectangle, then switch to Select and tap it with a touch contact.
    await page.keyboard.press('r');
    const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!box) throw new Error('content canvas not laid out');
    await page.mouse.move(box.x + 150, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 280, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('v');
    await settleLayout(page);

    const before = await serializeEditorDocument(page);
    expect(
      JSON.parse(before).nodes && Object.keys(JSON.parse(before).nodes).length,
    ).toBeGreaterThan(0);

    await page.touchscreen.tap(box.x + 235, box.y + 215);
    await page.waitForTimeout(250);
    const after = await serializeEditorDocument(page);
    expect(after).toBe(before);
    expect(pageErrors).toEqual([]);
  });

  test('two-finger pinch zooms the canvas without page zoom', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    const zoomBefore = Number.parseFloat(await page.locator('#status-zoom').inputValue());
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

    const zoomAfter = Number.parseFloat(await page.locator('#status-zoom').inputValue());
    expect(zoomAfter).toBeGreaterThan(zoomBefore * 1.1);
    const pageScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageScale).toBeCloseTo(1, 2);
    expect(pageErrors).toEqual([]);
  });

  test('hands a cancelled touch into pinch navigation and requires a fresh contact', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const beforeDocument = await serializeEditorDocument(page);
    const zoomBefore = Number.parseFloat(await page.locator('#status-zoom').inputValue());
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('content canvas not laid out');

    await page.evaluate(
      ({ x, y }) => {
        const target = document.querySelector('canvas.editor-canvas__content-layer');
        if (!(target instanceof HTMLCanvasElement)) throw new Error('content canvas not found');
        const dispatch = (
          type: string,
          pointerId: number,
          clientX: number,
          clientY: number,
          buttons: number,
        ) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId,
              pointerType: 'touch',
              isPrimary: pointerId === 1,
              clientX,
              clientY,
              button: 0,
              buttons,
              pressure: buttons ? 0.5 : 0,
            }),
          );

        dispatch('pointerdown', 31, x - 45, y, 1);
        dispatch('pointermove', 31, x - 42, y + 2, 1);
        dispatch('pointerdown', 32, x + 45, y, 1);
        // Tool cancellation releases capture. In this ownership transfer the
        // subsequent loss belongs to the pinch and must leave contact 31 alive.
        target.dispatchEvent(
          new PointerEvent('lostpointercapture', {
            pointerId: 31,
            pointerType: 'touch',
            bubbles: false,
          }),
        );
        dispatch('pointermove', 31, x - 110, y - 4, 1);
        dispatch('pointermove', 32, x + 110, y + 4, 1);
        dispatch('pointerup', 32, x + 110, y + 4, 0);
        dispatch('pointermove', 31, x - 80, y + 20, 1);
        dispatch('pointerup', 31, x - 80, y + 20, 0);
      },
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    );

    await expect
      .poll(async () => Number.parseFloat(await page.locator('#status-zoom').inputValue()), {
        timeout: 5000,
      })
      .toBeGreaterThan(zoomBefore * 1.1);
    expect(await serializeEditorDocument(page)).toBe(beforeDocument);
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
    const document = JSON.parse(await serializeEditorDocument(page)) as {
      nodes?: Record<string, { shape?: { points?: Array<{ pressure?: number }> } }>;
    };
    const pressures = Object.values(document.nodes ?? {}).flatMap((node) =>
      (node.shape?.points ?? [])
        .map((point) => point.pressure)
        .filter((pressure): pressure is number => typeof pressure === 'number'),
    );
    expect(
      pressures.length,
      'the pen workflow must persist sampled pressure values for the stroke',
    ).toBeGreaterThan(1);
    expect(Math.max(...pressures) - Math.min(...pressures)).toBeGreaterThan(0.1);
    expect(pageErrors).toEqual([]);
  });

  test('pen takeover leaves existing and new palm contacts inert until lift', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('content canvas not laid out');

    const nodeCount = () => documentNodeCount(page);
    const before = await nodeCount();
    await page.evaluate(
      ({ x, y }) => {
        const target = document.querySelector('canvas.editor-canvas__content-layer');
        if (!(target instanceof HTMLCanvasElement)) throw new Error('content canvas not found');
        const dispatch = (
          type: string,
          pointerId: number,
          pointerType: 'touch' | 'pen',
          clientX: number,
          clientY: number,
          buttons: number,
        ) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId,
              pointerType,
              isPrimary: pointerId === 41,
              clientX,
              clientY,
              button: 0,
              buttons,
              pressure: pointerType === 'pen' && buttons ? 0.6 : buttons ? 0.5 : 0,
            }),
          );

        dispatch('pointerdown', 41, 'touch', x - 140, y - 100, 1);
        dispatch('pointermove', 41, 'touch', x - 90, y - 60, 1);
        dispatch('pointerdown', 42, 'pen', x + 20, y + 30, 1);
        target.dispatchEvent(
          new PointerEvent('lostpointercapture', {
            pointerId: 41,
            pointerType: 'touch',
            bubbles: false,
          }),
        );
        dispatch('pointermove', 42, 'pen', x + 110, y + 100, 1);
        dispatch('pointerup', 42, 'pen', x + 110, y + 100, 0);

        // A new finger cannot take over the old finger's ignored contact.
        dispatch('pointerdown', 43, 'touch', x - 40, y - 20, 1);
        dispatch('pointermove', 43, 'touch', x + 40, y + 60, 1);
        dispatch('pointerup', 43, 'touch', x + 40, y + 60, 0);
        dispatch('pointerup', 41, 'touch', x - 90, y - 60, 0);

        // Once every palm contact has lifted, a fresh touch owns the tool again.
        dispatch('pointerdown', 44, 'touch', x - 120, y - 90, 1);
        dispatch('pointermove', 44, 'touch', x + 120, y + 90, 1);
        dispatch('pointerup', 44, 'touch', x + 120, y + 90, 0);
      },
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    );

    await expect.poll(nodeCount, { timeout: 10000 }).toBe(before + 2);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('tablet back gesture', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'history traversal runs on Chromium');
  test.use({ hasTouch: true, viewport: { width: 800, height: 1280 } });

  test('system back dismisses an open menu instead of leaving the editor', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);
    const urlBefore = page.url();

    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    const rootLayer = page.locator(
      '[data-overlay-kind="menubar-menu"][data-overlay-state="visible"]',
    );
    await expect(rootLayer).toHaveCount(1);

    await page.evaluate(() => window.history.back());
    await expect(rootLayer).toHaveCount(0, { timeout: 5000 });
    expect(page.url()).toBe(urlBefore);
    await expect(page.getByRole('menubar')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('system back dismisses a nested submenu before its parent menu', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);
    const urlBefore = page.url();

    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    const rootLayer = page.locator(
      '[data-overlay-kind="menubar-menu"][data-overlay-state="visible"]',
    );
    await expect(rootLayer).toHaveCount(1);
    await page.getByRole('menuitem', { name: 'Logo', exact: true }).hover();
    const submenu = page.locator('[data-overlay-kind="submenu"][data-overlay-state="visible"]');
    await expect(submenu).toHaveCount(1);

    await page.evaluate(() => window.history.back());
    await expect(submenu).toHaveCount(0, { timeout: 5000 });
    await expect(rootLayer).toHaveCount(1);
    expect(page.url()).toBe(urlBefore);

    await page.evaluate(() => window.history.back());
    await expect(rootLayer).toHaveCount(0, { timeout: 5000 });
    expect(page.url()).toBe(urlBefore);
    expect(pageErrors).toEqual([]);
  });

  test('closing a menu from the UI removes the history guard', async ({ page }) => {
    await navigateToEditor(page);
    await settleLayout(page);

    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    const rootLayer = page.locator(
      '[data-overlay-kind="menubar-menu"][data-overlay-state="visible"]',
    );
    await expect(rootLayer).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(rootLayer).toHaveCount(0);
    await page.waitForTimeout(150);

    const guarded = await page.evaluate(
      () => (history.state as { varveOverlayGuard?: boolean } | null)?.varveOverlayGuard === true,
    );
    expect(guarded).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('portrait and landscape presentation', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'emulated tablet runs on Chromium');

  test.describe('portrait', () => {
    test.use({ hasTouch: true, viewport: { width: 600, height: 960 } });

    test('inspector is a nonmodal lower pane while Resources remains a modal sheet', async ({
      page,
    }, testInfo) => {
      await navigateToEditor(page);
      await settleLayout(page);

      const cases = [
        {
          button: '.editor__fab--inspector',
          panel: '.editor__inspector-panel',
          unmountsOnClose: false,
          minHeightRatio: 0.25,
          maxHeightRatio: 0.4,
          modal: false,
        },
        {
          button: '.editor__fab--library',
          panel: '.editor__library-panel',
          unmountsOnClose: true,
          minHeightRatio: 0.4,
          maxHeightRatio: 0.8,
          modal: true,
        },
      ];
      for (const entry of cases) {
        await page.locator(entry.button).click();
        const panel = page.locator(entry.panel);
        await expect(panel).toHaveAttribute('data-visible', 'true');
        // Let the slide-in transition settle before measuring.
        await page.waitForTimeout(300);
        const geometry = await panel.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            radiusTopLeft: style.borderTopLeftRadius,
            position: style.position,
            innerHeight: window.innerHeight,
          };
        });
        // The inspector is a shallow, nonmodal editing pane. Resources keeps
        // its existing larger modal sheet presentation.
        const viewportHeight = geometry.innerHeight;
        expect(geometry.position).toBe('fixed');
        expect(
          Math.abs(geometry.bottom - viewportHeight),
          `sheet bottom ${geometry.bottom} vs viewport ${viewportHeight}`,
        ).toBeLessThanOrEqual(2);
        expect(geometry.width).toBeGreaterThanOrEqual(600 * 0.9);
        expect(geometry.height).toBeGreaterThan(viewportHeight * entry.minHeightRatio);
        expect(geometry.height).toBeLessThanOrEqual(viewportHeight * entry.maxHeightRatio);
        expect(geometry.top).toBeGreaterThan(viewportHeight * 0.2);
        expect(Number.parseFloat(geometry.radiusTopLeft)).toBeGreaterThan(0);
        if (entry.modal) {
          await expect(page.locator('.editor__panel-backdrop')).toBeVisible();
        } else {
          await expect(page.locator('.editor__panel-backdrop')).toBeHidden();
          await expect(panel).not.toHaveAttribute('aria-modal', 'true');
        }

        await captureTabletEvidence(
          page,
          testInfo,
          `portrait-sheet-${entry.panel.replace(/[^a-z]/gi, '')}.png`,
          { viewport: { width: 600, height: 960 }, panel: entry.panel, geometry },
        );
        await page.keyboard.press('Escape');
        if (entry.unmountsOnClose) {
          await expect(panel).toHaveCount(0);
        } else {
          await expect(panel).not.toHaveAttribute('data-visible');
        }
      }
      expect(pageErrors).toEqual([]);
    });
  });

  test.describe('landscape', () => {
    test.use({ hasTouch: true, viewport: { width: 800, height: 600 } });

    test('supplementary panels stay side drawers', async ({ page }) => {
      await navigateToEditor(page);
      await settleLayout(page);

      await page.locator('.editor__fab--inspector').click();
      const panel = page.locator('.editor__inspector-panel');
      await expect(panel).toHaveAttribute('data-visible', 'true');
      await page.waitForTimeout(300);
      const geometry = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          position: style.position,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          headerStackBottom: Math.max(
            0,
            ...Array.from(
              document.querySelectorAll('.editor-menubar, .editor-tabs-row, .editor-context-bar'),
            ).map((header) => header.getBoundingClientRect().bottom),
          ),
        };
      });
      expect(geometry.position).toBe('fixed');
      expect(Math.abs(geometry.right - geometry.innerWidth)).toBeLessThanOrEqual(2);
      expect(geometry.width).toBeLessThanOrEqual(420);
      expect(geometry.height).toBeGreaterThanOrEqual(geometry.innerHeight * 0.75);
      expect(geometry.top).toBeGreaterThanOrEqual(geometry.headerStackBottom - 2);
      expect(Math.abs(geometry.bottom - geometry.innerHeight)).toBeLessThanOrEqual(2);
      await expect(panel).not.toHaveAttribute('aria-modal', 'true');
      await expect(page.locator('.editor__panel-backdrop')).toBeHidden();
      const canvasPoint = await page
        .locator('canvas.editor-canvas__content-layer')
        .evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { x: Math.min(rect.right - 24, 400), y: Math.max(rect.top + 32, 180) };
        });
      expect(
        await page.evaluate(({ x, y }) => {
          const target = document.elementFromPoint(x, y);
          return Boolean(target?.closest('canvas.editor-canvas__content-layer'));
        }, canvasPoint),
      ).toBe(true);
      expect(pageErrors).toEqual([]);
    });
  });

  test.describe('rotation', () => {
    test.use({ hasTouch: true, viewport: { width: 600, height: 960 } });

    test('preserves the open panel and adapts its presentation', async ({ page }) => {
      await navigateToEditor(page);
      await settleLayout(page);

      await page.locator('.editor__fab--inspector').click();
      const panel = page.locator('.editor__inspector-panel');
      await expect(panel).toHaveAttribute('data-visible', 'true');
      await page.waitForTimeout(300);
      const portrait = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
          innerHeight: window.innerHeight,
        };
      });
      expect(portrait.width).toBeGreaterThanOrEqual(600 * 0.9);
      expect(Math.abs(portrait.bottom - portrait.innerHeight)).toBeLessThanOrEqual(2);

      // Rotate to landscape: the panel stays open (non-destructive). At
      // 960x600 the shell is past the 899px drawer breakpoint, so it docks as
      // the regular inspector column instead of a fixed drawer.
      await page.setViewportSize({ width: 960, height: 600 });
      await settleLayout(page);
      await expect(panel).toHaveAttribute('data-visible', 'true');
      await page.waitForTimeout(300);
      const landscape = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const canvas = document
          .querySelector('canvas.editor-canvas__content-layer')
          ?.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          position: style.position,
          innerHeight: window.innerHeight,
          canvasRight: canvas?.right ?? null,
        };
      });
      expect(landscape.width).toBeLessThanOrEqual(420);
      expect(landscape.height).toBeGreaterThan(0.4 * landscape.innerHeight);
      expect(Math.abs(landscape.right - 960)).toBeLessThanOrEqual(2);
      expect(landscape.canvasRight).not.toBeNull();
      expect(landscape.canvasRight ?? 0).toBeLessThanOrEqual(landscape.left + 1);

      // Rotate back: the sheet presentation returns.
      await page.setViewportSize({ width: 600, height: 960 });
      await settleLayout(page);
      await page.waitForTimeout(300);
      const backToPortrait = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: rect.width,
          bottom: rect.bottom,
          position: style.position,
          innerHeight: window.innerHeight,
        };
      });
      expect(backToPortrait.position).toBe('fixed');
      expect(backToPortrait.width).toBeGreaterThanOrEqual(600 * 0.9);
      expect(Math.abs(backToPortrait.bottom - backToPortrait.innerHeight)).toBeLessThanOrEqual(2);
      expect(pageErrors).toEqual([]);
    });
  });

  test.describe('rotation mid-gesture', () => {
    test.use({ viewport: { width: 800, height: 1280 } });

    test('does not leave a stuck interaction', async ({ page }) => {
      await navigateToEditor(page);
      await settleLayout(page);

      const canvas = page.locator('canvas.editor-canvas__content-layer');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('content canvas not laid out');

      await page.keyboard.press('r');
      const before = await documentNodeCount(page);
      await page.mouse.move(box.x + 120, box.y + 140);
      await page.mouse.down();
      await page.mouse.move(box.x + 240, box.y + 240, { steps: 5 });
      // Rotate while the pointer is down; the gesture must cancel cleanly.
      await page.setViewportSize({ width: 1280, height: 800 });
      await settleLayout(page);
      await page.mouse.up();
      await page.waitForTimeout(200);

      // A fresh gesture still works: the tool is not stuck mid-drag.
      const rotatedBox = await canvas.boundingBox();
      if (!rotatedBox) throw new Error('content canvas missing after rotation');
      await page.keyboard.press('r');
      await page.mouse.move(rotatedBox.x + 160, rotatedBox.y + 160);
      await page.mouse.down();
      await page.mouse.move(rotatedBox.x + 320, rotatedBox.y + 260, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => documentNodeCount(page), { timeout: 10000 }).toBeGreaterThan(before);
      expect(pageErrors).toEqual([]);
    });
  });
});

test.describe('accessibility alternatives and input scoping', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'emulated device matrix runs on Chromium',
  );

  test.describe('non-drag alternatives', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('numeric inspector fields move and constrain a selection without dragging', async ({
      page,
    }) => {
      await navigateToEditor(page);
      await settleLayout(page);

      await page.keyboard.press('r');
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('content canvas not laid out');
      await page.mouse.move(box.x + 200, box.y + 180);
      await page.mouse.down();
      await page.mouse.move(box.x + 360, box.y + 300, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.press('v');
      await page.getByRole('treeitem').first().click();

      const xField = page.getByRole('spinbutton', { name: 'X (px)', exact: true });
      if (!(await xField.isVisible().catch(() => false))) {
        await page
          .getByRole('button', { name: /Position & Size/i })
          .first()
          .click();
      }
      await expect(xField).toBeVisible({ timeout: 10000 });
      const wField = page.getByRole('spinbutton', { name: 'W (px)', exact: true });
      const hField = page.getByRole('spinbutton', { name: 'H (px)', exact: true });

      // Move by typing: the document changes without any drag gesture.
      const beforeMove = await serializeEditorDocument(page);
      const x0 = Number.parseFloat(await xField.inputValue());
      expect(Number.isFinite(x0)).toBe(true);
      await xField.fill(String(x0 + 40));
      await xField.press('Tab');
      await expect.poll(() => serializeEditorDocument(page)).not.toBe(beforeMove);

      // Constrained resize: with the proportion lock on, editing W scales H by
      // the same ratio (the keyboard-free path to a constrained transform).
      const w0 = Number.parseFloat(await wField.inputValue());
      const h0 = Number.parseFloat(await hField.inputValue());
      expect(w0).toBeGreaterThan(0);
      expect(h0).toBeGreaterThan(0);
      await page
        .getByRole('checkbox', { name: 'Constrain proportions' })
        .evaluate((element: HTMLInputElement) => element.click());
      await wField.fill(String(w0 + 60));
      await wField.press('Tab');
      const expectedHeight = h0 * ((w0 + 60) / w0);
      await expect
        .poll(async () => Number.parseFloat(await hField.inputValue()), { timeout: 5000 })
        .toBeGreaterThan(0);
      const heightValue = Number.parseFloat(await hField.inputValue());
      expect(Math.abs(heightValue - expectedHeight)).toBeLessThan(1.5);
      expect(pageErrors).toEqual([]);
    });
  });

  test.describe('on-screen edit actions', () => {
    test.use({ hasTouch: true, viewport: { width: 800, height: 1280 } });

    test('undo and redo are reachable and effective without a keyboard', async ({ page }) => {
      await navigateToEditor(page);
      await settleLayout(page);

      await page.keyboard.press('r');
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('content canvas not laid out');
      await page.mouse.move(box.x + 140, box.y + 160);
      await page.mouse.down();
      await page.mouse.move(box.x + 300, box.y + 280, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => documentNodeCount(page), { timeout: 10000 }).toBeGreaterThan(0);
      const afterDraw = await documentNodeCount(page);

      // Undo/redo through the Edit menu: the same commands the toolbar
      // exposes, reachable by tap alone.
      await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
      await page.getByRole('menuitem', { name: /^undo/i }).click();
      await expect.poll(() => documentNodeCount(page), { timeout: 10000 }).toBeLessThan(afterDraw);

      await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
      await page.getByRole('menuitem', { name: /^redo/i }).click();
      await expect.poll(() => documentNodeCount(page), { timeout: 10000 }).toBe(afterDraw);
      expect(pageErrors).toEqual([]);
    });
  });

  test.describe('wheel scoping', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('panel scrolling, canvas pan, and ctrl+wheel zoom stay in scope', async ({ page }) => {
      await navigateToEditor(page);
      await settleLayout(page);

      // Stack enough objects to overflow the virtualized layers list. Draw one
      // rectangle, then duplicate it with the keyboard: deterministic and far
      // faster than 30 drags, which the renderer drops under load.
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      const canvasBox = await canvas.boundingBox();
      if (!canvasBox) throw new Error('content canvas not laid out');
      await page.keyboard.press('r');
      await page.mouse.move(canvasBox.x + 200, canvasBox.y + 180);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + 300, canvasBox.y + 260, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.press('v');
      await page.getByRole('treeitem').first().click();
      for (let i = 0; i < 40; i += 1) {
        await page.keyboard.press('Control+d');
      }
      await settleLayout(page);
      // The list is virtualized: the DOM renders only the visible window of
      // rows, so assert the underlying scroll capacity instead of a row count.
      const scrollCapacity = await page.evaluate(() => {
        const root = document.querySelector('.editor__layers-panel');
        let maxScroll = 0;
        if (root) {
          for (const element of [root, ...root.querySelectorAll('*')]) {
            maxScroll = Math.max(maxScroll, element.scrollHeight - element.clientHeight);
          }
        }
        return maxScroll;
      });
      expect(scrollCapacity).toBeGreaterThan(100);

      const firstRow = page.getByRole('treeitem').first();
      await expect(firstRow).toBeVisible();
      const rowBox = await firstRow.boundingBox();
      if (!rowBox) throw new Error('layers row not laid out');
      const beforeRowY = rowBox.y;
      const zoomBefore = Number.parseFloat(await page.locator('#status-zoom').inputValue());
      await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(250);

      // The panel consumes the wheel (scrollTop or virtualized row movement)
      // instead of forwarding it to the canvas camera.
      const afterRowY = (await firstRow.boundingBox())?.y ?? 0;
      const panelScrolled = await page.evaluate(() => {
        const root = document.querySelector('.editor__layers-panel');
        if (!root) return false;
        return [root, ...root.querySelectorAll('*')].some((element) => element.scrollTop > 0);
      });
      const wheelDiagnostics = await page.evaluate(() => {
        const root = document.querySelector('.editor__layers-panel');
        const scrollables: Array<{ cls: string; top: number; surplus: number }> = [];
        if (root) {
          for (const element of [root, ...root.querySelectorAll('*')]) {
            const surplus = element.scrollHeight - element.clientHeight;
            if (surplus > 2) {
              scrollables.push({
                cls: `${element.tagName}.${String(element.className).slice(0, 50)}`,
                top: element.scrollTop,
                surplus,
              });
            }
          }
        }
        return {
          treeitems: document.querySelectorAll('[role="treeitem"]').length,
          scrollables: scrollables.slice(0, 5),
        };
      });
      expect(
        afterRowY !== beforeRowY || panelScrolled,
        `wheel did not move the layers panel: ${JSON.stringify(wheelDiagnostics)}`,
      ).toBe(true);
      // Wheel over the panel must not zoom the canvas.
      const zoomAfterPanel = Number.parseFloat(await page.locator('#status-zoom').inputValue());
      expect(zoomAfterPanel).toBeCloseTo(zoomBefore, 1);

      // Ctrl+wheel over the canvas is the trackpad-pinch equivalent and zooms.
      await page.mouse.move(canvasBox.x + 60, canvasBox.y + 60);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -240);
      await page.keyboard.up('Control');
      await expect
        .poll(async () => Number.parseFloat(await page.locator('#status-zoom').inputValue()), {
          timeout: 5000,
        })
        .toBeGreaterThan(zoomAfterPanel);
      expect(pageErrors).toEqual([]);
    });
  });

  test.describe('reduced motion', () => {
    test.use({
      hasTouch: true,
      viewport: { width: 600, height: 960 },
    });

    test('drawer and sheet transitions are removed', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await navigateToEditor(page);
      await settleLayout(page);

      await page.locator('.editor__fab--inspector').click();
      const panel = page.locator('.editor__inspector-panel');
      await expect(panel).toHaveAttribute('data-visible', 'true');
      const transition = await panel.evaluate((element) => {
        const style = getComputedStyle(element);
        return { property: style.transitionProperty, duration: style.transitionDuration };
      });
      expect(transition.property === 'none' || transition.duration === '0s').toBe(true);
      expect(pageErrors).toEqual([]);
    });
  });
});

test.describe('portrait menubar compaction', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'emulated tablet runs on Chromium');
  test.use({ hasTouch: true });

  for (const entry of [
    { name: 'portrait-600x960', width: 600, height: 960 },
    { name: 'portrait-800x1280', width: 800, height: 1280 },
  ]) {
    test(`${entry.name}: no menubar option is clipped and the workspace switcher is compact`, async ({
      page,
    }, testInfo) => {
      await navigateToEditor(page);
      await page.setViewportSize({ width: entry.width, height: entry.height });
      await settleLayout(page);

      const geometry = await page.evaluate(() => {
        const menubar = document.querySelector('.editor-menubar');
        if (!menubar) throw new Error('menubar missing');
        const menubarRect = menubar.getBoundingClientRect();
        const items = Array.from(menubar.querySelectorAll('.editor-menubar__item')).map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            label: el.textContent?.trim() ?? '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        });
        const dockItems = Array.from(menubar.querySelectorAll('.workspace-dock__item')).map(
          (el) => {
            const rect = el.getBoundingClientRect();
            const label = el.querySelector('.workspace-dock__label');
            const labelRect = label?.getBoundingClientRect();
            return {
              width: Math.round(rect.width),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              active: el.classList.contains('workspace-dock__item--active'),
              labelVisible: Boolean(labelRect && labelRect.width > 1),
            };
          },
        );
        const docName = menubar.querySelector('.editor-menubar__center');
        const controlsButton = menubar.querySelector('.editor-menubar__controls button');
        const menuRail = menubar.querySelector('.editor-menubar__side')?.getBoundingClientRect();
        const controlRail = menubar
          .querySelector('.editor-menubar__controls')
          ?.getBoundingClientRect();
        const menuTargets = Array.from(menubar.querySelectorAll('.editor-menubar__item')).map(
          (el) => Math.round(el.getBoundingClientRect().height),
        );
        const historyTargets = Array.from(
          menubar.querySelectorAll('.editor-menubar__controls .varve-iconbtn'),
        ).map((el) => Math.round(el.getBoundingClientRect().height));
        const visibleShortcutBadges = Array.from(
          menubar.querySelectorAll('.workspace-dock__shortcut'),
        ).filter((el) => getComputedStyle(el).display !== 'none').length;
        return {
          menubar: {
            left: Math.round(menubarRect.left),
            right: Math.round(menubarRect.right),
            clientWidth: menubar.clientWidth,
            scrollWidth: menubar.scrollWidth,
          },
          items,
          dockItems,
          menuRail: menuRail
            ? { top: Math.round(menuRail.top), bottom: Math.round(menuRail.bottom) }
            : null,
          controlRail: controlRail
            ? { top: Math.round(controlRail.top), bottom: Math.round(controlRail.bottom) }
            : null,
          menuTargets,
          historyTargets,
          visibleShortcutBadges,
          docNameVisible: Boolean(docName && docName.getBoundingClientRect().width > 1),
          controlsVisible: Boolean(
            controlsButton && controlsButton.getBoundingClientRect().width > 1,
          ),
        };
      });

      const rightEdge = geometry.menubar.left + geometry.menubar.clientWidth;
      const clipped = geometry.items.filter((item) => item.right > rightEdge + 1);
      expect(clipped, `clipped menu items: ${JSON.stringify(geometry)}`).toEqual([]);
      const oversizedDock = geometry.dockItems.filter((item) => !item.active && item.width > 44);
      expect(
        oversizedDock,
        `workspace switcher items wider than 44px in portrait: ${JSON.stringify(geometry)}`,
      ).toEqual([]);
      const labelShowing = geometry.dockItems.filter((item) => item.labelVisible);
      expect(
        labelShowing,
        `active workspace label should remain visible when the strip fits: ${JSON.stringify(geometry)}`,
      ).toHaveLength(1);
      expect(
        geometry.docNameVisible,
        `document name still shown: ${JSON.stringify(geometry)}`,
      ).toBe(false);
      expect(geometry.controlsVisible, `right controls hidden: ${JSON.stringify(geometry)}`).toBe(
        true,
      );
      expect(geometry.menuRail, `menu rail missing: ${JSON.stringify(geometry)}`).not.toBeNull();
      expect(
        geometry.controlRail,
        `control rail missing: ${JSON.stringify(geometry)}`,
      ).not.toBeNull();
      expect(
        geometry.controlRail!.top,
        `workspace controls should sit in their own row: ${JSON.stringify(geometry)}`,
      ).toBeGreaterThanOrEqual(geometry.menuRail!.bottom);
      expect(
        [...geometry.menuTargets, ...geometry.historyTargets].every((height) => height >= 44),
        `top-bar controls should share tablet target sizing: ${JSON.stringify(geometry)}`,
      ).toBe(true);
      expect(
        geometry.visibleShortcutBadges,
        `keyboard-only badges should not crowd the touch switcher: ${JSON.stringify(geometry)}`,
      ).toBe(0);
      expect(
        geometry.menubar.scrollWidth,
        `menubar content overflows its box: ${JSON.stringify(geometry)}`,
      ).toBeLessThanOrEqual(geometry.menubar.clientWidth + 1);

      const screenshotPath = testInfo.outputPath(`menubar-${entry.name}.png`);
      await page.screenshot({
        path: screenshotPath,
        clip: { x: 0, y: 0, width: entry.width, height: 120 },
      });
      await testInfo.attach(`menubar-${entry.name}`, {
        path: screenshotPath,
        contentType: 'image/png',
      });
      expect(pageErrors).toEqual([]);
    });
  }
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
