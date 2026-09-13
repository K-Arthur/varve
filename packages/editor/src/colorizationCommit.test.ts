import { createDocument, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { commitColorizationResult } from './colorizationCommit';

function imageDocument() {
  const base = createDocument('Colorize', true);
  const image = makeImageShapeNode('image-1', {
    src: 'data:image/png;base64,SOURCE',
    w: 2,
    h: 1,
  });
  return { ...base, rootChildren: ['image-1'], nodes: { 'image-1': image }, nextId: 2 };
}

describe('commitColorizationResult', () => {
  it('stores the materialized output as an embedded asset and inserts a derived layer', () => {
    const result = commitColorizationResult(imageDocument(), {
      sourceId: 'image-1',
      sourceSrc: 'data:image/png;base64,SOURCE',
      dataUrl: 'data:image/png;base64,OUTPUT',
      width: 2,
      height: 1,
      suffix: 'photo-colorize-result',
    });

    expect(result.doc.assets?.[result.assetId]?.dataUrl).toBe('data:image/png;base64,OUTPUT');
    expect(result.doc.rootChildren).toEqual(['image-1', result.nodeId]);
    const output = result.doc.nodes[result.nodeId];
    expect(output?.kind).toBe('shape');
    if (output?.kind !== 'shape') throw new Error('expected derived shape');
    expect(output.fills?.[0]?.image?.assetId).toBe(result.assetId);
  });

  it('rejects a late result after the source fill has changed', () => {
    const changed = {
      ...imageDocument(),
      nodes: {
        'image-1': makeImageShapeNode('image-1', {
          src: 'data:image/png;base64,REPLACED',
          w: 2,
          h: 1,
        }),
      },
    };
    expect(() =>
      commitColorizationResult(changed, {
        sourceId: 'image-1',
        sourceSrc: 'data:image/png;base64,SOURCE',
        dataUrl: 'data:image/png;base64,OUTPUT',
        width: 2,
        height: 1,
        suffix: 'result',
      }),
    ).toThrow('stale');
  });
});
