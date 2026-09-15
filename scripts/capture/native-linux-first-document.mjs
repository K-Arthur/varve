#!/usr/bin/env node
/**
 * Native Linux screen capture for Video C.
 *
 * It owns an Xvfb display and a disposable XDG profile, then records the
 * actual Tauri/WebKitGTK window while WDIO drives it. No browser page is used
 * as a substitute for the desktop app.
 */
import { strict as assert } from 'node:assert';
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { hasFfmpeg, posterFrom, probe, toMp4, toWebm } from './core/ffmpeg.mjs';
import { ROOT } from './core/run.mjs';
import { frameFindings, sampleFrames, verifyClip } from './core/verify.mjs';

const slug = 'linux-first-document';
const binary = process.env.VARVE_DESKTOP_BINARY
  ? process.env.VARVE_DESKTOP_BINARY
  : join(ROOT, 'apps', 'desktop', 'src-tauri', 'target', 'debug', 'varve-desktop');
const runId = `native-${process.pid}-${Date.now()}`;
const captureRoot = process.env.VARVE_CAPTURE_TMP_DIR ?? join(ROOT, '.capture-tmp');
const scratch = join(captureRoot, runId);
const stage = join(scratch, 'publish');
const outDir = join(ROOT, 'docs', 'screenshots', 'workflows');
const publicDir = join(ROOT, 'apps', 'website', 'public', 'screenshots', 'workflows');
const frameDir = join(outDir, 'frames');
const display = `:${100 + (process.pid % 80)}`;
const env = {
  ...process.env,
  DISPLAY: display,
  VARVE_WDIO_SPECS: './tests/wdio/linux-first-document.e2e.ts',
  XDG_CONFIG_HOME: join(scratch, 'config'),
  XDG_DATA_HOME: join(scratch, 'data'),
  XDG_CACHE_HOME: join(scratch, 'cache'),
  VARVE_CAPTURE_RUN_ID: runId,
  VARVE_NATIVE_CAPTURE_PASS_MARKER: join(scratch, 'wdio-passed'),
  VARVE_NATIVE_CAPTURE_FRAMES_DIR: join(scratch, 'native-frames'),
};

mkdirSync(stage, { recursive: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });
mkdirSync(frameDir, { recursive: true });
assert(existsSync(binary), `native binary missing: ${binary}`);
assert(await hasFfmpeg(), 'ffmpeg/ffprobe are required for native delivery');

function waitForDisplay(xvfb) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      execFileSync('xdpyinfo', ['-display', display], { stdio: 'ignore' });
      return;
    } catch {
      if (xvfb.exitCode !== null) throw new Error('Xvfb exited before the display became ready');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  throw new Error(`display ${display} did not become ready`);
}

function atomicCopy(src, dest) {
  mkdirSync(join(dest, '..'), { recursive: true });
  const temporary = `${dest}.tmp-${process.pid}`;
  copyFileSync(src, temporary);
  renameSync(temporary, dest);
}

const xvfb = spawn('Xvfb', [display, '-screen', '0', '1440x900x24', '-ac', '-nolisten', 'tcp'], {
  env,
  stdio: ['ignore', 'ignore', 'pipe'],
});
const errors = [];
xvfb.stderr.on('data', (chunk) => errors.push(String(chunk)));
let recorder;
let runner;
try {
  waitForDisplay(xvfb);
  const raw = join(scratch, `${slug}.raw.mkv`);
  recorder = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'x11grab',
      '-framerate',
      '30',
      '-video_size',
      '1440x900',
      '-i',
      `${display}.0`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      raw,
    ],
    { env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  recorder.stderr.on('data', (chunk) => errors.push(String(chunk)));
  await new Promise((resolve) => setTimeout(resolve, 1200));

  runner = spawn('dbus-run-session', ['--', 'pnpm', 'exec', 'wdio', 'run', 'wdio.conf.ts'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const runnerResult = await new Promise((resolve) =>
    runner.on('close', (code, signal) => resolve({ code, signal })),
  );
  const wdioPassed = existsSync(env.VARVE_NATIVE_CAPTURE_PASS_MARKER);
  assert(
    wdioPassed &&
      (runnerResult.code === 0 || (runnerResult.code === 143 && runnerResult.signal === null)),
    `native WDIO flow failed with exit ${runnerResult.code ?? 'null'} (${runnerResult.signal ?? 'no signal'})`,
  );
  recorder.kill('SIGINT');
  await new Promise((resolve) => recorder.on('close', resolve));
  assert(existsSync(raw), 'native recorder produced no file');

  // In Xvfb, WebKitGTK's native surface can be visible to the embedded
  // WebDriver provider while remaining black to root-window x11grab. The
  // screenshots below are still taken from that real Tauri/WebKitGTK window;
  // use them as the source when available instead of publishing black pixels.
  const nativeFrames = readdirSync(env.VARVE_NATIVE_CAPTURE_FRAMES_DIR)
    .filter((file) => file.endsWith('.png'))
    .sort()
    .map((file) => join(env.VARVE_NATIVE_CAPTURE_FRAMES_DIR, file));
  assert(
    nativeFrames.length >= 20,
    `native WDIO produced too few visible frames: ${nativeFrames.length}`,
  );
  const frameList = join(scratch, 'native-frames.txt');
  const frameLines = nativeFrames
    .map((file) => `file '${file.replaceAll("'", "'\\''")}'\nduration 0.6`)
    .join('\n');
  writeFileSync(frameList, `${frameLines}\nfile '${nativeFrames.at(-1)}'\n`);
  const nativeSequence = join(scratch, 'native-frame-sequence.mkv');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    frameList,
    '-vf',
    'scale=1440:900:flags=lanczos,fps=30',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    nativeSequence,
  ]);

  const webm = join(stage, `${slug}.webm`);
  const mp4 = join(stage, `${slug}.mp4`);
  const poster = join(stage, `${slug}-poster.png`);
  await toWebm(nativeSequence, webm, { start: 0, fps: 30 });
  await toMp4(nativeSequence, mp4, { start: 0, fps: 30 });
  await posterFrom(webm, poster);
  const delivered = await probe(webm);
  const verification = {
    findings: [],
    clips: {},
    environment: {
      native: true,
      display,
      artifact: binary.replace(`${ROOT}/`, ''),
      captureMode: 'native-tauri-webdriver-screenshot-sequence',
      nativeFrameCount: nativeFrames.length,
    },
  };
  for (const [label, path, codec] of [
    ['webm', webm, 'vp9'],
    ['mp4', mp4, 'h264'],
  ]) {
    const result = await verifyClip(path, {
      codec,
      width: 1440,
      height: 900,
      fps: 30,
      minSeconds: 20,
      maxSeconds: 50,
      maxBytes: 10_000_000,
    });
    verification.clips[label] = { pass: result.pass, findings: result.findings, info: result.info };
    verification.findings.push(...result.findings.map((finding) => `${label}: ${finding}`));
  }
  const frames = await sampleFrames(webm, delivered.duration, stage, slug);
  verification.frames = frames.map(({ path, ...rest }) => rest);
  verification.findings.push(...frameFindings(frames));
  verification.pass = verification.findings.length === 0;
  const manifest = {
    workflow: 'Linux installation → first document',
    slug,
    purpose: 'Native Linux first-run flow in a disposable XDG profile.',
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    capturedAt: new Date().toISOString(),
    viewport: '1440x900',
    dpr: 1,
    fixture: null,
    captureRuntime: `Tauri/WebKitGTK native WDIO / node ${process.version}`,
    artifact: {
      type: 'local-debug-build',
      path: binary.replace(`${ROOT}/`, ''),
      publicRelease: false,
      note: 'Locally built capture artifact; not presented as a public download.',
    },
    sourceDuration: delivered.duration,
    deliveredDuration: delivered.duration,
    fps: 30,
    outputs: {
      webm: `docs/screenshots/workflows/${slug}.webm`,
      mp4: `docs/screenshots/workflows/${slug}.mp4`,
      poster: `docs/screenshots/workflows/${slug}-poster.png`,
    },
    productAssertions: [
      'native Tauri/WebKitGTK binary launched under a clean XDG profile',
      'first document created through the native desktop UI',
      'rectangle created through the real editor canvas',
      'text entered through the real text tool where available',
      'local save status reached a persisted or saving state',
    ],
    verification,
  };
  const manifestPath = join(stage, `${slug}.capture.json`);
  const lock = join(outDir, `.${slug}.publish.lock`);
  mkdirSync(lock);
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (!verification.pass) throw new Error(verification.findings.join('; '));
    for (const [src, dest] of [
      [webm, join(outDir, `${slug}.webm`)],
      [mp4, join(outDir, `${slug}.mp4`)],
      [poster, join(outDir, `${slug}-poster.png`)],
      [manifestPath, join(outDir, `${slug}.capture.json`)],
    ])
      atomicCopy(src, dest);
    for (const frame of frames)
      atomicCopy(frame.path, join(frameDir, `${slug}-${frame.label}.png`));
    for (const source of [webm, mp4, poster])
      atomicCopy(source, join(publicDir, source.split('/').pop()));
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
  console.log(`[${slug}] ${delivered.duration.toFixed(1)}s native capture verified`);
} finally {
  if (runner && runner.exitCode === null) runner.kill('SIGTERM');
  if (recorder && recorder.exitCode === null) recorder.kill('SIGTERM');
  if (xvfb.exitCode === null) xvfb.kill('SIGTERM');
  if (!process.argv.includes('--keep-source'))
    rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  if (errors.length) console.error(errors.join('\n').slice(-4000));
}
