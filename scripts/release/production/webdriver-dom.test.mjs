import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { captureDomFailure } from './failure-evidence.mjs';
import { productionDomPage } from './webdriver-dom.mjs';

const { JSDOM } = createRequire(join(process.cwd(), 'packages/editor/package.json'))('jsdom');
const dom = new JSDOM(
  `<div role="treeitem" data-node-id="poster-frame"><button id="poster-expand">Expand</button><span>Poster — A3</span></div><div role="treeitem" aria-label="Other"><button id="other-expand">Expand</button></div><label id="png-label"><input type="radio" aria-label="PNG">PNG</label><button id="hidden" style="display:none">Expand</button>`,
);
for (const element of dom.window.document.querySelectorAll('*'))
  element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 10, height: 10 });
const context = vm.createContext({
  document: dom.window.document,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});
const clicked = [];
const actions = [];
let blocked = false;
let clickError = null;
const driver = {
  execute: async (fn, arg) => vm.runInContext(`(${fn.toString()})`, context)(arg),
  $: async (element) => ({
    scrollIntoView: async () => actions.push('scroll'),
    waitForStable: async () => actions.push('stable'),
    waitForClickable: async () => {
      actions.push('clickable');
      if (blocked) throw new Error('Actual pointer target remains obstructed');
    },
    click: async () => {
      clicked.push(element.id);
      if (clickError) throw clickError;
    },
    isDisplayed: async () => true,
  }),
};
const page = productionDomPage(driver);
await page
  .locator('[role="treeitem"][data-node-id="poster-frame"]')
  .getByRole('button', { name: 'Expand', exact: true })
  .click();
assert.deepEqual(clicked, ['poster-expand'], 'nested lookup retains the actual named parent scope');
assert.deepEqual(
  actions,
  ['scroll', 'stable', 'clickable'],
  'native pointer readiness precedes clicks',
);
await page.getByRole('radio', { name: 'PNG', exact: true }).click();
assert.deepEqual(
  clicked,
  ['poster-expand', 'png-label'],
  'native pointer action targets the radio’s real visible label',
);
await assert.rejects(
  page.getByRole('button', { name: 'Expand', exact: true }).click(),
  /got 2/,
  'ambiguous controls fail instead of choosing a random item',
);
await assert.rejects(
  page.getByRole('button', { name: 'Missing' }).click(),
  /got 0/,
  'missing controls fail instead of silently skipping',
);
blocked = true;
await assert.rejects(
  page.getByRole('radio', { name: 'PNG', exact: true }).click(),
  /pointer target remains obstructed/,
);
assert.deepEqual(clicked, ['poster-expand', 'png-label'], 'a blocked native click is never forced');
blocked = false;
clickError = new Error('WebDriverError: unknown error when running "element/node-123/click"');
await assert.rejects(
  page.getByRole('radio', { name: 'PNG', exact: true }).click(),
  (error) => error === clickError,
  'ordinary native clicks never ignore terminal transport failures',
);
let processExitObserved = false;
assert.equal(
  await page.getByRole('radio', { name: 'PNG', exact: true }).clickAndWaitForExit(async () => {
    processExitObserved = true;
  }),
  clickError.message,
);
assert.equal(processExitObserved, true);

// Failure diagnostics retain the original failure and still collect the DOM if
// the screenshot transport fails. The native session stays open until capture.
const evidence = mkdtempSync(join(tmpdir(), 'varve-native-failure-evidence-'));
try {
  dom.window.document.elementFromPoint = () => dom.window.document.getElementById('png-label');
  const receipt = { passed: false, error: 'original native qualification failure' };
  let screenshotPath;
  await captureDomFailure(
    {
      screenshot: async ({ path }) => {
        screenshotPath = path;
        throw new Error('screenshot transport unavailable');
      },
      evaluate: (fn) => driver.execute(fn),
    },
    evidence,
    receipt,
  );
  assert.equal(screenshotPath, join(evidence, 'native-failure.png'));
  const actual = JSON.parse(readFileSync(join(evidence, 'native-failure-dom.json')));
  const poster = actual.controls.find((item) => item.nodeId === 'poster-frame');
  assert.equal(poster.receivesPointer, false);
  assert.equal(poster.centerHit.text, 'PNG');
  assert.deepEqual(receipt.evidenceErrors, ['screenshot: screenshot transport unavailable']);
  assert.equal(receipt.passed, false);
  assert.equal(receipt.error, 'original native qualification failure');
} finally {
  rmSync(evidence, { recursive: true, force: true });
}
console.log(
  'DOM selector scoping, actual radio label and strict missing/ambiguous lookup assertions passed (no native/browser execution).',
);
