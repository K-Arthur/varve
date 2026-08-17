// Temporary visual verification spec: styled surfaces from the style audit.
// Run: pnpm exec playwright test tests/e2e/style-audit.spec.ts --project=chromium --reporter=list
import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

test('new-file dialog is styled with design tokens', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page.locator('dialog').waitFor({ timeout: 5000 });

  const tab = page.locator('.new-file__tab--active').first();
  await expect(tab).toBeVisible();
  const tabInfo = await tab.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderBottomColor: cs.borderBottomColor, color: cs.color };
  });
  expect(tabInfo.borderBottomColor).not.toBe('rgba(0, 0, 0, 0)');

  const blank = page.locator('.new-file__blank');
  await expect(blank).toBeVisible();
  const blankInfo = await blank.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, radius: cs.borderRadius };
  });
  expect(blankInfo.background).not.toBe('rgba(0, 0, 0, 0)');

  await expect(page.locator('.new-file__fields')).toBeVisible();
  await expect(page.locator('.new-file__footer')).toBeVisible();
  await page.screenshot({
    path: `reports/style-audit/newfile-${testInfo.project.name}.png`,
    fullPage: true,
  });

  // Templates tab also renders
  await page.getByRole('tab', { name: 'Templates' }).click();
  await expect(page.locator('.new-file__body')).toBeVisible();
});

test('floating toolbar drawing controls are styled', async ({ page }, testInfo) => {
  await navigateToEditor(page);
  // Drawing workspace: Ctrl+Shift+3
  await page.keyboard.press('Control+Shift+3');
  await page.locator('.floating-toolbar__drawing').waitFor({ timeout: 5000 });
  const drawing = page.locator('.floating-toolbar__drawing');
  const info = await drawing.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      borderColor: cs.borderColor,
      radius: cs.borderRadius,
      pointerEvents: cs.pointerEvents,
    };
  });
  expect(info.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(info.radius).not.toBe('0px');
  await expect(page.locator('.floating-toolbar__color-swatch')).toHaveCount(2);
  await expect(page.locator('.floating-toolbar__color-swap')).toBeVisible();
  await page.screenshot({
    path: `reports/style-audit/drawing-toolbar-${testInfo.project.name}.png`,
  });
});

test('preflight badge CSS loads (rules present even when badge hidden)', async ({ page }) => {
  await navigateToEditor(page);
  // The badge only renders when issues exist; assert the stylesheet applied
  // by checking a rule-visible element is not present but the class CSS is.
  const cssApplied = await page.evaluate(() => {
    const sheets = [...document.styleSheets];
    for (const sheet of sheets) {
      try {
        for (const rule of [...sheet.cssRules]) {
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText.includes('preflight-warnings__badge')
          ) {
            return true;
          }
        }
      } catch {
        /* cross-origin sheet — skip */
      }
    }
    return false;
  });
  expect(cssApplied).toBe(true);
});
