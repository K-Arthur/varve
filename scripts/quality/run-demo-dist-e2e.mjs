#!/usr/bin/env node

/** Build, stage, and certify the production /try owner specs for local gates. */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const run = (argv, env = process.env) => {
  console.log(`$ ${argv.map((part) => JSON.stringify(part)).join(' ')}`);
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT,
    env,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === 'string')
    throw new Error('could not reserve a local demo port');
  return address.port;
}

async function main() {
  const envDirectory = mkdtempSync(join(tmpdir(), 'varve-demo-env-'));
  process.on('exit', () => rmSync(envDirectory, { recursive: true, force: true }));
  const envFile = join(envDirectory, 'github-env');
  writeFileSync(envFile, '');
  const expectedSha = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  }).stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) throw new Error('could not resolve exact source SHA');
  const port = await availablePort();
  const suffix = `demo-full-${process.pid}`;
  const baseEnv = {
    ...process.env,
    GITHUB_ENV: envFile,
    VARVE_DEMO_EXPECTED_SHA: expectedSha,
    VARVE_DEMO_DIST_URL: `http://127.0.0.1:${port}`,
    VARVE_DEMO_E2E_OUTPUT_DIR: suffix,
    ANALYTICS_DOMAIN: 'varve.studio',
    VITE_VARVE_ANALYTICS_DOMAIN: 'varve.studio',
  };

  for (const argv of [
    ['pnpm', '--filter', '@varve/website', 'build'],
    ['pnpm', '--filter', '@varve/desktop', 'build:try'],
    [process.execPath, 'scripts/website/stage-demo.mjs'],
    [process.execPath, 'scripts/secret-scan.mjs', '--dir', 'apps/website/dist/try'],
    [process.execPath, 'scripts/website/demo-dist-validation.mjs', 'prepare'],
  ]) {
    const status = run(argv, baseEnv);
    if (status !== 0) throw new Error(`${argv.join(' ')} failed (${status})`);
  }

  const preparedEnv = { ...baseEnv };
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf('=');
    if (separator > 0) preparedEnv[line.slice(0, separator)] = line.slice(separator + 1);
  }

  const reportDir = join('test-results', suffix);
  const listEnv = {
    ...preparedEnv,
    VARVE_CI_PLAYWRIGHT_REPORT: join(reportDir, 'expected-cases.json'),
  };
  const strict = [
    '--workers=1',
    '--retries=0',
    '--update-snapshots=none',
    '--fail-on-flaky-tests',
    '--trace=retain-on-failure',
  ];
  const config = [
    'pnpm',
    'exec',
    'playwright',
    'test',
    '--config',
    'playwright.demo-dist.config.mts',
  ];
  const status = run([...config, '--list', ...strict], listEnv);
  if (status !== 0) throw new Error(`production-demo inventory failed (${status})`);

  const testEnv = {
    ...preparedEnv,
    VARVE_CI_PLAYWRIGHT_REPORT: join(reportDir, 'playwright.json'),
  };
  const testStatus = run([...config, ...strict], testEnv);
  const verifyStatus = run(
    [process.execPath, 'scripts/website/demo-dist-validation.mjs', 'verify-report'],
    testEnv,
  );
  const unchangedStatus = run(
    [process.execPath, 'scripts/website/demo-dist-validation.mjs', 'assert-unchanged'],
    testEnv,
  );
  if (testStatus || verifyStatus || unchangedStatus) process.exitCode = 1;
  else console.log(`Production-demo E2E passed for ${expectedSha}.`);
  rmSync(preparedEnv.VARVE_DEMO_DIST_DIR, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(`Production-demo E2E failed: ${error.message}`);
  process.exitCode = 1;
});
