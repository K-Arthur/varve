import { mkdirSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor, switchWorkspace } from '../shared';

const REVIEW_DIR = path.resolve('reports/ui-review/adjustments-tab-2026-09-17');
const IMAGE_FIXTURE = path.resolve('tests/e2e/fixtures/test-image.png');

async function openAdjustmentsTab(page: Page) {
  const tab = page.getByRole('tab', { name: 'Adjustments', exact: true });
  await tab.waitFor({ state: 'visible', timeout: 15000 });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  // The panel body is lazy-loaded; wait for the section composition to land
  // before measuring or screenshotting, otherwise the Suspense fallback
  // ("Loading adjustments…") is what gets captured.
  await page.locator('#insp-tabpanel-adjustments .insp-disclosure').first().waitFor({
    state: 'visible',
    timeout: 30000,
  });
}

async function panelMetrics(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('#insp-tabpanel-adjustments');
    if (!panel) return null;
    const style = getComputedStyle(panel);
    return {
      clientWidth: panel.clientWidth,
      scrollWidth: panel.scrollWidth,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      overflowY: style.overflowY,
      padding: style.padding,
      gap: style.gap,
    };
  });
}

async function sectionInventory(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('#insp-tabpanel-adjustments');
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>('.insp-disclosure')).map((section) => {
      const trigger = section.querySelector<HTMLElement>('.insp-disclosure__trigger');
      const content = section.querySelector<HTMLElement>('.insp-disclosure__content');
      return {
        sectionId: section.dataset.sectionId ?? null,
        title: trigger?.textContent?.trim() ?? '',
        expanded: trigger?.getAttribute('aria-expanded') ?? null,
        height: Math.round(section.getBoundingClientRect().height),
        contentHeight: content ? Math.round(content.getBoundingClientRect().height) : null,
      };
    });
  });
}

test.describe('adjustments tab audit', () => {
  test.beforeAll(() => {
    mkdirSync(REVIEW_DIR, { recursive: true });
  });

  test('empty selection shows a truthful empty state in Photo mode', async ({ page }) => {
    test.setTimeout(180000);
    await navigateToEditor(page);
    // The Adjustments tab is contextual outside Photo mode: with nothing
    // selected in Design there is no tab to open. Photo mode always exposes it.
    await switchWorkspace(page, 'Photo');
    await expect(page.getByRole('tab', { name: 'Adjustments', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Adjustments', exact: true }).click();
    // The lazy panel resolves to the empty state here (no sections), so wait
    // for its copy rather than for a disclosure.
    await page
      .getByText('Select an image or adjustment layer', { exact: true })
      .waitFor({ state: 'visible', timeout: 30000 });
    await page.screenshot({ path: path.join(REVIEW_DIR, '01-empty.png') });
    // eslint-disable-next-line no-console
    console.log('empty panel metrics', await panelMetrics(page));
    const empty = page.locator('#insp-tabpanel-adjustments');
    await expect(empty).toContainText('Select an image or adjustment layer');
  });

  test('image selection shows every raster section', async ({ page }) => {
    test.setTimeout(180000);
    await navigateToEditor(page);
    await page.locator('#file-import-input').setInputFiles(IMAGE_FIXTURE);
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await openAdjustmentsTab(page);

    const inventory = await sectionInventory(page);
    // eslint-disable-next-line no-console
    console.log('image section inventory', JSON.stringify(inventory, null, 2));

    await page.screenshot({ path: path.join(REVIEW_DIR, '02-image-top.png') });
    const panel = page.locator('#insp-tabpanel-adjustments');
    const metrics = await panelMetrics(page);
    if (!metrics) throw new Error('adjustments panel missing');
    const steps = Math.ceil(metrics.scrollHeight / Math.max(1, metrics.clientHeight));
    for (let step = 1; step < Math.min(steps, 8); step += 1) {
      await panel.evaluate((element, index) => {
        element.scrollTop = index * element.clientHeight;
      }, step);
      await page.waitForTimeout(150);
      await page.screenshot({
        path: path.join(REVIEW_DIR, `02-image-scroll-${String(step).padStart(2, '0')}.png`),
      });
    }
    await panel.evaluate((element) => {
      element.scrollTop = 0;
    });

    const axe = await new AxeBuilder({ page })
      .include('#insp-tabpanel-adjustments')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    // eslint-disable-next-line no-console
    console.log('image panel axe violations', JSON.stringify(axe.violations, null, 2));
    expect(
      axe.violations,
      axe.violations
        .map(
          (violation) =>
            `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
        )
        .join('\n'),
    ).toEqual([]);
  });

  test('vector selection shows adjustment-layer access, studio, and effects', async ({ page }) => {
    test.setTimeout(180000);
    await navigateToEditor(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 140, 430, 340);
    await openAdjustmentsTab(page);

    const inventory = await sectionInventory(page);
    // eslint-disable-next-line no-console
    console.log('vector section inventory', JSON.stringify(inventory, null, 2));
    // Layer Effects must be the same registry-managed section object in both
    // compositions; otherwise collapse/hide state drifts between tabs.
    expect(inventory.find((section) => section.title === 'Layer Effects')?.sectionId).toBe(
      'effects',
    );
    await page.screenshot({ path: path.join(REVIEW_DIR, '03-vector.png') });
  });

  test('adjustment layer panel and its add dialog', async ({ page }) => {
    test.setTimeout(180000);
    await navigateToEditor(page);
    await page.getByRole('menuitem', { name: /^Object$/i }).click();
    await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
    await expect(page.locator('.adj-panel__header-name')).toHaveText('Adjustment Filters');

    await page.screenshot({ path: path.join(REVIEW_DIR, '04-adjustment-panel.png') });
    // eslint-disable-next-line no-console
    console.log('adjustment panel metrics', await panelMetrics(page));

    // Spacing rhythm between the panel's direct children (evidence for the
    // spacing review; also catches a collapsed or doubled gap).
    // eslint-disable-next-line no-console
    console.log(
      'adjustment panel rhythm',
      await page.locator('.adj-panel').evaluate((panel) => {
        const children = Array.from(panel.children) as HTMLElement[];
        return children.map((child, index) => {
          const previous = children[index - 1];
          const rect = child.getBoundingClientRect();
          return {
            className: child.className.split(' ')[0],
            height: Math.round(rect.height),
            gapFromPrevious: previous
              ? Math.round(rect.top - previous.getBoundingClientRect().bottom)
              : null,
          };
        });
      }),
    );

    const addButton = page.getByRole('button', { name: /add adjustment/i });
    await addButton.click();
    const addMenu = page.getByRole('menu', { name: 'Add adjustment' });
    await expect(addMenu).toBeVisible();
    // A popover picker must not dim the app or cover the canvas: anchored,
    // viewport-capped, and non-modal.
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.screenshot({ path: path.join(REVIEW_DIR, '05-add-adjustment-menu.png') });
    // eslint-disable-next-line no-console
    console.log(
      'add menu',
      await addMenu.evaluate((element) => ({
        width: Math.round(element.getBoundingClientRect().width),
        height: Math.round(element.getBoundingClientRect().height),
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflow: getComputedStyle(element).overflowY,
        items: element.querySelectorAll('[role="menuitem"]').length,
      })),
    );
    // Type-ahead must reach a filter without scrolling ("le" matches Levels,
    // not LUT).
    await page.keyboard.press('l');
    await page.keyboard.press('e');
    await expect(page.getByRole('menuitem', { name: /^Levels$/ })).toBeFocused();
    await page.keyboard.press('Escape');

    await addButton.click();
    await page.getByRole('menuitem', { name: /^Levels$/ }).click();
    await page.screenshot({ path: path.join(REVIEW_DIR, '06-levels-editor.png') });

    // Layer opacity is a percent field here, matching the Design tab's
    // Appearance section and every effect-opacity row below it.
    const layerOpacity = page.getByRole('spinbutton', { name: 'Opacity (%)' });
    await expect(layerOpacity).toBeVisible();
    await expect(layerOpacity).toHaveValue('100');

    // Scope preview is a real modal: focus moves inside, Escape cancels, and
    // no scope change is committed until Apply.
    const scopeSelect = page.getByRole('combobox', { name: 'Adjustment scope mode' });
    await scopeSelect.click();
    await page.getByRole('option', { name: 'Document (global)' }).click();
    const impactDialog = page.getByRole('dialog', { name: 'Adjustment Impact' });
    await expect(impactDialog).toBeVisible();
    await expect(impactDialog).toContainText('This adjustment will affect:');
    await expect(impactDialog).not.toContainText('(s)');
    await page.screenshot({ path: path.join(REVIEW_DIR, '07-scope-impact-dialog.png') });
    await page.keyboard.press('Escape');
    await expect(impactDialog).toBeHidden();

    const editor = page.locator('.adj-panel__editor');
    // eslint-disable-next-line no-console
    console.log('levels editor text', (await editor.innerText()).slice(0, 1200));
    // eslint-disable-next-line no-console
    console.log(
      'levels editor rows',
      await editor.evaluate((element) =>
        Array.from(element.querySelectorAll<HTMLElement>('.adj-editor__row')).map((row) => ({
          label: row.querySelector('.adj-editor__label')?.textContent?.trim() ?? null,
          height: Math.round(row.getBoundingClientRect().height),
        })),
      ),
    );

    // No label in the light theme may be clipped: the adjusted-surface
    // contract requires the full word, not "Affected target".
    const clippedLabels = await page.locator('#insp-tabpanel-adjustments').evaluate((panel) =>
      Array.from(panel.querySelectorAll<HTMLElement>('.insp-field__label'))
        .filter(
          (element) =>
            getComputedStyle(element).whiteSpace === 'nowrap' &&
            element.scrollWidth > element.clientWidth + 1,
        )
        .map((element) => element.textContent?.trim() ?? ''),
    );
    expect(clippedLabels).toEqual([]);

    const axe = await new AxeBuilder({ page })
      .include('#insp-tabpanel-adjustments')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    // eslint-disable-next-line no-console
    console.log('adjustment layer axe violations', JSON.stringify(axe.violations, null, 2));
    expect(
      axe.violations,
      axe.violations
        .map(
          (violation) =>
            `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
        )
        .join('\n'),
    ).toEqual([]);
  });
});
