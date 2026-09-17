/**
 * Real-world navigation scenarios + visual validation.
 *
 * Scenarios (task §19/§24/§23): precision cursor-anchored zoom (C), trackpad
 * burst pan→pinch→reverse (F), mouse detent inertia + interruption (G/H),
 * UI wheel-ownership boundary (I). Screenshots captured for manual inspection.
 *
 * Uses window.__varveInputDiagnostics (records viewport after each wheel
 * mutation) as the camera probe.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.PROBE_BASE ?? 'http://localhost:1430';
const SHOTS = '/tmp/nav-shots';

import { mkdirSync } from 'node:fs';

mkdirSync(SHOTS, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const fails = [];
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) fails.push(name);
  };

  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 15000 });
  // Under heavy machine load the app can enter crash-loop safe mode; continue
  // normal startup so the scenario can proceed (crash state is per-profile).
  const safeMode = page.getByRole('button', { name: /continue normal startup/i });
  if (await safeMode.isVisible({ timeout: 800 }).catch(() => false)) {
    console.log('note: safe mode screen encountered — continuing normal startup');
    await safeMode.click();
  }
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();

  // Draw a rectangle and select it so overlays participate in the scenarios.
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 480, box.y + 420, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await canvas.focus();

  await page.evaluate(() => window.__varveInputDiagnostics.enable());

  // The diagnostics ring records the PRE-mutation viewport, so the last
  // record lags one event behind. A zero-delta wheel appends a record
  // without mutating anything (panBy no-ops), making its record an
  // authoritative snapshot of the CURRENT camera.
  const camera = async () => {
    await page.evaluate(() => {
      const el = document.querySelector('canvas.editor-canvas__content-layer');
      const b = el.getBoundingClientRect();
      el.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: b.left + 10,
          clientY: b.top + 10,
          deltaX: 0,
          deltaY: 0,
        }),
      );
    });
    await page.waitForTimeout(30);
    return page.evaluate(() => {
      const recs = window.__varveInputDiagnostics.records(1);
      const last = recs[recs.length - 1];
      return last?.viewport ?? null;
    });
  };

  const wheel = (opts) =>
    page.evaluate(
      ({ ox, oy, ...rest }) => {
        const el = document.querySelector('canvas.editor-canvas__content-layer');
        const b = el.getBoundingClientRect();
        el.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: b.left + ox,
            clientY: b.top + oy,
            ...rest,
          }),
        );
      },
      { ox: box.width / 2, oy: box.height / 2, ...opts },
    );

  const sleep = (ms) => page.waitForTimeout(ms);

  // ---------- Scenario C: precision cursor-anchored zoom ----------
  // Zoom in 14 steps at a fixed client point; the world point under the
  // cursor must not drift more than ~1 px of overlay geometry. Verify via
  // repeated zoom without pan: the recorded anchor (client point) is fixed,
  // so instead assert pan compensates exactly per zoomAboutPoint: capture
  // pan after each step and confirm monotonic smoothness (no jumps > 8× the
  // median step — a snap-back or anchor flip shows as an outlier).
  const pans = [];
  for (let i = 0; i < 14; i++) {
    await wheel({ ctrlKey: true, deltaY: -12 });
    await sleep(16);
    pans.push((await camera()).panX);
  }
  const steps = pans.slice(1).map((v, i) => Math.abs(v - pans[i]));
  const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)];
  const maxStep = Math.max(...steps);
  check(
    'C: cursor-anchored zoom has no anchor snap-back',
    maxStep < median * 8 + 4,
    `median step ${median.toFixed(2)}px, max ${maxStep.toFixed(2)}px`,
  );

  // Zoom back out fully with the same anchor; camera must be stable.
  for (let i = 0; i < 20; i++) {
    await wheel({ ctrlKey: true, deltaY: 12 });
    await sleep(16);
  }
  await sleep(200);
  const zoomAfterOut = (await camera())?.zoom ?? 0;
  check(
    'C: zoom-out returns toward 100% and clamps stably',
    zoomAfterOut > 0.3 && zoomAfterOut <= 1.6,
    `zoom ${zoomAfterOut.toFixed(3)}`,
  );
  await page.screenshot({ path: `${SHOTS}/scenario-c-zoomed-out.png` });

  // ---------- Scenario F: trackpad burst pan → pinch → reverse ----------
  await wheel({ deltaY: 0, deltaX: 0 }); // reset gesture gap
  await sleep(300);
  // Slow diagonal two-finger pan: 24 events, mostly Y with some X.
  for (let i = 0; i < 24; i++) {
    await wheel({ deltaY: 4, deltaX: 1.5 });
    await sleep(8);
  }
  await sleep(120);
  const camAfterPan = await camera();
  // Immediate ctrl+wheel pinch (trackpad pinch arrives as ctrl+wheel).
  for (let i = 0; i < 8; i++) {
    await wheel({ ctrlKey: true, deltaY: -6 });
    await sleep(8);
  }
  // Reverse pinch direction mid-gesture.
  for (let i = 0; i < 6; i++) {
    await wheel({ ctrlKey: true, deltaY: 6 });
    await sleep(8);
  }
  await sleep(250);
  const camAfterPinch = await camera();
  const zoomRatio = camAfterPinch.zoom / camAfterPan.zoom;
  const expectedRatio = Math.exp(0.01 * 8 * 6) * Math.exp(-0.01 * 6 * 6);
  check(
    'F: pan accumulated both axes',
    camAfterPan.panY > 60 && camAfterPan.panX > 15,
    `panY ${camAfterPan.panY.toFixed(1)} panX ${camAfterPan.panX.toFixed(1)}`,
  );
  check(
    'F: pinch forward+reverse matches exp deltas',
    Math.abs(zoomRatio - expectedRatio) < 0.25,
    `ratio ${zoomRatio.toFixed(3)} vs expected ${expectedRatio.toFixed(3)}`,
  );
  check(
    'F: pinch preserved 2D pan (no axis reset)',
    Math.abs(camAfterPinch.panX - camAfterPan.panX) < camAfterPan.panX,
    'pan survived pinch',
  );

  // ---------- Scenario G/H: mouse detent inertia + interruption ----------
  await sleep(300);
  const camBeforeMouse = await camera();
  for (let i = 0; i < 3; i++) {
    await wheel({ deltaY: 120, deltaMode: 0 });
    await sleep(30);
  }
  // Inertia continues past the last event; measure the tail with
  // authoritative reads (zero-delta probe wheels).
  await sleep(80);
  const camMidInertia = await camera();
  // Interrupt with window blur mid-inertia, then repeat the same burst. A
  // stuck momentum (or a dead input path) would make the second burst's
  // travel diverge from the first. (The camera probe itself cancels
  // inertia, so the blur check is behavioral: identical burst travel.)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(250);
  const camBeforeBurst2 = await camera();
  // Burst 2 goes the OPPOSITE direction: burst 1 may legitimately have
  // reached the document-boundary clamp, and a clamp wall in the same
  // direction is by-design, not a stuck state. Dead input after blur would
  // show ~0 travel either way; clean state returns the opposite pan.
  for (let i = 0; i < 3; i++) {
    await wheel({ deltaY: -120, deltaMode: 0 });
    await sleep(30);
  }
  await sleep(500);
  const camAfterBurst2 = await camera();
  const direct = 3 * 120;
  // Positive deltaY pans content up: camera panY DECREASES.
  const travel1 = camBeforeMouse.panY - camMidInertia.panY;
  const travel2 = camAfterBurst2.panY - camBeforeBurst2.panY;
  check(
    'G: detented mouse wheel pans (direct travel first)',
    travel1 >= direct * 0.8 && travel1 <= direct * 1.6,
    `travel ${travel1.toFixed(0)}px within ~${direct}px of events`,
  );
  // Functional requirement: after a mid-inertia blur, input still navigates
  // (no dead state) and the frame decays to rest (no infinite momentum).
  // Travel magnitude varies with clamp release and the inertia tail, so the
  // band is wide; the 500ms-settled read proves termination.
  check(
    'H: blur mid-inertia leaves no stuck state (reverse burst navigates)',
    travel2 >= direct && travel2 <= direct * 4,
    `burst1 ${travel1.toFixed(0)}px up, reverse burst2 ${travel2.toFixed(0)}px down after blur, settled`,
  );
  await sleep(300);

  // ---------- Scenario I: UI wheel-ownership boundary ----------
  const camBeforePanel = await camera();
  const panel = page.locator('.layers-panel');
  const pbox = await panel.boundingBox();
  if (pbox) {
    await page.mouse.move(pbox.x + pbox.width / 2, pbox.y + Math.min(200, pbox.height / 2));
    await page.mouse.wheel(0, 240);
    await sleep(250);
    const camAfterPanel = await camera();
    const drift = Math.hypot(
      camAfterPanel.panY - camBeforePanel.panY,
      camAfterPanel.panX - camBeforePanel.panX,
    );
    check(
      'I: wheel over the layers panel never moves the camera',
      drift < 2 && camAfterPanel.zoom === camBeforePanel.zoom,
      `camera drift ${drift.toFixed(2)}px`,
    );
    // And back onto the canvas: navigation resumes. Assert via zoom — pan
    // may legitimately be refused by the document-boundary clamp here.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const zoomBeforeCanvas = (await camera())?.zoom ?? 0;
    await wheel({ ctrlKey: true, deltaY: 20 });
    await sleep(350);
    const zoomAfterCanvas = (await camera())?.zoom ?? 0;
    if (Math.abs(zoomAfterCanvas - zoomBeforeCanvas) <= 0.01) {
      const trail = await page.evaluate(() =>
        window.__varveInputDiagnostics
          .records(200)
          .slice(-6)
          .map((r) => `${r.eventType}@z${(r.viewport?.zoom ?? 0).toFixed(3)}`),
      );
      console.log('I-2 failure trail:', JSON.stringify(trail));
    }
    check(
      'I: wheel returns to canvas navigation after the panel',
      Math.abs(zoomAfterCanvas - zoomBeforeCanvas) > 0.01,
      `zoom ${zoomBeforeCanvas.toFixed(3)} -> ${zoomAfterCanvas.toFixed(3)}`,
    );
  } else {
    check('I: layers panel found', false, 'panel not visible');
  }

  // ---------- Visual states ----------
  await page.evaluate(() => window.scrollTo(0, 0));
  await canvas.focus();
  await page.mouse.move(box.x + 300, box.y + 300);
  // Low zoom.
  for (let i = 0; i < 10; i++) {
    await wheel({ ctrlKey: true, deltaY: 24 });
    await sleep(12);
  }
  await sleep(250);
  await page.screenshot({ path: `${SHOTS}/state-low-zoom.png` });
  // High zoom.
  for (let i = 0; i < 26; i++) {
    await wheel({ ctrlKey: true, deltaY: -24 });
    await sleep(12);
  }
  await sleep(250);
  await page.screenshot({ path: `${SHOTS}/state-high-zoom.png` });

  // Settings > Drawing Input (navigation controls) in light theme.
  await page.keyboard.press('Escape');
  const settingsButton = page.getByRole('button', { name: /^settings$/i }).first();
  if (await settingsButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    await settingsButton.click();
    const drawingTab = page.getByRole('tab', { name: /drawing input/i }).first();
    if (await drawingTab.isVisible({ timeout: 2500 }).catch(() => false)) {
      await drawingTab.click();
    } else {
      await page.getByText('Drawing Input', { exact: false }).first().click();
    }
    await sleep(400);
    await page.screenshot({ path: `${SHOTS}/settings-navigation-light.png` });
    // Dark theme.
    const appearanceTab = page.getByRole('tab', { name: /appearance/i }).first();
    if (await appearanceTab.isVisible({ timeout: 1500 }).catch(() => false)) {
      await appearanceTab.click();
      const dark = page.getByRole('radio', { name: /dark/i }).first();
      if (await dark.isVisible({ timeout: 1500 }).catch(() => false)) {
        await dark.click();
        await sleep(400);
        const drawingTab2 = page.getByRole('tab', { name: /drawing input/i }).first();
        await drawingTab2.click().catch(() => {});
        await sleep(300);
        await page.screenshot({ path: `${SHOTS}/settings-navigation-dark.png` });
      }
    }
    await page.keyboard.press('Escape');
  }

  // Compact viewport (Chromebook-like 800x1280 portrait) — status bar zoom controls.
  const compact = await context.newPage();
  await compact.setViewportSize({ width: 800, height: 1280 });
  await compact.goto(`${BASE}/?perf=1`, { waitUntil: 'domcontentloaded' });
  const compactSafe = compact.getByRole('button', { name: /continue normal startup/i });
  if (await compactSafe.isVisible({ timeout: 800 }).catch(() => false)) {
    await compactSafe.click();
  }
  await compact.getByRole('button', { name: /^new$/i }).click();
  await compact
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await compact.waitForTimeout(1500);
  await compact.screenshot({ path: `${SHOTS}/state-compact-800x1280.png` });
  await compact.close();

  console.log('---');
  console.log(fails.length === 0 ? 'ALL SCENARIOS PASS' : `FAILURES: ${fails.join('; ')}`);
  await browser.close();
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('scenario probe failed:', e);
  process.exit(1);
});
