/**
 * Layers panel — workspace-aware projection (2026-09-19).
 *
 * Verifies the panel's per-workspace view over one scene:
 * - workspace quick filters appear only in their workspace,
 * - the Email mobile-hidden badge and filter project `emailSemantics`,
 * - "Select matches" acts on the whole filtered projection,
 * - unpinned row controls reveal on hover/focus without disappearing from
 *   the accessibility tree,
 * - the panel is axe-clean in a workspace-projected state.
 *
 * Real pointer and keyboard input only; no unit-level stand-ins.
 */
import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor, switchWorkspace } from '../shared';

function layerCount(page: Page): Promise<number> {
  return page
    .locator('.layers-panel__count')
    .textContent()
    .then((text) => Number.parseInt(text ?? '0', 10));
}

async function importSvg(page: Page, svg: string, minLayers: number) {
  await page
    .locator('#file-import-input')
    .setInputFiles({ name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await expect.poll(() => layerCount(page), { timeout: 120_000 }).toBeGreaterThanOrEqual(minLayers);
  await page.waitForTimeout(250);
}

/**
 * Import a small donut PNG (same shape the Image Trace spec uses, proven to
 * trace quickly through the TS fallback). Kept local rather than shared: this
 * is the only layers spec that needs a traceable raster.
 */
async function importTraceableImage(page: Page) {
  const imageDataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 160;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 160, 160);
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(80, 80, 55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(80, 80, 22, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL('image/png');
  });
  const tmpFile = path.join('/tmp', `layers-trace-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, Buffer.from(imageDataUrl.split(',')[1] ?? '', 'base64'));
  await page.locator('#file-import-input').setInputFiles(tmpFile);
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach((d) => {
      (d as HTMLDialogElement).close();
    });
  });
  await page.waitForTimeout(300);
  fs.unlinkSync(tmpFile);
}

async function importSimpleShapes(page: Page, count = 6) {
  let body = '';
  for (let i = 0; i < count; i++) {
    body += `<rect id="r${i}" data-name="Layer ${i + 1}" x="${i * 30}" y="10" width="24" height="24" fill="#3a7"/>`;
  }
  await importSvg(
    page,
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80" viewBox="0 0 400 80">${body}</svg>`,
    count,
  );
}

/**
 * Fill the layer search field, tolerating a concurrent agent's edit making
 * this checkout's Vite dev server full-reload mid-test (the page navigates
 * away and the locator must be re-acquired). The retry re-waits for the panel
 * before touching the field again; it never masks an assertion failure,
 * because the fill itself is the only retried step.
 */
async function fillLayerSearch(page: Page, value: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // `<input type="search">` maps to role `searchbox`, not `textbox`.
      await page.getByRole('searchbox', { name: 'Filter layers by name' }).fill(value, {
        timeout: 20_000,
      });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.locator('.layers-panel').waitFor({ state: 'visible', timeout: 120_000 });
      await page.waitForTimeout(500);
    }
  }
}

test.describe('Layers — workspace projection', () => {
  test.describe.configure({ timeout: 240_000 });

  test('quick filters are workspace-specific', async ({ page }) => {
    await navigateToEditor(page);
    await importSimpleShapes(page);

    // Design: components preset only.
    await switchWorkspace(page, 'Design');
    await expect(page.getByRole('button', { name: 'Components' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Threaded text' })).toHaveCount(0);

    // Print: thread and export-region presets.
    await switchWorkspace(page, 'Print');
    await expect(page.getByRole('button', { name: 'Threaded text' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export regions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Components' })).toHaveCount(0);

    // Motion: the animated preset.
    await switchWorkspace(page, 'Motion');
    await expect(page.getByRole('button', { name: 'Animated' })).toBeVisible();

    // Email: the mobile-hidden preset.
    await switchWorkspace(page, 'Email');
    await expect(page.getByRole('button', { name: 'Mobile hidden' })).toBeVisible();
  });

  test('email mobile-hidden state is projected as a badge and a filter', async ({ page }) => {
    await navigateToEditor(page);
    await importSimpleShapes(page);
    await switchWorkspace(page, 'Email');

    // Select the first layer so the Inspector can edit its email semantics.
    await page.locator('.layers-panel__tree [role="treeitem"]:visible').first().click();
    await page.getByRole('tab', { name: 'Email' }).click();
    await page.getByRole('button', { name: 'Enable email template' }).click();

    const hideSwitch = page.getByRole('switch', { name: 'Hide on mobile' });
    await expect(hideSwitch).toBeVisible();
    await hideSwitch.click();

    // The row carries the projected badge (pinned in the Email workspace).
    const badge = page.locator('[data-email-visibility="hide-on-mobile"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('aria-label', 'Hidden on mobile');

    // The accessible name states the same fact for non-visual users.
    const selectedRow = page.locator('[role="treeitem"][aria-selected="true"]').first();
    await expect(selectedRow).toHaveAttribute('aria-label', /hidden on mobile/i);

    // The quick filter narrows the tree to that node.
    await page.getByRole('button', { name: 'Mobile hidden' }).click();
    await expect(page.locator('.layers-panel__filter-badge')).toBeVisible();
    await expect.poll(() => page.locator('[role="treeitem"]:visible').count()).toBe(1);
    // The surviving row is the one carrying the projected badge (virtualized
    // rows re-resolve by position, so assert on the row's own state, not a
    // remembered index).
    await expect(
      page
        .locator('.layers-panel__tree [role="treeitem"]:visible')
        .locator('[data-email-visibility="hide-on-mobile"]'),
    ).toBeVisible();

    // Unclicking restores the full tree.
    await page.getByRole('button', { name: 'Mobile hidden' }).click();
    await expect.poll(() => page.locator('[role="treeitem"]:visible').count()).toBeGreaterThan(1);
  });

  test('trace provenance is a revealed badge that stays in the accessible name', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await importTraceableImage(page);

    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page
      .getByRole('dialog')
      .getByText(/Preset/i)
      .waitFor({ timeout: 10_000 });
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Apply trace' }).click();
    await expect(page.getByText(/Inserted \d+ vector path/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Close dialog' }).first().click({ timeout: 5000 });
    await page.waitForTimeout(300);

    const row = page
      .locator('.layers-panel__tree [role="treeitem"]')
      .filter({ has: page.locator('.layers-row__trace-badge') });
    await expect(row).toHaveCount(1);
    const badge = row.locator('.layers-row__trace-badge');
    const slot = row.locator('[data-badge-group="trace"]');
    // Design pins component/layout/appearance; trace is revealed, not pinned.
    await expect(slot).toHaveAttribute('data-badge-pinned', 'false');
    await expect(badge).toBeHidden();
    await row.hover();
    await expect(badge).toBeVisible();

    // Keyboard focus reveals it too (hover-only functionality would fail
    // WCAG 2.1.1). Moving the pointer away isolates the focus reveal.
    await page.mouse.move(0, 0);
    await row.click();
    await expect(badge).toBeVisible();
    await expect(row).toHaveAttribute('aria-label', /traced artwork/i);

    // Clip a page screenshot rather than `row.screenshot()`: element capture
    // scrolls the virtualized row into view and can drop the reveal the shot
    // is meant to document. The row is focus-revealed here, so no hover
    // tooltip obscures the badge.
    const rowBox = await row.boundingBox();
    if (!rowBox) throw new Error('trace row has no box');
    await fs.promises.mkdir('reports/layers-evolution/after', { recursive: true });
    await page.screenshot({
      path: 'reports/layers-evolution/after/trace-badge-row.png',
      clip: rowBox,
    });
  });

  test('Select matches selects the whole filtered projection in one action', async ({ page }) => {
    await navigateToEditor(page);
    await importSimpleShapes(page, 6);
    await switchWorkspace(page, 'Design');

    await fillLayerSearch(page, 'Layer');
    await expect(page.locator('.layers-filter-bar__count')).toContainText('6 of 6 layers');

    await page.getByRole('button', { name: 'Select matches' }).click();
    await expect(page.locator('.editor-status__info')).toContainText('6');
    await expect(page.locator('.editor-status__info')).toContainText('selected');

    // Clearing the filter keeps the selection (selection is not the filter).
    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page.locator('.editor-status__info')).toContainText('selected');
  });

  test('unpinned row controls reveal on hover without leaving the a11y tree', async ({ page }) => {
    await navigateToEditor(page);
    await importSimpleShapes(page);
    await switchWorkspace(page, 'Design');

    const row = page.locator('.layers-panel__tree [role="treeitem"]:visible').first();
    const solo = row.locator('[data-row-action="solo"]');

    // Design does not pin solo: it keeps its slot but is not hit-testable
    // until the row is hovered or holds focus.
    await expect(solo).toHaveAttribute('data-row-action-pinned', 'false');
    expect(await solo.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    expect(await solo.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

    await row.hover();
    await expect.poll(() => solo.evaluate((el) => getComputedStyle(el).opacity)).not.toBe('0');

    // Photo pins it, so it is visible without hover.
    await switchWorkspace(page, 'Photo');
    const photoRow = page.locator('.layers-panel__tree [role="treeitem"]:visible').first();
    await expect(photoRow.locator('[data-row-action="solo"]')).toHaveAttribute(
      'data-row-action-pinned',
      'true',
    );
    await expect
      .poll(() =>
        photoRow.locator('[data-row-action="solo"]').evaluate((el) => getComputedStyle(el).opacity),
      )
      .not.toBe('0');
  });

  test('workspace quick filter chips are keyboard operable toggle buttons', async ({ page }) => {
    await navigateToEditor(page);
    await importSimpleShapes(page);
    await switchWorkspace(page, 'Print');

    const chip = page.getByRole('button', { name: 'Threaded text' });
    await chip.focus();
    await expect(chip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  test('workspace-projected panel state is axe-clean', async ({ page }) => {
    await navigateToEditor(page);
    await importSimpleShapes(page);
    await switchWorkspace(page, 'Print');
    await page.getByRole('button', { name: 'Threaded text' }).click();

    const results = await new AxeBuilder({ page })
      .include('.layers-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
