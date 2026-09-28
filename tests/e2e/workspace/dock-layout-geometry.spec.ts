import { expect, test } from '@playwright/test';

const WORKSPACES = [
  { mode: 'design', key: '1' },
  { mode: 'print', key: '2' },
  { mode: 'drawing', key: '3' },
  { mode: 'image', key: '4' },
  { mode: 'motion', key: '5' },
  { mode: 'email', key: '6' },
] as const;

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^new$/i }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .click();
  await page.locator('.editor-canvas').waitFor({ state: 'visible' });
  const welcome = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcome
      .first()
      .isVisible()
      .catch(() => false)
  )
    await welcome.first().click();
  await expect(page.locator('.editor__layers-panel')).toBeVisible();
  await expect(page.locator('.editor__inspector-panel')).toBeVisible();
}

test('projects the six workspace dock defaults around the shared canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);

  const dockSequence = await page.locator('.workspace-dock__item').evaluateAll((items) =>
    items.map((item) => ({
      mode: item.getAttribute('data-mode'),
      key: item.querySelector<HTMLElement>('.workspace-dock__shortcut')?.dataset.shortcutKey,
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
      path: `docs/screenshots/workspace-dock-layout/${workspace.mode}-light.png`,
      animations: 'disabled',
    });
  }

  for (const theme of ['dark', 'high-contrast'] as const) {
    await page.evaluate((value) => localStorage.setItem('varve-theme', value), theme);
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.workspace-dock__shortcut')).toHaveCount(6);
    await page.screenshot({
      path: `docs/screenshots/workspace-dock-layout/switcher-${theme}.png`,
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
    path: 'docs/screenshots/workspace-dock-layout/splitters-light.png',
    animations: 'disabled',
  });

  const committed = final;
  const resizedBounds = await splitter.boundingBox();
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
    .poll(async () => Number(await splitter.getAttribute('aria-valuenow')))
    .toBeLessThan(committed);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(splitter).toHaveAttribute('aria-valuenow', String(committed));
});
