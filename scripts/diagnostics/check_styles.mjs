import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/home_current.png', fullPage: false });

// Check CSS loading
const cssInfo = await page.evaluate(() => {
  const sheets = Array.from(document.styleSheets);
  return sheets.map((s) => {
    let ruleCount = 'cross-origin';
    try {
      ruleCount = s.cssRules.length;
    } catch {}
    return { href: s.href, rules: ruleCount };
  });
});
console.log('CSS sheets:', JSON.stringify(cssInfo, null, 2));

// Check if strata-btn styles exist
const hasButtons = await page.evaluate(() => {
  const sheets = Array.from(document.styleSheets);
  for (const s of sheets) {
    try {
      for (const r of s.cssRules) {
        if (r.selectorText?.includes('strata-btn')) return true;
      }
    } catch {}
  }
  return false;
});
console.log('Has .strata-btn styles:', hasButtons);

// Check computed styles on key elements
const styles = await page.evaluate(() => {
  const results = {};
  const selectors = [
    ['.strata-home__hero-greeting', 'hero-greeting'],
    ['.file-card', 'file-card'],
    ['.file-card__thumb', 'file-card-thumb'],
    ['.strata-home__sidebar', 'sidebar'],
    ['.strata-home__toolbar', 'toolbar'],
    ['body', 'body'],
    ['.strata-home__content', 'content'],
  ];
  for (const [sel, name] of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const cs = getComputedStyle(el);
      results[name] = {
        fontFamily: cs.fontFamily?.substring(0, 80),
        fontSize: cs.fontSize,
        color: cs.color,
        background: cs.background?.substring(0, 80),
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow?.substring(0, 60),
        padding: cs.padding,
        gap: cs.gap,
      };
    } else {
      results[name] = 'NOT FOUND';
    }
  }
  return results;
});
console.log('Computed styles:', JSON.stringify(styles, null, 2));

// Check what the actual rendered HTML looks like for the content area
const contentHTML = await page.evaluate(() => {
  const main = document.querySelector('.strata-home__content');
  return main ? main.innerHTML.substring(0, 3000) : 'NO CONTENT';
});
console.log('\nContent HTML (first 3000 chars):\n', contentHTML);

// Check the overall page structure
const structure = await page.evaluate(() => {
  const body = document.body;
  function describe(el, depth = 0) {
    if (depth > 4) return '...';
    const indent = '  '.repeat(depth);
    const tag = el.tagName?.toLowerCase() || '?';
    const cls = el.className
      ? `.${typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : ''}`
      : '';
    const children = Array.from(el.children || [])
      .map((c) => describe(c, depth + 1))
      .filter(Boolean);
    return `${indent}<${tag}${cls}>${children.length ? `\n${children.join('\n')}` : ''}`;
  }
  return describe(body).substring(0, 3000);
});
console.log('\nDOM structure:\n', structure);

await browser.close();
