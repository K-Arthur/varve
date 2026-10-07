import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { assertNativePdfArtwork } from './native-pdf.mjs';

const require = createRequire(`${process.cwd()}/package.json`);
const { transpileModule, ModuleKind } = require('typescript');
const writerSource = readFileSync('packages/editor/src/components/SpecPanel/rasterPdf.ts', 'utf8');
const js = transpileModule(writerSource, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const context = vm.createContext({ exports: {}, Uint8Array, TextEncoder });
vm.runInContext(js, context);
const fixture = JSON.parse(readFileSync('tests/e2e/fixtures/published-v021/poster-embedded.varve'));
const png = Buffer.from(fixture.assets['asset-ca2aceaaa125b46e'].dataUrl.split(',')[1], 'base64');
const { PNG } = createRequire(`${process.cwd()}/packages/engine/package.json`)('pngjs');
const image = PNG.sync.read(png);
const pixels = new Uint8Array(104 * 80 * 4);
for (let y = 0; y < 80; y++)
  for (let x = 0; x < 104; x++) {
    const src =
      (Math.floor((y / 80) * image.height) * image.width + Math.floor((x / 104) * image.width)) * 4;
    pixels.set(image.data.subarray(src, src + 4), (y * 104 + x) * 4);
  }
const valid = context.exports.makeRasterImagePdf(pixels, 104, 80);
const rendered = PNG.sync.read(await assertNativePdfArtwork(valid, png));
assert.deepEqual([rendered.width, rendered.height], [104, 80]);
const native = JSON.parse(
  readFileSync(new URL('./fixtures/native-pdf-embedded.json', import.meta.url)),
);
const nativeBytes = Buffer.from(native.base64, 'base64');
assert.equal(createHash('sha256').update(nativeBytes).digest('hex'), native.sha256);
await assertNativePdfArtwork(nativeBytes, png);
// Resolve the real PDF renderer through a dependency path containing URL
// delimiters. Bare filesystem imports truncate '#' even on Unix; on Windows
// they additionally misread the drive letter as a URL protocol.
const urlFixture = mkdtempSync(join(tmpdir(), 'varve-native-pdf # url-'));
try {
  symlinkSync(
    resolve('node_modules/.pnpm/node_modules'),
    join(urlFixture, 'node_modules'),
    'junction',
  );
  for (const name of ['import', 'engine']) {
    const directory = join(urlFixture, 'packages', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), '{}');
    symlinkSync(
      resolve('packages', name, 'node_modules'),
      join(directory, 'node_modules'),
      'junction',
    );
  }
  const script = `
    import { readFileSync } from 'node:fs';
    import { assertNativePdfArtwork } from ${JSON.stringify(new URL('./native-pdf.mjs', import.meta.url).href)};
    const fixture = JSON.parse(readFileSync(${JSON.stringify(resolve('scripts/release/production/fixtures/native-pdf-embedded.json'))}));
    const original = JSON.parse(readFileSync(${JSON.stringify(resolve('tests/e2e/fixtures/published-v021/poster-embedded.varve'))}));
    await assertNativePdfArtwork(Buffer.from(fixture.base64, 'base64'),
      Buffer.from(original.assets['asset-ca2aceaaa125b46e'].dataUrl.split(',')[1], 'base64'));
  `;
  execFileSync(process.execPath, ['--preserve-symlinks', '--input-type=module', '-e', script], {
    cwd: urlFixture,
    timeout: 60000,
    stdio: 'pipe',
  });
} finally {
  rmSync(urlFixture, { recursive: true, force: true });
}
const observed = JSON.parse(
  readFileSync(new URL('./fixtures/native-pdf-placeholder.json', import.meta.url)),
);
const bad = Buffer.from(observed.base64, 'base64');
assert.equal(createHash('sha256').update(bad).digest('hex'), observed.sha256);
await assert.rejects(
  assertNativePdfArtwork(bad, png),
  /rendered PDF must preserve/,
  'the actual structurally valid installed PDF regression is rejected',
);
const blank = context.exports.makeRasterImagePdf(new Uint8Array(pixels.length).fill(255), 104, 80);
await assert.rejects(assertNativePdfArtwork(blank, png), /rendered PDF must preserve/);
const scaled = context.exports.makeRasterImagePdf(pixels.subarray(0, 52 * 80 * 4), 52, 80);
await assert.rejects(assertNativePdfArtwork(scaled, png), /actual PDF page dimensions/);
for (const adapter of ['linux-production', 'windows-production', 'macos-production']) {
  const source = readFileSync(new URL(`./${adapter}.mjs`, import.meta.url), 'utf8');
  assert.match(
    source,
    /await assertNativePdfArtwork\(/,
    'every native target renders and checks its actual PDF',
  );
  assert.match(
    source,
    /native-export-pdf-render\.png/,
    'rendered proof survives as a qualification artifact',
  );
}
console.log(
  'Actual PDF renderer accepts source artwork and rejects observed native placeholders, blank pages and incorrect dimensions.',
);
