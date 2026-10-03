import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./macos-production.mjs', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function literal('), source.indexOf('const buttons ='));
let controls = [],
  requests = [];
function matches(predicate, parent) {
  const named = [
    ...predicate.matchAll(/\b(label|title|amText) (==|BEGINSWITH) ("(?:[^"\\]|\\.)*")/g),
  ].map((m) => ({ field: m[1], starts: m[2] === 'BEGINSWITH', value: JSON.parse(m[3]) }));
  const types = JSON.parse(`[${/amType IN \{([^}]*)\}/.exec(predicate)[1]}]`);
  return controls.filter(
    (c) =>
      c.hittable &&
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
  $: async (ref) => ref,
};
const context = vm.createContext({ assert, driver });
vm.runInContext(helper + '; globalThis.one = one;', context);
function control(label, amType = 'XCUIElementTypeButton', other = {}) {
  return { elementId: label, label, amText: label, amType, hittable: true, ...other };
}
await assert.rejects(context.one('Save', ['XCUIElementTypeButton']), /got 0/);
controls = [control('Save'), control('Save', 'XCUIElementTypeButton', { elementId: 'duplicate' })];
await assert.rejects(context.one('Save', ['XCUIElementTypeButton']), /got 2/);
controls = [control('Save "As"')];
assert.equal((await context.one('Save "As"', ['XCUIElementTypeButton'])).elementId, 'Save "As"');
assert.match(requests.at(-1).predicate, /hittable == true/);
controls = [
  control('Expand', 'XCUIElementTypeButton', { parent: 'actual-poster-row' }),
  control('Expand', 'XCUIElementTypeButton', { parent: 'other-row' }),
];
await context.one('Expand', ['XCUIElementTypeButton'], false, { elementId: 'actual-poster-row' });
assert.equal(requests.at(-1).id, 'actual-poster-row');
assert.equal(requests.at(-1).using, 'predicate string');
const names = ['X (px)', 'X (AB) (px)'],
  fields = ['XCUIElementTypeTextField'];
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
console.log(
  'External AX exact canonical X/AB and Create controls pass strict missing/wrong/ambiguous/type/parent/literal guards; no macOS execution claimed.',
);
