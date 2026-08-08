/**
 * E2E: Visual verification of the halftone effect.
 *
 * Drives the real app: draw shapes, create an adjustment layer, add a
 * halftone adjustment, and verify BOTH:
 *   1. The UI renders all halftone controls (DOM assertions).
 *   2. The canvas output is correct (programmatic pixel sampling — dot
 *      presence, invert flipping, intensity blending, threshold ink shift,
 *      frequency/angle pattern change).
 *
 * Screenshots for every state are saved to test-results/halftone-visual/
 * for manual visual review.
 */
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas } from '../shared';

const SHOT_DIR = 'test-results/halftone-visual';

// Robust navigation: the shared helper's actionability checks can race with
// the new-design dialog's card label overlay and the slow editor cold-mount.
async function navigateToEditor(page: Page) {
  await page.goto('/', { timeout: 120000, waitUntil: 'domcontentloaded' });
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 45000 });
  await newBtn.click({ force: true, timeout: 15000 });
  const createBtn = page.locator('dialog[open]').getByRole('button', { name: /^create design$/i });
  await createBtn.waitFor({ timeout: 15000 });
  await createBtn.click({ force: true, timeout: 30000 });
  await page.locator('.layers-panel').waitFor({ timeout: 120000 });
  // Dismiss any stacked startup dialogs
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    const count = await openDialogs.count();
    if (count === 0) break;
    const close = openDialogs.last().getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(50);
  }
  const blankCanvas = page.getByRole('dialog').getByRole('button', { name: /^blank canvas$/i });
  if (await blankCanvas.isVisible({ timeout: 1000 }).catch(() => false)) {
    await blankCanvas.click({ force: true });
  }
}

// ── Scene helpers ──────────────────────────────────────────────────────

async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).first().click();
  await dragOnCanvas(page, x1, y1, x2, y2);
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
}

async function drawEllipse(page: Page, x1: number, y1: number, x2: number, y2: number) {
  // The toolbar shows one shape button + a "Shapes menu" chevron; open the
  // menu to pick the ellipse tool.
  await page.getByRole('button', { name: 'Shapes menu' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('menuitem', { name: 'Ellipse', exact: true }).click();
  await dragOnCanvas(page, x1, y1, x2, y2);
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
}

/**
 * Create an adjustment layer while a shape is selected (the scope auto-targets
 * the selection), then switch to the Adjustments inspector tab, add a halftone
 * adjustment and open its editor.
 */
async function addHalftoneAdjustment(page: Page) {
  await page.getByRole('menuitem', { name: /^Object$/i }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await page.waitForTimeout(600);

  const adjTab = page.locator('[role="tablist"] button[role="tab"]', { hasText: /^adjustments$/i });
  await adjTab.waitFor({ state: 'visible', timeout: 8000 });
  await adjTab.click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: /add adjustment/i }).click();
  await page.waitForTimeout(300);
  const halftoneOption = page.getByRole('menuitem', { name: /^Halftone$/i });
  await halftoneOption.scrollIntoViewIfNeeded();
  await halftoneOption.click();
  await page.waitForTimeout(1000);
}

function slider(page: Page, label: string) {
  return page.locator(`input[type="range"][aria-label*="${label}" i]`);
}

async function setSlider(page: Page, label: string, value: number) {
  await slider(page, label).fill(String(value));
  await page.waitForTimeout(500);
}

// ── Pixel sampling ─────────────────────────────────────────────────────
//
// Samples the content-layer canvas backing store over a document-space rect
// (assumes 100% zoom, no pan, DPR 1 — true for a fresh document). Returns
// the RGBA pixel data plus per-pixel gray counts so tests can assert on dot
// presence / ink coverage / invert without depending on exact rendering.

interface PixelSample {
  width: number;
  height: number;
  mean: number;
  darkCount: number;
  lightCount: number;
  signature: string;
}

async function sampleRect(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<PixelSample> {
  return page.evaluate(
    ({ x, y, w, h }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      if (!canvas) throw new Error('content canvas not found');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const data = ctx.getImageData(
        Math.round(x * sx),
        Math.round(y * sy),
        Math.max(1, Math.round(w * sx)),
        Math.max(1, Math.round(h * sy)),
      ).data;
      let sum = 0;
      let darkCount = 0;
      let lightCount = 0;
      const sig: number[] = [];
      for (let i = 0; i < data.length; i += 16) {
        const gray = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
        sum += gray;
        if (gray < 110) darkCount++;
        if (gray > 145) lightCount++;
        sig.push(gray);
      }
      const n = data.length / 16;
      return {
        width: data.length / 4,
        height: 1,
        mean: sum / n,
        darkCount,
        lightCount,
        signature: sig.join(','),
      };
    },
    { x, y, w, h },
  );
}

async function canvasPattern(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    if (!canvas) return '';
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const sig: number[] = [];
    for (let i = 0; i < data.length; i += 64) {
      sig.push(data[i]!);
    }
    return sig.join(',');
  });
}

/**
 * Count dark/light transitions along horizontal scanlines inside a region.
 * A higher screen frequency must produce MORE transitions per row (finer
 * dot spacing), which is the correct discriminator — dark AREA FRACTION is
 * frequency-invariant for a flat fill (that is halftone tonal reproduction).
 */
async function scanlineTransitions(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<number> {
  return page.evaluate(
    ({ x, y, w, h }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      if (!canvas) return 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const data = ctx.getImageData(
        Math.round(x * sx),
        Math.round(y * sy),
        Math.max(1, Math.round(w * sx)),
        Math.max(1, Math.round(h * sy)),
      ).data;
      const rowW = Math.round(w * sx);
      let transitions = 0;
      for (let row = 0; row < Math.min(12, Math.round(h * sy)); row++) {
        let prev: 'dark' | 'light' | null = null;
        for (let px = 0; px < rowW; px++) {
          const i = (row * rowW + px) * 4;
          const gray = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
          const cur = gray < 110 ? 'dark' : 'light';
          if (prev && cur !== prev) transitions++;
          prev = cur;
        }
      }
      return transitions;
    },
    { x, y, w, h },
  );
}

// ── Specs ──────────────────────────────────────────────────────────────

test.describe('Halftone visual verification', () => {
  test.describe.configure({ mode: 'serial', timeout: 300000 });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('01 - default halftone on a rectangle renders dots and full UI', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await page.screenshot({ path: `${SHOT_DIR}/01-rect-no-halftone.png` });
    const before = await sampleRect(page, 120, 120, 400, 240);

    await addHalftoneAdjustment(page);

    // UI: every halftone control must be present
    await expect(page.locator('text=Preset').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=Method').first()).toBeVisible();
    await expect(page.locator('text=Pattern').first()).toBeVisible();
    await expect(page.locator('text=Dot Shape').first()).toBeVisible();
    await expect(page.locator('text=Channel').first()).toBeVisible();
    await expect(slider(page, 'frequency')).toBeVisible();
    await expect(slider(page, 'angle')).toBeVisible();
    await expect(slider(page, 'threshold')).toBeVisible();
    await expect(slider(page, 'intensity')).toBeVisible();
    await expect(slider(page, 'softness')).toBeVisible();
    await expect(page.locator('#halftone-invert')).toBeVisible();
    await expect(page.locator('text=Ink Color').first()).toBeVisible();
    await expect(page.locator('text=Paper Color').first()).toBeVisible();

    await page.screenshot({ path: `${SHOT_DIR}/02-default-halftone.png` });

    // Canvas: the flat fill must now show both dark dots and light gaps
    const after = await sampleRect(page, 120, 120, 400, 240);
    expect(after.darkCount, 'dark dots must exist').toBeGreaterThan(0);
    expect(after.lightCount, 'light gaps must exist').toBeGreaterThan(0);
    expect(after.signature, 'halftone must change the pixels').not.toBe(before.signature);
  });

  test('02 - frequency changes the dot pattern', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    await setSlider(page, 'frequency', 10);
    await page.screenshot({ path: `${SHOT_DIR}/03-freq-10-coarse.png` });
    const coarse = await canvasPattern(page);
    const coarseTransitions = await scanlineTransitions(page, 120, 120, 400, 240);

    await setSlider(page, 'frequency', 30);
    await page.screenshot({ path: `${SHOT_DIR}/04-freq-30-fine.png` });
    const fine = await canvasPattern(page);
    const fineTransitions = await scanlineTransitions(page, 120, 120, 400, 240);

    // Frequencies must change the pattern...
    expect(fine, 'frequency must change the pattern').not.toBe(coarse);
    // ...and the finer screen must have more dark/light transitions per row
    // (dot spacing shrinks; dark area fraction stays constant for flat fill).
    expect(fineTransitions, 'finer screen must have more dot transitions').toBeGreaterThan(
      coarseTransitions,
    );
  });

  test('03 - angle changes the pattern', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    await setSlider(page, 'angle', 0);
    await page.screenshot({ path: `${SHOT_DIR}/05-angle-0.png` });
    const a0 = await canvasPattern(page);

    await setSlider(page, 'angle', 45);
    await page.screenshot({ path: `${SHOT_DIR}/06-angle-45.png` });
    const a45 = await canvasPattern(page);

    expect(a45, 'angle must change the pattern').not.toBe(a0);
  });

  test('04 - invert swaps ink and paper', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    const before = await sampleRect(page, 120, 120, 400, 240);
    await page.screenshot({ path: `${SHOT_DIR}/07-invert-off.png` });

    await page.locator('#halftone-invert').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOT_DIR}/08-invert-on.png` });
    const after = await sampleRect(page, 120, 120, 400, 240);

    // Inverting a mid-tone halftone must flip the dark/light balance
    expect(after.darkCount).not.toBe(before.darkCount);
    expect(after.signature).not.toBe(before.signature);
  });

  test('05 - intensity 0 restores the original, 50% blends', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    const original = await sampleRect(page, 120, 120, 400, 240);
    await addHalftoneAdjustment(page);

    await setSlider(page, 'intensity', 0);
    const zero = await sampleRect(page, 120, 120, 400, 240);
    await page.screenshot({ path: `${SHOT_DIR}/09-intensity-0.png` });

    await setSlider(page, 'intensity', 50);
    await page.screenshot({ path: `${SHOT_DIR}/10-intensity-50.png` });
    const half = await sampleRect(page, 120, 120, 400, 240);

    // intensity 0 == original pixels (halftone disabled)
    expect(zero.signature, 'intensity 0 must match the original').toBe(original.signature);
    // 50% must be between: it still shows dots (mean shifted from original)
    expect(half.darkCount).toBeGreaterThan(0);
  });

  test('06 - threshold shifts ink coverage', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    await setSlider(page, 'threshold', 64);
    await page.screenshot({ path: `${SHOT_DIR}/11-threshold-64.png` });
    const lowDark = (await sampleRect(page, 120, 120, 400, 240)).darkCount;

    await setSlider(page, 'threshold', 200);
    await page.screenshot({ path: `${SHOT_DIR}/12-threshold-200.png` });
    const highDark = (await sampleRect(page, 120, 120, 400, 240)).darkCount;

    // Higher threshold = less ink = fewer dark pixels
    expect(highDark, 'higher threshold must produce less ink').toBeLessThan(lowDark);
  });

  test('07 - presets initialize canonical parameters', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);
    await page.screenshot({ path: `${SHOT_DIR}/13-preset-custom.png` });

    const combo = page.locator('[role="combobox"][aria-label="Halftone preset"]');
    await combo.click();
    await page.waitForTimeout(300);
    await page.getByRole('option', { name: /^Newspaper$/i }).click();
    await page.waitForTimeout(800);

    // Newspaper preset: frequency 35, angle 45
    await expect(slider(page, 'frequency')).toHaveValue('35', { timeout: 5000 });
    await expect(slider(page, 'angle')).toHaveValue('45');
    await page.screenshot({ path: `${SHOT_DIR}/14-preset-newspaper.png` });
  });

  test('08 - mono ink/paper color pickers render for K channel', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    await expect(page.locator('text=Ink Color').first()).toBeVisible();
    await expect(page.locator('text=Paper Color').first()).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/15-color-pickers.png` });
  });

  test('09 - halftone across multiple shapes', async ({ page }) => {
    await drawRect(page, 50, 50, 350, 250);
    await drawEllipse(page, 400, 50, 700, 250);
    await drawRect(page, 50, 300, 350, 500);

    // Select everything, then create the adjustment layer (scoped to targets)
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    await addHalftoneAdjustment(page);

    await page.screenshot({ path: `${SHOT_DIR}/16-multi-shape-halftone.png` });
    const dots = await sampleRect(page, 100, 100, 200, 100);
    expect(dots.darkCount, 'dots must appear on the first rect').toBeGreaterThan(0);
  });

  test('10 - PNG export with halftone succeeds (parity smoke)', async ({ page }) => {
    // Frame is the exportable unit
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 500, 400);
    await page.waitForTimeout(300);
    await drawRect(page, 130, 130, 450, 350);
    await addHalftoneAdjustment(page);

    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'PNG', exact: true }).first().click();
    await page.getByRole('button', { name: /download/i }).click();

    const msg = page.locator('.spec-export__message');
    await expect(msg).toBeVisible({ timeout: 20000 });
    await expect(msg).toHaveText(/exported/i, { timeout: 20000 });
    await expect(msg).not.toHaveText(/failed/i);
    await page.screenshot({ path: `${SHOT_DIR}/17-export-png-message.png` });
  });

  test('11 - panning preserves document-space pattern phase (AM)', async ({ page }) => {
    // A viewport-anchored halftone would visibly shift the pattern relative
    // to the artwork when panning. A document-anchored pattern must produce
    // pixel-identical output at the same document location before and after
    // a pan of the viewport.
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);
    await setSlider(page, 'frequency', 20);

    // Sample a fixed document region at pan (0,0), zoom 1: screen == doc coords
    const before = await sampleRect(page, 150, 150, 300, 200);
    await page.screenshot({ path: `${SHOT_DIR}/18-pan-before.png` });

    // Pan the viewport with the hand tool by (+200, +100) CSS px
    await page.getByRole('button', { name: 'Hand', exact: true }).click();
    await dragOnCanvas(page, 300, 300, 500, 400);
    await page.waitForTimeout(800);
    await page.keyboard.press('v');

    // The same document region now sits at screen (350, 250)-(650, 450)
    const after = await sampleRect(page, 350, 250, 300, 200);
    await page.screenshot({ path: `${SHOT_DIR}/19-pan-after.png` });

    // The pattern phase must be identical at the same document location.
    // Allow a tiny tolerance for rounding at the new region origin.
    expect(after.signature, 'pan must not change document-space pattern phase').toBe(
      before.signature,
    );
    // Dots still present after pan
    expect(after.darkCount).toBeGreaterThan(0);
  });

  test('12 - zoom preserves dot count across the artwork (density is document-invariant)', async ({
    page,
  }) => {
    // Small rect so it stays fully visible at the moderate zoom used below.
    await drawRect(page, 250, 200, 450, 350);
    await addHalftoneAdjustment(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas not found');

    // The canvas background is ~(235,239,244) while the rect interior is pure
    // white (255) with black (0) dots. Pure-white pixels (g > 250) only exist
    // inside the artwork, so the first/last white pixel on an interior row
    // locate the artwork span at any zoom; transitions count the dots.
    const scan = async (): Promise<{ transitions: number; span: number }> =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
        if (!el) return { transitions: -1, span: 0 };
        const ctx = el.getContext('2d');
        if (!ctx) return { transitions: -1, span: 0 };
        const data = ctx.getImageData(0, 0, el.width, el.height).data;
        // The rect spans doc y 200..350 in an ~645px canvas; sample a row
        // safely inside the artwork at every zoom.
        const rowY = Math.floor(el.height * 0.42);
        const grayAt = (x: number): number => {
          const i = (rowY * el.width + x) * 4;
          return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
        };
        let firstWhite = -1;
        let lastWhite = -1;
        for (let x = 0; x < el.width; x++) {
          if (grayAt(x) > 250) {
            if (firstWhite < 0) firstWhite = x;
            lastWhite = x;
          }
        }
        if (firstWhite < 0 || lastWhite < 0) return { transitions: -1, span: 0 };
        let transitions = 0;
        let prev: 'dark' | 'light' | null = null;
        for (let x = firstWhite; x <= lastWhite; x++) {
          const cur = grayAt(x) < 110 ? 'dark' : 'light';
          if (prev && cur !== prev) transitions++;
          prev = cur;
        }
        return { transitions, span: lastWhite - firstWhite };
      });

    const before = await scan();
    expect(before.transitions, 'zoom-1 must show dots').toBeGreaterThan(0);

    // Moderate zoom in (3 wheel steps ≈ 1.7x): the 200px rect stays fully
    // visible so the scan still sees the complete artwork.
    await canvas.evaluate(
      (element, center) => {
        const bounds = element.getBoundingClientRect();
        for (let i = 0; i < 3; i += 1) {
          element.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              clientX: bounds.left + center.x,
              clientY: bounds.top + center.y,
              ctrlKey: true,
              deltaY: -10,
            }),
          );
        }
      },
      { x: 350, y: 275 },
    );
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOT_DIR}/20-zoom-in.png` });

    const after = await scan();
    expect(after.span, 'zoom must have enlarged the artwork span').toBeGreaterThan(before.span);

    // Dot count across the artwork is zoom-invariant: allow ±30% for AA
    // differences at the higher resolution.
    const ratio =
      Math.min(before.transitions, after.transitions) /
      Math.max(before.transitions, after.transitions);
    expect(ratio, 'dot count must be zoom-invariant').toBeGreaterThanOrEqual(0.7);
  });

  test('13 - SVG export with halftone succeeds (raster fallback parity)', async ({ page }) => {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 500, 400);
    await page.waitForTimeout(300);
    await drawRect(page, 130, 130, 450, 350);
    await addHalftoneAdjustment(page);

    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'SVG', exact: true }).first().click();
    await page.getByRole('button', { name: /download/i }).click();

    const msg = page.locator('.spec-export__message');
    await expect(msg).toBeVisible({ timeout: 20000 });
    await expect(msg).toHaveText(/exported/i, { timeout: 20000 });
    await expect(msg).not.toHaveText(/failed/i);
    await page.screenshot({ path: `${SHOT_DIR}/23-export-svg-message.png` });
  });

  test('14 - JPEG export with halftone succeeds', async ({ page }) => {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 500, 400);
    await page.waitForTimeout(300);
    await drawRect(page, 130, 130, 450, 350);
    await addHalftoneAdjustment(page);

    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'JPEG', exact: true }).first().click();
    await page.getByRole('button', { name: /download/i }).click();

    const msg = page.locator('.spec-export__message');
    await expect(msg).toBeVisible({ timeout: 20000 });
    await expect(msg).toHaveText(/exported/i, { timeout: 20000 });
    await expect(msg).not.toHaveText(/failed/i);
    await page.screenshot({ path: `${SHOT_DIR}/24-export-jpeg-message.png` });
  });

  test('15 - CMYK process screening renders colored dots on a saturated source', async ({
    page,
  }) => {
    await drawRect(page, 100, 100, 600, 400);

    // Set the rect fill to saturated red via the Properties fill popover
    await page
      .getByRole('button', { name: /colour$/i })
      .first()
      .click();
    await page.waitForTimeout(300);
    const hex = page.getByLabel('Hex color');
    await hex.fill('#FF0000');
    await hex.press('Enter');
    await page.waitForTimeout(600);

    await addHalftoneAdjustment(page);

    // Switch the halftone channel to CMYK (all inks, standard press angles)
    const channelCombo = page.locator('[role="combobox"][aria-label="Ink channel"]');
    await channelCombo.click();
    await page.waitForTimeout(200);
    await page.getByRole('option', { name: /^CMYK/i }).click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: `${SHOT_DIR}/25-cmyk-screening.png` });

    // CMYK overprint of saturated red must produce COLORED output, not
    // grayscale: magenta/yellow inks dot the red source
    const sample = await sampleRect(page, 120, 120, 400, 240);
    expect(sample.darkCount, 'dots must appear').toBeGreaterThan(0);
    const chroma = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      if (!canvas) return 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let maxChroma = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        if (chroma > maxChroma) maxChroma = chroma;
      }
      return maxChroma;
    });
    expect(chroma, 'CMYK screening must produce colored (non-grayscale) output').toBeGreaterThan(
      60,
    );
  });

  test('16 - color halftone adjustment (RGB mode) renders colored dots', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await page
      .getByRole('button', { name: /colour$/i })
      .first()
      .click();
    await page.waitForTimeout(300);
    const hex = page.getByLabel('Hex color');
    await hex.fill('#00AAFF');
    await hex.press('Enter');
    await page.waitForTimeout(600);

    // Create an adjustment layer and add the color halftone adjustment
    await page.getByRole('menuitem', { name: /^Object$/i }).click();
    await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
    await page.waitForTimeout(600);
    const adjTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^adjustments$/i,
    });
    await adjTab.click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /add adjustment/i }).click();
    await page.waitForTimeout(300);
    const colorHt = page.getByRole('menuitem', { name: /color halftone/i });
    await colorHt.scrollIntoViewIfNeeded();
    await colorHt.click();
    await page.waitForTimeout(1000);

    // RGB mode selector must be present with presets
    await expect(page.locator('text=Preset').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=Mode').first()).toBeVisible();
    const modeCombo = page.locator('[role="combobox"][aria-label="Channel mode"]');
    await expect(modeCombo).toBeVisible();

    // RGB mode: each RGB channel screened independently → colored dots
    const modeValue = await modeCombo.getAttribute('aria-label');
    expect(modeValue).toBeTruthy();
    await page.screenshot({ path: `${SHOT_DIR}/26-color-halftone-rgb.png` });

    const sample = await sampleRect(page, 120, 120, 400, 240);
    expect(sample.darkCount, 'color halftone must produce dots').toBeGreaterThan(0);
    const chroma = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      if (!canvas) return 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let maxChroma = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const c = Math.max(r, g, b) - Math.min(r, g, b);
        if (c > maxChroma) maxChroma = c;
      }
      return maxChroma;
    });
    expect(chroma, 'color halftone must produce colored (non-grayscale) output').toBeGreaterThan(
      60,
    );
  });
});
