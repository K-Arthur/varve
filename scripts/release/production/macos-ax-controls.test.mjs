import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(new URL('./macos-production.mjs', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function literal('), source.indexOf('const buttons ='));
let controls = [],
  requests = [];
const attributes = [];
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
      (!parent || c.parent === parent) &&
      named.some((n) =>
        n.starts ? (c[n.field] || '').startsWith(n.value) : c[n.field] === n.value,
      ),
  );
}
const driver = {
  findElements: async (using, predicate) => {
    requests.push({ using, predicate });
    return matches(predicate);
  },
  findElementsFromElement: async (id, using, predicate) => {
    requests.push({ id, using, predicate });
    return matches(predicate, id);
  },
  $: async (ref) => ({
    ...ref,
    getAttribute: async (name) => {
      attributes.push({ id: ref.elementId, name });
      assert.equal(name, 'hittable');
      return ref.hittable;
    },
  }),
};
const context = vm.createContext({ assert, driver });
vm.runInContext(`${helper}; globalThis.one = one;`, context);
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
  source.indexOf('async function selectImage('),
);
vm.runInContext(`${layerHelper}; globalThis.layerLabel = layerLabel;`, context);
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
await assert.rejects(context.layerLabel('Published embedded image'), /hittable native layer label/);
controls[1].hittable = true;
controls.push({ ...controls[1], elementId: 'duplicate-label' });
await assert.rejects(context.layerLabel('Published embedded image'), /hittable native layer label/);
controls = [];
await assert.rejects(context.layerLabel('Published embedded image'), /actual native Layers tree/);
for (const type of ['XCUIElementTypeDialog', 'XCUIElementTypeSheet']) {
  controls = [
    control('', type, { elementId: 'native-open', identifier: 'open-panel', title: 'Open' }),
    control('Open', 'XCUIElementTypeButton'),
    control('New document', 'XCUIElementTypeDialog'),
  ];
  assert.equal((await context.filePanels('Open'))[0].elementId, 'native-open');
}
controls = [control('Save', 'XCUIElementTypeDialog', { identifier: 'save-panel' })];
assert.equal((await context.filePanels('Save')).length, 1);
controls.push(control('Save', 'XCUIElementTypeSheet', { identifier: 'save-panel' }));
await assert.rejects(context.filePanels('Save'), /must be unambiguous/);
controls = [control('New document', 'XCUIElementTypeDialog')];
assert.equal((await context.filePanels('Open')).length, 0);
controls = [];
await assert.rejects(context.one('Save', ['XCUIElementTypeButton']), /got 0/);
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
const quitSource = source.slice(source.indexOf('async function quit('), source.indexOf('\ntry {'));
function quitCase({
  seed = true,
  name = 'Migrated save β',
  fieldCount = 1,
  exits = true,
  delayedReplacement = false,
} = {}) {
  const events = [];
  let saved = false;
  let replaced = !delayedReplacement;
  const context = vm.createContext({
    assert,
    basename,
    savedPath,
    v: { seed },
    receipt: { evidence: [] },
    driver: {
      execute: async () => (saved && exits && replaced ? 1 : 4),
      $: async () => ({ elementId: 'actual-save-panel' }),
      deleteSession: async () => events.push('session-closed'),
    },
    one: async () => ({ click: async () => events.push('app-menu') }),
    click: async (name) => events.push(name),
    filePanels: async () => (saved ? [] : [{ elementId: 'actual-save-panel' }]),
    hittableElements: async (_predicate, panel) => {
      assert.equal(panel.elementId, 'actual-save-panel');
      return Array.from({ length: fieldCount }, () => ({ getAttribute: async () => name }));
    },
    readFileSync: (path) => {
      assert.equal(path, savedPath);
      return '{"retained":true}';
    },
    retained: (document) => {
      assert.equal(document.retained, true);
      events.push('artwork-checked');
    },
    evidence: async (phase) => events.push(phase),
    confirmSavedFileReplacement: async (path) => {
      assert.equal(path, savedPath);
      events.push('owned-replacement-polled');
      replaced = true;
    },
    panelPath: async (path, action) => {
      assert.equal(path, savedPath);
      assert.equal(action, 'Save');
      saved = true;
      events.push('actual-save');
    },
    until: async (condition) => {
      for (let i = 0; i < 4; i++) {
        const result = await condition();
        if (result) return result;
      }
      throw new Error('Native process remains running');
    },
  });
  vm.runInContext(`${quitSource}; globalThis.quit = quit;`, context);
  return { context, events };
}
const savedQuit = quitCase();
await savedQuit.context.quit();
assert.deepEqual(savedQuit.events.slice(-4), [
  'actual-save',
  'artwork-checked',
  'artwork-checked',
  'session-closed',
]);
assert.equal(savedQuit.events.filter((event) => event === 'artwork-checked').length, 3);
const delayedQuit = quitCase({ delayedReplacement: true });
await delayedQuit.context.quit();
assert.ok(delayedQuit.events.includes('owned-replacement-polled'));
assert.equal(delayedQuit.events.at(-1), 'session-closed');
for (const options of [{ name: 'Unrelated document' }, { fieldCount: 2 }]) {
  const refused = quitCase(options);
  await assert.rejects(refused.context.quit(), /reopened qualification document|One actual native/);
  assert.ok(!refused.events.includes('actual-save'));
}
const currentQuit = quitCase({ seed: false });
await assert.rejects(currentQuit.context.quit(), /process remains running/);
assert.ok(
  !currentQuit.events.includes('actual-save'),
  'Current app never receives the historical save-path workaround',
);
const runningQuit = quitCase({ exits: false });
await assert.rejects(runningQuit.context.quit(), /process remains running/);
assert.ok(
  !runningQuit.events.includes('session-closed'),
  'Completing Save cannot stand in for actual process exit',
);

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
