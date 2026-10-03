#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run-bounded-command.mjs', import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), 'varve-bounded-command-'));
const marker = join(tempDir, 'orphan-survived.txt');
const source = [
  "const { spawn } = require('node:child_process');",
  'const marker = process.argv[1];',
  `spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'alive'), 1500); setInterval(() => {}, 1000)", marker], { stdio: 'ignore' });`,
  'setInterval(() => {}, 1000);',
].join('\n');

try {
  const result = spawnSync(
    process.execPath,
    [runner, '150', tempDir, process.execPath, '-e', source, marker],
    { encoding: 'utf8', timeout: 8_000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 124, `expected timeout exit; got ${result.status}: ${result.stderr}`);
  await new Promise((resolve) => setTimeout(resolve, 1_800));
  assert.equal(existsSync(marker), false, 'a descendant process survived the command timeout');
  console.log('bounded command timeout kills descendants');

  for (const status of [0, 7]) {
    const result = spawnSync(
      process.execPath,
      [runner, '1000', tempDir, process.execPath, '-e', `process.exit(${status})`],
      { encoding: 'utf8', timeout: 8000 },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, status, 'completed commands preserve their exit status');
    assert.doesNotMatch(result.stderr, /timed out|cancelled/);
  }

  // A launcher can die before the helper captures process.ppid, which is then
  // the OS reaper rather than its real parent. The pre-spawn identity closes
  // that race and prevents starting orphan work against the snapshot.
  if (process.platform === 'linux' || process.platform === 'darwin') {
    const admissionMarker = join(tempDir, 'dead-launcher-command');
    const result = spawnSync(
      process.execPath,
      [
        runner,
        '1000',
        tempDir,
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(admissionMarker)},'launched')`,
      ],
      {
        encoding: 'utf8',
        timeout: 3000,
        env: {
          ...process.env,
          VARVE_VALIDATION_LAUNCHER: JSON.stringify({
            pid: 2147483647,
            identity: 'exited-launcher',
          }),
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /original launcher exited before supervisor admission/);
    assert.equal(existsSync(admissionMarker), false);
    console.log('pre-spawn launcher identity prevents orphan admission');
  }

  // Exercise the real Windows adapter on this host without starting cmd.exe:
  // only the OS spawn boundary is injected. This is not native Windows proof.
  const adapterFixture = `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import { EventEmitter } from 'node:events';
    import { syncBuiltinESMExports } from 'node:module';
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const calls = [];
    childProcess.spawn = (command, args, options) => {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      process.nextTick(() => child.emit('exit', 7, null));
      return child;
    };
    syncBuiltinESMExports();
    const { runValidationCommand } = await import(${JSON.stringify(new URL('./heavy-lease.mjs', import.meta.url).href)});
    const completed = await runValidationCommand(['fixture.cmd', 'space and (parentheses)', 'literal & command'], { stdio: 'ignore' });
    assert.equal(completed.status, 7);
    assert.equal(calls.length, 1);
    assert.match(calls[0].command, /cmd\\.exe$/i);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.windowsVerbatimArguments, true);
    assert.equal(calls[0].options.detached, false);
    assert.ok(calls[0].args.at(-1).includes('^&'));
    for (const bad of ['line\\nbreak', 'line\\rbreak', 'nul\\0break']) {
      const rejected = await runValidationCommand(['fixture.cmd', bad], { stdio: 'ignore' });
      assert.equal(rejected.status, 1);
    }
    assert.equal(calls.length, 1, 'unsafe batch argv must fail before the spawn boundary');
  `;
  const adapter = spawnSync(process.execPath, ['--input-type=module', '-e', adapterFixture], {
    encoding: 'utf8',
    timeout: 8000,
  });
  assert.equal(adapter.error, undefined, adapter.error?.message);
  assert.equal(adapter.status, 0, adapter.stderr);
  assert.match(adapter.stderr, /Windows batch command arguments cannot contain line breaks or NUL/);
  console.log('Windows shim adapter keeps command status, escapes argv and rejects line breaks');

  if (process.platform === 'win32') {
    const bin = join(tempDir, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    const argvPath = join(tempDir, 'windows-argv.json');
    writeFileSync(
      join(bin, 'fixture.mjs'),
      `import fs from 'node:fs';fs.writeFileSync(process.env.VARVE_FIXTURE_ARGV,JSON.stringify(process.argv.slice(2)));`,
    );
    writeFileSync(
      join(bin, 'fixture.cmd'),
      `@echo off\r\n"${process.execPath}" "%~dp0fixture.mjs" %*\r\n`,
    );
    const args = [
      'two words',
      'quote"inside',
      '(parentheses)',
      'literal & pipe |',
      '%VARVE_FIXTURE_VALUE%',
    ];
    const native = spawnSync(
      process.execPath,
      [runner, '3000', tempDir, join(bin, 'fixture.cmd'), ...args],
      {
        encoding: 'utf8',
        timeout: 8000,
        env: {
          ...process.env,
          VARVE_FIXTURE_ARGV: argvPath,
          VARVE_FIXTURE_VALUE: 'must-not-expand',
        },
      },
    );
    assert.equal(native.error, undefined, native.error?.message);
    assert.equal(native.status, 0, native.stderr);
    assert.deepEqual(JSON.parse(readFileSync(argvPath, 'utf8')), args);
    console.log('native Windows .cmd arguments remain literal through the bounded CLI');
  }

  // pnpm starts children in separate process groups. Exercise the real CLI,
  // including a grandchild which ignores TERM and requires bounded cleanup.
  // These fixtures never acquire or reclaim a repository lease.
  if (process.platform !== 'win32') {
    for (const cancellation of [false, true]) {
      const ready = join(tempDir, `detached-${cancellation}.json`);
      let owner;
      let sentinel;
      let owned = [];
      try {
        const grandchild = [
          "const fs = require('node:fs');",
          "process.on('SIGTERM', () => {});",
          'fs.writeFileSync(process.argv[1], JSON.stringify({ parent: Number(process.argv[2]), grandchild: process.pid }));',
          'setInterval(() => {}, 1000);',
        ].join('\n');
        const parent = [
          "const { spawn } = require('node:child_process');",
          "process.on('SIGTERM', () => {});",
          `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, process.argv[1], String(process.pid)], { detached: true, stdio: 'ignore' });`,
          "child.on('exit', () => process.exit(0));",
          'setInterval(() => {}, 1000);',
        ].join('\n');
        sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        });
        let stderr = '';
        owner = spawn(
          process.execPath,
          [runner, cancellation ? '10000' : '1000', tempDir, process.execPath, '-e', parent, ready],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        owner.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        const exit = new Promise((resolve, reject) => {
          owner.once('error', reject);
          owner.once('exit', (code, signal) => resolve({ code, signal }));
        });
        const readyDeadline = Date.now() + 3000;
        while (!existsSync(ready) && Date.now() < readyDeadline)
          await new Promise((resolve) => setTimeout(resolve, 5));
        assert.ok(existsSync(ready), 'detached fixture must start before termination');
        const pids = JSON.parse(readFileSync(ready, 'utf8'));
        owned = [pids.parent, pids.grandchild].map(processRecord);
        assert.ok(owned.every(Boolean), 'both owned processes must be live');
        if (process.platform === 'linux')
          assert.notEqual(
            owned[0].group,
            owned[1].group,
            'fixture must use separate process groups',
          );
        // Allow a periodic ownership snapshot before sending cancellation.
        if (cancellation) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          owner.kill('SIGTERM');
        }
        const result = await Promise.race([
          exit,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('bounded detached cleanup did not finish')),
              7000,
            ).unref(),
          ),
        ]);
        assert.equal(result.code, cancellation ? 143 : 124);
        assert.equal(result.signal, null, 'wrapper records an explicit nonzero exit');
        for (const record of owned)
          assert.equal(processRecord(record.pid), null, 'an owned detached process survived');
        assert.ok(processRecord(sentinel.pid), 'an unrelated sibling must remain alive');
        assert.match(stderr, cancellation ? /cancelled by SIGTERM/ : /command timed out after 1s/);
        assert.match(stderr, /owned-process cleanup completed/);
        assert.doesNotMatch(stderr, cancellation ? /command timed out/ : /cancelled by/);
      } finally {
        // Only identities recorded from this fixture can be force-cleaned.
        for (const record of owned) {
          const current = processRecord(record?.pid);
          if (!current || current.identity !== record.identity) continue;
          try {
            process.kill(record.pid, 'SIGKILL');
          } catch {}
        }
        owner?.kill('SIGKILL');
        sentinel?.kill('SIGKILL');
      }
    }
    console.log(
      'bounded deadlines and cancellation clean detached descendants, preserving unrelated work',
    );
    if (process.platform === 'linux' || process.platform === 'darwin')
      for (const abrupt of [false, true]) await testSupervisorParentLoss(abrupt);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

async function waitForFixtureFile(path, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(existsSync(path), 'parent-loss fixture did not produce ' + path);
}

/** The real parent exits normally; it never signals its detached supervisor. */
async function testSupervisorParentLoss(abrupt) {
  const prefix = `parent-loss-${abrupt}`;
  const ready = join(tempDir, `${prefix}-command.json`);
  const ownerPath = join(tempDir, `${prefix}-owner`);
  const leave = join(tempDir, `${prefix}-controller-leave`);
  const receipt = join(tempDir, `${prefix}-result.json`);
  const signalMarker = join(tempDir, `${prefix}-supervisor-signal`);
  const logPath = join(tempDir, `${prefix}.log`);
  const supervisorPath = join(tempDir, `${prefix}-supervisor.mjs`);
  let controller;
  let sentinel;
  let owned = [];
  try {
    const grandchild = [
      "const fs = require('node:fs');",
      "process.on('SIGTERM', () => {});",
      'fs.writeFileSync(process.argv[1], JSON.stringify({ parent: Number(process.argv[2]), grandchild: process.pid }));',
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const command = [
      "const { spawn } = require('node:child_process');",
      "process.on('SIGTERM', () => {});",
      'const child = spawn(process.execPath, ' +
        JSON.stringify(['-e', grandchild]) +
        ".concat([process.argv[1], String(process.pid)]), { detached: true, stdio: 'ignore' });",
      "child.on('exit', () => process.exit(0));",
      'setInterval(() => {}, 1000);',
    ].join('\n');
    writeFileSync(
      supervisorPath,
      [
        "import fs from 'node:fs';",
        'import { runValidationCommand } from ' +
          JSON.stringify(new URL('./heavy-lease.mjs', import.meta.url).href) +
          ';',
        "for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => fs.writeFileSync(" +
          JSON.stringify(signalMarker) +
          ', signal));',
        'const result = await runValidationCommand(' +
          JSON.stringify([process.execPath, '-e', command, ready]) +
          ", { graceMs: 150, timeoutMs: 10000, stdio: 'ignore' });",
        'fs.writeFileSync(' + JSON.stringify(receipt) + ', JSON.stringify(result));',
        'process.exitCode = result.status;',
      ].join('\n'),
    );
    const controllerSource = [
      "const fs = require('node:fs');",
      "const { spawn } = require('node:child_process');",
      "const out = fs.openSync(process.argv[4], 'w');",
      "const owner = spawn(process.execPath, [process.argv[1]], { detached: true, stdio: ['ignore', out, out] });",
      'fs.closeSync(out);',
      'fs.writeFileSync(process.argv[2], String(owner.pid));',
      'owner.unref();',
      'setInterval(() => { if (fs.existsSync(process.argv[3])) process.exit(0); }, 5);',
    ].join('\n');
    sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    controller = spawn(
      process.execPath,
      ['-e', controllerSource, supervisorPath, ownerPath, leave, logPath],
      { stdio: 'ignore' },
    );
    const controllerExit = new Promise((resolve, reject) => {
      controller.once('error', reject);
      controller.once('exit', (code, signal) => resolve({ code, signal }));
    });
    await waitForFixtureFile(ownerPath);
    const ownerPid = Number(readFileSync(ownerPath, 'utf8'));
    owned = [processRecord(ownerPid)];
    assert.ok(owned[0], 'detached supervisor must be alive');
    await waitForFixtureFile(ready);
    const pids = JSON.parse(readFileSync(ready, 'utf8'));
    owned.push(processRecord(pids.parent), processRecord(pids.grandchild));
    assert.ok(owned.every(Boolean), 'owned command and detached grandchild must be live');
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (abrupt) controller.kill('SIGKILL');
    else writeFileSync(leave, 'exit without signalling supervisor');
    assert.deepEqual(
      await controllerExit,
      abrupt ? { code: null, signal: 'SIGKILL' } : { code: 0, signal: null },
    );
    await waitForFixtureFile(receipt, 6500);
    const result = JSON.parse(readFileSync(receipt, 'utf8'));
    assert.deepEqual(result, { status: 1, signal: null, remaining: [], cleanupUnknown: false });
    assert.equal(existsSync(signalMarker), false, 'no signal may cause supervisor cleanup');
    assert.match(
      readFileSync(logPath, 'utf8'),
      /supervising parent \d+ exited or changed; owned-process cleanup completed/,
    );
    for (const record of owned.slice(1))
      assert.equal(processRecord(record.pid), null, 'owned detached work survived parent loss');
    assert.ok(processRecord(sentinel.pid), 'an unrelated sibling must remain alive');
    console.log(
      `supervisor parent ${abrupt ? 'SIGKILL' : 'exit'} cleans owned detached work without a delivered signal`,
    );
  } finally {
    for (const record of owned.reverse()) {
      const current = processRecord(record?.pid);
      if (!current || current.identity !== record.identity) continue;
      try {
        process.kill(record.pid, 'SIGKILL');
      } catch {}
    }
    controller?.kill('SIGKILL');
    sentinel?.kill('SIGKILL');
  }
}

function processRecord(pid) {
  if (!Number.isSafeInteger(pid)) return null;
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      return fields[0] === 'Z' ? null : { pid, identity: fields[19], group: Number(fields[2]) };
    }
    const text = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=,stat='], {
      encoding: 'utf8',
      timeout: 1000,
    }).stdout?.trim();
    const match = text?.match(/^(.+?)\s+(\S+)$/);
    return match && !match[2].startsWith('Z') ? { pid, identity: match[1] } : null;
  } catch {
    return null;
  }
}
