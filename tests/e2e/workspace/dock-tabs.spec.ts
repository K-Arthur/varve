import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function openCustomize(page: import('@playwright/test').Page) {
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.waitFor({ timeout: 30_000 });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('Customize Workspace');
  await palette
    .getByRole('option', { name: /^Customize Workspace$/ })
    .first()
    .click();
  return page.getByRole('dialog', { name: /Customize Design workspace/i });
}

test('panel tab groups remain accessible and selected after mode changes and reload', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  const browserConsoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const badResponses: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserConsoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`,
    ),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);

  const dialog = await openCustomize(page);
  await dialog.getByRole('combobox', { name: 'Panel to move' }).selectOption('layers');
  await dialog.getByRole('combobox', { name: 'Panel placement' }).selectOption('tab');
  await dialog.getByRole('combobox', { name: 'Panel move target' }).selectOption('inspector');
  await dialog.getByRole('button', { name: 'Move panel', exact: true }).click();
  await expect(
    dialog.locator('[aria-labelledby="workspace-dock-move-title"] p[role="status"]'),
  ).toContainText('Layers moved.');
  await dialog.getByRole('button', { name: 'Done' }).click();

  const layersTab = page.getByRole('tab', { name: 'Layers' });
  const inspectorTab = page.getByRole('tab', { name: 'Inspector' });
  await expect(layersTab).toHaveAttribute('aria-selected', 'true');
  await inspectorTab.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(layersTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(inspectorTab).toHaveAttribute('aria-selected', 'true');
  const inspectorTabId = await inspectorTab.getAttribute('id');
  expect(inspectorTabId).toBeTruthy();
  await expect(page.locator('#editor-inspector-panel')).toHaveAttribute(
    'aria-labelledby',
    inspectorTabId!,
  );
  await page.screenshot({
    path: 'test-results/workspace-dock-tabs-selected-inspector.png',
    animations: 'disabled',
  });

  const savedActiveTab = await page.evaluate(() => {
    const preferences = JSON.parse(localStorage.getItem('varve-workspace-preferences') ?? '{}');
    const root = preferences.design?.dockLayout?.windows?.find(
      (window: { role?: string }) => window.role === 'primary',
    )?.dockRoot;
    type NodeLike = {
      kind?: unknown;
      activePanelInstanceId?: unknown;
      panels?: unknown;
      first?: unknown;
      second?: unknown;
    };
    const search = (value: unknown): string | null => {
      if (!value || typeof value !== 'object') return null;
      const node = value as NodeLike;
      if (
        node.kind === 'tabs' &&
        Array.isArray(node.panels) &&
        node.panels.some(
          (panel) =>
            typeof panel === 'object' &&
            panel !== null &&
            'panelTypeId' in panel &&
            panel.panelTypeId === 'inspector',
        )
      ) {
        return typeof node.activePanelInstanceId === 'string' ? node.activePanelInstanceId : null;
      }
      return node.kind === 'split' ? (search(node.first) ?? search(node.second)) : null;
    };
    return search(root);
  });
  expect(savedActiveTab).toBeTruthy();

  await page.keyboard.press('Control+Shift+6');
  await page.keyboard.press('Control+Shift+1');
  await expect(page.getByRole('tab', { name: 'Inspector' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.reload();
  try {
    await navigateToEditor(page);
  } catch (error) {
    const diagnostics = {
      error: error instanceof Error ? error.stack : String(error),
      browserErrors,
      browserConsoleErrors,
      location: page.url(),
      body: await page
        .locator('body')
        .innerText()
        .catch(() => ''),
      localStorage: await page
        .evaluate(() =>
          Object.fromEntries(
            Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
              .filter((key): key is string => typeof key === 'string' && key.includes('workspace'))
              .map((key) => [key, localStorage.getItem(key)]),
          ),
        )
        .catch(() => ({})),
      resources: await page
        .evaluate(() =>
          performance
            .getEntriesByType('resource')
            .slice(-40)
            .map((entry) => {
              const resource = entry as PerformanceResourceTiming;
              return {
                name: entry.name,
                duration: entry.duration,
                size: resource.transferSize,
              };
            }),
        )
        .catch(() => []),
      failedRequests,
      badResponses,
    };
    await writeFile(
      test.info().outputPath('dock-tab-reload-diagnostics.json'),
      JSON.stringify(diagnostics, null, 2),
    );
    await test.info().attach('dock-tab-reload-diagnostics.json', {
      path: test.info().outputPath('dock-tab-reload-diagnostics.json'),
    });
    throw error;
  }
  await expect(page.getByRole('tab', { name: 'Inspector' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
