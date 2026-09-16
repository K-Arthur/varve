import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Export tab (Inspector) — real-world diagnosis.
 *
 * Uses the committed real-photo fixture (1920x1280 CC0 architecture photo) plus
 * vector/text layers so the export surfaces run against a realistic document
 * rather than an empty rect. This spec doubles as the permanent regression
 * suite for the Export tab: every assertion describes behavior the tab must
 * hold in production.
 */

const PHOTO = path.resolve('tests/e2e/fixtures/real-life-architecture.jpg');

async function selectExportTab(page: Page) {
  // A contextual tab (Adjustments for an image selection) can push Export into
  // the inspector's More overflow menu at 1280px. Reach it the way a user would.
  const exportTab = page.locator(
    '[role="tablist"][aria-label="Inspector tabs"] button[role="tab"]',
    {
      hasText: /^export$/i,
    },
  );
  if ((await exportTab.count()) === 0 || !(await exportTab.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /More inspector tabs/i }).click();
    await page.getByRole('menuitem', { name: /^Export$/i }).click();
  } else {
    await exportTab.click();
  }
  await page.locator('#insp-sub-tab-format').waitFor({ state: 'visible', timeout: 10000 });
}

async function importPhoto(page: Page) {
  await page.locator('#file-import-input').setInputFiles(PHOTO);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 20000 });
  const item = page.getByRole('treeitem').first();
  await item.click();
  await expect(item).toContainText(/architecture/i);
  return item;
}

async function setInspectorWidth(page: Page, px: number) {
  await page.evaluate((width) => {
    const shell = document.querySelector('.editor-shell') as HTMLElement | null;
    shell?.style.setProperty('--inspector-width', `${width}px`);
  }, px);
}

async function addDropShadow(page: Page) {
  // Design tab → Layer Effects → add a Drop Shadow. SVG cannot express the
  // effect, so the export must fall back to a rasterized subtree.
  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  const section = page.locator('.insp-disclosure').filter({ hasText: 'Layer Effects' });
  await expect(section).toBeVisible({ timeout: 15000 });
  const trigger = section.getByRole('button', { name: 'Layer Effects', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  // The effect picker is a menu button (aria-haspopup="menu"), not a combobox.
  await section.getByRole('button', { name: 'New effect type' }).click();
  await page.getByRole('menuitem', { name: 'Drop Shadow', exact: true }).click();
  await section.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    section.locator('.insp-effect-row').filter({ hasText: 'Drop Shadow' }),
  ).toBeVisible();
}

async function drawRect(page: Page) {
  await page.keyboard.press('r');
  await page.mouse.move(540, 200);
  await page.mouse.down();
  await page.mouse.move(720, 330, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
}

test.describe('Export tab — real-world scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('photo document: quick export PNG 2x produces real bytes at 2x dimensions', async ({
    page,
  }, testInfo) => {
    await importPhoto(page);
    await selectExportTab(page);

    // The advisor must not default a 1920x1280 JPEG photo to SVG.
    await expect(page.getByRole('radio', { name: 'JPEG', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await page.getByRole('radio', { name: 'PNG', exact: true }).click();
    await page.getByRole('radio', { name: /^2x$/i }).click();
    await page.getByRole('button', { name: /Add configuration/ }).click();
    await expect(page.locator('.spec-export__preset-row')).toHaveCount(1);
    await expect(page.locator('.spec-export__preset-file')).toContainText(
      'real-life-architecture@2x.png',
    );
    await page
      .locator('.insp-panel')
      .first()
      .screenshot({ path: testInfo.outputPath('01-export-tab-default.png') });

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('.spec-export__download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('real-life-architecture@2x.png');

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    // PNG IHDR: width at offset 16, height at offset 20 (big-endian).
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect({ width, height }).toEqual({ width: 1920 * 2, height: 1280 * 2 });

    await expect(page.locator('.spec-export__message')).toContainText(/exported|downloaded/i);
  });

  test('multi-selection: the tab states which object will be exported', async ({
    page,
  }, testInfo) => {
    await importPhoto(page);
    await drawRect(page);

    await page.getByRole('treeitem').first().click();
    await page
      .getByRole('treeitem')
      .nth(1)
      .click({ modifiers: ['Control'] });

    await selectExportTab(page);
    // An explicit, accessible statement that only the active object exports,
    // plus the batch route for the rest of the selection.
    const note = page.locator('.spec-export__selection-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText(/exports one object at a time/i);
    await expect(note).toContainText('2 layers are selected');
    await expect(note.getByRole('button', { name: /Export all 2 selected layers/ })).toBeVisible();
    await page
      .locator('.insp-panel')
      .first()
      .screenshot({ path: testInfo.outputPath('02-multi-selection-note.png') });
  });

  test('custom scale rejects non-finite and out-of-range values', async ({ page }, testInfo) => {
    await importPhoto(page);
    await selectExportTab(page);
    const download = page.locator('.spec-export__download');
    const error = page.locator('.spec-export__scale-error');

    // Custom is a scale option; choosing it reveals the field seeded with the
    // scale currently in force (so the output does not change silently).
    await page.getByRole('radio', { name: 'Custom', exact: true }).click();
    const input = page.locator('.spec-export__input');
    await expect(input).toBeVisible();
    await expect(download).toBeEnabled();

    // Browsers may keep a syntactically valid exponent in a number input; when
    // they do, it must never reach the rasterizer as Infinity.
    await input.fill('1e999');
    if ((await input.inputValue()) !== '') {
      await expect(download).toBeDisabled();
      await expect(error).toBeVisible();
    }

    await input.fill('-5');
    await expect(download).toBeDisabled();
    await expect(error).toContainText(/Minimum scale is 0\.1x/);

    await input.fill('0');
    await expect(download).toBeDisabled();
    await expect(error).toBeVisible();

    await input.fill('999999');
    await expect(download).toBeDisabled();
    await expect(error).toContainText(/Maximum scale is 10x/);
    await page
      .locator('.insp-panel')
      .first()
      .screenshot({ path: testInfo.outputPath('03-scale-error.png') });

    await input.fill('2.5');
    await expect(download).toBeEnabled();
    await expect(error).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Custom' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page
      .locator('.insp-panel')
      .first()
      .screenshot({ path: testInfo.outputPath('03b-custom-scale-valid.png') });

    // Returning to a preset clears the draft and hides the field.
    await page.getByRole('radio', { name: '1x', exact: true }).click();
    await expect(page.locator('.spec-export__input')).toHaveCount(0);
  });

  test('suffix edit is a single undo step, and undo restores the filename', async ({ page }) => {
    await importPhoto(page);
    await selectExportTab(page);
    await page.getByRole('button', { name: 'PNG 2x' }).click();
    const suffix = page.getByLabel(/Filename suffix for real-life-architecture@2x\.png/);
    await expect(suffix).toHaveValue('@2x');

    await suffix.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('-display');
    await expect(suffix).toHaveValue('-display');
    // Commit the edit the way a user does before undoing: leave the field.
    await page.locator('#spec-export-heading').click();

    // One undo must revert the whole typed suffix, not one character.
    await page.keyboard.press('Control+Z');
    await expect(suffix).toHaveValue('@2x');
  });

  test('narrow inspector (240px min) keeps every quick-format control reachable', async ({
    page,
  }, testInfo) => {
    await importPhoto(page);
    await selectExportTab(page);
    await setInspectorWidth(page, 240);
    await page.waitForTimeout(250);
    const panelWidth = await page
      .locator('.editor__inspector-panel')
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(panelWidth).toBeLessThanOrEqual(241);

    const clipped = await page.evaluate(() => {
      const root = document.querySelector('.spec-export__group');
      if (!root) return null;
      const rootBox = root.getBoundingClientRect();
      const buttons = Array.from(root.querySelectorAll('button'));
      return buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return {
          label: button.textContent?.trim(),
          right: box.right,
          visibleRight: Math.min(box.right, rootBox.right),
          fullyVisible: box.right <= rootBox.right + 0.5 && box.width > 0,
        };
      });
    });
    await page
      .locator('.insp-panel')
      .first()
      .screenshot({ path: testInfo.outputPath('04-export-narrow-240.png') });
    // "Before" equivalent for the container query: disabling the query
    // container restores the pre-fix single-line row at 240px, which clipped
    // the trailing format buttons behind the group's overflow.
    await page.evaluate(() => {
      const panel = document.querySelector('.editor__inspector-panel') as HTMLElement | null;
      if (panel) panel.style.containerType = 'normal';
    });
    await page.waitForTimeout(150);
    await page
      .locator('.insp-panel')
      .first()
      .screenshot({ path: testInfo.outputPath('04b-narrow-before-container-query.png') });
    await page.evaluate(() => {
      const panel = document.querySelector('.editor__inspector-panel') as HTMLElement | null;
      if (panel) panel.style.containerType = '';
    });
    await page.waitForTimeout(150);
    expect(clipped).not.toBeNull();
    for (const button of clipped ?? []) {
      expect(button, `format control ${button.label} must not be clipped at 240px`).toMatchObject({
        fullyVisible: true,
      });
    }

    // The download action must remain reachable too.
    await expect(page.locator('.spec-export__download')).toBeInViewport();
  });

  test('stale export message clears when the selected object changes', async ({ page }) => {
    await importPhoto(page);
    await selectExportTab(page);
    await page.getByRole('radio', { name: /^1x$/i }).click();
    await page.locator('.spec-export__download').click();
    await expect(page.locator('.spec-export__message')).toContainText(/exported|downloaded/i);

    // Switch to another object: the message must not keep claiming the old one.
    await drawRect(page);
    await expect(page.locator('.spec-export__message')).toHaveCount(0);
  });

  test('code sub-tab exposes keyboard-scrollable generated code', async ({ page }, testInfo) => {
    await importPhoto(page);
    await selectExportTab(page);
    await page.getByRole('tab', { name: 'Code' }).click();
    await expect(page.locator('#spec-code-heading')).toBeVisible();

    const pre = page.locator('.spec-codegen__pre');
    await expect(pre).toHaveAttribute('tabindex', '0');
    await pre.click();
    await expect(pre).toBeFocused();
    await page
      .locator('.insp-panel')
      .first()
      .screenshot({ path: testInfo.outputPath('05-code-tab.png') });
  });

  test('SVG copy and SVG download contain the same markup for an effects object', async ({
    page,
  }, testInfo) => {
    await importPhoto(page);
    await drawRect(page);
    await addDropShadow(page);

    await selectExportTab(page);
    // Scope to the quick-format row: the configurations section also has an
    // "SVG" quick-preset button.
    await page
      .locator('.spec-export__group')
      .first()
      .getByRole('radio', { name: 'SVG', exact: true })
      .click();

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('.spec-export__download').click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const downloaded = Buffer.concat(chunks).toString('utf8');

    const copyButton = page.getByRole('button', { name: /copy svg markup/i });
    await expect(copyButton).toBeEnabled({ timeout: 30000 });
    await copyButton.click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.trim().length).toBeGreaterThan(0);
    expect(clipboard).toBe(downloaded);

    // The effect cannot be expressed natively: both outputs must carry the
    // rasterized fallback, not silently drop the shadow.
    expect(downloaded).toContain('data:image/png;base64,');
    expect(clipboard).toContain('data:image/png;base64,');
    await page
      .locator('.insp-panel')
      .first()
      .screenshot({ path: testInfo.outputPath('07-svg-effects-parity.png') });
  });

  test('200% text-size preference keeps export controls operable', async ({ page }, testInfo) => {
    await importPhoto(page);
    await selectExportTab(page);
    await setInspectorWidth(page, 240);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.waitForTimeout(250);
    await page
      .locator('.insp-panel')
      .first()
      .screenshot({ path: testInfo.outputPath('06-text-200.png') });

    // Labels and the primary action remain visible and operable. At 200% text
    // in a 240px column the action can sit below the fold of the scrollable
    // panel; reaching it by scrolling is acceptable, being clipped or missing
    // is not.
    const download = page.locator('.spec-export__download');
    await expect(download).toBeVisible();
    await download.scrollIntoViewIfNeeded();
    await expect(download).toBeInViewport();
    await expect(download).toBeEnabled();
    await expect(page.getByText('Quick export')).toBeVisible();

    // Enlarged text must not push the format/scale controls out of the panel
    // horizontally (the wrapped segmented group stays inside its row).
    const overflow = await page.evaluate(() => {
      const panel = document.querySelector('#insp-tabpanel-export') as HTMLElement | null;
      const group = document.querySelector('.spec-export__group');
      const row = group?.closest('.spec-export__row');
      return {
        panel: panel ? panel.scrollWidth - panel.clientWidth : -1,
        group:
          group && row
            ? group.getBoundingClientRect().right - row.getBoundingClientRect().right
            : -1,
      };
    });
    expect(overflow.panel).toBeLessThanOrEqual(1);
    expect(overflow.group).toBeLessThanOrEqual(1);
  });

  test('compact inspector drawer keeps the export controls operable', async ({
    page,
  }, testInfo) => {
    await importPhoto(page);
    // Below 900px the inspector is a drawer/sheet opened from its FAB. The
    // Export tab must stay fully usable there, not just in the docked panel.
    await page.setViewportSize({ width: 640, height: 700 });
    const fab = page.locator('.editor__fab--inspector');
    const panel = page.locator('.editor__inspector-panel');
    await fab.click();
    await expect(panel).toHaveAttribute('data-visible', 'true');
    await expect(panel).toHaveAttribute('role', 'dialog');

    await selectExportTab(page);
    await expect(page.getByRole('radio', { name: 'JPEG', exact: true })).toBeVisible();
    await page.getByRole('radio', { name: '2x', exact: true }).click();

    const download = page.locator('.spec-export__download');
    await download.scrollIntoViewIfNeeded();
    await expect(download).toBeVisible();
    await expect(download).toBeEnabled();
    await panel.screenshot({ path: testInfo.outputPath('08-compact-drawer.png') });

    // The drawer's own dismissal contract is unchanged by this tab.
    await page.keyboard.press('Escape');
    await expect(panel).not.toHaveAttribute('data-visible');
    await expect(fab).toBeFocused();
  });
});
