import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

// Listen for CSS loading
const cssUrls = [];
page.on('response', async (response) => {
  const url = response.url();
  if (
    url.includes('.css') ||
    url.includes('fontsource') ||
    url.includes('geist') ||
    url.includes('plex')
  ) {
    cssUrls.push({ url: url.substring(0, 120), status: response.status() });
  }
});

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);

console.log('CSS/font responses:');
for (const u of cssUrls) console.log(`  ${u.status} ${u.url}`);

// Check all stylesheet hrefs
const sheets = await page.evaluate(() => {
  return Array.from(document.styleSheets).map((s) => ({
    href: s.href,
    ownerNode: s.ownerNode?.tagName,
    ownerNodeHref: s.ownerNode?.getAttribute('href'),
  }));
});
console.log('\nAll stylesheets:');
for (const s of sheets)
  console.log(`  ${s.ownerNode}: href=${s.href} (ownerNode.href=${s.ownerNodeHref})`);

// Check if font-face rules exist
const fontFaces = await page.evaluate(() => {
  const faces = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.constructor.name === 'CSSFontFaceRule') {
          faces.push(rule.style.fontFamily);
        }
      }
    } catch {}
  }
  return faces;
});
console.log('\nFont-face declarations:', fontFaces);

// Check body computed font
const bodyFont = await page.evaluate(() => {
  const cs = getComputedStyle(document.body);
  return { fontFamily: cs.fontFamily, background: cs.background?.substring(0, 80) };
});
console.log('\nBody computed:', bodyFont);

await page.screenshot({ path: '/tmp/home_after_inspect.png', fullPage: false });
await browser.close();
