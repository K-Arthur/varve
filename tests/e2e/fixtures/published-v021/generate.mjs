/** Reproduce a schema 2.21 document using the published 0.2.1 factories. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../..');
const revision = 'd47cea2b9ba15e3a0d824dfc3e979eb68afe8375';
const originalPath = 'scripts/screenshots/fixtures/poster.varve';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readPublished = (path) => execFileSync('git', ['show', `${revision}:${path}`], { cwd: root });
const original = readPublished(originalPath);
const document = JSON.parse(original);
if (document.formatVersion !== '2.21') throw new Error('Published source is not schema 2.21');
const factories = [];

async function publishedFunctions(path, names) {
  const bytes = readPublished(path);
  const source = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  const declarations = source.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text),
  );
  if (declarations.length !== names.length) throw new Error(`Missing published factory in ${path}`);
  factories.push({ path, sha256: hash(bytes), functions: names });
  const output = ts.transpileModule(declarations.map((node) => node.getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const assets = await publishedFunctions('packages/scene/src/assets.ts', [
  'hashContent',
  'decodedDataUrlByteLength',
  'createEmbeddedAsset',
]);
const fills = await publishedFunctions('packages/scene/src/fills.ts', ['imageFill']);
const nodes = await publishedFunctions('packages/scene/src/document.ts', ['makeShapeNode']);
const require = createRequire(resolve(root, 'packages/engine/package.json'));
const { PNG } = require('pngjs');
const png = new PNG({ width: 16, height: 16 });
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const offset = (y * 16 + x) * 4;
    png.data.set(x < 8 === y < 8 ? [32, 96, 224, 255] : [240, 176, 32, 255], offset);
  }
}
const imageBytes = PNG.sync.write(png);
const dataUrl = `data:image/png;base64,${imageBytes.toString('base64')}`;
const asset = assets.createEmbeddedAsset({
  dataUrl,
  mimeType: 'image/png',
  naturalWidth: 16,
  naturalHeight: 16,
});
const image = nodes.makeShapeNode(
  'published-embedded-image',
  { kind: 'rect', x: 0, y: 0, w: 104, h: 80 },
  { name: 'Published embedded image', transform: [1, 0, 0, 1, 658, 68], order: 'aa' },
);
image.fills = [fills.imageFill('', { assetId: asset.id, imageWidth: 16, imageHeight: 16 })];
document.nodes[image.id] = image;
document.nodes['poster-frame'].children.push(image.id);
document.assets = { [asset.id]: asset };
const fixture = `${JSON.stringify(document)}\n`;
writeFileSync(resolve(directory, 'poster-embedded.varve'), fixture);
writeFileSync(
  resolve(directory, 'provenance.json'),
  `${JSON.stringify(
    {
      sourceTag: 'v0.2.1',
      sourceRevision: revision,
      sourceDocument: { path: originalPath, sha256: hash(original) },
      sourceSchema: document.formatVersion,
      factories,
      syntheticAsset: {
        description: '16x16 opaque blue/amber quadrants generated locally; no external image',
        sha256: hash(imageBytes),
        assetId: asset.id,
      },
      fixture: { file: 'poster-embedded.varve', sha256: hash(fixture) },
    },
    null,
    2,
  )}\n`,
);
