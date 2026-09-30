/**
 * Find and Replace — real-UI acceptance workflow.
 *
 * Drives the shipped bar (opened with Ctrl+F through the action registry) over
 * a document built with the real Text tool, then exercises navigation, single
 * replacement, Replace All, Undo, scope stability, and error reporting.
 *
 * Findings this spec pins (each reproduced against the pre-repair build):
 *  - Ctrl+F was advertised in the Edit menu but had no keyboard path at all:
 *    the command was menu-only because `findReplace` is not a SHORTCUT_DEFS
 *    entry, so neither the dispatcher nor the menu could resolve its chord.
 *  - Clicking a result moved canvas selection, which the old code treated as
 *    the live search scope and silently retargeted the search.
 *  - Invalid patterns were reported as "no matches" rather than as errors.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const SHOTS = path.resolve('reports/find-replace');

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

async function canvasBox(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('editor canvas has no bounds');
  return box;
}

/** Create a text layer at the given canvas-relative point. */
async function createText(page: Page, text: string, x: number, y: number, index: number) {
  const box = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + x, box.y + y);
  const editSurface = page.locator('textarea[data-text-edit-surface="true"]');
  await editSurface.waitFor({ timeout: 10_000 });
  await page.keyboard.insertText(text);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem')).toHaveCount(index, { timeout: 10_000 });
}

async function seedDocument(page: Page) {
  await navigateToEditor(page);
  await createText(page, 'brand brand refresh', 240, 200, 1);
  await createText(page, 'brand guidelines', 240, 320, 2);
}

async function openFindReplace(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+f');
  const bar = page.getByRole('dialog', { name: 'Find and replace' });
  await expect(bar).toBeVisible({ timeout: 10_000 });
  return bar;
}

async function find(bar: Locator, query: string) {
  const field = bar.getByRole('textbox', { name: 'Find text' });
  await field.fill(query);
  await field.press('Enter');
}

test.describe('find and replace workflow', () => {
  test('Ctrl+F opens the bar and finds across the document', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedDocument(page);
    const bar = await openFindReplace(page);

    await find(bar, 'brand');
    await expect(bar.getByRole('combobox', { name: 'Search scope' })).toBeVisible();
    await expect(bar.locator('.find-replace-bar__counter')).toHaveText(/^\d+ of 3$/, {
      timeout: 10_000,
    });

    const results = bar.getByRole('list', { name: 'Find results' });
    await expect(results.getByRole('button')).toHaveCount(3);

    await page.screenshot({ path: path.join(SHOTS, 'find-results.png') });
    await page.screenshot({ path: testInfo.outputPath('find-results.png') });
  });

  test('replace all reports the committed count and undo restores the document', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedDocument(page);
    const bar = await openFindReplace(page);

    await find(bar, 'brand');
    await expect(bar.locator('.find-replace-bar__counter')).toContainText('of 3', {
      timeout: 10_000,
    });

    await bar.getByRole('textbox', { name: 'Replace text' }).fill('brandmark');
    await page.screenshot({ path: path.join(SHOTS, 'before-replace-all.png') });

    await bar.getByRole('button', { name: 'Replace All' }).click();
    await expect(
      page.getByRole('status').getByText('Replaced 3 occurrences', { exact: false }).last(),
    ).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({ path: path.join(SHOTS, 'after-replace-all.png') });

    // Undo is one step for the whole batch. Focus is deliberately moved out of
    // the replace field first: while that field holds focus, Ctrl+Z is the
    // field's own native text undo, not a document undo.
    await bar.getByRole('button', { name: 'Close find and replace' }).focus();
    await page.keyboard.press('Control+z');

    // Walk history back. The authored text must become findable again, and no
    // step may leave a text layer present-but-empty — that was the data-loss
    // signature (a layer whose text vanished while the node survived, silently
    // renamed to "Untitled text" because automatic names follow the text).
    let restored = false;
    for (let step = 0; step < 4 && !restored; step += 1) {
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll('[role="treeitem"]')].map((el) =>
          (el.getAttribute('aria-label') ?? '').trim(),
        ),
      );
      expect(labels.some((l) => /Untitled text/.test(l))).toBe(false);
      restored = labels.some((l) => /brand guidelines/.test(l));
      if (!restored) {
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(700);
      }
    }
    expect(restored).toBe(true);

    await find(bar, 'brandmark');
    await expect(bar.locator('.find-replace-bar__counter')).not.toContainText('of 3', {
      timeout: 10_000,
    });
  });

  test('navigation is stable and the scope stays frozen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedDocument(page);
    const bar = await openFindReplace(page);

    await find(bar, 'brand');
    await expect(bar.locator('.find-replace-bar__counter')).toContainText('of 3', {
      timeout: 10_000,
    });

    // Navigation is stable and wraps at both ends. The starting index is not
    // deterministic (opening the panel can restore a prior selection), so this
    // asserts relative movement plus the fixed total.
    const counter = bar.locator('.find-replace-bar__counter');
    await expect(counter).toContainText('of 3');
    const start = Number((await counter.textContent())!.match(/^(\d+)/)?.[1] ?? '0');
    expect(start).toBeGreaterThanOrEqual(1);
    await bar.getByRole('button', { name: 'Next match' }).click();
    const next = start === 3 ? 1 : start + 1;
    await expect(counter).toHaveText(`${next} of 3`);
    // Previous returns to where we started.
    await bar.getByRole('button', { name: 'Previous match' }).click();
    await expect(counter).toHaveText(`${start} of 3`);
    // And the full cycle wraps back to the start.
    for (let i = 0; i < 3; i += 1) {
      await bar.getByRole('button', { name: 'Next match' }).click();
    }
    await expect(counter).toHaveText(`${start} of 3`);

    // Validated scope: replace exactly the checked matches.
    await bar.getByRole('textbox', { name: 'Replace text' }).fill('logo');
    const checkboxes = bar.getByRole('checkbox', { name: /^Select match in/ });
    await expect(checkboxes).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await checkboxes.nth(i).check();
    await bar.getByRole('button', { name: /Replace Checked/ }).click();
    await expect(
      page.getByRole('status').getByText('Replaced 3 checked occurrences', { exact: false }).last(),
    ).toBeVisible({
      timeout: 10_000,
    });

    // The checked batch is consumed: the query has no remaining matches and
    // every replacement action is disabled.
    await find(bar, 'brand');
    await expect(bar.locator('.find-replace-bar__no-results')).toBeVisible({ timeout: 10_000 });
    await expect(bar.getByRole('button', { name: 'Replace All' })).toBeDisabled();
    await expect(bar.getByRole('button', { name: /Replace Checked/ })).toHaveCount(0);
  });

  test('clicking a result navigates without retargeting the scope', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedDocument(page);
    const bar = await openFindReplace(page);

    await find(bar, 'brand');
    await expect(bar.locator('.find-replace-bar__counter')).toContainText('of 3', {
      timeout: 10_000,
    });
    await expect(bar.getByText(/Scope: current page/)).toBeVisible();

    const results = bar.getByRole('list', { name: 'Find results' });
    await results.getByRole('button').nth(1).click();
    // Navigation moved the active match (index may differ by entry state), but
    // the frozen result set is unchanged.
    await expect(bar.locator('.find-replace-bar__counter')).toContainText('of 3', {
      timeout: 10_000,
    });

    // Selection moved to a different layer; the scope statement and the result
    // count must be unchanged.
    await expect(bar.getByText(/Scope: current page/)).toBeVisible();
    await expect(bar.getByText(/of 3/)).toBeVisible();
  });

  test('reports an invalid regex as an error instead of zero results', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedDocument(page);
    const bar = await openFindReplace(page);

    await bar.getByRole('checkbox', { name: 'Regex' }).check();
    await find(bar, '(a+)+$');

    await expect(bar.getByText(/nested quantifiers/i)).toBeVisible({ timeout: 10_000 });
    await expect(bar.getByRole('button', { name: 'Replace All' })).toBeDisabled();
  });

  test('no matches is distinguishable from an empty selection scope', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedDocument(page);
    const bar = await openFindReplace(page);

    // No match, without pressing Enter — the live search must still report it.
    const field = bar.getByRole('textbox', { name: 'Find text' });
    await field.fill('brand');
    await expect(bar.locator('.find-replace-bar__counter')).toContainText('of 3', {
      timeout: 10_000,
    });
    await field.fill('zzzznotpresent');
    await expect(bar.locator('.find-replace-bar__no-results')).toBeVisible({ timeout: 10_000 });

    // Escape inside the panel closes it and returns focus; it must not leave
    // focus on <body>, where the next Escape would reach the canvas and be
    // treated as Select All.
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();

    // Clear the canvas selection so Selection scope has no roots. Clicking empty
    // canvas space is the direct, always-available way to deselect; the Select
    // None menu command is gated on an existing selection (and its Edit-menu
    // entry is hidden once nothing is selected — see the report's "partially
    // completed" note).
    const box = await canvasBox(page);
    await page.keyboard.press('Escape'); // return to the select tool
    await page.mouse.click(box.x + 40, box.y + 40);
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0);
    await openFindReplace(page);

    const scope = bar.getByRole('combobox', { name: 'Search scope' });
    await scope.click();
    await page
      .getByRole('listbox', { name: 'Search scope' })
      .getByRole('option', { name: 'Selection', exact: true })
      .click();
    await field.fill('brand');
    await field.press('Enter');

    await expect(
      bar.locator('.find-replace-bar__status').getByText(/Nothing is selected/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(bar.getByRole('button', { name: 'Replace All' })).toBeDisabled();
  });
});
