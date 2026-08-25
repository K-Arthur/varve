import type { Page } from '@playwright/test';

/**
 * Navigate from the home screen to the editor.
 * Shared across all E2E specs — fix one place, not 15.
 *
 * Sequence:
 *   / → [New] → dialog → [Create] → wait for .layers-panel → dismiss welcome
 */
export async function navigateToEditor(page: Page, path = '/') {
  // Generous timeouts: under heavy concurrent dev-server load (many watched
  // files recompiling at once), first paint can take much longer than a
  // quiet dev server without indicating any real problem. Measured cold
  // first paint on a fresh vite transform cache: ~76s on this machine, so
  // 45s was not enough and failed on every platform in CI. With several
  // agent suites sharing one machine, domcontentloaded itself has been
  // observed at 90-200s — keep this budget above the observed ceiling.
  await page.goto(path, { timeout: 300000, waitUntil: 'domcontentloaded' });
  // A previously crashed or interrupted test run can leave the app in safe
  // mode (localStorage-backed): it blocks the whole UI behind the "Varve had
  // trouble starting" gate. Clear the flag and reload so the canvas flow can
  // start at all — mirroring navigateToCleanEditor in helpers/nav.ts.
  const inSafeMode = await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null);
  if (inSafeMode) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 300000 });
  }
  // Crash-recovery dialog (IndexedDB-backed): "Review my documents" only
  // dismisses the dialog, so clicking it is side-effect free.
  const recovery = page.locator('dialog[open]').filter({
    hasText: /closed unexpectedly|recover your documents/i,
  });
  if ((await recovery.count()) > 0) {
    await recovery
      .getByRole('button', { name: /review my documents/i })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
    await page.waitForTimeout(400);
  }
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 45000 });
  await newBtn.click({ force: true, timeout: 15000 });
  // The new-document dialog's primary action is labelled "Create design" in
  // some builds and plain "Create" in others, so match either. The 5s budget
  // this replaces was the outlier in a helper that otherwise allows 45-300s:
  // on a machine running several suites at once the dialog routinely opens
  // later than that, and every spec using this helper then failed in
  // beforeEach — before its own body ever ran, and with a GPU-shaped error
  // message that had nothing to do with the real cause.
  const createInDialog = page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create(\s+design)?$/i })
    .first();
  if (!(await createInDialog.isVisible({ timeout: 45000 }).catch(() => false))) {
    // An empty file browser leads with "Create your first design" instead of
    // opening the dialog from the toolbar's New button.
    const firstDesign = page.getByRole('button', { name: /create your first design/i }).first();
    if (!(await firstDesign.isVisible({ timeout: 5000 }).catch(() => false))) {
      throw new Error('New did not offer a create action (no dialog, no empty-state button)');
    }
    await firstDesign.click({ timeout: 10000 });
    await createInDialog.waitFor({ timeout: 45000 });
  }
  await createInDialog.click({ timeout: 15000 });
  const layersPanel = page.locator('.layers-panel');
  try {
    await layersPanel.waitFor({ timeout: 30000 });
  } catch (error) {
    // Web storage can swap from the in-memory boot platform to IndexedDB
    // between creation and the open callback. If that narrow race leaves the
    // newly-created file on Home, open the just-created card and continue;
    // this keeps canvas specs focused on the editor interaction they cover.
    const createdFile = page.getByRole('gridcell').first();
    if (!(await createdFile.isVisible({ timeout: 1000 }).catch(() => false))) {
      throw error;
    }
    await createdFile.click({ timeout: 10000 });
    await layersPanel.waitFor({ timeout: 30000 });
  }

  // Startup state can restore more than one modal (for example Settings over
  // the first-run welcome dialog). Clicking either close button is then
  // intercepted by the other dialog. Canvas tests do not exercise onboarding,
  // so close the stacked startup dialogs deterministically.
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

  // Dismiss "Welcome to Varve" modal on first launch
  const blankCanvas = page.getByRole('dialog').getByRole('button', { name: /^blank canvas$/i });
  if (await blankCanvas.isVisible({ timeout: 1000 }).catch(() => false)) {
    await blankCanvas.click({ timeout: 5000 });
  } else {
    const close = page
      .getByRole('dialog')
      .getByRole('button', { name: /close|get started/i })
      .first();
    if (await close.isVisible({ timeout: 1000 }).catch(() => false)) {
      await close.click({ timeout: 5000 });
    }
  }

  // Dismiss the in-editor onboarding checklist panel if present.
  const dismiss = page.locator('.onboarding-checklist__dismiss');
  if (await dismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
    await dismiss.click({ timeout: 5000 });
  }

  // Some modal state updates settle one render after the onboarding close.
  // Leave canvas workflows with no modal intercepting input.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const close = openDialogs.last().getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(50);
  }
}

/** Activate a workspace whether its responsive tab is visible or in More. */
export async function switchWorkspace(page: Page, label: string) {
  const tab = page.locator(`.workspace-tabs__tab[aria-label="${label} workspace"]`);
  if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
    // Workspace switching updates the tab strip in the same React commit as
    // the mode change. Playwright's geometry-based click can therefore hold a
    // handle to the old button long enough to observe it being detached. The
    // current button's native click dispatches the React handler atomically
    // and avoids a 180s actionability timeout on a harmless rerender.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page
          .locator(`.workspace-tabs__tab[aria-label="${label} workspace"]`)
          .evaluate((element) => (element as HTMLButtonElement).click());
        return;
      } catch {
        await page.waitForTimeout(50);
      }
    }
    throw new Error(`Workspace tab detached while switching to ${label}`);
  }
  await page.getByRole('button', { name: 'More workspaces' }).click();
  await page
    .getByRole('menu', { name: 'More workspaces' })
    .getByText(label, { exact: true })
    .click();
}

/**
 * Navigate to the home screen and wait for it to render.
 */
export async function navigateToHome(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.varve-home');
  // `.varve-home` is also used by the loading skeleton. Wait for the real
  // interactive shell before clicking navigation or toolbar controls.
  await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 45000 });
}

/**
 * Activate the Table tool whether it is directly visible or responsive
 * overflow has moved the Layout group into More tools.
 */
export async function activateTableTool(page: Page): Promise<void> {
  const toolbar = page.getByTestId('toolbar');
  const directTableTool = toolbar.locator('[data-tool="table"]');
  if (await directTableTool.isVisible().catch(() => false)) {
    await directTableTool.click();
    return;
  }

  await toolbar.getByRole('button', { name: 'More tools' }).click();
  // ContextMenu is portal-mounted. Its role name is not exposed reliably in
  // Chromium's accessibility tree, so anchor on its stable rendered class.
  const overflow = page.locator('.varve-ctxmenu');
  await overflow.getByText('Layout', { exact: true }).click();
  await page.locator('.varve-menu__submenu').getByText('Table', { exact: true }).click();
}

/** Create a color variable through the Layers panel's scoped add form. */
export async function addColorVariable(page: Page, name: string, value: string): Promise<void> {
  const layersPanel = page.getByTestId('layers-panel');
  await layersPanel.getByRole('button', { name: '+ Add', exact: true }).click();
  const addForm = layersPanel.locator('.variable-panel__add-form');
  await addForm.getByPlaceholder('name', { exact: true }).fill(name);
  const valueInput = addForm.getByPlaceholder('value', { exact: true });
  await valueInput.fill(value);
  await valueInput.press('Enter');
}

/**
 * Seed the canvas with `count` distinct rectangles so the layers tree is
 * populated.  Uses the Rect tool shortcut (r) + drag across the canvas.
 */
export async function seedLayers(page: Page, count: number) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  for (let i = 0; i < count; i++) {
    const x1 = 100 + i * 120;
    const y1 = 100 + i * 60;
    await page.keyboard.press('r');
    await page.waitForTimeout(100);
    // Move to start, then drag step by step crossing the 3px threshold
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    // Move in two stages to cross the 3px drag threshold without
    // the overhead of steps= events that can trigger PointerEvent
    // coalescing backpressure under parallel workers.
    await page.mouse.move(box.x + x1 + 40, box.y + y1 + 40);
    await page.mouse.move(box.x + x1 + 80, box.y + y1 + 80);
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
  await page.getByRole('treeitem').first().waitFor({ timeout: 5000 });
}

/**
 * Drag on the canvas at world-space coordinates (relative to the artboard
 * origin).  Intermediate midpoint ensures the 3px drag threshold is crossed.
 *
 * @returns the canvas bounding box at the time of the drag, for assertions.
 */
export async function dragOnCanvas(
  page: Page,
  fromWorld: { x: number; y: number },
  toWorld: { x: number; y: number },
): Promise<NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>>;
export async function dragOnCanvas(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Promise<NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>>;
export async function dragOnCanvas(
  page: Page,
  fromOrX: { x: number; y: number } | number,
  toOrY: { x: number; y: number } | number,
  maybeToX?: number,
  maybeToY?: number,
) {
  const fromWorld = typeof fromOrX === 'number' ? { x: fromOrX, y: toOrY as number } : fromOrX;
  const toWorld =
    typeof fromOrX === 'number'
      ? { x: maybeToX as number, y: maybeToY as number }
      : (toOrY as { x: number; y: number });
  const coordinates = [fromWorld.x, fromWorld.y, toWorld.x, toWorld.y];
  if (!coordinates.every(Number.isFinite)) {
    throw new TypeError(`Canvas drag coordinates must be finite: ${coordinates.join(', ')}`);
  }

  // Hidden thumbnail/offscreen canvases may mount before the editor surface.
  // Always target the owned artwork layer so browser-specific DOM timing does
  // not select a zero-sized auxiliary canvas.
  // Use 'attached' not 'visible' — the canvas may render off-screen after
  // extreme pan (floating-origin test pans -900px in both axes). As long as
  // it exists in the DOM we can compute screen-space coordinates from its
  // bounding box.
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) {
    // Fallback: try the any-visible-canvas strategy for panned views
    const anyCanvas = page.locator('canvas').first();
    const fallbackBox = await anyCanvas.boundingBox();
    if (!fallbackBox) throw new Error('canvas not found');
    return dragOnCanvasFallback(page, fallbackBox, fromWorld, toWorld);
  }

  const sx = box.x + fromWorld.x;
  const sy = box.y + fromWorld.y;
  const ex = box.x + toWorld.x;
  const ey = box.y + toWorld.y;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(Math.round((sx + ex) / 2), Math.round((sy + ey) / 2));
  await page.mouse.move(ex, ey);
  await page.mouse.up();

  return box;
}

/**
 * Fallback drag helper used when the primary canvas has no bounding box
 * (e.g. after extreme pan).  Uses any available canvas and its bounding
 * box to compute screen coordinates.
 */
async function dragOnCanvasFallback(
  page: Page,
  box: NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>,
  fromWorld: { x: number; y: number },
  toWorld: { x: number; y: number },
) {
  const sx = box.x + fromWorld.x;
  const sy = box.y + fromWorld.y;
  const ex = box.x + toWorld.x;
  const ey = box.y + toWorld.y;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(Math.round((sx + ex) / 2), Math.round((sy + ey) / 2));
  await page.mouse.move(ex, ey);
  await page.mouse.up();

  return box;
}

/**
 * Wait for a dialog with the `[open]` attribute to be visible.
 * Always scope to `dialog[open]` — the app mounts all dialogs upfront and
 * toggles `open` rather than conditionally rendering them.
 */
export async function waitForOpenDialog(page: Page) {
  return page.locator('dialog[open]').waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Helper: click the sidebar navigation button with the given label text.
 */
export async function sidebarNavClick(page: Page, label: string) {
  await page
    .locator('nav[aria-label="File navigation"]')
    .getByRole('button', { name: new RegExp(label, 'i') })
    .click();
}

/**
 * Locate the artboard canvas element.  Used for shape creation and selection.
 */
export function canvasLocator(page: Page) {
  return page.locator('canvas').first();
}
