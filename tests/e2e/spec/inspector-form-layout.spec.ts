import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function selectRectangle(page: import('@playwright/test').Page) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, 150, 150, 420, 340);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await expect(page.getByLabel('W (px)')).toBeVisible({ timeout: 5000 });
}

async function layoutGeometry(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.editor-inspector');
    const layout = Array.from(document.querySelectorAll('.insp-disclosure')).find((section) =>
      section.querySelector('input[aria-label="W (px)"]'),
    );
    if (!panel || !layout) throw new Error('Inspector Layout section is not mounted');

    const panelRect = panel.getBoundingClientRect();
    const fields = Array.from(layout.querySelectorAll('.insp-field')).map((field) => {
      const fieldRect = field.getBoundingClientRect();
      const label = field.querySelector('.insp-field__label');
      const control = field.querySelector('.insp-field__control');
      const labelRect = label?.getBoundingClientRect();
      const controlRect = control?.getBoundingClientRect();
      return {
        fieldRight: fieldRect.right,
        panelRight: panelRect.right,
        labelRight: labelRect?.right ?? null,
        controlLeft: controlRect?.left ?? null,
        controlRight: controlRect?.right ?? null,
      };
    });

    const groups = Array.from(layout.querySelectorAll('.insp-field-group')).map((group) => {
      const groupRect = group.getBoundingClientRect();
      const childRights = Array.from(group.children).map(
        (child) => (child as HTMLElement).getBoundingClientRect().right,
      );
      return { groupRight: groupRect.right, childRights };
    });

    return { fields, groups };
  });
}

function expectContained(geometry: Awaited<ReturnType<typeof layoutGeometry>>) {
  for (const field of geometry.fields) {
    expect(field.fieldRight).toBeLessThanOrEqual(field.panelRight + 1);
    if (field.labelRight !== null && field.controlLeft !== null) {
      expect(field.labelRight).toBeLessThanOrEqual(field.controlLeft + 1);
    }
    if (field.controlRight !== null) {
      expect(field.controlRight).toBeLessThanOrEqual(field.panelRight + 1);
    }
  }
  for (const group of geometry.groups) {
    for (const childRight of group.childRights) {
      expect(childRight).toBeLessThanOrEqual(group.groupRight + 1);
    }
  }
}

test.describe('Inspector responsive form layout', () => {
  test('geometry fields stay separated and direct entry remains editable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await navigateToEditor(page);
    await selectRectangle(page);

    expectContained(await layoutGeometry(page));

    const x = page.getByLabel('X (px)');
    await x.fill('240');
    await x.press('Enter');
    await expect(x).toHaveValue('240');

    await page.locator('.editor__inspector-panel').screenshot({
      path: test.info().outputPath('inspector-fields-wide-light.png'),
    });
  });

  test('compact inspector keeps fields contained in all application themes', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await navigateToEditor(page);
    await selectRectangle(page);

    for (const theme of ['light', 'dark', 'high-contrast']) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expectContained(await layoutGeometry(page));
      await page.locator('.editor__inspector-panel').screenshot({
        path: test.info().outputPath(`inspector-fields-compact-${theme}.png`),
      });
    }
  });
});
