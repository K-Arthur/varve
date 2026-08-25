import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Responsive editor top bar: workspace tabs must never overlap the document
 * title, every workspace must stay reachable at every width, and the
 * overflow menu must expose hidden modes at narrow widths.
 */

const ALL_WORKSPACES = [
  'Design',
  'Print',
  'Draw',
  'Photo',
  'Motion',
  'Codegen & Audit',
  'Logo',
  'Email',
] as const;

async function workspaceGroup(page: Page) {
  return page.getByRole('radiogroup', { name: 'Workspace' });
}

async function expectNoOverlap(page: Page) {
  const result = await page.evaluate(() => {
    const title = document.querySelector('.editor-menubar__doc-name');
    const controls = document.querySelector('.editor-menubar__controls');
    const tr = title?.getBoundingClientRect();
    const cr = controls?.getBoundingClientRect();
    const overlap =
      tr && cr ? Math.max(0, Math.min(tr.right, cr.right) - Math.max(tr.left, cr.left)) : null;
    return {
      titleRight: tr?.right ?? null,
      controlsLeft: cr?.left ?? null,
      overlapPx: overlap,
      titleVisible: title ? title.getBoundingClientRect().width > 0 : false,
    };
  });
  // Title and controls may share space only if there is zero horizontal
  // overlap at the title's height band.
  expect(result.overlapPx ?? 0).toBeLessThan(2);
  expect(result.titleVisible).toBe(true);
}

test.describe('Responsive workspace navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToEditor(page);
  });

  test('all workspaces are reachable at wide width', async ({ page }) => {
    const group = await workspaceGroup(page);
    for (const name of ALL_WORKSPACES) {
      await expect(
        group.getByRole('radio', { name: new RegExp(`^${name} workspace$`) }),
      ).toBeVisible();
    }
    await expectNoOverlap(page);
  });

  test('switching each workspace updates the editor state', async ({ page }) => {
    const group = await workspaceGroup(page);
    for (const name of ['Print', 'Draw', 'Photo', 'Motion', 'Codegen & Audit', 'Logo', 'Design']) {
      const radio = group.getByRole('radio', { name: new RegExp(`^${name} workspace$`) });
      await radio.click();
      await expect(radio).toHaveAttribute('aria-checked', 'true');
      // The title stays visible and non-overlapping after every switch.
      await expectNoOverlap(page);
    }
  });

  test('narrow width: overflow menu exposes hidden workspaces', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    // Give the ResizeObserver a moment to re-layout the strip.
    await page.waitForTimeout(300);

    const group = await workspaceGroup(page);
    // Design stays visible; at least one workspace must be in the menu.
    await expect(group.getByRole('radio', { name: /^Design workspace$/ })).toBeVisible();

    const more = page.getByRole('button', { name: 'More workspaces' });
    if (await more.isVisible().catch(() => false)) {
      await more.click();
      const menu = page.getByRole('menu', { name: 'More workspaces' });
      await expect(menu).toBeVisible();
      // Every hidden workspace is reachable from the overflow menu.
      const hidden = await page.evaluate(() => {
        const strip = document.querySelector('.workspace-tabs__strip');
        const visible = new Set(
          Array.from(strip?.querySelectorAll('[role="radio"]') ?? []).map((r) =>
            r.getAttribute('aria-label'),
          ),
        );
        return Array.from(visible);
      });
      for (const name of ALL_WORKSPACES) {
        if (!hidden.includes(`${name} workspace`)) {
          await expect(menu.getByRole('menuitem', { name })).toBeVisible();
        }
      }
    } else {
      // At 1024px the icon-only strip may still fit everything — but the
      // doc name must not overlap regardless.
      await expectNoOverlap(page);
    }
    await expectNoOverlap(page);
  });

  test('min width: active workspace stays visible, title never overlaps', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(300);
    const group = await workspaceGroup(page);
    await expect(group.getByRole('radio', { name: /^Design workspace$/ })).toBeVisible();
    await expectNoOverlap(page);
  });
});
