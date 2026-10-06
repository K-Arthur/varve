import assert from 'node:assert/strict';

// Independently check the published fixture's authored content. Current codecs
// add deterministic stroke identities; they must not change stroke appearance,
// curve geometry, embedded bytes or the image's placement.
export function assertRetainedDocument(doc, original, { schema, seed }) {
  assert.equal(doc.formatVersion, schema);
  assert.equal(doc.nodes['poster-title'].text, original.nodes['poster-title'].text);
  const curve = original.nodes['poster-curve'];
  for (const [key, value] of Object.entries(curve)) {
    const expected =
      key === 'strokes' && !seed
        ? value.map((stroke, index) => ({
            ...stroke,
            id: stroke.id || `stroke-${curve.id}-${index}`,
          }))
        : value;
    assert.deepEqual(doc.nodes['poster-curve'][key], expected, `authored curve ${key}`);
  }
  assert.deepEqual(
    doc.nodes['published-embedded-image'].transform,
    original.nodes['published-embedded-image'].transform,
  );
  assert.equal(
    doc.assets['asset-ca2aceaaa125b46e'].dataUrl,
    original.assets['asset-ca2aceaaa125b46e'].dataUrl,
  );
  if (!seed)
    assert.equal(doc.designCanvases.length, 1, 'current migration creates the design canvas');
}
