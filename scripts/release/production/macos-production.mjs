// External XCTest/Accessibility only: no Varve automation plugin, JS or native command stubs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
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
async function click(name, starts = false, scope = null) {
  const element = await until(() => one(name, buttons, starts, scope));
  await pointerClick(element);
}
async function pointerClick(element) {
  const rect = await driver.getElementRect(element.elementId);
  assert.ok(
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
      rect.width > 0 &&
      rect.height > 0,
    'Actual hittable AX control must have a finite, non-empty pointer target',
  );
  // XCTest's element.click traverses native NSMenus for role=menuitem. The
  // in-window webview menus instead need a real pointer gesture at their AX rect.
  await driver.execute('macos: click', {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  });
}
async function keys(text, modifiers = 0) {
  await driver.execute('macos: keys', { keys: [{ key: text, modifierFlags: modifiers }] });
}
async function filePanels(finalButton) {
  const refs = await driver.findElements(
    'predicate string',
    `amType IN {"XCUIElementTypeSheet","XCUIElementTypeDialog"} AND (identifier == "open-panel" OR identifier == "save-panel" OR title == ${literal(finalButton)})`,
  );
  assert.ok(refs.length <= 1, 'Actual native Open/Save panel must be unambiguous');
  return refs;
}
async function confirmSavedFileReplacement(path) {
  const modal =
    'self::XCUIElementTypeAlert or self::XCUIElementTypeDialog or self::XCUIElementTypeSheet';
  const replace = './/XCUIElementTypeButton[@title="Replace" or @label="Replace"]';
  const refs = await driver.findElements(
    'xpath',
    `//*[${modal}][${replace}][not(.//*[${modal}][${replace}])]`,
  );
  assert.ok(refs.length <= 1, 'Native replacement confirmation must be unambiguous');
  if (!refs.length) return;
  assert.equal(path, savedPath, 'Only this qualification document may be replaced');
  const panel = await driver.$(refs[0]);
  const names = await driver.findElementsFromElement(
    panel.elementId,
    'predicate string',
    `amType IN {"XCUIElementTypeStaticText"} AND (value CONTAINS ${literal(basename(path))} OR title CONTAINS ${literal(basename(path))})`,
  );
  assert.ok(names.length > 0, 'Replacement message must name the actual saved qualification file');
  await click('Replace', false, panel);
}
async function panelPath(path, finalButton) {
  // Cocoa may expose the real Open/Save panel as a dialog or sheet. Retain its
  // native identity and scope the final control to it; never return a picker stub.
  const panel = await until(async () => {
    const refs = await filePanels(finalButton);
    return refs.length === 1 && driver.$(refs[0]);
  });
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
  await click(finalButton, false, panel);
  await until(async () => {
    if (finalButton === 'Save' && path === savedPath) await confirmSavedFileReplacement(path);
    return (await filePanels(finalButton)).length === 0;
  });
}
function retained(doc) {
  assertRetainedDocument(doc, original, { schema: v.schema, seed: v.seed });
}
async function evidence(name) {
  console.log(`Native qualification capture: ${name}`);
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
      // Session disposal must not substitute for the genuine Quit below.
      'appium:skipAppKill': true,
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
async function createDocumentFromHome() {
  await click('New');
  await click(['Create', 'Create design']);
  await evidence('native-new');
  const welcome = await hittableElements(
    "amType == 'XCUIElementTypeButton' AND (label == 'Get started' OR title == 'Get started')",
  );
  assert.ok(welcome.length <= 1, 'First-editor welcome control must be unambiguous');
  if (welcome.length) await click('Close dialog');
}
async function open(path) {
  // Select the actual in-window action once. Application-wide Command-O can
  // also activate a native Open panel, obscuring the webview's native sheet.
  const homeOpen = await hittableElements(
    "amType == 'XCUIElementTypeButton' AND (label == 'Open…' OR title == 'Open…')",
  );
  assert.ok(homeOpen.length <= 1, 'Home Open action must be unambiguous');
  if (homeOpen.length && !v.seed) await pointerClick(homeOpen[0]);
  else {
    // Published 0.2.1 Home expects an object-array dialog result, although the
    // actual native picker returns a path string. Enter its real editor and
    // use File > Open, as in the initial baseline seed. Current 0.5.0 still
    // qualifies its Home action, and both versions must reopen the saved disk
    // file, retain its artwork, and use the same native profile.
    if (homeOpen.length) await createDocumentFromHome();
    await click('File');
    await click('Open…', true);
  }
  await panelPath(path, 'Open');
  await until(() => one('Fit all to viewport', ['XCUIElementTypeButton']));
}
async function layerLabel(name) {
  const trees = await driver.findElements(
    'xpath',
    '//XCUIElementTypeGroup[@label="Layers" or @title="Layers"][not(ancestor::XCUIElementTypeGroup[@label="Layers" or @title="Layers"])]',
  );
  assert.ok(trees.length > 0, 'Actual native Layers tree must exist');
  // WebKit exposes visible layer names as StaticText.value, with empty
  // label/title. Canvas accessibility groups also name nodes, so scope this
  // exact, hittable text lookup to the actual Layers tree.
  // Current WebKit exposes nested groups named Layers. Query only the
  // outermost scopes: pinned Mac2 assigns a fresh UUID on every lookup, so
  // IDs cannot deduplicate repeated queries for the same descendant.
  const labels = [];
  for (const ref of trees) {
    const tree = await driver.$(ref);
    const refs = await driver.findElementsFromElement(
      tree.elementId,
      'predicate string',
      `amType IN {"XCUIElementTypeStaticText"} AND value == ${literal(name)}`,
    );
    labels.push(...refs);
  }
  assert.equal(labels.length, 1, `Exactly one actual native layer label: ${name}`);
  const element = await driver.$(labels[0]);
  const hittable = await element.getAttribute('hittable');
  assert.ok(hittable === true || hittable === 'true', `Hittable native layer label: ${name}`);
  return element;
}
async function prepareLayerControls() {
  if (v.seed) return;
  // The hosted display is short. Use genuine disclosure controls to reveal
  // the Layers list rather than clicking its offscreen AX rectangle.
  for (const name of ['Hide minimap', 'Hide Design Canvases section']) {
    const controls = await hittableElements(
      `amType IN {"XCUIElementTypeButton"} AND (label == ${literal(name)} OR title == ${literal(name)})`,
    );
    assert.ok(controls.length <= 1, `Unambiguous native disclosure: ${name}`);
    if (controls.length) await pointerClick(controls[0]);
  }
}
async function selectImage() {
  await prepareLayerControls();
  await pointerClick(await until(() => layerLabel('Published embedded image')));
}
async function diskSave(predicate = () => true) {
  if (v.seed) await keys('s', COMMAND);
  else {
    // Leave the numeric input through the genuine menu so its edit commits.
    await click('File');
    await click('Save', true);
  }
  if (v.seed) {
    // Published 0.2.1 loses its native save path when reopening. Its actual
    // Save opens Save As; existing disk bytes cannot prove that request ended.
    const panel = await until(async () => {
      const refs = await filePanels('Save');
      return refs.length === 1 && driver.$(refs[0]);
    });
    const names = await hittableElements(
      'amType IN {"XCUIElementTypeTextField"} AND identifier == "saveAsNameTextField"',
      panel,
    );
    assert.equal(names.length, 1, 'One actual native Save As filename');
    assert.ok(
      [basename(savedPath), basename(savedPath, '.varve')].includes(
        await names[0].getAttribute('value'),
      ),
      'Baseline save must belong to the reopened qualification document',
    );
    retained(JSON.parse(readFileSync(savedPath, 'utf8')));
    await evidence('native-baseline-reopened-save');
    await panelPath(savedPath, 'Save');
    receipt.evidence.push({ phase: 'actual baseline reopened save completed', path: savedPath });
  }
  return until(() => {
    const d = JSON.parse(readFileSync(savedPath, 'utf8'));
    return predicate(d) && d;
  });
}
async function editImageCoordinate(expected) {
  const types = [
    'XCUIElementTypeTextField',
    'XCUIElementTypeTextView',
    'XCUIElementTypeStepper',
    'XCUIElementTypeOther',
  ];
  const x = await until(() => one(['X (px)', 'X (AB) (px)'], types));
  const value = Number(await x.getAttribute('value'));
  assert.equal(value, expected, 'Inspector must describe the selected image before editing');
  await pointerClick(x);
  await until(async () => {
    const focused = await hittableElements(
      `amHasKeyboardInputFocus == true AND (label == "X (px)" OR title == "X (px)" OR label == "X (AB) (px)" OR title == "X (AB) (px)")`,
    );
    assert.equal(focused.length, 1, 'The genuine X input must own keyboard focus');
    return focused[0];
  });
  // Cmd+A is Varve's native canvas Select All accelerator. Use native text
  // cursor selection instead, retaining actual XCTest keyboard input.
  await keys('XCUIKeyboardKeyLeftArrow', COMMAND);
  await keys('XCUIKeyboardKeyRightArrow', COMMAND | SHIFT);
  await driver.execute('macos: keys', { keys: [...String(value + 1)] });
  await keys('XCUIKeyboardKeyReturn');
}
async function quit() {
  assert.equal((await filePanels('Save')).length, 0, 'Quit requires no pending native file picker');
  if (v.seed) {
    // Published 0.2.1's AppKit Quit bypasses its termination coordinator.
    // Close the saved window through the actual editor command first, so
    // finalization completes before the remaining native app is quit.
    await click('File');
    await click('Close Window', true);
    await until(
      async () =>
        (await driver.findElements('predicate string', 'amType == "XCUIElementTypeWindow"'))
          .length === 0,
    );
    receipt.evidence.push({ phase: 'actual baseline window close before native Quit' });
  }
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
  await createDocumentFromHome();
  await open(input);
  await click('File');
  await click('Save As…', true);
  await panelPath(savedPath, 'Save');
  const first = await until(() => JSON.parse(readFileSync(savedPath, 'utf8')));
  retained(first);
  await selectImage();
  if (!v.seed) {
    await editImageCoordinate(first.nodes['published-embedded-image'].transform[4]);
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
    const tabs = await hittableElements(
      "amType == 'XCUIElementTypeTab' AND (label == 'Export' OR title == 'Export')",
    );
    assert.ok(tabs.length <= 1, 'Export tab must be unambiguous');
    if (tabs.length) await tabs[0].click();
    else {
      await click('More inspector tabs', true);
      await click('Export');
    }
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
  await quit();
  receipt.evidence.push({
    phase: 'native process restart and disk reopen',
    savedSha256: hash(readFileSync(savedPath)),
  });
  receipt.passed = true;
} catch (error) {
  receipt.error = error.stack ?? String(error);
  console.error(receipt.error);
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
  writeFileSync(join(out, 'qualification.json'), `${JSON.stringify(receipt, null, 2)}\n`);
}
