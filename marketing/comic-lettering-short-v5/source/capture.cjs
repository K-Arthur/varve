/* Capture real editor interactions; no document or UI pixels are synthesized. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = process.cwd();
const DIR = path.join(ROOT, 'marketing/comic-lettering-short-v5/source');
const WORK = path.join(ROOT, 'work/v5-capture');
fs.mkdirSync(WORK, { recursive: true });
let browser;
let page;
const events = [];
const wait = (ms) => page.waitForTimeout(ms);
const layer = (id) => page.locator(`[role="treeitem"][data-node-id="${id}"]`);
async function selectBalloon() {
  await page.getByPlaceholder(/Filter layers/).fill('Speech balloon');
  await layer('n6_hc0005').click();
}
async function editText() {
  await page.getByPlaceholder(/Filter layers/).fill('Balloon text');
  await layer('n8_hc0007').click();
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
}
async function record(name, action) {
  const dir = path.join(WORK, name);
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const filename = path.join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(filename, Buffer.from(data, 'base64'));
    frames.push({ filename, timestamp: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId });
  });
  const mark = (event) => events.push({ recording: name, event, epochSeconds: Date.now() / 1000 });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 96,
    maxWidth: 1440,
    maxHeight: 1000,
    everyNthFrame: 1,
  });
  await wait(400);
  await action(mark);
  await wait(600);
  const ended = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const manifest =
    frames
      .map(
        (frame, i) =>
          `file '${frame.filename}'\nduration ${i + 1 < frames.length ? Math.max(0.001, frames[i + 1].timestamp - frame.timestamp) : Math.max(0.04, ended - frame.timestamp)}\n`,
      )
      .join('') + `file '${frames.at(-1).filename}'\n`;
  fs.writeFileSync(path.join(dir, 'frames.txt'), manifest);
  execFileSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(dir, 'frames.txt'),
    '-vf',
    'fps=30',
    '-c:v',
    'libx264',
    '-threads',
    '2',
    '-crf',
    '15',
    '-pix_fmt',
    'yuv420p',
    path.join(DIR, `${name}.mp4`),
  ]);
  for (const event of events.filter((event) => event.recording === name))
    event.seconds = event.epochSeconds - frames[0].timestamp;
  console.log(
    name,
    frames.length,
    events.filter((event) => event.recording === name),
  );
}
(async () => {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(120000);
  await page.addInitScript(() =>
    localStorage.setItem(
      'strata:onboarding',
      JSON.stringify({
        onboardingComplete: true,
        onboardingVersion: 1,
        skillLevel: 'advanced',
        checklistProgress: ['shape', 'color', 'text', 'group', 'export'],
        dismissedTips: [],
        seenFeatureBadges: [],
        tutorialFileCompleted: true,
      }),
    ),
  );
  await page.goto('http://127.0.0.1:5173/?isoTest=1', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^new$/i }).click({ timeout: 120000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /create/i })
    .first()
    .click();
  await page
    .locator('#file-open-input')
    .setInputFiles(path.join(ROOT, 'marketing/sample-comic/halloween-cookies.varve'));
  await page
    .locator('.missing-font-dialog__overlay')
    .getByRole('button', { name: 'Dismiss', exact: true })
    .click();
  await selectBalloon();
  await page.keyboard.press('Shift+2');
  const zoom = page.locator('input[aria-label^="Zoom "]');
  await zoom.fill('230');
  await zoom.press('Enter');
  await page.getByRole('combobox', { name: 'Balloon style', exact: true }).scrollIntoViewIfNeeded();
  await page.mouse.click(1040, 840);
  await selectBalloon();
  await page
    .getByRole('button', { name: 'Got it', exact: true })
    .click({ timeout: 500 })
    .catch(() => {});
  await wait(700);
  await record('rewrite', async (mark) => {
    mark('selected editable balloon');
    await wait(500);
    await editText();
    await page.keyboard.press('ControlOrMeta+a');
    mark('rewrite starts');
    await page.keyboard.type('Perfect cookies!', { delay: 110 });
    mark('rewrite complete');
    await wait(350);
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await selectBalloon();
    mark('committed same text node');
    await wait(700);
  });
  await record('grow-and-fit', async (mark) => {
    await editText();
    await page.keyboard.press('End');
    mark('longer line starts');
    await page.keyboard.type(' With a little extra magic flour.', { delay: 75 });
    mark('longer line complete');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await selectBalloon();
    mark('fit command visible');
    await page.getByRole('button', { name: 'Fit balloon to text', exact: true }).click();
    mark('balloon fitted');
    await wait(1900);
  });
  await page.getByRole('combobox', { name: 'Balloon style', exact: true }).scrollIntoViewIfNeeded();
  await record('types', async (mark) => {
    for (const type of ['Speech', 'Thought', 'Shout']) {
      if (type !== 'Speech') {
        await page.getByRole('combobox', { name: 'Balloon style', exact: true }).click();
        await page.getByRole('option', { name: new RegExp(`^${type}\\b`) }).click();
      }
      mark(type);
      await wait(1100);
    }
  });
  await page.screenshot({ path: path.join(WORK, 'final.png') });
  fs.writeFileSync(
    path.join(DIR, 'capture-events.json'),
    `${JSON.stringify(
      events.map(({ epochSeconds, ...event }) => event),
      null,
      2,
    )}\n`,
  );
  await context.close();
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  if (page) await page.screenshot({ path: path.join(WORK, 'error.png') }).catch(() => {});
  if (browser) await browser.close();
  process.exit(1);
});
