#!/usr/bin/env node
/**
 * Marketing recorder for Varve comic lettering.
 *
 * Drives the real @varve/desktop Vite app with Playwright. No mocked UI.
 * Writes H.264 mp4s under marketing/sample-comic/video/.
 *
 *   node marketing/sample-comic/recording/record-lettering.mjs
 *   node marketing/sample-comic/recording/record-lettering.mjs --probe
 *   node marketing/sample-comic/recording/record-lettering.mjs --full
 *   node marketing/sample-comic/recording/record-lettering.mjs --loop
 *   node marketing/sample-comic/recording/record-lettering.mjs --vertical
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const COMIC_DIR = join(ROOT, 'marketing/sample-comic');
const VIDEO_DIR = join(COMIC_DIR, 'video');
const RAW_DIR = join(HERE, '.tmp');
const SOURCE_VARVE = join(COMIC_DIR, 'halloween-cookies.varve');
const PORT = Number(process.env.VARVE_COMIC_PORT ?? 4173);
const BASE = `http://127.0.0.1:${PORT}`;

const PAGE_W = 900;
const PAGE_H = 1260;
const MARGIN = 36;
const GUTTER = 20;
const PANEL_W = (PAGE_W - MARGIN * 2 - GUTTER) / 2;
const PANEL_H = (PAGE_H - MARGIN * 2 - GUTTER * 2) / 3;

const args = new Set(process.argv.slice(2));
const PROBE = args.has('--probe');
const WANT_FULL = args.has('--full') || (!args.has('--loop') && !args.has('--vertical') && !PROBE);
const WANT_LOOP = args.has('--loop') || (!args.has('--full') && !args.has('--vertical') && !PROBE);
const WANT_VERTICAL =
  args.has('--vertical') || (!args.has('--full') && !args.has('--loop') && !PROBE);
const pointerByPage = new WeakMap();
const compactByPage = new WeakMap();

const ART_LOCK_NAMES = [
  'Wall',
  'Window',
  'Window muntin',
  'Shelf',
  'Jar',
  'Bowl',
  'Counter',
  'Counter shade',
  'Counter matte',
  'Counter close-up',
  'Baker',
  'Ghost cookie',
  'Pumpkin cookie',
  'Ghost cutter',
  'Pumpkin cutter',
  'Left hand',
  'Right hand',
  'Piping bag',
  'Door',
  'Moon',
  'Glow A',
  'Glow B',
];

function panelOrigin(index) {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: MARGIN + col * (PANEL_W + GUTTER),
    y: MARGIN + row * (PANEL_H + GUTTER),
  };
}

const PLACEMENTS = {
  caption: {
    panel: 0,
    localX: 20,
    localY: 16,
    boxW: 210,
    boxH: 48,
    text: 'That morning...',
    action: 'Add Caption Box',
    query: 'caption box',
    fontSize: 18,
    layer: /caption balloon/i,
  },
  speech: {
    panel: 2,
    localX: 188,
    localY: 52,
    boxW: 150,
    boxH: 58,
    text: 'Perfect!',
    action: 'Add Speech Balloon',
    query: 'speech balloon',
    fontSize: 22,
    layer: /speech balloon/i,
    tailToward: { localX: 92, localY: 168 },
  },
  shout: {
    panel: 4,
    localX: 104,
    localY: 44,
    boxW: 210,
    boxH: 86,
    text: "WE'RE ALIVE!",
    action: 'Add Shout Balloon',
    query: 'shout balloon',
    fontSize: 24,
    layer: /shout balloon/i,
    tailToward: { localX: 196, localY: 210 },
  },
  thought: {
    panel: 5,
    localX: 164,
    localY: 18,
    boxW: 210,
    boxH: 88,
    text: 'Did I use magic flour...?',
    action: 'Add Thought Balloon',
    query: 'thought balloon',
    fontSize: 16,
    layer: /thought balloon/i,
    tailToward: { localX: 86, localY: 176 },
  },
};

function log(message) {
  process.stdout.write(`${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripCallouts(doc) {
  const nodes = { ...doc.nodes };
  const remove = new Set();
  const stack = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (node?.kind === 'group' && node.callout) stack.push(id);
  }
  while (stack.length) {
    const id = stack.pop();
    if (!id || remove.has(id)) continue;
    remove.add(id);
    const node = nodes[id];
    if (Array.isArray(node?.children)) stack.push(...node.children);
  }
  for (const id of remove) delete nodes[id];
  for (const node of Object.values(nodes)) {
    if (Array.isArray(node.children)) {
      node.children = node.children.filter((id) => !remove.has(id));
    }
  }
  return { ...doc, nodes };
}

function writeUnletteredCopy() {
  if (!existsSync(SOURCE_VARVE)) {
    throw new Error(`missing ${SOURCE_VARVE} — checkout PR #73's halloween-cookies.varve`);
  }
  const raw = readFileSync(SOURCE_VARVE, 'utf8');
  const lettered = JSON.parse(raw);
  const unlettered = stripCallouts(lettered);
  const dir = mkdtempSync(join(tmpdir(), 'varve-comic-'));
  const path = join(dir, 'halloween-cookies-unlettered.varve');
  writeFileSync(path, `${JSON.stringify(unlettered)}\n`);
  return { path, dir };
}

async function startServer() {
  const viteCommand =
    Number(process.versions.node.split('.')[0]) >= 26
      ? ['node', '--no-turbofan', 'node_modules/vite/bin/vite.js']
      : ['vite'];
  let output = '';
  const child = spawn(
    'pnpm',
    [
      '--filter',
      '@varve/desktop',
      'exec',
      ...viteCommand,
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--strictPort',
    ],
    {
      cwd: ROOT,
      env: { ...process.env, VARVE_DISABLE_HMR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString();
  });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      import('node:http')
        .then(({ get }) => {
          const req = get(`${BASE}/`, { timeout: 3000 });
          req.on('response', (res) => resolve((res.statusCode ?? 500) < 500));
          req.on('error', () => resolve(false));
        })
        .catch(() => resolve(false));
    });
    if (ready) return child;
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before ready.\n${output}`);
    }
    await sleep(800);
  }
  throw new Error(`Vite did not start on :${PORT}.\n${output}`);
}

async function stopServer(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

const CURSOR_BOOT = `(() => {
  if (window.__varveMarketingCursor) return;
  window.__varveMarketingCursor = true;
  const style = document.createElement('style');
  style.textContent = \`
    html, body, * { cursor: none !important; }
    vite-error-overlay, #webpack-dev-server-client-overlay,
    #webpack-dev-server-client-overlay-div { display: none !important; }
    #varve-marketing-cursor {
      position: fixed;
      left: 0;
      top: 0;
      width: 28px;
      height: 28px;
      pointer-events: none;
      z-index: 2147483646;
      transform: translate(-40px, -40px);
    }
  \`;
  const cursor = document.createElement('div');
  cursor.id = 'varve-marketing-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 3.2L22.4 14.1L13.7 15.6L10.8 24.2L4 3.2Z" fill="#111111" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const mount = () => {
    if (!document.head.contains(style)) document.head.appendChild(style);
    if (!document.documentElement.contains(cursor)) document.documentElement.appendChild(cursor);
  };
  const move = (event) => {
    cursor.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)';
  };
  mount();
  document.addEventListener('mousemove', move, true);
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})()`;

const STORAGE_BOOT = `(() => {
  try {
    localStorage.setItem('varve-theme', 'light');
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
    localStorage.setItem('varve:onboarding', JSON.stringify({ onboardingComplete: true }));
    localStorage.removeItem('varve:safe-mode');
    localStorage.removeItem('varve:crash-loop');
  } catch {
    /* ignore */
  }
})()`;

async function dismissNoise(page) {
  for (const name of [
    /continue normal startup/i,
    /review my documents/i,
    /close|got it|get started/i,
  ]) {
    const btn = page.getByRole('button', { name });
    if (
      await btn
        .first()
        .isVisible({ timeout: 600 })
        .catch(() => false)
    ) {
      await btn
        .first()
        .click()
        .catch(() => undefined);
    }
  }
  const welcome = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcome
      .first()
      .isVisible({ timeout: 600 })
      .catch(() => false)
  ) {
    await welcome
      .first()
      .click()
      .catch(() => undefined);
  }
}

async function humanMove(page, x, y, durationMs = 380) {
  const last = pointerByPage.get(page) ?? { x: 960, y: 540 };
  const dist = Math.hypot(x - last.x, y - last.y);
  const steps = Math.max(8, Math.min(36, Math.round(dist / 18 + durationMs / 22)));
  await page.mouse.move(x, y, { steps });
  pointerByPage.set(page, { x, y });
}

async function pause(page, ms) {
  await page.waitForTimeout(ms);
}

async function clickAt(page, x, y, durationMs = 380) {
  await humanMove(page, x, y, durationMs);
  await pause(page, 90);
  await page.mouse.click(x, y);
}

async function typeHuman(page, text, delay = 38) {
  await page.keyboard.type(text, { delay });
}

async function hideOverlays(page) {
  await page.addStyleTag({
    content: `
      vite-error-overlay, #webpack-dev-server-client-overlay { display: none !important; }
    `,
  });
}

async function blurChrome(page) {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
}

async function sidePanelCollapsed(page, which) {
  return page.evaluate((panel) => {
    const sel = panel === 'layers' ? '.editor__layers-panel' : '.editor__inspector-panel';
    const el = document.querySelector(sel);
    if (!el) return true;
    return el.hasAttribute('inert') || el.hasAttribute('data-collapsed');
  }, which);
}

async function setSidePanel(page, which, visible) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await sidePanelCollapsed(page, which)) !== visible) break;
    await blurChrome(page);
    await page.keyboard.press(which === 'layers' ? 'Control+b' : 'Control+Shift+b');
    await pause(page, 180);
  }
  if ((await sidePanelCollapsed(page, which)) === visible) {
    const name = visible
      ? which === 'layers'
        ? /show layers panel/i
        : /show inspector panel/i
      : which === 'layers'
        ? /hide layers panel/i
        : /hide inspector panel/i;
    const fab = page.getByRole('button', { name }).first();
    if (await fab.isVisible({ timeout: 400 }).catch(() => false)) {
      await fab.click();
      await pause(page, 180);
    }
  }
}

async function hideSidePanels(page) {
  await setSidePanel(page, 'layers', false);
  await setSidePanel(page, 'inspector', false);
}

async function ensureLayers(page) {
  if (!compactByPage.get(page)) return;
  await setSidePanel(page, 'inspector', false);
  await setSidePanel(page, 'layers', true);
}

async function ensureInspector(page) {
  if (!compactByPage.get(page)) return;
  await setSidePanel(page, 'layers', false);
  await setSidePanel(page, 'inspector', true);
}

async function openUnlettered(page, filePath) {
  await page.addInitScript(STORAGE_BOOT);
  await page.addInitScript(CURSOR_BOOT);
  await page.goto(`${BASE}/?isoTest=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await hideOverlays(page);
  await dismissNoise(page);
  const newBtn = page.getByRole('button', { name: /^new$/i });
  const firstDesign = page.getByRole('button', { name: /create your first design/i });
  await newBtn.or(firstDesign).first().waitFor({ state: 'attached', timeout: 120000 });
  if (await newBtn.isVisible().catch(() => false)) {
    await newBtn.click({ force: true });
  } else {
    await firstDesign.click({ force: true }).catch(async () => {
      await newBtn.click({ force: true });
    });
  }
  const create = page
    .locator('dialog[open]')
    .getByRole('button', { name: /create design/i })
    .or(page.locator('dialog[open]').getByRole('button', { name: /create/i }))
    .or(page.getByRole('button', { name: /create design/i }))
    .first();
  if (!(await create.isVisible({ timeout: 8000 }).catch(() => false))) {
    await newBtn.click({ force: true }).catch(() => undefined);
  }
  await create.waitFor({ state: 'visible', timeout: 30000 });
  await create.click({ force: true });
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 120000 });
  await page
    .locator('canvas.editor-canvas__content-layer')
    .waitFor({ state: 'visible', timeout: 60000 });
  await dismissNoise(page);
  await page.locator('#file-open-input').waitFor({ state: 'attached', timeout: 15000 });
  await page.setInputFiles('#file-open-input', filePath);
  await page.waitForFunction(
    () => {
      const heading = document.querySelector('.editor-shell h1.sr-only');
      return !!heading && /halloween-cookies/i.test(heading.textContent ?? '');
    },
    undefined,
    { timeout: 60000 },
  );
  const continueEditing = page.getByRole('button', { name: /continue editing/i });
  if (await continueEditing.isVisible({ timeout: 1000 }).catch(() => false)) {
    await continueEditing.click();
  }
  await page.locator('.layers-panel').waitFor({ state: 'attached', timeout: 30000 });
  await dismissNoise(page);
  await page.locator('canvas.editor-canvas__content-layer').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  await blurChrome(page);
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(700);
  await page.keyboard.press('v');
  await page.waitForTimeout(160);
}

async function layerNames(page) {
  return page
    .getByRole('treeitem')
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute('aria-label') ?? item.textContent ?? ''),
    );
}

async function pageScreenMap(page) {
  const map = await page.evaluate(() => {
    const hooks = window.__varveIsoTest;
    const canvas = document.querySelector('.editor-canvas');
    if (!hooks || !canvas) throw new Error('isoTest hooks or canvas missing');
    const rect = canvas.getBoundingClientRect();
    const toScreen = (wx, wy) => {
      const screen = hooks.worldToScreen(wx, wy);
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    };
    const origin = toScreen(0, 0);
    const corner = toScreen(900, 1260);
    return {
      origin,
      corner,
      w: corner.x - origin.x,
      h: corner.y - origin.y,
    };
  });
  if (map.w < 80 || map.h < 80) {
    throw new Error(`page screen map is degenerate: ${JSON.stringify(map)}`);
  }
  return map;
}

function localToScreen(map, panelIndex, localX, localY) {
  const origin = panelOrigin(panelIndex);
  const x = map.origin.x + ((origin.x + localX) / PAGE_W) * map.w;
  const y = map.origin.y + ((origin.y + localY) / PAGE_H) * map.h;
  return { x, y };
}

async function selectLayer(page, pattern, which = 'first') {
  await ensureLayers(page);
  const items = page.getByRole('treeitem', { name: pattern });
  const count = await items.count();
  if (count === 0) {
    try {
      await items.first().waitFor({ state: 'visible', timeout: 8000 });
    } catch (error) {
      throw new Error(
        `layer ${pattern} missing; layers=${JSON.stringify(await layerNames(page))}`,
        {
          cause: error,
        },
      );
    }
  }
  const item = which === 'last' ? items.nth(Math.max(0, (await items.count()) - 1)) : items.first();
  await item.waitFor({ state: 'visible', timeout: 8000 });
  const box = await item.boundingBox();
  if (box) await clickAt(page, box.x + 28, box.y + box.height / 2, 240);
  else await item.click();
  await pause(page, 140);
  return item;
}

async function filterLayers(page, query) {
  await ensureLayers(page);
  const filter = page
    .locator('.layers-panel')
    .getByRole('searchbox')
    .or(page.getByRole('searchbox', { name: /filter layers/i }))
    .or(page.locator('.layers-panel input[placeholder*="Filter" i]'));
  if (
    await filter
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false)
  ) {
    await filter.first().fill(query);
    await pause(page, 140);
  }
}

async function focusCanvas(page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (box) await page.mouse.click(box.x + 16, box.y + 16);
  await page.keyboard.press('Escape').catch(() => undefined);
  await pause(page, 80);
}

async function chooseTextTool(page) {
  await focusCanvas(page);
  const tool = page.getByRole('button', { name: /^text\b/i }).first();
  if (await tool.isVisible({ timeout: 800 }).catch(() => false)) {
    const box = await tool.boundingBox();
    if (box) await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, 240);
    else await tool.click();
  } else {
    await page.keyboard.press('t');
  }
  await pause(page, 120);
}

async function setSpin(page, name, value) {
  await ensureInspector(page);
  const field = page
    .locator('.inspector-panel')
    .getByRole('spinbutton', { name: new RegExp(`^${name}$`, 'i') })
    .first();
  if (!(await field.isVisible({ timeout: 1800 }).catch(() => false))) return false;
  const box = await field.boundingBox();
  if (box) await clickAt(page, box.x + 18, box.y + box.height / 2, 220);
  else await field.click();
  await page.keyboard.press('Control+a');
  await typeHuman(page, String(value), 36);
  await page.keyboard.press('Enter');
  await pause(page, 140);
  return true;
}

async function wrapSelectedText(page, query, actionName) {
  await blurChrome(page);
  const inspectorAdd = page.getByRole('button', { name: actionName, exact: true }).first();
  if (await inspectorAdd.isVisible({ timeout: 800 }).catch(() => false)) {
    const box = await inspectorAdd.boundingBox();
    if (box) await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, 240);
    else await inspectorAdd.click();
    await pause(page, 380);
    return;
  }
  const input = page.getByRole('combobox', { name: /search actions/i });
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await blurChrome(page);
    await page.keyboard.press('Control+k');
    opened = await input
      .waitFor({ state: 'visible', timeout: 2500 })
      .then(() => true)
      .catch(() => false);
  }
  if (!opened) throw new Error(`quick actions did not open for ${actionName}`);
  await pause(page, 160);
  await typeHuman(page, query, 40);
  const option = page.getByRole('option', { name: new RegExp(actionName, 'i') }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await pause(page, 200);
  const box = await option.boundingBox();
  if (box) await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, 240);
  else await option.click();
  await page
    .getByRole('dialog', { name: /quick actions/i })
    .waitFor({ state: 'hidden', timeout: 4000 })
    .catch(() => undefined);
  await pause(page, 380);
}

async function selectionKind(page) {
  return page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry?.()?.[0]?.kind ?? null);
}

async function fitSelectedFrame(page, expectedPattern) {
  const kind = await selectionKind(page);
  if (kind && kind !== 'frame') return false;
  const selected = expectedPattern
    ? await page
        .getByRole('treeitem', { name: expectedPattern })
        .first()
        .getAttribute('aria-selected')
    : 'true';
  if (selected !== 'true') return false;
  const fit = page.getByRole('button', { name: /fit selection to viewport/i });
  if (await fit.isVisible({ timeout: 1500 }).catch(() => false)) {
    await fit.click();
    await pause(page, 280);
    return true;
  }
  await blurChrome(page);
  await page.keyboard.press('Shift+Digit2');
  await pause(page, 280);
  return true;
}

async function resetView(page) {
  await blurChrome(page);
  await page.keyboard.press('Shift+Digit1');
  await pause(page, 400);
}

async function zoomToLayer(page, pattern) {
  const item = page.getByRole('treeitem', { name: pattern }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  const box = await item.boundingBox();
  if (box) {
    await clickAt(page, box.x + 28, box.y + box.height / 2, 200);
    await item.click({ button: 'right' });
  } else {
    await item.click({ button: 'right' });
  }
  const zoom = page.getByRole('menuitem', { name: /zoom to selection/i }).first();
  if (
    await zoom
      .waitFor({ state: 'visible', timeout: 2500 })
      .then(() => true)
      .catch(() => false)
  ) {
    await zoom.click();
    await pause(page, 320);
    return true;
  }
  await page.keyboard.press('Escape').catch(() => undefined);
  return fitSelectedFrame(page, pattern);
}

async function followPanelCanvas(page, panelIndex) {
  await hideSidePanels(page);
  await resetView(page);
  const map = await pageScreenMap(page);
  const mid = localToScreen(map, panelIndex, PANEL_W / 2, PANEL_H / 2);
  await clickAt(page, mid.x, mid.y, 240);
  await blurChrome(page);
  const kind = await selectionKind(page);
  if (kind !== 'frame') return false;
  await page.keyboard.press('Shift+Digit2');
  await pause(page, 280);
  const after = await pageScreenMap(page);
  const zoom = after.h / PAGE_H;
  if (zoom > 2.4 || zoom < 1.3) {
    await page.keyboard.press('Digit5');
    await pause(page, 240);
  }
  const fitted = await pageScreenMap(page);
  const view = page.viewportSize() ?? { width: 1080, height: 1920 };
  const center = localToScreen(fitted, panelIndex, PANEL_W / 2, PANEL_H / 2);
  return (
    fitted.h > 80 &&
    center.y > 40 &&
    center.y < view.height - 40 &&
    center.x > 20 &&
    center.x < view.width - 20
  );
}

async function followPanel(page, panelIndex) {
  if (compactByPage.get(page)) {
    const viaCanvas = await followPanelCanvas(page, panelIndex);
    if (viaCanvas) return;
  }
  const label = `Panel ${panelIndex + 1}`;
  const pattern = new RegExp(`${label}(?:,|$)`, 'i');
  await filterLayers(page, label);
  await selectLayer(page, pattern);
  await zoomToLayer(page, pattern);
  await filterLayers(page, '');
  const map = await pageScreenMap(page);
  const mid = localToScreen(map, panelIndex, PANEL_W / 2, PANEL_H / 2);
  const view = page.viewportSize() ?? { width: 1920, height: 1080 };
  const insane = map.h > 6000 || map.h < 80 || mid.y < 40 || mid.y > view.height - 40;
  if (insane) {
    await resetView(page);
    await filterLayers(page, label);
    await selectLayer(page, pattern);
    await zoomToLayer(page, pattern);
    await filterLayers(page, '');
  }
  if (compactByPage.get(page)) await hideSidePanels(page);
}

async function lockNamedLayers(page, name) {
  await ensureLayers(page);
  await filterLayers(page, name);
  const locks = page.getByRole('button', { name: new RegExp(`^Lock ${name}$`, 'i') });
  const count = await locks.count();
  for (let i = 0; i < count; i++) {
    const button = locks.nth(i);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await pause(page, 70);
    }
  }
  await filterLayers(page, '');
}

async function lockAllWalls(page) {
  for (const name of ART_LOCK_NAMES) {
    await lockNamedLayers(page, name);
  }
}

async function lockPanelBackdrop(page, panelIndex) {
  await lockNamedLayers(page, `Panel ${panelIndex + 1}`);
  await lockNamedLayers(page, 'Page');
}

async function openComicSection(page) {
  await ensureInspector(page);
  const section = page.getByRole('button', { name: /comic balloon/i }).first();
  if (!(await section.isVisible({ timeout: 2000 }).catch(() => false))) return false;
  if ((await section.getAttribute('aria-expanded')) === 'false') {
    const box = await section.boundingBox();
    if (box) await clickAt(page, box.x + 24, box.y + box.height / 2, 220);
    else await section.click();
    await pause(page, 180);
  }
  return true;
}

async function clickInspectorButton(page, name) {
  await ensureInspector(page);
  const button = page.getByRole('button', { name, exact: true }).first();
  if (!(await button.isVisible({ timeout: 1800 }).catch(() => false))) return false;
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await button.boundingBox();
  if (box) await clickAt(page, box.x + Math.min(72, box.width / 2), box.y + box.height / 2, 240);
  else await button.click();
  await pause(page, 280);
  return true;
}

async function revealBalloon(page, pattern) {
  await filterLayers(page, 'balloon');
  const groupPattern = new RegExp(`${pattern.source},\\s*group`, 'i');
  const preferred = page.getByRole('treeitem', { name: groupPattern }).first();
  const fallback = page.getByRole('treeitem', { name: pattern }).first();
  const useGroup = await preferred.isVisible({ timeout: 800 }).catch(() => false);
  const item = useGroup ? preferred : fallback;
  if (await item.isVisible({ timeout: 2500 }).catch(() => false)) {
    const pick = useGroup ? groupPattern : pattern;
    await selectLayer(page, pick);
    await item.press('ArrowRight');
    await pause(page, 140);
    const selected = await page.evaluate(
      () => window.__varveIsoTest?.getSelection?.()?.length ?? 0,
    );
    if (selected === 0) await selectLayer(page, pick);
    await openComicSection(page);
    return true;
  }
  return false;
}

async function dumpBalloon(page, label) {
  const info = await page.evaluate(() => {
    const hooks = window.__varveIsoTest;
    const layers = [...document.querySelectorAll('[role="treeitem"]')].map((item) => ({
      label: item.getAttribute('aria-label') ?? item.textContent ?? '',
      selected: item.getAttribute('aria-selected') === 'true',
    }));
    return {
      selection: hooks?.getSelection?.() ?? [],
      geometry: hooks?.getSelectionGeometry?.() ?? [],
      layers,
    };
  });
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(join(RAW_DIR, `${label}.json`), `${JSON.stringify(info, null, 2)}\n`);
  await page.screenshot({ path: join(RAW_DIR, `${label}.png`) });
  return info;
}

async function selectionScreenCenter(page) {
  return page.evaluate(() => {
    const hooks = window.__varveIsoTest;
    const canvas = document.querySelector('.editor-canvas');
    const geometry = hooks?.getSelectionGeometry?.()?.[0];
    if (!hooks || !canvas || !geometry) return null;
    const rect = canvas.getBoundingClientRect();
    const matrix = geometry.worldTransform;
    const wx = matrix[4];
    const wy = matrix[5];
    const screen = hooks.worldToScreen(wx, wy);
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  });
}

async function editBalloonText(page, text) {
  if (compactByPage.get(page)) {
    await hideSidePanels(page);
    const center = await selectionScreenCenter(page);
    if (center) {
      await humanMove(page, center.x, center.y, 240);
      await page.mouse.dblclick(center.x, center.y);
      await pause(page, 200);
    }
  }
  const edit = page.getByRole('button', { name: 'Edit text', exact: true });
  if (await edit.isVisible({ timeout: 1200 }).catch(() => false)) {
    const box = await edit.boundingBox();
    if (box) await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, 240);
    else await edit.click();
  } else {
    const textLayer = page.getByRole('treeitem', { name: /balloon text|text:/i }).last();
    if (await textLayer.isVisible({ timeout: 800 }).catch(() => false)) {
      await textLayer.dblclick();
    }
  }
  const editor = page.getByRole('textbox', { name: /editing text/i });
  if (
    !(await editor
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false))
  ) {
    return false;
  }
  await pause(page, 120);
  await page.keyboard.press('Control+a');
  await pause(page, 80);
  await typeHuman(page, text, 36);
  await pause(page, 220);
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => undefined);
  await page.keyboard.press('v');
  await pause(page, 160);
  return true;
}

async function seatTextInBalloon(page) {
  if (compactByPage.get(page)) return;
  const textLayer = page.getByRole('treeitem', { name: /balloon text|text:/i }).last();
  if (!(await textLayer.isVisible({ timeout: 800 }).catch(() => false))) return;
  await selectLayer(page, /balloon text|text:/i, 'last');
  await setSpin(page, 'x', 18);
  await setSpin(page, 'y', 18);
}

async function placeDialogue(page, placement) {
  await followPanel(page, placement.panel);
  let map = await pageScreenMap(page);
  let start = localToScreen(map, placement.panel, placement.localX, placement.localY);
  const view = page.viewportSize() ?? { width: 1920, height: 1080 };
  if (start.x < 20 || start.y < 20 || start.x > view.width - 20 || start.y > view.height - 20) {
    await followPanel(page, placement.panel);
    map = await pageScreenMap(page);
    start = localToScreen(map, placement.panel, placement.localX, placement.localY);
  }
  const end = localToScreen(
    map,
    placement.panel,
    placement.localX + placement.boxW,
    placement.localY + placement.boxH,
  );
  const editor = page.getByRole('textbox', { name: /editing text/i });
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await chooseTextTool(page);
    await humanMove(page, start.x, start.y, 360);
    await page.mouse.down();
    await pause(page, 60);
    await humanMove(page, end.x, end.y, 520);
    await page.mouse.up();
    opened = await editor
      .waitFor({ state: 'visible', timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      await page.keyboard.press('Escape').catch(() => undefined);
      await pause(page, 160);
    }
  }
  if (!opened) {
    throw new Error(`text box did not open at ${start.x.toFixed(1)},${start.y.toFixed(1)}`);
  }
  await pause(page, 140);
  await typeHuman(page, placement.text, 38);
  await pause(page, 240);
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  await page.keyboard.press('v');
  await pause(page, 160);
  const snippet = placement.text.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await filterLayers(page, '');
  const textLayer = page.getByRole('treeitem', { name: new RegExp(`text:.*${snippet}`, 'i') });
  if (
    await textLayer
      .last()
      .isVisible({ timeout: 1500 })
      .catch(() => false)
  ) {
    await selectLayer(page, new RegExp(`text:.*${snippet}`, 'i'), 'last');
  }
  if (placement.fontSize) await setSpin(page, 'size', placement.fontSize);
  if (
    await textLayer
      .last()
      .isVisible({ timeout: 800 })
      .catch(() => false)
  ) {
    await selectLayer(page, new RegExp(`text:.*${snippet}`, 'i'), 'last');
  }
  await wrapSelectedText(page, placement.query, placement.action);
  await revealBalloon(page, placement.layer ?? /balloon/i);
  if (PROBE) await dumpBalloon(page, `wrap-${placement.action.replace(/\s+/g, '-').toLowerCase()}`);
  await editBalloonText(page, placement.text);
  await revealBalloon(page, placement.layer ?? /balloon/i);
  await seatTextInBalloon(page);
  await revealBalloon(page, placement.layer ?? /balloon/i);
  await clickInspectorButton(page, 'Fit balloon to text');
  await pause(page, 360);
  if (PROBE) await dumpBalloon(page, `fit-${placement.action.replace(/\s+/g, '-').toLowerCase()}`);
  if (compactByPage.get(page)) await hideSidePanels(page);
}

async function captionHasTail(page) {
  await filterLayers(page, 'balloon');
  await page
    .getByRole('treeitem', { name: /caption balloon,\s*group/i })
    .first()
    .press('ArrowRight')
    .catch(() => undefined);
  const leftover = await page
    .getByRole('treeitem', { name: /balloon tail/i })
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  return leftover;
}

async function removeCaptionTail(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await revealBalloon(page, /caption balloon/i);
    const remove = page.getByRole('button', { name: 'Remove tail', exact: true }).first();
    if (
      await remove
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await remove.scrollIntoViewIfNeeded();
      const box = await remove.boundingBox();
      if (box)
        await clickAt(page, box.x + Math.min(72, box.width / 2), box.y + box.height / 2, 240);
      else await remove.click();
      await pause(page, 360);
    } else {
      await clickInspectorButton(page, 'Remove tail');
    }
    if (!(await captionHasTail(page))) {
      await filterLayers(page, '');
      return;
    }
  }
  await filterLayers(page, 'balloon');
  const tail = page.getByRole('treeitem', { name: /balloon tail/i }).first();
  if (await tail.isVisible({ timeout: 800 }).catch(() => false)) {
    await selectLayer(page, /balloon tail/i);
    await blurChrome(page);
    await page.keyboard.press('Delete');
    await pause(page, 200);
    await page.keyboard.press('Backspace');
    await pause(page, 280);
  }
  if (!(await captionHasTail(page))) {
    await filterLayers(page, '');
    return;
  }
  const leftover = page.getByRole('treeitem', { name: /balloon tail/i }).first();
  if (await leftover.isVisible().catch(() => false)) {
    await leftover.click({ button: 'right' });
    const del = page.getByRole('menuitem', { name: /^delete$/i }).first();
    if (await del.isVisible({ timeout: 1500 }).catch(() => false)) {
      await del.click();
      await pause(page, 280);
    } else {
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  }
  if (!(await captionHasTail(page))) {
    await filterLayers(page, '');
    return;
  }
  throw new Error('caption still has a Balloon tail after Remove tail');
}

async function selectedTailGeometry(page) {
  return page.evaluate(() => {
    const hooks = window.__varveIsoTest;
    const canvas = document.querySelector('.editor-canvas');
    if (!hooks || !canvas) return null;
    const geometry = hooks.getSelectionGeometry()[0];
    const shape = geometry?.shape;
    if (!geometry || !shape) return null;
    const kind = shape.kind;
    if (kind !== 'circle' && kind !== 'path') return null;
    const rect = canvas.getBoundingClientRect();
    const matrix = geometry.worldTransform;
    let lx = 0;
    let ly = 0;
    if (kind === 'circle') {
      lx = shape.cx ?? 0;
      ly = shape.cy ?? 0;
    } else if (Array.isArray(shape.points) && shape.points.length) {
      const last = shape.points[shape.points.length - 1];
      lx = last.x ?? last[0] ?? 0;
      ly = last.y ?? last[1] ?? 0;
    } else {
      lx = 16;
      ly = 48;
    }
    const wx = matrix[0] * lx + matrix[2] * ly + matrix[4];
    const wy = matrix[1] * lx + matrix[3] * ly + matrix[5];
    const screen = hooks.worldToScreen(wx, wy);
    return {
      kind,
      x: rect.left + screen.x,
      y: rect.top + screen.y,
    };
  });
}

async function applyInspectorTail(page, placement) {
  await revealBalloon(page, placement.layer ?? /(speech|shout|thought) balloon/i);
  const tailX = Math.round(placement.tailToward.localX - placement.localX);
  const tailY = Math.round(placement.tailToward.localY - placement.localY);
  await setSpin(page, 'tail x', tailX);
  await setSpin(page, 'tail y', tailY);
  await pause(page, 200);
}

async function dragSelectedTail(page, placement) {
  if (!placement.tailToward) return;
  await lockPanelBackdrop(page, placement.panel);
  await revealBalloon(page, placement.layer ?? /(speech|shout|thought) balloon/i);

  const tailPattern = placement.layer?.source.includes('thought')
    ? /thought bubble/i
    : /balloon tail/i;
  const tails = page.getByRole('treeitem', { name: tailPattern });
  let dragged = false;
  if (
    await tails
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false)
  ) {
    await selectLayer(page, tailPattern, 'last');
    const start = await selectedTailGeometry(page);
    if (start) {
      const map = await pageScreenMap(page);
      const end = localToScreen(
        map,
        placement.panel,
        placement.tailToward.localX,
        placement.tailToward.localY,
      );
      if (compactByPage.get(page)) await hideSidePanels(page);
      await humanMove(page, start.x, start.y, 300);
      await page.mouse.down();
      await pause(page, 50);
      await humanMove(page, start.x + 5, start.y + 5, 80);
      const held = await selectedTailGeometry(page);
      if (!held) {
        await page.mouse.up();
        await blurChrome(page);
        await page.keyboard.press('Control+z');
        await pause(page, 200);
        log('tail mousedown missed the tail node; inspector Tail X/Y fallback');
      } else {
        await humanMove(page, end.x, end.y, 700);
        await pause(page, 80);
        await page.mouse.up();
        await pause(page, 240);
        const after = await selectedTailGeometry(page);
        if (!after) {
          await blurChrome(page);
          await page.keyboard.press('Control+z');
          await pause(page, 200);
          log('tail canvas drag moved a non-tail node; undone');
        } else {
          dragged = true;
        }
      }
    }
  }
  if (!dragged) await applyInspectorTail(page, placement);
  await revealBalloon(page, placement.layer ?? /(speech|shout|thought) balloon/i);
  await filterLayers(page, '');
  if (compactByPage.get(page)) await hideSidePanels(page);
}

async function demonstrateFit(page) {
  await followPanel(page, PLACEMENTS.speech.panel);
  const revealed = await revealBalloon(page, /speech balloon/i);
  if (!revealed) return;
  await editBalloonText(page, 'Perfect! These came out just right!');
  await revealBalloon(page, /speech balloon/i);
  await clickInspectorButton(page, 'Fit balloon to text');
  await pause(page, 700);
}

async function finishOnPage(page) {
  if (compactByPage.get(page)) await hideSidePanels(page);
  else await filterLayers(page, '');
  await page.keyboard.press('Escape');
  await blurChrome(page);
  await page.keyboard.press('v');
  await pause(page, 120);
  const fitAll = page.getByRole('button', { name: /fit all to viewport/i }).first();
  if (!compactByPage.get(page) && (await fitAll.isVisible({ timeout: 800 }).catch(() => false))) {
    await fitAll.click();
  } else {
    await page.keyboard.press('Shift+Digit1');
  }
  await pause(page, 3600);
}

async function letterPage(page, options = {}) {
  const include = options.only ? [options.only] : ['caption', 'speech', 'shout', 'thought'];
  for (const key of include) {
    const placement = PLACEMENTS[key];
    await placeDialogue(page, placement);
    if (key === 'caption') await removeCaptionTail(page);
    if (placement.tailToward) await dragSelectedTail(page, placement);
    if (compactByPage.get(page)) await hideSidePanels(page);
    await pause(page, 360);
    if (PROBE) {
      await page.screenshot({ path: join(RAW_DIR, `probe-${key}.png`) });
    }
  }
  if (!options.only) await demonstrateFit(page).catch(() => undefined);
  await finishOnPage(page);
}

function runFfmpeg(argv) {
  const result = spawn('ffmpeg', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let err = '';
    result.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    result.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${argv.join(' ')} failed (${code})\n${err.slice(-2000)}`));
    });
  });
}

async function probeDuration(file) {
  const child = spawn(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const out = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve(text.trim());
      else reject(new Error(`ffprobe failed for ${file}`));
    });
  });
  return Number(out);
}

async function encodeMp4(input, output, extra = []) {
  mkdirSync(dirname(output), { recursive: true });
  await runFfmpeg([
    '-y',
    '-i',
    input,
    ...extra,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-movflags',
    '+faststart',
    '-an',
    output,
  ]);
}

async function encodeToWindow(input, output, minSec, maxSec, vf) {
  const duration = await probeDuration(input);
  let rate = 1;
  if (duration > maxSec) rate = duration / maxSec;
  if (duration / rate < minSec && duration < minSec) rate = duration / minSec;
  const filters = [];
  if (vf) filters.push(vf);
  if (Math.abs(rate - 1) > 0.04) filters.push(`setpts=${(1 / rate).toFixed(4)}*PTS`);
  await encodeMp4(input, output, filters.length ? ['-vf', filters.join(',')] : []);
  return probeDuration(output);
}

async function recordSession(browser, filePath, name, act, size) {
  mkdirSync(RAW_DIR, { recursive: true });
  const width = size?.width ?? 1920;
  const height = size?.height ?? 1080;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW_DIR, size: { width, height } },
  });
  const page = await context.newPage();
  pointerByPage.set(page, { x: width * 0.55, y: height * 0.45 });
  const videoOrigin = Date.now();
  try {
    await openUnlettered(page, filePath);
    await lockAllWalls(page);
    if (PROBE) {
      const map = await pageScreenMap(page);
      await page.screenshot({ path: join(RAW_DIR, `${name}-open.png`), animations: 'disabled' });
      writeFileSync(join(RAW_DIR, `${name}-map.json`), `${JSON.stringify(map, null, 2)}\n`);
      await act(page, map);
      await page.screenshot({ path: join(RAW_DIR, `${name}-done.png`) });
      await context.close().catch(() => undefined);
      return { raw: null, trimStart: 0, width, height };
    }
    await pageScreenMap(page);
    await pause(page, 280);
    const contentStart = Date.now();
    await act(page);
    await pause(page, 900);
    const video = page.video();
    await context.close();
    const raw = await video.path();
    return {
      raw,
      trimStart: Math.max(0, (contentStart - videoOrigin) / 1000),
      width,
      height,
    };
  } catch (error) {
    await page
      .screenshot({ path: join(RAW_DIR, `${name}-error.png`), fullPage: true })
      .catch(() => undefined);
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function writeWindowed(session, dest, minSec, maxSec) {
  const trimmed = join(RAW_DIR, `${dest.split('/').pop()}-trimmed.mp4`);
  await encodeMp4(session.raw, trimmed, [
    '-ss',
    session.trimStart.toFixed(2),
    '-vf',
    `scale=${session.width}:${session.height}:flags=lanczos`,
  ]);
  const duration = await encodeToWindow(trimmed, dest, minSec, maxSec);
  return duration;
}

async function main() {
  mkdirSync(VIDEO_DIR, { recursive: true });
  mkdirSync(RAW_DIR, { recursive: true });
  const unlettered = writeUnletteredCopy();
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
  const outputs = [];
  try {
    if (WANT_FULL || PROBE) {
      log('recording full lettering pass');
      const session = await recordSession(
        browser,
        unlettered.path,
        'full',
        async (page) => {
          if (PROBE) await letterPage(page, { only: 'speech' });
          else await letterPage(page);
        },
        { width: 1920, height: 1080 },
      );
      if (session.raw) {
        const dest = join(VIDEO_DIR, 'lettering-timelapse.mp4');
        const duration = await writeWindowed(session, dest, 30, 45);
        outputs.push({ path: dest, duration, width: 1920, height: 1080 });
        log(`wrote ${dest} (${duration.toFixed(2)}s)`);
      }
    }
    if (WANT_LOOP && !PROBE) {
      log('recording balloon + tail loop');
      const session = await recordSession(
        browser,
        unlettered.path,
        'loop',
        async (page) => {
          await placeDialogue(page, PLACEMENTS.speech);
          await dragSelectedTail(page, PLACEMENTS.speech);
          await pause(page, 800);
        },
        { width: 1920, height: 1080 },
      );
      if (session.raw) {
        const dest = join(VIDEO_DIR, 'balloon-tail-loop.mp4');
        const duration = await writeWindowed(session, dest, 6, 10);
        outputs.push({ path: dest, duration, width: 1920, height: 1080 });
        log(`wrote ${dest} (${duration.toFixed(2)}s)`);
      }
    }
    if (WANT_VERTICAL && !PROBE) {
      log('recording 9:16 vertical lettering pass');
      const session = await recordSession(
        browser,
        unlettered.path,
        'vertical',
        async (page) => {
          compactByPage.set(page, true);
          await hideSidePanels(page);
          await letterPage(page);
        },
        { width: 1080, height: 1920 },
      );
      if (session.raw) {
        const dest = join(VIDEO_DIR, 'lettering-vertical.mp4');
        const duration = await writeWindowed(session, dest, 15, 25);
        outputs.push({ path: dest, duration, width: 1080, height: 1920 });
        log(`wrote ${dest} (${duration.toFixed(2)}s)`);
      }
    }
    writeFileSync(join(RAW_DIR, 'outputs.json'), `${JSON.stringify(outputs, null, 2)}\n`);
  } finally {
    await browser.close().catch(() => undefined);
    await stopServer(server);
    rmSync(unlettered.dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
