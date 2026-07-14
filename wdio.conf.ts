import type { Options } from '@wdio/globals/types';

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
      'wdio:tauri:options': {
        appBinaryPath: './apps/desktop/src-tauri/target/debug/strata-desktop',
        driverProvider: 'embedded',
      },
    },
  ],
  logLevel: 'info',
  services: [
    [
      'tauri',
      {
        appBinaryPath: './apps/desktop/src-tauri/target/debug/strata-desktop',
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
};
