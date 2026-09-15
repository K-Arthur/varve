import { chromium } from '@playwright/test';

const ok = async () => {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('http://localhost:1420/', { timeout: 90000, waitUntil: 'domcontentloaded' });
    const visible = await page
      .getByRole('button', { name: /^new$/i })
      .isVisible({ timeout: 30000 })
      .catch(() => false);
    await browser.close();
    return visible;
  } catch {
    return false;
  }
};
for (let i = 0; i < 30; i++) {
  if (await ok()) {
    console.log('BOOT-OK');
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
console.log('BOOT-NEVER');
process.exit(1);
