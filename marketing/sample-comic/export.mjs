#!/usr/bin/env node
/**
 * Open halloween-cookies.varve in the real desktop web app, fit the page,
 * and write the marketing rasters + a raster PDF (not PDF/X — that path
 * is Tauri-native only).
 */
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'marketing/sample-comic');
const PORT = Number(process.env.VARVE_COMIC_PORT ?? 1473);
const BASE = `http://127.0.0.1:${PORT}`;

function makeRasterImagePdf(pixels, width, height) {
  const count = width * height;
  const rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = pixels[i * 4];
    rgb[i * 3 + 1] = pixels[i * 4 + 1];
    rgb[i * 3 + 2] = pixels[i * 4 + 2];
  }
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let position = 0;
  const bytes = (value) => {
    chunks.push(value);
    position += value.length;
  };
  const text = (value) => bytes(encoder.encode(value));
  const object = (id, content) => {
    offsets[id] = position;
    text(`${id} 0 obj\n${content}\nendobj\n`);
  };
  const stream = (id, dictionary, data) => {
    offsets[id] = position;
    text(`${id} 0 obj\n<< ${dictionary} /Length ${data.length} >>\nstream\n`);
    bytes(data);
    text('\nendstream\nendobj\n');
  };
  text('%PDF-1.4\n');
  bytes(new Uint8Array([37, 128, 129, 130, 131, 10]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${width} ${height} ] /Contents 5 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>`,
  );
  stream(
    4,
    `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8`,
    rgb,
  );
  stream(5, '', encoder.encode(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ`));
  const xref = position;
  const size = offsets.length;
  text(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) text(`${String(offset).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const result = new Uint8Array(position);
  let next = 0;
  for (const chunk of chunks) {
    result.set(chunk, next);
    next += chunk.length;
  }
  return result;
}

async function startServer() {
  const viteCommand =
    Number(process.versions.node.split('.')[0]) >= 26
      ? ['node', '--no-turbofan', 'node_modules/vite/bin/vite.js']
      : ['vite'];
  let output = '';
  const child = spawn(
    'pnpm',
    ['--filter', '@varve/desktop', 'exec', ...viteCommand, '--port', String(PORT), '--strictPort'],
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
          req.on('response', (res) => resolve(res.statusCode === 200));
          req.on('error', () => resolve(false));
        })
        .catch(() => resolve(false));
    });
    if (ready) return child;
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before ready.\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
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
        .isVisible({ timeout: 800 })
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
      .isVisible({ timeout: 800 })
      .catch(() => false)
  ) {
    await welcome
      .first()
      .click()
      .catch(() => undefined);
  }
}

async function openInEditor(page, filePath, expectedTitle) {
  await page.addInitScript(() => {
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
      localStorage.setItem('varve:onboarding', JSON.stringify({ onboardingComplete: true }));
      localStorage.removeItem('varve:safe-mode');
      localStorage.removeItem('varve:crash-loop');
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await dismissNoise(page);
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 60000 });
  await newBtn.click();
  const create = page.locator('dialog').getByRole('button', { name: /create/i });
  await create.waitFor({ state: 'visible', timeout: 15000 });
  await create.click();
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 60000 });
  await dismissNoise(page);
  await page.setInputFiles('#file-open-input', filePath);
  await page.waitForFunction(
    (expected) => {
      const heading = document.querySelector('.editor-shell h1.sr-only');
      return !!heading && (heading.textContent ?? '').includes(expected);
    },
    expectedTitle,
    { timeout: 45000 },
  );
  await page.locator('.editor-canvas').waitFor({ state: 'visible', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(1200);
}

async function capturePagePng(page) {
  const canvas = page.locator('.editor-canvas canvas').last();
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  return canvas.screenshot({ type: 'png' });
}

async function main() {
  const letteredPath = join(OUT, 'halloween-cookies.varve');
  const unletteredPath = join(OUT, 'halloween-cookies-unlettered.varve');
  const generate = (args) => {
    const result = spawnSync(
      'pnpm',
      ['--filter', '@varve/ui', 'exec', 'tsx', join(OUT, 'generate.ts'), ...args],
      { cwd: ROOT, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'generate.ts failed');
    }
    process.stdout.write(result.stdout);
  };
  generate([]);
  generate(['--unlettered']);

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 2000 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await openInEditor(page, letteredPath, 'Halloween Cookies');
    const lettered = await capturePagePng(page);
    writeFileSync(join(OUT, 'halloween-cookies.png'), lettered);
    process.stdout.write(`wrote halloween-cookies.png (${lettered.length} bytes)\n`);

    await openInEditor(page, unletteredPath, 'Halloween Cookies');
    const unlettered = await capturePagePng(page);
    writeFileSync(join(OUT, 'halloween-cookies-unlettered.png'), unlettered);
    process.stdout.write(`wrote halloween-cookies-unlettered.png (${unlettered.length} bytes)\n`);

    const png = await import('node:fs').then((fs) =>
      fs.readFileSync(join(OUT, 'halloween-cookies.png')),
    );
    // Decode via Chromium so we do not need a PNG parser for the PDF wrap.
    const pdfPage = await context.newPage();
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    await pdfPage.setContent(`<img id="p" src="${dataUrl}" />`, { waitUntil: 'load' });
    const pixels = await pdfPage.evaluate(async () => {
      const img = document.getElementById('p');
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { width: canvas.width, height: canvas.height, rgba: Array.from(data.data) };
    });
    const pdf = makeRasterImagePdf(Uint8Array.from(pixels.rgba), pixels.width, pixels.height);
    writeFileSync(join(OUT, 'halloween-cookies.pdf'), pdf);
    process.stdout.write(
      `wrote halloween-cookies.pdf (${pdf.length} bytes, raster PDF 1.4 ${pixels.width}x${pixels.height}, not PDF/X)\n`,
    );
  } finally {
    await browser.close().catch(() => undefined);
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
