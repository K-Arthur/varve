import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertRetainedDocument } from './retained-document.mjs';

const original = JSON.parse(
  readFileSync('tests/e2e/fixtures/published-v021/poster-embedded.varve', 'utf8'),
);
assertRetainedDocument(original, original, { schema: '2.21', seed: true });
const migrated = structuredClone(original);
migrated.formatVersion = '2.33';
migrated.designCanvases = [{ id: 'canvas-1' }];
migrated.nodes['poster-curve'].strokes[0].id = 'stroke-poster-curve-0';
const check = (doc) => assertRetainedDocument(doc, original, { schema: '2.33', seed: false });
check(migrated);
for (const mutate of [
  (doc) => delete doc.nodes['poster-curve'].strokes[0].id,
  (doc) => {
    doc.nodes['poster-curve'].strokes[0].id = 'wrong-stroke';
  },
  (doc) => {
    doc.nodes['poster-curve'].strokes[0].weight += 1;
  },
  (doc) => {
    doc.nodes['poster-curve'].strokes[0].color.r += 1;
  },
  (doc) => {
    doc.nodes['poster-curve'].strokes = [];
  },
  (doc) => {
    doc.nodes['poster-curve'].shape.points[0].handleOut[0] += 1;
  },
  (doc) => {
    doc.nodes['poster-title'].text = 'lost text';
  },
  (doc) => {
    doc.nodes['published-embedded-image'].transform[4] += 1;
  },
  (doc) => {
    doc.assets['asset-ca2aceaaa125b46e'].dataUrl = 'lost asset';
  },
  (doc) => {
    doc.designCanvases = [];
  },
  (doc) => {
    doc.formatVersion = '2.21';
  },
]) {
  const corrupted = structuredClone(migrated);
  mutate(corrupted);
  assert.throws(() => check(corrupted), assert.AssertionError, 'content corruption remains fatal');
}
const identified = structuredClone(original);
identified.nodes['poster-curve'].strokes[0].id = 'authored-stroke';
const identifiedMigration = structuredClone(migrated);
identifiedMigration.nodes['poster-curve'].strokes[0].id = 'authored-stroke';
assertRetainedDocument(identifiedMigration, identified, { schema: '2.33', seed: false });
assert.throws(
  () => assertRetainedDocument(migrated, identified, { schema: '2.33', seed: false }),
  assert.AssertionError,
  'existing authored stroke identities must be preserved',
);
console.log(
  'Published-document content, required legacy stroke IDs and corruption rejection passed.',
);
