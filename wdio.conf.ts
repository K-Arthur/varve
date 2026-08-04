import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Options } from '@wdio/globals/types';

const binaryName = process.platform === 'win32' ? 'varve-desktop.exe' : 'varve-desktop';
const appBinaryPath = process.env.VARVE_DESKTOP_BINARY
  ? resolve(process.env.VARVE_DESKTOP_BINARY)
  : resolve('apps/desktop/src-tauri/target/debug', binaryName);
const artifactDirectory = resolve('artifacts/desktop');

export const config: Options.Testrunner = {
  runner: 'local',
  autoCompileOpts: {
    tsNodeOpts: {
      project: './tsconfig.json',
    },
  },
  specs: ['./tests/wdio/**/*.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],
  logLevel: 'info',
  services: [
    [
      'tauri',
      {
        appBinaryPath,
        driverProvider: 'embedded',
      },
    ],
  ],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 30000,
  },
  reporters: ['spec'],
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  afterTest: async (_test, _context, { passed }) => {
    if (!passed) {
      mkdirSync(artifactDirectory, { recursive: true });
      await browser.saveScreenshot(join(artifactDirectory, `failed-${Date.now()}.png`));
    }
  },
};
