import { expect, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToEditor } from '../shared';

const WORKSPACES = [
  { mode: 'design', key: '1' },
  { mode: 'print', key: '2' },
  { mode: 'drawing', key: '3' },
  { mode: 'image', key: '4' },
  { mode: 'motion', key: '5' },
  { mode: 'email', key: '6' },
] as const;

test('projects the six workspace dock defaults around the shared canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);

  const dockSequence = await page.locator('.workspace-dock__item').evaluateAll((items) =>
    items.map((item) => ({
      mode: item.getAttribute('data-mode'),
      // The ordered 1–6 mapping is carried as data, not as a painted number
      // chip (which duplicated the tooltip chord and the menu badge, and sat
      // half outside its own control).
      key: (item as HTMLElement).dataset.shortcutKey,
    })),
  );
  expect(dockSequence).toEqual([
    { mode: 'design', key: '1' },
    { mode: 'print', key: '2' },
    { mode: 'drawing', key: '3' },
    { mode: 'image', key: '4' },
    { mode: 'motion', key: '5' },
    { mode: 'email', key: '6' },
  ]);

  for (const workspace of WORKSPACES) {
    await page.keyboard.press(`Control+Shift+${workspace.key}`);
    await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute(
      'data-mode',
      workspace.mode,
    );
    await expect(page.locator('.editor-shell__canvas-dock')).toHaveCSS('position', 'absolute');

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      };
      return {
        layers: rect('.editor__layers-panel'),
        canvas: rect('.editor-canvas'),
        inspector: rect('.editor__inspector-panel'),
        toolbar: rect('.floating-toolbar'),
      };
    });
    expect(geometry.layers?.width).toBeGreaterThanOrEqual(180);
    expect(geometry.canvas?.width).toBeGreaterThanOrEqual(320);
    expect(geometry.inspector?.width).toBeGreaterThanOrEqual(240);
    expect(geometry.layers!.x + geometry.layers!.width).toBeLessThanOrEqual(geometry.canvas!.x + 1);
    expect(geometry.canvas!.x + geometry.canvas!.width).toBeLessThanOrEqual(
      geometry.inspector!.x + 1,
    );
    expect(geometry.toolbar?.x).toBeGreaterThanOrEqual(geometry.canvas!.x);
    expect(geometry.toolbar!.x + geometry.toolbar!.width).toBeLessThanOrEqual(
      geometry.canvas!.x + geometry.canvas!.width,
    );
    expect(geometry.toolbar!.y).toBeGreaterThanOrEqual(geometry.canvas!.y);
    expect(geometry.toolbar!.y + geometry.toolbar!.height).toBeLessThanOrEqual(
      geometry.canvas!.y + geometry.canvas!.height,
    );
    if (workspace.mode === 'motion') {
      const timeline = await page.locator('[data-panel="timeline"]').boundingBox();
      const canvas = await page.locator('.editor-canvas').boundingBox();
      expect(timeline).not.toBeNull();
      expect(timeline!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height - 1);
    }
    if (workspace.mode === 'email') {
      // Workspace chrome updates before the per-workspace Inspector tab state
      // settles. Capture only after the dedicated authoring tab is active.
      await expect(page.locator('#insp-tab-email')).toHaveAttribute('aria-selected', 'true');
      const previewTab = page.getByRole('tab', { name: 'Email Preview' });
      await expect(previewTab).toBeVisible();
      await expect(previewTab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: 'Email Output' })).toBeVisible();
      const preview = await page.locator('[data-panel="emailPreview"]').boundingBox();
      const canvas = await page.locator('.editor-canvas').boundingBox();
      expect(preview).not.toBeNull();
      expect(preview!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height - 1);
    }

    await page.screenshot({
      path: evidencePath(`workspace-dock-layout/${workspace.mode}-light.png`),
      animations: 'disabled',
    });
  }

  for (const theme of ['dark', 'high-contrast'] as const) {
    await page.evaluate((value) => localStorage.setItem('varve-theme', value), theme);
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Six ordered shortcut carriers, zero painted number chips.
    await expect(page.locator('.workspace-dock__item[data-shortcut-key]')).toHaveCount(6);
    await expect(page.locator('.workspace-dock__shortcut')).toHaveCount(0);
    await page.screenshot({
      path: evidencePath(`workspace-dock-layout/switcher-${theme}.png`),
      clip: { x: 0, y: 0, width: 1440, height: 56 },
      animations: 'disabled',
    });
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('.editor-shell__canvas-dock')).not.toHaveCSS('position', 'absolute');
  await expect(page.locator('.editor-canvas')).toBeVisible();
});

test('resizes dock splits with keyboard and pointer controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);

  const splitter = page.locator('[data-testid^="dock-splitter-"]').first();
  await expect(splitter).toHaveAttribute('role', 'separator');
  await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
  const initial = Number(await splitter.getAttribute('aria-valuenow'));

  await splitter.focus();
  await page.keyboard.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(initial + 2));

  const bounds = await splitter.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 56, bounds!.y + bounds!.height / 2, {
    steps: 5,
  });
  await expect
    .poll(async () => Number(await splitter.getAttribute('aria-valuenow')))
    .toBeGreaterThan(initial + 2);
  await page.mouse.up();
  const final = Number(await splitter.getAttribute('aria-valuenow'));
  expect(final).toBeGreaterThan(initial + 2);
  await expect(splitter).toHaveAttribute('aria-valuetext', `${final} percent`);
  await page.screenshot({
    path: evidencePath('workspace-dock-layout/splitters-light.png'),
    animations: 'disabled',
  });

  const committed = final;
  const committedSplitter = page.locator('[data-testid^="dock-splitter-"]').first();
  const resizedBounds = await committedSplitter.boundingBox();
  expect(resizedBounds).not.toBeNull();
  await page.mouse.move(
    resizedBounds!.x + resizedBounds!.width / 2,
    resizedBounds!.y + resizedBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resizedBounds!.x + resizedBounds!.width / 2 - 48,
    resizedBounds!.y + resizedBounds!.height / 2,
    { steps: 4 },
  );
  await expect
    .poll(async () => Number(await committedSplitter.getAttribute('aria-valuenow')))
    .toBeLessThan(committed);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(committedSplitter).toHaveAttribute('aria-valuenow', String(committed));
});

test('moves a docked panel by pointer with a visible drop preview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);

  const moveHandle = page.getByTestId('dock-panel-move-layers');
  await expect(moveHandle).toBeVisible();
  const handle = await moveHandle.boundingBox();
  const inspector = await page.locator('.editor__inspector-panel').boundingBox();
  expect(handle).not.toBeNull();
  expect(inspector).not.toBeNull();

  const beforeCancel = await page.locator('.editor__layers-panel').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    inspector!.x + inspector!.width / 2,
    inspector!.y + inspector!.height * 0.9,
    { steps: 8 },
  );
  const preview = page.getByTestId('dock-drop-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(/move below inspector/i);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(preview).toBeHidden();
  await expect
    .poll(async () => (await page.locator('.editor__layers-panel').boundingBox())?.y)
    .toBe(beforeCancel?.y);

  const retryHandle = await moveHandle.boundingBox();
  const retryInspector = await page.locator('.editor__inspector-panel').boundingBox();
  expect(retryHandle).not.toBeNull();
  expect(retryInspector).not.toBeNull();
  await page.mouse.move(
    retryHandle!.x + retryHandle!.width / 2,
    retryHandle!.y + retryHandle!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    retryInspector!.x + retryInspector!.width / 2,
    retryInspector!.y + retryInspector!.height * 0.9,
    { steps: 8 },
  );
  await expect(preview).toBeVisible();
  await page.mouse.up();

  await expect
    .poll(async () => {
      const layers = await page.locator('.editor__layers-panel').boundingBox();
      const inspectorBox = await page.locator('.editor__inspector-panel').boundingBox();
      return layers && inspectorBox
        ? layers.y > inspectorBox.y && layers.x === inspectorBox.x
        : false;
    })
    .toBe(true);
  const storedLayout = await page.evaluate(() => {
    const raw = localStorage.getItem('varve-workspace-preferences');
    return raw ? JSON.parse(raw).design.dockLayout : null;
  });
  expect(storedLayout?.windows?.[0]?.dockRoot).toBeDefined();
  await page.screenshot({
    path: evidencePath('workspace-dock-layout/dock-drag-layers-below-inspector.png'),
    animations: 'disabled',
  });
});

test('panel move chrome does not cover Inspector panel controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);

  const move = page.getByTestId('dock-panel-move-inspector');
  const collapse = page.getByRole('button', { name: /Collapse Inspector/ });
  await expect(move).toBeVisible();
  await expect(collapse).toBeVisible();
  const [moveBox, collapseBox] = await Promise.all([move.boundingBox(), collapse.boundingBox()]);
  expect(moveBox).not.toBeNull();
  expect(collapseBox).not.toBeNull();
  const overlaps =
    moveBox!.x < collapseBox!.x + collapseBox!.width &&
    moveBox!.x + moveBox!.width > collapseBox!.x &&
    moveBox!.y < collapseBox!.y + collapseBox!.height &&
    moveBox!.y + moveBox!.height > collapseBox!.y;
  expect(overlaps).toBe(false);

  await collapse.click();
  await expect(page.locator('.editor__inspector-panel')).toHaveAttribute('data-collapsed', 'true');
});
