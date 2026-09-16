/**
 * Typography + Insights review — real-world rendered validation.
 *
 * Scope: the Design tab's Typography section (progressive disclosure,
 * descriptive controls, OpenType behavior) and the document-level Insights
 * section (human tab labels, applicability gating, honest review actions).
 *
 * Uses the same real-world document as design-tab-audit.spec.ts: frame,
 * drawn rectangle, live text layer, imported real photograph. Findings and
 * rationale: docs/research/typography-insights-ux-research-2026-09-16.md.
 */
import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const REAL_PHOTO = path.resolve('tests/e2e/fixtures/real-life-still-life.jpg');

async function createFrame(page: Page): Promise<void> {
  await page.keyboard.press('f');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.click({ position: { x: 640, y: 380 } });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
}

async function drawRect(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 260, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });
}

async function createText(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 220, box.y + 460);
  const inline = page.getByRole('textbox', { name: /editing text/i });
  await inline.waitFor({ timeout: 10_000 });
  await page.keyboard.type('Quarterly report');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 10_000 });
}

async function importPhoto(page: Page): Promise<void> {
  await page.locator('#file-import-input').setInputFiles(REAL_PHOTO);
  await expect(page.getByRole('treeitem')).toHaveCount(4, { timeout: 20_000 });
}

async function seedRealWorldDocument(page: Page): Promise<void> {
  await navigateToEditor(page);
  await createFrame(page);
  await drawRect(page);
  await createText(page);
  await importPhoto(page);
}

async function openDesignTab(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Design' }).click();
  const panel = page.locator('#insp-tabpanel-properties');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel;
}

/**
 * Click a Layers row and make sure the selection actually landed on it.
 *
 * The layers panel animates its reveal when the canvas selection changes, so a
 * single click measured before that scroll settles can land on the adjacent
 * row. Retrying the click + selected assertion is deterministic where a bare
 * click is a coin flip.
 */
async function clickLayerRow(page: Page, pattern: RegExp): Promise<void> {
  const row = page.getByRole('treeitem').filter({ hasText: pattern }).first();
  await row.waitFor({ timeout: 10_000 });
  await expect(async () => {
    await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

async function selectTextLayer(page: Page): Promise<void> {
  await clickLayerRow(page, /Quarterly/);
}

/** Top-level inspector section whose disclosure trigger has the given title. */
function sectionByTitle(page: Page, title: string): Locator {
  return page
    .locator('#insp-tabpanel-properties section.insp-disclosure')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
}

async function expandSection(page: Page, title: string): Promise<Locator> {
  const section = sectionByTitle(page, title).first();
  // Target the section's own disclosure trigger, not a same-named button in
  // the contextual bar or a nested subsection header.
  const trigger = section.locator('.insp-disclosure__header .insp-disclosure__trigger').first();
  await trigger.waitFor({ timeout: 10_000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
  }
  return section;
}

async function expandSubsection(section: Locator, title: string): Promise<void> {
  const trigger = section.getByRole('button', { name: title, exact: true }).first();
  await trigger.waitFor({ timeout: 10_000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
  }
}

test.describe('Typography section review', () => {
  test.describe.configure({ retries: 1 });

  test('keeps the common spine visible and compresses rare controls', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectTextLayer(page);
    await openDesignTab(page);
    const typography = await expandSection(page, 'Typography');

    // Primary spine is rendered and reachable without expanding anything.
    for (const label of ['Text content', 'Font weight', 'Size (px)', 'Line height (%)']) {
      await expect(typography.getByLabel(label).first()).toBeVisible();
    }
    await expect(typography.getByRole('radiogroup', { name: 'Font style' })).toBeVisible();
    await expect(typography.getByRole('radiogroup', { name: 'Horizontal align' })).toBeVisible();
    await expect(typography.getByLabel('Letter spacing (px)')).toBeVisible();

    // Rare controls are not mounted until the subsection is opened.
    await expect(typography.getByText('Paragraph spacing')).toHaveCount(0);
    await expect(typography.getByRole('radiogroup', { name: 'Text case' })).toHaveCount(0);

    await typography.scrollIntoViewIfNeeded();
    await typography.screenshot({ path: testInfo.outputPath('typography-default.png') });

    // Alignment options carry descriptive names, not single letters.
    for (const name of ['Align left', 'Align center', 'Align right', 'Justify']) {
      await expect(typography.getByRole('radio', { name })).toBeVisible();
    }

    await expandSubsection(typography, 'Advanced typography');
    await expect(
      typography.getByRole('spinbutton', { name: 'Paragraph spacing (px)' }),
    ).toBeVisible();
    await expect(typography.getByRole('radiogroup', { name: 'Text case' })).toBeVisible();
    await expect(typography.getByRole('radiogroup', { name: 'Text direction' })).toBeVisible();
    // The seeded text layer is point text (no container), so vertical
    // alignment is absent rather than an inert control.
    await expect(typography.getByRole('radiogroup', { name: 'Text vertical align' })).toHaveCount(
      0,
    );
    // Orientation is hidden while the text is horizontal.
    await expect(
      typography.getByRole('combobox', { name: 'Vertical text orientation' }),
    ).toHaveCount(0);

    await typography.screenshot({ path: testInfo.outputPath('typography-advanced.png') });
  });

  test('a tracking edit surfaces the advanced badge and persists', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectTextLayer(page);
    await openDesignTab(page);
    const typography = await expandSection(page, 'Typography');
    await expandSubsection(typography, 'Advanced typography');

    const tracking = typography.getByRole('spinbutton', { name: 'Tracking (‰)' });
    await tracking.fill('80');
    await page.keyboard.press('Enter');
    await expect.poll(async () => Number.parseFloat(await tracking.inputValue())).toBe(80);

    // The collapsed-header badge reports the non-default advanced property.
    await expect(typography.locator('.typography__count')).toHaveText('1 set');
    await typography.screenshot({ path: testInfo.outputPath('typography-badge.png') });

    // Leave and return: the value comes from the document, not field state.
    await clickLayerRow(page, /Rectangle/);
    await selectTextLayer(page);
    await openDesignTab(page);
    const typographyAgain = await expandSection(page, 'Typography');
    await expandSubsection(typographyAgain, 'Advanced typography');
    await expect
      .poll(async () =>
        Number.parseFloat(
          await typographyAgain.getByRole('spinbutton', { name: 'Tracking (‰)' }).inputValue(),
        ),
      )
      .toBe(80);
  });

  test('OpenType features use labelled controls and hide required tags', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectTextLayer(page);
    await openDesignTab(page);
    const typography = await expandSection(page, 'Typography');
    await expandSubsection(typography, 'OpenType features');

    const openType = typography.locator('.insp-opentype-list');
    await expect(openType).toBeVisible({ timeout: 10_000 });

    // Required shaping tags are never offered as inert rows.
    await expect(typography.getByText('required for script shaping')).toHaveCount(0);
    await expect(typography.locator('.insp-opentype-row', { hasText: 'rlig' })).toHaveCount(0);

    // Every feature control is the shared accessible combobox, not a native select.
    expect(await typography.locator('.insp-opentype-row select').count()).toBe(0);
    const firstRow = typography.locator('.insp-opentype-row').first();
    await expect(firstRow.getByRole('combobox')).toBeVisible();

    await typography.screenshot({ path: testInfo.outputPath('typography-opentype.png') });
  });

  test('font picker popover opens, is labelled, and closes on Escape', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectTextLayer(page);
    await openDesignTab(page);
    const typography = await expandSection(page, 'Typography');

    const picker = typography.getByRole('combobox', { name: 'Font family' });
    await picker.click();
    const listbox = page.getByRole('listbox', { name: 'Font families' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await typography.screenshot({ path: testInfo.outputPath('typography-font-picker.png') });

    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
  });
});

test.describe('Insights section review', () => {
  test.describe.configure({ retries: 1 });

  test('uses human tab labels and hides tabs the selection cannot use', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectTextLayer(page);
    await openDesignTab(page);
    const insights = await expandSection(page, 'Insights');

    const tablist = insights.getByRole('tablist', { name: 'Intelligence tabs' });
    await expect(tablist.getByRole('tab', { name: 'Review' })).toBeVisible({ timeout: 10_000 });
    await expect(tablist.getByRole('tab', { name: 'Contrast' })).toBeVisible();
    // Single text layer: Spacing (needs 2+ layers) and Auto layout (needs a
    // frame) are absent rather than opening onto a dead end.
    await expect(tablist.getByRole('tab', { name: 'Spacing' })).toHaveCount(0);
    await expect(tablist.getByRole('tab', { name: 'Auto layout' })).toHaveCount(0);

    await insights.scrollIntoViewIfNeeded();
    await insights.screenshot({ path: testInfo.outputPath('insights-text-selection.png') });
  });

  test('shows Spacing once two layers are selected and keeps Review available', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.click({ position: { x: 640, y: 380 } });
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+a');
    await openDesignTab(page);
    const insights = await expandSection(page, 'Insights');

    const tablist = insights.getByRole('tablist', { name: 'Intelligence tabs' });
    await expect(tablist.getByRole('tab', { name: 'Review' })).toBeVisible({ timeout: 10_000 });
    // In Design, Spacing is a target-driven analysis tool in the More menu
    // (the workspace treats spacing as secondary). It must be reachable there
    // rather than absent.
    await insights.getByRole('button', { name: /more intelligence tabs/i }).click();
    const spacingItem = page.getByRole('menuitem', { name: /spacing/i });
    await expect(spacingItem).toBeVisible({ timeout: 5_000 });
    await spacingItem.click();
    await expect(insights.getByRole('button', { name: 'Analyze' })).toBeVisible({
      timeout: 10_000,
    });

    await insights.scrollIntoViewIfNeeded();
    await insights.screenshot({ path: testInfo.outputPath('insights-multi-selection.png') });
  });

  test('never presents a dead Auto-fix action in the Review tab', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectTextLayer(page);
    await openDesignTab(page);
    const insights = await expandSection(page, 'Insights');

    // Wait for the review scan to produce its result surface: the summary
    // always renders "Total" once the scan finishes (the empty state renders
    // its own message instead).
    await expect(insights.getByRole('tab', { name: 'Review' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(insights.getByText(/No issues found|^Total$/).first()).toBeVisible({
      timeout: 30_000,
    });

    // The review finding rows previously offered an Auto-fix button that only
    // announced a message. No such control may exist in the Review panel.
    await expect(insights.getByRole('button', { name: /auto-fix/i })).toHaveCount(0);
  });
});
