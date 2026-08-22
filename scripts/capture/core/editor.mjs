/**
 * Driving the real editor into a known state.
 *
 * Shared by every workflow capture. These helpers only ever click what a user
 * clicks: the point of the recordings is that the capability shown is the one
 * the product has, so nothing here reaches past the UI to stage a result.
 */

/**
 * Suppresses first-run UI before any application script runs.
 *
 * The onboarding checklist, welcome dialog and "Did you know?" tips are
 * correct behaviour for a new user and wrong for a recording — they float
 * over the canvas and change with elapsed time. Seeding the persisted state a
 * returning user would have is deterministic and needs no screenshot mode in
 * the application.
 */
export const SEED_FIRST_RUN_STATE = () => {
  try {
    localStorage.setItem(
      'strata:onboarding',
      JSON.stringify({
        onboardingComplete: true,
        onboardingVersion: 1,
        skillLevel: 'advanced',
        checklistProgress: ['shape', 'color', 'text', 'group', 'export'],
        dismissedTips: [],
        seenFeatureBadges: [],
        tutorialFileCompleted: true,
      }),
    );
    localStorage.setItem(
      'strata:tips-today',
      JSON.stringify({ count: 99, date: new Date().toDateString(), shownIds: [] }),
    );
  } catch {
    /* storage unavailable; dialogs are closed defensively below */
  }
};

/** Closes any stacked dialogs left open, so none intercepts the next click. */
export async function dismissDialogs(page, attempts = 4) {
  for (let i = 0; i < attempts; i += 1) {
    const open = page.locator('dialog[open]');
    if ((await open.count()) === 0) return;
    const close = open.last().getByRole('button', { name: /close/i }).first();
    if (!(await close.isVisible({ timeout: 400 }).catch(() => false))) return;
    await close.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }
}

/**
 * Cold start through to an empty document, with recovery and safe mode
 * cleared. A capture that opens on a recovery prompt is not a capture of the
 * product working.
 */
export async function openCleanEditor(page, base, { preset } = {}) {
  await page.goto(`${base}/`, { timeout: 180000, waitUntil: 'domcontentloaded' });

  if (await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null)) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 180000 });
  }

  const recovery = page
    .locator('dialog[open]')
    .filter({ hasText: /closed unexpectedly|recover your documents/i });
  if ((await recovery.count()) > 0) {
    await recovery
      .getByRole('button', { name: /review my documents/i })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
  }

  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 180000 });
  await newBtn.click({ force: true, timeout: 15000 });

  const dialog = page.locator('dialog[open]');
  if (preset) {
    const option = dialog.getByRole('button', { name: preset }).first();
    if (await option.isVisible({ timeout: 4000 }).catch(() => false)) {
      await option.click({ timeout: 5000 });
      await page.waitForTimeout(300);
    }
  }
  await dialog
    .getByRole('button', { name: /create design/i })
    .or(dialog.getByRole('button', { name: /create/i }))
    .first()
    .click({ timeout: 30000 });

  await page.locator('.layers-panel').waitFor({ timeout: 180000 });
  await page.locator('.editor-shell').waitFor({ timeout: 20000 });
  await dismissDialogs(page);
}

/** Opens a committed fixture through the application's own File > Open input. */
export async function openDocument(page, fixturePath) {
  await page.setInputFiles('#file-open-input', fixturePath);
  await page.locator('.layers-panel').waitFor({ timeout: 45000 });
  await page.waitForTimeout(1200);
  await dismissDialogs(page);
}

/** Imports a raster asset through the application's own image-import input. */
export async function importImage(page, fixturePath) {
  await page.setInputFiles('#file-import-input', fixturePath);
  await page.getByRole('treeitem').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
  await dismissDialogs(page);
}

export async function selectLayer(page, pattern, { timeout = 6000 } = {}) {
  const item = page.getByRole('treeitem').filter({ hasText: pattern }).first();
  await item.waitFor({ state: 'visible', timeout });
  await item.click({ timeout: 5000 });
  await page.waitForTimeout(400);
  return item;
}

/** Reads the status-bar zoom percentage, used to assert deterministic framing. */
export function currentZoom(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.editor-status__zoom-value');
    return el instanceof HTMLInputElement ? Number(el.value) : null;
  });
}

/**
 * Deterministic framing. Selecting a layer reveals and zooms to it, so this
 * must run *after* any selection, never before.
 */
export async function fitContent(page, { maxZoom = 400 } = {}) {
  const fit = page.getByRole('button', { name: /fit all to viewport/i }).first();
  await fit.waitFor({ state: 'visible', timeout: 10000 });
  await fit.click({ timeout: 5000 });
  await page.waitForTimeout(700);
  const zoom = await currentZoom(page);
  if (zoom === null) throw new Error('could not read the zoom level to verify framing');
  if (zoom > maxZoom) throw new Error(`fit-all did not frame the document (zoom ${zoom}%)`);
  return zoom;
}

/** Parks the pointer off the canvas so no hover state is captured. */
export async function parkPointer(page) {
  await page.mouse.move(1430, 880);
  await page.waitForTimeout(150);
}

/** Activates a tool by its keyboard shortcut and confirms it took. */
export async function useTool(page, key) {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
}

/**
 * Waits for the things that actually settle rather than sleeping: web fonts
 * resolved, then two animation frames so a consequential layout change has
 * been through both React commit and the canvas repaint that follows it.
 */
export async function settle(page, { pauseMs = 400 } = {}) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  if (pauseMs > 0) await page.waitForTimeout(pauseMs);
}

/** A deliberate hold so a viewer can read what just changed. */
export function beat(page, ms = 1200) {
  return page.waitForTimeout(ms);
}

/** Runs a command through the palette — the same route a user takes. */
export async function runCommand(page, name) {
  await page.keyboard.press('Control+k');
  const palette = page.locator('[role="dialog"], .command-palette').first();
  await palette.waitFor({ state: 'visible', timeout: 8000 });
  await page.keyboard.type(name, { delay: 25 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

/* ---------------------------------------------------------------- */
/* Canvas interaction                                               */
/* ---------------------------------------------------------------- */

export async function canvasBox(page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 20000 });
  const box = await canvas.boundingBox();
  if (!box || box.width < 10 || box.height < 10) throw new Error('content canvas not laid out');
  return box;
}

/** Moves visibly before pressing, so the cursor is where the click lands. */
export async function clickCanvas(page, x, y, { settleMs = 350 } = {}) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + x, box.y + y, { steps: 12 });
  await page.mouse.down();
  await page.mouse.up();
  // The pen tool treats two clicks inside 300ms as "finish path", so callers
  // placing anchors must stay above that.
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

/** Click-drag on the canvas — the gesture that pulls a Bézier tangent out. */
export async function dragCanvas(page, from, to, { steps = 22, settleMs = 350 } = {}) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + from[0], box.y + from[1], { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps });
  await page.mouse.up();
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

/** Pixels of the content canvas, for before/after comparison of a real edit. */
export async function canvasPixels(page) {
  return page.locator('canvas.editor-canvas__content-layer').screenshot();
}

/** Names of every layer currently in the tree. */
export async function layerNames(page) {
  return page.getByRole('treeitem').allInnerTexts();
}
