import { createDocument, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { commitColorizationResult, planColorizeApply } from './colorizationCommit';

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

describe('planColorizeApply', () => {
  const base = {
    expectedSignature: 'sig-1',
    sourceSrc: 'data:image/png;base64,SOURCE',
    fullWidth: 4000,
    fullHeight: 3000,
    hasPreviewImage: true,
    hasPreviewChroma: true,
  };

  it('reuses the preview pixels when the preview already ran at source size', () => {
    expect(
      planColorizeApply({
        ...base,
        previewSignature: 'sig-1',
        previewSourceSrc: base.sourceSrc,
        previewWidth: 4000,
        previewHeight: 3000,
      }),
    ).toBe('reuse-preview-image');
  });

  it('reuses the approved chroma when the preview is smaller than the source', () => {
    expect(
      planColorizeApply({
        ...base,
        previewSignature: 'sig-1',
        previewSourceSrc: base.sourceSrc,
        previewWidth: 1024,
        previewHeight: 768,
      }),
    ).toBe('reuse-preview-chroma');
  });

  it('falls back to a full rerun when the controls changed', () => {
    expect(
      planColorizeApply({
        ...base,
        previewSignature: 'sig-0',
        previewSourceSrc: base.sourceSrc,
        previewWidth: 1024,
        previewHeight: 768,
      }),
    ).toBe('rerun');
  });

  it('falls back to a full rerun when the source changed', () => {
    expect(
      planColorizeApply({
        ...base,
        previewSignature: 'sig-1',
        previewSourceSrc: 'data:image/png;base64,OTHER',
        previewWidth: 1024,
        previewHeight: 768,
      }),
    ).toBe('rerun');
  });

  it('falls back to a full rerun when neither preview pixels nor chroma are available', () => {
    expect(
      planColorizeApply({
        ...base,
        previewSignature: 'sig-1',
        previewSourceSrc: base.sourceSrc,
        previewWidth: 1024,
        previewHeight: 768,
        hasPreviewImage: false,
        hasPreviewChroma: false,
      }),
    ).toBe('rerun');
  });
});
