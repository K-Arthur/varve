import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';
import { productionDomPage } from './webdriver-dom.mjs';

const { JSDOM } = createRequire(join(process.cwd(), 'packages/editor/package.json'))('jsdom');
const dom = new JSDOM(
  `<div role="treeitem" aria-label="Poster — A3"><button id="poster-expand">Expand</button></div><div role="treeitem" aria-label="Other"><button id="other-expand">Expand</button></div><label id="png-label"><input type="radio" aria-label="PNG">PNG</label><button id="hidden" style="display:none">Expand</button>`,
);
for (const element of dom.window.document.querySelectorAll('*'))
  element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 10, height: 10 });
const context = vm.createContext({
  document: dom.window.document,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});
const clicked = [];
const driver = {
  execute: async (fn, arg) => vm.runInContext(`(${fn.toString()})`, context)(arg),
  $: async (element) => ({
    click: async () => clicked.push(element.id),
    isDisplayed: async () => true,
  }),
};
const page = productionDomPage(driver);
await page
  .getByRole('treeitem', { name: /^Poster — A3/ })
  .getByRole('button', { name: 'Expand', exact: true })
  .click();
assert.deepEqual(clicked, ['poster-expand'], 'nested lookup retains the actual named parent scope');
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
console.log(
  'DOM selector scoping, actual radio label and strict missing/ambiguous lookup assertions passed (no native/browser execution).',
);
