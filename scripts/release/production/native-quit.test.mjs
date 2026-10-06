import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { clickAndWaitForNativeExit } from './native-quit.mjs';

const terminal = new Error(
  'WebDriverError: unknown error when running "element/node-123/click" with method "POST"',
);
// Observe a real process ending, rather than considering a lost webview proof
// that the application quit. Production uses the exact installed executable.
const child = spawn(process.execPath, ['-e', 'process.stdin.once("data", () => process.exit(0))']);
const exited = once(child, 'exit');
try {
  const response = await clickAndWaitForNativeExit(
    async () => {
      child.stdin.write('quit');
      throw terminal;
    },
    async () => {
      assert.deepEqual(await exited, [0, null]);
    },
  );
  assert.equal(response, terminal.message);
} finally {
  if (child.exitCode === null) child.kill();
}
let observed = false;
assert.equal(
  await clickAndWaitForNativeExit(
    async () => {},
    async () => {
      observed = true;
    },
  ),
  null,
);
assert.equal(observed, true, 'even a successful click requires native exit');
const live = new Error('Installed native executable is still running');
await assert.rejects(
  clickAndWaitForNativeExit(
    async () => {
      throw terminal;
    },
    async () => {
      throw live;
    },
  ),
  (error) => error === live,
  'a lost response with a live process fails',
);
for (const message of [
  'WebDriverError: element click intercepted when running "element/node-123/click"',
  'WebDriverError: unknown error when running "execute/sync"',
  'Expected one visible menuitem; got 0',
  'arbitrary click failure',
]) {
  const original = new Error(message);
  await assert.rejects(
    clickAndWaitForNativeExit(
      async () => {
        throw original;
      },
      async () => {},
    ),
    (error) => error === original,
    'an unrelated failure cannot be accepted as Quit',
  );
}
console.log(
  'Native Quit requires actual process exit; live, obstructed and unrelated errors fail.',
);
