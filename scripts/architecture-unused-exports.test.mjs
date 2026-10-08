import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  parseUnusedExports,
  runUnusedExportCommand,
  unusedExportArgv,
} from './architecture-unused-exports.mjs';

test('normal analyzer findings cannot become a false clean result', () => {
  const line = 'packages/platform/src/index.ts:15 - AssetEmbeddingDtype';
  // Negative control: the previous parser required two spaces after the dash.
  assert.equal(/^(.+?\.(?:ts|tsx)):\d+(?::| - ) (.+)$/.test(line), false);
  assert.deepEqual(parseUnusedExports(line), [
    { file: 'packages/platform/src/index.ts', symbol: 'AssetEmbeddingDtype' },
  ]);
});

test('parser retains POSIX, Windows, TSX, local-use and missing-position records', () => {
  assert.deepEqual(
    parseUnusedExports(
      [
        '/space path/view.tsx:12: View',
        'C:\\Project name\\view.ts:9 - model (used in module)',
        'src/barrel.ts:undefined - ExportedType',
        '',
      ].join('\r\n'),
    ),
    [
      { file: '/space path/view.tsx', symbol: 'View' },
      { file: 'C:\\Project name\\view.ts', symbol: 'model (used in module)' },
      { file: 'src/barrel.ts', symbol: 'ExportedType' },
    ],
  );
});

test('ignored records are filtered without discarding similar production paths', () => {
  const paths = [
    'node_modules/a.ts',
    'src/__tests__/a.ts',
    'src/a.test.ts',
    'C:\\repo\\src\\a.spec.ts',
    'src/a.d.ts',
    'src/testimony.ts',
  ];
  assert.deepEqual(parseUnusedExports(paths.map((file) => `${file}:1 - symbol`).join('\n')), [
    { file: 'src/testimony.ts', symbol: 'symbol' },
  ]);
});

for (const output of ['Error: invalid project', 'src/a.ts:1 -', 'src/a.ts:1 - good\ntruncated']) {
  test(`malformed or partial output fails closed: ${JSON.stringify(output)}`, () => {
    assert.throws(() => parseUnusedExports(output), /Unrecognized ts-prune output/);
  });
}

test('successful empty output means clean', async () => {
  assert.deepEqual(await runUnusedExportCommand([process.execPath, '-e', 'process.exit(0)']), []);
});

for (const source of [
  "process.stderr.write('EACCES: cannot read project'); process.exit(7)",
  'process.exit(7)',
  "console.log('src/a.ts:1 - valid'); process.exit(7)",
]) {
  test(`nonzero analyzer status cannot certify clean or partial findings: ${source}`, async () => {
    await assert.rejects(
      runUnusedExportCommand([process.execPath, '-e', source]),
      /failed: exit 7/,
    );
  });
}

test('analyzer diagnostics are preserved', async () => {
  await assert.rejects(
    runUnusedExportCommand([
      process.execPath,
      '-e',
      "process.stderr.write('EACCES: unreadable project'); process.exit(7)",
    ]),
    /EACCES: unreadable project/,
  );
  await assert.rejects(
    runUnusedExportCommand([
      process.execPath,
      '-e',
      "process.stderr.write('unexpected analyzer warning')",
    ]),
    /Unexpected ts-prune stderr/,
  );
});

test('spawn errors and invalid deadlines fail closed', async () => {
  await assert.rejects(runUnusedExportCommand(['/nonexistent/varve-analyzer']), /failed: exit 1/);
  await assert.rejects(
    runUnusedExportCommand([process.execPath, '-e', 'process.exit(0)'], { timeoutMs: 0 }),
    /positive safe integer/,
  );
});

test('a terminated analyzer cannot certify an empty result', {
  skip: process.platform === 'win32',
}, async () => {
  await assert.rejects(
    runUnusedExportCommand([process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')"]),
    /signal SIGTERM/,
  );
});

test('file output retains every record when the CLI exits immediately', async () => {
  const records = await runUnusedExportCommand([
    process.execPath,
    '-e',
    "process.stdout.write(Array.from({length:20000}, (_,i) => 'src/file.ts:1 - export'+i).join('\\n')); process.exit(0)",
  ]);
  assert.equal(records.length, 20000);
  assert.equal(records.at(-1).symbol, 'export19999');
});

function assertStopped(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      assert.equal(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0], 'Z');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

function stopFixture(pidFile) {
  try {
    process.kill(Number(readFileSync(pidFile)), 'SIGTERM');
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
  }
}

for (const mode of ['success', 'failure', 'timeout']) {
  test(`analyzer ${mode} cannot leave its real detached descendant alive`, {
    skip: process.platform === 'win32',
  }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'varve-analyzer-child-'));
    const pidFile = join(directory, 'child.pid');
    const source = `const {spawn} = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {},1000); process.send(process.pid)'],
 {detached:true, stdio:['ignore','ignore','ignore','ipc']});
child.once('message', pid => {
 require('node:fs').writeFileSync(process.argv[1], String(pid));
 ${mode === 'timeout' ? 'setInterval(() => {},1000)' : `setTimeout(() => process.exit(${mode === 'success' ? 0 : 7}),500)`};
});`;
    try {
      await assert.rejects(
        runUnusedExportCommand([process.execPath, '-e', source, pidFile], {
          timeoutMs: mode === 'timeout' ? 1200 : 6000,
        }),
        /ts-prune failed/,
      );
      assertStopped(Number(readFileSync(pidFile)));
    } finally {
      stopFixture(pidFile);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('cancelling the supervisor cleans up the analyzer before reporting failure', {
  skip: process.platform === 'win32',
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'varve-analyzer-cancel-'));
  const pidFile = join(directory, 'child.pid');
  const moduleUrl = new URL('./architecture-unused-exports.mjs', import.meta.url).href;
  const child = `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {},1000);`;
  const supervisor = `import {existsSync} from 'node:fs';
import {runUnusedExportCommand} from ${JSON.stringify(moduleUrl)};
const timer = setInterval(() => {
 if (existsSync(${JSON.stringify(pidFile)})) {
  clearInterval(timer); setTimeout(() => process.kill(process.pid,'SIGTERM'),300);
 }
},20);
try { await runUnusedExportCommand([process.execPath,'-e',${JSON.stringify(child)},${JSON.stringify(pidFile)}]); }
catch (error) { console.error(error.message); process.exitCode=1; }
finally { clearInterval(timer); }`;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', supervisor], {
      encoding: 'utf8',
      timeout: 6000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /cancelled by SIGTERM; owned-process cleanup completed/);
    assert.match(result.stderr, /ts-prune failed: exit 143, signal SIGTERM/);
    assertStopped(Number(readFileSync(pidFile)));
  } finally {
    stopFixture(pidFile);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('locked CLI reports actual findings with ignore semantics and literal spaced paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'varve-analyzer space $() `literal`-'));
  const project = join(directory, 'tsconfig.json');
  writeFileSync(
    project,
    JSON.stringify({ compilerOptions: { target: 'ES2020' }, include: ['*.ts'] }),
  );
  writeFileSync(join(directory, 'source.ts'), 'export const unused = 1;\n');
  writeFileSync(join(directory, 'source.test.ts'), 'export const ignoredTest = 1;\n');
  try {
    const argv = unusedExportArgv('tsconfig.json');
    assert.equal(argv.includes('--error'), false);
    assert.equal(argv.includes('--ignore'), true);
    const records = await runUnusedExportCommand(argv, { cwd: directory });
    assert.deepEqual(records, [{ file: 'source.ts', symbol: 'unused' }]);
    writeFileSync(
      join(directory, 'consumer.ts'),
      "import {unused} from './source'; console.log(unused);\n",
    );
    assert.deepEqual(await runUnusedExportCommand(argv, { cwd: directory }), []);
    writeFileSync(project, '{invalid');
    await assert.rejects(runUnusedExportCommand(argv, { cwd: directory }), /ts-prune failed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
