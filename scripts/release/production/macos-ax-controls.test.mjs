import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(new URL('./macos-production.mjs', import.meta.url), 'utf8');
const probeSource = readFileSync(new URL('./macos-ax-probe.mjs', import.meta.url), 'utf8');
const probeWait = probeSource.slice(
  probeSource.indexOf('async function waitForWebviewControls('),
  probeSource.indexOf('\ntry {'),
);
let probeTime = 0;
let probeRequests = 0;
let webviewReady = false;
const probeContext = vm.createContext({
  Date: { now: () => probeTime },
  setTimeout: (resolve, milliseconds) => {
    probeTime += milliseconds;
    resolve();
  },
  driver: {
    findElements: async (using, predicate) => {
      probeRequests++;
      assert.equal(using, 'predicate string');
      assert.match(predicate, /amType == "XCUIElementTypeButton"/);
      assert.match(predicate, /title IN \{"New","Not now"\}/);
      assert.match(predicate, /label IN \{"New","Not now"\}/);
      assert.match(predicate, /amType == "XCUIElementTypeGroup"/);
      assert.match(predicate, /title == "Layers"/);
      assert.doesNotMatch(predicate, /File|MenuBar|MenuItem/);
      return webviewReady && probeRequests > 2 ? [{ elementId: 'home-new' }] : [];
    },
  },
});
vm.runInContext(
  `${probeWait}; globalThis.waitForWebviewControls = waitForWebviewControls;`,
  probeContext,
);
await assert.rejects(
  probeContext.waitForWebviewControls(),
  /webview Home, update-consent or Layers/,
);
assert.equal(probeTime, 20_000, 'Native menus and an empty webview exhaust the bounded probe');
probeTime = 0;
probeRequests = 0;
webviewReady = true;
await probeContext.waitForWebviewControls();
assert.equal(probeRequests, 3, 'The probe waits for genuine rendered webview controls');
assert.equal(probeTime, 500);
const helper = source.slice(source.indexOf('function literal('), source.indexOf('const buttons ='));
let controls = [],
  requests = [];
const attributes = [];
function descendantOf(control, parent) {
  let ancestor = control.parent;
  const seen = new Set();
  while (ancestor && !seen.has(ancestor)) {
    if (ancestor === parent) return true;
    seen.add(ancestor);
    ancestor = controls.find((candidate) => candidate.elementId === ancestor)?.parent;
  }
  return false;
}
function matches(predicate, parent) {
  assert.doesNotMatch(
    predicate,
    /\bamText\b/,
    'Pinned Mac2 amText may crash on native menu snapshots with nil values',
  );
  assert.doesNotMatch(predicate, /\bhittable\b/, 'Mac2 rejects hittable snapshot predicate paths');
  const named = [
    ...predicate.matchAll(
      /\b(label|title|value|identifier|amText) (==|BEGINSWITH) ("(?:[^"\\]|\\.)*")/g,
    ),
  ].map((m) => ({ field: m[1], starts: m[2] === 'BEGINSWITH', value: JSON.parse(m[3]) }));
  const types = JSON.parse(`[${/amType IN \{([^}]*)\}/.exec(predicate)[1]}]`);
  return controls.filter(
    (c) =>
      types.includes(c.amType) &&
      (!parent || descendantOf(c, parent)) &&
      named.some((n) =>
        n.starts ? (c[n.field] || '').startsWith(n.value) : c[n.field] === n.value,
      ),
  );
}
const driver = {
  findElements: async (using, predicate) => {
    requests.push({ using, predicate });
    if (using === 'xpath') {
      assert.equal(
        predicate,
        '//XCUIElementTypeGroup[@label="Layers" or @title="Layers"][not(ancestor::XCUIElementTypeGroup[@label="Layers" or @title="Layers"])]',
      );
      const trees = controls.filter(
        (c) =>
          c.amType === 'XCUIElementTypeGroup' && (c.label === 'Layers' || c.title === 'Layers'),
      );
      return trees
        .filter((c) => !trees.some((outer) => descendantOf(c, outer.elementId)))
        .map(rawReference);
    }
    return matches(predicate).map(rawReference);
  },
  findElementsFromElement: async (id, using, predicate) => {
    assert.equal(typeof id, 'string', 'Native child lookup requires a normalized element ID');
    requests.push({ id, using, predicate });
    return matches(predicate, id).map(rawReference);
  },
  $: async (ref) => {
    const id = ref[webDriverElementKey];
    assert.equal(
      typeof id,
      'string',
      'Protocol lookup returns W3C references, not wrapper elements',
    );
    const actual = controls.find((candidate) => candidate.elementId === id);
    assert.ok(actual);
    return {
      ...actual,
      getAttribute: async (name) => {
        attributes.push({ id, name });
        assert.equal(name, 'hittable');
        return actual.hittable;
      },
    };
  },
};
const webDriverElementKey = 'element-6066-11e4-a52e-4f735466cecf';
function rawReference(control) {
  const reference = { [webDriverElementKey]: control.elementId };
  assert.equal(reference.elementId, undefined);
  return reference;
}
const version = { seed: false };
const context = vm.createContext({ assert, driver, v: version });
vm.runInContext(`${helper}; globalThis.one = one;`, context);
const editHelper = source.slice(
  source.indexOf('async function editImageCoordinate('),
  source.indexOf('async function quit('),
);
let focusedInputs = [{}],
  editedValue = '658';
const editCalls = [];
const editContext = vm.createContext({
  assert,
  COMMAND: 16,
  SHIFT: 2,
  one: async () => ({
    getAttribute: async (name) => {
      assert.equal(name, 'value');
      return editedValue;
    },
  }),
  until: async (fn) => fn(),
  pointerClick: async () => editCalls.push({ pointer: true }),
  hittableElements: async (predicate) => {
    assert.match(predicate, /amHasKeyboardInputFocus == true/);
    return focusedInputs;
  },
  keys: async (key, modifierFlags = 0) => editCalls.push({ key, modifierFlags }),
  driver: { execute: async (command, args) => editCalls.push({ command, ...args }) },
});
vm.runInContext(`${editHelper};globalThis.editImageCoordinate=editImageCoordinate;`, editContext);
await editContext.editImageCoordinate(658);
assert.deepEqual(JSON.parse(JSON.stringify(editCalls)), [
  { pointer: true },
  { key: 'XCUIKeyboardKeyLeftArrow', modifierFlags: 16 },
  { key: 'XCUIKeyboardKeyRightArrow', modifierFlags: 18 },
  { command: 'macos: keys', keys: ['6', '5', '9'] },
  { key: 'XCUIKeyboardKeyReturn', modifierFlags: 0 },
]);
editCalls.length = 0;
editedValue = '0';
await assert.rejects(editContext.editImageCoordinate(658), /selected image/);
assert.deepEqual(JSON.parse(JSON.stringify(editCalls)), [], 'Wrong selection cannot be edited');
editedValue = '658';
for (const inputs of [[], [{}, {}]]) {
  focusedInputs = inputs;
  editCalls.length = 0;
  await assert.rejects(editContext.editImageCoordinate(658), /own keyboard focus/);
  assert.deepEqual(
    JSON.parse(JSON.stringify(editCalls)),
    [{ pointer: true }],
    'Missing or ambiguous focus prevents typing',
  );
}
const saveHelper = source.slice(
  source.indexOf('async function diskSave('),
  source.indexOf('async function editImageCoordinate('),
);
const saveClicks = [];
const saveContext = vm.createContext({
  v: { seed: false },
  click: async (...args) => saveClicks.push(args),
  until: async (fn) => fn(),
  readFileSync: () => '{"saved":true}',
  savedPath: 'actual.varve',
});
vm.runInContext(`${saveHelper};globalThis.diskSave=diskSave;`, saveContext);
await saveContext.diskSave((d) => d.saved);
assert.deepEqual(
  JSON.parse(JSON.stringify(saveClicks)),
  [['File'], [['Save', 'Save ⌘S']]],
  'A genuine menu click commits the numeric edit before saving',
);
// Actual 0.5.0 Mac AX snapshot: run 37715309662, artifact 11523758676.
// native-failure.xml SHA256: 4868ba969e6961db29e808a1c8801b4393b1599c3efa08d05f1458f0b178705f.
// WebKit inserts a space before the shortcut and exposes menu item titles,
// with empty labels. DOM text concatenation is not the native AX contract.
for (const title of ['Save', 'Save ⌘S']) {
  controls = [
    control('', 'XCUIElementTypeMenuItem', { elementId: 'actual-save', title }),
    control('', 'XCUIElementTypeMenuItem', { title: 'Save As… ⌘⇧S' }),
    control('', 'XCUIElementTypeMenuItem', { title: 'Save a Copy…' }),
  ];
  assert.equal(
    (await context.one(saveClicks[1][0], ['XCUIElementTypeMenuItem'])).elementId,
    'actual-save',
  );
  await assert.rejects(context.one('Save', ['XCUIElementTypeMenuItem'], true), /got 3/);
}
await assert.rejects(
  context.one(['Save', 'SaveCtrl+S', 'Save⌘S'], ['XCUIElementTypeMenuItem']),
  /got 0/,
  'The failed release selector must reject the observed native menu fixture',
);
controls.push(control('', 'XCUIElementTypeMenuItem', { title: 'Save ⌘S' }));
await assert.rejects(context.one(saveClicks[1][0], ['XCUIElementTypeMenuItem']), /got 2/);
controls = [control('Save As…', 'XCUIElementTypeButton')];
await assert.rejects(context.one(saveClicks[1][0], ['XCUIElementTypeButton']), /got 0/);

const clickHelper = source.slice(
  source.indexOf('async function click('),
  source.indexOf('async function keys('),
);
let pointerRect = { x: 32, y: 37, width: 33, height: 22 };
const pointerCalls = [];
driver.getElementRect = async (id) => {
  assert.equal(id, 'File');
  return pointerRect;
};
driver.execute = async (command, args) => pointerCalls.push({ command, ...args });
vm.runInContext(
  `const buttons = ['XCUIElementTypeMenuItem']; async function until(fn) { return fn(); }\n${clickHelper}; globalThis.click = click;`,
  context,
);
const panelHelper = source.slice(
  source.indexOf('async function filePanels('),
  source.indexOf('async function panelPath('),
);
vm.runInContext(`${panelHelper}; globalThis.filePanels = filePanels;`, context);
const layerHelper = source.slice(
  source.indexOf('async function layerLabel('),
  source.indexOf('async function diskSave('),
);
vm.runInContext(
  `${layerHelper}; globalThis.layerLabel = layerLabel; globalThis.selectImage = selectImage; globalThis.prepareLayerControls = prepareLayerControls;`,
  context,
);
function control(label, amType = 'XCUIElementTypeButton', other = {}) {
  return { elementId: label, label, amText: label, amType, hittable: true, ...other };
}
// Observed 0.2.1 AX File menu rectangle on the 1024x768 hosted macOS display.
// The native menu traversal endpoint must never be used for this webview control.
controls = [control('File', 'XCUIElementTypeMenuItem')];
await context.click('File');
assert.deepEqual(pointerCalls, [{ command: 'macos: click', x: 48.5, y: 48 }]);
for (const rect of [
  { x: 32, y: 37, width: 0, height: 22 },
  { x: NaN, y: 37, width: 33, height: 22 },
]) {
  pointerRect = rect;
  await assert.rejects(context.click('File'), /non-empty pointer target/);
}
assert.equal(pointerCalls.length, 1, 'Invalid rectangles must not send a pointer gesture');
controls = [];
// Actual 0.2.1 native snapshot from release run 37655874917: visible layer
// text has an empty title/label, while the canvas has similarly named groups.
controls = [
  control('Layers', 'XCUIElementTypeGroup', { elementId: 'layers-tree' }),
  control('', 'XCUIElementTypeStaticText', {
    elementId: 'image-label',
    value: 'Published embedded image',
    parent: 'layers-tree',
  }),
  control('Published embedded image, shape, at (658, 68), 104 x 80', 'XCUIElementTypeGroup'),
  control('', 'XCUIElementTypeStaticText', {
    value: 'Published embedded image',
    parent: 'inspector',
  }),
];
assert.equal((await context.layerLabel('Published embedded image')).elementId, 'image-label');
assert.equal(requests.at(-1).id, 'layers-tree');
controls[1].hittable = false;
await assert.rejects(context.layerLabel('Published embedded image'), /Hittable native layer label/);
controls[1].hittable = true;
controls.push({ ...controls[1], elementId: 'duplicate-label' });
await assert.rejects(context.layerLabel('Published embedded image'), /actual native layer label/);
// Observed current 0.5.0 hosted snapshot: nested Layers groups have the same
// image descendant below the visible sidebar until its disclosures collapse.
controls.pop();
controls.push(
  control('Layers', 'XCUIElementTypeGroup', {
    elementId: 'nested-layers',
    parent: 'layers-tree',
  }),
);
controls[1].parent = 'nested-layers';
const nestedRequestStart = requests.length;
assert.equal((await context.layerLabel('Published embedded image')).elementId, 'image-label');
assert.deepEqual(
  requests
    .slice(nestedRequestStart)
    .filter((request) => request.id)
    .map((request) => request.id),
  ['layers-tree'],
  'One descendant lookup avoids fresh Mac2 UUIDs for repeated queries of the same layer',
);
const rawReferenceContext = vm.createContext({
  assert,
  driver,
  v: version,
  literal: JSON.stringify,
});
vm.runInContext(
  `${layerHelper.replace('const tree = await driver.$(ref);', 'const tree = ref;')}; globalThis.layerLabel = layerLabel;`,
  rawReferenceContext,
);
await assert.rejects(
  rawReferenceContext.layerLabel('Published embedded image'),
  /normalized element ID/,
  'The observed raw-reference regression must fail before any native child request',
);
controls.push(control('Layers', 'XCUIElementTypeGroup', { elementId: 'other-layers' }), {
  ...controls[1],
  elementId: 'other-image',
  parent: 'other-layers',
  hittable: false,
});
await assert.rejects(context.layerLabel('Published embedded image'), /actual native layer label/);
controls.splice(-2);
controls[1].hittable = false;
controls.push(control('Hide minimap'), control('Hide Design Canvases section'));
const originalRect = driver.getElementRect;
const originalExecute = driver.execute;
const disclosures = [];
driver.getElementRect = async (id) => {
  if (id === 'Hide minimap') return { x: 131, y: 200, width: 25, height: 25 };
  if (id === 'Hide Design Canvases section') return { x: 8, y: 378, width: 31, height: 25 };
  assert.equal(id, 'image-label');
  assert.equal(controls[1].hittable, true, 'No offscreen layer pointer gesture');
  return { x: 109, y: 420, width: 22, height: 20 };
};
driver.execute = async (command, args) => {
  assert.equal(command, 'macos: click');
  disclosures.push({ x: args.x, y: args.y });
  if (disclosures.length === 2) controls[1].hittable = true;
};
await context.selectImage();
assert.deepEqual(disclosures, [
  { x: 143.5, y: 212.5 },
  { x: 23.5, y: 390.5 },
  { x: 120, y: 430 },
]);
controls.splice(-2);
await context.prepareLayerControls();
assert.equal(disclosures.length, 3, 'Collapsed sections are never expanded again');
controls.push(
  control('Hide minimap'),
  control('Hide minimap', undefined, { elementId: 'other-hide' }),
);
await assert.rejects(context.prepareLayerControls(), /Unambiguous native disclosure/);
assert.equal(disclosures.length, 3, 'Ambiguous disclosures never send a gesture');
version.seed = true;
await context.prepareLayerControls();
assert.equal(disclosures.length, 3, 'Historical app gets no current layout workaround');
version.seed = false;
driver.getElementRect = originalRect;
driver.execute = originalExecute;
controls = [];
await assert.rejects(context.layerLabel('Published embedded image'), /Actual native Layers tree/);
for (const type of ['XCUIElementTypeDialog', 'XCUIElementTypeSheet']) {
  controls = [
    control('', type, { elementId: 'native-open', identifier: 'open-panel', title: 'Open' }),
    control('Open', 'XCUIElementTypeButton'),
    control('New document', 'XCUIElementTypeDialog'),
  ];
  assert.equal((await context.filePanels('Open'))[0][webDriverElementKey], 'native-open');
}
controls = [control('Save', 'XCUIElementTypeDialog', { identifier: 'save-panel' })];
assert.equal((await context.filePanels('Save')).length, 1);
controls.push(control('Save', 'XCUIElementTypeSheet', { identifier: 'save-panel' }));
await assert.rejects(context.filePanels('Save'), /must be unambiguous/);
controls = [control('New document', 'XCUIElementTypeDialog')];
assert.equal((await context.filePanels('Open')).length, 0);
controls = [];
await assert.rejects(context.one('Save', ['XCUIElementTypeButton']), /got 0/);
// Observed hosted 0.2.1 snapshot: webview menu items include their shortcut
// in title; the exact native AppKit entry is hidden with a zero-size rect.
controls = [
  control('', 'XCUIElementTypeMenuItem', {
    elementId: 'webview-close-window',
    title: 'Close Window ⌘⇧W',
  }),
  control('', 'XCUIElementTypeMenuItem', {
    elementId: 'hidden-appkit-close',
    title: 'Close Window',
    hittable: false,
  }),
];
assert.equal(
  (await context.one('Close Window', ['XCUIElementTypeMenuItem'], true)).elementId,
  'webview-close-window',
);
await assert.rejects(context.one('Close Window', ['XCUIElementTypeMenuItem']), /got 0/);
controls = [control('Save'), control('Save', 'XCUIElementTypeButton', { elementId: 'duplicate' })];
await assert.rejects(context.one('Save', ['XCUIElementTypeButton']), /got 2/);
controls = [control('Save "As"')];
assert.equal((await context.one('Save "As"', ['XCUIElementTypeButton'])).elementId, 'Save "As"');
assert.doesNotMatch(requests.at(-1).predicate, /hittable/);
assert.equal(
  attributes.at(-1).name,
  'hittable',
  'real native attribute determines pointer readiness',
);
controls = [
  control('Expand', 'XCUIElementTypeButton', { parent: 'actual-poster-row' }),
  control('Expand', 'XCUIElementTypeButton', { parent: 'other-row' }),
];
await context.one('Expand', ['XCUIElementTypeButton'], false, { elementId: 'actual-poster-row' });
assert.equal(requests.at(-1).id, 'actual-poster-row');
assert.equal(requests.at(-1).using, 'predicate string');
const names = ['X (px)', 'X (AB) (px)'],
  fields = ['XCUIElementTypeTextField', 'XCUIElementTypeStepper'];
for (const name of names) {
  controls = [
    control(name, fields[0]),
    control('X', fields[0]),
    control('Y (px)', fields[0]),
    control(name, 'XCUIElementTypeButton'),
  ];
  assert.equal(
    (await context.one(names, fields)).elementId,
    name,
    'Exact canonical coordinate field, not another axis/type',
  );
}
controls = [control('X (px)', 'XCUIElementTypeStepper', { value: '658' })];
assert.equal((await context.one(names, fields)).amType, 'XCUIElementTypeStepper');
controls = [
  control('X (ab) (px)', fields[0]),
  control('X', fields[0]),
  control('X (AB) (px)', fields[0], { hittable: false }),
];
await assert.rejects(
  context.one(names, fields),
  /got 0/,
  'Wrong case, missing units and hidden controls are rejected',
);
controls = names.map((name) => control(name, fields[0]));
await assert.rejects(
  context.one(names, fields),
  /got 2/,
  'Two canonical controls still fail ambiguity',
);
for (const name of ['Create', 'Create design']) {
  controls = [control(name), control('Create presentation')];
  assert.equal(
    (await context.one(['Create', 'Create design'], ['XCUIElementTypeButton'])).elementId,
    name,
  );
}
controls = [control('Save', 'XCUIElementTypeButton', { hittable: 'false' })];
await assert.rejects(context.one('Save', ['XCUIElementTypeButton']), /got 0/);
controls = [control('Save', 'XCUIElementTypeButton', { hittable: 'true' })];
assert.equal((await context.one('Save', ['XCUIElementTypeButton'])).elementId, 'Save');
controls = [
  control('', 'XCUIElementTypeMenuBarItem', {
    elementId: 'native-window',
    title: 'Window',
    value: null,
  }),
];
assert.equal(
  (await context.one('Window', ['XCUIElementTypeMenuBarItem'])).elementId,
  'native-window',
);
assert.doesNotMatch(
  requests.at(-1).predicate,
  /amText/,
  'native nil-valued menu snapshots use actual label/title',
);
controls = [control('SVG', 'XCUIElementTypeRadioButton'), control('SVG', 'XCUIElementTypeButton')];
await assert.rejects(
  context.one('SVG', ['XCUIElementTypeRadioButton', 'XCUIElementTypeButton']),
  /got 2/,
  'format radio and Add Configuration button share a name',
);
assert.equal(
  (await context.one('SVG', ['XCUIElementTypeRadioButton'])).amType,
  'XCUIElementTypeRadioButton',
);
assert.match(source, /role === 'radio' \? 'XCUIElementTypeRadioButton' : 'XCUIElementTypeButton'/);
const openAction = source.slice(
  source.indexOf('async function open('),
  source.indexOf('async function selectImage('),
);
assert.doesNotMatch(
  openAction,
  /keys\('o'/,
  'Open is selected once through the actual home or in-window menu action',
);
assert.match(openAction, /homeOpen.length && !v.seed/);
assert.match(openAction, /pointerClick\(homeOpen\[0\]\)/);
assert.match(openAction, /await click\('File'\);\s+await click\('Open…', true\)/);
const openHelper = source.slice(
  source.indexOf('async function open('),
  source.indexOf('async function layerLabel('),
);
const homeControls = [{ elementId: 'home-open' }];
const openCalls = [];
const openContext = vm.createContext({
  assert,
  v: { seed: false },
  hittableElements: async () => homeControls,
  pointerClick: async (element) => openCalls.push(['pointer', element.elementId]),
  createDocumentFromHome: async () => openCalls.push(['new-editor']),
  click: async (...args) => openCalls.push(['click', ...args]),
  panelPath: async (...args) => openCalls.push(['native-panel', ...args]),
  until: async (fn) => fn(),
  one: async (...args) => openCalls.push(['ready', ...args]),
});
vm.runInContext(`${openHelper}; globalThis.open = open;`, openContext);
await openContext.open('/actual/Migrated save β.varve');
assert.deepEqual(openCalls.slice(0, 2), [
  ['pointer', 'home-open'],
  ['native-panel', '/actual/Migrated save β.varve', 'Open'],
]);
openCalls.length = 0;
openContext.v.seed = true;
await openContext.open('/actual/Migrated save β.varve');
assert.deepEqual(openCalls.slice(0, 4), [
  ['new-editor'],
  ['click', 'File'],
  ['click', 'Open…', true],
  ['native-panel', '/actual/Migrated save β.varve', 'Open'],
]);
assert.equal(openCalls.at(-1)[1], 'Fit all to viewport');
homeControls.push({ elementId: 'duplicate-open' });
openCalls.length = 0;
await assert.rejects(openContext.open('/actual/file.varve'), /must be unambiguous/);
assert.equal(openCalls.length, 0, 'Ambiguous Home controls never trigger a native open');
assert.doesNotMatch(
  source,
  /keys\('s', COMMAND \| SHIFT\)/,
  'Save As also selects its actual action once',
);
assert.match(source, /await click\('File'\);\s+await click\('Save As…', true\)/);
assert.match(source, /await click\('More inspector tabs', true\);\s+await click\('Export'\)/);
assert.match(
  source,
  /pointerClick\(await until\(\(\) => layerLabel\('Published embedded image'\)\)\)/,
);
assert.match(
  source,
  /driver\.execute\('macos: keys', \{ keys: \[\.\.\.String\(value \+ 1\)\] \}\)/,
);
assert.doesNotMatch(source, /x\.setValue\(/, 'Native Stepper editing uses physical keys');
assert.doesNotMatch(source, /AND hittable == true/);
assert.match(source, /title == 'Not now'/, 'actual first-run update dialog has an explicit choice');
assert.match(
  source,
  /label == 'Get started' OR title == 'Get started'/,
  'first-editor welcome uses its actual visible control',
);
assert.match(source, /one\('Window', \['XCUIElementTypeMenuBarItem'\]\)/);
assert.match(source, /one\('Fill', \['XCUIElementTypeMenuItem'\]\)/);
assert.match(source, /await keys\('z', COMMAND\)/);
const savedPath = '/actual/Migrated save β.varve';
const saveSource = source.slice(
  source.indexOf('async function diskSave('),
  source.indexOf('async function quit('),
);
const quitSource = source.slice(source.indexOf('async function quit('), source.indexOf('\ntry {'));
function saveQuitCase({
  seed = true,
  name = 'Migrated save β',
  fieldCount = 1,
  exits = true,
  obstructed = false,
  saveFails = false,
  closesWindow = true,
} = {}) {
  const events = [];
  let picker = false;
  let saved = false;
  let requestedQuit = false;
  let windowClosed = false;
  const context = vm.createContext({
    assert,
    basename,
    savedPath,
    COMMAND: 16,
    v: { seed },
    receipt: { evidence: [] },
    driver: {
      findElements: async (using, predicate) => {
        assert.equal(using, 'predicate string');
        assert.equal(predicate, 'amType == "XCUIElementTypeWindow"');
        events.push('window-state-checked');
        return windowClosed ? [] : [{ elementId: 'still-open-window' }];
      },
      execute: async () => (requestedQuit && exits ? 1 : 4),
      $: async () => ({ elementId: 'actual-save-panel' }),
      deleteSession: async () => events.push('session-closed'),
    },
    keys: async (key) => {
      assert.equal(key, 's');
      events.push('save-requested');
      picker = seed;
    },
    one: async () => ({ click: async () => events.push('app-menu') }),
    click: async (name, starts = false) => {
      if (Array.isArray(name)) {
        assert.deepEqual(JSON.parse(JSON.stringify(name)), ['Save', 'Save ⌘S']);
        name = 'Save';
      }
      assert.ok(['File', 'Save', 'Close Window', 'Quit Varve'].includes(name));
      if (name === 'Save') {
        assert.equal(seed, false);
        assert.equal(starts, false);
        saved = true;
      }
      if (name === 'Close Window') {
        assert.equal(starts, true, 'Historical webview title includes its shortcut');
        windowClosed = closesWindow;
      }
      if (name === 'Quit Varve') requestedQuit = true;
      events.push(name);
    },
    filePanels: async () => (picker || obstructed ? [{ elementId: 'actual-save-panel' }] : []),
    hittableElements: async (_predicate, panel) => {
      assert.equal(panel.elementId, 'actual-save-panel');
      return Array.from({ length: fieldCount }, () => ({ getAttribute: async () => name }));
    },
    // A preexisting valid file deliberately exists before this Save request.
    readFileSync: (path) => {
      assert.equal(path, savedPath);
      events.push(saved ? 'new-file-read' : 'old-file-read');
      return '{"retained":true}';
    },
    retained: (document) => assert.equal(document.retained, true),
    evidence: async (phase) => events.push(phase),
    panelPath: async (path, action) => {
      assert.equal(path, savedPath);
      assert.equal(action, 'Save');
      assert.ok(!requestedQuit, 'Complete the native Save before requesting Quit');
      if (saveFails) throw new Error('Native save failed');
      // Simulate a slow native Save As/Replace, independent of discovery/exit.
      await new Promise((resolve) => setTimeout(resolve, 1));
      picker = false;
      saved = true;
      events.push('actual-save-completed');
    },
    until: async (condition) => {
      for (let i = 0; i < 4; i++) {
        const result = await condition();
        if (result) return result;
      }
      throw new Error('Native process remains running');
    },
  });
  vm.runInContext(
    `${saveSource}; ${quitSource}; globalThis.diskSave = diskSave; globalThis.quit = quit;`,
    context,
  );
  return { context, events };
}
const savedQuit = saveQuitCase();
await savedQuit.context.diskSave();
assert.equal(
  savedQuit.events.at(-1),
  'new-file-read',
  'Existing bytes cannot complete a pending Save',
);
await savedQuit.context.quit();
assert.ok(
  savedQuit.events.indexOf('actual-save-completed') < savedQuit.events.indexOf('Quit Varve'),
);
assert.equal(savedQuit.events.filter((event) => event === 'Quit Varve').length, 1);
assert.equal(savedQuit.events.at(-1), 'session-closed');
assert.ok(savedQuit.events.indexOf('Close Window') < savedQuit.events.indexOf('app-menu'));
assert.ok(
  savedQuit.events.indexOf('window-state-checked') < savedQuit.events.indexOf('Quit Varve'),
);
const blockedClose = saveQuitCase({ closesWindow: false });
await blockedClose.context.diskSave();
await assert.rejects(blockedClose.context.quit(), /process remains running/);
assert.ok(
  !blockedClose.events.includes('Quit Varve'),
  'Incomplete baseline finalization cannot become Quit',
);
for (const options of [{ name: 'Unrelated document' }, { fieldCount: 2 }, { saveFails: true }]) {
  const refused = saveQuitCase(options);
  await assert.rejects(
    refused.context.diskSave(),
    /reopened qualification document|One actual native|Native save failed/,
  );
  assert.ok(!refused.events.includes('Quit Varve'));
}
const currentQuit = saveQuitCase({ seed: false });
await currentQuit.context.diskSave();
await currentQuit.context.quit();
assert.ok(
  !currentQuit.events.includes('actual-save-completed'),
  'Current app gets no historical Save As workaround',
);
assert.ok(
  !currentQuit.events.includes('Close Window'),
  'Current standard Quit has no historical close workaround',
);
for (const seed of [true, false]) {
  const obstructedQuit = saveQuitCase({ seed, obstructed: true });
  await assert.rejects(obstructedQuit.context.quit(), /no pending native file picker/);
  assert.ok(!obstructedQuit.events.includes('Quit Varve'));
  const runningQuit = saveQuitCase({ seed, exits: false });
  await runningQuit.context.diskSave();
  await assert.rejects(runningQuit.context.quit(), /process remains running/);
  assert.ok(
    !runningQuit.events.includes('session-closed'),
    'Saved bytes cannot stand in for actual exit',
  );
}

const replacementSource = source.slice(
  source.indexOf('async function confirmSavedFileReplacement('),
  source.indexOf('async function panelPath('),
);
function replacementCase({ count = 1, messageCount = 1 } = {}) {
  const calls = [];
  const context = vm.createContext({
    assert,
    basename,
    savedPath,
    literal: JSON.stringify,
    driver: {
      findElements: async (using, xpath) => {
        assert.equal(using, 'xpath');
        assert.match(xpath, /not\(\.\/\/\*/);
        return Array.from({ length: count }, () => ({ elementId: 'replace-leaf' }));
      },
      $: async (element) => element,
      findElementsFromElement: async (id, using, predicate) => {
        assert.equal(id, 'replace-leaf');
        assert.equal(using, 'predicate string');
        assert.ok(predicate.includes('Migrated save β.varve'));
        assert.doesNotMatch(predicate, /amText/);
        return Array.from({ length: messageCount }, () => ({}));
      },
    },
    click: async (name, starts, panel) => calls.push({ name, starts, id: panel.elementId }),
  });
  vm.runInContext(
    `${replacementSource}; globalThis.replace = confirmSavedFileReplacement;`,
    context,
  );
  return { context, calls };
}
const matchingReplacement = replacementCase();
await matchingReplacement.context.replace(savedPath);
assert.deepEqual(matchingReplacement.calls, [
  { name: 'Replace', starts: false, id: 'replace-leaf' },
]);
for (const options of [{ count: 2 }, { messageCount: 0 }]) {
  const refused = replacementCase(options);
  await assert.rejects(
    refused.context.replace(savedPath),
    /unambiguous|actual saved qualification file/,
  );
  assert.equal(refused.calls.length, 0);
}
const otherFile = replacementCase();
await assert.rejects(
  otherFile.context.replace('/actual/other.varve'),
  /Only this qualification document/,
);
assert.equal(otherFile.calls.length, 0);
assert.ok(
  source.lastIndexOf('await quit();') <
    source.indexOf("phase: 'native process restart and disk reopen'"),
  'Receipt hashes the final disk bytes after the actual process exits, including baseline Save As',
);
console.log(
  'External AX exact canonical X/AB and Create controls pass strict missing/wrong/ambiguous/type/parent/literal guards; no macOS execution claimed.',
);
if (['darwin', 'linux'].includes(process.platform))
  execFileSync(
    'python3',
    [fileURLToPath(new URL('./test_macos_profile_snapshot.py', import.meta.url))],
    {
      stdio: 'inherit',
    },
  );
await import('./macos-webdriver-contract.test.mjs');
