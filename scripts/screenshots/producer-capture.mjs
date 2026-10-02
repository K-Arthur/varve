import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { analyseImage } from './lib/image-analysis.mjs';

// Producer specs run from the repository root. Keep this helper usable by
// Playwright's CommonJS transform as well as the standalone ESM capture CLI.
const ROOT = process.cwd();
const SOURCE_PATHS = [
  'packages',
  'apps/desktop',
  'tests/e2e',
  'scripts/screenshots',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'playwright.config.ts',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function captureSourceIdentity(root = ROOT) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const sourceRevision = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain', '--', ...SOURCE_PATHS]);
  const diff = git(['diff', 'HEAD', '--', ...SOURCE_PATHS]);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...SOURCE_PATHS])
    .split('\0')
    .filter(Boolean)
    .map((path) => `${path}:${digest(readFileSync(resolve(root, path)))}`);
  return {
    sourceRevision,
    sourceDirty: status.length > 0,
    sourceDigest: digest(`${sourceRevision}\n${status}\n${diff}\n${untracked.join('\n')}`),
  };
}

/** Record evidence at the capture itself, never when an old PNG is imported. */
export async function captureProducerScreenshot(page, testInfo, filename, options = {}) {
  if (basename(filename) !== filename || !filename.endsWith('.png')) {
    throw new Error('Producer capture requires a bare PNG filename');
  }
  const source = captureSourceIdentity();
  const browser = page.context().browser();
  const browserVersion = browser?.version();
  if (!browserVersion) throw new Error('Producer capture has no attached browser');
  const viewport = page.viewportSize();
  const display = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    deviceScaleFactor: window.devicePixelRatio,
  }));
  if (!viewport || !['light', 'dark', 'high-contrast'].includes(display.theme)) {
    throw new Error('Producer capture requires an explicit viewport and app theme');
  }
  const path = testInfo.outputPath(filename);
  const target = options.target ?? page;
  const bytes = await target.screenshot({ animations: 'disabled', ...options.screenshot, path });
  const after = captureSourceIdentity();
  if (after.sourceDigest !== source.sourceDigest) {
    throw new Error('Source changed during screenshot capture; rerun from a stable tree');
  }
  const image = analyseImage(bytes);
  if (!image.valid) throw new Error(`Producer PNG is invalid: ${image.errors.join('; ')}`);
  const receipt = {
    schemaVersion: 1,
    file: filename,
    sha256: digest(bytes),
    width: image.width,
    height: image.height,
    capturedAt: new Date().toISOString(),
    producer: relative(ROOT, testInfo.file).replaceAll('\\', '/'),
    test: testInfo.title,
    provenance: {
      ...source,
      runId: relative(ROOT, testInfo.outputDir).replaceAll('\\', '/'),
      runtime: `${testInfo.project.name} Playwright E2E`,
      captureTool: `Playwright ${JSON.parse(readFileSync(resolve(ROOT, 'node_modules/@playwright/test/package.json'), 'utf8')).version} / ${browser.browserType().name()} ${browserVersion}`,
      viewport,
      deviceScaleFactor: display.deviceScaleFactor,
      theme: display.theme,
    },
  };
  const receiptPath = `${path}.provenance.json`;
  writeFileSync(`${receiptPath}.tmp`, `${JSON.stringify(receipt, null, 2)}\n`);
  renameSync(`${receiptPath}.tmp`, receiptPath);
  return bytes;
}

export function readProducerCaptureReceipt(path, source, bytes = readFileSync(path)) {
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(`${path}.provenance.json`, 'utf8'));
  } catch {
    throw new Error(
      `${source.id}: missing producer receipt for ${basename(path)}; rerun the owning spec`,
    );
  }
  const provenance = receipt.provenance;
  const image = analyseImage(bytes);
  if (
    receipt.schemaVersion !== 1 ||
    receipt.file !== basename(path) ||
    receipt.producer !== source.producer ||
    receipt.sha256 !== digest(bytes) ||
    !image.valid ||
    receipt.width !== image.width ||
    receipt.height !== image.height ||
    !Number.isFinite(Date.parse(receipt.capturedAt)) ||
    !/^[0-9a-f]{40}$/.test(provenance?.sourceRevision ?? '') ||
    !/^[0-9a-f]{64}$/.test(provenance?.sourceDigest ?? '') ||
    typeof provenance?.sourceDirty !== 'boolean' ||
    !provenance?.captureTool ||
    !provenance?.runtime ||
    !provenance?.runId ||
    provenance?.theme !== source.theme ||
    !(provenance?.viewport?.width > 0 && provenance?.viewport?.height > 0) ||
    provenance?.deviceScaleFactor !== 1
  ) {
    throw new Error(`${source.id}: invalid or mismatched producer receipt for ${basename(path)}`);
  }
  return {
    capturedAt: receipt.capturedAt,
    lastValidatedAgainst: provenance.sourceRevision,
    // Manifest viewport means an uncropped whole frame. A locator or
    // full-page capture can have different geometry; its real viewport still
    // lives in provenance, and its image dimensions remain independently measured.
    viewport:
      image.width === provenance.viewport.width && image.height === provenance.viewport.height
        ? provenance.viewport
        : undefined,
    provenance,
  };
}
