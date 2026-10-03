import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  archiveInventoryFindings,
  assertActiveWorkflow,
  loadArchive,
  publicationFindings,
} from './publication.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function fixture({ archived = false, published = false, slug = 'sample' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'varve-workflow-publication-'));
  roots.push(root);
  const canonicalDir = join(root, 'docs/screenshots/workflows');
  const websiteDir = join(root, 'apps/website/public/screenshots/workflows');
  mkdirSync(canonicalDir, { recursive: true });
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(1440, 16);
  png.writeUInt32BE(900, 20);
  const manifest = {
    slug,
    gitCommit: 'a'.repeat(40),
    capturedAt: '2026-08-22T00:00:00.000Z',
    viewport: '1440x900',
    fps: 30,
    deliveredDuration: 2,
    outputs: {
      webm: `docs/screenshots/workflows/${slug}.webm`,
      mp4: `docs/screenshots/workflows/${slug}.mp4`,
      poster: `docs/screenshots/workflows/${slug}-poster.png`,
    },
    verification: { pass: true, clips: { mp4: { pass: true } } },
  };
  writeFileSync(join(canonicalDir, `${slug}.capture.json`), JSON.stringify(manifest));
  const assets = { webm: `${slug}.webm`, mp4: `${slug}.mp4`, poster: `${slug}-poster.png` };
  for (const [kind, name] of Object.entries(assets)) {
    writeFileSync(join(canonicalDir, name), kind === 'poster' ? png : kind);
  }
  if (published) {
    mkdirSync(websiteDir, { recursive: true });
    for (const name of Object.values(assets)) {
      copyFileSync(join(canonicalDir, name), join(websiteDir, name));
    }
  }
  const entry = {
    manifestSha256: hash(join(canonicalDir, `${slug}.capture.json`)),
    assets: Object.fromEntries(
      Object.entries(assets).map(([kind, name]) => [kind, hash(join(canonicalDir, name))]),
    ),
  };
  const archivePath = join(canonicalDir, 'archive.json');
  writeFileSync(
    archivePath,
    JSON.stringify({
      schemaVersion: 1,
      reason: 'Dated review fixture',
      clips: archived ? { [slug]: entry } : {},
    }),
  );
  return { root, slug, canonicalDir, websiteDir, archivePath, archive: loadArchive(archivePath) };
}

function runVerifier(data, { badCodec = false } = {}) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const stageDir = join(data.root, 'scripts/capture/core');
  mkdirSync(stageDir, { recursive: true });
  copyFileSync(join(sourceDir, 'publication.mjs'), join(stageDir, 'publication.mjs'));
  copyFileSync(
    join(sourceDir, '../verify-workflows.mjs'),
    join(stageDir, '../verify-workflows.mjs'),
  );
  writeFileSync(
    join(stageDir, 'ffmpeg.mjs'),
    `export async function probe(path) { return { codec: ${badCodec ? "'invalid'" : "path.endsWith('.webm') ? 'vp9' : 'h264'"}, width: 1440, height: 900, fps: 30, duration: 2 }; }\n`,
  );
  const result = spawnSync(process.execPath, [join(stageDir, '../verify-workflows.mjs')], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  return result;
}

test('active workflow requires all website copies when the public directory is absent', () => {
  assert.equal(publicationFindings(fixture()).length, 3);
});
test('active workflow accepts byte-identical copies', () => {
  assert.deepEqual(publicationFindings(fixture({ published: true })), []);
});
test('active workflow rejects differing website media', () => {
  const data = fixture({ published: true });
  writeFileSync(join(data.websiteDir, 'sample.mp4'), 'changed');
  assert.match(publicationFindings(data).join('\n'), /website copy differs.*sample.mp4/);
});
test('explicit archive accepts exact canonical files with no website directory', () => {
  assert.deepEqual(publicationFindings(fixture({ archived: true })), []);
});
test('archive rejects accidental republishing', () => {
  assert.equal(publicationFindings(fixture({ archived: true, published: true })).length, 3);
});
test('archive rejects changed media bytes', () => {
  const data = fixture({ archived: true });
  writeFileSync(join(data.canonicalDir, 'sample.webm'), 'changed');
  assert.match(publicationFindings(data).join('\n'), /canonical hash changed.*sample.webm/);
});
test('archive rejects relabeled original capture provenance', () => {
  const data = fixture({ archived: true });
  writeFileSync(join(data.canonicalDir, 'sample.capture.json'), '{}');
  assert.match(publicationFindings(data).join('\n'), /canonical hash changed.*sample.capture.json/);
});
test('archive rejects missing canonical media', () => {
  const data = fixture({ archived: true });
  rmSync(join(data.canonicalDir, 'sample.mp4'));
  assert.match(publicationFindings(data).join('\n'), /canonical file missing.*sample.mp4/);
});
test('archive inventory does not hide a removed capture manifest', () => {
  const data = fixture({ archived: true });
  assert.deepEqual(archiveInventoryFindings(data.archive, []), [
    'archived manifest missing: sample.capture.json',
  ]);
});
test('invalid registry cannot waive publication verification', () => {
  const data = fixture();
  writeFileSync(
    data.archivePath,
    JSON.stringify({
      schemaVersion: 1,
      reason: 'reason',
      clips: { sample: { manifestSha256: 'a'.repeat(64), assets: {} } },
    }),
  );
  assert.throws(() => loadArchive(data.archivePath), /invalid workflow archive entry/);
});
test('unsupported registry schema fails closed', () => {
  const data = fixture();
  writeFileSync(
    data.archivePath,
    JSON.stringify({ schemaVersion: 2, reason: 'reason', clips: {} }),
  );
  assert.throws(() => loadArchive(data.archivePath), /schemaVersion 1/);
});
test('unlisted slug matching an object prototype member remains active', () => {
  assert.equal(publicationFindings(fixture({ slug: 'constructor' })).length, 3);
});
test('connected verifier accepts an archive without a public directory', () => {
  const result = runVerifier(fixture({ archived: true }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ARCHIVE OK/);
});
test('connected verifier rejects missing active website copies', () => {
  const result = runVerifier(fixture());
  assert.equal(result.status, 1);
  assert.match(result.stderr, /website copy missing/);
});
test('connected verifier preserves active media success', () => {
  const result = runVerifier(fixture({ published: true }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PUBLISHED OK/);
});
test('connected verifier rejects changed archive provenance', () => {
  const data = fixture({ archived: true });
  const path = join(data.canonicalDir, 'sample.capture.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.gitCommit = 'b'.repeat(40);
  writeFileSync(path, JSON.stringify(manifest));
  const result = runVerifier(data);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical hash changed.*capture.json/);
});
test('connected verifier retains codec checks for archived media', () => {
  const result = runVerifier(fixture({ archived: true }), { badCodec: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /webm codec invalid/);
});
test('connected verifier rejects republished archive copies', () => {
  const result = runVerifier(fixture({ archived: true, published: true }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /archived file is still published/);
});

test('write preflight rejects archived slugs and accepts unlisted slugs', () => {
  const data = fixture({ archived: true });
  assert.throws(
    () => assertActiveWorkflow(data.archive, 'sample'),
    /archived workflow is read-only/,
  );
  assert.doesNotThrow(() => assertActiveWorkflow(data.archive, 'new-workflow'));
});

function runWriterPreflight(data, writer, { archiveAtEncode = false } = {}) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const stageDir = join(data.root, 'scripts/capture/core');
  mkdirSync(stageDir, { recursive: true });
  for (const name of [
    'run.mjs',
    'publication.mjs',
    'editor.mjs',
    'ffmpeg.mjs',
    'manifest.mjs',
    'server.mjs',
    'verify.mjs',
  ]) {
    copyFileSync(join(sourceDir, name), join(stageDir, name));
  }
  for (const name of ['encode-workflows.mjs', 'native-linux-first-document.mjs']) {
    copyFileSync(join(sourceDir, '..', name), join(stageDir, '..', name));
  }
  const marker = join(data.root, 'unexpected-resource-call');
  const browserPackage = join(data.root, 'node_modules/@playwright/test');
  mkdirSync(browserPackage, { recursive: true });
  writeFileSync(
    join(browserPackage, 'package.json'),
    JSON.stringify({ type: 'module', exports: './index.mjs' }),
  );
  writeFileSync(
    join(browserPackage, 'index.mjs'),
    `import {writeFileSync} from 'node:fs'; export const chromium = {launch(){writeFileSync(${JSON.stringify(marker)}, 'browser');throw new Error('browser sentinel must not run');}};`,
  );
  writeFileSync(
    join(stageDir, 'server.mjs'),
    `import {writeFileSync} from 'node:fs'; export function capturePort(){writeFileSync(${JSON.stringify(marker)}, 'port');throw new Error('port sentinel must not run');} export function startServer(){throw new Error('server sentinel must not run');} export function stopServer(){}`,
  );
  if (archiveAtEncode) {
    const archivedEntry = {
      manifestSha256: hash(join(data.canonicalDir, `${data.slug}.capture.json`)),
      assets: {
        webm: hash(join(data.canonicalDir, `${data.slug}.webm`)),
        mp4: hash(join(data.canonicalDir, `${data.slug}.mp4`)),
        poster: hash(join(data.canonicalDir, `${data.slug}-poster.png`)),
      },
    };
    writeFileSync(
      join(stageDir, 'ffmpeg.mjs'),
      `import {writeFileSync} from 'node:fs'; export async function toMp4(source,dest){writeFileSync(dest,'new encoding');writeFileSync(${JSON.stringify(data.archivePath)},${JSON.stringify(JSON.stringify({ schemaVersion: 1, reason: 'Archived during encoding fixture', clips: { [data.slug]: archivedEntry } }))});} export async function probe(path){return {codec:path.endsWith('.mp4')?'h264':'vp9',width:1440,height:900,fps:30,duration:2};}`,
    );
  }
  const script =
    writer === 'record'
      ? join(data.root, 'record.mjs')
      : join(
          stageDir,
          '..',
          writer === 'encode' ? 'encode-workflows.mjs' : 'native-linux-first-document.mjs',
        );
  if (writer === 'record') {
    writeFileSync(
      script,
      `import {capture} from './scripts/capture/core/run.mjs'; await capture({slug:${JSON.stringify(data.slug)}});`,
    );
  }
  const originals = Object.fromEntries(
    [
      `${data.slug}.webm`,
      `${data.slug}.mp4`,
      `${data.slug}-poster.png`,
      `${data.slug}.capture.json`,
    ].map((name) => [name, hash(join(data.canonicalDir, name))]),
  );
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      VARVE_DESKTOP_BINARY: join(data.root, 'missing-native-fixture'),
      PATH: '',
    },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /archived workflow is read-only/);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(originals).map((name) => [name, hash(join(data.canonicalDir, name))]),
    ),
    originals,
  );
  assert.equal(existsSync(data.websiteDir), false);
  assert.equal(existsSync(marker), false);
  assert.equal(
    readdirSync(data.root).some((name) => name.startsWith('.capture')),
    false,
  );
  return result;
}

test('actual recorder preflight rejects an archive before directory, port or browser work', () => {
  const data = fixture({ archived: true });
  runWriterPreflight(data, 'record');
  assert.equal(existsSync(join(data.root, '.capture-tmp')), false);
  assert.equal(existsSync(join(data.canonicalDir, 'frames')), false);
});
test('actual MP4 encoder preflight rejects an archive before staging or media work', () => {
  const data = fixture({ archived: true, slug: 'raster-to-vector' });
  runWriterPreflight(data, 'encode');
  assert.equal(existsSync(join(data.canonicalDir, 'frames')), false);
});
test('actual native preflight rejects an archive before profile, display or media work', () => {
  const data = fixture({ archived: true, slug: 'linux-first-document' });
  runWriterPreflight(data, 'native');
  assert.equal(existsSync(join(data.root, '.capture-tmp')), false);
  assert.equal(existsSync(join(data.canonicalDir, 'frames')), false);
});
test('actual encoder reloads the decision before replacing canonical media', () => {
  const data = fixture({ slug: 'raster-to-vector' });
  runWriterPreflight(data, 'encode', { archiveAtEncode: true });
});
