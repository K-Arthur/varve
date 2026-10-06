import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
