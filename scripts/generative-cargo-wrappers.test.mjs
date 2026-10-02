import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const posixOnly = { skip: process.platform === 'win32' ? 'POSIX executable Cargo fixture' : false };

function invoke(script, args, { clangArgs, tauriConfig, exitCode = 0 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'varve-cargo-wrapper-'));
  const cargoPath = join(directory, 'cargo');
  const capturePath = join(directory, 'capture.json');
  writeFileSync(
    cargoPath,
    `#!${process.execPath}\n` +
      `const fs = require('node:fs');\n` +
      `fs.writeFileSync(process.env.VARVE_CARGO_TEST_CAPTURE, JSON.stringify({\n` +
      `  args: process.argv.slice(2), cwd: process.cwd(),\n` +
      `  clangArgs: process.env.BINDGEN_EXTRA_CLANG_ARGS ?? null,\n` +
      `  tauriConfig: process.env.TAURI_CONFIG ?? null\n` +
      `}));\n` +
      `process.exit(Number(process.env.VARVE_CARGO_TEST_EXIT));\n`,
  );
  chmodSync(cargoPath, 0o755);
  const env = {
    ...process.env,
    PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
    VARVE_CARGO_TEST_CAPTURE: capturePath,
    VARVE_CARGO_TEST_EXIT: String(exitCode),
  };
  delete env.BINDGEN_EXTRA_CLANG_ARGS;
  delete env.TAURI_CONFIG;
  if (clangArgs !== undefined) env.BINDGEN_EXTRA_CLANG_ARGS = clangArgs;
  if (tauriConfig !== undefined) env.TAURI_CONFIG = JSON.stringify(tauriConfig);
  try {
    const result = spawnSync(process.execPath, [join(repositoryRoot, 'scripts', script), ...args], {
      env,
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined);
    return { result, captured: JSON.parse(readFileSync(capturePath, 'utf8')) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test(
  'validation preserves genuine-header flags and excludes only packaged resources',
  posixOnly,
  () => {
    const args = ['check', '-p', 'varve-generative-helper', '--locked'];
    const clangArgs = '  -I/custom/include -DVARVE_TEST=1  ';
    const { result, captured } = invoke('cargo-with-generative-bindgen.mjs', args, {
      clangArgs,
      tauriConfig: { identifier: 'fixture.app', bundle: { active: true, resources: ['helper'] } },
    });
    assert.equal(result.status, 0);
    assert.deepEqual(captured.args, args);
    assert.equal(captured.cwd, repositoryRoot.replace(/[\\/]$/, ''));
    assert.equal(captured.clangArgs, clangArgs);
    assert.deepEqual(JSON.parse(captured.tauriConfig), {
      identifier: 'fixture.app',
      bundle: { active: true, resources: [] },
    });
  },
);

test('packaging preserves resources and leaves absent Clang flags absent', posixOnly, () => {
  const tauriConfig = { bundle: { resources: ['release-helper'], active: true } };
  const { result, captured } = invoke('cargo-with-generative-bindgen.mjs', ['build', '--locked'], {
    tauriConfig,
  });
  assert.equal(result.status, 0);
  assert.equal(captured.clangArgs, null);
  assert.deepEqual(JSON.parse(captured.tauriConfig), tauriConfig);
});

test('validation propagates the actual Cargo failure', posixOnly, () => {
  const { result } = invoke('cargo-with-generative-bindgen.mjs', ['test', '--locked'], {
    exitCode: 37,
  });
  assert.equal(result.status, 37);
});

test(
  'release helper uses the locked resolution and unchanged caller header flags',
  posixOnly,
  () => {
    const clangArgs = '-I/real/system/headers -DHELPER_TEST=1';
    const { result, captured } = invoke('build-generative-helper.mjs', [], { clangArgs });
    assert.equal(result.status, 0);
    assert.deepEqual(captured.args, [
      'build',
      '-p',
      'varve-generative-helper',
      '--release',
      '--locked',
    ]);
    assert.equal(captured.clangArgs, clangArgs);
  },
);

test(
  'release helper leaves absent header flags absent and fails when Cargo fails',
  posixOnly,
  () => {
    const { result, captured } = invoke('build-generative-helper.mjs', [], { exitCode: 23 });
    assert.notEqual(result.status, 0);
    assert.equal(captured.clangArgs, null);
  },
);
