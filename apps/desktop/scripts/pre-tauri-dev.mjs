// Pre-hook for `pnpm tauri:dev`: installs FreeDesktop .desktop entry + hicolor
// icons so the Wayland compositor resolves the Varve icon via app_id lookup.
// Non-fatal: development works without it (just shows a generic Wayland logo).
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

if (platform() === 'linux') {
  try {
    execSync('bash apps/desktop/scripts/install-dev-icons.sh', {
      cwd: new URL('../../..', import.meta.url).pathname,
      stdio: 'inherit',
    });
  } catch {
    console.warn(
      '  [warn] Failed to install dev-mode desktop icons. Taskbar/launcher may show a generic Wayland icon.\n' +
        '         Run `just install-dev-icons` manually after fixing permissions.',
    );
  }
}
