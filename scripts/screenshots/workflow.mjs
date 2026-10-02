#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
/**
 * Deterministic workflow video capture.
 *
 * Records a 10-20 second editing workflow through the real Varve editor,
 * producing a WebM (and optionally MP4) that demonstrates a real editing flow.
 *
 *   pnpm screenshots:workflow              — record workflow video
 *   pnpm screenshots:workflow -- --no-mp4  — skip ffmpeg transcode
 *   pnpm screenshots:workflow -- --review-dir reports/workflow-review
 *     — isolate output for visual review; canonical media stays untouched
 *
 * Output:
 *   docs/screenshots/product/workflow.webm  — canonical video
 *   apps/website/public/screenshots/workflow.webm — synced for the website
 *   workflow.mp4 (both dirs, when ffmpeg is available)
 *   workflow-poster.png (both dirs) — first frame of the delivered cut;
 *     <video> poster and the reduced-motion still on the website
 *
 * The workflow sequence:
 *   1. Open the poster demo document and fit it (setup — trimmed from the cut)
 *   2. Select the "Display headline" layer — inspector shows real text properties
 *   3. Select the "Contour" path and enter node edit mode — real anchors/handles
 *   4. Exit node edit mode
 *   5. Select the page frame and open the export dialog
 *   6. Close the export dialog and return to a fitted view
 *
 * Node editing is shown on the poster's "Contour" path — an actual Bézier
 * curve. Driving it through a text layer instead would move the headline and
 * misrepresent what node edit mode does.
 *
 * Determinism contract:
 *   Same as product.mjs — fresh context, seeded first-run state, fixed
 *   viewport 1440x900, reduced motion, deterministic fixture documents.
 *
 * The application's cold start (splash, file browser, New-document dialog) is
 * recorded but trimmed off the delivered cut: the trim point is measured at
 * runtime from context creation to "document fitted", so it tracks real load
 * time instead of a hardcoded guess.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { assertPortAvailable, assertReviewDirectorySafe } from './capture-safety.mjs';
import { captureSourceIdentity } from './producer-capture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANONICAL_DIR = join(ROOT, 'docs', 'screenshots', 'product');
const PUBLISHED_DIR = join(ROOT, 'apps', 'website', 'public', 'screenshots');
const args = process.argv.slice(2);
const skipMp4 = args.includes('--no-mp4');
const reviewFlag = args.indexOf('--review-dir');
if (reviewFlag !== -1 && (!args[reviewFlag + 1] || args[reviewFlag + 1].startsWith('--'))) {
  throw new Error('--review-dir requires an output directory');
}
const reviewDir = reviewFlag === -1 ? null : resolve(ROOT, args[reviewFlag + 1]);
if (reviewDir) assertReviewDirectorySafe(reviewDir, [CANONICAL_DIR, PUBLISHED_DIR]);
const OUT_DIR = reviewDir ?? CANONICAL_DIR;
const PUBLIC_DIR = reviewDir ?? PUBLISHED_DIR;
const PORT = Number(process.env.VARVE_SHOT_PORT ?? 1430);
const BASE = `http://localhost:${PORT}`;
const sourceBefore = captureSourceIdentity(ROOT);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

const VIDEO_FILE = 'workflow.webm';
const VIDEO_PATH = join(OUT_DIR, VIDEO_FILE);
const VIDEO_PUBLIC = join(PUBLIC_DIR, VIDEO_FILE);

// First frame of the delivered cut. Serves as the <video> poster and as the
// still shown to reduced-motion users, so both entry points depict exactly
// what playing the video would show.
const POSTER_FILE = 'workflow-poster.png';
const POSTER_PATH = join(OUT_DIR, POSTER_FILE);
const POSTER_PUBLIC = join(PUBLIC_DIR, POSTER_FILE);

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(PUBLIC_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Dev server (shared with product.mjs)                                */
/* ------------------------------------------------------------------ */

async function startServer() {
  await assertPortAvailable(PORT);
  const child = spawn(
    'pnpm',
    ['--filter', '@varve/desktop', 'exec', 'vite', '--port', String(PORT), '--strictPort'],
    {
      cwd: ROOT,
      env: { ...process.env },
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    },
  );
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Vite exited with ${child.exitCode} before readiness`);
    if (await probe()) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stopServer(child);
  throw new Error(`Vite dev server did not come up on :${PORT} within 150s`);
}

function probe() {
  return new Promise((resolve) => {
    import('node:http')
      .then(({ get }) => {
        const r = get(`${BASE}/`, { timeout: 3000 });
        r.on('response', (res) => resolve(res.statusCode === 200));
        r.on('error', () => resolve(false));
      })
      .catch(() => resolve(false));
  });
}

async function stopServer(child) {
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Editor automation (subset of product.mjs helpers)                    */
/* ------------------------------------------------------------------ */

const SEED_FIRST_RUN_STATE = () => {
  try {
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
    );
    localStorage.setItem(
      'strata:tips-today',
      JSON.stringify({ count: 99, date: new Date().toDateString(), shownIds: [] }),
    );
  } catch {}
};

async function openDemoDocument(page, name) {
  const fixture = join(ROOT, 'scripts', 'screenshots', 'fixtures', `${name}.varve`);
  const document = JSON.parse(readFileSync(fixture, 'utf8'));
  await page.setInputFiles('#file-open-input', fixture);
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.editor-shell h1.sr-only')?.textContent?.trim().startsWith(expected),
    basename(fixture),
    { timeout: 30000 },
  );
  await page.locator('.editor-canvas').waitFor({ state: 'visible', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const families = [
    ...new Set(
      Object.values(document.nodes)
        .map((node) => node.fontFamily)
        .filter(Boolean),
    ),
  ];
  for (const family of families) {
    await page.waitForFunction(
      (expected) =>
        [...document.fonts].some(
          (face) => face.family.replace(/["']/g, '') === expected && face.status === 'loaded',
        ),
      family,
      { timeout: 5000 },
    );
  }
}

async function selectLayer(page, pattern) {
  const item = page.getByRole('treeitem').filter({ hasText: pattern }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click({ timeout: 5000 });
  await page.waitForFunction(
    (element) => element.getAttribute('aria-selected') === 'true',
    await item.elementHandle(),
  );
}

async function openCleanEditor(page) {
  await page.goto(`${BASE}/`, { timeout: 120000, waitUntil: 'domcontentloaded' });
  const inSafeMode = await page.evaluate(() => localStorage.getItem(`varve:safe-mode`) !== null);
  if (inSafeMode) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 120000 });
  }
  const recovery = page.locator('dialog[open]').filter({
    hasText: /closed unexpectedly|recover your documents/i,
  });
  if ((await recovery.count()) > 0) {
    await recovery
      .getByRole('button', { name: /review my documents/i })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
  }
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 120000 });
  await newBtn.click({ force: true, timeout: 15000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /create design/i })
    .or(page.locator('dialog[open]').getByRole('button', { name: /create/i }))
    .first()
    .click({ timeout: 30000 });
  await page.locator('.layers-panel').waitFor({ timeout: 120000 });
  await page.locator('.editor-shell').waitFor({ timeout: 15000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const close = openDialogs.last().getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 400 }).catch(() => false)) {
      await close.click({ timeout: 2000 }).catch(() => undefined);
    }
  }
}

async function fitContent(page) {
  const fit = page.getByRole('button', { name: /fit all to viewport/i }).first();
  await fit.waitFor({ state: 'visible', timeout: 8000 });
  await fit.click({ timeout: 5000 });
  await page.waitForTimeout(800);
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.waitForTimeout(500);
}

/* ------------------------------------------------------------------ */
/* Workflow sequence                                                   */
/* ------------------------------------------------------------------ */

/**
 * Drives a deterministic editing workflow that demonstrates core Varve
 * capabilities in a single continuous recording. Each step is a real
 * editor action — no mocks, no staging.
 */
async function runWorkflow(page, onContentReady) {
  // Setup — recorded, then trimmed off the delivered cut.
  await openCleanEditor(page);
  await openDemoDocument(page, 'poster');
  await selectLayer(page, /display headline/i);
  await fitContent(page);
  await settle(page);

  // Everything from here on is what the viewer actually sees.
  onContentReady();
  await page.waitForTimeout(1200);

  // Select the Contour path — an actual Bézier curve — and edit its nodes.
  await selectLayer(page, /contour/i);
  await page.waitForTimeout(600);

  const editNodes = page
    .locator('.selection-quick-bar')
    .getByRole('button', { name: /edit nodes/i });
  if (!(await editNodes.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error('node editing unavailable: no "Edit nodes" control for the Contour path');
  }
  await editNodes.click();
  // Hold on the handles long enough to read them.
  await page.waitForTimeout(2200);

  // Escape alone leaves the node-edit tool active, so its anchors stay drawn
  // on the canvas for the rest of the cut. 'v' is the select tool.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.waitForTimeout(700);

  // Export the whole page, not the layer that happened to be selected.
  await selectLayer(page, /^Poster — A3$/);
  await page.waitForTimeout(500);

  const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
  const exportTab = inspector.getByRole('tab', { name: 'Export', exact: true });
  if (await exportTab.isVisible()) {
    await exportTab.click();
  } else {
    await inspector.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs', exact: true })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
  await page.waitForTimeout(500);
  const advancedBtn = inspector.getByRole('button', { name: 'Open export workspace', exact: true });
  if (!(await advancedBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
    throw new Error('"Open export workspace" control unavailable for the selected frame');
  }
  await advancedBtn.click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(2200);
  await dialog
    .getByRole('button', { name: /close/i })
    .first()
    .click({ timeout: 3000 })
    .catch(() => undefined);
  await page.waitForTimeout(600);

  // End on a clean, fitted frame.
  await fitContent(page);
  await settle(page);
  await page.waitForTimeout(800);
}

/* ------------------------------------------------------------------ */
/* ffmpeg transcode                                                    */
/* ------------------------------------------------------------------ */

function hasFfmpeg() {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'ignore' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

/** Re-encoded (not stream-copied) so the cut lands on the exact trim point. */
function trimToWebm(src, dest, startSeconds) {
  return runFfmpeg([
    '-ss',
    startSeconds.toFixed(2),
    '-i',
    src,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '34',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-an',
    dest,
  ]);
}

function trimToMp4(src, dest, startSeconds) {
  return runFfmpeg([
    '-ss',
    startSeconds.toFixed(2),
    '-i',
    src,
    '-c:v',
    'libx264',
    '-crf',
    '25',
    '-preset',
    'slow',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    dest,
  ]);
}

/** First frame of the delivered cut, as a PNG. */
function extractPoster(src, dest) {
  return runFfmpeg(['-i', src, '-frames:v', '1', '-update', '1', dest]);
}

function probeDuration(path) {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ]);
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('close', () => resolve(Number.parseFloat(out.trim()) || null));
    child.on('error', () => resolve(null));
  });
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const server = await startServer();
let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  await stopServer(server);
  throw error;
}

// Warm the dev server (same pattern as product.mjs)
async function warmUp() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: /^new$/i })
      .waitFor({ state: 'visible', timeout: 180000 });
    console.log('dev server warm');
  } catch (err) {
    console.error(`warm-up did not complete (${err instanceof Error ? err.message : err})`);
  } finally {
    await ctx.close();
  }
}

await warmUp();

let exitCode = 0;

try {
  // Delete any previous workflow video and poster
  rmSync(VIDEO_PATH, { force: true });
  rmSync(VIDEO_PUBLIC, { force: true });
  rmSync(VIDEO_PATH.replace(/\.webm$/, '.mp4'), { force: true });
  rmSync(VIDEO_PUBLIC.replace(/\.webm$/, '.mp4'), { force: true });
  rmSync(POSTER_PATH, { force: true });
  rmSync(POSTER_PUBLIC, { force: true });

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: OUT_DIR,
      size: { width: 1440, height: 900 },
    },
  });
  await ctx.addInitScript(SEED_FIRST_RUN_STATE);
  const page = await ctx.newPage();
  await page.emulateMedia({
    colorScheme: 'light',
    reducedMotion: 'reduce',
    forcedColors: 'none',
  });

  console.log('recording workflow...');
  const startTime = Date.now();
  // Measured, not hardcoded: how much of the recording is cold-start setup.
  let trimStart = 0;

  try {
    await runWorkflow(page, () => {
      trimStart = (Date.now() - startTime) / 1000;
      console.log(`content ready at ${trimStart.toFixed(1)}s — trimming setup before this point`);
    });
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (theme !== 'light') throw new Error(`Workflow requires light theme, received ${theme}`);
  } catch (err) {
    console.error(`workflow failed: ${err instanceof Error ? err.message : err}`);
    exitCode = 1;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`workflow completed in ${elapsed}s`);

  // Stop recording by closing the context — Playwright finalizes the video file
  const video = page.video();
  await ctx.close();

  // Move the recorded video from the temp location to the canonical path
  // Playwright saves videos with a hash-based name in the context's dir
  const videoPath = await video.path();
  if (exitCode === 0 && videoPath && existsSync(videoPath)) {
    const sourceAfter = captureSourceIdentity(ROOT);
    if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) {
      throw new Error('Source changed during workflow recording; rerun from a stable tree');
    }
    const ffmpegAvailable = await hasFfmpeg();
    const mp4Path = VIDEO_PATH.replace(/\.webm$/, '.mp4');
    const mp4Public = VIDEO_PUBLIC.replace(/\.webm$/, '.mp4');

    if (ffmpegAvailable) {
      console.log(`trimming ${trimStart.toFixed(1)}s of cold start...`);
      await trimToWebm(videoPath, VIDEO_PATH, trimStart);
      writeFileSync(VIDEO_PUBLIC, readFileSync(VIDEO_PATH));
      if (!skipMp4) {
        await trimToMp4(videoPath, mp4Path, trimStart);
        writeFileSync(mp4Public, readFileSync(mp4Path));
      }
      try {
        await extractPoster(VIDEO_PATH, POSTER_PATH);
        writeFileSync(POSTER_PUBLIC, readFileSync(POSTER_PATH));
      } catch (err) {
        console.warn(
          `WARN poster extraction failed (${err instanceof Error ? err.message : err}) — website embed falls back to no poster`,
        );
        rmSync(POSTER_PATH, { force: true });
        rmSync(POSTER_PUBLIC, { force: true });
      }
    } else {
      // No ffmpeg: ship the untrimmed WebM rather than nothing, but say so —
      // the cut will open on the application's cold start.
      console.warn('WARN ffmpeg not available: shipping untrimmed WebM, no MP4');
      writeFileSync(VIDEO_PATH, readFileSync(videoPath));
      writeFileSync(VIDEO_PUBLIC, readFileSync(videoPath));
    }
    rmSync(videoPath, { force: true });

    const duration = await probeDuration(VIDEO_PATH);
    if (duration !== null) {
      console.log(`duration: ${duration.toFixed(1)}s`);
      // The delivered cut is a short loop, not a screencast. Drifting past
      // ~20s means the sequence grew and should be re-cut, not shipped long.
      if (duration > 20) {
        console.error(`FAIL workflow video is ${duration.toFixed(1)}s (budget 10-20s)`);
        exitCode = 1;
      } else if (duration < 10) {
        console.warn(`WARN workflow video is only ${duration.toFixed(1)}s (target 10-20s)`);
      }
    }

    for (const [label, path] of [
      ['WebM', VIDEO_PATH],
      ['MP4', mp4Path],
      ['Poster', POSTER_PATH],
    ]) {
      if (!existsSync(path)) continue;
      const bytes = statSync(path).size;
      const mb = (bytes / 1_000_000).toFixed(2);
      console.log(`${label} saved: ${path} (${mb} MB)`);
      if (bytes > 10_000_000) {
        console.error(`FAIL ${label} exceeds 10 MB budget (${mb} MB)`);
        exitCode = 1;
      } else if (bytes > 5_000_000) {
        console.warn(`WARN ${label} is ${mb} MB (warn threshold 5 MB)`);
      }
    }
    if (exitCode === 0) {
      const files = ['workflow.webm', 'workflow.mp4', POSTER_FILE].filter((file) =>
        existsSync(join(OUT_DIR, file)),
      );
      writeFileSync(
        join(OUT_DIR, 'workflow-provenance.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            provenance: sourceBefore,
            captureTool: `Playwright ${JSON.parse(readFileSync(join(ROOT, 'node_modules/@playwright/test/package.json'), 'utf8')).version} / Chromium ${browser.version()}`,
            viewport: { width: 1440, height: 900 },
            deviceScaleFactor: 1,
            theme: 'light',
            files: files.map((file) => ({
              file,
              sha256: digest(readFileSync(join(OUT_DIR, file))),
              bytes: statSync(join(OUT_DIR, file)).size,
            })),
          },
          null,
          2,
        )}\n`,
      );
    }
  } else {
    console.error('FAIL workflow recording or output unavailable; no new capture approved');
    exitCode = 1;
  }
} finally {
  await stopServer(server);
  await browser.close();
}

process.exit(exitCode);
