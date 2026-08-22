/**
 * Dev-server lifecycle for capture runs.
 *
 * Every run gets its own port and its own server process. Other agents run
 * Vite, Playwright and Tauri builds against this checkout at the same time;
 * attaching to a server we did not start means an HMR update from someone
 * else's edit can reset the editor midway through a recording.
 */
import { spawn } from 'node:child_process';
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

export async function startServer({ port, root, timeoutMs = 180000 }) {
  const base = `http://localhost:${port}`;
  const child = spawn(
    'pnpm',
    ['--filter', '@varve/desktop', 'exec', 'vite', '--port', String(port), '--strictPort'],
    {
      cwd: root,
      // A capture must not be torn down by someone else's HMR update.
      env: { ...process.env, VARVE_DISABLE_HMR: '1' },
      stdio: 'ignore',
      // Own process group. The command is `pnpm ... exec vite`, so the thing
      // actually listening is a grandchild; signalling the pnpm wrapper alone
      // leaves vite running forever. Twenty-seven of them had accumulated
      // before this was noticed, which is its own kind of memory leak.
      detached: true,
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
 * Stops the server this module started, and the vite it spawned.
 *
 * Kills the process *group*, not just the pnpm wrapper: `pnpm exec vite` puts
 * the listener two levels down, and terminating the wrapper orphans it. Only
 * ever this run's group — never a stray vite that might belong to someone
 * else's capture.
 */
export async function stopServer(server) {
  if (!server?.child?.pid) return;
  const pid = server.child.pid;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      server.child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* exited on the term, as intended */
  }
}
