import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const websiteRoot = new URL('../apps/website/', import.meta.url);
const validateEnvScript = fileURLToPath(
  new URL('./security/validate-client-env.mjs', import.meta.url),
);
const pageBuildEnv = {
  ...process.env,
  SITE_URL: 'https://k-arthur.github.io',
  SITE_BASE: '/varve',
};

/** Run a child process while preserving its output and exit status. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    console.error(`Website Pages build could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * Build the GitHub Pages project-site variant with the base path that the
 * deployment and dual-host browser tests actually serve.
 */
run(process.execPath, [validateEnvScript, '--app', 'website'], { cwd: websiteRoot });
run('pnpm', ['exec', 'astro', 'build', '--outDir', 'dist-pages'], {
  cwd: websiteRoot,
  env: pageBuildEnv,
});
