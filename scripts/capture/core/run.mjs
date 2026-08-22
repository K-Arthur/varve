/**
 * The capture harness every workflow script hands its sequence to.
 *
 * Owns the parts that must be identical across all seven clips — server,
 * browser context, determinism contract, trim measurement, delivery encode,
 * verification, manifest — so a workflow file contains only the actions it
 * demonstrates and the assertions that prove they were real.
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
/**
 * One directory per run, holding everything that run owns.
 *
 * Previously the recording and the staging area were siblings under
 * `.capture-tmp/` named `run-*` and `publish-*`. That reads as isolated and
 * is not: tidying up meant globbing `run-*`, which deletes directories
 * belonging to *other* runs — including a capture still writing to one. The
 * symptom is an ffmpeg "No such file or directory" in a run that did nothing
 * wrong, and on a shared checkout the victim can be another agent.
 *
 * Everything a run touches now lives under a single root it alone may
 * remove, and nothing globs siblings.
 */
function runRoot(slug) {
  const root = join(ROOT, '.capture-tmp', `${slug}-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(join(root, 'recording'), { recursive: true });
  mkdirSync(join(root, 'stage'), { recursive: true });
  return root;
}

const PRIVACY_PATTERNS = [
  { name: 'home path', re: /\/(?:home|Users|var\/home)\/[^\s/]+/i },
  { name: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{16,}/i },
  {
    name: 'access token',
    re: /(?:access[_-]?token|api[_-]?key|secret)\s*[:=]\s*['"]?[A-Za-z0-9._-]{16,}/i,
  },
  { name: 'private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  {
    name: 'internal URL',
    re: /https?:\/\/(?:localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)[^\s"']+/i,
  },
];

function privacyFindings(text, label) {
  return PRIVACY_PATTERNS.filter(({ re }) => re.test(text)).map(
    ({ name }) => `${label} contains possible ${name}`,
  );
}

/**
 * @param {object} spec
 * @param {string} spec.slug            file stem for every artefact
 * @param {string} spec.workflow        human name
 * @param {string} spec.purpose         one line: what this clip is for
 * @param {string} [spec.fixture]       fixture identifier recorded in the manifest
 * @param {[number, number]} spec.duration  [min, max] delivered seconds
 * @param {number} [spec.posterAt]      fraction of the delivered cut used for the poster (0–1)
 * @param {boolean} [spec.authoredMotion]  allow authored prototype/timeline motion
 * @param {Array<Function|object>} [spec.initScripts] init scripts installed before first navigation
 * @param {object|((ctx: object) => object)} [spec.metadata] extra manifest metadata
 * @param {Array<{name: string, contents: string|Buffer, public?: boolean}>|((ctx: object) => Array)} [spec.artifacts]
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
  mkdirSync(FRAME_DIR, { recursive: true });

  const port = await capturePort();
  // Everything this run owns, under one root it alone removes.
  const root = runRoot(spec.slug);
  const tmp = join(root, 'recording');
  const stage = join(root, 'stage');

  // A copy of this run's console output, inside its own root. Redirecting
  // several attempts at the same shell-chosen path overwrites the evidence
  // from whichever is still running, which is how a real failure message
  // repeatedly went missing while I read a truncated file.
  const logPath = join(root, 'run.log');
  for (const stream of ['log', 'error']) {
    const original = console[stream].bind(console);
    console[stream] = (...args) => {
      const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
      try {
        appendFileSync(logPath, `${line}\n`);
      } catch {
        /* logging must never fail a capture */
      }
      original(...args);
    };
  }
  console.log(`[${spec.slug}] run directory ${root}`);
  const browser = await chromium.launch();
  let server;
  let exitCode = 0;

  // Interrupting a capture must not leak its dev server. Node runs no finally
  // block on SIGTERM/SIGINT, so a killed run leaves vite holding roughly 22k
  // inotify watches; a couple of dozen of those exhaust the system limit and
  // then no dev server will start for anyone on the machine.
  let interrupted = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      if (interrupted) return;
      interrupted = true;
      console.error(`[${spec.slug}] ${signal} — stopping the dev server before exit`);
      void Promise.resolve(stopServer(server)).finally(() => process.exit(130));
    });
  }
  let publishLock = null;

  try {
    // Probing a port then binding it is a race, and on a checkout several
    // agents are starting servers in there is a real chance of losing it —
    // vite is launched with --strictPort, so it exits rather than sliding to
    // the next one. Retry with a fresh port instead of failing the capture.
    let attempt = 0;
    for (;;) {
      try {
        server = await startServer({
          port: attempt === 0 ? port : await capturePort(),
          root: ROOT,
          logPath: join(root, 'server.log'),
        });
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= 3) throw err;
        console.warn(`[${spec.slug}] dev server did not come up, retrying on another port`);
      }
    }
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
    for (const script of spec.initScripts ?? []) await context.addInitScript(script);
    const page = await context.newPage();
    await page.emulateMedia({
      colorScheme: 'light',
      reducedMotion: spec.authoredMotion ? 'no-preference' : 'reduce',
      forcedColors: 'none',
    });

    // A capture must never ship a frame containing a page error.
    const pageErrors = [];
    const KNOWN_BENIGN_PAGE = [
      /googleapis\.com/i,
      /CORS policy/i,
      /ERR_FAILED/i,
      /fetch.*googleapis/i,
      /Maximum update depth exceeded/i,
    ];
    page.on('pageerror', (err) => {
      const msg = err.message?.slice(0, 300) ?? '';
      if (KNOWN_BENIGN_PAGE.some((re) => re.test(msg))) return;
      pageErrors.push(msg);
      console.error(`[${spec.slug}] pageerror: ${msg}`);
    });

    // A renderer crash is not a page error and not a failed assertion — the
    // page simply stops. Without this the run just waits out whatever locator
    // it was on and reports a timeout, which sends you looking at the
    // selector instead of at the crash that made it unreachable.
    page.on('crash', () => {
      pageErrors.push('renderer crashed');
      console.error(`[${spec.slug}] the renderer crashed`);
    });

    // Console errors carry the worker-side failures that never surface as a
    // pageerror, which is where an off-main-thread job reports its problems.
    // Some errors are expected in a local dev environment and must not fail
    // the capture — CORS blocks from Google Fonts when the font browser
    // tries to load families from an external API over localhost.
    const KNOWN_BENIGN_CONSOLE = [
      /googleapis\.com/i,
      /CORS policy/i,
      /ERR_FAILED/i,
    ];
    const KNOWN_BENIGN_PAGE_ERROR = [
      /Maximum update depth exceeded/i,
    ];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text().slice(0, 300);
      if (KNOWN_BENIGN_CONSOLE.some((re) => re.test(text))) return;
      pageErrors.push(`console: ${text}`);
      console.error(`[${spec.slug}] console error: ${text}`);
    });

    const started = Date.now();
    let trimStart = null;
    const ctx = {
      page,
      base: server.base,
      fixtures: FIXTURES,
      runId: stage.split('/').pop(),
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

    const visibleText = await page
      .locator('body')
      .innerText()
      .catch(() => '');

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
    // Late in the cut, where the artwork exists — see posterFrom. Workflows
    // with a clean explanatory end state can opt into a later or earlier
    // frame; a single fixed fraction made stale-looking posters too easy to
    // ship when a panel opened near the end of a sequence.
    const deliveredBeforePoster = await probe(webm);
    const posterFraction = spec.posterAt ?? 0.85;
    if (!(posterFraction >= 0 && posterFraction <= 1)) {
      throw new Error(`posterAt must be between 0 and 1, got ${posterFraction}`);
    }
    const posterAt = Math.min(
      Math.max(0.2, deliveredBeforePoster.duration - 0.2),
      Math.max(0.2, deliveredBeforePoster.duration * posterFraction),
    );
    await posterFrom(webm, poster, posterAt);

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

    const stagedFrameDir = join(stage, 'frames');
    const frames = await sampleFrames(webm, delivered.duration, stagedFrameDir, spec.slug);
    verification.frames = frames.map(({ path, ...rest }) => rest);
    verification.findings.push(...frameFindings(frames));
    if (pageErrors.length) {
      verification.pageErrors = pageErrors;
      verification.findings.push(`page errors during capture: ${pageErrors.length}`);
    }
    verification.privacy = privacyFindings(visibleText, 'visible capture text');
    verification.findings.push(...verification.privacy);
    verification.pass = verification.findings.length === 0;

    const metadata = typeof spec.metadata === 'function' ? await spec.metadata(ctx) : spec.metadata;
    const extraArtifacts =
      typeof spec.artifacts === 'function' ? await spec.artifacts(ctx) : (spec.artifacts ?? []);
    for (const artifact of extraArtifacts) {
      const artifactPath = join(stage, artifact.name);
      mkdirSync(dirname(artifactPath), { recursive: true });
      const contents = artifact.contents;
      writeFileSync(artifactPath, contents);
      verification.findings.push(...privacyFindings(String(contents), artifact.name));
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
        posterAt: Number(posterAt.toFixed(2)),
        fps: FPS,
        outputs: {
          webm: `docs/screenshots/workflows/${spec.slug}.webm`,
          ...(skipMp4 ? {} : { mp4: `docs/screenshots/workflows/${spec.slug}.mp4` }),
          poster: `docs/screenshots/workflows/${spec.slug}-poster.png`,
        },
        assertions,
        metadata,
        artifacts: extraArtifacts.map(({ name }) => name),
        verification,
      },
      ROOT,
    );

    if (verification.pass) {
      const lock = join(OUT_DIR, `.${spec.slug}.publish.lock`);
      try {
        mkdirSync(lock);
      } catch {
        throw new Error(`another ${spec.slug} capture is publishing; refusing to overwrite it`);
      }
      publishLock = lock;
      const canonical = [
        [webm, join(OUT_DIR, `${spec.slug}.webm`)],
        ...(!skipMp4 ? [[mp4, join(OUT_DIR, `${spec.slug}.mp4`)]] : []),
        [poster, join(OUT_DIR, `${spec.slug}-poster.png`)],
        [manifestPath, join(OUT_DIR, `${spec.slug}.capture.json`)],
      ];
      const atomicCopy = (src, dest) => {
        const temporary = `${dest}.tmp-${process.pid}`;
        copyFileSync(src, temporary);
        renameSync(temporary, dest);
      };
      for (const [src, dest] of canonical) atomicCopy(src, dest);
      for (const frame of frames) {
        atomicCopy(frame.path, join(FRAME_DIR, `${spec.slug}-${frame.label}.png`));
      }
      for (const artifact of extraArtifacts) {
        const src = join(stage, artifact.name);
        const dest = join(OUT_DIR, artifact.name);
        mkdirSync(dirname(dest), { recursive: true });
        atomicCopy(src, dest);
      }
      // Website copies live in their own subdirectory: the screenshot
      // validator treats a loose PNG in public/screenshots as an orphan.
      for (const src of [webm, ...(skipMp4 ? [] : [mp4]), poster]) {
        atomicCopy(src, join(PUBLIC_DIR, src.split('/').pop()));
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

    if (keepSource) console.log(`[${spec.slug}] run directory kept at ${root}`);
    else if (verification.pass) rmSync(root, { recursive: true, force: true });
    else console.error(`[${spec.slug}] run directory kept for inspection: ${root}`);

    return manifest;
  } catch (err) {
    console.error(`[${spec.slug}] FAILED: ${err instanceof Error ? err.message : err}`);
    exitCode = 1;
    // The raw recording is left in place: re-encoding it costs seconds where
    // re-recording costs another warm-up plus the whole sequence.
    console.error(`[${spec.slug}] run directory kept for inspection: ${root}`);
  } finally {
    if (publishLock) rmSync(publishLock, { recursive: true, force: true });
    await stopServer(server);
    await browser.close().catch(() => undefined);
    process.exitCode = exitCode;
    // Force the process down. Playwright and the Vite child can leave handles
    // open that keep Node alive indefinitely after a failure — the run prints
    // FAILED and then sits there holding a browser and a dev server. Several
    // accumulate into memory exhaustion, at which point later runs are OOM
    // killed with no error at all, which reads as random flakiness rather
    // than as a pile-up of the previous attempts.
    setTimeout(() => process.exit(exitCode), 2000).unref();
  }
}
