import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Inspector feature ownership', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('tabs use one compact row with roving focus and no duplicate overflow items', async ({
    page,
  }) => {
    const design = page.getByRole('tab', { name: 'Design' });
    const exportTab = page.getByRole('tab', { name: 'Export' });

    const tabs = page.getByRole('tablist', { name: 'Inspector tabs' });
    const tabCount = await tabs.getByRole('tab').count();
    expect(tabCount).toBeGreaterThan(1);
    await expect(page.getByRole('button', { name: /more tabs/i })).toHaveCount(0);
    const tabTopEdges = await tabs
      .getByRole('tab')
      .evaluateAll((elements) =>
        elements.map((element) => Math.round(element.getBoundingClientRect().top)),
      );
    expect(new Set(tabTopEdges).size).toBe(1);

    // Empty selection: Appearance/Audit are merged into Design, Prototype
    // and Fonts are contextual, so the row is Design + Export.
    await design.focus();
    await page.keyboard.press('ArrowRight');
    await expect(exportTab).toBeFocused();
    await expect(exportTab).toHaveAttribute('aria-selected', 'true');

    await design.click();
    await expect(page.getByRole('tab', { name: 'Document' })).toHaveCount(0);
    await expect(page.locator('[data-inspector-context-header="true"]')).toContainText('Canvas');
    await expect(page.getByRole('button', { name: 'Canvas', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Document Color' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Canvas background' })).toBeVisible();
    await expect(page.locator('.editor-inspector')).toHaveScreenshot('document-settings.png', {
      animations: 'disabled',
    });
  });

  test('uses an accessible overflow menu when the tab row is narrow', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'Inspector tabs' });
    await tablist.evaluate((element) => {
      const node = element as HTMLElement;
      node.style.flex = '0 0 80px';
      node.style.width = '80px';
    });

    const more = page.getByRole('button', { name: /more inspector tabs/i });
    await expect(more).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Design', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Export', exact: true })).toHaveCount(0);

    await more.click();
    await expect(page.getByRole('menu', { name: 'More inspector tabs' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Export', exact: true })).toBeVisible();
  });

  test('section customization exposes stable ordering controls', async ({ page }) => {
    await page.getByRole('button', { name: /customize sections/i }).click();
    const list = page.getByRole('list', { name: 'Section order' });
    await expect(list).toBeVisible();
    await expect(list.locator('[data-section-id]')).not.toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reset order' })).toBeVisible();
    await expect(page.locator('.editor-inspector')).toHaveScreenshot('section-manager.png', {
      animations: 'disabled',
    });

    const items = list.locator('[data-section-id]');
    const first = items.first();
    const second = items.nth(1);
    const firstId = await first.getAttribute('data-section-id');
    const secondId = await second.getAttribute('data-section-id');
    if (!firstId || !secondId) throw new Error('section manager order is missing stable IDs');

    await first.getByRole('button', { name: / down$/i }).click();
    await expect(items.first()).toHaveAttribute('data-section-id', secondId);
    await expect(items.nth(1)).toHaveAttribute('data-section-id', firstId);
    await page.getByRole('button', { name: 'Reset order' }).click();
  });

  test('prototype authoring is discoverable without living in Properties', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 250, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 390, box.y + 320);
    await page.mouse.up();

    await page.getByRole('tab', { name: 'Design' }).click();
    await expect(page.getByRole('button', { name: 'Prototype Interactions' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Prototype' }).click();
    await expect(page.getByRole('button', { name: 'Prototype Interactions' })).toBeVisible();
  });

  test('a common shape stays within the contextual inspector DOM budget', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 250, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 390, box.y + 320);
    await page.mouse.up();
    await page.getByRole('tab', { name: 'Design' }).click();

    await expect(page.locator('.editor-inspector')).toHaveCount(1);
    const inspector = page.locator('.editor-inspector');
    for (const label of [
      /^X(?: \(AB\))? \(px\)$/,
      /^Y(?: \(AB\))? \(px\)$/,
      /^W \(px\)$/,
      /^H \(px\)$/,
    ]) {
      await expect(inspector.getByRole('spinbutton', { name: label })).toHaveCount(1);
    }
    await expect(inspector.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveCount(
      1,
    );
    for (const label of ['Min W (px)', 'Max W (px)', 'Min H (px)', 'Max H (px)']) {
      await expect(inspector.getByRole('spinbutton', { name: label })).toHaveCount(0);
    }
    await expect(inspector.getByRole('button', { name: 'Corner Radius' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(inspector.getByRole('slider', { name: 'Corner smoothing' })).toHaveCount(0);

    const metrics = await page.locator('.editor-inspector').evaluate((element) => ({
      descendants: element.querySelectorAll('*').length,
      scrollHeight: element.scrollHeight,
      viewportHeight: element.clientHeight,
    }));

    // The contextual inspector includes the collapsed Selection Sources
    // entry point plus the merged appearance surfaces (mask/paint/filters/
    // effects triggers) and the collapsed Insights disclosure; keep a
    // bounded budget while allowing those collapsed entry points.
    expect(metrics.descendants).toBeLessThanOrEqual(340);
    expect(metrics.scrollHeight / metrics.viewportHeight).toBeLessThanOrEqual(1.75);
    // Effect editing is merged into the Design surface, collapsed by
    // default — assert the collapsed state instead of absence.
    await expect(inspector.getByRole('button', { name: 'Layer Effects' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.getByRole('button', { name: 'Prototype Interactions' })).toHaveCount(0);
    await expect(page.locator('.editor-inspector')).toHaveScreenshot('rectangle-properties.png', {
      animations: 'disabled',
    });
  });

  test('mixed geometry values are explicit and remain visually legible', async ({ page }) => {
    await seedLayers(page, 2);
    const shapes = page.locator('[role="treeitem"][data-layer-type="shape"]');
    await expect(shapes).toHaveCount(2);

    await shapes.first().click();
    await shapes.nth(1).click({ modifiers: ['Control'] });
    await page.getByRole('tab', { name: 'Design' }).click();

    const x = page.getByRole('spinbutton', { name: /^X(?: \(AB\))? \(px\)$/ });
    await expect(x).toHaveValue('Mixed');
    await expect(x).toHaveAttribute('aria-valuetext', 'Mixed values');
    await expect(page.locator('.editor-inspector')).toHaveScreenshot('mixed-properties.png', {
      animations: 'disabled',
    });
  });

  test('bound geometry shows its resolved source and has an explicit recovery path', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 250, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 390, box.y + 320);
    await page.mouse.up();
    await page.getByRole('tab', { name: 'Design' }).click();

    const shape = page.locator('[role="treeitem"][data-layer-type="shape"]').first();
    await shape.click();

    const added = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return false;
      const rootRecord = root as unknown as Record<string, unknown>;
      const fiberKey = Object.keys(root).find(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return false;
      const walk = (fiber: Record<string, unknown> | null): Record<string, unknown> | null => {
        if (!fiber) return null;
        for (const propsKey of ['memoizedProps', 'pendingProps']) {
          const props = fiber[propsKey] as Record<string, unknown> | undefined;
          const value = props?.value as Record<string, unknown> | undefined;
          if (value && typeof value.addVariable === 'function' && value.state) return value;
        }
        return (
          walk(fiber.child as Record<string, unknown> | null) ||
          walk(fiber.sibling as Record<string, unknown> | null)
        );
      };
      const ctx = walk(rootRecord[fiberKey] as Record<string, unknown> | null);
      if (!ctx || typeof ctx.addVariable !== 'function') return false;
      (ctx.addVariable as (variable: unknown) => void)({
        name: 'Inspector spacing',
        type: 'number',
        valuesByMode: { default: 48 },
      });
      return true;
    });
    expect(added).toBe(true);

    let variableId: string | null = null;
    await expect
      .poll(
        async () => {
          variableId = await page.evaluate(() => {
            const root = document.getElementById('root');
            if (!root) return null;
            const rootRecord = root as unknown as Record<string, unknown>;
            const fiberKey = Object.keys(root).find(
              (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$'),
            );
            if (!fiberKey) return null;
            const walk = (
              fiber: Record<string, unknown> | null,
            ): Record<string, unknown> | null => {
              if (!fiber) return null;
              for (const propsKey of ['memoizedProps', 'pendingProps']) {
                const props = fiber[propsKey] as Record<string, unknown> | undefined;
                const value = props?.value as Record<string, unknown> | undefined;
                if (value && typeof value.setSelectedBinding === 'function' && value.state) {
                  return value;
                }
              }
              return (
                walk(fiber.child as Record<string, unknown> | null) ||
                walk(fiber.sibling as Record<string, unknown> | null)
              );
            };
            const ctx = walk(rootRecord[fiberKey] as Record<string, unknown> | null);
            const documentState = ctx?.state as
              | {
                  document?: {
                    variableStore?: { variables?: Record<string, { id: string; name: string }> };
                  };
                }
              | undefined;
            const variable = Object.values(
              documentState?.document?.variableStore?.variables ?? {},
            ).find((candidate) => candidate.name === 'Inspector spacing');
            return variable?.id ?? null;
          });
          return variableId;
        },
        { timeout: 10000 },
      )
      .toBeTruthy();
    if (!variableId) throw new Error('variable was not created');

    const bound = await page.evaluate((id) => {
      const root = document.getElementById('root');
      if (!root) return false;
      const rootRecord = root as unknown as Record<string, unknown>;
      const fiberKey = Object.keys(root).find(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return false;
      const walk = (fiber: Record<string, unknown> | null): Record<string, unknown> | null => {
        if (!fiber) return null;
        for (const propsKey of ['memoizedProps', 'pendingProps']) {
          const props = fiber[propsKey] as Record<string, unknown> | undefined;
          const value = props?.value as Record<string, unknown> | undefined;
          if (value && typeof value.setSelectedBinding === 'function' && value.state) return value;
        }
        return (
          walk(fiber.child as Record<string, unknown> | null) ||
          walk(fiber.sibling as Record<string, unknown> | null)
        );
      };
      const ctx = walk(rootRecord[fiberKey] as Record<string, unknown> | null);
      if (!ctx || typeof ctx.setSelectedBinding !== 'function') return false;
      (ctx.setSelectedBinding as (property: string, binding: unknown) => void)('x', {
        variableId: id,
      });
      return true;
    }, variableId);
    expect(bound).toBe(true);

    const x = page.getByRole('spinbutton', { name: /^X(?: \(AB\))? \(px\)$/ });
    await expect(x).toHaveValue('48');
    await expect(x).toHaveAttribute('aria-readonly', 'true');
    await expect(
      page.getByRole('status', { name: /bound to variable: inspector spacing/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Unbind variable Inspector spacing' }),
    ).toBeVisible();
    await expect(x.locator('xpath=../..')).toHaveScreenshot('bound-property-field.png', {
      animations: 'disabled',
    });

    await page.getByRole('button', { name: 'Unbind variable Inspector spacing' }).click();
    await expect(x).not.toHaveAttribute('aria-readonly', 'true');
    await expect(
      page.getByRole('button', { name: 'Unbind variable Inspector spacing' }),
    ).toHaveCount(0);
  });

  test('locked selection stays inspectable with a source-aware restriction notice', async ({
    page,
  }) => {
    await seedLayers(page, 1);
    const row = page.locator('[role="treeitem"][data-layer-type="shape"]').first();
    await row.click();
    const lock = row.locator('.layers-row__toggle--locked-off');
    await expect(lock).toBeVisible();
    await lock.click();

    await expect(row.locator('.layers-row__toggle--locked-on')).toBeVisible();
    await expect(page.getByText(/selection is locked/i)).toBeVisible();
    await expect(page.locator('[data-inspector-restriction="locked"]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Layout', exact: true })).toBeVisible();
    await expect(page.locator('.editor-inspector')).toHaveScreenshot('locked-properties.png', {
      animations: 'disabled',
    });
  });

  test('brush behavior opens from Tool Options instead of Properties', async ({ page }) => {
    await page.getByRole('radio', { name: 'Draw workspace' }).click();
    await page.locator('canvas.editor-canvas__content-layer').focus();
    await page.keyboard.press('b');
    const dialog = page.getByRole('dialog', { name: 'paint tool options' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Brush', exact: true })).toBeFocused();
  });

  test('responsive inspector drawer is inside the viewport when opened', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.getByRole('button', { name: 'Show inspector panel' }).click();

    const panel = page.locator('.editor__inspector-panel');
    await expect(panel).toHaveAttribute('data-visible', 'true');
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return box ? Math.ceil(box.x + box.width) : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(800);
  });
});
