import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/', { timeout: 180_000, waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 180_000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .click();
  await page.locator('.editor__layers-panel, .layers-panel').first().waitFor({ timeout: 180_000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

test('email preview controls switch viewport and generated code remains read-only', async ({
  page,
}) => {
  await navigateToEditor(page);
  await page.keyboard.press('Control+Shift+6');
  await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute('data-mode', 'email');
  await page.getByRole('tab', { name: 'Email', exact: true }).click();
  await page.getByRole('button', { name: 'Enable email template' }).click();

  await expect(page.getByTitle('Email browser preview')).toBeVisible();
  await expect(page.locator('.email-panel__preview-frame--desktop')).toBeVisible();

  await page
    .locator('.workspace-bottom-panels__email-preview')
    .getByRole('button', { name: 'Mobile', exact: true })
    .click();
  await expect(page.locator('.email-panel__preview-frame--mobile')).toBeVisible();

  await page.getByRole('tab', { name: 'Email Output' }).click();
  const generated = page.getByRole('region', { name: 'Generated email HTML (read-only)' });
  await expect(generated).toBeVisible();
  const generatedCode = generated.getByRole('textbox', { name: 'Generated email HTML' });
  await expect(generatedCode).toBeVisible();
  await expect(generatedCode).toHaveAttribute('readonly', '');
  await expect(page.getByTitle('Email browser preview')).toBeHidden();
});

test('workspace switching preserves the document and orphaned authored source stays reachable', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);

  await page.keyboard.press('t');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas has no bounds');
  await page.mouse.click(bounds.x + 180, bounds.y + 180);
  const textEditor = page.getByRole('textbox', { name: /editing text/i });
  await expect(textEditor).toBeFocused();
  await page.keyboard.insertText('Email source anchor');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByRole('treeitem')).toHaveCount(1);

  await page.keyboard.press('Control+Shift+6');
  await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute('data-mode', 'email');
  await expect(page.locator('#insp-tab-email')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Enable email template' })).toBeVisible();
  await expect(page.getByRole('treeitem')).toHaveCount(1);

  // Switching workspaces leaves Email unprofiled. Enabling it is an explicit
  // user action, after which source mapping and output tools become available.
  await page.getByRole('button', { name: 'Enable email template' }).click();
  await page.getByRole('tab', { name: 'Email Output' }).click();
  const outputPanel = page.getByTestId('email-output-panel');
  await expect(outputPanel.getByRole('textbox', { name: 'Generated email HTML' })).toBeVisible();
  await expect(outputPanel).toContainText(/Selected node maps to generated HTML lines/);

  const sourceBlocks = outputPanel.getByRole('list', { name: 'Saved authored source blocks' });
  await expect(
    outputPanel.getByRole('button', { name: /Create source block for selected node/i }),
  ).toBeVisible();
  await outputPanel.getByRole('button', { name: /Create source block for selected node/i }).click();
  const sourceBlock = sourceBlocks.getByRole('listitem').first();
  await sourceBlock.getByText('Text: Email source anchor', { exact: true }).click();
  const authoredSource = outputPanel.getByRole('textbox', { name: /Authored HTML source for/ });
  await expect(authoredSource).toBeVisible();
  await authoredSource.fill('<div>Preserved after its visual node is removed</div>');
  await outputPanel.getByRole('button', { name: 'Save source block' }).click();
  await expect(authoredSource).toHaveValue('<div>Preserved after its visual node is removed</div>');

  await page.getByRole('treeitem').first().click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('treeitem')).toHaveCount(0);
  await expect(sourceBlocks).toContainText('Source block ·');
  await expect(sourceBlocks).toContainText(
    'The source is preserved without a matching visible scene node.',
  );
  await expect(outputPanel.getByRole('textbox', { name: /Authored HTML source for/ })).toHaveValue(
    '<div>Preserved after its visual node is removed</div>',
  );
  await outputPanel
    .getByRole('textbox', { name: /Authored HTML source for/ })
    .scrollIntoViewIfNeeded();

  await page.screenshot({
    path: testInfo.outputPath('email-orphaned-authored-source.png'),
    animations: 'disabled',
  });
});
