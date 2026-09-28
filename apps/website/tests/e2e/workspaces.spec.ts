import { expect, test } from '@playwright/test';

test('workspace capability pages keep the six-mode contract and legacy feature URLs', async ({
  page,
  baseURL,
}, testInfo) => {
  if (!baseURL) throw new Error('Website baseURL is required');
  const basePath = new URL(baseURL).pathname.replace(/\/$/, '');
  const route = (path: string) => `${basePath}${path}` || '/';

  await page.setViewportSize({ width: 1440, height: 900 });
  const workspacesResponse = await page.goto(route('/features/workspaces'));
  expect(workspacesResponse?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();

  const workspaceText = await page.locator('main').innerText();
  for (const name of ['Design', 'Print', 'Draw', 'Photo', 'Motion', 'Email']) {
    expect(workspaceText).toContain(name);
  }
  expect(workspaceText.replace(/\s+/g, '')).toContain('Ctrl+Shift+1…6');
  expect(workspaceText).toContain('Ctrl+Shift+7');
  expect(workspaceText).toContain('Ctrl+Shift+8');

  const capabilityLinks = [
    { label: /Logo tools in Design/, path: '/features/logo', heading: /Logo tools inside Design/ },
    {
      label: /Email authoring workflow/,
      path: '/features/email',
      heading: /A workspace for email authoring/,
    },
    {
      label: /shared Code export/,
      path: '/features/code',
      heading: /Code export, wherever you work/,
    },
  ];
  for (const link of capabilityLinks) {
    const anchor = page.getByRole('link', { name: link.label });
    await expect(anchor).toHaveAttribute('href', route(link.path));
  }
  for (const link of capabilityLinks) {
    const response = await page.goto(route(link.path));
    expect(response?.status(), link.path).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: link.heading })).toBeVisible();
  }

  const shortcutResponse = await page.goto(route('/docs/keyboard-shortcuts'));
  expect(shortcutResponse?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Keyboard Shortcuts' })).toBeVisible();
  const shortcutText = (await page.locator('main').innerText()).replace(/\s+/g, '');
  for (const key of ['1', '2', '3', '4', '5', '6']) {
    expect(shortcutText).toContain(`Ctrl+Shift+${key}`);
  }
  await expect(
    page.getByText(/first six shortcuts follow the workspace switcher order/i),
  ).toBeVisible();
  await expect(
    page.getByText(/Chrome reserves Ctrl\+Shift\+B for the bookmarks bar/i),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileResponse = await page.goto(route('/features/workspaces'));
  expect(mobileResponse?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('workspace-feature-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
