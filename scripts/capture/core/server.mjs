/**
 * Dev-server lifecycle for capture runs.
 *
 * Every run gets its own port and its own server process. Other agents run
 * Vite, Playwright and Tauri builds against this checkout at the same time;
 * attaching to a server we did not start means an HMR update from someone
 * else's edit can reset the editor midway through a recording.
 */
import { execFileSync, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { get } from 'node:http';
import { createServer } from 'node:net';

/**
 * A port unlikely to collide with a concurrent agent.
 *
 * VARVE_CAPTURE_PORT wins when set. Otherwise the PID picks a slot in a
 * private range — a fixed default would be the one thing every parallel run
 * agreed on.
 */
/** True when nothing is listening on `port`. */
function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * A port this run can have to itself.
 *
 * VARVE_CAPTURE_PORT wins when set. Otherwise the PID picks a starting slot
 * and the first genuinely free port from there is taken — deriving one purely
 * from the PID still collides (two pids 900 apart agree), and hand-picking
 * per run, as I did while debugging, collides constantly. Binding to check is
 * the only answer that accounts for another agent's server as well as ours.
 */
export async function capturePort() {
  const explicit = Number(process.env.VARVE_CAPTURE_PORT);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const base = 14000 + (process.pid % 900);
  for (let offset = 0; offset < 200; offset += 1) {
    const candidate = base + offset;
    if (await portFree(candidate)) return candidate;
  }
  throw new Error('no free port for the capture dev server');
}

function probe(base) {
  return new Promise((resolve) => {
    const req = get(`${base}/`, { timeout: 3000 }, (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function startServer({ port, root, timeoutMs = 180000, logPath }) {
  const base = `http://localhost:${port}`;
  const serverLog = logPath ? openSync(logPath, 'a') : undefined;
  const child = spawn(
    'pnpm',
    ['--filter', '@varve/desktop', 'exec', 'vite', '--port', String(port), '--strictPort'],
    {
      cwd: root,
      // A capture must not be torn down by someone else's HMR update.
      env: { ...process.env, VARVE_DISABLE_HMR: '1' },
      // The server's own output, not /dev/null. When vite dies moments after
      // it starts serving, the reason is in here — and discarding it meant
      // several rounds of guessing at a crash that was writing its cause out
      // the whole time.
      stdio: logPath ? ['ignore', serverLog, serverLog] : 'ignore',
      // Deliberately not detached. Putting the server in its own process
      // group did stop the leak, but the server then died moments after it
      // started serving and every capture hung in warm-up for four minutes.
      // The leak is fixed by killing the descendants explicitly instead.
      detached: false,
    },
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(base)) return { child, base, port };
    if (child.exitCode !== null) {
      throw new Error(`vite exited with code ${child.exitCode} before serving :${port}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill('SIGTERM');
  throw new Error(`vite did not serve :${port} within ${Math.round(timeoutMs / 1000)}s`);
}

/**
Stops the server this module started, and the vite it spawned.
 *
 * `pnpm ... exec vite` puts the process actually holding the port two levels
 * down, so signalling the wrapper alone orphans it. Twenty-seven leaked
 * before this was noticed, which exhausts memory and inotify watches alike.
 * Descendants are collected and signalled explicitly rather than by process
 * group: detaching the server into its own group also stopped the leak, but
 * the server then died moments after it began serving.
 */
export async function stopServer(server) {
  if (!server?.child?.pid) return;
  const root = server.child.pid;

  const descendants = [];
  const walk = (pid, depth) => {
    if (depth > 4) return;
    let out = '';
    try {
      out = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
    } catch {
      return; // no children
    }
    for (const line of out.split('\n')) {
      const child = Number(line.trim());
      if (!Number.isInteger(child) || child <= 0) continue;
      descendants.push(child);
      walk(child, depth + 1);
    }
  };
  walk(root, 0);

  const targets = [...descendants, root];
  for (const pid of targets) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  for (const pid of targets) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* exited on the term, as intended */
    }
  }
}
