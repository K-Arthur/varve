import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);

// Check body computed font
const bodyStyles = await page.evaluate(() => {
  const cs = getComputedStyle(document.body);
  return {
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    color: cs.color,
    background: cs.background?.substring(0, 100),
    lineHeight: cs.lineHeight,
  };
});
console.log('Body computed:', bodyStyles);

// Check hero greeting
const heroStyles = await page.evaluate(() => {
  const el = document.querySelector('.strata-home__hero-greeting');
  if (!el) return 'NOT FOUND';
  const cs = getComputedStyle(el);
  return {
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    color: cs.color,
  };
});
console.log('Hero greeting:', heroStyles);

// Check a file card
const cardStyles = await page.evaluate(() => {
  const el = document.querySelector('.file-card');
  if (!el) return 'NOT FOUND (no files)';
  const cs = getComputedStyle(el);
  return {
    borderRadius: cs.borderRadius,
    boxShadow: cs.boxShadow?.substring(0, 60),
    background: cs.background?.substring(0, 80),
  };
});
console.log('File card:', cardStyles);

// Check button styling
const btnStyles = await page.evaluate(() => {
  const el = document.querySelector('.strata-btn');
  if (!el) return 'NOT FOUND';
  const cs = getComputedStyle(el);
  return {
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    background: cs.background?.substring(0, 80),
    borderRadius: cs.borderRadius,
    padding: cs.padding,
  };
});
console.log('Button:', btnStyles);

await page.screenshot({ path: '/tmp/home_after_font_fix.png', fullPage: false });
console.log('\nScreenshot saved to /tmp/home_after_font_fix.png');

await browser.close();
