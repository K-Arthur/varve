import { expect, type Locator, type Page } from '@playwright/test';
import { assertCanvasGesture, type CanvasPoint } from './helpers/canvasGesture';

/** Click the visible label rather than the clipped native checkbox input. */
export async function setVisibleCheckbox(control: Locator, checked: boolean): Promise<void> {
  await expect(control).toBeAttached();
  if ((await control.isChecked()) !== checked) {
    const label = control.locator('xpath=ancestor::label[1]');
    await expect(label).toBeVisible();
    await label.click();
  }
  if (checked) await expect(control).toBeChecked();
  else await expect(control).not.toBeChecked();
}

/**
 * Navigate from the home screen to the editor.
 * Shared across all E2E specs — fix one place, not 15.
 *
 * Sequence:
 *   / → [New] → dialog → [Create] → wait for the editor shell → dismiss welcome
 */
export async function navigateToEditor(
  page: Page,
  path = '/',
  options: { waitUntil?: 'commit' | 'domcontentloaded'; startupTimeout?: number } = {},
) {
  const dismissSafeMode = async (timeout = 5000) => {
    const continueNormalStartup = page.getByRole('button', {
      name: /continue normal startup/i,
    });
    if (!(await continueNormalStartup.isVisible({ timeout }).catch(() => false))) return;
    await continueNormalStartup.click({ timeout: 10000 });
    await page
      .locator('.safe-mode-screen')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => undefined);
    await page.waitForTimeout(250);
  };

  // Generous timeouts: under heavy concurrent dev-server load (many watched
  // files recompiling at once), first paint can take much longer than a
  // quiet dev server without indicating any real problem. Measured cold
  // first paint on a fresh vite transform cache: ~76s on this machine, so
  // 45s was not enough and failed on every platform in CI. With several
  // agent suites sharing one machine, domcontentloaded itself has been
  // observed at 90-200s — keep this budget above the observed ceiling.
  await page.goto(path, {
    timeout: 300000,
    waitUntil: options.waitUntil ?? 'domcontentloaded',
  });
  // A previously crashed or interrupted test run can leave the app in safe
  // mode (localStorage-backed): it blocks the whole UI behind the "Varve had
  // trouble starting" gate. Clear the flag and reload so the canvas flow can
  // start at all — mirroring navigateToCleanEditor in helpers/nav.ts.
  const inSafeMode = await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null);
  if (inSafeMode) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 300000 });
  }
  await dismissSafeMode();
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
  await newBtn.waitFor({ state: 'visible', timeout: options.startupTimeout ?? 45000 });
  await newBtn.click({ force: true, timeout: 15000 });
  // Crash-loop recovery can finish booting after the Home buttons become
  // visible. Re-check after opening New so the modal never races a safe-mode
  // screen that is still mounted above it.
  await dismissSafeMode(1000);
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
  // Side panels are responsive drawers and are intentionally hidden by
  // default below the editor breakpoint. Wait for the shell rather than a
  // desktop-only panel so narrow canvas specs can reach their own assertions.
  const editorShell = page.locator('.editor-shell');
  try {
    await editorShell.waitFor({ state: 'visible', timeout: 30000 });
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
    await editorShell.waitFor({ state: 'visible', timeout: 30000 });
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

  // The shell mounts before CanvasArea and LayersPanel have completed their
  // first render. On a loaded CI runner, actions issued immediately after
  // `.editor-shell` becomes visible can be lost: drawing silently creates no
  // layer, while menu focus is still owned by the startup portal. Wait for
  // both interaction surfaces and a non-zero canvas before handing control to
  // the spec. This remains attached-state safe for responsive layouts, where
  // the layers panel may be collapsed but remains mounted.
  await page.locator('canvas.editor-canvas__content-layer').waitFor({
    state: 'visible',
    timeout: 60000,
  });
  await page.locator('.layers-panel').waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement | null;
      const layers = document.querySelector('.layers-panel');
      return canvas != null && canvas.clientWidth > 0 && canvas.clientHeight > 0 && layers != null;
    },
    undefined,
    { timeout: 60000 },
  );
  await page.waitForTimeout(250);
}

/** Activate a workspace whether its responsive tab is visible or in More. */
export async function switchWorkspace(page: Page, label: string) {
  const tab = page.locator(`.workspace-dock__item[aria-label="${label} workspace"]`);
  if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
    // Workspace switching updates the tab strip in the same React commit as
    // the mode change. Playwright's geometry-based click can therefore hold a
    // handle to the old button long enough to observe it being detached. The
    // current button's native click dispatches the React handler atomically
    // and avoids a 180s actionability timeout on a harmless rerender.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page
          .locator(`.workspace-dock__item[aria-label="${label} workspace"]`)
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
  await page
    .getByRole('menu', { name: 'Layout submenu', exact: true })
    .getByRole('menuitem', { name: 'Table', exact: true })
    .click();
}

/** Create a color variable through the document-scoped Variables and Tokens dialog. */
export async function addColorVariable(page: Page, name: string, value: string): Promise<void> {
  const dialog = await openVariablesAndTokensDialog(page);
  await dialog.getByRole('button', { name: '+ Add', exact: true }).click();
  const addForm = dialog.locator('.variable-panel__add-form');
  await addForm.getByPlaceholder('name', { exact: true }).fill(name);
  const valueInput = addForm.getByPlaceholder('value', { exact: true });
  await valueInput.fill(value);
  await valueInput.press('Enter');
  await expect(dialog.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 });
  await closeVariablesAndTokensDialog(dialog);
}

/** Open the document-scoped variable editor through its current menu entry. */
export async function openVariablesAndTokensDialog(page: Page): Promise<Locator> {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  const viewMenu = page.getByRole('menu', { name: 'View' });
  await viewMenu.getByRole('menuitem', { name: 'Panels', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Variables and Tokens…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

/** Close the document-scoped variable editor. */
export async function closeVariablesAndTokensDialog(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
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
  // Use the measured canvas bounds instead of advancing fixed coordinates.
  // The old x += 120 loop eventually clicked outside narrow canvases, silently
  // seeding fewer layers than requested and masking virtualization coverage.
  // The canvas element includes the top and left ruler strips; keep pointer
  // drags beyond those non-artwork hit targets as well as inside its bounds.
  const margin = 48;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const availableWidth = Math.max(1, box.width - margin * 2);
  const availableHeight = Math.max(1, box.height - margin * 2);
  const cellWidth = Math.min(96, availableWidth / columns);
  const cellHeight = Math.min(88, availableHeight / Math.max(rows, 1));
  const dragSize = Math.max(8, Math.min(40, cellWidth - 8, cellHeight - 8));
  const initialLayers = await page.getByRole('treeitem').count();
  for (let i = 0; i < count; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const x1 = margin + column * cellWidth;
    const y1 = margin + row * cellHeight;
    await page.keyboard.press('r');
    await page.waitForTimeout(100);
    // Move to start, then drag step by step crossing the 3px threshold
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    // Move in two stages to cross the 3px drag threshold without
    // the overhead of steps= events that can trigger PointerEvent
    // coalescing backpressure under parallel workers.
    await page.mouse.move(box.x + x1 + dragSize / 2, box.y + y1 + dragSize / 2);
    await page.mouse.move(box.x + x1 + dragSize, box.y + y1 + dragSize);
    await page.mouse.up();
    // Wait for each document mutation before issuing the next shortcut. A
    // fixed 100ms delay let slow runs silently drop later pointer creations.
    await expect(page.getByRole('treeitem').first()).toHaveAttribute(
      'aria-setsize',
      String(initialLayers + i + 1),
      { timeout: 5000 },
    );
  }
  await page.getByRole('treeitem').first().waitFor({ timeout: 5000 });
}

/**
 * Drag within the owned canvas at canvas-relative CSS-pixel coordinates.
 * Document/world coordinates must first be transformed with the actual camera.
 * Intermediate midpoint ensures the 3px drag threshold is crossed.
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
  const from = typeof fromOrX === 'number' ? { x: fromOrX, y: toOrY as number } : fromOrX;
  const to =
    typeof fromOrX === 'number'
      ? { x: maybeToX as number, y: maybeToY as number }
      : (toOrY as { x: number; y: number });
  return dragCanvasGesture(page, from, to);
}

/** A deliberate pointer-captured pan may end outside; drawing must remain inside. */
export async function dragBeyondCanvas(
  page: Page,
  from: CanvasPoint,
  to: CanvasPoint,
  reason: string,
) {
  return dragCanvasGesture(page, from, to, reason);
}

async function dragCanvasGesture(page: Page, from: CanvasPoint, to: CanvasPoint, reason?: string) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15_000 });
  const box = await canvas.boundingBox();
  assertCanvasGesture(box, from, to, reason);
  const sx = box.x + from.x;
  const sy = box.y + from.y;
  const ex = box.x + to.x;
  const ey = box.y + to.y;

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

/**
 * Add a Layer Effect through the section-header picker.
 *
 * Choosing a type in the picker *is* the add action — the previous
 * "select a type, then press Add" two-step flow is gone. Mirrors the Fill
 * ("Add fill") and Object Filters ("Add Object Filter") controls. Repeating
 * this helper builds a multi-effect stack; repeating the same type with tuned
 * values stays available through each row's Duplicate action.
 */
export async function addLayerEffect(page: Page, section: Locator, label: string): Promise<void> {
  await section.getByRole('button', { name: 'Add effect' }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await expect(section.locator('.insp-effect-row').filter({ hasText: label })).toBeVisible();
}
