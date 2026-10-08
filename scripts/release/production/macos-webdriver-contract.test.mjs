/** Real locked WebdriverIO transport against a protocol fixture; no native GUI. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

const owner = createRequire(join(process.cwd(), 'package.json'));
const { remote } = createRequire(owner.resolve('@wdio/cli'))('webdriverio');
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const source = readFileSync(new URL('./macos-production.mjs', import.meta.url), 'utf8');
const helper = source.slice(
  source.indexOf('async function layerLabel('),
  source.indexOf('async function prepareLayerControls('),
);
const requests = [];
const server = createServer(async (request, response) => {
  let value;
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    const path = new URL(request.url, 'http://localhost').pathname;
    requests.push({ method: request.method, path, body });
    if (request.method === 'POST' && path === '/session') {
      value = { sessionId: 'protocol-fixture', capabilities: { platformName: 'mac' } };
    } else if (request.method === 'GET' && path === '/session/protocol-fixture/window') {
      value = 'native-window';
    } else if (request.method === 'POST' && path === '/session/protocol-fixture/elements') {
      assert.equal(body.using, 'xpath');
      assert.match(body.value, /not\(ancestor::XCUIElementTypeGroup/);
      value = [{ [elementKey]: 'layers-outer' }];
    } else if (
      request.method === 'POST' &&
      path === '/session/protocol-fixture/element/layers-outer/elements'
    ) {
      assert.equal(body.using, 'predicate string');
      assert.match(body.value, /value == "Published embedded image"/);
      value = [{ [elementKey]: 'image-label' }];
    } else if (path === '/session/protocol-fixture/element/image-label/attribute/hittable') {
      value = 'true';
    } else {
      assert.equal(request.method, 'DELETE');
      assert.equal(path, '/session/protocol-fixture');
      value = null;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ value }));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ value: { error: 'unknown error', message: String(error) } }));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let driver;
try {
  driver = await remote({
    hostname: '127.0.0.1',
    port: server.address().port,
    path: '/',
    logLevel: 'silent',
    connectionRetryCount: 0,
    connectionRetryTimeout: 5_000,
    capabilities: { platformName: 'mac', 'appium:automationName': 'Mac2' },
  });
  for (const normalize of [true, false]) {
    const context = vm.createContext({ assert, driver, literal: JSON.stringify });
    const code = normalize
      ? helper
      : helper.replace('const tree = await driver.$(ref);', 'const tree = ref;');
    vm.runInContext(`${code}; globalThis.layerLabel = layerLabel;`, context);
    if (normalize) {
      assert.equal((await context.layerLabel('Published embedded image')).elementId, 'image-label');
    } else {
      await assert.rejects(
        context.layerLabel('Published embedded image'),
        /Malformed type for "elementId".*findElementsFromElement/s,
      );
    }
  }
  assert.equal(
    requests.filter((request) => request.path.endsWith('/element/layers-outer/elements')).length,
    1,
    'Only normalized references reach the actual client child-query transport',
  );
  assert.ok(!requests.some((request) => request.path.includes('undefined')));
} finally {
  if (driver) await driver.deleteSession();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  'Locked WebdriverIO accepts normalized W3C references and rejects the observed raw-reference regression; no native GUI execution.',
);
