import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

// Extract the actual adapter's launch configuration, then send it through the
// frozen WebdriverIO transport. A local protocol endpoint never launches an app.
const linux = readFileSync(new URL('./linux-production.mjs', import.meta.url), 'utf8');
let options;
const context = {
  assert,
  exe: '/usr/bin/varve-desktop',
  matchingProcesses: () => [],
  v: { port: '4444' },
  remote: async (value) => {
    options = value;
    throw new Error('captured native session configuration');
  },
};
vm.createContext(context);
vm.runInContext(
  linux.slice(
    linux.indexOf('async function launch('),
    linux.indexOf('async function selectImage('),
  ) + ';globalThis.launch=launch;',
  context,
);
await assert.rejects(context.launch('/home/runner/Published β.varve'), /captured native session/);
assert.equal(options.connectionRetryCount, 0);
const require = createRequire(join(process.cwd(), 'package.json'));
const { remote } = createRequire(require.resolve('@wdio/cli'))('webdriverio');
let request;
const server = createServer(async (req, res) => {
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/session');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  request = JSON.parse(Buffer.concat(chunks));
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({ value: { error: 'session not created', message: 'captured protocol' } }),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  await assert.rejects(
    remote({ ...options, port: server.address().port, logLevel: 'silent' }),
    /captured protocol/,
  );
  assert.equal(request.capabilities.alwaysMatch.browserName, undefined);
  assert.equal(request.capabilities.alwaysMatch['tauri:options'].application, context.exe);
  assert.deepEqual(request.capabilities.alwaysMatch['tauri:options'].args, [
    '/home/runner/Published β.varve',
  ]);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
const windows = readFileSync(new URL('./windows-session.ps1', import.meta.url), 'utf8');
assert.match(windows, /RUNNER_ENVIRONMENT -ne 'github-hosted'/);
assert.match(windows, /RegistryHive\]::LocalMachine/);
assert.match(windows, /RegistryView\]::Registry64/);
assert.match(windows, /\$name = 'varve-desktop\.exe'/);
assert.doesNotMatch(windows, /\$name = '\*'|--remote-allow-origins|disable-web-security/);
assert.match(windows, /UserDataFolder = .*Join-Path \$Profile 'WebView2'/);
assert.match(windows, /--remote-debugging-address=127\.0\.0\.1 --remote-debugging-port=19227/);
assert.match(windows, /GetValueKind\(\$name\)/);
assert.match(
  windows,
  /finally \{[\s\S]*if \(\$change.Exists\) \{ \$key.SetValue\(\$name, \$change.Value, \$change.Kind\) \}/,
);
assert.match(windows, /\$key.DeleteValue\(\$name, \$false\)/);
assert.match(windows, /if \(\$LASTEXITCODE -ne 0\) \{ throw/);
for (const name of ['linux', 'macos']) {
  const session = readFileSync(new URL(`./${name}-session.sh`, import.meta.url), 'utf8');
  assert.match(session, /BASH_SOURCE\[0\]/);
  assert.match(session, new RegExp(`node "\\$SESSION_DIR/${name}-production\\.mjs"`));
}
console.log(
  'Actual native session transport, isolated hosted Windows policy and restoration contracts passed.',
);

// Capture both actual Mac2 launch paths: transport must allow the bounded
// native XCTest startup to finish, without another session attempt.
for (const name of ['macos-production', 'macos-ax-probe']) {
  const source = readFileSync(new URL(`./${name}.mjs`, import.meta.url), 'utf8');
  const start = source.indexOf('driver = await remote({');
  const end = source.indexOf('\n  });', start) + '\n  });'.length;
  let captured;
  const macContext = vm.createContext({
    driver: null,
    server: new URL('http://127.0.0.1:4723'),
    url: new URL('http://127.0.0.1:4723'),
    app: '/Applications/Varve.app',
    values: { app: '/Applications/Varve.app' },
    resolve: (value) => value,
    remote: async (options) => {
      captured = options;
      throw new Error('captured actual Mac2 session');
    },
  });
  await assert.rejects(
    vm.runInContext(`(async () => { ${source.slice(start, end)} })()`, macContext),
    /captured actual Mac2 session/,
  );
  assert.equal(captured.connectionRetryCount, 0);
  const startup = captured.capabilities['appium:serverStartupTimeout'];
  assert.ok(startup >= 120_000 && startup <= 240_000);
  assert.ok(captured.connectionRetryTimeout >= startup + 30_000);
  assert.ok(captured.connectionRetryTimeout <= 300_000);
  assert.equal(captured.capabilities['appium:showServerLogs'], true);
  assert.equal(captured.hostname, '127.0.0.1');
  assert.equal(captured.capabilities['appium:appPath'], '/Applications/Varve.app');
  assert.equal(captured.capabilities['appium:noReset'], true);
  assert.equal(
    captured.capabilities['appium:skipAppKill'],
    true,
    'Session deletion must preserve the probe handoff and never stand in for real Quit',
  );
}
console.log(
  'Both actual Mac2 clients retain zero retries, bounded driver startup and XCTest logs.',
);
