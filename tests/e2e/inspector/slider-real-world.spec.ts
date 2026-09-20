/**
 * Slider system — real-world photo workflow.
 *
 * Uses a real photograph (`real-life-still-life.jpg`), not a synthetic
 * one-rect document, and drives the canonicalized sliders through the actual
 * adjustment workflow: add an adjustment layer, add Brightness, then drag,
 * keyboard-step, and touch the range. Asserts the contract users depend on:
 * the value tracks the pointer, the canvas repaints, the drag is one undo
 * step, and the paired numeric field stays synchronized.
 *
 * Evidence (screenshots + probe JSON) is written under
 * reports/slider-canonicalization/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor, switchWorkspace } from '../shared';

const REPORT_DIR = path.resolve('reports/slider-canonicalization');
const PHOTO = path.resolve('tests/e2e/fixtures/real-life-still-life.jpg');

function ensureReportDir() {
  mkdirSync(REPORT_DIR, { recursive: true });
}

function record(name: string, data: unknown) {
  ensureReportDir();
  writeFileSync(path.join(REPORT_DIR, name), JSON.stringify(data, null, 2));
}

/**
 * Cheap perceptual digest of the editor canvas: downscale to 64×64 and FNV
 * hash the RGBA bytes. Enough to prove a repaint happened without depending
 * on exact pixels (which the render worker may produce at different LODs).
 */
async function canvasDigest(page: Page): Promise<number> {
  return page.evaluate(() => {
    const source = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    if (!source) return 0;
    const off = document.createElement('canvas');
    off.width = 64;
    off.height = 64;
    const ctx = off.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(source, 0, 0, 64, 64);
    const { data } = ctx.getImageData(0, 0, 64, 64);
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4) {
      hash ^= data[i] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= data[i + 1] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= data[i + 2] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  });
}

async function importRealPhoto(page: Page) {
  await page.locator('#file-import-input').setInputFiles(PHOTO);
  await expect
    .poll(
      async () =>
        Number.parseInt((await page.locator('.layers-panel__count').textContent()) ?? '0', 10),
      { timeout: 60_000 },
    )
    .toBeGreaterThanOrEqual(1);
  // Decode + first paint of a real photograph takes longer than a synthetic
  // rect; wait for the digest to stabilize rather than a fixed delay.
  await expect.poll(async () => canvasDigest(page), { timeout: 30_000 }).not.toBe(0);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach((d) => {
      (d as HTMLDialogElement).close();
    });
  });
}

/** Create an adjustment layer from the selected photo (Design tab entry point). */
async function addAdjustmentLayer(page: Page) {
  const trigger = page
    .locator('.editor-inspector .insp-disclosure__trigger')
    .filter({ hasText: /Adjustment Layer/i })
    .first();
  await trigger.waitFor({ state: 'visible', timeout: 20_000 });
  if ((await trigger.getAttribute('aria-expanded')) === 'false') await trigger.click();
  await page.getByRole('button', { name: /^add adjustment layer/i }).click();
  // The new adjustment node is selected; open its editor in the Adjustments tab.
  await switchWorkspace(page, 'Photo');
  const tab = page.getByRole('tab', { name: 'Adjustments', exact: true });
  await tab.click();
  await page
    .locator('#insp-tabpanel-adjustments .insp-disclosure')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
}

/** Add the Brightness adjustment inside the (now selected) adjustment layer. */
async function addBrightness(page: Page) {
  const add = page.getByRole('button', { name: /^add adjustment$/i });
  await add.waitFor({ state: 'visible', timeout: 20_000 });
  await add.click();
  await page.getByRole('menuitem', { name: /^brightness$/i }).click();
  await page.getByRole('slider', { name: 'Brightness', exact: true }).waitFor({ timeout: 15_000 });
}

async function setupBrightness(page: Page) {
  await navigateToEditor(page);
  await importRealPhoto(page);
  // The Photo workspace shows a first-run hint that can overlap the panel.
  const gotIt = page.getByRole('button', { name: /^got it$/i });
  if (await gotIt.isVisible({ timeout: 1500 }).catch(() => false)) await gotIt.click();
  await addAdjustmentLayer(page);
  await addBrightness(page);
}

/** Drag across the range: pointerdown at 25%, drag to 75%, release. */
async function dragRange(page: Page, slider: ReturnType<Page['getByRole']>) {
  const box = await slider.boundingBox();
  if (!box) throw new Error('slider has no box');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, y, { steps: 10 });
  await page.mouse.up();
}

test.describe('slider real-world photo workflow', () => {
  test.describe.configure({ timeout: 240_000 });

  test('drag repaints the canvas and is exactly one undo step', async ({ page }) => {
    await setupBrightness(page);
    const slider = page.getByRole('slider', { name: 'Brightness', exact: true });
    const before = Number(await slider.inputValue());
    const beforeDigest = await canvasDigest(page);

    await dragRange(page, slider);

    const after = Number(await slider.inputValue());
    expect(after, 'drag must move the value').not.toBe(before);
    await expect.poll(async () => canvasDigest(page), { timeout: 15_000 }).not.toBe(beforeDigest);
    const paintedDigest = await canvasDigest(page);

    // The paired precision field shows the same value as the slider.
    const precision = page.getByRole('spinbutton', { name: 'Brightness value' });
    expect(Number(await precision.inputValue())).toBe(after);

    await page.screenshot({ path: path.join(REPORT_DIR, 'real-world-adjustment.png') });
    record('real-world-adjustment.json', { before, after, beforeDigest, paintedDigest });

    // One undo restores both the value and the pixels. Use the real command
    // surface (Edit > Undo), matching tests/e2e/inspector/number-field-interaction.
    await openMenu(page, 'Edit');
    const undoItem = page.getByRole('menuitem', { name: /^Undo/ });
    await expect(undoItem).toBeEnabled();
    await undoItem.click();
    await expect
      .poll(async () => Number(await slider.inputValue()), { timeout: 10_000 })
      .toBe(before);
    await expect.poll(async () => canvasDigest(page), { timeout: 15_000 }).toBe(beforeDigest);
  });

  test('keyboard steps, Home, End, and formatted aria-valuetext', async ({ page }) => {
    await setupBrightness(page);
    const slider = page.getByRole('slider', { name: 'Brightness', exact: true });
    await slider.focus();

    const before = Number(await slider.inputValue());
    await page.keyboard.press('ArrowRight');
    expect(Number(await slider.inputValue())).toBe(before + 1);

    await page.keyboard.press('End');
    expect(Number(await slider.inputValue())).toBe(100);
    await page.keyboard.press('Home');
    expect(Number(await slider.inputValue())).toBe(-100);
    await page.keyboard.press('PageUp');
    expect(Number(await slider.inputValue())).toBeGreaterThan(-100);

    // The effect-opacity slider stores a percentage and must announce it.
    const opacity = page.getByRole('slider', { name: /effect opacity/i });
    await expect(opacity).toHaveAttribute('aria-valuetext', /%$/);
  });
});

test.describe('slider touch target', () => {
  test.use({ hasTouch: true });

  test('coarse pointers get the enlarged hit band and a single-pointer set', async ({ page }) => {
    await setupBrightness(page);
    const slider = page.getByRole('slider', { name: 'Brightness', exact: true });
    // @media (pointer: coarse) raises the input's hit band; the visual track
    // stays the same. This is the touch-target contract (>= 44px).
    const height = await slider.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);

    // WCAG 2.5.7: a single pointer action (no drag) sets the value.
    const box = await slider.boundingBox();
    if (!box) throw new Error('slider has no box');
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
    await expect
      .poll(async () => Number(await slider.inputValue()), { timeout: 10_000 })
      .toBeGreaterThan(50);
  });
});
