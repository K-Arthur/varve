import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas } from '../shared';

/**
 * Warp direct-manipulation oracle: the latest pointer sample must control
 * the next visible frame. A backlog of stale per-sample document updates
 * makes the cage keep moving for hundreds of frames after the pointer
 * stops; this spec bounds that convergence and cross-checks the visible
 * artwork against an authoritative full redraw.
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

type ProbeResult = {
  samples: { t: number; x: number; y: number }[];
  convergedAt: number | null;
};

/**
 * Install a RAF probe on the corner handle and sample its screen position
 * for `frames` frames. `convergedAt` is the first frame index from which
 * the position never moves more than 0.5px for the rest of the capture.
 */
async function startProbe(page: Page, frames: number): Promise<void> {
  await page.evaluate((frameCount) => {
    const g = window as unknown as { __warpProbe?: ProbeResult };
    g.__warpProbe = { samples: [], convergedAt: null };
    const handle = document.querySelector('[aria-label="Envelope Top-right corner"]');
    if (!handle) throw new Error('corner handle not found');
    let last: { x: number; y: number } | null = null;
    let idleFrames = 0;
    let stableFrom: number | null = null;
    const tick = () => {
      const rect = handle.getBoundingClientRect();
      const pos = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const data = g.__warpProbe!;
      data.samples.push({ t: performance.now(), x: pos.x, y: pos.y });
      if (last && Math.abs(pos.x - last.x) < 0.5 && Math.abs(pos.y - last.y) < 0.5) {
        idleFrames += 1;
      } else {
        idleFrames = 0;
        stableFrom = null;
      }
      if (stableFrom === null && idleFrames === 3) {
        stableFrom = data.samples.length - 3;
      }
      data.convergedAt = stableFrom;
      last = pos;
      if (data.samples.length < frameCount) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, frames);
}

async function readProbe(page: Page): Promise<ProbeResult> {
  return page.evaluate(() => {
    const probe = (window as { __warpProbe?: { samples: { t: number; x: number; y: number }[]; convergedAt: number | null } }).__warpProbe;
    if (!probe) throw new Error('probe not installed');
    return probe;
  });
}

async function captureLatencyEvidence(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.locator('[data-testid="canvas-overlay"]').screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

test.describe('warp: direct manipulation latency', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await enterEditor(page);
  });

  test('cage converges to the latest pointer sample without a multi-frame backlog', async ({
    page,
  }) => {
    await createRect(page);
    await page.keyboard.press('w');
    const cage = page.locator('[aria-label$="warp cage"]');
    await expect(cage).toBeVisible({ timeout: 10000 });
    const corner = page.locator('[aria-label="Envelope Top-right corner"]');
    await expect(corner).toBeVisible({ timeout: 10000 });

    const box = await corner.boundingBox();
    expect(box).toBeTruthy();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    const beforeHash = await surfaceHash(page);

    await startProbe(page, 90);
    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // A pointed burst: 24 samples to the endpoint, far more than frames.
    const endX = startX + 60;
    const endY = startY + 45;
    for (let i = 1; i <= 24; i += 1) {
      await page.mouse.move(
        startX + ((endX - startX) * i) / 24,
        startY + ((endY - startY) * i) / 24,
      );
    }
    await captureLatencyEvidence(page, 'warp-drag-burst-final');
    await page.mouse.up();
    await page.waitForTimeout(400);
    await captureLatencyEvidence(page, 'warp-drag-settled');

    const probe = await readProbe(page);
    const settled = probe.samples[probe.samples.length - 1]!;
    const converged = probe.samples[probe.convergedAt ?? -1];
    expect(converged).toBeTruthy();

    // Latest sample wins: after the last move the cage must converge in a
    // bounded number of frames (~100ms at 60Hz; CI headless may take a bit
    // more). A per-sample backlog replays dozens of stale updates AFTER the
    // pointer stopped and pushes this far beyond the bound.
    const framesFromLastMove = probe.samples.length - (probe.convergedAt ?? 0);
    expect(framesFromLastMove).toBeLessThanOrEqual(10);
    expect(Math.abs(converged!.x - settled.x)).toBeLessThan(0.75);
    expect(Math.abs(converged!.y - settled.y)).toBeLessThan(0.75);
    expect(Math.abs(settled.x - endX)).toBeLessThan(2);
    expect(Math.abs(settled.y - endY)).toBeLessThan(2);

    // The artwork must track the handle: the surface changed because of the
    // drag, and it matches an authoritative full redraw at the same camera
    // (no stale-pixel freeze).
    const liveHash = await surfaceHash(page);
    expect(liveHash, 'warp drag must change the painted artwork').not.toBe(beforeHash);
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
      ).__varvePerf?.forceFullRedraw?.();
    });
    await page.waitForTimeout(700);
    expect(await surfaceHash(page), 'live surface must equal a full redraw').toBe(liveHash);

    // The final resting position is identical to a slow deliberate drag to
    // the same endpoint — the burst applied the last sample, not an
    // intermediate one.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    const cornerAfterUndo = await corner.boundingBox();
    expect(cornerAfterUndo).toBeTruthy();
    const ux = cornerAfterUndo!.x + cornerAfterUndo!.width / 2;
    const uy = cornerAfterUndo!.y + cornerAfterUndo!.height / 2;
    await page.mouse.move(ux, uy);
    await page.mouse.down();
    await page.mouse.move(ux + 60, uy + 45, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const slowBox = await corner.boundingBox();
    expect(Math.abs(slowBox!.x + slowBox!.width / 2 - settled.x)).toBeLessThan(1.5);
    expect(Math.abs(slowBox!.y + slowBox!.height / 2 - settled.y)).toBeLessThan(1.5);

    // Tool switch after the drag: cage disappears immediately.
    await captureLatencyEvidence(page, 'warp-before-tool-switch');
    await page.keyboard.press('v');
    await expect(page.locator('[aria-label$="warp cage"]')).toHaveCount(0, { timeout: 5000 });
  });

  test('a fast burst followed by a stop does not keep deforming after settling', async ({
    page,
  }) => {
    await createRect(page);
    await page.keyboard.press('w');
    await expect(page.locator('[aria-label$="warp cage"]')).toBeVisible({ timeout: 10000 });
    const corner = page.locator('[aria-label="Envelope Top-right corner"]');
    const box = await corner.boundingBox();
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
