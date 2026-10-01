#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
/**
 * Product screenshot capture pipeline.
 *
 * Drives the real Varve editor (Vite dev server, same harness as the app
 * E2E suite) into deterministic states and captures marketing screenshots.
 *
 *   pnpm screenshots:product              — capture every scene
 *   pnpm screenshots:product -- --scenes workspace,vector
 *   pnpm screenshots:product -- --strict  — exit non-zero if ANY scene skips
 *
 * Output:
 *   docs/screenshots/product/*.png              — canonical captures
 *   apps/website/public/screenshots/*.png       — synced for the website
 *   apps/website/src/data/screenshot-manifest.json — machine-readable manifest
 *
 * Determinism contract:
 *   - fresh browser context per run (no localStorage/IndexedDB leakage);
 *   - fixed viewport 1440x900, DPR 1, reduced motion;
 *   - fixed content coordinates and tool sequences;
 *   - waits on fonts/canvas/settle rather than fixed sleeps alone;
 *   - mouse parked off-canvas before every capture (no hover ambiguity);
 *   - no text edit mode, no playhead animation, no notifications.
 *
 * If a scene cannot be produced it is recorded as skipped with a reason —
 * never silently replaced by an older screenshot. --strict fails the run.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import {
  assertPortAvailable,
  assertReviewDirectorySafe,
  sourceSceneProvenance,
} from './capture-safety.mjs';
import { analyseImage, buffersEqual, pngDimensions } from './lib/image-analysis.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const reviewFlag = args.indexOf('--review-dir');
const reviewDir = reviewFlag < 0 ? undefined : args[reviewFlag + 1];
if (reviewFlag >= 0 && (!reviewDir || reviewDir.startsWith('--'))) {
  throw new Error('--review-dir requires an output directory');
}
const CANONICAL_DIR = join(ROOT, 'docs', 'screenshots', 'product');
const OUT_DIR = reviewDir ? resolve(reviewDir) : CANONICAL_DIR;
const PUBLIC_DIR = join(ROOT, 'apps', 'website', 'public', 'screenshots');
const MANIFEST_PATH = join(ROOT, 'apps', 'website', 'src', 'data', 'screenshot-manifest.json');
/**
 * Where a failing scene's diagnostic frame goes.
 *
 * This must never be the canonical or published screenshot directory: a debug
 * dump that lands next to published captures looks like a published capture
 * (it broke `validate.mjs`'s orphan check on the shared checkout, 2026-09-29).
 * `reports/` is gitignored, so diagnostics are never committed.
 */
const DEBUG_DIR = join(ROOT, 'reports', 'screenshot-debug');
const PORT = Number(process.env.VARVE_SHOT_PORT ?? 1430);
const BASE = `http://localhost:${PORT}`;

const OUTPUT_DIRS = reviewDir ? [OUT_DIR] : [OUT_DIR, PUBLIC_DIR];
const OUTPUT_MANIFEST = reviewDir ? join(OUT_DIR, 'manifest.json') : MANIFEST_PATH;
if (reviewDir) assertReviewDirectorySafe(OUT_DIR, [CANONICAL_DIR, PUBLIC_DIR]);

// indexOf returns -1 when --scenes is absent, so reading args[index + 1]
// unguarded picks up args[0] — turning `--strict` into a scene filter that
// matches nothing and silently capturing zero scenes.
const scenesFlag = args.indexOf('--scenes');
const onlyScenes = new Set(
  (scenesFlag === -1 ? '' : (args[scenesFlag + 1] ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const strict = args.includes('--strict');

/* ------------------------------------------------------------------ */
/* Provenance, atomic writes, and the manifest concurrency guard        */
/* ------------------------------------------------------------------ */

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function git(args_) {
  try {
    return execFileSync('git', args_, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Source identity for the capture, independent of the volatile run clock.
 *
 * `sourceRevision` is the exact commit; `sourceDirty`/`sourceDigest` describe
 * uncommitted changes to the paths that decide what a capture looks like, so a
 * capture taken from a dirty tree records which tree rather than claiming a
 * clean revision it does not have.
 */
const SOURCE_PATHS = [
  'scripts/screenshots',
  'packages/editor/src',
  'packages/scene/src',
  'packages/engine/src',
  'packages/shared/src',
  'packages/compositor/src',
  'apps/desktop/src',
];
function computeSourceIdentity() {
  const sourceRevision = git(['rev-parse', 'HEAD']) ?? 'unknown';
  const status = git(['status', '--porcelain', '--', ...SOURCE_PATHS]) ?? '';
  const diff = git(['diff', 'HEAD', '--', ...SOURCE_PATHS]) ?? '';
  return {
    sourceRevision,
    sourceDirty: status.length > 0,
    sourceDigest: sha256Hex(`${sourceRevision}\n${status}\n${diff}`).slice(0, 64),
  };
}

function playwrightVersion() {
  for (const p of ['playwright', 'playwright-core']) {
    try {
      return JSON.parse(readFileSync(join(ROOT, 'node_modules', p, 'package.json'), 'utf8'))
        .version;
    } catch {
      /* try the next candidate */
    }
  }
  return 'unknown';
}

/**
 * Write a file atomically: a reader (a website build, another agent) must see
 * either the previous bytes or the new bytes, never a half-written file.
 */
function writeFileAtomicSync(path, data) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

const manifestBytesAtStart = readFileSync(MANIFEST_PATH);
const manifestDigestAtStart = sha256Hex(manifestBytesAtStart);

if (args.includes('--sync-reviewed')) {
  if (!reviewDir || onlyScenes.size === 0) {
    throw new Error('--sync-reviewed requires --review-dir and explicit --scenes');
  }
  const reviewed = JSON.parse(readFileSync(OUTPUT_MANIFEST, 'utf8'));
  // The review manifest records the published manifest it was reviewed
  // against. If the published manifest changed since (another capture run, a
  // concurrent agent), promoting now would silently drop that work.
  const reviewedAgainst = reviewed.reviewedAgainst;
  const currentBytes = readFileSync(MANIFEST_PATH);
  if (reviewedAgainst && sha256Hex(currentBytes) !== reviewedAgainst) {
    throw new Error(
      'Published manifest changed since this review was captured — re-run the review before syncing',
    );
  }
  const current = JSON.parse(currentBytes.toString('utf8'));
  const approved = [...onlyScenes].map((id) => {
    const entry = reviewed.scenes[id];
    if (entry?.status !== 'captured' || basename(entry.file) !== entry.file) {
      throw new Error(`No successful reviewed capture for ${id}`);
    }
    const bytes = readFileSync(join(OUT_DIR, entry.file));
    // Tamper check: the reviewed bytes must still hash to what the review
    // recorded. A modified review file is refused, not promoted.
    if (sha256Hex(bytes) !== entry.sha256) {
      throw new Error(`Reviewed capture changed after capture: ${id}`);
    }
    const analysis = analyseImage(bytes);
    if (!analysis.valid) {
      throw new Error(`Reviewed capture for ${id} does not decode: ${analysis.errors.join('; ')}`);
    }
    return { id, entry, bytes };
  });
  for (const { id, entry, bytes } of approved) {
    // Files first, then the manifest: a build reading the manifest never finds
    // a name whose bytes are not on disk yet.
    writeFileAtomicSync(join(CANONICAL_DIR, entry.file), bytes);
    writeFileAtomicSync(join(PUBLIC_DIR, entry.file), bytes);
    current.scenes[id] = {
      ...entry,
      provenance: {
        ...(entry.provenance ?? {}),
        promotedFrom: reviewed.provenance?.runId ?? 'unknown-review-run',
        promotedAt: new Date().toISOString(),
      },
    };
  }
  current.generatedAt = new Date().toISOString();
  writeFileAtomicSync(MANIFEST_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Synced ${approved.length} reviewed captures; other scenes preserved.`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(PUBLIC_DIR, { recursive: true });

/** PNG dimensions, shared with the validator so both agree on what "valid" means. */
function pngSize(buf) {
  return pngDimensions(buf);
}

/* ------------------------------------------------------------------ */
/* Dev server                                                          */
/* ------------------------------------------------------------------ */

async function startServer() {
  await assertPortAvailable(PORT);
  let serverOutput = '';
  const child = spawn(
    'pnpm',
    ['--filter', '@varve/desktop', 'exec', 'vite', '--port', String(PORT), '--strictPort'],
    {
      cwd: ROOT,
      // Inference scenes need crossOriginIsolated: it gates SharedArrayBuffer
      // (threaded WASM) and raises the safe-model ceiling from 50 MB to
      // 400 MB, which IS-Net at 178 MB sits well above.
      env: {
        ...process.env,
        // A capture must not be reset by another checkout participant's HMR
        // update while a model scene is waiting on a worker result.
        VARVE_DISABLE_HMR: '1',
        ...(process.env.VARVE_SHOT_MODELS && !process.env.VARVE_SHOT_NO_ISOLATION
          ? { VARVE_CROSS_ORIGIN_ISOLATION: '1' }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so the whole tree can be terminated. `pnpm` spawns
      // Vite as a grandchild; killing only the `pnpm` pid left a Vite server
      // listening on the capture port after every run (observed 2026-09-29),
      // which then made the next `--strictPort` capture fail and kept a dev
      // server resident.
      detached: true,
    },
  );
  child.stdout?.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (await probe()) return child;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Vite capture server exited before becoming ready on :${PORT}. ${serverOutput.trim()}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stopServer(child);
  throw new Error(
    `Vite dev server did not come up on :${PORT} within 150s. ${serverOutput.trim()}`,
  );
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

/**
 * Terminate the dev server and everything it spawned.
 *
 * SIGTERM to the process group first (Vite is a grandchild of `pnpm`), then to
 * the direct child as a fallback. Without the group signal the dev server
 * survived the capture and held the port.
 */
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
  // Give it a moment to release the port before the process exits, so the next
  // run does not race a still-listening socket.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

/* ------------------------------------------------------------------ */
/* Editor automation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Suppresses first-run UI before any application script runs.
 *
 * The onboarding checklist, welcome dialog and "Did you know?" tips are
 * correct product behaviour for a new user and completely wrong for a
 * marketing capture — they float over the canvas and change with elapsed
 * time. Seeding the same persisted state a returning user would have is
 * deterministic and does not require the app to grow a screenshot mode.
 */
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
  } catch {
    // Storage unavailable — the capture still runs, dialogs are closed below.
  }
};

/**
 * Opens a committed demo document through the application's own File > Open
 * input. The editor renders it exactly as it renders a user's document; the
 * screenshots therefore show real output, not a staged approximation.
 *
 * Readiness is the *document identity*, not a sleep. The editor exposes the
 * active session name in the shell's screen-reader heading ("<name> — Varve"),
 * so a load that failed or was rejected cannot pass as the intended document:
 * the heading would still name the previous document. A fixed sleep used to
 * sit here, which made the wrong-document capture more likely rather than less.
 */
async function openDemoDocument(page, name) {
  const fixture = join(ROOT, 'scripts', 'screenshots', 'fixtures', `${name}.varve`);
  const expectedName = basename(fixture);
  // The demo documents are committed JSON, so the exact font families they
  // need are knowable up front rather than guessed per scene.
  let requiredFonts = [];
  try {
    const doc = JSON.parse(readFileSync(fixture, 'utf8'));
    requiredFonts = [
      ...new Set(
        Object.values(doc.nodes ?? {})
          .map((node) => node?.fontFamily)
          .filter((family) => typeof family === 'string' && family.length > 0),
      ),
    ];
  } catch {
    // A fixture that does not parse is caught by the identity assertion below.
  }
  await page.setInputFiles('#file-open-input', fixture);
  try {
    await page.waitForFunction(
      (expected) => {
        const heading = document.querySelector('.editor-shell h1.sr-only');
        return !!heading && (heading.textContent ?? '').trim().startsWith(expected);
      },
      expectedName,
      { timeout: 30000 },
    );
  } catch {
    const seen = await page
      .locator('.editor-shell h1.sr-only')
      .textContent({ timeout: 2000 })
      .catch(() => null);
    throw new Error(
      `opening ${expectedName} did not change the active document heading (still "${seen ?? 'unknown'}")`,
    );
  }
  await page.locator('.editor-canvas').waitFor({ state: 'visible', timeout: 30000 });
  // A document whose type would silently render in a substituted face is not a
  // faithful capture of that document.
  await waitForFonts(page, requiredFonts);
}

/**
 * Confirms the fonts a scene needs are actually loaded, not just that
 * `document.fonts.ready` resolved.
 *
 * `document.fonts.ready` resolves once pending loads finish; it does not tell
 * you *which* face was selected, and a substitution (a missing family falling
 * back to a default) resolves just as happily. `check()` reports whether a
 * face matching the given font shorthand is available and loaded, so a
 * missing family fails the scene instead of silently shipping substituted
 * type. Chromium headless can also drop default font families after a
 * beyond-viewport capture (playwright#42962), which is why this is asserted
 * per scene rather than once at startup.
 */
async function waitForFonts(page, families = []) {
  await page.evaluate(() => document.fonts.ready);
  const status = await page.evaluate(() => document.fonts.status);
  if (status !== 'loaded') {
    throw new Error(`fonts did not finish loading (document.fonts.status = "${status}")`);
  }
  for (const family of families) {
    // Wait briefly for a late load to register before declaring it missing.
    const ok = await page
      .waitForFunction(
        (f) =>
          [...document.fonts].some(
            (face) => face.family.replace(/["']/g, '') === f && face.status === 'loaded',
          ),
        family,
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      const available = await page.evaluate(() => [...document.fonts].map((f) => f.family));
      throw new Error(
        `required font "${family}" is not loaded (available: ${available.slice(0, 12).join(', ')})`,
      );
    }
  }
}

/**
 * Imports a real photo fixture through the application's own image-import
 * input — the same `#file-import-input` the e2e suite uses (see
 * tests/e2e/helpers/editor-helpers.ts). Scenes that demonstrate image-based
 * tools (palette extraction, enhance) need genuine photographic content;
 * see fixtures/PROVENANCE.md for the source and license of every photo here.
 */
async function importImage(page, fileName) {
  const fixture = join(ROOT, 'scripts', 'screenshots', 'fixtures', fileName);
  await page.setInputFiles('#file-import-input', fixture);
  await page.getByRole('treeitem').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  // A real (larger, decoded) photo can surface a dialog that a tiny
  // synthetic fixture never does (e.g. a stray onboarding/tips prompt that
  // reflows once real content lands). Clear it defensively — the same
  // stacked-dialog loop openCleanEditor already runs at startup — so it
  // can't intercept the next click.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const close = openDialogs.last().getByRole('button', { name: /close/i }).first();
    if (!(await close.isVisible({ timeout: 400 }).catch(() => false))) break;
    await close.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }
}

/** Selects the (single, just-imported) image node so tool panels act on it. */
async function selectImageNode(page) {
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  await page.getByRole('treeitem').first().click();
  await page.waitForTimeout(200);
}

/**
 * Deterministic framing: identical zoom/pan for every capture of a document.
 *
 * "Fit all" (content bounds) rather than "Fit page": the demo documents are
 * flat documents whose artwork is a frame, so fitting the default page size
 * zooms past the artwork and crops it.
 */
async function fitContent(page) {
  // The status-bar control carries the accessible name "Fit all to viewport";
  // its visible label is "Fit all". Selecting a layer reveals (and zooms to)
  // it, so callers must fit *after* selecting, never before.
  const fit = page.getByRole('button', { name: /fit all to viewport/i }).first();
  await fit.waitFor({ state: 'visible', timeout: 8000 });
  await fit.click({ timeout: 5000 });
  await page.waitForTimeout(800);
  const zoom = await currentZoom(page);
  if (zoom === null) throw new Error('could not read the zoom level to verify framing');
  if (zoom > 110) {
    throw new Error(`fit-all did not frame the document (zoom stayed at ${zoom}%)`);
  }
}

/** Reads the status-bar zoom percentage, used to assert deterministic framing. */
async function currentZoom(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.editor-status__zoom-value');
    return el instanceof HTMLInputElement ? Number(el.value) : null;
  });
}

/** Selects a named layer so the inspector shows real properties, not "No selection". */
async function selectLayer(page, pattern) {
  const panel = page.locator('#editor-layers-panel');
  let openedDrawer = false;
  let item = page.getByRole('treeitem').filter({ hasText: pattern }).first();
  if (!(await item.isVisible({ timeout: 500 }).catch(() => false))) {
    const showLayers = page.getByRole('button', { name: 'Show layers panel' });
    if (await showLayers.isVisible({ timeout: 1000 }).catch(() => false)) {
      await showLayers.click();
      await panel.waitFor({ state: 'visible', timeout: 5000 });
      openedDrawer = true;
      item = page.getByRole('treeitem').filter({ hasText: pattern }).first();
    }
  }
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  if (openedDrawer) {
    await page.getByRole('button', { name: /Collapse Layers panel/ }).click();
    await panel.waitFor({ state: 'hidden', timeout: 5000 });
  }
}

/** Select the Page tool whether it is in the visible toolbar or its Layout overflow. */
async function activatePageTool(page) {
  const toolbar = page.getByTestId('toolbar');
  const pageTool = toolbar.locator('[data-tool="page"]');
  if (await pageTool.isVisible().catch(() => false)) {
    await pageTool.click();
  } else {
    // Print intentionally keeps the Page tool out of its toolbar.
    await page.keyboard.press('q');
  }
  // The overlay wrapper contains only absolutely-positioned children and has
  // zero intrinsic size, so Playwright correctly considers the wrapper hidden.
  // Assert the actual trim outline instead: it is visible only with the Page
  // tool active and an active page selected.
  await expect(page.locator('.page-tool-overlay > div').first()).toBeVisible();
}

async function openCleanEditor(page, { print = false } = {}) {
  await page.goto(`${BASE}/`, { timeout: 120000, waitUntil: 'domcontentloaded' });
  // Crash recovery dialog / safe-mode leftovers must not leak into shots.
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
  if (print) {
    await page
      .locator('dialog[open]')
      .getByText('Advanced settings', { exact: false })
      .first()
      .click({ force: true })
      .catch(() => undefined);
    await page
      .locator('dialog[open]')
      .getByRole('radio', { name: /print/i })
      .first()
      .click({ force: true })
      .catch(() => undefined);
  }
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /create design/i })
    .or(page.locator('dialog[open]').getByRole('button', { name: /create/i }))
    .first()
    .click({ timeout: 30000 });
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 120000 });
  await page.locator('.editor-canvas').waitFor({ state: 'visible', timeout: 30000 });
  // The shell becomes visible before its interaction surfaces finish their
  // first render. A draw issued in that gap can silently leave an empty
  // document, so hand a scene control only after the real canvas and layer
  // tree are mounted at non-zero size (the same readiness contract as E2E).
  const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
  await contentCanvas.waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('.layers-panel').waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas.editor-canvas__content-layer');
      return (
        canvas instanceof HTMLCanvasElement && canvas.clientWidth > 0 && canvas.clientHeight > 0
      );
    },
    undefined,
    { timeout: 60000 },
  );
  await page.waitForTimeout(250);
  // Close stacked startup dialogs deterministically.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const close = openDialogs.last().getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 400 }).catch(() => false)) {
      await close.click({ timeout: 2000 }).catch(() => undefined);
    }
  }
  const exitFocus = page.getByRole('button', { name: /exit distraction-free mode/i });
  if (await exitFocus.isVisible().catch(() => false)) {
    await exitFocus.click({ timeout: 5000 });
    await page.locator('.editor-shell:not(.editor-shell--distraction-free)').waitFor({
      state: 'visible',
      timeout: 8000,
    });
  }
}

/** Opens the image-tools ("Adjustments") tab for a selected image node. */
async function openImageToolsTab(page) {
  const tab = page.getByRole('tab', { name: /^Adjustments/i });
  if (!(await tab.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error('image tools tab unavailable for the selected image');
  }
  await tab.click();
  await page.locator('.insp-disclosure').first().waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * Expands one inspector disclosure and scrolls it to the top of the panel.
 * These sections collapse by default and sit below a long stack, so a capture
 * without this lands on whatever happens to be in the crop instead.
 */
async function expandSection(page, titleRe) {
  const section = page.locator('.insp-disclosure').filter({ hasText: titleRe });
  if (!(await section.isVisible({ timeout: 10000 }).catch(() => false))) {
    throw new Error(`inspector section ${titleRe} not present`);
  }
  const trigger = section.getByRole('button', { name: titleRe }).first();
  if ((await trigger.getAttribute('aria-expanded')) === 'false') {
    await trigger.click();
    await page.waitForTimeout(500);
  }
  await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  return section;
}

/** Wait for an inference result while preserving a visible model error. */
async function waitForInferenceResult(success, section, timeout) {
  const error = section.getByRole('alert').first();
  try {
    return await Promise.race([
      success.waitFor({ state: 'visible', timeout }).then(() => 'success'),
      error
        .waitFor({ state: 'visible', timeout })
        .then(async () => ({ error: (await error.textContent().catch(() => ''))?.trim() })),
    ]);
  } catch {
    return 'timeout';
  }
}

async function parkMouse(page, preserveFocus = false, position = { x: 4, y: 4 }) {
  await page.mouse.move(position.x, position.y);
  if (!preserveFocus) await page.evaluate(() => document.activeElement?.blur?.());
}

/**
 * Wait until the canvas region stops changing, bounded.
 *
 * Two animation frames prove nothing about a rendering pipeline that commits
 * later (a worker bitmap, a deferred replay pass), and a fixed sleep is either
 * too short or wasted. This samples the actual canvas box and returns when two
 * consecutive samples are byte-identical, falling back to "best effort" rather
 * than failing: the blank/near-uniform guard after the capture is what catches
 * a canvas that never painted.
 */
async function waitForStableCanvas(page, { timeoutMs = 6000, intervalMs = 120 } = {}) {
  const box = await page.locator('.editor-canvas').first().boundingBox();
  if (!box || box.width < 4 || box.height < 4) {
    throw new Error('canvas has no measurable geometry before capture');
  }
  const clip = {
    x: Math.max(0, Math.round(box.x)),
    y: Math.max(0, Math.round(box.y)),
    width: Math.max(1, Math.floor(box.width)),
    height: Math.max(1, Math.floor(box.height)),
  };
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  while (Date.now() < deadline) {
    const sample = await page.screenshot({ clip });
    if (previous && buffersEqual(previous, sample)) return true;
    previous = sample;
    await page.waitForTimeout(intervalMs);
  }
  return false;
}

/** Wait for rendering to settle: fonts, then a stable canvas, then a parked mouse. */
async function settle(page, scene = {}) {
  await waitForFonts(page, scene.requireFonts ?? []);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await waitForStableCanvas(page);
  await parkMouse(page, scene.preserveFocus, scene.parkAt);
  await waitForStableCanvas(page, { timeoutMs: 2500 });
}

/**
 * Measure a crop window from a real container instead of fixed coordinates.
 *
 * A scene may declare `clipFrom` — a real container selector — and the clip is
 * measured from that element at capture time. That is preferred for panels,
 * whose internal layout moves as sections are added: the `layers` crop below
 * was tuned to a panel that has since gained a "Design Canvases" block, so its
 * fixed window started framing that block instead of the layer rows.
 */
async function clipFromLocator(page, { selector, top, bottom, padding = 0, maxHeight, minHeight }) {
  const boxOf = async (target) => {
    const box = await page.locator(target).first().boundingBox();
    if (!box || box.width < 8 || box.height < 8) {
      throw new Error(`crop target "${target}" has no measurable layout box`);
    }
    return box;
  };
  // `selector` owns the horizontal extent; `top`/`bottom` (when given) bound the
  // vertical extent, so a crop can frame "from the panel header to the list"
  // without hardcoding either edge.
  const container = await boxOf(selector);
  const topBox = top ? await boxOf(top) : container;
  const bottomBox = bottom ? await boxOf(bottom) : container;
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('viewport unknown while measuring a crop target');
  const left = Math.min(container.x, topBox.x, bottomBox.x);
  const right = Math.max(
    container.x + container.width,
    topBox.x + topBox.width,
    bottomBox.x + bottomBox.width,
  );
  const bottomEdge = Math.max(topBox.y + topBox.height, bottomBox.y + bottomBox.height);
  const x = Math.max(0, Math.floor(left - padding));
  const y = Math.max(0, Math.floor(topBox.y - padding));
  let width = Math.ceil(right - x + padding);
  let height = Math.ceil(bottomEdge - y + padding);
  if (maxHeight) height = Math.min(height, maxHeight);
  if (minHeight) height = Math.max(height, minHeight);
  width = Math.min(width, viewport.width - x);
  height = Math.min(height, viewport.height - y);
  if (width < 8 || height < 8) {
    throw new Error(`crop target "${selector}" measured ${width}x${height} at ${x},${y}`);
  }
  return { x, y, width, height };
}

/**
 * Crop windows for the detail scenes, in 1440x900 viewport coordinates.
 *
 * The website shows these at roughly a third of the page width, where a
 * scaled-down full application frame is an unreadable grey smear. Cropping
 * at capture time keeps the pixels 1:1 and lets each thumbnail show one
 * thing: the canvas artwork, a panel, a tool state.
 */
const CROP = {
  canvas: { x: 288, y: 100, width: 832, height: 620 },
  inspector: { x: 1120, y: 100, width: 320, height: 620 },
  // Full inspector column: starts below the tab strip and stops above the
  // status bar, so a long stack of sections is not clipped mid-row.
  inspectorTall: { x: 1120, y: 122, width: 320, height: 722 },
  // Spans the full width so the track-name column is included, and starts at
  // the panel's own top edge rather than partway up the canvas above it.
  timeline: { x: 0, y: 636, width: 1440, height: 264 },
};

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

const SCENES = [
  {
    id: 'guide-layouts',
    file: 'guide-layouts-light.png',
    theme: 'light',
    feature: 'canvas',
    alt: 'Varve Guide Layouts dialog previewing a column layout over a frame without moving its content',
    caption: 'Preview columns, rows, and square grids before applying them',
    async run(page) {
      await openCleanEditor(page);
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('canvas bounds unavailable for guide-layout capture');
      await page.keyboard.press('f');
      await page.mouse.move(box.x + 180, box.y + 150);
      await page.mouse.down();
      await page.mouse.move(box.x + 620, box.y + 430, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press('v');
      await page.getByRole('menuitem', { name: 'View', exact: true }).click();
      const viewMenu = page.getByRole('menu', { name: 'View' });
      await viewMenu.getByRole('menuitem', { name: 'Guides', exact: true }).hover();
      await page
        .getByRole('menuitem', { name: /^Guide Layouts/ })
        .first()
        .click();
      await expect(page.getByRole('dialog', { name: 'Guide Layouts' })).toBeVisible();
    },
  },
  {
    id: 'workspace',
    file: 'workspace-light.png',
    theme: 'light',
    feature: 'home-showcase',
    alt: 'The Varve workspace: a poster document on the canvas with the layers panel on the left and the properties inspector on the right',
    caption: 'One window — canvas, layers, and properties',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
    },
  },
  {
    id: 'workspace-dark',
    file: 'workspace-dark.png',
    theme: 'dark',
    feature: 'home-showcase',
    alt: 'The same Varve poster document with the application in dark theme',
    caption: 'The same document in dark theme',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
    },
  },
  {
    id: 'patterns',
    file: 'patterns-light.png',
    theme: 'light',
    feature: 'patterns',
    alt: 'An orange vector ellipse repeats across a teal rectangle in Varve while the source ellipse and Pattern Library remain visible',
    caption: 'Apply a copied vector motif to another shape as a reusable pattern',
    async run(page) {
      await openCleanEditor(page);
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error('canvas bounds unavailable for pattern capture');

      await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
      await page.mouse.move(bounds.x + 380, bounds.y + 180);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 690, bounds.y + 410, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press('o');
      await page.mouse.move(bounds.x + 160, bounds.y + 220);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 250, bounds.y + 290, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press('v');
      const source = page.getByRole('treeitem').filter({ hasText: /Ellipse 1/ });
      await source.click();
      const fillColour = page.getByRole('button', { name: /fill colour$/i }).first();
      await fillColour.click();
      const colourPicker = page.getByRole('dialog', { name: /pick fill colour/i });
      const hex = colourPicker.getByLabel('Hex color');
      await hex.fill('#C76B3C');
      await hex.press('Enter');
      await page.keyboard.press('Escape');

      const paintLibrary = page.getByRole('button', { name: 'Paint Library', exact: true });
      if ((await paintLibrary.getAttribute('aria-expanded')) === 'false')
        await paintLibrary.click();
      const patternLibrary = page.getByRole('button', { name: 'Pattern Library', exact: true });
      if ((await patternLibrary.getAttribute('aria-expanded')) === 'false') {
        await patternLibrary.click();
      }
      await page.getByRole('button', { name: /create from selection/i }).click();
      const entry = page.locator('ul[aria-label="Reusable patterns"] > li').first();
      const name = await entry.locator('.insp-paint-library__name').innerText();
      await page
        .getByRole('treeitem')
        .filter({ hasText: /Rectangle 1/ })
        .click();
      await entry.getByRole('button', { name: `Apply ${name} to selection` }).click();
      await expect(
        entry.getByRole('button', { name: `Edit ${name} definition settings` }),
      ).toBeVisible();
      await expect(entry).toContainText('1 use');
      const dismissHint = page.getByRole('button', { name: 'Dismiss hint' });
      if (await dismissHint.isVisible()) await dismissHint.click();
    },
  },
  {
    id: 'presentation-navigator',
    file: 'presentation-navigator-light.png',
    theme: 'light',
    feature: 'presentations',
    alt: 'Varve Design showing an ordered three-slide presentation in the Slides navigator beside the editable canvas',
    caption: 'An explicit slide sequence beside the editable Design canvas',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      const slides = page.getByRole('list', { name: 'Slides in presentation order' });
      await expect(slides.locator(':scope > li')).toHaveCount(3);
      await expect(page.locator('.presentation-navigator__thumbnail img').first()).toBeVisible({
        timeout: 30000,
      });
    },
  },
  {
    id: 'presentation-slide',
    file: 'presentation-slide-light.png',
    theme: 'light',
    feature: 'presentations',
    alt: 'An editable title slide on the Varve Design canvas, with layered teal, sand, and terracotta bars',
    caption: 'Each slide remains an editable frame on the Design canvas',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      await page
        .getByRole('button', { name: /Edit slide/ })
        .first()
        .click();
      await page.locator('.editor-canvas__content-layer').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'presentation-layout-revision',
    file: 'presentation-layout-revision-tablet-dark.png',
    theme: 'dark',
    viewport: { width: 1200, height: 750 },
    hasTouch: true,
    feature: 'presentations',
    alt: 'Varve showing a preview of reusable presentation layout geometry before applying the revision',
    caption: 'Review compatible layout geometry before reapplying it to a slide',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      await page.locator('.presentation-layouts > summary').click();
      await page.getByRole('combobox', { name: 'Layout source' }).click();
      await page.getByRole('option', { name: 'Title / section', exact: true }).click();
      await page.getByRole('combobox', { name: 'Slide object for title' }).click();
      await page.getByRole('option', { name: 'Headline', exact: true }).click();
      await page.getByRole('button', { name: 'Preview and reapply…' }).click();
      await expect(page.getByRole('dialog', { name: 'Review layout changes' })).toContainText(
        'geometry changes',
      );
    },
  },
  {
    id: 'presentation-preview',
    file: 'presentation-preview-light.png',
    theme: 'light',
    feature: 'presentations',
    alt: 'Audience preview displaying a Varve presentation slide without editor dock controls',
    caption: 'Audience preview hides the editing docks; speaker notes stay private',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      await page.getByRole('button', { name: 'Present', exact: true }).click();
      const audience = page.getByRole('dialog', { name: /audience preview/ });
      await expect(audience.locator('.presentation-audience__image')).toBeVisible({
        timeout: 30000,
      });
      await expect(audience).not.toContainText('Internal note:');
    },
  },
  {
    id: 'presentation-export',
    file: 'presentation-export-light.png',
    theme: 'light',
    feature: 'presentations',
    alt: 'Varve presentation export dialog showing raster PDF and ordered PNG sequence output options',
    caption: 'Export an ordered raster PDF or PNG sequence from the local deck',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      await page.getByRole('button', { name: 'Export deck…' }).click();
      const exportDialog = page.getByRole('dialog', { name: /Export Local field notes/ });
      await expect(exportDialog.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
      await expect(exportDialog.getByRole('button', { name: 'Export PNG sequence' })).toBeEnabled();
    },
  },
  {
    id: 'tablet-workspace',
    file: 'tablet-workspace-light.png',
    theme: 'light',
    feature: 'tablet-editing',
    viewport: { width: 1200, height: 750 },
    hasTouch: true,
    alt: 'The Varve poster workspace in tablet presentation, with the Inspector beside the canvas and a touch popover for keyboardless editing actions',
    caption: 'Touch-sized controls and keyboardless editing actions beside the canvas',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
      await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');
      const inspector = page.locator('.editor__inspector-panel');
      await expect(inspector).toBeVisible();
    },
  },
  {
    id: 'tablet-controls',
    file: 'tablet-controls-detail-light.png',
    theme: 'light',
    feature: 'tablet-editing',
    viewport: { width: 1200, height: 750 },
    hasTouch: true,
    clip: { x: 380, y: 70, width: 800, height: 600 },
    alt: 'Tablet editing controls for modifiers, multi-selection, alignment, and layer order beside a Varve poster canvas',
    caption:
      'Constrain, draw from centre, bypass snapping, duplicate, align, and reorder without a keyboard',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      const bodyCopy = page.getByRole('treeitem').filter({ hasText: /body copy/i });
      await bodyCopy.click({ modifiers: ['Shift'] });
      const multiSelectHint = page.getByRole('button', { name: 'Dismiss hint' });
      if (await multiSelectHint.isVisible({ timeout: 1000 }).catch(() => false)) {
        await multiSelectHint.click();
      }
      await fitContent(page);
      await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');
      await page.getByRole('button', { name: 'Tablet editing controls' }).click();
      const controls = page.getByRole('dialog', { name: 'Tablet editing controls' });
      await expect(controls).toBeVisible();
      await expect(controls.getByRole('button', { name: 'Duplicate' })).toBeEnabled();
      await expect(controls.getByRole('button', { name: 'Align left' })).toBeEnabled();
    },
  },
  {
    id: 'vector',
    file: 'vector-light.png',
    theme: 'light',
    feature: 'vector-tools',
    clip: CROP.canvas,
    alt: 'A curved vector shape in Varve with its anchor points and Bézier handles shown in node editing mode',
    caption: 'Node editing with live Bézier handles',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'vector');
      await selectLayer(page, /petal/i);
      await fitContent(page);
      const editNodes = page
        .locator('.selection-quick-bar')
        .getByRole('button', { name: /edit nodes/i });
      if (!(await editNodes.isVisible({ timeout: 4000 }).catch(() => false))) {
        throw new Error('node editing unavailable: no "Edit nodes" control for the selected path');
      }
      await editNodes.click();
      // Keep the handles above the node-controls tray in this detail crop.
      await page.getByRole('button', { name: 'Zoom out' }).click();
      await page.getByRole('button', { name: 'Zoom out' }).click();
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'typography',
    file: 'typography-light.png',
    theme: 'light',
    feature: 'typography',
    clip: CROP.canvas,
    alt: 'A type specimen in Varve showing a display character, a character set, a subhead and a body paragraph',
    caption: 'A type hierarchy set on the canvas',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'type');
      // Select only to drive the fit, then drop the selection: the floating
      // quick bar anchors under the selected node and covers the body
      // paragraph this scene is meant to show.
      await selectLayer(page, /subhead/i);
      await fitContent(page);
      // Escape exits the tool but keeps the selection, so clear it by
      // clicking empty canvas above/left of the specimen card.
      await page.keyboard.press('v');
      // The fitted specimen fills its Page. Zoom back just enough to make a
      // click outside the Page possible; its outer ruler gutters are not part
      // of the drawing surface and cannot clear the selection.
      await page.getByRole('button', { name: 'Zoom out' }).click();
      await page.waitForTimeout(350);
      const canvasBox = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
      if (!canvasBox) throw new Error('canvas bounding box unavailable');
      const quickBar = page.locator('.selection-quick-bar');
      // SelectTool deselects on a click that lands on empty canvas, so aim
      // well clear of both the fitted artwork and the floating toolbar
      // (bottom-centre). The document's own top-left corner is not empty —
      // clicking there just selects the frame and keeps the bar up.
      for (const [dx, dy] of [[40, 140]]) {
        await page.mouse.click(canvasBox.x + dx, canvasBox.y + dy);
        await page.waitForTimeout(600);
        if (!(await quickBar.isVisible({ timeout: 1000 }).catch(() => false))) break;
      }
      // Empty-space clicks are the primary gesture; Escape is the explicit
      // keyboard path and keeps this specimen clear if the fit camera places
      // an off-screen frame beneath either trial point.
      if (await quickBar.isVisible({ timeout: 1000 }).catch(() => false)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }
      if (await quickBar.isVisible({ timeout: 1000 }).catch(() => false)) {
        throw new Error('selection quick bar still visible — it would cover the specimen text');
      }
    },
  },
  {
    id: 'typography-panel',
    file: 'typography-panel-light.png',
    theme: 'light',
    feature: 'typography',
    clip: CROP.inspectorTall,
    alt: 'The Varve properties inspector showing typography controls: font family, weight, style, size, line height and letter spacing',
    caption: 'Type controls for the selected text',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'type');
      await selectLayer(page, /subhead/i);
      await fitContent(page);
      // Typography is order 300 in the section registry, so it renders well
      // below the fold — an unscrolled inspector crop shows Position & Size
      // and Fill instead, which is not what this scene claims to show.
      const typography = page.locator('.insp-disclosure').filter({ hasText: /^Typography/ });
      if (!(await typography.isVisible({ timeout: 8000 }).catch(() => false))) {
        throw new Error('Typography section not present for the selected text node');
      }
      await typography.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(600);
      // Assert the controls the alt text promises are really on screen.
      // NumberField renders its label with the unit appended ("Size (px)"),
      // so these match on prefix rather than exact text.
      for (const label of [
        /^Font family$/,
        /^Weight$/,
        /^Size \(/,
        /^Line height/,
        /^Letter spacing/,
      ]) {
        const row = typography.getByText(label).first();
        if (!(await row.isVisible({ timeout: 3000 }).catch(() => false))) {
          throw new Error(`Typography control ${label} not visible in the captured crop`);
        }
      }
    },
  },
  {
    id: 'font-toolbar',
    preserveFocus: true,
    async verify(page) {
      await expect(page.getByRole('listbox', { name: 'Font families' })).toBeVisible();
    },
    file: 'font-toolbar-light.png',
    theme: 'light',
    feature: 'typography',
    alt: 'The compact text toolbar with its font family menu open above editable text',
    caption: 'Choose a font while editing text',
    async run(page) {
      await openCleanEditor(page);
      const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
      if (!box) throw new Error('Canvas has no bounds');
      await page.keyboard.press('t');
      await page.mouse.click(box.x + 180, box.y + 220);
      await expect(page.getByRole('textbox', { name: /editing text/i })).toBeFocused();
      await page.keyboard.insertText('Make room for good type.');
      const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
      await page.locator('.micro-hint').waitFor({ state: 'hidden' });
      await toolbar.getByRole('combobox', { name: 'Font family' }).click();
      await expect(page.getByRole('listbox', { name: 'Font families' })).toBeVisible();
      await expect(page.getByRole('option', { name: /IBM Plex Sans/ })).toBeVisible();
    },
  },
  {
    id: 'font-browser',
    file: 'font-browser-light.png',
    theme: 'light',
    feature: 'typography',
    alt: 'Browse fonts with a family list and a local specimen alongside font details',
    caption: 'Browse families and inspect a local specimen',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'type');
      await selectLayer(page, /subhead/i);
      await page.getByRole('button', { name: 'Browse fonts', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Browse fonts', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Preview text').fill('Make room for good type.');
      await expect(dialog.locator('.font-browser__specimen')).toHaveText(
        'Make room for good type.',
      );
    },
  },
  {
    id: 'layout',
    file: 'layout-light.png',
    theme: 'light',
    feature: 'layout',
    alt: 'A two-page editorial spread in Varve with headlines, two-column body text and image plates',
    caption: 'A multi-page editorial spread',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'layout');
      await selectLayer(page, /page 12/i);
      await fitContent(page);
    },
  },
  {
    id: 'layers',
    file: 'layers-light.png',
    theme: 'light',
    feature: 'canvas',
    // A taller window lets the panel's layer tree take its flex space instead
    // of being squeezed to its 160px minimum by the sections below it, so the
    // crop shows complete rows rather than one clipped at the bottom edge.
    viewport: { width: 1440, height: 1200 },
    // Measured from the panel's own header through its layer tree. A fixed
    // window here went stale when the panel gained a "Design Canvases" section
    // above the list, so the crop started framing that section instead.
    clipFrom: {
      selector: '.editor__layers-panel',
      top: '.layers-panel__header',
      bottom: '.layers-panel__tree',
    },
    alt: 'The Varve layers panel listing the poster’s named layers, with a blend-mode badge on the Disc layer and opacity badges on the tinted bands',
    caption: 'Layers, blend modes, and opacity',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /disc/i);
      await fitContent(page);
    },
    async verify(page) {
      // The caption claims blend/opacity badges, so at least one layer row with
      // a badge has to be inside the measured crop, not merely somewhere in the
      // panel's scroll extent.
      const tree = page.locator('.layers-panel__tree');
      await expect(tree.getByRole('treeitem').first()).toBeVisible();
      await expect(tree.getByText(/Multiply/).first()).toBeVisible();
      await expect(tree.getByText(/%/).first()).toBeVisible();
    },
  },
  {
    id: 'motion',
    file: 'motion-dark.png',
    theme: 'dark',
    feature: 'motion',
    clip: CROP.timeline,
    alt: 'The Varve timeline panel with a track for the selected layer',
    caption: 'The timeline panel in the motion workspace',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await fitContent(page);
      await selectLayer(page, /disc/i);
      const panel = page.locator('.timeline-panel');
      if (!(await panel.isVisible().catch(() => false))) {
        await page.keyboard.press('Control+Alt+t');
      }
      await panel.waitFor({ state: 'visible', timeout: 8000 });
      const createBtn = page
        .getByTestId('timeline-create-empty')
        .or(page.getByTestId('timeline-create'));
      await createBtn
        .first()
        .click({ timeout: 8000 })
        .catch(() => undefined);
      await page.waitForTimeout(600);
      // Author a real keyframe: Alt+P is the app's own "Add Position
      // Keyframe" shortcut and creates the first track for the selected
      // layer. Without a track the timeline would show an empty state that
      // does not honestly illustrate the motion workspace.
      await page.keyboard.press('Alt+p');
      await page.waitForTimeout(900);
      const empty = await page
        .locator('.timeline-panel')
        .getByText(/no tracks in this timeline/i)
        .isVisible({ timeout: 1500 })
        .catch(() => false);
      if (empty) {
        throw new Error(
          'timeline has no tracks: the Alt+P keyframe shortcut did not author a track, so the scene would misrepresent the motion workspace',
        );
      }
    },
  },
  {
    id: 'palette-inspector',
    file: 'palette-inspector-light.png',
    theme: 'light',
    feature: 'color-effects',
    alt: 'Varve showing a NASA Earth-observation photo on the canvas with the Palette Inspector open, including extracted swatches, generated harmonies, and WCAG contrast pairs',
    caption:
      'Extract an image palette, explore derived harmonies, and review contrast pairs in the Inspector.',
    async run(page) {
      await openCleanEditor(page);
      await importImage(page, 'earth.jpg');
      await selectImageNode(page);
      await fitContent(page);
      await page.keyboard.press('Control+Shift+4');
      await page.waitForTimeout(1000);
      await page.getByRole('tab', { name: /^Design/i }).click();
      // The Design/Properties surface re-renders on tab switch; querying the
      // disclosure immediately after the click can catch it mid-render.
      await page.waitForTimeout(400);
      const paletteSection = page
        .locator('.insp-disclosure')
        .filter({ hasText: /^Extract Palette/ });
      await paletteSection.waitFor({ state: 'visible', timeout: 15000 });
      const paletteTrigger = paletteSection.getByRole('button', { name: /^Extract Palette$/ });
      if ((await paletteTrigger.getAttribute('aria-expanded')) === 'false') {
        await paletteTrigger.click();
        await page.waitForTimeout(500);
      }
      // Wait for the actual loading -> idle transition rather than a fixed
      // sleep or the heading's own timeout: analysis runs in a worker and
      // briefly shows "Analyzing...", and waiting for that round trip is the
      // real deterministic signal, not an arbitrary delay.
      const analyzeBtn = paletteSection.locator(
        '.palette-section__toolbar .intelligence-action-btn',
      );
      await analyzeBtn
        .filter({ hasText: /Analyzing/i })
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => undefined);
      await analyzeBtn
        .filter({ hasText: /^Analyze$/ })
        .waitFor({ state: 'visible', timeout: 20000 })
        .catch(() => undefined);
      const heading = paletteSection.getByRole('heading', { name: 'Extracted colors' });
      if (!(await heading.isVisible({ timeout: 10000 }).catch(() => false))) {
        throw new Error(
          'palette extraction did not produce "Extracted colors" for the photo fixture',
        );
      }
    },
  },
  {
    id: 'solid-picker',
    file: 'solid-picker-light.png',
    theme: 'light',
    feature: 'color-effects',
    alt: 'Varve showing the shared solid color picker beside the selected headline, with the color area, hue and opacity ramps, aligned fields, and swatches visible',
    caption: 'A precise solid-color workflow with the full picker hierarchy in reach.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
      const swatch = page.getByRole('button', { name: 'Fill colour', exact: true });
      await swatch.waitFor({ state: 'visible', timeout: 8000 });
      await swatch.click();
      await page.getByRole('dialog', { name: /pick fill colour/i }).waitFor({
        state: 'visible',
        timeout: 8000,
      });
    },
  },
  {
    id: 'gradient-picker',
    file: 'gradient-picker-light.png',
    theme: 'light',
    feature: 'color-effects',
    alt: 'Varve showing the shared gradient picker with a selected gradient stop, stop bar, color controls, and expanded Gradient options',
    caption:
      'Edit a gradient stop in the same floating panel, then reveal interpolation and geometry options.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
      const fillType = page.getByRole('combobox', { name: 'Fill type', exact: true });
      await fillType.waitFor({ state: 'visible', timeout: 8000 });
      await fillType.click();
      await page.getByRole('option', { name: 'Gradient', exact: true }).click();
      const swatch = page.getByRole('button', { name: 'Fill gradient', exact: true });
      await swatch.waitFor({ state: 'visible', timeout: 8000 });
      await swatch.click();
      const dialog = page.getByRole('dialog', { name: /pick fill gradient/i });
      await dialog.waitFor({ state: 'visible', timeout: 8000 });
      await dialog.getByRole('button', { name: 'Gradient options', exact: true }).click();
    },
  },
  {
    id: 'enhance-dialog-auto',
    file: 'enhance-dialog-auto.png',
    theme: 'light',
    feature: 'image-enhancement',
    alt: 'The Varve Enhance dialog showing a large live before-and-after CPU upscale preview with focus and zoom controls',
    caption: 'Inspect a generated upscale beside the untouched source before applying it.',
    async run(page) {
      await openCleanEditor(page);
      // A visibly degraded derivative of the same rights-cleared photo (see
      // fixtures/PROVENANCE.md) — the clean source is accurately judged as
      // needing no restoration, which doesn't demonstrate what this dialog
      // actually does.
      await importImage(page, 'earth-noisy.jpg');
      await selectImageNode(page);
      await fitContent(page);
      const enhanceBtn = page.getByRole('button', { name: 'Enhance', exact: true });
      if (!(await enhanceBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
        throw new Error('Enhance control unavailable for the selected image');
      }
      await enhanceBtn.click();
      const dialog = page.getByRole('dialog', { name: 'Enhance image' });
      await dialog.waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(400);
      const recommendation = dialog.getByText(/Recommended:/);
      if (!(await recommendation.isVisible({ timeout: 20000 }).catch(() => false))) {
        throw new Error(
          'Enhance Auto analysis produced no "Recommended:" result for the photo fixture',
        );
      }
      // Keep the deterministic Auto analysis in the scene, then select the
      // model-free CPU path so the marketing frame demonstrates a real
      // generated comparison even when optional restoration weights are not
      // installed on the capture machine.
      await dialog.getByRole('combobox', { name: 'Enhancement operation' }).click();
      await page.getByRole('option', { name: 'Upscale', exact: true }).click();
      await dialog
        .getByAltText('Enhanced preview — same crop and output size as original')
        .waitFor({ state: 'visible', timeout: 20000 });
    },
  },
  {
    id: 'export',
    file: 'export-dialog-light.png',
    theme: 'light',
    feature: 'export',
    alt: 'The Varve Inspector Export tab showing Format and Code sub-tabs with quick export presets and generated output options',
    caption: 'Keep export presets and generated code beside the selected object in the Inspector.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /^Poster — A3$/);
      await fitContent(page);
      const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
        hasText: /^export$/i,
      });
      if (await exportTab.isVisible({ timeout: 1500 }).catch(() => false)) {
        await exportTab.click();
      } else {
        const overflow = page.getByRole('button', { name: /More inspector tabs/ });
        await overflow.waitFor({ state: 'visible', timeout: 5000 });
        await overflow.click();
        await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
      }
      const exportPanel = page.locator('#insp-tabpanel-export');
      await exportPanel.waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'vectorize',
    file: 'vectorize-dialog-light.png',
    theme: 'light',
    feature: 'vector-tools',
    alt: 'The Varve Vectorize dialog tracing an imported photograph into editable vector paths, with the overlay preview, path/point/hole diagnostics, and source-versus-vector view tabs',
    caption:
      'Trace an imported image into editable paths — entirely on-device, with prepare/overlay/vector previews before anything is committed.',
    async run(page) {
      await openCleanEditor(page);
      await importImage(page, 'earth.jpg');
      await selectImageNode(page);
      await fitContent(page);
      const vectorize = page
        .locator('.selection-quick-bar')
        .getByRole('button', { name: /vectorize/i });
      if (!(await vectorize.isVisible({ timeout: 4000 }).catch(() => false))) {
        throw new Error('Vectorize control unavailable for the selected image');
      }
      await vectorize.click();
      const dialog = page.getByRole('dialog', { name: /vectorize image/i });
      await dialog.waitFor({ state: 'visible', timeout: 10000 });
      // The dialog opens on the B&W "crisp black logo" preset. That is the
      // right default for line art and the wrong one for a photograph — it
      // traces this fixture into hundreds of paths and surfaces a complexity
      // warning. Colour mode is what a designer would actually pick here.
      // SegmentedControl renders a visually-hidden radio inside its label, so
      // the input has no clickable box of its own — check it directly.
      const colorMode = dialog.getByRole('radio', { name: 'Color', exact: true });
      if ((await colorMode.count()) === 0) {
        throw new Error('Vectorize colour mode control not present');
      }
      await colorMode.check({ force: true, timeout: 8000 });
      if (!(await colorMode.isChecked())) {
        throw new Error('Vectorize did not switch to colour mode');
      }
      // Colour mode re-runs the trace preview; wait for the diagnostics that
      // only render with a settled result instead of a fixed delay, so the
      // capture never shows the previous mode's (or an empty) preview.
      await dialog.locator('.vectorize__diagnostics').waitFor({ state: 'visible', timeout: 30000 });
      // The dialog is taller than the viewport; bring the preview into frame
      // (the point of the capture) before the harness screenshots it.
      await dialog.locator('.vectorize__preview').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
  },
  {
    id: 'effects',
    file: 'effects-light.png',
    theme: 'light',
    feature: 'effects',
    // The shadow itself stays subtle on canvas: the Disc is a Multiply layer
    // at 85% and the shadow sits at 0.3 opacity, so the alt text describes
    // the controls rather than claiming a visible effect on the artwork.
    alt: 'The Varve Effects inspector with a drop shadow added to the selected shape on a poster, showing offset, blur, spread, opacity and blend-mode controls',
    caption: 'Stackable, non-destructive effects — drop shadow, blurs, glows, glitch and more.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      // Select then fit, never the reverse: selecting a layer zooms to it, so
      // a fit followed by a select lands at ~364% with the disc filling the
      // canvas — where a drop shadow is off-screen rather than demonstrated.
      await selectLayer(page, /disc/i);
      await fitContent(page);
      const design = page.getByRole('tab', { name: /^Design/i });
      if (!(await design.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('Design/Properties tab unavailable for the selected shape');
      }
      await design.click();
      await page.waitForTimeout(500);
      const effects = await expandSection(page, /^Layer Effects/);
      // Add a real drop shadow rather than screenshotting an empty section:
      // 'dropShadow' is the default in the "New effect type" select, and the
      // newly added row starts expanded so its controls are on screen.
      // The add control's accessible name has been both "Add" and
      // "Add effect"; match both so a copy change never silently downgrades
      // this scene to a skip (the effects panel review renamed it).
      const addBtn = effects.getByRole('button', { name: /^Add( effect)?$/ });
      await addBtn.click({ timeout: 5000 });
      await page.getByRole('menuitem', { name: 'Drop Shadow', exact: true }).click();
      await page.waitForTimeout(1200);
      await effects.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(600);
      const effectRow = effects.locator('.insp-effect-row').first();
      if ((await effectRow.count()) === 0) {
        throw new Error('no effect row after Add — the section would show an empty state');
      }
      const focusedEditor = page.locator('.insp-focused-editor').first();
      if (!(await focusedEditor.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('effect parameters did not open in the focused editor');
      }
      // The default 0/4/8 shadow is invisible on an A3 poster viewed whole.
      // Scale it to the artwork so the canvas actually shows the effect the
      // panel is describing.
      for (const [label, value] of [
        [/^Y$/, '28'],
        [/^Blur$/, '48'],
      ]) {
        const field = focusedEditor.getByLabel(label).first();
        if (!(await field.isVisible({ timeout: 4000 }).catch(() => false))) {
          throw new Error(`drop shadow field ${label} not available`);
        }
        await field.fill(value);
        await field.press('Enter');
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'background-removal',
    requiresEnv: 'VARVE_SHOT_MODELS',
    file: 'background-removal-light.png',
    theme: 'light',
    feature: 'background-removal',
    alt: 'The Varve background removal inspector after generating a cutout mask on an imported photo, with the mask shown on a checkerboard and confidence reported before applying',
    caption: 'Generate a cutout locally, review the mask on a checkerboard, then apply it.',
    async run(page) {
      await openCleanEditor(page);
      await importImage(page, 'earth.jpg');
      await selectImageNode(page);
      await fitContent(page);
      await openImageToolsTab(page);
      const section = await expandSection(page, /^Background Removal/);
      // Default is Fast, a local heuristic that applies straight away without
      // a review step. Auto runs IS-Net General Use — the real cutout model,
      // and the mode whose mask is worth reviewing before applying.
      const method = section.getByRole('combobox').first();
      await method.click();
      const auto = page.getByRole('option', { name: /auto/i }).first();
      if (!(await auto.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('background removal method list has no Auto option');
      }
      await auto.click();
      await page.waitForTimeout(1500);
      const create = section.getByRole('button', {
        name: /remove background from image|re-apply background removal/i,
      });
      if (!(await create.isVisible({ timeout: 8000 }).catch(() => false))) {
        throw new Error('background removal has no preview action for the selected image');
      }
      await create.click();
      // Inference runs in a worker; the review panel is the completion signal.
      const review = section.getByText(/review mask before applying/i);
      const result = await waitForInferenceResult(review, section, 900000);
      if (result !== 'success') {
        // Report what the panel actually says: "no preview appeared" is not
        // enough to tell a model failure from a changed label.
        const state = (await section.innerText().catch(() => ''))
          .replace(/\s+/g, ' ')
          .slice(0, 240);
        const detail = typeof result === 'object' ? ` — error: ${result.error || 'unknown'}` : '';
        throw new Error(
          `background removal produced no mask preview to review${detail} — panel read: ${state}`,
        );
      }
      await page.waitForTimeout(1200);
    },
  },
  {
    id: 'depth-blur',
    requiresEnv: 'VARVE_SHOT_MODELS',
    file: 'depth-blur-light.png',
    theme: 'light',
    feature: 'depth-aware-effects',
    alt: 'The Varve Depth Blur inspector showing depth-map controls for a photo, with blur amount, focal distance and transition range controls',
    caption: 'A depth map computed on-device drives a non-destructive lens blur.',
    async run(page) {
      await openCleanEditor(page);
      await importImage(page, 'earth.jpg');
      await selectImageNode(page);
      await fitContent(page);
      await openImageToolsTab(page);
      const section = await expandSection(page, /^Depth Blur/);
      const generate = section.getByRole('button', { name: /generate depth map/i });
      if (!(await generate.isVisible({ timeout: 8000 }).catch(() => false))) {
        throw new Error('Depth Blur offers no "Generate Depth Map" action — model likely missing');
      }
      await generate.click();
      // The heatmap canvas is intentionally hidden until Preview Depth is
      // checked, so it cannot be the inference completion signal. The
      // persistent subsection label appears as soon as generation succeeds.
      const ready = section.getByText(/^Depth Map Preview$/);
      // The bundled INT8 model is CPU/WASM-preferred even though the capture
      // browser uses Vulkan for renderer/WebGPU diagnostics: minutes, not
      // seconds.
      const result = await waitForInferenceResult(ready, section, 900000);
      if (result !== 'success') {
        const state = (await section.innerText().catch(() => ''))
          .replace(/\s+/g, ' ')
          .slice(0, 240);
        const detail = typeof result === 'object' ? ` — error: ${result.error || 'unknown'}` : '';
        throw new Error(`depth map never rendered${detail} — panel read: ${state}`);
      }
      const previewToggle = section.getByRole('checkbox', { name: /preview depth/i });
      if (await previewToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
        await previewToggle.check();
      }
      await page.waitForTimeout(1200);
    },
  },
  {
    id: 'image-tools',
    file: 'image-tools-panel-light.png',
    theme: 'light',
    feature: 'visual-awareness',
    clip: CROP.inspectorTall,
    alt: 'The Varve image tools inspector for a selected photo, stacking Image Enhance, Vectorize, Object Selection, Background Removal, Colorize, AI Denoise and Depth Blur sections',
    caption:
      'Image tools for a selected photo — enhance, vectorize, object selection, background removal, depth blur. All run on-device.',
    async run(page) {
      await openCleanEditor(page);
      await importImage(page, 'earth.jpg');
      await selectImageNode(page);
      await fitContent(page);
      const tab = page.getByRole('tab', { name: /^Adjustments/i });
      if (!(await tab.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('image tools tab unavailable for the selected image');
      }
      await tab.click();
      // The panel is lazy-loaded; wait for real controls rather than the tab
      // click alone, or the crop can land on a loading fallback.
      await page.locator('.insp-disclosure').first().waitFor({ state: 'visible', timeout: 15000 });
      const bgSection = page.locator('.insp-disclosure').filter({ hasText: /Background Removal/ });
      if (!(await bgSection.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error(
          'Background Removal section missing — panel would misrepresent image tools',
        );
      }
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'workspaces',
    file: 'workspaces-light.png',
    theme: 'light',
    feature: 'workspaces',
    alt: 'The Varve menubar workspace switcher with the Print workspace selected, showing the panel and toolbar layout that workspace applies',
    caption:
      'Six task workspaces in keyboard order — Print selected with its own panels, toolbar, and inspector.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
      const group = page.getByRole('radiogroup', { name: 'Workspace' });
      await group.waitFor({ state: 'visible', timeout: 8000 });
      const workspaceOrder = await group
        .getByRole('radio')
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label')));
      const expectedOrder = [
        'Design workspace',
        'Print workspace',
        'Draw workspace',
        'Photo workspace',
        'Motion workspace',
        'Email workspace',
      ];
      if (JSON.stringify(workspaceOrder) !== JSON.stringify(expectedOrder)) {
        throw new Error(`Workspace switcher order mismatch: ${workspaceOrder.join(', ')}`);
      }
      const printTab = group.getByRole('radio', { name: /print workspace/i });
      if (!(await printTab.isVisible({ timeout: 4000 }).catch(() => false))) {
        throw new Error('Print workspace tab not present in the workspace switcher');
      }
      await printTab.click();
      // requestWorkspaceSwitch is async and re-lays out the shell; assert the
      // switch actually took rather than capturing mid-transition.
      await page.waitForTimeout(1200);
      if ((await printTab.getAttribute('aria-checked')) !== 'true') {
        throw new Error('Print workspace did not become the active workspace after the click');
      }
      await fitContent(page);
    },
  },
  {
    id: 'workspace-shared-workflows',
    file: 'workspace-shared-workflows-light.png',
    theme: 'light',
    feature: 'workspaces',
    clip: { x: 0, y: 0, width: 936, height: 900 },
    alt: 'The Design workspace with Logo project controls and generated Code output open beside the same poster document',
    caption:
      'Logo tools stay in Design; the shared Code panel remains available alongside the same document.',
    async run(page) {
      const trace = (step) => {
        if (process.env.VARVE_SHOT_DEBUG) {
          console.log(`  [workspace-shared-workflows:step] ${step}`);
        }
      };
      await openCleanEditor(page);
      trace('editor ready');
      await openDemoDocument(page, 'poster');
      trace('poster opened');
      await fitContent(page);
      trace('poster fit');
      // At this width the dock min-size guard exercises the same recoverable
      // compact projection used in the responsive E2E, rather than stretching
      // a saved desktop split over the canvas when three task panels are open.
      await page.setViewportSize({ width: 936, height: 900 });
      await page.waitForTimeout(250);
      const zoomInput = page.locator('#status-zoom');
      await zoomInput.fill('30');
      await zoomInput.press('Enter');
      await zoomInput.evaluate((input) => input.blur());
      await page.waitForTimeout(500);
      trace('viewport and zoom set');
      await page.keyboard.press('Control+Shift+7');
      await expect(page.getByRole('radio', { name: 'Design workspace' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      const logo = page.getByTestId('logo-panel');
      await logo.waitFor({ state: 'visible', timeout: 15000 });
      trace('Logo Tools shown');
      const startProject = logo.getByRole('button', { name: /Start a logo project/i });
      if (await startProject.isVisible().catch(() => false)) await startProject.click();
      const brandName = logo.getByLabel('Brand name');
      await brandName.fill('Varve');
      // Workspace commands intentionally respect text-entry focus. Commit the
      // brand edit before invoking the shared Code workflow shortcut.
      await brandName.evaluate((input) => input.blur());
      trace('Logo project edited');
      await page.keyboard.press('Control+Shift+8');
      const code = page.locator('[data-panel="codegen"]');
      await code.waitFor({ state: 'visible', timeout: 15000 });
      await code.locator('.code-panel__line').first().waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(500);
      trace('shared Code shown');
    },
    async verify(page) {
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      const [shell, logo, code] = await Promise.all([
        page.locator('.editor-shell').boundingBox(),
        page.locator('[data-panel="logo"]').boundingBox(),
        page.locator('[data-panel="codegen"]').boundingBox(),
      ]);
      expect(viewportWidth).toBe(936);
      expect(shell).not.toBeNull();
      expect(logo).not.toBeNull();
      expect(code).not.toBeNull();
      expect(logo.x).toBeGreaterThanOrEqual(shell.x);
      expect(logo.x + logo.width).toBeLessThanOrEqual(shell.x + shell.width + 1);
      expect(code.x).toBeGreaterThanOrEqual(shell.x);
      expect(code.x + code.width).toBeLessThanOrEqual(shell.x + shell.width + 1);
      const unobstructedCanvasLeft = Math.max(shell.x, logo.x + logo.width);
      const unobstructedCanvasRight = Math.min(shell.x + shell.width, code.x);
      expect(unobstructedCanvasRight).toBeGreaterThanOrEqual(unobstructedCanvasLeft);
      expect(unobstructedCanvasRight - unobstructedCanvasLeft).toBeGreaterThanOrEqual(320);
    },
  },
  {
    id: 'print-production',
    file: 'print-production-light.png',
    theme: 'light',
    feature: 'print-production',
    // Leave the pointer in the empty gutter between the page and Inspector so
    // the responsive panel stays open without a hover effect in the capture.
    parkAt: { x: 1435, y: 500 },
    clip: { x: 700, y: 120, width: 740, height: 650 },
    alt: 'A publishing page outlined by 20 px dashed bleed guides, with the Page Print inspector showing the same value on each edge',
    caption: 'Set equal per-edge bleed and check the print boundary on canvas.',
    async run(page) {
      // Bleed is a publishing-page property; this scene authors a real Page
      // and edits its per-edge values through the Page Print inspector.
      await openCleanEditor(page);
      const workspaceGroup = page.getByRole('radiogroup', { name: 'Workspace' });
      await workspaceGroup.waitFor({ state: 'visible', timeout: 8000 });
      const printWorkspace = workspaceGroup.getByRole('radio', { name: /print workspace/i });
      await printWorkspace.click();
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: 'Add publishing page' }).click();
      await page.waitForTimeout(400);
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      await canvas.waitFor({ timeout: 10000 });

      const inspector = page.locator('.editor__inspector-panel');
      const showInspector = page.getByRole('button', { name: 'Show inspector panel' });
      // Choose a calm, legible page scale before opening the responsive
      // Inspector; focusing this status-bar field after opening a drawer
      // correctly returns focus out of that drawer and dismisses it.
      const zoomInput = page.locator('.editor-status__zoom-value');
      await zoomInput.fill('6');
      await zoomInput.press('Enter');
      await expect(zoomInput).toHaveValue('6');
      await page.waitForTimeout(300);

      if (await showInspector.isVisible().catch(() => false)) {
        // The adjacent responsive FABs can overlap at their edges. Dispatch the
        // actual button click handler instead of letting pointer hit-testing
        // choose the neighboring launcher.
        await showInspector.evaluate((button) => button.click());
      }
      await inspector.waitFor({ state: 'visible', timeout: 8000 });

      await activatePageTool(page);
      const pageBounds = await page.locator('.page-tool-overlay > div').first().boundingBox();
      if (!pageBounds) throw new Error('Page tool did not expose the active page trim bounds');
      const pageCenter = {
        x: pageBounds.x + pageBounds.width / 2,
        y: pageBounds.y + pageBounds.height / 2,
      };
      await page.mouse.click(pageCenter.x, pageCenter.y);

      const pagePrintSection = page
        .locator('.insp-disclosure:visible')
        .filter({ hasText: 'Page Print' })
        .first();
      const pagePrintDisclosure = pagePrintSection
        .getByRole('button', { name: 'Page Print' })
        .first();
      await pagePrintDisclosure.waitFor({ state: 'visible', timeout: 8000 });
      if ((await pagePrintDisclosure.getAttribute('aria-expanded')) === 'false') {
        await pagePrintDisclosure.click();
      }
      const bleedTop = pagePrintSection.getByLabel(/bleed top/i);
      await bleedTop.fill('20');
      await pagePrintSection.getByLabel(/bleed right/i).fill('20');
      await pagePrintSection.getByLabel(/bleed bottom/i).fill('20');
      const bleedLeft = pagePrintSection.getByLabel(/bleed left/i);
      await bleedLeft.fill('20');
      await bleedLeft.press('Enter');

      const guide = page.locator('.print-bleed-guide');
      if ((await guide.count()) === 0) {
        await page
          .getByRole('menubar')
          .getByRole('menuitem', { name: /^View$/ })
          .click();
        const showGuides = page.getByRole('menuitem', { name: /show bleed guides/i });
        if (await showGuides.isVisible({ timeout: 1000 }).catch(() => false)) {
          await showGuides.click();
        }
      }
      await guide.waitFor({ state: 'attached', timeout: 5000 });
      if ((await guide.count()) === 0) {
        throw new Error('.print-bleed-guide did not mount after enabling View → Show Bleed Guides');
      }
      const inspectorBox = await inspector.boundingBox();
      if (!inspectorBox || inspectorBox.width < 100) {
        throw new Error('Inspector panel did not open to a usable width for the Print capture');
      }
      await bleedTop.waitFor({ state: 'visible', timeout: 8000 });
      await expect(bleedTop).toHaveValue('20');
    },
  },
];

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

/**
 * E2E-produced scenes: real captures of the running app whose producer is a
 * Playwright spec rather than this script. They are listed here so the
 * manifest stays generated and complete instead of relying on a hardcoded
 * path in a page plus an unmanaged file in `public/screenshots/`.
 *
 * These are *inputs*, not captures: this script verifies and registers the
 * bytes that are already committed, and copies them to the canonical docs
 * directory. Re-recording them is the owning spec's job.
 */
const SOURCE_SCENES = [
  {
    id: 'performance-settings',
    file: 'performance-settings-dark.png',
    producer: 'tests/e2e/settings/performance-guidance.visual.spec.ts',
    alt: "Varve's Performance settings dialog in dark theme, with Automatic interactive preview selected and the local diagnostics panel below it",
    caption: 'Performance settings with opt-in local diagnostics',
    feature: 'performance',
    theme: 'dark',
    kind: 'detail',
  },
  {
    id: 'design-tokens-contrast',
    file: 'design-tokens-alias-bound-light.png',
    producer: 'tests/e2e/inspector/token-binding-runtime.spec.ts',
    alt: 'Varve showing a blue rectangle whose fill is linked to the semantic.brand.curlyAlias token, with the resolved colour painted on the canvas',
    caption:
      'A source alias bound through the Inspector, with its resolved colour painted on the canvas',
    feature: 'design-tokens',
    theme: 'light',
    kind: 'full',
  },
  // Reviewed captures promoted from the specs that own the surface. Their
  // published bytes are committed under public/screenshots; `producer` names
  // the spec the capture came from, and `viewport` is the measured frame, so
  // the geometry check holds for frames that are not the 1440x900 default.
  {
    id: 'effect-studio-desktop-light',
    file: 'effect-studio-desktop-light.png',
    producer: 'tests/e2e/workspace/effect-studio.spec.ts',
    alt: 'Effect Studio on a wide screen, with the treatment preview, gallery, and applied stack arranged side by side.',
    caption: 'Wide workspace with preview, treatments, and editable stack in view.',
    feature: 'effect-studio',
    theme: 'light',
    kind: 'full',
    viewport: { width: 1440, height: 900 },
  },
  {
    id: 'effect-studio-mobile-light',
    file: 'effect-studio-mobile-light.png',
    producer: 'tests/e2e/workspace/effect-studio.spec.ts',
    alt: 'Effect Studio on a phone-sized screen, reflowed into a single scrollable layout with touch-sized controls.',
    caption: 'Phone layout keeps the same order in one scrollable flow.',
    feature: 'effect-studio',
    theme: 'light',
    kind: 'full',
    viewport: { width: 390, height: 844 },
  },
  {
    id: 'illustration-linework-flats',
    file: 'illustration-linework-flats.png',
    producer: 'tests/e2e/canvas/raster-magic-wand.spec.ts',
    alt: 'Varve showing a red apple flat beneath editable black linework on a separate Flats layer',
    caption:
      'Visible-artwork Magic Wand selects inside the ink while a separate Flats layer carries the colour.',
    feature: 'strokes',
    theme: 'light',
    kind: 'full',
    // Measured from the published capture. The page's own `width`/`height`
    // attributes said 1440x1000; the file is 1280x800 — one of the drifts the
    // manifest removes by becoming the single source for geometry.
    viewport: { width: 1280, height: 800 },
  },
  {
    id: 'illustration-clipped-shading',
    file: 'illustration-clipped-shading.png',
    producer: 'tests/e2e/canvas/raster-magic-wand.spec.ts',
    alt: 'Varve Design workspace with red shading clipped inside a blue painted shape on a separate Shading layer',
    caption:
      'The separate Shading layer stays within the source raster alpha across undo, save/reopen, and transparent PNG export.',
    feature: 'strokes',
    theme: 'light',
    kind: 'full',
    viewport: { width: 1440, height: 900 },
  },
  {
    id: 'illustration-vector-clipped-texture',
    file: 'illustration-vector-clipped-texture.png',
    producer: 'tests/e2e/paint/clipped-vector-texture.spec.ts',
    alt: 'Varve Design workspace showing a red raster shading stroke clipped inside a teal vector contour',
    caption:
      'A vector contour and raster shading share one editable document, exported as editable contour geometry with a bounded embedded texture.',
    feature: 'strokes',
    theme: 'light',
    kind: 'full',
    viewport: { width: 1440, height: 900 },
  },
  {
    id: 'concept-art-reference-workflow',
    file: 'concept-art-reference-workflow.png',
    producer: 'tests/e2e/canvas/concept-art-references.spec.ts',
    alt: 'Varve Design workspace with a forest photograph selected as a concept reference and separate sampling and export switches enabled',
    caption:
      'The imported forest photograph stays visible while sampling and export remain independently controlled.',
    feature: 'strokes',
    theme: 'light',
    kind: 'full',
    viewport: { width: 1440, height: 1000 },
  },
];

const manifest = JSON.parse(manifestBytesAtStart.toString('utf8'));
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const sourceIdentity = computeSourceIdentity();
/**
 * A cropped scene's `kind` is derived from the capture geometry it actually
 * asked for, not from a style attribute at the consumer. `panel` is a tall
 * narrow column, `wide` is a short full-width strip, everything else cropped
 * is a `detail`, and an uncropped scene is a `full` frame. The website uses
 * this to pick a fit policy, so a new panel crop is never forced through a
 * landscape `cover` window (which silently cropped the layer rows away).
 */
function sceneKind(scene) {
  if (scene.kind) return scene.kind;
  if (!scene.clip) return 'full';
  // A panel is a narrow column (the inspector / layers sidebar) whether it is
  // a 380px-tall slice or a full-height stack; `wide` is a short full-width
  // strip (the timeline). Everything else cropped is a detail.
  if (scene.clip.width <= 360) return 'panel';
  if (scene.clip.width >= 1200 && scene.clip.height <= 320) return 'wide';
  return 'detail';
}

/**
 * Kind for an externally-produced scene (a plugin or tonal capture, say) whose
 * capture geometry this script does not own. Derived from the measured size of
 * the file that is actually published — a measurement, not a guess.
 */
function kindFromGeometry(width, height) {
  if (height <= 320) return 'wide';
  if (width <= 360) return 'panel';
  if (width >= 1024 && height >= 600) return 'full';
  return 'detail';
}

let failures = 0;
let ranThisRun = 0;
let capturedThisRun = 0;
let optedOut = 0;
const skippedThisRun = [];

/**
 * `--normalize`: re-derive the manifest's *measurable* metadata from the files
 * that are already published, without recapturing a single pixel.
 *
 * Why this exists: several scenes' screenshots were captured before the
 * manifest recorded `kind`/`crop`/`viewport`, and recapturing all 32 scenes to
 * add a metadata field would needlessly churn committed binaries (and would
 * overwrite a capture another agent is actively iterating on). Dependency-aware
 * freshness says an unchanged screenshot should not be re-shot for a metadata
 * change.
 *
 * What it will and will not write:
 *   - writes: dimensions, hashes and geometry *measured from the real files*,
 *     plus this run's provenance block;
 *   - refuses: `capturedAt` and `lastValidatedAgainst` for scenes this run did
 *     not capture, and instead marks them `provenanceUnknown: true` so a
 *     legacy record is honest rather than backfilled with a guessed revision.
 */
function normalizeManifest() {
  let changed = 0;
  for (const scene of SCENES) {
    const entry = manifest.scenes[scene.id] ?? {};
    const publishedPath = join(PUBLIC_DIR, scene.file);
    if (!existsSync(publishedPath)) {
      if (entry.status === 'captured' || Object.keys(entry).length > 0) {
        console.error(`FAIL ${scene.id}: no published capture at ${scene.file}`);
        failures++;
      }
      continue;
    }
    const bytes = readFileSync(publishedPath);
    const analysis = analyseImage(bytes);
    if (!analysis.valid) {
      console.error(
        `FAIL ${scene.id}: ${scene.file} does not decode: ${analysis.errors.join('; ')}`,
      );
      failures++;
      continue;
    }
    const recordedHash = sha256Hex(bytes);
    const wasCaptured = entry.status === 'captured';
    if (wasCaptured && entry.sha256 && entry.sha256 !== recordedHash) {
      // The file on disk is not the file the manifest describes: normalising
      // would launder an edited asset into a trusted record.
      console.error(`FAIL ${scene.id}: ${scene.file} does not match its recorded sha256`);
      failures++;
      continue;
    }
    const next = {
      ...entry,
      file: scene.file,
      alt: scene.alt,
      caption: scene.caption,
      feature: scene.feature,
      theme: scene.theme,
      kind: sceneKind(scene),
      width: analysis.width,
      height: analysis.height,
      status: 'captured',
      reason: undefined,
      sha256: recordedHash,
      crop: scene.clip ? { ...scene.clip } : undefined,
      viewport:
        scene.viewport && (scene.viewport.width !== 1440 || scene.viewport.height !== 900)
          ? { ...scene.viewport }
          : undefined,
      scale: 1,
    };
    if (!entry.capturedAt && !entry.lastValidatedAgainst) next.provenanceUnknown = true;
    if (JSON.stringify(next) !== JSON.stringify(entry)) changed++;
    manifest.scenes[scene.id] = next;
  }
  // Externally-produced scenes (plugin, tonal, comic) are not in SCENES, so
  // they never pass through `sceneKind`. Derive their kind from the measured
  // size of the published file so the website has a fit policy for every
  // captured scene rather than only for the ones this script captures.
  for (const [id, entry] of Object.entries(manifest.scenes)) {
    if (entry.status !== 'captured' || entry.kind || !entry.width || !entry.height) continue;
    manifest.scenes[id] = { ...entry, kind: kindFromGeometry(entry.width, entry.height) };
    changed++;
  }
  for (const source of SOURCE_SCENES) {
    const publishedPath = join(PUBLIC_DIR, source.file);
    if (!existsSync(publishedPath)) {
      console.error(`FAIL source scene ${source.id}: no ${source.file} in public/screenshots`);
      failures++;
      continue;
    }
    const bytes = readFileSync(publishedPath);
    const analysis = analyseImage(bytes);
    if (!analysis.valid) {
      console.error(`FAIL source scene ${source.id}: ${source.file} does not decode`);
      failures++;
      continue;
    }
    if (reviewDir) {
      writeFileAtomicSync(join(OUT_DIR, source.file), bytes);
    } else {
      writeFileAtomicSync(join(CANONICAL_DIR, source.file), bytes);
    }
    const previous = manifest.scenes[source.id] ?? {};
    const sourceHash = sha256Hex(bytes);
    const provenance = sourceSceneProvenance(previous, sourceHash);
    manifest.scenes[source.id] = {
      ...previous,
      file: source.file,
      alt: source.alt,
      caption: source.caption,
      feature: source.feature,
      theme: source.theme,
      kind: source.kind,
      width: analysis.width,
      height: analysis.height,
      status: 'captured',
      reason: undefined,
      sha256: sourceHash,
      source: source.producer,
      // The measured frame, so the geometry check holds for a capture whose
      // frame differs from the 1440x900 default (a phone-sized or taller one).
      viewport: source.viewport ? { ...source.viewport } : undefined,
      ...provenance,
    };
  }
  const nowBytes = readFileSync(MANIFEST_PATH);
  if (sha256Hex(nowBytes) !== manifestDigestAtStart) {
    console.error('FAIL the manifest changed while normalising — refusing to overwrite it');
    process.exit(1);
  }
  manifest.schemaVersion = 2;
  manifest.generatedAt = new Date().toISOString();
  manifest.provenance = {
    runId,
    runtime: 'metadata-only (--normalize; no capture)',
    captureTool: `playwright ${playwrightVersion()}`,
    sourceRevision: sourceIdentity.sourceRevision,
    sourceDirty: sourceIdentity.sourceDirty,
    sourceDigest: sourceIdentity.sourceDigest,
  };
  manifest.sourceRevision = sourceIdentity.sourceRevision;
  manifest.sourceDigest = sourceIdentity.sourceDigest;
  manifest.captureTool = manifest.provenance.captureTool;
  if (reviewDir) manifest.reviewedAgainst = manifestDigestAtStart;
  writeFileAtomicSync(OUTPUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `normalised manifest: ${changed} scene record(s) updated, ${failures} failure(s) → ${OUTPUT_MANIFEST}`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

if (args.includes('--normalize')) normalizeManifest();

/**
 * Chromium exposes `navigator.gpu` on a secure context by default, but with no
 * adapter behind it — and the inference paths ask for a *hardware* adapter
 * (`requireHardwareAdapter: true`), so they get nothing and fall back to CPU
 * WASM, where a depth pass does not finish in any time a capture can wait for.
 *
 * Routing ANGLE through Vulkan surfaces the real GPU in headless: on an AMD
 * iGPU this reports vendor "amd", architecture "rdna-2". SwiftShader also
 * yields an adapter, but a software one the hardware check rejects — so the
 * Vulkan flags are the ones that matter, not merely "some adapter".
 *
 * Only for model runs. GPU rasterization can shift canvas output subtly, and
 * the ordinary scenes are a committed visual baseline that should not move
 * because a capture host happens to have a GPU.
 */
const GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
];
const browser = await chromium.launch(process.env.VARVE_SHOT_MODELS ? { args: GPU_ARGS } : {});
const server = await startServer();

/**
 * One throwaway load before the scene loop.
 *
 * The dev server transforms and pre-bundles the application's module graph on
 * the first request. Paying that cost inside the first scene made the app
 * miss its 120s boot budget intermittently and skip a perfectly capturable
 * scene; warming it once up front makes every scene start from a hot server.
 */
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

try {
  for (const scene of SCENES) {
    if (onlyScenes.size > 0 && !onlyScenes.has(scene.id)) continue;
    // Scenes that need on-device inference are opt-in. Their models are a
    // local prerequisite (gitignored), and the bundled INT8 model runs on CPU
    // through WASM even though model-mode Chromium enables Vulkan. A default
    // run must neither block on them nor fail --strict for skipping them.
    // Opting out drops the manifest entry entirely rather than leaving a
    // permanent "skipped" record behind.
    if (scene.requiresEnv && !process.env[scene.requiresEnv]) {
      if (manifest.scenes[scene.id]) {
        const stale = manifest.scenes[scene.id];
        if (stale.file) {
          for (const dir of OUTPUT_DIRS) rmSync(join(dir, stale.file), { force: true });
        }
        delete manifest.scenes[scene.id];
      }
      optedOut++;
      console.log(`skipping ${scene.id} (set ${scene.requiresEnv}=1 to capture it)`);
      continue;
    }
    // SCENES is the source of truth for what exists; the manifest is a
    // generated view of it, so a newly added scene seeds its own entry
    // rather than requiring a hand-edit of a file marked "do not hand-edit".
    manifest.scenes[scene.id] ??= {};
    const entry = manifest.scenes[scene.id];
    ranThisRun++;
    const ctx = await browser.newContext({
      viewport: scene.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      ...(scene.hasTouch ? { hasTouch: true } : {}),
    });
    await ctx.addInitScript(SEED_FIRST_RUN_STATE);
    const page = await ctx.newPage();
    // A scene that stalls (inference in particular) reports only the UI text
    // it got stuck on, which cannot distinguish "still working" from "threw
    // and the spinner never cleared". VARVE_SHOT_DEBUG surfaces the console.
    if (process.env.VARVE_SHOT_DEBUG) {
      page.on('console', async (msg) => {
        const values = await Promise.all(
          msg
            .args()
            .map((arg) =>
              arg
                .evaluate((value) =>
                  value instanceof Error
                    ? { name: value.name, message: value.message, stack: value.stack }
                    : String(value),
                )
                .catch(() => '[unserializable console value]'),
            ),
        );
        const serialized = JSON.stringify(values);
        console.log(
          `  [${scene.id}:${msg.type()}] ${
            msg.type() === 'error' ? serialized.slice(0, 8000) : serialized.slice(0, 1200)
          }`,
        );
      });
      page.on('pageerror', (err) =>
        console.log(`  [${scene.id}:pageerror] ${String(err).slice(0, 300)}`),
      );
      // Inference runs in a Web Worker, and a worker's console does not reach
      // the page's console event — so the one place an ONNX failure reports
      // itself was invisible to every run above.
      page.on('worker', (worker) => {
        console.log(`  [${scene.id}:worker] started ${worker.url().split('/').pop()}`);
        worker.on('close', () => console.log(`  [${scene.id}:worker] closed`));
      });
    }
    try {
      await page.emulateMedia({
        colorScheme: scene.theme,
        reducedMotion: 'reduce',
        forcedColors: 'none',
      });
      await scene.run(page);
      await settle(page, scene);
      await scene.verify?.(page);
      // Detail scenes are cropped at capture time so the website can show
      // them small without scaling a full window down to an unreadable smear.
      // A scene with `clipFrom` measures its own window from the real
      // container now that panels, fonts and selection have settled.
      const clip = scene.clipFrom ? await clipFromLocator(page, scene.clipFrom) : scene.clip;
      const shot = await page.screenshot(clip ? { clip } : undefined);
      const dims = pngSize(shot);
      // Full frames are 1440x900; cropped details are smaller but must still
      // match the clip they asked for, which catches a mis-laid-out capture.
      const expected = clip ?? scene.viewport ?? { width: 1440, height: 900 };
      if (!dims || dims.width !== expected.width || dims.height !== expected.height) {
        throw new Error(
          `screenshot malformed: got ${JSON.stringify(dims)}, expected ${expected.width}x${expected.height}`,
        );
      }
      // A valid PNG is not proof of a valid screenshot: a blank canvas, a
      // uniform panel and a broken render all encode to a perfectly legal
      // file. Reject obviously empty output before it can be published.
      const analysis = analyseImage(shot);
      if (!analysis.valid) {
        throw new Error(`capture does not decode cleanly: ${analysis.errors.join('; ')}`);
      }
      for (const dir of OUTPUT_DIRS) {
        // Temp + rename: a website build (or another agent) reading the
        // published directory must never observe a partially written image.
        writeFileAtomicSync(join(dir, scene.file), shot);
      }
      entry.sha256 = sha256Hex(shot);
      entry.file = scene.file;
      entry.alt = scene.alt;
      entry.caption = scene.caption;
      entry.feature = scene.feature;
      entry.theme = scene.theme;
      entry.kind = sceneKind({ ...scene, clip: scene.clip ?? clip });
      entry.width = dims.width;
      entry.height = dims.height;
      entry.status = 'captured';
      entry.reason = undefined;
      entry.source = undefined;
      entry.crop = clip ? { ...clip } : undefined;
      entry.viewport =
        scene.viewport && (scene.viewport.width !== 1440 || scene.viewport.height !== 900)
          ? { ...scene.viewport }
          : undefined;
      entry.scale = 1;
      entry.capturedAt = new Date().toISOString();
      entry.provenanceUnknown = undefined;
      // The revision this image is evidence about. Previously written as a
      // permanent null, which made the field meaningless.
      entry.lastValidatedAgainst = sourceIdentity.sourceRevision;
      capturedThisRun++;
      console.log(
        `captured ${scene.id} -> ${join(OUT_DIR, scene.file)} (${dims.width}x${dims.height}, ${entry.kind})`,
      );
    } catch (err) {
      // Descriptive fields are written on the failure path too: a skipped
      // scene still has to carry its file name, alt text and feature so the
      // manifest stays a complete inventory rather than a bare error stub.
      entry.file = scene.file;
      entry.alt = scene.alt;
      entry.caption = scene.caption;
      entry.feature = scene.feature;
      entry.theme = scene.theme;
      entry.status = 'skipped';
      entry.reason = String(err instanceof Error ? err.message : err).slice(0, 400);
      entry.lastValidatedAgainst = null;
      entry.sha256 = undefined;
      entry.width = undefined;
      entry.height = undefined;
      entry.capturedAt = undefined;
      // Delete any previous output for this scene. A skipped scene must not
      // leave a stale screenshot behind for the site to keep serving — that
      // is exactly the silent substitution this pipeline exists to prevent.
      for (const dir of OUTPUT_DIRS) {
        rmSync(join(dir, scene.file), { force: true });
      }
      console.error(`SKIPPED ${scene.id}: ${entry.reason}`);
      // A skip reports the text it gave up on, which is rarely enough to tell
      // what the UI was actually showing. Keep the frame under VARVE_SHOT_DEBUG
      // so a failure can be looked at rather than only read about — but never
      // in a screenshot output directory, where it would sit beside published
      // captures and be mistaken for one.
      if (process.env.VARVE_SHOT_DEBUG) {
        const layout = await page
          .evaluate(() => {
            const describe = (selector) => {
              const element = document.querySelector(selector);
              if (!(element instanceof HTMLElement)) return null;
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                display: style.display,
                visibility: style.visibility,
                pointerEvents: style.pointerEvents,
                transform: style.transform,
                inlineStyle: element.getAttribute('style'),
                dataVisible: element.getAttribute('data-visible'),
              };
            };
            return {
              viewport: { width: innerWidth, height: innerHeight },
              layoutMode: document.documentElement.dataset.layoutMode,
              shell: describe('.editor-shell'),
              dock: describe('.editor-shell__canvas-dock'),
              inspector: describe('.editor__inspector-panel'),
              launcher: describe('.editor__fab--inspector'),
              toolbar: describe('[data-testid="toolbar"]'),
              moreTools: describe('[data-testid="toolbar-more-tools"]'),
              pageTool: describe('[data-testid="toolbar"] [data-tool="page"]'),
              backdrop: describe('.editor__panel-backdrop'),
            };
          })
          .catch(() => null);
        console.error(`  layout: ${JSON.stringify(layout)}`);
        mkdirSync(DEBUG_DIR, { recursive: true });
        const debugPath = join(DEBUG_DIR, `${runId}-${scene.id}.png`);
        await page
          .screenshot({ path: debugPath })
          .then(() => console.error(`  wrote ${debugPath}`))
          .catch(() => undefined);
      }
      if (strict) failures++;
      skippedThisRun.push(scene.id);
    } finally {
      await ctx.close();
    }
  }
  // Drop manifest entries whose scene no longer exists. Only safe on a full
  // run — a --scenes run intentionally leaves the other entries untouched.
  if (onlyScenes.size === 0) {
    const live = new Set(SCENES.map((s) => s.id));
    for (const id of Object.keys(manifest.scenes)) {
      if (live.has(id) || manifest.scenes[id]?.source) continue;
      const stale = manifest.scenes[id];
      if (stale?.file) {
        for (const dir of OUTPUT_DIRS) rmSync(join(dir, stale.file), { force: true });
        for (const variant of stale.variants ?? []) {
          for (const dir of OUTPUT_DIRS) rmSync(join(dir, variant.file), { force: true });
        }
      }
      delete manifest.scenes[id];
      console.log(`pruned removed scene ${id}`);
    }
  }

  // E2E-produced scenes: real captures whose producer is a Playwright spec and
  // whose bytes are already committed to public/screenshots. They are not
  // recaptured here, but they must still be first-class manifest entries —
  // otherwise the only trace of them is a hardcoded path in a page and an
  // orphan file the validator rejects.
  for (const source of SOURCE_SCENES) {
    const publishedPath = join(PUBLIC_DIR, source.file);
    if (!existsSync(publishedPath)) {
      console.warn(`skipping source scene ${source.id} (no ${source.file} in public/screenshots)`);
      continue;
    }
    const bytes = readFileSync(publishedPath);
    const analysis = analyseImage(bytes);
    if (!analysis.valid) {
      throw new Error(
        `source scene ${source.id}: ${source.file} does not decode: ${analysis.errors.join('; ')}`,
      );
    }
    const previous = manifest.scenes[source.id] ?? {};
    const sourceHash = sha256Hex(bytes);
    const provenance = sourceSceneProvenance(previous, sourceHash);
    if (reviewDir) {
      writeFileAtomicSync(join(OUT_DIR, source.file), bytes);
    } else {
      writeFileAtomicSync(join(CANONICAL_DIR, source.file), bytes);
    }
    manifest.scenes[source.id] = {
      ...previous,
      file: source.file,
      alt: source.alt,
      caption: source.caption,
      feature: source.feature,
      theme: source.theme,
      kind: source.kind,
      width: analysis.width,
      height: analysis.height,
      status: 'captured',
      reason: undefined,
      sha256: sourceHash,
      source: source.producer,
      // The measured frame, so the geometry check holds for a capture whose
      // frame differs from the 1440x900 default (a phone-sized or taller one).
      viewport: source.viewport ? { ...source.viewport } : undefined,
      ...provenance,
    };
  }

  // Concurrency guard: this process read the manifest once, at startup, and a
  // capture run can take many minutes. If another writer (a second capture, a
  // concurrent agent) changed it in the meantime, writing our snapshot would
  // silently discard their scenes. Refuse instead of clobbering.
  const manifestBytesNow = readFileSync(MANIFEST_PATH);
  if (OUTPUT_MANIFEST === MANIFEST_PATH && sha256Hex(manifestBytesNow) !== manifestDigestAtStart) {
    throw new Error(
      'the screenshot manifest changed while this run was capturing — refusing to overwrite it. ' +
        'Re-run the capture; use --review-dir to capture without touching published state.',
    );
  }

  manifest.schemaVersion = 2;
  manifest.generatedAt = new Date().toISOString();
  manifest.provenance = {
    runId,
    runtime: 'chromium-headless (web)',
    captureTool: `playwright ${playwrightVersion()} / chromium ${browser.version()}`,
    sourceRevision: sourceIdentity.sourceRevision,
    sourceDirty: sourceIdentity.sourceDirty,
    sourceDigest: sourceIdentity.sourceDigest,
    viewport: { width: 1440, height: 900 },
    scale: 1,
    reducedMotion: true,
  };
  // Top-level identity fields are what the validator checks; `provenance` is
  // the detailed record. Content identity (sha256 per scene) never contains a
  // timestamp; `generatedAt` is volatile and lives only here.
  manifest.sourceRevision = sourceIdentity.sourceRevision;
  manifest.sourceDigest = sourceIdentity.sourceDigest;
  manifest.captureTool = manifest.provenance.captureTool;
  if (reviewDir) manifest.reviewedAgainst = manifestDigestAtStart;
  writeFileAtomicSync(OUTPUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest written: ${OUTPUT_MANIFEST}`);
} finally {
  await stopServer(server);
  await browser.close();
}

// Reported separately from the manifest totals below: a run that captures
// nothing still leaves a manifest full of previously-captured scenes, which
// reads like success unless this run's own tally is shown.
console.log(
  `this run: ${ranThisRun} scene(s) attempted, ${capturedThisRun} captured, ` +
    `${skippedThisRun.length} failed-to-capture, ${optedOut} opted out` +
    `${skippedThisRun.length > 0 ? ` (${skippedThisRun.join(', ')})` : ''}`,
);
// Opting out is a deliberate choice, not a mis-typed filter — only an empty
// run with nothing opted out means the selection matched nothing.
if (ranThisRun === 0 && optedOut === 0) {
  console.error('FAIL no scenes ran — check the --scenes filter');
  failures++;
}

const captured = Object.values(manifest.scenes).filter((s) => s.status === 'captured').length;
const skipped = Object.values(manifest.scenes).filter((s) => s.status === 'skipped').length;
const untouched = Object.entries(manifest.scenes).filter(
  ([id, s]) => s.status === 'captured' && onlyScenes.size > 0 && !onlyScenes.has(id),
).length;
console.log(
  `manifest: ${captured} captured (${untouched} untouched by this run), ${skipped} skipped, ${failures} failure(s)`,
);
process.exit(failures > 0 ? 1 : 0);
