#!/usr/bin/env node
/**
 * GPU-effects agreement verification — runs the live-effects GPU kernels in
 * a real browser via the Chrome DevTools Protocol and reports per-effect
 * delta stats against the CPU reference kernels.
 *
 * Why not plain Playwright: Chromium launched via Playwright's
 * `--remote-debugging-pipe` does not initialize WebGPU on some stacks (the
 * GPU process never exposes `navigator.gpu`), while a launch with
 * `--remote-debugging-port` + Vulkan flags works. This script launches the
 * browser itself and drives it over CDP.
 *
 * Usage:
 *   node packages/compositor/scripts/verify-gpu-effects.mjs [effects...]
 *
 * Env:
 *   CHROME        — chromium/chrome binary (default: newest Playwright build)
 *   EFFECTS       — comma-separated effects (default: all 9)
 *   VERIFY_MODE   — 'report' (default) prints stats; 'assert' fails when any
 *                   effect exceeds its BOUNDS (used by CI/dev gates).
 *
 * Requires the harness bundle:
 *   node packages/compositor/scripts/build-effects-harness.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const pnpmWs = join(root, 'node_modules', '.pnpm', 'ws@8.21.0', 'node_modules', 'ws', 'index.js');
const WebSocket = require(pnpmWs).WebSocket ?? require(pnpmWs);
const BUNDLE = join(root, 'packages', 'compositor', 'dist', 'effects-harness.js');
const HARNESS_PAGE = join(root, 'packages', 'compositor', 'dist', 'gpu-harness.html');

const PORT = 9333;
const ALL_EFFECTS = [
  'bloom',
  'crt',
  'vhs',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'caustics',
  'rgbSplit',
  'paletteSnap',
];

// Worst-channel mean/max deltas vs the CPU kernels, measured 2026-08-07
// (Chromium 1228 + RADV on a 48x32 gradient+noise input).
const BOUNDS = {
  bloom: { mean: 60, max: 160 },
  crt: { mean: 110, max: 225 },
  vhs: { mean: 70, max: 240 },
  lightShafts: { mean: 5, max: 16 },
  lensFlare: { mean: 5, max: 16 },
  lightLeak: { mean: 20, max: 170 },
  caustics: { mean: 155, max: 255 },
  rgbSplit: { mean: 45, max: 170 },
  paletteSnap: { mean: 50, max: 160 },
};

function findChromium() {
  if (process.env.CHROME) return process.env.CHROME;
  const home = process.env.HOME ?? '/home/kevina';
  const candidates = [
    join(home, '.cache', 'ms-playwright', 'chromium-1228', 'chrome-linux64', 'chrome'),
    join(home, '.cache', 'ms-playwright', 'chromium-1234', 'chrome-linux64', 'chrome'),
    join(
      home,
      '.cache',
      'ms-playwright',
      'chromium_headless_shell-1228',
      'chrome-headless-shell-linux64',
      'chrome-headless-shell',
    ),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'chromium';
}

async function waitForTarget(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no CDP target');
}

async function main() {
  if (!existsSync(BUNDLE)) {
    throw new Error(
      `harness bundle missing — run: node packages/compositor/scripts/build-effects-harness.mjs`,
    );
  }
  if (!existsSync(HARNESS_PAGE)) {
    throw new Error(
      `harness page missing — run: node packages/compositor/scripts/build-effects-harness.mjs`,
    );
  }
  const effects = (process.env.EFFECTS ?? process.argv.slice(2).join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (effects.length === 0) effects.push(...ALL_EFFECTS);
  const mode = process.env.VERIFY_MODE ?? 'report';
  const chrome = process.env.CHROME ?? findChromium();

  const url = `${HARNESS_PAGE}?effects=${effects.join(',')}`;
  const child = spawn(
    chrome,
    [
      '--no-sandbox',
      '--headless',
      `--remote-debugging-port=${PORT}`,
      '--enable-features=Vulkan',
      '--use-angle=vulkan',
      '--enable-unsafe-swiftshader',
      `--user-data-dir=${join(root, '.tmp-gpu-verify-profile')}`,
      url,
    ],
    { stdio: 'ignore' },
  );

  try {
    const target = await waitForTarget(PORT);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    });
    await new Promise((r) => ws.on('open', r));
    await send('Runtime.enable');

    let resultText = null;
    for (let i = 0; i < 240; i += 1) {
      const res = await send('Runtime.evaluate', {
        expression:
          'document.getElementById("result") ? document.getElementById("result").textContent : "no-el"',
        returnByValue: true,
      });
      const text = res?.result?.value ?? '';
      if (text.startsWith('HARNESS_')) {
        resultText = text;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!resultText) throw new Error('harness timed out');

    const json = resultText.slice('HARNESS_OK '.length);
    const result = JSON.parse(json);
    let failed = false;
    for (const entry of result.entries) {
      if (entry.error) {
        console.log(`[gpu-verify] ${entry.effect}: ERROR ${entry.error}`);
        failed = true;
        continue;
      }
      if (!entry.stats) {
        console.log(`[gpu-verify] ${entry.effect}: no stats`);
        failed = true;
        continue;
      }
      const st = entry.stats;
      const bound = BOUNDS[entry.effect];
      console.log(
        `[gpu-verify] ${entry.effect.padEnd(14)} meanAbs=${st.meanAbs.toFixed(2).padStart(8)} maxAbs=${String(st.maxAbs).padStart(4)} p99=${String(st.p99).padStart(4)} bound=[${bound.mean}, ${bound.max}]`,
      );
      if (mode === 'assert' && bound) {
        if (st.meanAbs > bound.mean || st.maxAbs > bound.max) failed = true;
      }
    }
    if (failed) process.exitCode = 2;
  } finally {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
}

main().catch((e) => {
  console.error('[gpu-verify] driver error:', e.message);
  process.exit(1);
});
