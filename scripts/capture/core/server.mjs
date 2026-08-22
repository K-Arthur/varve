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

/**
 * A port unlikely to collide with a concurrent agent.
 *
 * VARVE_CAPTURE_PORT wins when set. Otherwise the PID picks a slot in a
 * private range — a fixed default would be the one thing every parallel run
 * agreed on.
 */
export function capturePort() {
  const explicit = Number(process.env.VARVE_CAPTURE_PORT);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return 14000 + (process.pid % 900);
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

/** Only ever stops the child this module started — never a stray Vite. */
export async function stopServer(server) {
  if (!server?.child) return;
  try {
    server.child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}
