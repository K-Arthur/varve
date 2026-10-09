import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const DEMO_FILE_ID = 'varve-demo-sample';

async function test() {
  console.log('Starting...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });

  const docContent = await readFile(
    '/workspace/marketing/sample-comic/halloween-cookies.varve',
    'utf-8',
  );

  console.log('Loading page...');
  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('Injecting document...');
  await page.evaluate(
    ({ fileId, content }) => {
      localStorage.setItem(`varve-file-${fileId}`, content);
      const library = JSON.parse(localStorage.getItem('varve-library') || '{"files":[]}');
      library.files = library.files.filter((f) => f.id !== fileId);
      library.files.unshift({
        id: fileId,
        name: 'Halloween Cookies',
        created: Date.now(),
        modified: Date.now(),
        contentHash: 'test',
        size: content.length,
      });
      localStorage.setItem('varve-library', JSON.stringify(library));
    },
    { fileId: DEMO_FILE_ID, content: docContent },
  );

  console.log('Reloading...');
  await page.reload();
  await page.waitForTimeout(5000);

  const canvas = page.locator('canvas').first();
  console.log('Canvas visible:', await canvas.isVisible());

  await page.waitForTimeout(3000);

  console.log('Taking screenshots...');
  await page.screenshot({
    path: '/workspace/marketing/sample-comic/test-fullpage.png',
    fullPage: true,
  });

  const box = await canvas.boundingBox();
  if (box) {
    await page.screenshot({ path: '/workspace/marketing/sample-comic/test-canvas.png', clip: box });
  }

  await browser.close();
  console.log('Done!');
}

test().catch(console.error);
