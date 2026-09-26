/**
 * E2E: a colour binding must paint on a node that has a `fills[]` stack, and
 * editing the variable must repaint the canvas without reselecting the layer.
 *
 * Two defects this pins (follow-up to
 * docs/tokens/dtcg-interop-evidence-2026-09-25.md, 2026-09-25):
 *  1. `applyBindingsToNode` wrote `node.fill`, which the engine ignores once
 *     `node.fills` exists — so "Link to variable" on any layer whose paint
 *     stack had ever been edited changed nothing on canvas while the badge
 *     claimed success.
 *  2. The variable-only document change skipped the `docVersion` bump, so the
 *     worker bitmap still read as current: the frame composited the pre-edit
 *     bitmap and a token edit would not repaint until the camera moved.
 *
 * Structured data first: the assertions are exact pixel counts on the content
 * canvas; the screenshots are inspected evidence, not the oracle.
 *
 * Note: `addColorVariable` in tests/e2e/shared.ts still targets the Layers
 * panel, but VariablePanel moved into the "Variables and tokens" dialog
 * (ff1470aa0) — this spec opens the dialog itself until that helper is
 * repaired.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

const RED = { r: 255, g: 0, b: 127 };
const BLUE = { r: 0, g: 160, b: 255 };

async function countColors(page: Page): Promise<{ red: number; blue: number }> {
  const counts = await page.evaluate(
    (targets) => {
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement | null;
      if (!canvas) return { red: -1, blue: -1 };
      const ctx = canvas.getContext('2d');
      if (!ctx) return { red: -1, blue: -1 };
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const within = (i: number, t: { r: number; g: number; b: number }, tol: number) => {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        return (
          r !== undefined &&
          g !== undefined &&
          b !== undefined &&
          a !== undefined &&
          Math.abs(r - t.r) <= tol &&
          Math.abs(g - t.g) <= tol &&
          Math.abs(b - t.b) <= tol &&
          a > 200
        );
      };
      let red = 0;
      let blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (within(i, targets.red, 40)) red++;
        else if (within(i, targets.blue, 40)) blue++;
      }
      return { red, blue };
    },
    { red: RED, blue: BLUE },
  );
  return counts;
}

/**
 * Poll the canvas until `goal` holds (or the budget expires) and return the
 * last sample. The oracle stays exact — pixel counts — but one snapshot is a
 * timing assumption, not the requirement: on a loaded machine a frame can land
 * after any fixed wait, so the requirement is "repaints within a bounded
 * window".
 */
async function waitForColor(
  page: Page,
  goal: (c: { red: number; blue: number }) => boolean,
  budgetMs = 10000,
): Promise<{ red: number; blue: number }> {
  const deadline = Date.now() + budgetMs;
  let last = { red: -1, blue: -1 };
  do {
    last = await countColors(page);
    if (goal(last)) return last;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return last;
}

async function openVariablesDialog(page: Page) {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  const viewMenu = page.getByRole('menu', { name: 'View' });
  await viewMenu.getByRole('menuitem', { name: 'Panels', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Variables and Tokens…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

async function closeVariablesDialog(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
}

test('fill binding paints on a fills-stack layer and repaints on variable edit', async ({
  page,
}) => {
  await navigateToEditor(page);

  // Flat scene on purpose: a lone rectangle keeps `sceneNeedsStructural`
  // false, which is exactly the worker fast path that used to keep serving
  // the pre-edit bitmap.
  await page.keyboard.press('r');
  await dragOnCanvas(page, 160, 160, 360, 320);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  // Materialize a fills[] stack without covering the primary paint: toggling
  // the fill's visibility off and on runs the paint-stack write path (which
  // is what creates `node.fills`), and the fill ends visible again. Once
  // `node.fills` exists the legacy `fill` field is no longer what the engine
  // paints — the case where the binding used to be inert.
  const hideFill = page.getByRole('switch', { name: 'Hide Fill' });
  await hideFill.click({ timeout: 5000 });
  await page.waitForTimeout(200);
  const showFill = page.getByRole('switch', { name: 'Show Fill' });
  await showFill.click({ timeout: 5000 });
  await page.waitForTimeout(300);

  // Create the variable through the Variables and tokens dialog.
  const dialog = await openVariablesDialog(page);
  await dialog.getByRole('button', { name: '+ Add', exact: true }).click();
  const addForm = dialog.locator('.variable-panel__add-form');
  await addForm.getByPlaceholder('name', { exact: true }).fill('Brand Red');
  const valueInput = addForm.getByPlaceholder('value', { exact: true });
  await valueInput.fill('#ff007f');
  await valueInput.press('Enter');
  await expect(dialog.getByText('Brand Red')).toBeVisible({ timeout: 5000 });
  await closeVariablesDialog(dialog);

  // Re-select the layer so the Inspector shows its paint stack.
  await page.getByRole('treeitem').first().click({ timeout: 5000 });
  await page.waitForTimeout(300);

  const baseline = await countColors(page);

  // Bind the primary fill to the variable.
  await page.getByRole('button', { name: 'Fill actions', exact: true }).click({ timeout: 5000 });
  await page.getByRole('menuitem', { name: /link to variable/i }).click({ timeout: 5000 });
  const picker = page.getByRole('combobox', { name: /search variables/i });
  await picker.click({ timeout: 5000 });
  await page.getByRole('option', { name: /Brand Red/ }).click({ timeout: 5000 });
  await expect(page.getByText('$Brand Red').first()).toBeVisible({ timeout: 5000 });

  const minRed = Math.max(200, baseline.red + 200);
  const bound = await waitForColor(page, (c) => c.red > minRed && c.red > c.blue);
  expect(
    bound.red,
    `binding must paint on a fills[] node (baseline red=${baseline.red})`,
  ).toBeGreaterThan(minRed);
  expect(bound.red).toBeGreaterThan(bound.blue);

  await page.screenshot({
    path: 'docs/screenshots/token-binding-repaint/01-bound-red.png',
    fullPage: false,
  });

  // Edit the variable: the canvas must repaint with no reselection.
  const reopened = await openVariablesDialog(page);
  const valueButton = reopened.locator('.variable-panel__value-btn').first();
  await valueButton.click({ timeout: 5000 });
  const editInput = reopened.locator('.variable-panel__edit-input');
  await editInput.fill('#00a0ff');
  await editInput.press('Enter');
  await closeVariablesDialog(reopened);
  const minBlue = Math.max(200, baseline.blue + 200);
  const edited = await waitForColor(page, (c) => c.blue > minBlue && c.blue > c.red);
  expect(edited.blue, `variable edit must repaint (blue=${edited.blue})`).toBeGreaterThan(minBlue);
  expect(edited.red, 'the previous colour must be replaced, not blended').toBeLessThan(
    bound.red / 2,
  );

  await page.screenshot({
    path: 'docs/screenshots/token-binding-repaint/02-edited-blue.png',
    fullPage: false,
  });

  // Undo restores the previous variable value and repaints again.
  await page.keyboard.press('Control+z');
  const undone = await waitForColor(page, (c) => c.red > minRed && c.red > c.blue);
  expect(undone.red, 'undo must repaint the previous colour').toBeGreaterThan(minRed);
  expect(undone.blue).toBeLessThan(edited.blue / 2);
});
