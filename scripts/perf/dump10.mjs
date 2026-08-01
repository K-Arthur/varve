import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
await page.goto('http://localhost:1430/visual-harness.html', {
  timeout: 60000,
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(4000);
const ready = await page
  .evaluate(() => window.__harnessReady === true)
  .catch((e) => 'eval-err: ' + String(e));
console.log('ready:', ready, 'errs:', errs.slice(0, 3));
if (ready === true) {
  const items = [];
  for (let i = 0; i < 100; i++) {
    items.push({
      transform: [1, 0, 0, 1, (i % 10) * 100, Math.floor(i / 10) * 100],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      primitive: { kind: 'rect', x: 8, y: 8, w: 64, h: 64 },
      opacity: 1,
      blendMode: 'normal',
      strokes: [],
      effects: [],
    });
  }
  const ms = await page.evaluate(
    ({ items }) => {
      const t0 = performance.now();
      window.__renderFixture(items, 1920, 1080);
      return performance.now() - t0;
    },
    { items },
  );
  console.log('render 100 items:', ms, 'ms');
}
await browser.close();
