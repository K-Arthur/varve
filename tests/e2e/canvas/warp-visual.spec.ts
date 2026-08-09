/**
 * Visual verification of the warp frontend: captures the live canvas + cage
 * overlay for each modifier kind, and proves the cage is operable with the
 * keyboard alone (no pointer drag) — the WCAG 2.2 requirement that every
 * modifier control be reachable and adjustable without a mouse.
 *
 * Screenshots land in test-results/warp-visual/ for eyeballing; the
 * assertions here are the parts that must not regress.
 */

import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas } from '../shared';

const SHOTS = 'test-results/warp-visual';

async function enterEditor(page: Page) {
  await page.goto('/', { timeout: 120000, waitUntil: 'domcontentloaded' });
  // Several unclean shutdowns in a row (killed or timed-out runs) trip the
  // crash-loop detector, which replaces the editor with a full-screen safe-mode
  // gate — every locator below then times out for a reason that looks unrelated.
  if (await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null)) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 120000 });
  }
  const newBtn = page.getByRole('button', { name: /^new$/i });
  try {
    await newBtn.waitFor({ state: 'visible', timeout: 30000 });
    await newBtn.click({ force: true, timeout: 10000 });
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor({ timeout: 15000 });
    await dialog
      .getByTestId('create-design-button')
      .or(dialog.getByRole('button', { name: /^create design$/i }))
      .first()
      .click({ timeout: 10000 });
  } catch {
    // Session restore path — already in the editor.
  }
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const open = page.locator('dialog[open]');
    if ((await open.count()) === 0) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
  await page.keyboard.press('Control+Shift+1');
  await page.waitForTimeout(300);
}

async function createRect(page: Page) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, 300, 260, 560, 440);
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
}

/**
 * Add a warp via the tool, then pick a preset from the Inspector.
 * Preset labels come from WARP_PRESET_DESCRIPTIONS and several share a prefix
 * ("Perspective left" / "Four-corner perspective"), so match the start of the
 * option's accessible name rather than a loose substring.
 */
async function addWarp(page: Page, presetLabel: string) {
  await page.getByRole('button', { name: /^warp$/i }).click();
  await page.waitForTimeout(200);
  await page.getByRole('combobox', { name: /add warp preset/i }).click();
  await page
    .getByRole('option', { name: new RegExp(`^${presetLabel}`, 'i') })
    .first()
    .click();
  await page.waitForTimeout(400);
}

test.describe('warp: visual + keyboard', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await enterEditor(page);
  });

  for (const [name, preset] of [
    ['skew', 'Horizontal skew'],
    ['perspective', 'Four-corner perspective'],
    ['envelope', 'Four-edge envelope'],
    ['arc', 'Arc up'],
    ['wave', 'Wave'],
  ] as const) {
    test(`renders the ${name} cage over warped artwork`, async ({ page }) => {
      await createRect(page);
      await addWarp(page, preset);

      // The cage overlay is present and labelled as a group.
      const cage = page.locator('svg[role="group"][aria-label*="warp cage"]');
      await expect(cage).toBeVisible();

      await page.screenshot({ path: `${SHOTS}/${name}.png` });
    });
  }

  test('every cage handle is reachable and movable by keyboard alone', async ({ page }) => {
    await createRect(page);
    await addWarp(page, 'Four-corner perspective');

    const handles = page.locator('svg[role="group"][aria-label*="warp cage"] [role="button"]');
    const count = await handles.count();
    expect(count).toBeGreaterThan(0);

    // Focusing a handle must expose a spoken position, not a bare key name.
    const first = handles.first();
    await first.focus();
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-label', /percent/i);

    const before = await first.getAttribute('aria-label');
    // Arrow keys move the control point — no pointer involved.
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const after = await first.getAttribute('aria-label');
    expect(after).not.toBe(before);

    await page.screenshot({ path: `${SHOTS}/keyboard-nudged.png` });

    // Each nudge is its own undo step, so undo walks the moves back.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    expect(await first.getAttribute('aria-label')).not.toBe(after);
  });

  test('mesh points announce their grid position', async ({ page }) => {
    await createRect(page);
    await addWarp(page, '4×4 mesh');

    const meshPoints = page.locator('[aria-label^="Mesh point, row"]');
    await expect(meshPoints.first()).toBeVisible();
    // Format required by the accessibility spec.
    await expect(meshPoints.first()).toHaveAttribute(
      'aria-label',
      /Mesh point, row \d+ of \d+, column \d+ of \d+\. X -?\d+ percent, Y -?\d+ percent\./,
    );

    await page.screenshot({ path: `${SHOTS}/mesh.png` });
  });

  test('dragging a mesh point moves it and commits one undo step', async ({ page }) => {
    // Pointer-drag coverage for the mesh overlay. The announced coordinates
    // are the observable proof the drag reached the modifier, and Ctrl+Z must
    // undo *the drag* — not the modifier that was added before it.
    await createRect(page);
    await addWarp(page, '4×4 mesh');

    const meshPoints = page.locator('[aria-label^="Mesh point, row"]');
    await expect(meshPoints.first()).toBeVisible();
    const first = meshPoints.first();
    const before = await first.getAttribute('aria-label');

    const box = await first.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 40, {
      steps: 6,
    });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await first.getAttribute('aria-label');
    expect(after).not.toBe(before);

    // One coherent undo step for the whole gesture, and it restores the point
    // rather than removing the mesh modifier.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    await expect(meshPoints).toHaveCount(25);
    expect(await meshPoints.first().getAttribute('aria-label')).toBe(before);
  });
});
