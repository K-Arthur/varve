import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas } from '../shared';

/**
 * Warp direct-manipulation oracle: the latest pointer sample must control
 * the next visible frame. A per-sample canonical update path replays every
 * stale pointer state behind the mouse; a latest-value queue collapses a
 * burst to one visible position per frame.
 *
 * Environment note: play the interaction with the POINTER IS ENGAGED guard
 * first — if the drag never engaged, every later assertion would vacously
 * pass on a static cage.
 */

async function enterEditor(page: Page, path = '/?perf=1') {
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  await page.goto(path, { timeout: 120000, waitUntil: 'domcontentloaded' });
  if (await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null)) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 120000 });
  }
  const newBtn = page.getByRole('button', { name: /^new$/i });
  try {
    await newBtn.waitFor({ state: 'visible', timeout: 30000 });
    await newBtn.click({ force: true, timeout: 10000 });
    const dialog = page.locator('dialog[open]');
    try {
      await dialog.waitFor({ timeout: 15000 });
    } catch {
      await newBtn.click({ force: true, timeout: 10000 });
      await dialog.waitFor({ timeout: 15000 });
    }
    const createBtn = dialog
      .getByTestId('create-design-button')
      .or(dialog.getByRole('button', { name: /^create design$/i }));
    await createBtn.first().click({ timeout: 10000 });
  } catch {
    // Session restore path — already in the editor.
  }
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    const count = await openDialogs.count();
    if (count === 0) break;
    const topmost = openDialogs.last();
    const close = topmost.getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(50);
  }
  await page.keyboard.press('Control+Shift+1'); // Design workspace
  await page.waitForTimeout(300);
}

async function createRect(page: Page) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, 300, 300, 500, 400);
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
}

/** FNV-1a over every 4th pixel of the content canvas (see many-image-render). */
async function surfaceHash(page: Page): Promise<number> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext('2d');
    if (!context) throw new Error('canvas 2d context unavailable');
    const data = context.getImageData(0, 0, surface.width, surface.height).data;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      hash ^= r;
      hash = Math.imul(hash, 16777619);
      hash ^= g;
      hash = Math.imul(hash, 16777619);
      hash ^= b;
      hash = Math.imul(hash, 16777619);
    }
    return hash;
  });
}

const CORNER = '[aria-label^="Envelope top right corner"]';
const CAGE = '[aria-label$="warp cage"]';

async function cornerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(CORNER).boundingBox();
  expect(box, 'envelope corner must exist').toBeTruthy();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

async function activeTool(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-tool][class*="--active"]');
    return (el as HTMLElement | null)?.dataset.tool ?? null;
  });
}

async function capture(page: Page, locator: string, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  const el = page.locator(locator);
  if (await el.count()) {
    await el.screenshot({ path }).catch(() => {});
  }
  if (path) await test.info().attach(name, { path, contentType: 'image/png' }).catch(() => {});
}

test.describe('warp: direct manipulation latency', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await enterEditor(page);
  });

  test('cage and artwork track the latest pointer sample', async ({ page }) => {
    await createRect(page);
    await page.keyboard.press('w');
    expect(await activeTool(page), 'Warp must be the active tool').toBe('warp');
    await expect(page.locator(CAGE)).toBeVisible({ timeout: 30000 });
    const corner = page.locator(CORNER);
    await expect(corner).toBeVisible({ timeout: 30000 });

    const startPos = await cornerCenter(page);
    const endX = startPos.x + 60;
    const endY = startPos.y + 45;
    const beforeHash = await surfaceHash(page);

    // Real-pointer burst: 24 samples, far more than the frames they span.
    await page.mouse.move(startPos.x, startPos.y);
    await page.mouse.down();
    for (let i = 1; i <= 24; i += 1) {
      await page.mouse.move(
        startPos.x + ((endX - startPos.x) * i) / 24,
        startPos.y + ((endY - startPos.y) * i) / 24,
      );
    }
    await capture(page, CAGE, 'warp-drag-burst-final');
    await page.mouse.up();
    await page.waitForTimeout(400);
    const settledReal = await cornerCenter(page);
    // Engagement guard: the cage must have actually moved with the pointer —
    // an inert drag would leave these equal and every later check vacuous.
    expect(
      Math.hypot(settledReal.x - startPos.x, settledReal.y - startPos.y),
      'cage must track the pointer',
    ).toBeGreaterThan(10);
    // Latest sample wins: the resting position is the burst endpoint
    // (screen-space delta is zoom-invariant here; allow sub-pixel rounding).
    expect(Math.abs(settledReal.x - endX)).toBeLessThan(2);
    expect(Math.abs(settledReal.y - endY)).toBeLessThan(2);

    // The artwork tracks the handle: the surface changed from the drag and
    // equals an authoritative full redraw (no stale-pixel freeze).
    const liveHash = await surfaceHash(page);
    expect(liveHash, 'warp drag must change the painted artwork').not.toBe(beforeHash);
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
      ).__varvePerf?.forceFullRedraw?.();
    });
    await page.waitForTimeout(700);
    expect(await surfaceHash(page), 'live surface must equal a full redraw').toBe(liveHash);

    // The burst result equals a slow deliberate drag to the same endpoint:
    // the last sample was applied, not an intermediate one.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    const undoStart = await cornerCenter(page);
    await page.mouse.move(undoStart.x, undoStart.y);
    await page.mouse.down();
    await page.mouse.move(undoStart.x + 60, undoStart.y + 45, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const settledSlow = await cornerCenter(page);
    expect(Math.abs(settledSlow.x - settledReal.x)).toBeLessThan(1.5);
    expect(Math.abs(settledSlow.y - settledReal.y)).toBeLessThan(1.5);

    // Synthetic single-tick burst: 20 pointermoves in ONE evaluate call.
    // The coalescing contract says the cage moves to the final position and
    // at most a couple of intermediate frames appear — never 20 states.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const g = window as unknown as {
        __synth?: { samples: { t: number; x: number; y: number }[]; done: boolean };
      };
      g.__synth = { samples: [], done: false };
      const handle = document.querySelector('[aria-label^="Envelope top right corner"]');
      const tick = () => {
        const rect = (handle as SVGGraphicsElement).getBoundingClientRect();
        g.__synth!.samples.push({
          t: performance.now(),
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        });
        if (g.__synth!.samples.length >= 40) {
          g.__synth!.done = true;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const synthStart = await cornerCenter(page);
    const synthEnd = { x: synthStart.x + 50, y: synthStart.y + 40 };
    await page.mouse.move(synthStart.x, synthStart.y);
    await page.mouse.down();
    const burstStartedAt = await page.evaluate(() => performance.now());
    await page.evaluate(
      ({ sx, sy, ex, ey }) => {
        const handle = document.querySelector('[aria-label^="Envelope top right corner"]');
        for (let i = 1; i <= 20; i += 1) {
          handle!.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              clientX: sx + ((ex - sx) * i) / 20,
              clientY: sy + ((ey - sy) * i) / 20,
              pointerId: 1,
              pointerType: 'mouse',
            }),
          );
        }
      },
      { sx: synthStart.x, sy: synthStart.y, ex: synthEnd.x, ey: synthEnd.y },
    );
    await page.waitForFunction(() => {
      const g = window as unknown as { __synth?: { done: boolean } };
      return g.__synth?.done === true;
    });
    const synthSamples = await page.evaluate(() => {
      const g = window as unknown as { __synth?: { samples: { t: number; x: number; y: number }[] } };
      return g.__synth!.samples;
    });
    const burstSamples = synthSamples.filter((s) => s.t >= burstStartedAt - 1);
    expect(burstSamples.length).toBeGreaterThan(0);
    const distinct = new Set(
      burstSamples.map((s) => `${Math.round(s.x * 2)},${Math.round(s.y * 2)}`),
    );
    expect(distinct.size, '20 samples must not replay as 20 visible states').toBeLessThanOrEqual(3);
    expect(distinct.size, 'the burst must move the cage at least once').toBeGreaterThanOrEqual(2);
    const last = burstSamples[burstSamples.length - 1]!;
    expect(Math.abs(last.x - synthEnd.x)).toBeLessThan(1.5);
    expect(Math.abs(last.y - synthEnd.y)).toBeLessThan(1.5);

    // One burst = one undo entry: undoing restores the exact start position.
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    const afterUndo = await cornerCenter(page);
    expect(Math.abs(afterUndo.x - synthStart.x)).toBeLessThan(1.5);
    expect(Math.abs(afterUndo.y - synthStart.y)).toBeLessThan(1.5);

    // Tool switch: the cage disappears immediately.
    await capture(page, CAGE, 'warp-before-tool-switch');
    await page.keyboard.press('v');
    await expect(page.locator(CAGE)).toHaveCount(0, { timeout: 5000 });
  });

  test('a fast burst followed by a stop does not keep deforming after settling', async ({
    page,
  }) => {
    await createRect(page);
    await page.keyboard.press('w');
    expect(await activeTool(page)).toBe('warp');
    await expect(page.locator(CAGE)).toBeVisible({ timeout: 30000 });
    const box = await page.locator(CORNER).boundingBox();
    expect(box).toBeTruthy();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 30; i += 1) {
      await page.mouse.move(startX + i * 2, startY + i * 1.5);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const first = await surfaceHash(page);
    await page.waitForTimeout(1200);
    const second = await surfaceHash(page);
    // After settling, nothing may keep mutating the document: the surface
    // must be byte-stable across a second window.
    expect(second).toBe(first);
  });
});
