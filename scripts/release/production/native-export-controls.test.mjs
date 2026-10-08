import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clickNativeQuickExport, nativeQuickExportControls } from './native-export-controls.mjs';

// Model the observed installed inspector: PNG starts at 2x, and the native
// action changes with the chosen format. Wrong labels/roles fail outright.
for (const format of ['PNG', 'SVG', 'PDF']) {
  let selected = 'PNG',
    scale = '2x';
  const actions = [];
  const page = {
    getByRole(role, { name, exact }) {
      assert.equal(exact, true);
      return {
        async click() {
          if (role === 'radio' && ['PNG', 'SVG', 'PDF'].includes(name)) selected = name;
          else if (role === 'radio' && name === '1x' && selected === 'PNG') scale = name;
          else {
            assert.equal(role, 'button');
            assert.equal(name, `Export ${selected}`, 'actual installed action, not web Download');
            if (selected === 'PNG') assert.equal(scale, '1x', 'pixel oracle uses actual 1x output');
          }
          actions.push(name);
        },
      };
    },
  };
  await clickNativeQuickExport(page, format);
  assert.deepEqual(
    actions,
    format === 'PNG' ? ['PNG', '1x', 'Export PNG'] : [format, `Export ${format}`],
  );
}
for (const invalid of ['png', 'JPEG', 'Download', null])
  assert.throws(() => nativeQuickExportControls(invalid), /Qualified native export format/);
const obstruction = new Error('actual export control obstructed');
await assert.rejects(
  clickNativeQuickExport(
    {
      getByRole: () => ({
        click: async () => {
          throw obstruction;
        },
      }),
    },
    'PNG',
  ),
  (error) => error === obstruction,
  'control failures remain fatal; no fallback to a different action',
);
const original = JSON.parse(
  readFileSync('tests/e2e/fixtures/published-v021/poster-embedded.varve', 'utf8'),
);
// Authentic installed output and the observed wrongly scoped Mac export.
const svg = readFileSync(new URL('./fixtures/native-svg-image-37781782203.svg', import.meta.url));
const posterSvg = readFileSync(
  new URL('./fixtures/macos-poster-export-37781782203.svg', import.meta.url),
);
for (const adapter of ['linux-production', 'windows-production', 'macos-production']) {
  const source = readFileSync(new URL(`./${adapter}.mjs`, import.meta.url), 'utf8');
  assert.match(
    source,
    /native-export-controls\.mjs/,
    'all native adapters use the same control contract',
  );
  assert.doesNotMatch(source, /name: \/download\/i|await click\('Download'/);
  assert.match(source, /\[104, 80\]/, 'the embedded-image dimension oracle remains');
  assert.match(source, /source\.data|sourceAt/, 'the actual embedded pixel oracle remains');
  const start = source.indexOf("} else if (format === 'SVG') {");
  assert.ok(start > 0, `${adapter}: actual SVG output branch exists`);
  const branch = source.slice(
    start + "} else if (format === 'SVG') {".length,
    source.indexOf('} else {', start),
  );
  const check = (bytes) => vm.runInNewContext(branch, { assert, bytes, original });
  check(svg);
  for (const invalid of [
    posterSvg,
    Buffer.from(svg.toString().replace('658 68 104 80', '658 68 842 1191')),
    Buffer.from(svg.toString().replace('658 68 104 80', '0 0 104 80')),
    Buffer.from(svg.toString().replace(/<image\b[^>]*\/>/, '')),
    Buffer.from(
      svg.toString().replace('data:image/png;base64,iVBOR', 'data:image/png;base64,aVBOR'),
    ),
  ]) {
    assert.throws(
      () => check(invalid),
      assert.AssertionError,
      `${adapter}: wrong scope or image bytes must fail`,
    );
  }
}
console.log(
  'Actual native Export labels, explicit PNG 1x, format isolation and fatal control failures passed; hosted native execution still required.',
);
