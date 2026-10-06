import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = readFileSync(
  process.env.VARVE_NATIVE_WORKFLOW_FIXTURE || '.github/workflows/release.yml',
  'utf8',
);
const step = workflow.slice(workflow.indexOf('      - name: Launch smoke (AppImage under Xvfb)'));
const block = step.match(/ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/)?.[1];
assert.ok(block, 'execute the real workflow AppImage extraction commands');
const run = block.replace(/^ {10}/gm, '');
const extract = run.split('node scripts/release/verify-license-payload.mjs')[0];
assert.match(extract, /--appimage-extract/);
assert.match(run, /--resource-root "\$\{EXTRACT_ROOT\}\/squashfs-root\/usr\/lib\/Varve"/);
assert.match(run, /--appimage-extract-and-run/);
assert.match(run, /WebKit failure detected/);
assert.match(run, /No WebKit web process/);

const fixture = mkdtempSync(join(tmpdir(), 'varve appimage β-'));
try {
  for (const arch of ['x86_64', 'aarch64']) {
    const cwd = join(fixture, arch);
    const stage = join(cwd, 'staged', `linux-${arch}`);
    const runnerTemp = join(cwd, 'runner temp');
    const receipt = join(cwd, 'extraction-receipt.txt');
    mkdirSync(stage, { recursive: true });
    mkdirSync(runnerTemp);
    const image = join(stage, `Varve-0.5.0-linux-${arch}.AppImage`);
    writeFileSync(
      image,
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" "$0" "$PWD" "$1" > "$VARVE_TEST_APPIMAGE_RECEIPT"\nmkdir -p squashfs-root/usr/lib/Varve\n',
    );
    const script = extract.replaceAll('${{ matrix.arch_slug }}', arch);
    const env = {
      ...process.env,
      RUNNER_TEMP: runnerTemp,
      VARVE_TEST_APPIMAGE_RECEIPT: receipt,
    };
    const result = spawnSync('bash', ['-e', '-c', script], { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `AppImage extraction from a different cwd: ${result.stderr}`);
    const [actualImage, actualCwd, arg] = readFileSync(receipt, 'utf8').trimEnd().split('\n');
    assert.equal(actualImage, image);
    assert.ok(actualCwd.startsWith(`${runnerTemp}/varve-appimage-resources.`));
    assert.equal(arg, '--appimage-extract');
    assert.equal(
      existsSync(actualCwd),
      false,
      'the extraction trap cleans its temporary directory',
    );
    rmSync(image);
    const missing = spawnSync('bash', ['-e', '-c', script], { cwd, env, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /::error::No AppImage found/);
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log(
  'Actual AppImage workflow extraction survives cwd, space and Unicode paths on both Linux targets.',
);
