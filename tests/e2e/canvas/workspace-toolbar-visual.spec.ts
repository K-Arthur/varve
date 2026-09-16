import { expect, test } from '@playwright/test';
import { openSubmenu } from '../helpers/menu-helpers';
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
  const direct = page.locator(`.workspace-dock__item[aria-label="${label} workspace"]`);
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
  } else {
    await page.getByRole('button', { name: 'More workspaces' }).click();
    await page.getByRole('menuitemradio', { name: label }).click();
  }
  await expect(
    page.locator(`.workspace-dock__item[aria-label="${label} workspace"]`),
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
      const canvasBox = await page.locator('.editor-canvas').boundingBox();
      const toolbarBox = await toolbar.boundingBox();
      expect(canvasBox).not.toBeNull();
      expect(toolbarBox).not.toBeNull();
      if (!canvasBox || !toolbarBox) throw new Error('Canvas or toolbar has no layout box');
      expect(toolbarBox.x).toBeGreaterThanOrEqual(canvasBox.x - 1);
      expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(
        canvasBox.x + canvasBox.width + 1,
      );
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

  test('keeps primary tools in the row and routes low-priority tools through More tools when the canvas is tight', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 480, height: 700 });
    await navigateToEditor(page);

    const toolbar = page.locator('[data-testid="toolbar"]');
    await expect(toolbar).toBeVisible();
    // Recovery/navigation tools and the active tool never yield, at any width.
    await expect(toolbar.locator('[data-tool="select"]')).toBeVisible();

    const more = toolbar.getByRole('button', { name: /More tools/ });
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute('aria-label', /hidden by window width/);
    await more.click();

    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Vector' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Layout' })).toBeVisible();

    // Warp is an advanced vector helper: it is the kind of tool the retention
    // policy sends to More, while creation tools keep their row slot.
    await menu.getByRole('menuitem', { name: 'Vector' }).click();
    const vectorMenu = page.getByRole('menu', { name: 'Vector submenu' });
    await expect(vectorMenu.getByRole('menuitem', { name: 'Warp' })).toBeVisible();
    await vectorMenu.getByRole('menuitem', { name: 'Warp' }).click();

    // Activating a hidden tool pulls it back into the row and marks it active.
    await expect(toolbar.locator('[data-tool="warp"]')).toBeVisible();
    await expect(toolbar.locator('[data-tool="warp"]')).toHaveAttribute('aria-pressed', 'true');

    await toolbar.screenshot({ path: testInfo.outputPath('toolbar-category-overflow.png') });
    await page.screenshot({ path: testInfo.outputPath('toolbar-category-menu.png') });
  });

  test('captures the searchable customization dialog and a customized toolbar', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    // Customize Workspace lives in View > Workspace now that the View root is
    // grouped to fit one screen. Keyboard activation still avoids depending on
    // hit-testing an off-screen row.
    const workspaceMenu = await openSubmenu(page, 'View', 'Workspace');
    // The Workspace submenu is short and fully on screen, so a plain click is
    // both the user action and deterministic (the old focus+Enter path was a
    // workaround for the flat menu's off-screen rows).
    await workspaceMenu.getByRole('menuitem', { name: /Customize Workspace/ }).click();

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
