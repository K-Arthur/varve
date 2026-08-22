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
export async function openCleanEditor(page, base, { preset, query = '' } = {}) {
  const suffix = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  await page.goto(`${base}/${suffix}`, { timeout: 180000, waitUntil: 'domcontentloaded' });

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
    // PresetPicker renders tiles as role="option" inside a role="listbox",
    // not as buttons — searching for a button silently matched nothing and
    // the document was created at the default size.
    const option = dialog.getByRole('option', { name: preset }).first();
    if (await option.isVisible({ timeout: 6000 }).catch(() => false)) {
      await option.click({ timeout: 5000 });
      await page.waitForTimeout(400);
    } else {
      // Searchable pickers need the query narrowed before the tile exists.
      const search = dialog.getByRole('combobox').first();
      if (await search.isVisible({ timeout: 2000 }).catch(() => false)) {
        await search.click();
        await page.keyboard.type(typeof preset === 'string' ? preset : 'A3', { delay: 40 });
        await page.waitForTimeout(600);
        const narrowed = dialog.getByRole('option', { name: preset }).first();
        await narrowed.waitFor({ state: 'visible', timeout: 6000 });
        await narrowed.click();
        await page.waitForTimeout(400);
      } else {
        throw new Error(`new-document preset ${preset} was not offered`);
      }
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
export async function settle(page, { pauseMs = 250 } = {}) {
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
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.waitFor({ state: 'visible', timeout: 8000 });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill(name);
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

/** Selects an APG combobox through its visible listbox, preserving product semantics. */
export async function selectComboboxOption(page, label, option) {
  const combo = page.getByRole('combobox', { name: label }).first();
  await combo.waitFor({ state: 'visible', timeout: 8000 });
  await combo.click();
  const listbox = page.getByRole('listbox', { name: label }).first();
  await listbox.waitFor({ state: 'visible', timeout: 5000 });
  await listbox.getByRole('option', { name: option, exact: true }).click();
  await page.waitForTimeout(350);
}

/** Commits a real inspector number field without relying on React internals. */
export async function setNumberField(page, label, value) {
  const field = page.getByRole('spinbutton', { name: label }).first();
  await field.waitFor({ state: 'visible', timeout: 8000 });
  await field.fill(String(value));
  await field.press('Enter');
  await page.waitForTimeout(350);
}

/** Opens the application's theme submenu and chooses a real theme radio item. */
export async function chooseTheme(page, theme) {
  const view = page.getByRole('menuitem', { name: /^View$/ }).first();
  await view.click();
  const item = page.getByRole('menuitemradio', { name: theme, exact: true }).last();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await page.waitForTimeout(500);
}

/** Creates an adjustment layer through Object > New Adjustment Layer. */
export async function createAdjustmentLayer(page) {
  const objectMenu = page.getByRole('menuitem', { name: /^Object$/ });
  await objectMenu.click();
  const create = page.getByRole('menuitem', { name: /New Adjustment Layer/i });
  await create.waitFor({ state: 'visible', timeout: 8000 });
  await create.click();
  await page.waitForTimeout(450);
  const adjustmentsTab = page.getByRole('tab', { name: /^Adjustments$/i });
  if (await adjustmentsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await adjustmentsTab.click();
  }
  await page.locator('.adj-panel__add-btn').waitFor({ state: 'visible', timeout: 8000 });
}

/** Adds an adjustment using the production adjustment panel menu. */
export async function addAdjustment(page, displayName) {
  const add = page.getByRole('button', { name: /Add adjustment/i });
  await add.waitFor({ state: 'visible', timeout: 8000 });
  await add.click();
  const item = page
    .locator('.adj-panel__add-menu')
    .getByRole('menuitem', { name: new RegExp(`^${displayName}$`, 'i') });
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await settle(page, { pauseMs: 250 });
}

/** Reads the real serialized adjustment stack from the selected layer. */
export async function adjustmentStack(page) {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return [];
    const key = Object.keys(root).find(
      (name) => name.startsWith('__reactFiber$') || name.startsWith('__reactContainer$'),
    );
    if (!key) return [];
    const visit = (fiber) => {
      if (!fiber) return null;
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        const value = props?.value;
        if (value && typeof value === 'object' && 'state' in value) {
          const state = value.state;
          const id = state?.selection?.length === 1 ? state.selection[0] : null;
          const node = id ? state.document?.nodes?.[id] : null;
          if (node?.kind === 'adjustment') return node.adjustments ?? [];
        }
      }
      return visit(fiber.child) || visit(fiber.sibling);
    };
    return visit(root[key]);
  });
}

/** Opens an adjustment row so its real editor controls are visible. */
export async function selectAdjustment(page, displayName) {
  const row = page
    .locator('.adj-panel__item')
    .filter({ hasText: new RegExp(`^${displayName}`, 'i') })
    .first();
  await row.waitFor({ state: 'visible', timeout: 8000 });
  await row.getByRole('button', { name: new RegExp(displayName, 'i') }).click();
  await page.waitForTimeout(250);
}

/** Returns the current canvas pixel bytes for before/after assertions. */
export async function canvasScreenshot(page) {
  return canvasPixels(page);
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

/**
 * Canvas coordinates as fractions of the drawing area.
 *
 * The content canvas is neither the viewport nor a fixed size — it is what
 * the panels leave behind (832x778 of a 1440x900 window at the time of
 * writing). Hardcoded pixels silently land outside it when a panel changes
 * width, and a pen gesture off the canvas draws nothing at all rather than
 * failing loudly, so every workflow addresses the canvas proportionally.
 */
export async function frac(page, fx, fy) {
  const box = await canvasBox(page);
  return [box.width * fx, box.height * fy];
}

/** Moves visibly before pressing, so the cursor is where the click lands. */
export async function clickCanvas(page, x, y, { settleMs = 350 } = {}) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + x, box.y + y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
  // The pen tool treats two clicks inside 300ms as "finish path", so callers
  // placing anchors must stay above that.
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

/** Click at a fractional position on the canvas. */
export async function clickAt(page, fx, fy, opts) {
  const [x, y] = await frac(page, fx, fy);
  return clickCanvas(page, x, y, opts);
}

/** Click-drag between two fractional positions on the canvas. */
export async function dragAt(page, from, to, opts) {
  const a = await frac(page, from[0], from[1]);
  const b = await frac(page, to[0], to[1]);
  return dragCanvas(page, a, b, opts);
}

/** Click-drag on the canvas — the gesture that pulls a Bézier tangent out. */
export async function dragCanvas(page, from, to, { steps = 12, settleMs = 350 } = {}) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + from[0], box.y + from[1], { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps });
  await page.mouse.up();
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

/**
 * A cheap fingerprint of the rendered canvas, for before/after comparison.
 *
 * Screenshotting the whole 832x778 canvas six times in a sequence added tens
 * of seconds to the recording on a loaded machine — and those seconds are in
 * the delivered clip as dead air, not just in the run. Downscaling to a small
 * region through the compositor keeps the comparison meaningful (any geometry
 * change moves pixels here) at a fraction of the cost.
 */
export async function canvasPixels(page) {
  const box = await canvasBox(page);
  return page.screenshot({
    clip: {
      x: box.x,
      y: box.y,
      width: Math.min(box.width, 640),
      height: Math.min(box.height, 480),
    },
    scale: 'css',
  });
}

/** Names of every layer currently in the tree. */
export async function layerNames(page) {
  return page.getByRole('treeitem').allInnerTexts();
}

/**
 * Positions of the anchors and handles the node-edit overlay is drawing.
 *
 * NodeEditOverlay paints them as SVG `<circle>`/`<rect>` in an absolutely
 * positioned, pointer-events:none layer, so they can be read exactly rather
 * than guessed at. This matters because selecting a layer reveals and zooms
 * to it: the coordinates a shape was drawn at are not where its anchors are
 * by the time node editing opens.
 *
 * Returns page coordinates, ordered as the overlay emits them, split into
 * anchors (the on-path points) and handles (the off-path tangent ends).
 */
export async function nodeEditPoints(page) {
  return page.evaluate(() => {
    const layers = [...document.querySelectorAll('svg[aria-hidden]')].filter(
      (svg) => svg.querySelector('circle, rect') && getComputedStyle(svg).position === 'absolute',
    );
    const out = { anchors: [], handles: [] };
    for (const svg of layers) {
      const box = svg.getBoundingClientRect();
      if (box.width < 50) continue;
      for (const el of svg.querySelectorAll('circle, rect')) {
        const isCircle = el.tagName.toLowerCase() === 'circle';
        const x = isCircle
          ? Number(el.getAttribute('cx'))
          : Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2;
        const y = isCircle
          ? Number(el.getAttribute('cy'))
          : Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const r = isCircle ? Number(el.getAttribute('r')) : 4;
        // The overlay draws anchors at r>=4 and tangent ends smaller.
        (r >= 4.5 || !isCircle ? out.anchors : out.handles).push({
          x: box.left + x,
          y: box.top + y,
        });
      }
    }
    return out;
  });
}

/** Drags between two absolute page positions. */
export async function dragPage(page, from, to, { steps = 14, settleMs = 350 } = {}) {
  await page.mouse.move(from.x, from.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

/**
 * Opens a disclosure section, and only if it is closed.
 *
 * The trigger is a toggle. Clicking it unconditionally shuts a section that
 * an earlier step already opened, and the failure then surfaces several
 * seconds later as "the control inside is missing" — which points at the
 * control rather than at the click that hid it.
 */
export async function openSection(page, name, { timeout = 8000 } = {}) {
  const trigger = page.getByRole('button', { name }).first();
  if (!(await trigger.isVisible({ timeout }).catch(() => false))) return false;
  if ((await trigger.getAttribute('aria-expanded')) === 'false') {
    await trigger.click();
    await page.waitForTimeout(500);
  }
  return true;
}

/**
 * Opens a menubar menu and returns one of its items.
 *
 * Follows the same shape as tests/e2e/helpers/menu-helpers.ts: the trigger is
 * scoped to `[role="menubar"]`, and the item is looked for inside the
 * `[role="menu"]` that opens. An unscoped `getByRole('menuitem')` matches
 * triggers and dropdown entries alike, so it can "open" the wrong thing and
 * then time out looking for an item that was never going to appear.
 */
export async function menuItem(page, menu, item, { timeout = 8000 } = {}) {
  const trigger = page.locator('[role="menubar"] [role="menuitem"]', { hasText: menu }).first();
  await trigger.waitFor({ state: 'visible', timeout });
  await trigger.click();
  const dropdown = page.locator('[role="menu"]').first();
  await dropdown.waitFor({ state: 'visible', timeout });
  const entry = dropdown.locator('[role="menuitem"]', { hasText: item }).first();
  await entry.waitFor({ state: 'visible', timeout });
  return entry;
}

/** Closes any open menubar dropdown. */
export async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

/**
 * Sets a React-controlled range input and makes React notice.
 *
 * `fill()` assigns the DOM value, but React tracks the previous value on the
 * node and skips the change when it re-renders from props — so a controlled
 * slider snaps straight back, often to its minimum, and the capture reports
 * that the control "did not move". Going through the prototype's value setter
 * clears that tracker, and the bubbled input/change events are what the
 * handler is actually listening for.
 */
export async function setRange(locator, value) {
  await locator.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}
