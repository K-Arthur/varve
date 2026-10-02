import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

const focusableSelector =
  'a[href]:visible, button:not([disabled]):visible, input:not([disabled]):visible, textarea:not([disabled]):visible, select:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):not([disabled]):visible';

test.describe('responsive panel drawers', () => {
  test('opens a usable narrow Layers drawer while its desktop rail stays collapsed', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await navigateToEditor(page);
    await seedLayers(page, 1);
    const panel = page.locator('.editor__layers-panel');
    await panel.getByRole('button', { name: 'Collapse Layers panel (Ctrl+B)' }).click();
    await expect(panel).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('restore-left-panel')).toBeVisible();
    await page.setViewportSize({ width: 754, height: 885 });
    const launcher = page.locator('.editor__fab--layers');
    await launcher.click();
    await expect(panel).toHaveAttribute('data-visible', 'true');
    await expect(panel).not.toHaveAttribute('inert');
    await expect(panel).not.toHaveAttribute('data-collapsed');
    await expect(page.getByTestId('restore-left-panel')).toBeHidden();
    expect((await panel.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(180);
    const row = panel.getByRole('treeitem').first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: testInfo.outputPath('layers-drawer-desktop-collapsed.png') });
    await panel.getByRole('button', { name: 'Close Layers panel', exact: true }).click();
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await expect(launcher).toBeFocused();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(panel).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('restore-left-panel')).toBeVisible();
    await expect(panel).toBeHidden();
  });

  test('closes and reopens Layers without hiding its desktop rail', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 754, height: 885 });
    await navigateToEditor(page);
    const launcher = page.locator('.editor__fab--layers');
    const panel = page.locator('.editor__layers-panel');
    await launcher.click();
    await expect(panel).toHaveAttribute('data-visible', 'true');
    await expect(panel).not.toHaveAttribute('inert');
    const close = panel.getByRole('button', { name: 'Close Layers panel', exact: true });
    await close.click();
    await expect(panel).not.toHaveAttribute('data-visible');
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await expect(launcher).toBeFocused();
    await expect(page.locator('.editor__panel-backdrop')).toHaveCount(0);
    await launcher.click();
    await expect(panel).toHaveAttribute('data-visible', 'true');
    await expect(close).toBeEnabled();
    await expect(panel).not.toHaveAttribute('data-collapsed');
    await close.click();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveAttribute('data-collapsed');
    await expect(
      panel.getByRole('button', { name: 'Collapse Layers panel (Ctrl+B)' }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('layers-reopened-desktop.png') });
  });

  test('keeps the compact toolbar grouped and panel launchers evenly separated', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 790, height: 886 });
    await navigateToEditor(page);

    const toolbar = page.getByTestId('toolbar');
    await expect(toolbar.getByRole('button', { name: 'More tools' })).toBeVisible();
    const layout = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        return element.getBoundingClientRect().toJSON();
      };
      const toolbar = bounds('.floating-toolbar');
      const layers = bounds('.editor__fab--layers');
      const inspector = bounds('.editor__fab--inspector');
      const library = bounds('.editor__fab--library');
      const lane = document.querySelector<HTMLElement>('.floating-toolbar [role="toolbar"]');
      const gapProbe = document.createElement('div');
      gapProbe.style.inlineSize = 'var(--space-2)';
      document.body.appendChild(gapProbe);
      const expectedGap = gapProbe.getBoundingClientRect().width;
      gapProbe.remove();
      return {
        viewportWidth: window.innerWidth,
        toolbar,
        lane: lane?.getBoundingClientRect().toJSON(),
        overflow: lane ? lane.scrollWidth > lane.clientWidth : false,
        layers,
        inspector,
        library,
        expectedGap,
        launcherGap: inspector.left - library.right,
      };
    });
    expect(layout.toolbar.x).toBeGreaterThanOrEqual(0);
    expect(layout.toolbar.x + layout.toolbar.width).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.lane?.width ?? 0).toBeLessThanOrEqual(512);
    expect(layout.overflow).toBe(false);
    expect(layout.inspector.width).toBe(44);
    expect(layout.library.width).toBe(44);
    expect(layout.launcherGap).toBeCloseTo(layout.expectedGap, 1);
    await page.screenshot({ path: testInfo.outputPath('responsive-790.png') });

    const inspectorLauncher = page.locator('.editor__fab--inspector');
    await inspectorLauncher.click();
    await expect(page.locator('.editor__inspector-panel')).toHaveAttribute('data-visible', 'true');
    const closeInspector = page.getByRole('button', { name: 'Close Inspector panel' });
    await expect(closeInspector).toBeVisible();
    await closeInspector.click();
    await expect(page.locator('.editor__inspector-panel')).not.toHaveAttribute('data-visible');
    await expect(inspectorLauncher).toHaveAttribute('aria-expanded', 'false');
    await expect(inspectorLauncher).toBeFocused();
  });

  test('uses aligned, reachable panel controls at a compact desktop width', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await navigateToEditor(page);

    const detach = page.getByRole('button', { name: 'Detach Inspector panel into a new window' });
    const collapse = page.getByRole('button', { name: 'Collapse Inspector (Ctrl+Shift+B)' });
    await expect(detach).toBeVisible();
    await expect(collapse).toBeVisible();
    const inspectorControls = await page.evaluate(() => {
      const detach = document.querySelector<HTMLElement>(
        'button[aria-label="Detach Inspector panel into a new window"]',
      );
      const collapse = document.querySelector<HTMLElement>(
        'button[aria-label="Collapse Inspector (Ctrl+Shift+B)"]',
      );
      if (!detach || !collapse) throw new Error('Inspector controls are not mounted');
      const detachRect = detach.getBoundingClientRect();
      const collapseRect = collapse.getBoundingClientRect();
      return {
        detach: detachRect.toJSON(),
        collapse: collapseRect.toJSON(),
        gap: collapseRect.left - detachRect.right,
      };
    });
    expect(inspectorControls.detach.width).toBe(32);
    expect(inspectorControls.detach.height).toBe(32);
    expect(inspectorControls.collapse.width).toBe(32);
    expect(inspectorControls.collapse.height).toBe(32);
    expect(inspectorControls.gap).toBeGreaterThanOrEqual(0);

    const moveHandle = page.locator('.workspace-dock-move-handle').first();
    if (await moveHandle.isVisible().catch(() => false)) {
      const handleBounds = await moveHandle.boundingBox();
      expect(handleBounds?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(handleBounds?.height ?? 0).toBeGreaterThanOrEqual(32);
    }
    await page.screenshot({ path: testInfo.outputPath('responsive-1024.png') });

    await collapse.click();
    const restoreInspector = page.getByTestId('restore-right-panel');
    await expect(restoreInspector).toBeVisible();
    await restoreInspector.click();
    await expect(collapse).toBeVisible();
  });

  test('an open Inspector releases desktop keyboard capture and reactivates after resizing back', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigateToEditor(page);
    const launcher = page.locator('.editor__fab--inspector');
    const panel = page.locator('.editor__inspector-panel');
    await launcher.click();
    await expect(launcher).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('data-visible', 'true');
    const mobileControls = panel.locator(focusableSelector);
    await expect(mobileControls.first()).toBeFocused();
    await mobileControls.last().focus();
    await page.keyboard.press('Tab');
    await expect(mobileControls.first()).toBeFocused();

    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-visible', 'true');
    const desktopControls = panel.locator(focusableSelector);
    await desktopControls.last().focus();
    await expect(desktopControls.last()).toBeFocused();
    await page.keyboard.press('Tab');
    await testInfo.attach('desktop-keyboard-owner', {
      body: JSON.stringify(
        await page.evaluate(() => ({
          width: innerWidth,
          active: document.activeElement?.outerHTML,
          inspectorVisible: document
            .querySelector('.editor__inspector-panel')
            ?.getAttribute('data-visible'),
          launcherExpanded: document
            .querySelector('.editor__fab--inspector')
            ?.getAttribute('aria-expanded'),
        })),
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await page.screenshot({ path: testInfo.outputPath('open-inspector-resized-desktop.png') });
    await expect.soft(desktopControls.first()).not.toBeFocused();
    await expect(launcher).toHaveAttribute('aria-expanded', 'true');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(launcher).toHaveAttribute('aria-expanded', 'true');
    await expect(mobileControls.first()).toBeFocused();
    await mobileControls.last().focus();
    await page.keyboard.press('Tab');
    await expect(mobileControls.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await expect(launcher).toBeFocused();
  });

  test('desktop Escape leaves an Inspector opened before resizing intact', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigateToEditor(page);
    const launcher = page.locator('.editor__fab--inspector');
    const panel = page.locator('.editor__inspector-panel');
    await launcher.click();
    await expect(panel.locator(focusableSelector).first()).toBeFocused();
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(panel).toBeVisible();
    const target = panel.locator(focusableSelector).last();
    await target.focus();
    await expect(target).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(launcher).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('data-visible', 'true');
  });

  test('closes each drawer with Escape and restores focus to its trigger', async ({ page }) => {
    await navigateToEditor(page);
    await page.setViewportSize({ width: 640, height: 700 });

    const cases = [
      {
        button: page.locator('.editor__fab--layers'),
        panel: page.locator('.editor__layers-panel'),
      },
      {
        button: page.locator('.editor__fab--inspector'),
        panel: page.locator('.editor__inspector-panel'),
      },
      {
        button: page.locator('.editor__fab--library'),
        panel: page.locator('.editor__library-panel'),
      },
    ];

    for (const { button, panel } of cases) {
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(panel).toHaveAttribute('data-visible', 'true');
      await expect(button).toHaveAttribute('aria-controls');
      await expect(panel).toHaveAttribute('role', 'dialog');

      const focusable = panel.locator(
        'a[href]:visible, button:not([disabled]):visible, input:not([disabled]):visible, textarea:not([disabled]):visible, select:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):not([disabled]):visible',
      );
      await expect(focusable.first()).toBeFocused();
      await focusable.last().focus();
      await page.keyboard.press('Tab');
      await expect(focusable.first()).toBeFocused();
      await focusable.first().focus();
      await page.keyboard.press('Shift+Tab');
      await expect(focusable.last()).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toBeFocused();
      if ((await panel.count()) > 0) {
        await expect(panel).not.toHaveAttribute('data-visible');
      }
    }
  });

  test('bounds recovery content and keeps its actions visible in a short viewport', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 260 });
    await navigateToEditor(page);
    const geometry = await page.evaluate(() => {
      const dialog = document.createElement('dialog');
      dialog.className = 'recovery-dialog';
      dialog.setAttribute('aria-label', 'Recover unsaved documents');
      dialog.innerHTML = `
        <div class="recovery-dialog__header">
          <h2 class="recovery-dialog__title">Recover unsaved documents</h2>
          <p class="recovery-dialog__subtitle">Recovered documents are ready to restore.</p>
          <button class="recovery-dialog__close" type="button">Close</button>
        </div>
        <div class="recovery-dialog__list"></div>
        <div class="recovery-dialog__footer">
          <button class="recovery-dialog__btn recovery-dialog__btn--primary" type="button">Restore All</button>
          <button class="recovery-dialog__btn recovery-dialog__btn--secondary" type="button">Discard All</button>
        </div>`;
      const list = dialog.querySelector('.recovery-dialog__list')!;
      for (let index = 0; index < 12; index += 1) {
        const row = document.createElement('div');
        row.className = 'recovery-dialog__item';
        row.innerHTML = `
          <div class="recovery-dialog__item-info">
            <span class="recovery-dialog__item-name">Recovered design ${index + 1}</span>
            <span class="recovery-dialog__item-time">2026-10-02 12:00</span>
          </div>
          <div class="recovery-dialog__item-actions">
            <button class="recovery-dialog__btn" type="button">Restore</button>
            <button class="recovery-dialog__btn" type="button">Discard</button>
          </div>`;
        list.appendChild(row);
      }
      document.body.appendChild(dialog);
      dialog.showModal();

      const rect = (element: Element) => element.getBoundingClientRect().toJSON();
      const dialogRect = dialog.getBoundingClientRect();
      const listElement = dialog.querySelector('.recovery-dialog__list') as HTMLElement;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        dialog: rect(dialog),
        list: {
          ...rect(listElement),
          clientHeight: listElement.clientHeight,
          scrollHeight: listElement.scrollHeight,
          overflowY: getComputedStyle(listElement).overflowY,
        },
        footer: rect(dialog.querySelector('.recovery-dialog__footer')!),
        dialogBottom: dialogRect.bottom,
      };
    });

    expect(geometry.dialog.x).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.y).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.x + geometry.dialog.width).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.dialog.y + geometry.dialog.height).toBeLessThanOrEqual(
      geometry.viewport.height,
    );
    expect(geometry.list.overflowY).toBe('auto');
    expect(geometry.list.scrollHeight).toBeGreaterThan(geometry.list.clientHeight);
    expect(geometry.footer.y + geometry.footer.height).toBeLessThanOrEqual(geometry.dialogBottom);
    await page.screenshot({ path: testInfo.outputPath('recovery-short-viewport.png') });
  });
});
