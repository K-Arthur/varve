import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./windows-production.mjs', import.meta.url), 'utf8');
const helper = source.slice(
  source.indexOf('async function destination('),
  source.indexOf('async function save('),
);
const linux = readFileSync(new URL('./linux-production.mjs', import.meta.url), 'utf8');
assert.equal(
  linux.slice(linux.indexOf('async function destination('), linux.indexOf('async function save(')),
  helper,
  'Both platforms use the reviewed exact adapter',
);
const forwarded = [];
const originalCore = Object.freeze({
  markerExport: 'preserved',
  invoke: async (command, args) => {
    forwarded.push({ command, args });
    return 'native-command-result';
  },
});
const context = { window: { __TAURI__: { core: originalCore } } };
assert.equal(
  Object.isFrozen(originalCore),
  true,
  'Match locked Tauri generated frozen core namespace',
);
context.page = { evaluate: async (fn, value) => fn(value) };
vm.createContext(context);
vm.runInContext(helper + '; globalThis.destination = destination;', context);
await context.destination('C:/qualification/result.varve');
assert.notEqual(
  context.window.__TAURI__.core,
  originalCore,
  'Replace the mutable outer property instead of writing frozen invoke',
);
assert.equal(context.window.__TAURI__.core.markerExport, 'preserved');
assert.equal(
  await context.window.__TAURI__.core.invoke('plugin:dialog|save', {}),
  'C:/qualification/result.varve',
);
assert.equal(forwarded.length, 0, 'only the picker result is supplied');
for (const command of [
  'home_write_text_file_approved',
  'write_binary_file',
  'home_read_text_file_approved',
]) {
  const args = {
    path: 'C:/qualification/result.varve',
    contents: 'genuine contents',
    data: [1, 2, 3],
  };
  assert.equal(await context.window.__TAURI__.core.invoke(command, args), 'native-command-result');
  assert.equal(forwarded.at(-1).command, command);
  assert.equal(forwarded.at(-1).args, args, 'native args forwarded unchanged');
}
await assert.rejects(
  context.window.__TAURI__.core.invoke('plugin:dialog|save', {}),
  /Unexpected save dialog/,
);
await context.destination('C:/qualification/result.png');
await assert.rejects(context.destination('C:/qualification/other.png'), /Previous destination/);
assert.equal(
  await context.window.__TAURI__.core.invoke('plugin:dialog|save', {}),
  'C:/qualification/result.png',
);
console.log(
  'Exact dialog-result adapter passes; native save/read/export commands and arguments remain unchanged.',
);

const immutable = { window: { __TAURI__: Object.freeze({ core: originalCore }) } };
immutable.page = { evaluate: async (fn, value) => fn(value) };
vm.createContext(immutable);
vm.runInContext(helper + '; globalThis.destination = destination;', immutable);
await assert.rejects(
  immutable.destination('unusable.varve'),
  /facade is not replaceable/,
  'An immutable outer seam must fail explicitly, never report a picker no-op',
);
