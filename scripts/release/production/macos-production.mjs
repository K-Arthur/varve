// External XCTest/Accessibility only: no Varve automation plugin, JS or native command stubs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { nativeQuickExportControls } from './native-export-controls.mjs';
import { assertNativePdfArtwork } from './native-pdf.mjs';
import { assertRetainedDocument } from './retained-document.mjs';

const { values: v } = parseArgs({
  options: {
    app: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    version: { type: 'string' },
    schema: { type: 'string' },
    seed: { type: 'boolean', default: false },
    server: { type: 'string', default: 'http://127.0.0.1:4723' },
  },
});
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
for (const key of ['app', 'input', 'out', 'version', 'schema'])
  assert.ok(v[key], `--${key} required`);
const out = resolve(v.out),
  app = resolve(v.app),
  bin = join(app, 'Contents/MacOS/varve-desktop');
const homeRelative = relative(homedir(), out);
assert.ok(
  homeRelative &&
    homeRelative !== '..' &&
    !homeRelative.startsWith('../') &&
    !isAbsolute(homeRelative),
  '--out must be isolated under HOME',
);
mkdirSync(out, { recursive: true });
const rootRequire = createRequire(join(process.cwd(), 'package.json'));
const { remote } = createRequire(rootRequire.resolve('@wdio/cli'))('webdriverio');
const { PNG } = createRequire(join(process.cwd(), 'packages/engine/package.json'))('pngjs');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const sourceBytes = readFileSync(resolve(v.input)),
  original = JSON.parse(sourceBytes);
const input = join(out, 'Published 0.2.1 β.varve');
copyFileSync(resolve(v.input), input);
const savedPath = join(out, 'Migrated save β.varve');
assert.equal(
  execFileSync(
    'plutil',
    ['-extract', 'CFBundleShortVersionString', 'raw', join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  ).trim(),
  v.version,
  'installed bundle version',
);
const bundleId = execFileSync(
  'plutil',
  ['-extract', 'CFBundleIdentifier', 'raw', join(app, 'Contents/Info.plist')],
  { encoding: 'utf8' },
).trim();
assert.equal(bundleId, 'dev.varve.desktop', 'Actual installed bundle profile identity');
assert.match(
  execFileSync('file', ['-b', bin], { encoding: 'utf8' }),
  /arm64/,
  'actual Apple Silicon binary',
);
const server = new URL(v.server);
assert.ok(['127.0.0.1', 'localhost'].includes(server.hostname));
const receipt = {
  kind: 'Actual installed macOS production app via external XCTest/AX and native filesystem',
  passed: false,
  sourceSha: v.seed ? null : (process.env.VARVE_RELEASE_SHA ?? null),
  baselineTag: v.seed ? 'v0.2.1' : null,
  startedAt: new Date().toISOString(),
  app,
  executableSha256: hash(readFileSync(bin)),
  inputSha256: hash(sourceBytes),
  appDataDirectory: join(homedir(), 'Library/Application Support', bundleId),
  profileEvidence:
    'Actual installed CFBundleIdentifier plus native macOS app-data path; parent requires old/new equality',
  expected: { version: v.version, schema: v.schema },
  evidence: [],
};
let driver;
const deadline = Date.now() + 8 * 60_000;
const COMMAND = 1 << 4,
  SHIFT = 1 << 1;
async function until(fn, timeout = 20_000) {
  const end = Math.min(deadline, Date.now() + timeout);
  let last;
  while (Date.now() < end) {
    try {
      const r = await fn();
      if (r) return r;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw last ?? new Error('Bounded native AX condition expired');
}
function literal(s) {
  return JSON.stringify(s);
}
async function hittableElements(predicate, scope = null) {
  const refs = scope
    ? await driver.findElementsFromElement(scope.elementId, 'predicate string', predicate)
    : await driver.findElements('predicate string', predicate);
  const elements = [];
  for (const ref of refs) {
    const element = await driver.$(ref);
    // Mac2 exposes hittable through its attribute endpoint, not as a native
    // XCTest snapshot predicate key path. Keep actual pointer readiness.
    const hittable = await element.getAttribute('hittable');
    if (hittable === true || hittable === 'true') elements.push(element);
  }
  return elements;
}
async function one(name, types, starts = false, scope = null) {
  const op = starts ? 'BEGINSWITH' : '==';
  const names = Array.isArray(name) ? name : [name];
  const named = names
    .map((value) => `(label ${op} ${literal(value)} OR title ${op} ${literal(value)})`)
    .join(' OR ');
  const predicate = `(${named}) AND amType IN {${types.map(literal).join(',')}}`;
  const refs = await hittableElements(predicate, scope);
  assert.equal(
    refs.length,
    1,
    `Exactly one hittable actual AX control: ${name}; got ${refs.length}`,
  );
  return refs[0];
}
const buttons = [
  'XCUIElementTypeButton',
  'XCUIElementTypeMenuItem',
  'XCUIElementTypeRadioButton',
  'XCUIElementTypeTab',
];
async function click(name, starts = false) {
  await (await until(() => one(name, buttons, starts))).click();
}
async function keys(text, modifiers = 0) {
  await driver.execute('macos: keys', { keys: [{ key: text, modifierFlags: modifiers }] });
}
async function panelPath(path, finalButton) {
  // Real native Open/Save sheet; selection is typed through XCTest, not returned by a stub.
  await until(
    async () => (await driver.findElements('class name', 'XCUIElementTypeSheet')).length > 0,
  );
  await keys('g', COMMAND | SHIFT);
  const field = await until(async () => {
    const refs = await hittableElements(
      "amType == 'XCUIElementTypeTextField' AND amHasKeyboardInputFocus == true",
    );
    assert.equal(refs.length, 1, 'One actual focused native Go To Folder field');
    return refs[0];
  });
  await field.click();
  await keys('a', COMMAND);
  await field.setValue(path);
  await keys('XCUIKeyboardKeyReturn');
  await click(finalButton);
  await until(
    async () => (await driver.findElements('class name', 'XCUIElementTypeSheet')).length === 0,
  );
}
function retained(doc) {
  assertRetainedDocument(doc, original, { schema: v.schema, seed: v.seed });
}
async function evidence(name) {
  writeFileSync(join(out, `${name}.xml`), await driver.getPageSource());
  await driver.saveScreenshot(join(out, `${name}.png`));
}
async function launch() {
  driver = await remote({
    hostname: server.hostname,
    port: Number(server.port || 4723),
    path: server.pathname,
    connectionRetryCount: 0,
    connectionRetryTimeout: 180_000,
    logLevel: 'warn',
    capabilities: {
      platformName: 'mac',
      'appium:automationName': 'mac2',
      'appium:bundleId': 'dev.varve.desktop',
      'appium:appPath': app,
      'appium:noReset': true,
      'appium:serverStartupTimeout': 120_000,
      'appium:showServerLogs': true,
    },
  });
  await driver.setTimeout({ implicit: 0 });
  await evidence('native-launch');
  const updateChoice = await hittableElements(
    "amType == 'XCUIElementTypeButton' AND title == 'Not now'",
  );
  assert.ok(updateChoice.length <= 1, 'First-run update choice must be unambiguous');
  if (updateChoice.length) {
    await updateChoice[0].click();
    receipt.evidence.push({ phase: 'actual first-run update choice', choice: 'Not now' });
  }
  // The hosted display is 1024x768; the released app's 1280px default window
  // starts beyond its edges. Use the actual native Window > Fill control.
  await (await until(() => one('Window', ['XCUIElementTypeMenuBarItem']))).click();
  await (await until(() => one('Fill', ['XCUIElementTypeMenuItem']))).click();
  await evidence('native-ready');
}
async function open(path) {
  // Select the actual in-window action once. Application-wide Command-O can
  // also activate a native Open panel, obscuring the webview's native sheet.
  const homeOpen = await hittableElements(
    "amType == 'XCUIElementTypeButton' AND (label == 'Open…' OR title == 'Open…')",
  );
  assert.ok(homeOpen.length <= 1, 'Home Open action must be unambiguous');
  if (homeOpen.length) await homeOpen[0].click();
  else {
    await click('File');
    await click('Open…', true);
  }
  await panelPath(path, 'Open');
  await until(() => one('Fit all to viewport', ['XCUIElementTypeButton']));
}
async function selectImage() {
  const types = [
    'XCUIElementTypeOutlineRow',
    'XCUIElementTypeCell',
    'XCUIElementTypeOther',
    'XCUIElementTypeButton',
  ];
  // No DOM-id assumptions. Missing/ambiguous AX rows fail with retained source.
  const refs = await hittableElements("label BEGINSWITH 'Published embedded image'");
  if (!refs.length) {
    const poster = await one('Poster — A3', types, true);
    const expand = await one('Expand', ['XCUIElementTypeButton'], false, poster);
    await expand.click();
  }
  await (await until(() => one('Published embedded image', types, true))).click();
}
async function diskSave(predicate = () => true) {
  await keys('s', COMMAND);
  return until(() => {
    const d = JSON.parse(readFileSync(savedPath, 'utf8'));
    return predicate(d) && d;
  });
}
async function quit() {
  await (await until(() => one('Varve', ['XCUIElementTypeMenuBarItem']))).click();
  await click('Quit Varve');
  await until(
    async () =>
      (await driver.execute('macos: queryAppState', { bundleId: 'dev.varve.desktop' })) === 1,
  );
  await driver.deleteSession().catch(() => {});
  driver = null;
}
try {
  await launch();
  // Genuine New/Create controls provide UI evidence before opening the migration fixture.
  await click('New');
  await click(['Create', 'Create design']);
  await evidence('native-new');
  const welcome = await hittableElements(
    "amType == 'XCUIElementTypeButton' AND (label == 'Get started' OR title == 'Get started')",
  );
  assert.ok(welcome.length <= 1, 'First-editor welcome control must be unambiguous');
  if (welcome.length) await click('Close dialog');
  await open(input);
  await click('File');
  await click('Save As…', true);
  await panelPath(savedPath, 'Save');
  const first = await until(() => JSON.parse(readFileSync(savedPath, 'utf8')));
  retained(first);
  await selectImage();
  if (!v.seed) {
    const x = await one(
      ['X (px)', 'X (AB) (px)'],
      ['XCUIElementTypeTextField', 'XCUIElementTypeTextView', 'XCUIElementTypeOther'],
    );
    const value = Number(await x.getAttribute('value'));
    assert.ok(Number.isFinite(value));
    await x.click();
    await keys('a', COMMAND);
    await x.setValue(String(value + 1));
    await keys('XCUIKeyboardKeyReturn');
    const changed = await diskSave(
      (d) =>
        d.nodes['published-embedded-image'].transform[4] >
        first.nodes['published-embedded-image'].transform[4],
    );
    receipt.evidence.push({
      phase: 'real Inspector edit saved on disk',
      x: changed.nodes['published-embedded-image'].transform[4],
    });
    await keys('z', COMMAND);
    retained(
      await diskSave(
        (d) =>
          d.nodes['published-embedded-image'].transform[4] ===
          first.nodes['published-embedded-image'].transform[4],
      ),
    );
  }
  await evidence('native-saved');
  await quit();
  await launch();
  await open(savedPath);
  await selectImage();
  if (!v.seed) {
    await click('Export');
    for (const format of ['PNG', 'SVG', 'PDF']) {
      const path = join(out, `native-export.${format.toLowerCase()}`);
      for (const { role, name } of nativeQuickExportControls(format))
        await (
          await until(() =>
            one(name, [role === 'radio' ? 'XCUIElementTypeRadioButton' : 'XCUIElementTypeButton']),
          )
        ).click();
      await panelPath(path, 'Save');
      const bytes = await until(() => {
        const b = readFileSync(path);
        return b.length > 100 && b;
      });
      if (format === 'PNG') {
        const png = PNG.sync.read(bytes),
          source = PNG.sync.read(
            Buffer.from(original.assets['asset-ca2aceaaa125b46e'].dataUrl.split(',')[1], 'base64'),
          );
        assert.deepEqual([png.width, png.height], [104, 80]);
        for (const nx of [0.25, 0.75])
          for (const ny of [0.25, 0.75]) {
            const at = (Math.floor(ny * png.height) * png.width + Math.floor(nx * png.width)) * 4;
            const src =
              (Math.floor(ny * source.height) * source.width + Math.floor(nx * source.width)) * 4;
            assert.deepEqual(png.data.subarray(at, at + 4), source.data.subarray(src, src + 4));
          }
      } else if (format === 'SVG') {
        assert.match(bytes.toString(), /<svg\b/);
        assert.match(bytes.toString(), /data:image\/png;base64,/);
      } else {
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        assert.match(bytes.toString(), /\/Type\s*\/Page\b/);
        assert.match(bytes.toString(), /%%EOF/);
        writeFileSync(
          join(out, 'native-export-pdf-render.png'),
          await assertNativePdfArtwork(
            bytes,
            Buffer.from(original.assets['asset-ca2aceaaa125b46e'].dataUrl.split(',')[1], 'base64'),
          ),
        );
      }
      receipt.evidence.push({
        phase: `actual native ${format} output`,
        path,
        sha256: hash(bytes),
        bytes: bytes.length,
      });
    }
  }
  retained(await diskSave());
  assert.equal(hash(readFileSync(input)), hash(sourceBytes));
  await evidence('native-reopened');
  receipt.evidence.push({
    phase: 'native process restart and disk reopen',
    savedSha256: hash(readFileSync(savedPath)),
  });
  await quit();
  receipt.passed = true;
} catch (error) {
  receipt.error = error.stack ?? String(error);
  process.exitCode = 1;
  if (driver)
    await evidence('native-failure').catch((e) => {
      receipt.evidenceError = String(e);
    });
} finally {
  if (driver) {
    await driver.execute('macos: terminateApp', { bundleId: 'dev.varve.desktop' }).catch(() => {});
    await driver.deleteSession().catch(() => {});
  }
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(join(out, 'qualification.json'), JSON.stringify(receipt, null, 2) + '\n');
}
