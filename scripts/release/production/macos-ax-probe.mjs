// External capability probe; the separate production flow qualifies functionality.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    out: { type: 'string' },
    server: { type: 'string', default: 'http://127.0.0.1:4723' },
  },
});
assert.equal(process.platform, 'darwin', 'This probe requires the native macOS target');
assert.equal(process.arch, 'arm64', 'This release qualifies Apple Silicon');
assert.ok(values.app && values.out, '--app and --out are required');
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const require = createRequire(join(process.cwd(), 'package.json'));
const { remote } = createRequire(require.resolve('@wdio/cli'))('webdriverio');
const url = new URL(values.server);
assert.ok(
  ['127.0.0.1', 'localhost'].includes(url.hostname),
  'Use the native runner local Appium server',
);
const receipt = {
  kind: 'External XCTest/AX capability probe against installed production bundle',
  passed: false,
  app: resolve(values.app),
  limitation: 'Not save/reopen/export/upgrade certification',
  startedAt: new Date().toISOString(),
};
let driver;
try {
  driver = await remote({
    hostname: url.hostname,
    port: Number(url.port || 4723),
    path: url.pathname,
    connectionRetryCount: 0,
    connectionRetryTimeout: 30_000,
    logLevel: 'warn',
    capabilities: {
      platformName: 'mac',
      'appium:automationName': 'mac2',
      'appium:bundleId': 'dev.varve.desktop',
      'appium:appPath': resolve(values.app),
      'appium:noReset': true,
      'appium:serverStartupTimeout': 60_000,
    },
  });
  const source = await driver.getPageSource();
  writeFileSync(join(out, 'actual-production-ax.xml'), source);
  assert.match(
    source,
    /New|File|Layers/,
    'Actual webview UI semantics must be exposed, not just a live process',
  );
  await driver.saveScreenshot(join(out, 'actual-production-ax.png'));
  receipt.passed = true;
} catch (error) {
  receipt.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (driver) await driver.deleteSession().catch(() => {});
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(join(out, 'ax-probe.json'), JSON.stringify(receipt, null, 2) + '\n');
}
