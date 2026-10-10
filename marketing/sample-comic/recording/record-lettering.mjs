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
const VIEW_W = Number(process.env.VARVE_RECORD_WIDTH ?? 1920);
const VIEW_H = Number(process.env.VARVE_RECORD_HEIGHT ?? 1080);

const PAGE_W = 900;
const PAGE_H = 1260;
const MARGIN = 36;
const GUTTER = 20;
const PANEL_W = (PAGE_W - MARGIN * 2 - GUTTER) / 2;
const PANEL_H = (PAGE_H - MARGIN * 2 - GUTTER * 2) / 3;

const args = new Set(process.argv.slice(2));
const PROBE = args.has('--probe');
const WANT_FULL = args.has('--full') || (!args.has('--loop') && !PROBE);
const WANT_LOOP = args.has('--loop') || (!args.has('--full') && !PROBE);
const pointerByPage = new WeakMap();

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
    localX: 118,
    localY: 28,
    text: 'That morning...',
    action: 'Add Caption Box',
    query: 'caption box',
    fontSize: 22,
    layer: /caption balloon/i,
  },
  speech: {
    panel: 2,
    localX: 268,
    localY: 88,
    text: 'Perfect!',
    action: 'Add Speech Balloon',
    query: 'speech balloon',
    fontSize: 28,
    layer: /speech balloon/i,
    tailToward: { localX: 92, localY: 172 },
  },
  shout: {
    panel: 4,
    localX: 202,
    localY: 86,
    text: "WE'RE ALIVE!",
    action: 'Add Shout Balloon',
    query: 'shout balloon',
    fontSize: 30,
    layer: /shout balloon/i,
    tailToward: { localX: 202, localY: 220 },
  },
  thought: {
    panel: 5,
    localX: 268,
    localY: 58,
    text: 'Did I use magic flour...?',
    action: 'Add Thought Balloon',
    query: 'thought balloon',
    fontSize: 20,
    layer: /thought balloon/i,
    tailToward: { localX: 90, localY: 180 },
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
  const last = pointerByPage.get(page) ?? { x: VIEW_W / 2, y: VIEW_H / 2 };
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

async function openUnlettered(page, filePath) {
  await page.addInitScript(STORAGE_BOOT);
  await page.addInitScript(CURSOR_BOOT);
  await page.goto(`${BASE}/?isoTest=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await hideOverlays(page);
  await dismissNoise(page);
  const newBtn = page.getByRole('button', { name: /^new$/i });
  const firstDesign = page.getByRole('button', { name: /create your first design/i });
  await newBtn.or(firstDesign).first().waitFor({ state: 'visible', timeout: 120000 });
  if (await firstDesign.isVisible().catch(() => false)) {
    await firstDesign.click({ force: true });
  } else {
    await newBtn.click({ force: true });
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
  await create.click();
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
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(900);
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
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

async function selectLayer(page, pattern) {
  const item = page.getByRole('treeitem', { name: pattern }).first();
  try {
    await item.waitFor({ state: 'visible', timeout: 8000 });
  } catch (error) {
    throw new Error(`layer ${pattern} missing; layers=${JSON.stringify(await layerNames(page))}`, {
      cause: error,
    });
  }
  const box = await item.boundingBox();
  if (box) await clickAt(page, box.x + 28, box.y + box.height / 2, 260);
  else await item.click();
  await pause(page, 160);
  return item;
}

async function filterLayers(page, query) {
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
    await pause(page, 160);
  }
}

async function focusCanvas(page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (box) await page.mouse.click(box.x + 20, box.y + 20);
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

async function setSelectedFontSize(page, size) {
  const field = page
    .locator('.inspector-panel')
    .getByRole('spinbutton', { name: /^size$/i })
    .first();
  if (!(await field.isVisible({ timeout: 2500 }).catch(() => false))) return;
  const box = await field.boundingBox();
  if (box) await clickAt(page, box.x + 18, box.y + box.height / 2, 240);
  else await field.click();
  await page.keyboard.press('Control+a');
  await typeHuman(page, String(size), 40);
  await page.keyboard.press('Enter');
  await pause(page, 180);
}

async function wrapSelectedText(page, query, actionName) {
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: /search actions/i });
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await pause(page, 180);
  await typeHuman(page, query, 42);
  const option = page.getByRole('option', { name: new RegExp(actionName, 'i') }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await pause(page, 220);
  const box = await option.boundingBox();
  if (box) await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, 240);
  else await option.click();
  await page
    .getByRole('dialog', { name: /quick actions/i })
    .waitFor({ state: 'hidden', timeout: 4000 })
    .catch(() => undefined);
  await pause(page, 420);
}

async function placeDialogue(page, map, placement) {
  await filterLayers(page, '');
  await focusCanvas(page);
  const point = localToScreen(map, placement.panel, placement.localX, placement.localY);
  const editor = page.getByRole('textbox', { name: /editing text/i });
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await chooseTextTool(page);
    await clickAt(page, point.x, point.y, 420);
    opened = await editor
      .waitFor({ state: 'visible', timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      await page.keyboard.press('Escape').catch(() => undefined);
      await pause(page, 160);
    }
  }
  if (!opened)
    throw new Error(`text editor did not open at ${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  await pause(page, 160);
  await typeHuman(page, placement.text, 40);
  await pause(page, 280);
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  await page.keyboard.press('v');
  await pause(page, 180);
  const snippet = placement.text.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const textLayer = page
    .getByRole('treeitem', { name: new RegExp(`text:|${snippet}`, 'i') })
    .first();
  if (await textLayer.isVisible({ timeout: 1500 }).catch(() => false)) {
    await selectLayer(page, new RegExp(`text:|${snippet}`, 'i'));
  }
  if (placement.fontSize) await setSelectedFontSize(page, placement.fontSize);
  if (await textLayer.isVisible({ timeout: 800 }).catch(() => false)) {
    await selectLayer(page, new RegExp(`text:|${snippet}`, 'i'));
  }
  await wrapSelectedText(page, placement.query, placement.action);
  if (placement.layer) {
    const balloon = page.getByRole('treeitem', { name: placement.layer }).first();
    await balloon.waitFor({ state: 'visible', timeout: 6000 }).catch(() => undefined);
  }
}

async function clickInspectorButton(page, name) {
  const button = page.getByRole('button', { name, exact: true }).first();
  if (!(await button.isVisible({ timeout: 1800 }).catch(() => false))) return false;
  const box = await button.boundingBox();
  if (box) await clickAt(page, box.x + Math.min(72, box.width / 2), box.y + box.height / 2, 260);
  else await button.click();
  await pause(page, 320);
  return true;
}

async function revealBalloon(page, pattern) {
  await filterLayers(page, 'balloon');
  const item = page.getByRole('treeitem', { name: pattern }).first();
  if (await item.isVisible({ timeout: 2500 }).catch(() => false)) {
    await selectLayer(page, pattern);
    await item.press('ArrowRight');
    await pause(page, 160);
    return true;
  }
  return false;
}

async function removeCaptionTail(page) {
  await revealBalloon(page, /caption balloon/i);
  const section = page.getByRole('button', { name: /comic balloon/i });
  if (await section.isVisible({ timeout: 1500 }).catch(() => false)) {
    if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();
  }
  await clickInspectorButton(page, 'Remove tail');
  await filterLayers(page, '');
}

async function dragSelectedTail(page, map, placement) {
  if (!placement.tailToward) return;
  await revealBalloon(page, placement.layer ?? /(speech|shout|thought) balloon/i);
  const tail = page.getByRole('treeitem', { name: /balloon tail|thought bubble/i }).first();
  if (!(await tail.isVisible({ timeout: 2000 }).catch(() => false))) return;
  await selectLayer(page, /balloon tail|thought bubble/i);
  const start = await page.evaluate(() => {
    const hooks = window.__varveIsoTest;
    const canvas = document.querySelector('.editor-canvas');
    if (!hooks || !canvas) return null;
    const geometry = hooks.getSelectionGeometry()[0];
    if (!geometry) return null;
    const rect = canvas.getBoundingClientRect();
    const matrix = geometry.worldTransform;
    const shape = geometry.shape;
    let lx = 0;
    let ly = 0;
    if (shape?.kind === 'circle') {
      lx = shape.cx ?? 0;
      ly = shape.cy ?? 0;
    } else if (shape?.kind === 'rect') {
      lx = (shape.x ?? 0) + (shape.w ?? 0) / 2;
      ly = (shape.y ?? 0) + (shape.h ?? 0);
    } else {
      lx = 0;
      ly = 40;
    }
    const wx = matrix[0] * lx + matrix[2] * ly + matrix[4];
    const wy = matrix[1] * lx + matrix[3] * ly + matrix[5];
    const screen = hooks.worldToScreen(wx, wy);
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  });
  const end = localToScreen(
    map,
    placement.panel,
    placement.tailToward.localX,
    placement.tailToward.localY,
  );
  const from =
    start ?? localToScreen(map, placement.panel, placement.localX, placement.localY + 50);
  await humanMove(page, from.x, from.y, 360);
  await page.mouse.down();
  await pause(page, 80);
  await humanMove(page, end.x, end.y, 700);
  await pause(page, 80);
  await page.mouse.up();
  await pause(page, 360);
  await filterLayers(page, '');
}

async function demonstrateFit(page, map) {
  await filterLayers(page, '');
  const revealed = await revealBalloon(page, /speech balloon/i);
  if (!revealed) return;
  const edit = page.getByRole('button', { name: 'Edit text', exact: true });
  if (await edit.isVisible({ timeout: 1200 }).catch(() => false)) {
    const box = await edit.boundingBox();
    if (box) await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, 260);
    else await edit.click();
    const editor = page.getByRole('textbox', { name: /editing text/i });
    if (
      await editor
        .waitFor({ state: 'visible', timeout: 2500 })
        .then(() => true)
        .catch(() => false)
    ) {
      await page.keyboard.press('Control+a');
      await pause(page, 120);
      await typeHuman(page, 'Perfect! These came out just right!', 36);
      await pause(page, 260);
      await page.keyboard.press('Escape');
      await editor.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => undefined);
    }
  } else {
    const canvasPoint = localToScreen(
      map,
      PLACEMENTS.speech.panel,
      PLACEMENTS.speech.localX,
      PLACEMENTS.speech.localY,
    );
    await humanMove(page, canvasPoint.x, canvasPoint.y, 280);
    await page.mouse.dblclick(canvasPoint.x, canvasPoint.y);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    if (await editor.isVisible({ timeout: 1500 }).catch(() => false)) {
      await page.keyboard.press('Control+a');
      await typeHuman(page, 'Perfect! These came out just right!', 36);
      await page.keyboard.press('Escape');
    }
  }
  await page.keyboard.press('v');
  await pause(page, 180);
  await revealBalloon(page, /speech balloon/i);
  await clickInspectorButton(page, 'Fit balloon to text');
  await pause(page, 700);
}

async function letterPage(page, map, options = {}) {
  const include = options.only ? [options.only] : ['caption', 'speech', 'shout', 'thought'];
  for (const key of include) {
    const placement = PLACEMENTS[key];
    await placeDialogue(page, map, placement);
    if (key === 'caption') {
      await removeCaptionTail(page);
      await clickInspectorButton(page, 'Fit balloon to text');
    }
    if (placement.tailToward) await dragSelectedTail(page, map, placement);
    await pause(page, 420);
    if (PROBE) {
      await page.screenshot({ path: join(RAW_DIR, `probe-${key}.png`) });
    }
  }
  if (!options.only) await demonstrateFit(page, map).catch(() => undefined);
  await page.keyboard.press('Escape');
  await page.mouse.click(24, 24).catch(() => undefined);
  await page.keyboard.press('Shift+Digit1');
  await pause(page, 900);
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

async function recordSession(browser, filePath, name, act) {
  mkdirSync(RAW_DIR, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: VIEW_W, height: VIEW_H },
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW_DIR, size: { width: VIEW_W, height: VIEW_H } },
  });
  const page = await context.newPage();
  pointerByPage.set(page, { x: VIEW_W * 0.55, y: VIEW_H * 0.45 });
  const openedAt = { ms: 0 };
  try {
    await openUnlettered(page, filePath);
    openedAt.ms = Date.now();
    if (PROBE) {
      mkdirSync(RAW_DIR, { recursive: true });
      const map = await pageScreenMap(page);
      await page.screenshot({ path: join(RAW_DIR, `${name}-open.png`), animations: 'disabled' });
      writeFileSync(join(RAW_DIR, `${name}-map.json`), `${JSON.stringify(map, null, 2)}\n`);
      await act(page, map);
      await page.screenshot({ path: join(RAW_DIR, `${name}-done.png`) });
      return { raw: null, trimStart: 0 };
    }
    const map = await pageScreenMap(page);
    await pause(page, 500);
    const contentStart = Date.now();
    await act(page, map);
    await pause(page, 800);
    const video = page.video();
    await context.close();
    const raw = await video.path();
    return { raw, trimStart: Math.max(0, (contentStart - openedAt.ms) / 1000 - 0.35) };
  } catch (error) {
    await page
      .screenshot({ path: join(RAW_DIR, `${name}-error.png`), fullPage: true })
      .catch(() => undefined);
    await context.close().catch(() => undefined);
    throw error;
  }
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
      const session = await recordSession(browser, unlettered.path, 'full', async (page, map) => {
        await letterPage(page, map);
      });
      if (session.raw) {
        const trimmed = join(RAW_DIR, 'full-trimmed.mp4');
        await encodeMp4(session.raw, trimmed, [
          '-ss',
          session.trimStart.toFixed(2),
          '-vf',
          `scale=${VIEW_W}:${VIEW_H}:flags=lanczos`,
        ]);
        const dest = join(VIDEO_DIR, 'lettering-timelapse.mp4');
        const duration = await encodeToWindow(trimmed, dest, 30, 45);
        outputs.push({ path: dest, duration });
        log(`wrote ${dest} (${duration.toFixed(2)}s)`);
      }
    }
    if (WANT_LOOP && !PROBE) {
      log('recording balloon + tail loop');
      const session = await recordSession(browser, unlettered.path, 'loop', async (page, map) => {
        await placeDialogue(page, map, PLACEMENTS.speech);
        await dragSelectedTail(page, map, PLACEMENTS.speech);
        await pause(page, 700);
      });
      if (session.raw) {
        const trimmed = join(RAW_DIR, 'loop-trimmed.mp4');
        await encodeMp4(session.raw, trimmed, [
          '-ss',
          session.trimStart.toFixed(2),
          '-vf',
          `scale=${VIEW_W}:${VIEW_H}:flags=lanczos`,
        ]);
        const dest = join(VIDEO_DIR, 'balloon-tail-loop.mp4');
        const duration = await encodeToWindow(trimmed, dest, 6, 10);
        outputs.push({ path: dest, duration });
        log(`wrote ${dest} (${duration.toFixed(2)}s)`);
      }
    }
    if (WANT_FULL && !PROBE) {
      const full = join(VIDEO_DIR, 'lettering-timelapse.mp4');
      if (existsSync(full)) {
        const dest = join(VIDEO_DIR, 'lettering-vertical.mp4');
        const cropW = Math.floor((VIEW_H * 9) / 16 / 2) * 2;
        const cropX = Math.floor((VIEW_W - cropW) / 2);
        const duration = await encodeToWindow(
          full,
          dest,
          15,
          25,
          `crop=${cropW}:${VIEW_H}:${cropX}:0,scale=${cropW}:${VIEW_H}:flags=lanczos`,
        );
        outputs.push({ path: dest, duration });
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
