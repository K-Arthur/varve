import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Layout overrides are visible and reversible through the real Design workspace.
 *
 * The flow focuses a slide, applies a registered layout to it, proves the state
 * reads "Inherited", makes a genuine authoring edit through the Arrange menu,
 * and captures the resulting "Locally changed" state with per-property reset and
 * detach controls.
 *
 * Three slides in the reference fixture contain an object called "Headline", so
 * the edit is reached through the slide itself (Select slide → Edit slide) and
 * verified against the selection breadcrumb rather than by matching a layer name
 * that several slides share.
 */

async function openFixture(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.removeItem('varve:crash-loop'));
  await navigateToEditor(page);
  await page.setInputFiles(
    '#file-open-input',
    resolve(process.cwd(), 'scripts/screenshots/fixtures/presentation.varve'),
  );
  await expect(page.locator('.editor-shell h1.sr-only')).toContainText('presentation.varve', {
    timeout: 30000,
  });
  await page.getByRole('tab', { name: 'Slides' }).click();
}

/** The shared Select renders an accessible combobox and listbox, not a native <select>. */
async function chooseSelectOption(
  page: import('@playwright/test').Page,
  label: string,
  optionName: string,
) {
  await page.getByRole('combobox', { name: label }).click();
  await page
    .getByRole('listbox', { name: label })
    .getByRole('option', { name: optionName, exact: true })
    .click();
}

/** Choose a layout, map each role to a distinct compatible object, apply it. */
async function applyLayout(page: import('@playwright/test').Page) {
  await page.locator('.presentation-layouts > summary').click();
  await chooseSelectOption(page, 'Layout source', 'Title / section');
  for (const [role, objectName] of [
    ['accent', 'Stratum 1'],
    ['title', 'Headline'],
    ['subtitle', 'Supporting copy'],
  ] as const) {
    await chooseSelectOption(page, `Slide object for ${role}`, objectName);
  }
  await page.getByRole('button', { name: 'Preview and reapply…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review layout changes' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('geometry changes');
  await page.screenshot({
    path: 'reports/presentation-audit/layout-review-dialog.png',
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Apply layout' }).click();
}

test.describe('presentation layout overrides', () => {
  test('shows inherited versus locally changed state with reachable reset and detach', async ({
    page,
  }) => {
    await openFixture(page);

    // Focus the slide first, while the navigator is still at its top.
    await page
      .getByRole('button', { name: /^Select slide 1: / })
      .first()
      .click();
    await page.getByRole('button', { name: 'Edit slide' }).first().click();
    await expect(page.locator('.layers-panel__isolation-breadcrumb')).toContainText('Title slide', {
      timeout: 10000,
    });

    await applyLayout(page);

    const panel = page.locator('.presentation-layouts__overrides');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('applied revision 1');
    await expect(panel).toContainText('Inherited');
    await expect(panel.getByRole('button', { name: 'Reset all to layout' })).toBeDisabled();
    await expect(panel).toContainText('Detach layout (keep appearance)');
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: 'reports/presentation-audit/layout-inherited.png',
      animations: 'disabled',
    });
    await panel.screenshot({ path: 'reports/presentation-audit/overrides-inherited.png' });

    // Make a real authoring edit on the mapped object of that same slide.
    await page.getByRole('tab', { name: 'Layers' }).click();
    await expect(page.locator('.presentation-navigator')).toBeHidden({ timeout: 5000 });
    const headline = page.getByRole('treeitem', { name: 'Headline' }).first();
    await expect(headline).toBeVisible({ timeout: 10000 });
    await headline.click();
    await expect(page.locator('.selection-breadcrumb')).toContainText('Title slide', {
      timeout: 10000,
    });

    await page.getByRole('menuitem', { name: 'Arrange' }).click();
    await page.getByRole('menuitem', { name: 'Nudge Right' }).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `reports/presentation-audit/layout-after-edit-${Date.now()}.png`,
      animations: 'disabled',
    });

    await page.getByRole('tab', { name: 'Slides' }).click();

    const changed = page.locator('.presentation-layouts__overrides');
    await expect(changed).toContainText('Locally changed');
    const reset = changed.getByRole('button', {
      name: 'Reset transform of Headline to the layout',
    });
    await expect(reset).toBeVisible();
    await expect(changed.getByRole('button', { name: 'Reset all to layout' })).toBeEnabled();
    await changed.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: 'reports/presentation-audit/layout-overridden.png',
      animations: 'disabled',
    });
    await changed.screenshot({ path: 'reports/presentation-audit/overrides-overridden.png' });

    await reset.click();
    await expect(changed).toContainText('Inherited');
    await expect(changed).not.toContainText('Locally changed');
  });
});
