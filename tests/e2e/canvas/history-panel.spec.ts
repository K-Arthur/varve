import { expect, type Page, test } from '@playwright/test';

/** Standard nav helper (AGENTS.md) with the Create-design dialog variant. */
async function navigateToEditor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page.getByRole('button', { name: /create design/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /create design/i }).click();
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
  // Dismiss the onboarding checklist overlay if present.
  const dismissBtn = page.locator('button:has-text("Dismiss")');
  if (await dismissBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await dismissBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

async function openHistoryPanel(page: Page) {
  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.waitForTimeout(500);
  await page.locator('[role="menuitem"]', { hasText: 'History Panel' }).click();
  await page.locator('.editor__history-panel').waitFor({ timeout: 10000 });
}

async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const rectBtn = page.locator('[data-tool="rect"]');
  await rectBtn.click();
  await page.waitForTimeout(300);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

test('history panel shows persistent steps with markers', async ({ page }) => {
  await navigateToEditor(page);
  await drawRect(page, 200, 200, 400, 350);
  await drawRect(page, 550, 150, 750, 300);
  await openHistoryPanel(page);

  const panel = page.locator('.editor__history-panel');
  await expect(panel).toBeVisible();
  // Genesis + one create step per rect
  await expect(panel.locator('.history-panel__step')).toHaveCount(3);
  await expect(panel.locator('.history-panel__step--head')).toHaveCount(1);
  await expect(panel.locator('.history-panel__marker--head')).toHaveText('HEAD');
  const firstStep = panel.locator('.history-panel__step').first();
  await expect(firstStep).toContainText('Genesis');
});

test('checkpoint and branch creation flows', async ({ page }) => {
  await navigateToEditor(page);
  await drawRect(page, 200, 200, 400, 350);
  await openHistoryPanel(page);

  // Create a checkpoint
  await page.locator('button:has-text("+ Checkpoint")').first().click();
  await page.locator('.history-panel__form-input').fill('Client review 2');
  await page.locator('.history-panel__form-actions button:has-text("Save")').click();
  await expect(page.locator('.history-panel__step--checkpoint')).toHaveCount(1);

  // Create a branch
  await page.locator('.history-panel__content button:has-text("+ Branch")').first().click();
  await page.locator('.history-panel__form-input').fill('experiment');
  await page.locator('.history-panel__form-actions button:has-text("Create")').click();

  // Branch appears in the Branches tab
  await page.getByRole('tab', { name: 'Branches' }).click();
  await expect(page.locator('.history-panel__branch', { hasText: 'experiment' })).toBeVisible();
  await expect(page.locator('.history-panel__branch--current')).toContainText('main');
});

test('search filters history steps', async ({ page }) => {
  await navigateToEditor(page);
  await drawRect(page, 200, 200, 400, 350);
  await openHistoryPanel(page);
  await expect(page.locator('.history-panel__step')).toHaveCount(2);

  await page.locator('.history-panel__search-input').fill('zzz-nonexistent');
  await expect(page.locator('.history-panel__step')).toHaveCount(0);

  await page.locator('.history-panel__search-input').fill('Create');
  await expect(page.locator('.history-panel__step')).toHaveCount(1);
});

test('navigating a step checks out that revision', async ({ page }) => {
  await navigateToEditor(page);
  await drawRect(page, 200, 200, 400, 350);
  await openHistoryPanel(page);
  await expect(page.locator('.history-panel__step')).toHaveCount(2);

  // Click the Genesis step → head marker moves to it
  await page.locator('.history-panel__step', { hasText: 'Genesis' }).click();
  await page.waitForTimeout(1500);
  const headText = await page.locator('.history-panel__step--head').textContent();
  expect(headText).toContain('Genesis');
});
