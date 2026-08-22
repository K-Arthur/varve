/**
 * The capture harness every workflow script hands its sequence to.
 *
 * Owns the parts that must be identical across all seven clips — server,
 * browser context, determinism contract, trim measurement, delivery encode,
 * verification, manifest — so a workflow file contains only the actions it
 * demonstrates and the assertions that prove they were real.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { SEED_FIRST_RUN_STATE } from './editor.mjs';
import { hasFfmpeg, posterFrom, probe, toMp4, toWebm } from './ffmpeg.mjs';
import { writeManifest } from './manifest.mjs';
import { capturePort, startServer, stopServer } from './server.mjs';
import { frameFindings, sampleFrames, verifyClip } from './verify.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIXTURES = join(ROOT, 'scripts', 'capture', 'fixtures');

const OUT_DIR = join(ROOT, 'docs', 'screenshots', 'workflows');
const PUBLIC_DIR = join(ROOT, 'apps', 'website', 'public', 'screenshots', 'workflows');
const FRAME_DIR = join(ROOT, 'docs', 'screenshots', 'workflows', 'frames');

const VIEWPORT = { width: 1440, height: 900 };
const FPS = 30;

/**
 * Recording temp dir is per-run: Playwright names videos by hash, and two
 * concurrent captures sharing a directory would race over the same output.
 */
function scratchDir() {
  const dir = join(ROOT, '.capture-tmp', `run-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stagingDir() {
  const dir = join(ROOT, '.capture-tmp', `publish-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {object} spec
 * @param {string} spec.slug            file stem for every artefact
 * @param {string} spec.workflow        human name
 * @param {string} spec.purpose         one line: what this clip is for
 * @param {string} [spec.fixture]       fixture identifier recorded in the manifest
 * @param {[number, number]} spec.duration  [min, max] delivered seconds
 * @param {boolean} [spec.authoredMotion]  allow authored prototype/timeline motion
 * @param {(ctx) => Promise<string[]>} spec.sequence
 *        Drives the editor. Calls `ctx.begin()` once setup is done — the cut
 *        starts there. Returns the product assertions it verified.
 */
export async function capture(spec) {
  const args = process.argv.slice(2);
  const keepSource = args.includes('--keep-source');
  const skipMp4 = args.includes('--no-mp4');

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(PUBLIC_DIR, { recursive: true });

  const port = capturePort();
  const tmp = scratchDir();
  const stage = stagingDir();
  const browser = await chromium.launch();
  let server;
  let exitCode = 0;

  try {
    server = await startServer({ port, root: ROOT });
    console.log(`[${spec.slug}] server on :${port}`);

    // Warm the module graph first. A cold Vite transform of this app takes
    // ~100s, and that would otherwise be recorded and then trimmed away.
    const warm = await browser.newContext({ viewport: VIEWPORT });
    const warmPage = await warm.newPage();
    await warmPage.goto(`${server.base}/`, { timeout: 240000, waitUntil: 'domcontentloaded' });
    await warmPage
      .getByRole('button', { name: /^new$/i })
      .waitFor({ state: 'visible', timeout: 240000 });
    await warm.close();
    console.log(`[${spec.slug}] warm`);

    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordVideo: { dir: tmp, size: VIEWPORT },
    });
    await context.addInitScript(SEED_FIRST_RUN_STATE);
    const page = await context.newPage();
    await page.emulateMedia({
      colorScheme: 'light',
      reducedMotion: spec.authoredMotion ? 'no-preference' : 'reduce',
      forcedColors: 'none',
    });

    // A capture must never ship a frame containing a page error.
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const started = Date.now();
    let trimStart = null;
    const ctx = {
      page,
      base: server.base,
      fixtures: FIXTURES,
      begin: () => {
        if (trimStart === null) {
          trimStart = (Date.now() - started) / 1000;
          console.log(`[${spec.slug}] content ready at ${trimStart.toFixed(1)}s`);
        }
      },
    };

    let assertions = [];
    let sourceSeconds = 0;
    try {
      assertions = (await spec.sequence(ctx)) ?? [];
    } finally {
      sourceSeconds = (Date.now() - started) / 1000;
    }
    if (trimStart === null) throw new Error('sequence never called ctx.begin()');

    const video = page.video();
    await context.close();
    const sourcePath = await video.path();
    if (!sourcePath || !existsSync(sourcePath)) throw new Error('no video file after recording');

    if (!(await hasFfmpeg())) {
      throw new Error('ffmpeg/ffprobe are required to deliver a normalised cut');
    }

    // Encode into a per-run staging directory. Canonical files are touched
    // only after every codec/frame assertion passes, so a failed concurrent
    // run can never replace a previously delivered clip.
    const webm = join(stage, `${spec.slug}.webm`);
    const mp4 = join(stage, `${spec.slug}.mp4`);
    const poster = join(stage, `${spec.slug}-poster.png`);
    for (const f of [webm, mp4, poster]) rmSync(f, { force: true });

    console.log(`[${spec.slug}] trimming ${trimStart.toFixed(1)}s of setup`);
    await toWebm(sourcePath, webm, { start: trimStart, fps: FPS });
    if (!skipMp4) await toMp4(sourcePath, mp4, { start: trimStart, fps: FPS });
    await posterFrom(webm, poster);

    const delivered = await probe(webm);
    const [minS, maxS] = spec.duration;

    const verification = { findings: [], clips: {} };
    for (const [label, path, codec] of [
      ['webm', webm, 'vp9'],
      ...(skipMp4 ? [] : [['mp4', mp4, 'h264']]),
    ]) {
      const result = await verifyClip(path, {
        codec,
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        fps: FPS,
        minSeconds: minS,
        maxSeconds: maxS,
        maxBytes: 10_000_000,
      });
      verification.clips[label] = {
        pass: result.pass,
        findings: result.findings,
        info: result.info,
      };
      verification.findings.push(...result.findings.map((f) => `${label}: ${f}`));
    }

    const frames = await sampleFrames(webm, delivered.duration, FRAME_DIR, spec.slug);
    verification.frames = frames.map(({ path, ...rest }) => rest);
    verification.findings.push(...frameFindings(frames));
    if (pageErrors.length) {
      verification.pageErrors = pageErrors;
      verification.findings.push(`page errors during capture: ${pageErrors.length}`);
    }
    verification.pass = verification.findings.length === 0;

    const manifestPath = join(stage, `${spec.slug}.capture.json`);
    const manifest = writeManifest(
      manifestPath,
      {
        workflow: spec.workflow,
        slug: spec.slug,
        purpose: spec.purpose,
        fixture: spec.fixture,
        viewport: VIEWPORT,
        dpr: 1,
        browserVersion: browser.version(),
        sourceDuration: sourceSeconds,
        deliveredDuration: delivered.duration,
        fps: FPS,
        outputs: {
          webm: `docs/screenshots/workflows/${spec.slug}.webm`,
          ...(skipMp4 ? {} : { mp4: `docs/screenshots/workflows/${spec.slug}.mp4` }),
          poster: `docs/screenshots/workflows/${spec.slug}-poster.png`,
        },
        assertions,
        verification,
      },
      ROOT,
    );

    if (verification.pass) {
      const canonical = [
        [webm, join(OUT_DIR, `${spec.slug}.webm`)],
        ...(!skipMp4 ? [[mp4, join(OUT_DIR, `${spec.slug}.mp4`)]] : []),
        [poster, join(OUT_DIR, `${spec.slug}-poster.png`)],
        [manifestPath, join(OUT_DIR, `${spec.slug}.capture.json`)],
      ];
      for (const [src, dest] of canonical) copyFileSync(src, dest);
      // Website copies live in their own subdirectory: the screenshot
      // validator treats a loose PNG in public/screenshots as an orphan.
      for (const src of [webm, ...(skipMp4 ? [] : [mp4]), poster]) {
        copyFileSync(src, join(PUBLIC_DIR, src.split('/').pop()));
      }
    } else {
      console.error(`[${spec.slug}] canonical outputs were left untouched`);
    }

    console.log(
      `[${spec.slug}] ${delivered.duration.toFixed(1)}s  ` +
        `webm ${(statSync(webm).size / 1e6).toFixed(2)} MB  ` +
        `${skipMp4 ? '' : `mp4 ${(statSync(mp4).size / 1e6).toFixed(2)} MB  `}` +
        `${verification.pass ? 'verified' : `${verification.findings.length} FINDING(S)`}`,
    );
    for (const f of verification.findings) console.error(`  ! ${f}`);
    if (!verification.pass) exitCode = 1;

    if (keepSource) console.log(`[${spec.slug}] source kept at ${sourcePath}`);
    else rmSync(tmp, { recursive: true, force: true });
    if (verification.pass) rmSync(stage, { recursive: true, force: true });

    return manifest;
  } catch (err) {
    console.error(`[${spec.slug}] FAILED: ${err instanceof Error ? err.message : err}`);
    exitCode = 1;
    // The raw recording is left in place: re-encoding it costs seconds where
    // re-recording costs another warm-up plus the whole sequence.
    console.error(`[${spec.slug}] recording left at ${tmp}`);
  } finally {
    await stopServer(server);
    await browser.close();
    process.exitCode = exitCode;
  }
}
