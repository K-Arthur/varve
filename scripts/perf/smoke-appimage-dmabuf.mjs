#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.join('=') || 'true'];
  }),
);
const IMAGE = args.has('image') ? resolve(args.get('image')) : null;
const OUT = resolve(args.get('out') ?? 'webgl2-appimage-qualification.json');
const WAIT_MS = Number(args.get('wait-ms') ?? 25_000);
const DMABUF_VARIABLE = 'WEBKIT_DISABLE_DMABUF_RENDERER';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function webKitProcesses() {
  const matches = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const pid = Number(name);
      const commandLine = readFileSync(`/proc/${name}/cmdline`).toString();
      if (!commandLine.includes('WebKitWebProcess')) continue;
      const environment = readFileSync(`/proc/${name}/environ`)
        .toString()
        .split('\0')
        .filter((entry) => entry.startsWith(`${DMABUF_VARIABLE}=`));
      matches.push({
        pid,
        values: environment.map((entry) => entry.slice(DMABUF_VARIABLE.length + 1)),
      });
    } catch {
      // A process can exit between listing /proc and reading its metadata.
    }
  }
  return matches;
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function runCase({ id, userOverride, expectedValue }) {
  const profile = mkdtempSync(resolve(tmpdir(), `varve-appimage-${id}-`));
  const env = {
    ...process.env,
    APPIMAGE_EXTRACT_AND_RUN: '1',
    LIBGL_ALWAYS_SOFTWARE: '1',
    GDK_BACKEND: 'x11',
    XDG_CONFIG_HOME: resolve(profile, 'config'),
    XDG_CACHE_HOME: resolve(profile, 'cache'),
    XDG_DATA_HOME: resolve(profile, 'data'),
  };
  delete env.WAYLAND_DISPLAY;
  if (userOverride === null) delete env[DMABUF_VARIABLE];
  else env[DMABUF_VARIABLE] = userOverride;

  const logChunks = [];
  let logBytes = 0;
  let spawnError = null;
  const startedAt = performance.now();
  const child = spawn(
    'dbus-run-session',
    [
      '--',
      'xvfb-run',
      '--auto-servernum',
      'timeout',
      `${Math.ceil((WAIT_MS + 20_000) / 1000)}s`,
      IMAGE,
      '--appimage-extract-and-run',
    ],
    { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const closed = new Promise((resolvePromise) => {
    child.once('close', (code, signal) => resolvePromise({ code, signal }));
  });
  child.once('error', (error) => {
    spawnError = error.message;
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      if (logBytes >= 512 * 1024) return;
      const remaining = 512 * 1024 - logBytes;
      const bounded = chunk.subarray(0, remaining);
      logChunks.push(bounded);
      logBytes += bounded.length;
    });
  }

  let processes = [];
  const deadline = startedAt + WAIT_MS;
  try {
    while (performance.now() < deadline) {
      processes = webKitProcesses();
      if (processes.length > 0 || child.exitCode !== null || spawnError) break;
      await wait(250);
    }
    // Let WebKit settle briefly so a one-frame crash does not count as a
    // successful package launch.
    if (processes.length > 0) await wait(1500);
    processes = webKitProcesses();
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // The app may have exited on its own.
    }
    await Promise.race([closed, wait(3000)]);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The process group is already gone.
    }
  }

  const processExit = await Promise.race([closed, wait(100)]);
  const log = Buffer.concat(logChunks).toString('utf8');
  const graphicsFailure =
    /\b(EGL|Aborting|entry point|segmentation fault|Could not create EGL display)\b/i.test(log);
  const observedValues = [...new Set(processes.flatMap((process) => process.values))];
  const variablesMatch =
    processes.length > 0 &&
    processes.every(
      (process) => process.values.length === 1 && process.values[0] === expectedValue,
    );
  rmSync(profile, { recursive: true, force: true });

  return {
    id,
    input: userOverride === null ? 'unset' : userOverride,
    expectedWebKitValue: expectedValue,
    webKitProcessCount: processes.length,
    observedWebKitValues: observedValues,
    processExit: processExit?.code ?? null,
    processSignal: processExit?.signal ?? null,
    spawnError,
    graphicsFailure,
    passed: processes.length > 0 && variablesMatch && !graphicsFailure && !spawnError,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

async function main() {
  if (process.platform !== 'linux') throw new Error('packaged AppImage smoke is Linux-only');
  if (!IMAGE || !existsSync(IMAGE)) throw new Error('pass --image=/path/to/release.AppImage');
  if (!Number.isInteger(WAIT_MS) || WAIT_MS < 5000 || WAIT_MS > 90_000) {
    throw new Error('--wait-ms must be an integer from 5000 to 90000');
  }
  execFileSync('chmod', ['+x', IMAGE]);
  const report = {
    schemaVersion: 1,
    status: 'running',
    qualificationEligible: false,
    evidenceClass: 'packaged-software-webkit-compatibility',
    source: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      imageFile: basename(IMAGE),
      imageSha256: sha256(IMAGE),
    },
    graphics: {
      requestedBackend: 'X11 under Xvfb with Mesa software rendering',
      physicalGpuExecution: 'unknown',
      physicalPresentation: 'unavailable',
    },
    cases: [],
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const save = () => writeFileSync(OUT, JSON.stringify(report, null, 2));
  for (const scenario of [
    { id: 'appimage-default-workaround', userOverride: null, expectedValue: '1' },
    { id: 'explicit-user-override-zero', userOverride: '0', expectedValue: '0' },
  ]) {
    report.cases.push(await runCase(scenario));
    save();
  }
  report.status = report.cases.every((testCase) => testCase.passed) ? 'passed' : 'failed';
  report.completedAt = new Date().toISOString();
  save();
  console.log(`packaged AppImage DMA-BUF smoke ${report.status}: ${OUT}`);
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
