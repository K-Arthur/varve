import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };
const WORKSPACES = [
  ['design', 'Design'],
  ['print', 'Print'],
  ['drawing', 'Draw'],
  ['image', 'Photo'],
  ['motion', 'Motion'],
  ['codegen', 'Codegen & Audit'],
  ['logo', 'Logo'],
] as const;

async function switchWorkspace(page: import('@playwright/test').Page, label: string) {
  const direct = page.locator(`.workspace-tabs__tab[aria-label="${label} workspace"]`);
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
  } else {
    await page.getByRole('button', { name: 'More workspaces' }).click();
    await page.getByRole('menuitemradio', { name: label }).click();
  }
  await expect(
    page.locator(`.workspace-tabs__tab[aria-label="${label} workspace"]`),
  ).toHaveAttribute('aria-checked', 'true');
}

test.describe('workspace toolbar visual QA', () => {
  test('captures every workspace toolbar at the responsive desktop width', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);

    for (const [mode, label] of WORKSPACES) {
      await switchWorkspace(page, label);
      const toolbar = page.locator('[data-testid="toolbar"]');
      await expect(toolbar).toBeVisible();
      await expect(toolbar.locator('[data-tool="select"]')).toBeVisible();
      if (mode === 'codegen') {
        // Codegen renders a workflow panel in the same canvas grid area. The
        // recovery toolbar must remain above that panel and pointer-accessible.
        const select = toolbar.locator('[data-tool="select"]');
        await select.click();
        await expect(select).toHaveAttribute('aria-pressed', 'true');
        await page.screenshot({ path: testInfo.outputPath('workspace-codegen-full.png') });
      }
      await toolbar.screenshot({ path: testInfo.outputPath(`toolbar-${mode}.png`) });
    }
  });

  test('keeps recovery tools visible and reachable at a narrow width', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 640, height: 700 });
    await navigateToEditor(page);

    const toolbar = page.locator('[data-testid="toolbar"]');
    await expect(toolbar).toBeVisible();
    for (const toolId of ['select', 'hand', 'zoom']) {
      await expect(toolbar.locator(`[data-tool="${toolId}"]`)).toBeVisible();
    }
    await toolbar.screenshot({ path: testInfo.outputPath('toolbar-design-narrow.png') });
  });

  test('captures the searchable customization dialog and a customized toolbar', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await page.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitem', { name: /Customize Workspace/ }).click();

    const dialog = page.getByRole('dialog', { name: /Customize Design workspace/i });
    await expect(dialog).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath('customize-design.png') });

    const search = dialog.getByRole('searchbox', { name: 'Search toolbar tools' });
    await search.fill('pen');
    await expect(dialog.getByText('Pen')).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath('customize-design-search-pen.png') });

    await dialog.getByRole('checkbox', { name: /Show Pen in Design workspace/ }).uncheck();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-tool="pen"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="select"]')).toBeVisible();
    await page.locator('[data-testid="toolbar"]').screenshot({
      path: testInfo.outputPath('toolbar-design-pen-hidden.png'),
    });
  });
});
