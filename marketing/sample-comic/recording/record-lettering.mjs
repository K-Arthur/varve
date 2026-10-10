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

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xc0ffee42);
function randBetween(min, max) {
  return min + rand() * (max - min);
}
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Irregular progress so a move does not share one cubic ease with every other. */
function humanEase() {
  const pulses = 3 + Math.floor(rand() * 3);
  const speeds = [];
  const widths = [];
  let widthSum = 0;
  for (let i = 0; i < pulses; i++) {
    speeds.push(randBetween(0.4, 1.85));
    const width = randBetween(0.14, 0.42);
    widths.push(width);
    widthSum += width;
  }
  const cdf = [0];
  let acc = 0;
  for (let i = 0; i < pulses; i++) {
    acc += (speeds[i] * widths[i]) / widthSum;
    cdf.push(acc);
  }
  const total = cdf[cdf.length - 1] || 1;
  return (u) => {
    const target = Math.min(1, Math.max(0, u)) * total;
    for (let i = 1; i < cdf.length; i++) {
      if (target <= cdf[i]) {
        const span = cdf[i] - cdf[i - 1];
        const local = span <= 0 ? 1 : (target - cdf[i - 1]) / span;
        const s = local * local * (3 - 2 * local);
        return (i - 1) / pulses + s / pulses;
      }
    }
    return 1;
  };
}

function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

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
    boxW: 128,
    boxH: 36,
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
    localX: 48,
    localY: 18,
    boxW: 168,
    boxH: 72,
    text: 'Did I use\nmagic flour...?',
    action: 'Add Thought Balloon',
    query: 'thought balloon',
    fontSize: 15,
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
  const STYLE_ID = 'varve-marketing-cursor-style';
  const NODE_ID = 'varve-marketing-cursor';
  const css = \`
    html, body, * { cursor: none !important; }
    vite-error-overlay, #webpack-dev-server-client-overlay,
    #webpack-dev-server-client-overlay-div { display: none !important; }
    #varve-marketing-cursor,
    #varve-marketing-cursor:popover-open {
      position: fixed;
      inset: unset;
      left: 0;
      top: 0;
      width: 40px;
      height: 40px;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      overflow: visible;
      pointer-events: none;
      z-index: 2147483646;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45));
    }
  \`;
  const svg =
    '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 4.2L32.2 20.4L19.4 22.6L15.2 35.6L5 4.2Z" fill="#111111" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></svg>';
  const ensure = () => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
    }
    if (style.parentNode !== document.documentElement) {
      document.documentElement.appendChild(style);
    }
    let cursor = document.getElementById(NODE_ID);
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.id = NODE_ID;
      cursor.setAttribute('aria-hidden', 'true');
      cursor.innerHTML = svg;
    }
    if (cursor.parentNode !== document.documentElement) {
      document.documentElement.appendChild(cursor);
    }
    if (typeof cursor.showPopover === 'function') {
      cursor.setAttribute('popover', 'manual');
      try {
        cursor.showPopover();
      } catch {
        /* already open */
      }
    }
    return cursor;
  };
  window.__varveSetCursor = (x, y) => {
    const cursor = ensure();
    cursor.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 4) + 'px)';
    window.__varveCursorPos = { x: x, y: y };
  };
  if (!window.__varveMarketingCursor) {
    window.__varveMarketingCursor = true;
    document.addEventListener(
      'mousemove',
      (event) => {
        window.__varveSetCursor(event.clientX, event.clientY);
      },
      true,
    );
    new MutationObserver(() => {
      ensure();
      const pos = window.__varveCursorPos;
      if (pos) window.__varveSetCursor(pos.x, pos.y);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  ensure();
  if (window.__varveCursorPos) {
    window.__varveSetCursor(window.__varveCursorPos.x, window.__varveCursorPos.y);
  }
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

async function syncCursor(page, x, y) {
  await page
    .evaluate(
      (pos) => {
        if (typeof window.__varveSetCursor === 'function') {
          window.__varveSetCursor(pos.x, pos.y);
        }
      },
      { x, y },
    )
    .catch(() => undefined);
}

async function ensureMarketingCursor(page) {
  await page.evaluate(CURSOR_BOOT).catch(() => undefined);
  const last = pointerByPage.get(page);
  if (last) await syncCursor(page, last.x, last.y);
}

async function stepCursor(page, x, y) {
  await page.mouse.move(x, y);
  await syncCursor(page, x, y);
}

async function humanMove(page, x, y, opts = {}) {
  const last = pointerByPage.get(page) ?? { x: 480, y: 420 };
  const dx = x - last.x;
  const dy = y - last.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 3) {
    await stepCursor(page, x, y);
    pointerByPage.set(page, { x, y });
    return;
  }
  const drag = opts.drag === true;
  const nx = -dy / dist;
  const ny = dx / dist;
  const curve = drag ? [0.03, 0.1] : [0.24, 0.62];
  const curve2 = drag ? [0.03, 0.1] : [0.18, 0.55];
  const o1 = dist * randBetween(curve[0], curve[1]) * (rand() < 0.5 ? -1 : 1);
  const o2 = dist * randBetween(curve2[0], curve2[1]) * (rand() < 0.5 ? -1 : 1);
  const p0 = last;
  const p1 = {
    x: last.x + dx * randBetween(0.14, 0.42) + nx * o1 + randBetween(-18, 18),
    y: last.y + dy * randBetween(0.14, 0.42) + ny * o1 + randBetween(-18, 18),
  };
  const p2 = {
    x: last.x + dx * randBetween(0.56, 0.88) + nx * o2 + randBetween(-20, 20),
    y: last.y + dy * randBetween(0.56, 0.88) + ny * o2 + randBetween(-20, 20),
  };
  const longMove = !drag && dist > 70;
  const overshoot = longMove && rand() < 0.8;
  const ox = overshoot ? x + (dx / dist) * randBetween(14, 34) + nx * randBetween(-12, 12) : x;
  const oy = overshoot ? y + (dy / dist) * randBetween(14, 34) + ny * randBetween(-12, 12) : y;
  const speed = drag ? randBetween(480, 920) : randBetween(320, 820);
  const duration = Math.max(drag ? 180 : 320, (dist / speed) * 1000);
  const steps = Math.max(drag ? 12 : 20, Math.round(duration / (drag ? 16 : 17)));
  const progress = drag ? easeInOutCubic : humanEase();
  const pauseAt = !drag && rand() < 0.22 ? randBetween(0.28, 0.72) : -1;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const t = Math.min(1, Math.max(0, progress(u)));
    const pt = cubicBezier(p0, p1, p2, { x: ox, y: oy }, t);
    const jitter = drag ? randBetween(-0.8, 0.8) : randBetween(-2.4, 2.4);
    await stepCursor(page, pt.x + jitter, pt.y + (drag ? randBetween(-0.6, 0.6) : jitter));
    if (pauseAt > 0 && u >= pauseAt && u - 1 / steps < pauseAt) {
      await page.waitForTimeout(randBetween(70, 180));
    }
    const edge = Math.min(u, 1 - u);
    await page.waitForTimeout(
      drag ? randBetween(8, 16) : edge < 0.18 ? randBetween(16, 36) : randBetween(8, 24),
    );
  }
  if (overshoot) {
    const mid = {
      x: ox + (x - ox) * 0.55 + nx * randBetween(-8, 8),
      y: oy + (y - oy) * 0.55 + ny * randBetween(-8, 8),
    };
    const settle = Math.max(6, Math.round(randBetween(120, 220) / 16));
    const settleEase = humanEase();
    for (let i = 1; i <= settle; i++) {
      const t = settleEase(i / settle);
      const sx = cubicBezier({ x: ox, y: oy }, mid, mid, { x, y }, t);
      await stepCursor(page, sx.x + randBetween(-1.4, 1.4), sx.y + randBetween(-1.4, 1.4));
      await page.waitForTimeout(randBetween(12, 28));
    }
  }
  await stepCursor(page, x, y);
  pointerByPage.set(page, { x, y });
}

async function pause(page, ms) {
  await page.waitForTimeout(ms);
}

async function think(page, min = 400, max = 1500) {
  await pause(page, randBetween(min, max));
}

async function clickAt(page, x, y) {
  await humanMove(page, x, y);
  await think(page, 400, 1500);
  await page.mouse.click(x, y);
  await pause(page, randBetween(140, 320));
}

async function typeHuman(page, text) {
  const lines = String(text).split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      await page.keyboard.type(ch, { delay: 0 });
      await pause(page, randBetween(60, 220));
      const atWord = ch === ' ' || /[.,!?…;:]/.test(ch);
      const nextIsWord = i + 1 < line.length && line[i + 1] === ' ';
      if (atWord || nextIsWord) await pause(page, randBetween(180, 480));
      else if (rand() < 0.16) await pause(page, randBetween(160, 380));
    }
    if (index < lines.length - 1) {
      await think(page, 400, 900);
      await page.keyboard.press('Enter');
      await think(page, 280, 640);
    }
  }
}

async function beat(page, min = 380, max = 720) {
  await think(page, min, max);
}

async function currentZoom(page) {
  const zoomField = page.locator('.editor-status__zoom-value');
  const label = await zoomField.getAttribute('aria-label').catch(() => null);
  const fromLabel = /Zoom\s+([\d.]+)\s*%/i.exec(label ?? '');
  if (fromLabel) return Number(fromLabel[1]) / 100;
  const map = await pageScreenMap(page);
  return map.h / PAGE_H;
}

async function clickStatusButton(page, name) {
  const button = page.getByRole('button', { name }).first();
  if (!(await button.isVisible({ timeout: 800 }).catch(() => false))) return false;
  const box = await button.boundingBox();
  if (box) await clickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  else await button.click();
  await beat(page, 480, 820);
  return true;
}

async function dispatchCanvasWheel(page, x, y, deltaY) {
  await page.evaluate(
    ({ clientX, clientY, deltaY: dy }) => {
      const canvas = document.querySelector('canvas.editor-canvas__content-layer');
      if (!canvas) return;
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          clientX,
          clientY,
          deltaX: 0,
          deltaY: dy,
          deltaMode: 0,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { clientX: x, clientY: y, deltaY },
  );
}

async function wheelZoomToward(page, x, y, targetZoom) {
  await humanMove(page, x, y);
  await think(page, 160, 320);
  let px = x;
  let py = y;
  const ceiling = Math.min(2.35, targetZoom * 1.12);
  const floor = Math.max(0.38, targetZoom * 0.88);
  for (let i = 0; i < 14; i++) {
    const zoom = await currentZoom(page);
    const inward = zoom < targetZoom;
    if (Math.abs(zoom - targetZoom) < 0.07) break;
    if (inward && zoom >= ceiling) break;
    if (!inward && zoom <= floor) break;
    const mag = randBetween(9, 18);
    await dispatchCanvasWheel(page, px, py, inward ? -mag : mag);
    await pause(page, randBetween(48, 82));
    if (i === 2 && Math.abs((await currentZoom(page)) - zoom) < 0.01) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, inward ? -mag : mag);
      await page.keyboard.up('Control');
    }
    if (i % 4 === 3) {
      px += randBetween(-7, 7);
      py += randBetween(-7, 7);
      await page.mouse.move(px, py);
      pointerByPage.set(page, { x: px, y: py });
    }
  }
}

async function easeCameraToPanel(page, panelIndex) {
  if (compactByPage.get(page)) {
    await hideSidePanels(page);
    await clickStatusButton(page, /fit all to viewport/i);
    const map = await pageScreenMap(page);
    const mid = localToScreen(map, panelIndex, PANEL_W / 2, PANEL_H / 2);
    await wheelZoomToward(page, mid.x, mid.y, randBetween(1.7, 2.1));
    log(`camera panel ${panelIndex + 1} zoom=${(await currentZoom(page)).toFixed(2)}`);
    await think(page, 400, 1100);
    return;
  }
  const map = await pageScreenMap(page);
  const mid = localToScreen(map, panelIndex, PANEL_W / 2, PANEL_H / 2);
  await clickAt(page, mid.x, mid.y);
  const fitted = await clickStatusButton(page, /fit selection to viewport/i);
  if (!fitted) {
    await blurChrome(page);
    await page.keyboard.press('Shift+Digit2');
    await beat(page, 700, 1100);
  }
  const zoom = await currentZoom(page);
  log(`camera panel ${panelIndex + 1} zoom=${zoom.toFixed(2)}`);
  if (zoom > 3.4) {
    await clickStatusButton(page, /fit all to viewport/i);
    log(`camera panel ${panelIndex + 1} backed out zoom=${(await currentZoom(page)).toFixed(2)}`);
  } else if (zoom < 1.15) {
    const after = await pageScreenMap(page);
    const aim = localToScreen(after, panelIndex, PANEL_W / 2, PANEL_H / 2);
    await wheelZoomToward(page, aim.x, aim.y, 1.65);
    log(`camera panel ${panelIndex + 1} nudged zoom=${(await currentZoom(page)).toFixed(2)}`);
  }
  await beat(page, 240, 420);
}

async function easeCameraToPage(page) {
  if (compactByPage.get(page)) await hideSidePanels(page);
  const map = await pageScreenMap(page);
  const margin = {
    x: map.origin.x + 10,
    y: map.origin.y + 10,
  };
  await clickAt(page, margin.x, margin.y);
  const fitted = await clickStatusButton(page, /fit selection to viewport/i);
  if (!fitted) {
    await clickStatusButton(page, /fit all to viewport/i);
  }
  if ((await currentZoom(page)) > 1.3) {
    await clickStatusButton(page, /fit all to viewport/i);
  }
  log(`camera page zoom=${(await currentZoom(page)).toFixed(2)}`);
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
      const box = await fab.boundingBox();
      if (box) await clickAt(page, box.x + box.width / 2, box.y + box.height / 2);
      else await fab.click();
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

async function ensureInspector(page, opts = {}) {
  if (!compactByPage.get(page)) return true;
  const kind = await selectionKind(page);
  if (opts.requireGroup !== false && kind !== 'group') {
    log(`inspector stays hidden; selection=${kind}`);
    return false;
  }
  await setSidePanel(page, 'layers', false);
  await setSidePanel(page, 'inspector', true);
  return true;
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
  await ensureMarketingCursor(page);
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
  if (box) await clickAt(page, box.x + Math.min(96, box.width * 0.55), box.y + box.height / 2, 240);
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

async function setTextResizingFixed(page) {
  await ensureInspector(page);
  const trigger = page.getByRole('combobox', { name: /text resizing mode/i }).first();
  if (!(await trigger.isVisible({ timeout: 800 }).catch(() => false))) return false;
  await trigger.click();
  const option = page.getByRole('option', { name: /fixed size/i }).first();
  if (
    !(await option
      .waitFor({ state: 'visible', timeout: 800 })
      .then(() => true)
      .catch(() => false))
  ) {
    await page.keyboard.press('Escape').catch(() => undefined);
    return false;
  }
  await option.click();
  await pause(page, 160);
  return true;
}

async function clampTextBox(page, placement) {
  await setTextResizingFixed(page);
  if (compactByPage.get(page)) return;
  const width = await setSpin(page, 'w', placement.boxW);
  const height = await setSpin(page, 'h', placement.boxH);
  log(
    `clamp text ${placement.action} -> ${placement.boxW}x${placement.boxH} spins=${width}/${height}`,
  );
}

async function clampBalloonInPanel(page, placement) {
  await revealBalloon(page, placement.layer ?? /balloon/i);
  const maxW = Math.max(96, Math.round(PANEL_W - placement.localX - 16));
  const maxH = Math.max(64, Math.round(PANEL_H - placement.localY - 56));
  const width = await readSpin(page, 'w');
  const height = await readSpin(page, 'h');
  if (width != null && width > maxW) await setSpin(page, 'w', maxW);
  if (height != null && height > maxH) await setSpin(page, 'h', maxH);
  if (!compactByPage.get(page)) await seatTextInBalloon(page);
  await revealBalloon(page, placement.layer ?? /balloon/i);
}

async function inspectorRoot(page) {
  return page.locator('.editor-inspector, .editor__inspector-panel, [data-panel-root="inspector"]');
}

async function setSpin(page, name, value) {
  await ensureInspector(page);
  const field = (await inspectorRoot(page))
    .getByRole('spinbutton', { name: new RegExp(`^${name}(?:\\s*\\([^)]*\\))?$`, 'i') })
    .first();
  if (!(await field.isVisible({ timeout: 1800 }).catch(() => false))) {
    log(`spinbutton "${name}" not visible`);
    return false;
  }
  const box = await field.boundingBox();
  if (box) await clickAt(page, box.x + 18, box.y + box.height / 2);
  else await field.click();
  await page.keyboard.press('Control+a');
  await typeHuman(page, String(value));
  await page.keyboard.press('Enter');
  await beat(page, 220, 420);
  return true;
}

async function scrubSpin(page, name, deltaPx) {
  await ensureInspector(page);
  const field = (await inspectorRoot(page))
    .getByRole('spinbutton', { name: new RegExp(`^${name}(?:\\s*\\([^)]*\\))?$`, 'i') })
    .first();
  if (!(await field.isVisible({ timeout: 1800 }).catch(() => false))) {
    log(`spinbutton "${name}" not visible`);
    return false;
  }
  const fieldId = await field.getAttribute('id');
  const label = fieldId
    ? page.locator(`label[for="${fieldId}"]`).first()
    : (await inspectorRoot(page))
        .locator('label')
        .filter({ hasText: new RegExp(name, 'i') })
        .first();
  const box = (await label.boundingBox().catch(() => null)) ?? (await field.boundingBox());
  if (!box) return false;
  const startX = box.x + Math.min(18, box.width * 0.4);
  const startY = box.y + box.height / 2 + randBetween(-2, 2);
  await humanMove(page, startX, startY);
  await think(page, 250, 620);
  await page.mouse.down();
  await pause(page, randBetween(50, 90));
  const endX = startX + deltaPx + randBetween(-2, 2);
  const endY = startY + randBetween(-2, 2);
  await humanMove(page, endX, endY, { drag: true });
  await pause(page, randBetween(80, 140));
  await page.mouse.up();
  await beat(page, 260, 520);
  return true;
}

async function wrapSelectedText(page, query, actionName) {
  await blurChrome(page);
  const inspectorAdd = page.getByRole('button', { name: actionName, exact: true }).first();
  if (
    !compactByPage.get(page) &&
    (await inspectorAdd.isVisible({ timeout: 800 }).catch(() => false))
  ) {
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

async function followPanel(page, panelIndex) {
  await easeCameraToPanel(page, panelIndex);
  const zoom = await currentZoom(page);
  if (zoom >= 1.15 && zoom <= 3.4) {
    if (compactByPage.get(page)) await hideSidePanels(page);
    return;
  }
  const map = await pageScreenMap(page);
  const mid = localToScreen(map, panelIndex, PANEL_W / 2, PANEL_H / 2);
  const view = page.viewportSize() ?? { width: 1920, height: 1080 };
  const insane = map.h > 6000 || map.h < 80 || mid.y < 40 || mid.y > view.height - 40;
  if (insane) {
    await easeCameraToPage(page);
    await easeCameraToPanel(page, panelIndex);
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

async function openComicSection(page) {
  await ensureInspector(page);
  const section = page.getByRole('button', { name: /comic balloon/i }).first();
  if (
    !(await section
      .waitFor({ state: 'attached', timeout: 2500 })
      .then(() => true)
      .catch(() => false))
  ) {
    return false;
  }
  await section.scrollIntoViewIfNeeded().catch(() => undefined);
  if (!(await section.isVisible({ timeout: 2000 }).catch(() => false))) return false;
  if ((await section.getAttribute('aria-expanded')) === 'false') {
    const box = await section.boundingBox();
    if (box) await clickAt(page, box.x + 24, box.y + box.height / 2, 220);
    else await section.click();
    await pause(page, 180);
  }
  const tailX = page
    .locator('.editor-inspector, .editor__inspector-panel, [data-panel-root="inspector"]')
    .getByRole('spinbutton', { name: /^tail x/i })
    .first();
  if (await tailX.isVisible({ timeout: 800 }).catch(() => false)) {
    await tailX.scrollIntoViewIfNeeded().catch(() => undefined);
  }
  return true;
}

async function selectionKind(page) {
  return page.evaluate(() => window.__varveIsoTest?.getSelectionGeometry?.()?.[0]?.kind ?? null);
}

async function waitForCalloutGroup(page, placement) {
  await setSidePanel(page, 'inspector', false);
  for (let i = 0; i < 12; i++) {
    if ((await selectionKind(page)) === 'group') {
      await pause(page, 240);
      if ((await selectionKind(page)) === 'group') return true;
    }
    await setSidePanel(page, 'inspector', false);
    await pause(page, 90);
  }
  if ((await selectionKind(page)) !== 'group') {
    await selectCalloutGroup(page, placement);
  }
  await setSidePanel(page, 'inspector', false);
  return (await selectionKind(page)) === 'group';
}

async function selectCalloutGroup(page, placement) {
  await setSidePanel(page, 'inspector', false);
  if ((await selectionKind(page)) === 'group') return true;
  const map = await pageScreenMap(page);
  const probes = [
    [placement.localX + 36, placement.localY + 22],
    [placement.localX + 52, placement.localY + 18],
    [placement.localX + 24, placement.localY + 28],
  ];
  for (const [lx, ly] of probes) {
    const body = localToScreen(map, placement.panel, lx, ly);
    await clickAt(page, body.x, body.y);
    await setSidePanel(page, 'inspector', false);
    if ((await selectionKind(page)) === 'group') return true;
  }
  return false;
}

async function showSettledCalloutInspector(page, placement) {
  const ready = await waitForCalloutGroup(page, placement);
  if (!ready) {
    log('callout group not selected; inspector stays hidden');
    return false;
  }
  await think(page, 400, 1100);
  if (!(await ensureInspector(page))) return false;
  const comic = page.getByRole('button', { name: /comic balloon/i }).first();
  if (!(await comic.isVisible({ timeout: 2000 }).catch(() => false))) {
    await setSidePanel(page, 'inspector', false);
    await think(page, 400, 800);
    if (!(await waitForCalloutGroup(page, placement))) return false;
    if (!(await ensureInspector(page))) return false;
  }
  await openComicSection(page);
  await think(page, 400, 1500);
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
    await selectLayer(page, pick);
    await openComicSection(page);
    const selected = await page.evaluate(
      () => window.__varveIsoTest?.getSelection?.()?.length ?? 0,
    );
    if (selected === 0) {
      await selectLayer(page, pick);
      await openComicSection(page);
    }
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
  let end = localToScreen(
    map,
    placement.panel,
    placement.localX + placement.boxW,
    placement.localY + placement.boxH,
  );
  const inset = 16;
  start = {
    x: Math.min(view.width - inset - 80, Math.max(inset, start.x)),
    y: Math.min(view.height - 120, Math.max(80, start.y)),
  };
  end = {
    x: Math.min(view.width - inset, Math.max(start.x + 80, end.x)),
    y: Math.min(view.height - 80, Math.max(start.y + 36, end.y)),
  };
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
  await think(page, 200, 420);
  await typeHuman(page, placement.text);
  await beat(page, 420, 780);
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  await page.keyboard.press('v');
  await beat(page, 260, 480);
  if (compactByPage.get(page)) {
    await hideSidePanels(page);
    await think(page, 400, 1100);
    await wrapSelectedText(page, placement.query, placement.action);
    await hideSidePanels(page);
    await think(page, 400, 900);
    const inspectorReady = await showSettledCalloutInspector(page, placement);
    if (inspectorReady) {
      await clickInspectorButton(page, 'Fit balloon to text');
      await think(page, 400, 1200);
      if (placement.action.includes('Speech')) {
        await growBalloonLikeAPerson(page);
      }
    }
    if (inspectorReady && placement.action.includes('Caption')) {
      await clickInspectorButton(page, 'Remove tail');
      await think(page, 400, 1100);
    } else if (inspectorReady && placement.tailToward) {
      const startX = (await readSpin(page, 'tail x')) ?? 40;
      const startY = (await readSpin(page, 'tail y')) ?? 80;
      const tailX = Math.round(placement.tailToward.localX - placement.localX);
      const tailY = Math.round(placement.tailToward.localY - placement.localY);
      log(`tail aim ${startX},${startY} -> ${tailX},${tailY}`);
      await scrubSpin(page, 'tail x', tailX - startX);
      if (Math.abs(tailY - startY) > 8) await scrubSpin(page, 'tail y', tailY - startY);
      await think(page, 400, 1100);
    }
    await hideSidePanels(page);
    await think(page, 400, 900);
    return;
  }
  const snippet = placement.text
    .split('\n')[0]
    .slice(0, 10)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  await clampTextBox(page, placement);
  if (
    await textLayer
      .last()
      .isVisible({ timeout: 800 })
      .catch(() => false)
  ) {
    await selectLayer(page, new RegExp(`text:.*${snippet}`, 'i'), 'last');
  }
  await wrapSelectedText(page, placement.query, placement.action);
  await beat(page, 500, 900);
  await revealBalloon(page, placement.layer ?? /balloon/i);
  if (PROBE) await dumpBalloon(page, `wrap-${placement.action.replace(/\s+/g, '-').toLowerCase()}`);
  await seatTextInBalloon(page);
  await revealBalloon(page, placement.layer ?? /balloon/i);
  await clickInspectorButton(page, 'Fit balloon to text');
  await beat(page, 480, 820);
  await clampBalloonInPanel(page, placement);
  if (PROBE) await dumpBalloon(page, `fit-${placement.action.replace(/\s+/g, '-').toLowerCase()}`);
  await beat(page, 360, 640);
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
    if (compactByPage.get(page)) {
      const map = await pageScreenMap(page);
      const body = localToScreen(
        map,
        PLACEMENTS.caption.panel,
        PLACEMENTS.caption.localX + 36,
        PLACEMENTS.caption.localY + 22,
      );
      await clickAt(page, body.x, body.y);
      await ensureInspector(page);
      await openComicSection(page);
    } else {
      await revealBalloon(page, /caption balloon/i);
    }
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
    if (compactByPage.get(page)) {
      await beat(page, 280, 480);
      return;
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

async function readSpin(page, name) {
  await ensureInspector(page);
  const field = page
    .locator('.editor-inspector, .editor__inspector-panel, [data-panel-root="inspector"]')
    .getByRole('spinbutton', { name: new RegExp(`^${name}(?:\\s*\\([^)]*\\))?$`, 'i') })
    .first();
  if (!(await field.isVisible({ timeout: 1800 }).catch(() => false))) return null;
  const raw = await field.inputValue().catch(async () => field.getAttribute('aria-valuenow'));
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function tailXParkPoint(page) {
  await ensureInspector(page);
  await openComicSection(page);
  const field = (await inspectorRoot(page)).getByRole('spinbutton', { name: /^tail x/i }).first();
  if (!(await field.isVisible({ timeout: 2000 }).catch(() => false))) return null;
  const fieldId = await field.getAttribute('id');
  const label = fieldId ? page.locator(`label[for="${fieldId}"]`).first() : null;
  const box =
    (label ? await label.boundingBox().catch(() => null) : null) ?? (await field.boundingBox());
  if (!box) return null;
  return { x: box.x + Math.min(18, box.width * 0.4), y: box.y + box.height / 2 };
}

async function growBalloonLikeAPerson(page) {
  const width = await readSpin(page, 'w');
  const height = await readSpin(page, 'h');
  const handle = await page.evaluate(
    ({ w, h }) => {
      const hooks = window.__varveIsoTest;
      const canvas = document.querySelector('.editor-canvas');
      const geometry = hooks?.getSelectionGeometry?.()?.[0];
      if (!hooks || !canvas || !geometry || !(w > 0) || !(h > 0)) return null;
      const rect = canvas.getBoundingClientRect();
      const m = geometry.worldTransform;
      const wx = m[0] * w + m[2] * h + m[4];
      const wy = m[1] * w + m[3] * h + m[5];
      const screen = hooks.worldToScreen(wx, wy);
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    },
    { w: width ?? 0, h: height ?? 0 },
  );
  if (!handle) return;
  await humanMove(page, handle.x, handle.y);
  await think(page, 400, 1100);
  await page.mouse.down();
  await pause(page, randBetween(40, 80));
  await humanMove(page, handle.x + randBetween(22, 40), handle.y + randBetween(16, 32), {
    drag: true,
  });
  await page.mouse.up();
  await think(page, 400, 900);
}

async function restoreSpin(page, name, target) {
  let current = await readSpin(page, name);
  if (current != null && Math.abs(current - target) > 0.35) {
    await scrubSpin(page, name, target - current);
    current = await readSpin(page, name);
  }
  if (current == null || Math.abs(current - target) > 0.45) {
    await setSpin(page, name, target);
    current = await readSpin(page, name);
  }
  log(`restore ${name} target=${target} now=${current}`);
  return current;
}

async function holdLoopRest(page, park) {
  if (park) await humanMove(page, park.x, park.y);
  await think(page, 900, 1400);
}

async function loopTailCycle(page) {
  const startX = (await readSpin(page, 'tail x')) ?? 80;
  const startY = (await readSpin(page, 'tail y')) ?? 140;
  const park = await tailXParkPoint(page);
  const endX = Math.round(PLACEMENTS.speech.tailToward.localX - PLACEMENTS.speech.localX);
  const endY = Math.round(PLACEMENTS.speech.tailToward.localY - PLACEMENTS.speech.localY);
  log(`loop tail ${startX},${startY} -> ${endX},${endY} -> ${startX},${startY}`);
  await holdLoopRest(page, park);
  await scrubSpin(page, 'tail x', endX - startX);
  await think(page, 400, 900);
  if (Math.abs(endY - startY) > 6) await scrubSpin(page, 'tail y', endY - startY);
  await think(page, 500, 1100);
  if (Math.abs(endY - startY) > 6) await scrubSpin(page, 'tail y', startY - endY);
  await think(page, 400, 800);
  await scrubSpin(page, 'tail x', startX - endX);
  await restoreSpin(page, 'tail x', startX);
  await restoreSpin(page, 'tail y', startY);
  const parkEnd = (await tailXParkPoint(page)) ?? park;
  await holdLoopRest(page, parkEnd);
  const finalX = await readSpin(page, 'tail x');
  const finalY = await readSpin(page, 'tail y');
  log(`loop rest start=${startX},${startY} end=${finalX},${finalY}`);
  if (
    finalX == null ||
    finalY == null ||
    Math.abs(finalX - startX) > 0.5 ||
    Math.abs(finalY - startY) > 0.5
  ) {
    throw new Error(`loop rest pose mismatch ${finalX},${finalY} != ${startX},${startY}`);
  }
}

async function dragSelectedTail(page, placement) {
  if (!placement.tailToward) return;
  // Aim the parametric tail from the balloon group. Canvas-dragging the tail
  // path translates a detached stub and is what previously grabbed the panel.
  if (!compactByPage.get(page)) {
    await revealBalloon(page, placement.layer ?? /(speech|shout|thought) balloon/i);
  } else {
    const map = await pageScreenMap(page);
    const body = localToScreen(map, placement.panel, placement.localX + 36, placement.localY + 22);
    await clickAt(page, body.x, body.y);
    await ensureInspector(page);
    await openComicSection(page);
  }
  const startX = (await readSpin(page, 'tail x')) ?? 40;
  const startY = (await readSpin(page, 'tail y')) ?? 80;
  const tailX = Math.round(placement.tailToward.localX - placement.localX);
  const tailY = Math.round(placement.tailToward.localY - placement.localY);
  log(`tail aim ${startX},${startY} -> ${tailX},${tailY}`);
  await scrubSpin(page, 'tail x', tailX - startX);
  if (Math.abs(tailY - startY) > 8) await scrubSpin(page, 'tail y', tailY - startY);
  await beat(page, 360, 680);
  if (!compactByPage.get(page)) await filterLayers(page, '');
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
  await think(page, 180, 320);
  await easeCameraToPage(page);
  await beat(page, compactByPage.get(page) ? 900 : 1600, compactByPage.get(page) ? 1400 : 2400);
}

async function letterPage(page, options = {}) {
  const include =
    options.include ?? (options.only ? [options.only] : ['caption', 'speech', 'shout', 'thought']);
  for (const key of include) {
    const placement = PLACEMENTS[key];
    await placeDialogue(page, placement);
    if (!compactByPage.get(page) && key === 'caption') {
      await removeCaptionTail(page);
      await beat(page, 420, 720);
    }
    if (!compactByPage.get(page) && placement.tailToward) await dragSelectedTail(page, placement);
    if (compactByPage.get(page)) await hideSidePanels(page);
    await beat(page, compactByPage.get(page) ? 280 : 380, compactByPage.get(page) ? 480 : 700);
    if (PROBE) {
      await page.screenshot({ path: join(RAW_DIR, `probe-${key}.png`) });
    }
  }
  if (!options.only && !options.include && !options.skipFitDemo) {
    await demonstrateFit(page).catch(() => undefined);
  }
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

async function probeVideo(file) {
  const child = spawn(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,codec_name:format=duration',
      '-of',
      'json',
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
      if (code === 0) resolve(text);
      else reject(new Error(`ffprobe failed for ${file}`));
    });
  });
  const json = JSON.parse(out);
  const stream = json.streams?.[0] ?? {};
  return {
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    codec: stream.codec_name ?? '',
    duration: Number(json.format?.duration) || 0,
  };
}

async function assertVideo(file, width, height) {
  const info = await probeVideo(file);
  if (info.width !== width || info.height !== height) {
    throw new Error(`${file} is ${info.width}x${info.height}, expected ${width}x${height}`);
  }
  if (Math.abs(width / height - 9 / 16) < 0.02 && (width < 1080 || height < 1920)) {
    throw new Error(`${file} is a ${info.width}x${info.height} crop, not a 1080x1920 viewport`);
  }
  return info;
}

async function extractStills(file, destDir) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const info = await probeVideo(file);
  writeFileSync(join(destDir, 'probe.json'), `${JSON.stringify(info, null, 2)}\n`);
  const last = Math.floor(info.duration);
  for (let t = 0; t <= last; t++) {
    await runFfmpeg([
      '-y',
      '-ss',
      String(t),
      '-i',
      file,
      '-frames:v',
      '1',
      join(destDir, `t${String(t).padStart(2, '0')}.png`),
    ]);
  }
  await runFfmpeg(['-y', '-ss', '0', '-i', file, '-frames:v', '1', join(destDir, 'first.png')]);
  await runFfmpeg([
    '-y',
    '-sseof',
    '-0.04',
    '-i',
    file,
    '-frames:v',
    '1',
    join(destDir, 'last.png'),
  ]);
  return info;
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

async function encodeToWindow(input, output, minSec, maxSec, vf, options = {}) {
  const duration = await probeDuration(input);
  const maxRate = options.maxRate ?? (options.realtime ? 1.18 : 2.2);
  let rate = 1;
  if (duration > maxSec) rate = Math.min(maxRate, duration / maxSec);
  if (duration / rate < minSec && duration < minSec) rate = duration / minSec;
  if (options.realtime && duration <= maxSec + 1.5)
    rate = duration < minSec ? duration / minSec : 1;
  const filters = [];
  if (vf) filters.push(vf);
  if (Math.abs(rate - 1) > 0.04) filters.push(`setpts=${(1 / rate).toFixed(4)}*PTS`);
  log(`encode ${output} duration=${duration.toFixed(2)}s rate=${rate.toFixed(2)}`);
  await encodeMp4(input, output, filters.length ? ['-vf', filters.join(',')] : []);
  return probeDuration(output);
}

async function recordSession(browser, filePath, name, act, size, prepare) {
  mkdirSync(RAW_DIR, { recursive: true });
  const width = size?.width ?? 1920;
  const height = size?.height ?? 1080;
  const context = await browser.newContext({
    viewport: { width, height },
    screen: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW_DIR, size: { width, height } },
  });
  const page = await context.newPage();
  const view = page.viewportSize();
  if (!view || view.width !== width || view.height !== height) {
    await context.close().catch(() => undefined);
    throw new Error(`Playwright viewport ${JSON.stringify(view)} != ${width}x${height}`);
  }
  pointerByPage.set(page, { x: width * 0.55, y: height * 0.45 });
  const videoOrigin = Date.now();
  try {
    await openUnlettered(page, filePath);
    await lockAllWalls(page);
    if (prepare) await prepare(page);
    await ensureMarketingCursor(page);
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
    await pause(page, 500);
    const contentStart = Date.now();
    await act(page);
    await pause(page, 900);
    const video = page.video();
    await context.close();
    const raw = await video.path();
    const rawInfo = await probeVideo(raw);
    log(`raw ${name} ${rawInfo.width}x${rawInfo.height} ${rawInfo.duration.toFixed(2)}s`);
    const rawAspect = rawInfo.width / rawInfo.height;
    const targetAspect = width / height;
    if (Math.abs(rawAspect - targetAspect) > 0.03) {
      throw new Error(
        `raw ${name} is ${rawInfo.width}x${rawInfo.height} (aspect ${rawAspect.toFixed(3)}), not ${width}x${height}`,
      );
    }
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

async function writeWindowed(session, dest, minSec, maxSec, options = {}) {
  const trimmed = join(RAW_DIR, `${dest.split('/').pop()}-trimmed.mp4`);
  await encodeMp4(session.raw, trimmed, [
    '-ss',
    session.trimStart.toFixed(2),
    '-vf',
    `scale=${session.width}:${session.height}:flags=lanczos`,
  ]);
  await encodeToWindow(trimmed, dest, minSec, maxSec, undefined, options);
  const info = await assertVideo(dest, session.width, session.height);
  log(`encoded ${dest} ${info.width}x${info.height} ${info.duration.toFixed(2)}s`);
  return info.duration;
}

async function main() {
  mkdirSync(VIDEO_DIR, { recursive: true });
  mkdirSync(RAW_DIR, { recursive: true });
  const unlettered = writeUnletteredCopy();
  const server = await startServer();
  const windowW = WANT_VERTICAL && !WANT_FULL && !WANT_LOOP ? 1080 : 1920;
  const windowH = WANT_VERTICAL && !WANT_FULL && !WANT_LOOP ? 1920 : 1920;
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', `--window-size=${windowW},${windowH}`],
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
        const duration = await writeWindowed(session, dest, 30, 45, { maxRate: 2.2 });
        await extractStills(dest, join(RAW_DIR, 'stills-timelapse'));
        outputs.push({ path: dest, duration, width: 1920, height: 1080 });
        log(`wrote ${dest} (${duration.toFixed(2)}s)`);
      }
    }
    if (WANT_LOOP && !PROBE) {
      log('recording balloon + tail loop');
      const session = await recordSession(
        browser,
        SOURCE_VARVE,
        'loop',
        async (page) => {
          await loopTailCycle(page);
        },
        { width: 1920, height: 1080 },
        async (page) => {
          await followPanel(page, PLACEMENTS.speech.panel);
          await revealBalloon(page, /speech balloon/i);
          await setSidePanel(page, 'layers', false);
          const park = await tailXParkPoint(page);
          if (park) await humanMove(page, park.x, park.y);
          await think(page, 500, 900);
        },
      );
      if (session.raw) {
        const dest = join(VIDEO_DIR, 'balloon-tail-loop.mp4');
        const duration = await writeWindowed(session, dest, 10, 12, {
          realtime: true,
          maxRate: 1.2,
        });
        await extractStills(dest, join(RAW_DIR, 'stills-loop'));
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
          await letterPage(page, { include: ['caption', 'speech'], skipFitDemo: true });
        },
        { width: 1080, height: 1920 },
        async (page) => {
          compactByPage.set(page, true);
          await hideSidePanels(page);
        },
      );
      if (session.raw) {
        const dest = join(VIDEO_DIR, 'lettering-vertical.mp4');
        const duration = await writeWindowed(session, dest, 35, 45, {
          realtime: true,
          maxRate: 1.35,
        });
        await extractStills(dest, join(RAW_DIR, 'stills-vertical'));
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
