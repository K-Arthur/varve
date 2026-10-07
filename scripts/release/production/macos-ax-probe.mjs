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
async function waitForWebviewControls() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const controls = await driver.findElements(
      'predicate string',
      '(amType == "XCUIElementTypeButton" AND (title IN {"New","Not now"} OR label IN {"New","Not now"})) OR (amType == "XCUIElementTypeGroup" AND (title == "Layers" OR label == "Layers"))',
    );
    if (controls.length) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Actual webview Home, update-consent or Layers controls never became available');
}
try {
  driver = await remote({
    hostname: url.hostname,
    port: Number(url.port || 4723),
    path: url.pathname,
    connectionRetryCount: 0,
    connectionRetryTimeout: 180_000,
    logLevel: 'warn',
    capabilities: {
      platformName: 'mac',
      'appium:automationName': 'mac2',
      'appium:bundleId': 'dev.varve.desktop',
      'appium:appPath': resolve(values.app),
      'appium:noReset': true,
      // noReset controls session startup; skipAppKill controls deletion.
      // The following production session must attach to this same live app.
      'appium:skipAppKill': true,
      'appium:serverStartupTimeout': 120_000,
      'appium:showServerLogs': true,
    },
  });
  await waitForWebviewControls();
  receipt.passed = true;
} catch (error) {
  receipt.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (driver) {
    await driver
      .getPageSource()
      .then((source) => writeFileSync(join(out, 'actual-production-ax.xml'), source))
      .catch(() => {});
    await driver.saveScreenshot(join(out, 'actual-production-ax.png')).catch(() => {});
    await driver.deleteSession().catch(() => {});
  }
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(join(out, 'ax-probe.json'), JSON.stringify(receipt, null, 2) + '\n');
}
