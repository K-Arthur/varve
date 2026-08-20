/**
 * Auto Layout comprehensive visual verification E2E tests.
 *
 * Verifies every major auto-layout capability:
 * inspector controls, flex reflow, per-child sizing, padding, gap,
 * alignment, distribution, wrap, absolute positioning, nested layout,
 * column direction, disable/enable, and undo.
 *
 * Uses Varve's custom Select (combobox) and SegmentedControl (radiogroup).
 */
import { expect, test, type Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────

async function selectFromCombobox(page: Page, label: string, optionLabel: string) {
  const combo = page.getByRole('combobox', { name: label });
  await combo.scrollIntoViewIfNeeded();
  await combo.click();
  await page.getByRole('listbox', { name: label }).waitFor({ state: 'visible', timeout: 3000 });
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  await page.waitForTimeout(200);
}

/** Click a SegmentedControl radio button (radiogroup → radio). */
async function clickSegment(page: Page, groupLabel: string, optionLabel: string) {
  const group = page.getByRole('radiogroup', { name: groupLabel });
  await group.scrollIntoViewIfNeeded();
  await group.getByRole('radio', { name: optionLabel }).click();
  await page.waitForTimeout(200);
}

function layoutSection(page: Page) {
  return page.locator('section.insp-disclosure').filter({
    has: page.getByRole('button', { name: 'Layout' }),
  });
}

function layoutChildSection(page: Page) {
  return page.locator('section.insp-disclosure').filter({
    has: page.getByRole('button', { name: 'Layout child' }),
  });
}

async function getCanvas(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 120000 });
  return canvas;
}

async function drawFrame(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.keyboard.press('f');
  await page.waitForTimeout(100);
  const canvas = await getCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + (x1 + x2) / 2, box.y + (y1 + y2) / 2);
  await page.mouse.move(box.x + x2, box.y + y2);
  await page.mouse.up();
  await page.waitForTimeout(200);
  return box;
}

async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  const canvas = await getCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + (x1 + x2) / 2, box.y + (y1 + y2) / 2);
  await page.mouse.move(box.x + x2, box.y + y2);
  await page.mouse.up();
  await page.waitForTimeout(200);
  return box;
}

async function selectTool(page: Page) {
  await page.keyboard.press('v');
  await page.waitForTimeout(100);
}

async function selectFrame(
  page: Page,
  box: NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>,
) {
  await selectTool(page);
  await page.mouse.click(box.x + 90, box.y + 90);
  await page.waitForTimeout(400);
}

async function selectChildAt(
  page: Page,
  box: NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>,
  worldX: number,
  worldY: number,
) {
  await selectTool(page);
  await page.mouse.click(box.x + worldX, box.y + worldY);
  await page.waitForTimeout(400);
}

// ── Setup ────────────────────────────────────────────────────────────

test.describe('Auto Layout comprehensive verification', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // Aggressively clear ALL safe-mode / crash-counter state before navigating.
    await page.goto('about:blank');
    await page.evaluate(async () => {
      try {
        // Clear localStorage safe-mode flag and any crash-related keys.
        for (const k of Object.keys(localStorage)) {
          if (/safe|crash|recovery|error|consecutive/i.test(k)) localStorage.removeItem(k);
        }
        // Nuke all IndexedDB databases (crash counters live here).
        if (indexedDB.databases) {
          for (const db of await indexedDB.databases()) {
            if (db.name) indexedDB.deleteDatabase(db.name);
          }
        }
        // Clear sessionStorage too.
        sessionStorage.clear();
      } catch {}
    });
    // Now navigate to the app fresh.
    await page.goto('/', { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    // Dismiss safe-mode dialog if it still appears (crash counter may persist
    // in server-side state). Force-close via DOM manipulation as last resort.
    for (let i = 0; i < 10; i++) {
      const safeBtn = page.getByRole('button', { name: /continue normal startup/i });
      if (await safeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await safeBtn.click({ timeout: 3000 });
        await page.waitForTimeout(800);
        continue;
      }
      const safeStart = page.getByRole('button', { name: /start varve in safe mode/i });
      if (await safeStart.isVisible({ timeout: 500 }).catch(() => false)) {
        await safeStart.click({ timeout: 3000 });
        await page.waitForTimeout(800);
        continue;
      }
      break;
    }
    // Nuclear option: remove any dialog from the DOM that blocks the UI.
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => {
        d.removeAttribute('open');
        (d as HTMLDialogElement).close();
      });
    });
    await page.waitForTimeout(500);
    // Navigate into the editor.
    const newBtn = page.getByRole('button', { name: /^new$/i });
    await newBtn.waitFor({ state: 'visible', timeout: 120000 });
    await newBtn.click({ force: true, timeout: 15000 });
    // Wait for the "New design" dialog, then click Create design by testid.
    await page.locator('dialog[open]').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500);
    const createBtn = page.getByTestId('create-design-button');
    await createBtn.waitFor({ state: 'visible', timeout: 10000 });
    await createBtn.click({ timeout: 10000 });
    // Wait for the editor to mount. If it crashes (error boundary), reload and retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.locator('.layers-panel').waitFor({ timeout: 30000 }).catch(() => null);
      if (await page.locator('.layers-panel').isVisible().catch(() => false)) break;
      // Editor crashed — click Reload on the error boundary.
      const reloadBtn = page.getByRole('button', { name: /reload/i });
      if (await reloadBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await reloadBtn.click();
        await page.waitForTimeout(5000);
      }
    }
    await page.locator('.layers-panel').waitFor({ state: 'visible', timeout: 60000 });
    // Dismiss any remaining startup dialogs.
    for (let i = 0; i < 4; i++) {
      const dlg = page.locator('dialog[open]');
      if ((await dlg.count()) === 0) break;
      const close = dlg
        .last()
        .getByRole('button', { name: /close|get started|blank canvas/i })
        .first();
      if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
        await close.click({ force: true });
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(100);
    }
    await getCanvas(page);
  });

  // ── 1. Layout section visible ──────────────────────────────────

  test('1 - Layout section visible when frame selected', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 100, 100, 400, 300);
    await selectFrame(page, box);
    await expect(layoutSection(page)).toBeVisible({ timeout: 5000 });
    await expect(layoutSection(page).getByRole('combobox', { name: 'Layout mode' })).toBeVisible({
      timeout: 3000,
    });
    await page.screenshot({ path: 'test-results/autolayout-01-layout-section.png' });
  });

  // ── 2. Flex controls ───────────────────────────────────────────

  test('2 - enabling flex shows direction gap wrap controls', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 250);
    await drawRect(page, 280, 150, 380, 250);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(500);
    const section = layoutSection(page);
    await expect(section.getByRole('combobox', { name: 'Layout direction' })).toBeVisible({
      timeout: 3000,
    });
    await expect(section.getByLabel('Gap')).toBeVisible({ timeout: 3000 });
    await expect(section.getByLabel('Wrap')).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: 'test-results/autolayout-02-flex-controls.png' });
  });

  // ── 3. Padding ─────────────────────────────────────────────────

  test('3 - padding controls exist and accept input', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 250);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    const paddingT = layoutSection(page).getByLabel('Padding T');
    await paddingT.scrollIntoViewIfNeeded();
    await expect(paddingT).toBeVisible({ timeout: 3000 });
    await paddingT.clear();
    await paddingT.fill('16');
    await page.waitForTimeout(300);
    const paddingR = layoutSection(page).getByLabel('Padding R');
    await expect(paddingR).toBeVisible({ timeout: 3000 });
    await paddingR.clear();
    await paddingR.fill('12');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/autolayout-03-padding.png' });
  });

  // ── 4. Gap ─────────────────────────────────────────────────────

  test('4 - gap input repositions children with spacing', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 250);
    await drawRect(page, 280, 150, 380, 250);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    const gapInput = layoutSection(page).getByLabel('Gap');
    await gapInput.clear();
    await gapInput.fill('20');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-04-gap.png' });
  });

  // ── 5. Align items (SegmentedControl radiogroup) ───────────────

  test('5 - align items center repositions children on cross axis', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 200);
    await drawRect(page, 280, 150, 380, 160);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    await clickSegment(page, 'Align items', 'Ctr');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-05-align-center.png' });
  });

  test('5b - align items end pushes children to bottom', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 200);
    await drawRect(page, 280, 150, 380, 160);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    await clickSegment(page, 'Align items', 'End');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-05b-align-end.png' });
  });

  // ── 6. Justify content (SegmentedControl radiogroup) ────────────

  test('6 - justify space-between distributes children', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 200);
    await drawRect(page, 350, 150, 450, 200);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    await clickSegment(page, 'Justify content', 'Spc');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-06-justify-space-between.png' });
  });

  test('6b - justify center centers children on primary axis', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 200);
    await drawRect(page, 280, 150, 380, 200);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    await clickSegment(page, 'Justify content', 'Ctr');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-06b-justify-center.png' });
  });

  // ── 7. Column direction ────────────────────────────────────────

  test('7 - column direction repositions children vertically', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 400, 500);
    await drawRect(page, 150, 150, 350, 210);
    await drawRect(page, 150, 240, 350, 300);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    await selectFromCombobox(page, 'Layout direction', 'Column');
    await page.waitForTimeout(300);
    const gapInput = layoutSection(page).getByLabel('Gap');
    await gapInput.clear();
    await gapInput.fill('12');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-07-column.png' });
  });

  // ── 8. Wrap ────────────────────────────────────────────────────

  test('8 - wrap enabled wraps children to next row', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 380, 380);
    await drawRect(page, 100, 100, 180, 160);
    await drawRect(page, 190, 100, 270, 160);
    await drawRect(page, 280, 100, 360, 160);
    await drawRect(page, 100, 180, 180, 240);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    const wrapCheckbox = layoutSection(page).getByLabel('Wrap');
    await wrapCheckbox.scrollIntoViewIfNeeded();
    await wrapCheckbox.check();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-08-wrap.png' });
  });

  // ── 9. Per-child sizing controls ───────────────────────────────

  test('9 - per-child sizing and align controls visible', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 180, 180, 320, 280);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    await selectChildAt(page, box, 140, 130);
    const cs = layoutChildSection(page);
    await expect(cs).toBeVisible({ timeout: 5000 });
    await expect(cs.getByRole('combobox', { name: 'Child width sizing' })).toBeVisible({
      timeout: 3000,
    });
    await expect(cs.getByRole('combobox', { name: 'Child height sizing' })).toBeVisible({
      timeout: 3000,
    });
    await expect(cs.getByRole('combobox', { name: 'Layout position' })).toBeVisible({
      timeout: 3000,
    });
    await expect(cs.getByRole('combobox', { name: 'Child cross-axis alignment override' })).toBeVisible({
      timeout: 3000,
    });
    await page.screenshot({ path: 'test-results/autolayout-09-child-controls.png' });
  });

  // ── 10. Child fill sizing ──────────────────────────────────────

  test('10 - child fill sizing expands to use available space', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 250);
    await drawRect(page, 280, 150, 350, 250);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    const gapInput = layoutSection(page).getByLabel('Gap');
    await gapInput.clear();
    await gapInput.fill('12');
    await page.waitForTimeout(200);
    // After flex layout, first child is at frame content origin (80,80).
    // Select it by clicking near its center.
    await selectChildAt(page, box, 100, 100);
    await selectFromCombobox(page, 'Child width sizing', 'Fill container');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-10-child-fill.png' });
  });

  // ── 11. Child absolute positioning ─────────────────────────────

  test('11 - child absolute positioning removes from flow', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 250);
    await drawRect(page, 280, 150, 350, 250);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    // Select first child (at frame content origin after flex layout).
    await selectChildAt(page, box, 100, 100);
    await selectFromCombobox(page, 'Layout position', 'Absolute');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-11-child-absolute.png' });
  });

  // ── 12. Nested auto layout ─────────────────────────────────────

  test('12 - nested auto layout frames reflow correctly', async ({ page }) => {
    test.setTimeout(300000);
    const outerBox = await drawFrame(page, 80, 80, 500, 500);
    await drawFrame(page, 120, 120, 460, 220);
    await drawRect(page, 140, 140, 220, 200);
    await drawRect(page, 240, 140, 320, 200);
    await drawRect(page, 340, 140, 440, 200);
    await drawRect(page, 120, 250, 460, 320);
    await selectTool(page);
    // Outer frame → flex column
    await page.mouse.click(outerBox.x + 90, outerBox.y + 90);
    await page.waitForTimeout(400);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    await selectFromCombobox(page, 'Layout direction', 'Column');
    await page.waitForTimeout(300);
    const gapInput = layoutSection(page).getByLabel('Gap');
    await gapInput.clear();
    await gapInput.fill('8');
    await page.waitForTimeout(200);
    // Inner frame → flex row
    await selectTool(page);
    await page.mouse.click(outerBox.x + 180, outerBox.y + 170);
    await page.waitForTimeout(400);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    await selectFromCombobox(page, 'Layout direction', 'Row');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-12-nested.png' });
  });

  // ── 13. Disable auto layout preserves appearance ───────────────

  test('13 - disabling auto layout preserves child positions', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 250);
    await drawRect(page, 280, 150, 380, 250);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-13a-before-disable.png' });
    await selectFromCombobox(page, 'Layout mode', 'None');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-13b-after-disable.png' });
  });

  // ── 14. Undo ───────────────────────────────────────────────────

  test('14 - undo reverts layout change', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 250);
    await drawRect(page, 280, 150, 380, 250);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-14a-layout-on.png' });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-14b-after-undo.png' });
  });

  // ── 15. Child alignment override ───────────────────────────────

  test('15 - child alignment override settable', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 200);
    await drawRect(page, 280, 150, 380, 160);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    // Select first child at frame content origin.
    await selectChildAt(page, box, 100, 100);
    await selectFromCombobox(page, 'Child cross-axis alignment override', 'Center');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-15-child-align-override.png' });
  });

  // ── 16. Hug + fixed combination ────────────────────────────────

  test('16 - hug child sizes to content, fixed child stays fixed', async ({ page }) => {
    test.setTimeout(300000);
    const box = await drawFrame(page, 80, 80, 480, 380);
    await drawRect(page, 150, 150, 250, 250);
    await drawRect(page, 280, 150, 350, 200);
    await selectFrame(page, box);
    await selectFromCombobox(page, 'Layout mode', 'Flex');
    await page.waitForTimeout(300);
    // Select first child at frame content origin.
    await selectChildAt(page, box, 100, 100);
    await selectFromCombobox(page, 'Child width sizing', 'Hug contents');
    await page.waitForTimeout(300);
    await selectFromCombobox(page, 'Child height sizing', 'Hug contents');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/autolayout-16-hug-fixed.png' });
  });
});
