#!/usr/bin/env node
import { spawn } from 'node:child_process';
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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'docs', 'screenshots', 'product');
const PUBLIC_DIR = join(ROOT, 'apps', 'website', 'public', 'screenshots');
const MANIFEST_PATH = join(ROOT, 'apps', 'website', 'src', 'data', 'screenshot-manifest.json');
const PORT = Number(process.env.VARVE_SHOT_PORT ?? 1430);
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
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

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(PUBLIC_DIR, { recursive: true });

/** Minimal PNG size reader (width/height live in the IHDR at fixed offsets). */
function pngSize(buf) {
  if (buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((b, i) => buf[i] !== b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* ------------------------------------------------------------------ */
/* Dev server                                                          */
/* ------------------------------------------------------------------ */

async function startServer() {
  const child = spawn(
    'pnpm',
    ['--filter', '@varve/desktop', 'exec', 'vite', '--port', String(PORT), '--strictPort'],
    {
      cwd: ROOT,
      env: { ...process.env },
      stdio: 'ignore',
      detached: false,
    },
  );
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (await probe()) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
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
    child.kill('SIGTERM');
  } catch {}
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
 */
async function openDemoDocument(page, name) {
  const fixture = join(ROOT, 'scripts', 'screenshots', 'fixtures', `${name}.varve`);
  await page.setInputFiles('#file-open-input', fixture);
  // The new document opens in its own tab; wait for the title to switch.
  await page.waitForTimeout(1500);
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
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
  const item = page.getByRole('treeitem').filter({ hasText: pattern }).first();
  if (await item.isVisible({ timeout: 4000 }).catch(() => false)) {
    await item.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
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
  await page.locator('.layers-panel').waitFor({ timeout: 120000 });
  await page.locator('.editor-shell').waitFor({ timeout: 15000 });
  // Close stacked startup dialogs deterministically.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const close = openDialogs.last().getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 400 }).catch(() => false)) {
      await close.click({ timeout: 2000 }).catch(() => undefined);
    }
  }
}

async function parkMouse(page) {
  await page.mouse.move(4, 4);
  await page.evaluate(() => document.activeElement?.blur?.());
}

/** Wait for rendering to settle: fonts + two frames + replay pass. */
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.waitForTimeout(700);
  await parkMouse(page);
  await page.waitForTimeout(300);
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
  // Starts below the document thumbnail and Pages strip so the crop lands on
  // the layer rows themselves, where the blend/opacity badges are.
  layers: { x: 0, y: 350, width: 288, height: 380 },
  // Spans the full width so the track-name column is included, and starts at
  // the panel's own top edge rather than partway up the canvas above it.
  timeline: { x: 0, y: 636, width: 1440, height: 264 },
};

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

const SCENES = [
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
      await selectLayer(page, /subhead/i);
      await fitContent(page);
    },
  },
  {
    id: 'typography-panel',
    file: 'typography-panel-light.png',
    theme: 'light',
    feature: 'typography',
    clip: CROP.inspector,
    alt: 'The Varve properties inspector showing typography controls: font family, weight, size, line height and letter spacing',
    caption: 'Type controls for the selected text',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'type');
      await selectLayer(page, /subhead/i);
      await fitContent(page);
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
    clip: CROP.layers,
    alt: 'The Varve layers panel listing the poster’s named layers with blend mode and opacity badges',
    caption: 'Layers, blend modes, and opacity',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /disc/i);
      await fitContent(page);
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
      await page.getByRole('tab', { name: /^Appearance/i }).click();
      // The Appearance panel re-renders on tab switch; querying the
      // disclosure immediately after the click can catch it mid-render.
      await page.waitForTimeout(400);
      const paletteSection = page.locator('.insp-disclosure').filter({ hasText: /^Palette/ });
      await paletteSection.waitFor({ state: 'visible', timeout: 15000 });
      const paletteTrigger = paletteSection.getByRole('button', { name: /^Palette$/ });
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
    id: 'enhance-dialog-auto',
    file: 'enhance-dialog-auto.png',
    theme: 'light',
    feature: 'image-enhancement',
    alt: 'The Varve Enhance dialog in Auto mode showing a real photo import and a recommended enhancement task',
    caption: 'The Enhance dialog in Auto mode recommends a task from the source image.',
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
    },
  },
  {
    id: 'export',
    file: 'export-dialog-light.png',
    theme: 'light',
    feature: 'export',
    alt: 'The Varve advanced export dialog showing a destination and filename template, flat/by-format/by-node organization, and format options including SVG, PNG, WebP and PDF in the adjacent Quick Export panel',
    caption: 'Set a destination and filename template, then export to SVG, PNG, WebP, or PDF.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /^Poster — A3$/);
      await fitContent(page);
      const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
        hasText: /^export$/i,
      });
      await exportTab.waitFor({ state: 'visible', timeout: 5000 });
      await exportTab.click();
      const advancedBtn = page.getByRole('button', { name: /Open advanced export/ });
      if (!(await advancedBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
        throw new Error('"Open advanced export" control unavailable for the selected frame');
      }
      await advancedBtn.click();
      const dialog = page.getByRole('dialog', { name: 'Export' });
      await dialog.waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'vectorize',
    file: 'vectorize-dialog-light.png',
    theme: 'light',
    feature: 'vector-tools',
    alt: 'The Varve Vectorize dialog tracing an imported photo into editable vector paths, with mode, colour count and path-fitting controls',
    caption: 'Trace an imported image into editable paths — computed locally by the Rust trace engine.',
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
      // Colour mode re-runs the trace preview; capturing before it settles
      // would show the previous mode's result under the new mode's controls.
      await page.waitForTimeout(2500);
    },
  },
  {
    id: 'image-tools',
    file: 'image-tools-panel-light.png',
    theme: 'light',
    feature: 'visual-awareness',
    clip: CROP.inspectorTall,
    alt: 'The Varve image tools inspector for a selected photo, stacking Image Enhance, Vectorize, Object Selection, Background Removal, Colorize, AI Denoise and Depth Blur sections',
    caption: 'Image tools for a selected photo — enhance, vectorize, object selection, background removal, depth blur. All run on-device.',
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
      await page
        .locator('.insp-disclosure')
        .first()
        .waitFor({ state: 'visible', timeout: 15000 });
      const bgSection = page.locator('.insp-disclosure').filter({ hasText: /Background Removal/ });
      if (!(await bgSection.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('Background Removal section missing — panel would misrepresent image tools');
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
    caption: 'Task-focused workspaces — each remembers its own panels, toolbar, and inspector.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
      const group = page.getByRole('radiogroup', { name: 'Workspace' });
      await group.waitFor({ state: 'visible', timeout: 8000 });
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
    id: 'print-production',
    file: 'print-production-light.png',
    theme: 'light',
    feature: 'print-production',
    alt: 'The default page on the Varve canvas with a dashed bleed guide beyond the trim edge and the Page Print inspector showing per-edge bleed values',
    caption: 'Bleed and trim guides render on canvas as you set them in the Page Print inspector.',
    async run(page) {
      // Mirrors tests/e2e/canvas/bleed-workflow.spec.ts's seedPrintDocument:
      // a real Page node comes from the "Add page" control. Bleed/trim is a
      // Page property, not a generic Frame property — the demo .varve
      // fixtures' "Page 12"/"Page 13" layers are ordinary Frames named for
      // the editorial-spread layout (confirmed by the status bar reading
      // "Frame" rather than "Page" when one is selected), so none of them
      // can stand in for this scene.
      //
      // Bleed guides are a View toggle that defaults to off
      // (viewportSession.ts: bleedGuidesVisible: false), so setting bleed
      // values alone renders nothing — CanvasOverlays only mounts
      // PagePrintOverlays while the toggle is on. Ctrl+Shift+2 is that
      // toggle, which is why the spec's prelude presses it.
      await openCleanEditor(page);
      await page.getByRole('button', { name: 'Add page' }).click();
      await page.waitForTimeout(400);
      await page.locator('canvas.editor-canvas__content-layer').waitFor({ timeout: 10000 });
      await page.keyboard.press('r');
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      const canvasBox = await canvas.boundingBox();
      if (!canvasBox) throw new Error('canvas bounding box unavailable');
      const sx = canvasBox.x + canvasBox.width * 0.25;
      const sy = canvasBox.y + canvasBox.height * 0.25;
      const ex = canvasBox.x + canvasBox.width * 0.75;
      const ey = canvasBox.y + canvasBox.height * 0.7;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move((sx + ex) / 2, (sy + ey) / 2);
      await page.mouse.move(ex, ey);
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Shift+2');
      await page.waitForTimeout(400);
      // "Fit all" (the fitContent helper) frames artwork bounds, which here
      // is the small rectangle just drawn — it would zoom in far past the
      // page itself. "Fit active page" frames the page/bleed geometry this
      // scene is actually about.
      const fitPageBtn = page.getByRole('button', { name: /fit active page/i }).first();
      await fitPageBtn.waitFor({ state: 'visible', timeout: 8000 });
      await fitPageBtn.click({ timeout: 5000 });
      await page.waitForTimeout(600);
      await page.keyboard.press('q');
      const guideBefore = page.locator('.print-bleed-guide');
      const guideBox = (await guideBefore.count()) ? await guideBefore.first().boundingBox() : null;
      if (guideBox) {
        await page.mouse.click(guideBox.x + guideBox.width / 2, guideBox.y + guideBox.height / 2);
      } else {
        await page.mouse.click(
          canvasBox.x + canvasBox.width / 2,
          canvasBox.y + canvasBox.height / 2,
        );
      }
      const pagePrintLabel = page.getByText('Page Print').first();
      if (!(await pagePrintLabel.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error(
          'Page Print inspector section did not appear after selecting the page with the page tool',
        );
      }
      await page.getByLabel(/bleed top/i).fill('20');
      await page.getByLabel(/bleed right/i).fill('20');
      await page.getByLabel(/bleed bottom/i).fill('20');
      await page.getByLabel(/bleed left/i).fill('20');
      await page.getByLabel(/bleed left/i).press('Enter');
      await page.waitForTimeout(2000);
      const guide = page.locator('.print-bleed-guide');
      if ((await guide.count()) === 0) {
        throw new Error(
          'bleed fields commit correctly (verified visually) but .print-bleed-guide never ' +
            'mounts on canvas — a real gap between this sequence and the passing ' +
            'bleed-workflow.spec.ts run, not isolated further; see scene comment above',
        );
      }
    },
  },
];

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const browser = await chromium.launch();
const server = await startServer();
let failures = 0;
let ranThisRun = 0;

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
    // SCENES is the source of truth for what exists; the manifest is a
    // generated view of it, so a newly added scene seeds its own entry
    // rather than requiring a hand-edit of a file marked "do not hand-edit".
    manifest.scenes[scene.id] ??= {};
    const entry = manifest.scenes[scene.id];
    ranThisRun++;
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await ctx.addInitScript(SEED_FIRST_RUN_STATE);
    const page = await ctx.newPage();
    try {
      await page.emulateMedia({
        colorScheme: scene.theme,
        reducedMotion: 'reduce',
        forcedColors: 'none',
      });
      await scene.run(page);
      await settle(page);
      // Detail scenes are cropped at capture time so the website can show
      // them small without scaling a full window down to an unreadable smear.
      const shot = await page.screenshot(scene.clip ? { clip: scene.clip } : undefined);
      const dims = pngSize(shot);
      // Full frames are 1440x900; cropped details are smaller but must still
      // match the clip they asked for, which catches a mis-laid-out capture.
      const expected = scene.clip ?? { width: 1440, height: 900 };
      if (!dims || dims.width !== expected.width || dims.height !== expected.height) {
        throw new Error(
          `screenshot malformed: got ${JSON.stringify(dims)}, expected ${expected.width}x${expected.height}`,
        );
      }
      writeFileSync(join(OUT_DIR, scene.file), shot);
      writeFileSync(join(PUBLIC_DIR, scene.file), shot);
      entry.file = scene.file;
      entry.alt = scene.alt;
      entry.caption = scene.caption;
      entry.feature = scene.feature;
      entry.theme = scene.theme;
      entry.width = dims.width;
      entry.height = dims.height;
      entry.status = 'captured';
      entry.reason = undefined;
      entry.lastValidatedAgainst = null;
      console.log(
        `captured ${scene.id} -> docs/screenshots/product/${scene.file} (${dims.width}x${dims.height})`,
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
      entry.width = undefined;
      entry.height = undefined;
      // Delete any previous output for this scene. A skipped scene must not
      // leave a stale screenshot behind for the site to keep serving — that
      // is exactly the silent substitution this pipeline exists to prevent.
      for (const dir of [OUT_DIR, PUBLIC_DIR]) {
        rmSync(join(dir, scene.file), { force: true });
      }
      console.error(`SKIPPED ${scene.id}: ${entry.reason}`);
      if (strict) failures++;
    } finally {
      await ctx.close();
    }
  }
  // Drop manifest entries whose scene no longer exists. Only safe on a full
  // run — a --scenes run intentionally leaves the other entries untouched.
  if (onlyScenes.size === 0) {
    const live = new Set(SCENES.map((s) => s.id));
    for (const id of Object.keys(manifest.scenes)) {
      if (live.has(id)) continue;
      const stale = manifest.scenes[id];
      if (stale?.file) {
        for (const dir of [OUT_DIR, PUBLIC_DIR]) rmSync(join(dir, stale.file), { force: true });
      }
      delete manifest.scenes[id];
      console.log(`pruned removed scene ${id}`);
    }
  }
  manifest.generatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest written: ${MANIFEST_PATH}`);
} finally {
  await stopServer(server);
  await browser.close();
}

// Reported separately from the manifest totals below: a run that captures
// nothing still leaves a manifest full of previously-captured scenes, which
// reads like success unless this run's own tally is shown.
console.log(`this run: ${ranThisRun} scene(s) attempted`);
if (ranThisRun === 0) {
  console.error('FAIL no scenes ran — check the --scenes filter');
  failures++;
}

const captured = Object.values(manifest.scenes).filter((s) => s.status === 'captured').length;
const skipped = Object.values(manifest.scenes).filter((s) => s.status === 'skipped').length;
console.log(`done: ${captured} captured, ${skipped} skipped, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
