import { FontCatalog } from '@varve/engine/font';
import { addChild, createDocument, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyFontReplacement,
  findRestorableFontReplacement,
  restoreFontReplacement,
} from './applyFontReplacement';

describe('applyFontReplacement', () => {
  it('replaces an exact face in node and rich text data while preserving provenance', () => {
    let doc = createDocument('font-replacement');
    const rootId = doc.pages?.[0]?.contentRoot;
    if (!rootId) throw new Error('fixture page root missing');
    const originalReference = {
      artifactHash: 'a'.repeat(64),
      postScriptName: 'Inter-Bold',
    };
    const replacementReference = {
      artifactHash: 'b'.repeat(64),
      postScriptName: 'NotoSans-Bold',
    };
    const node = makeTextNode('text', 'Hello', {
      fontFamily: 'Inter',
      fontWeight: 700,
      fontReference: originalReference,
    });
    node.richText = {
      paragraphs: [
        {
          runs: [
            {
              text: 'Hello',
              format: { fontFamily: 'Inter', fontReference: originalReference },
            },
          ],
        },
      ],
    };
    doc = addChild(doc, rootId, node);

    const updated = applyFontReplacement(doc, new FontCatalog(), {
      original: 'Inter',
      replacement: 'Noto Sans',
      originalReference,
      replacementReference,
      applyToAll: true,
      preserveOriginalReference: true,
    });
    const replaced = updated.nodes.text;
    if (replaced?.kind !== 'text') throw new Error('text node missing');

    expect(replaced.fontFamily).toBe('Noto Sans');
    expect(replaced.fontReference).toEqual(replacementReference);
    expect(replaced.richText?.paragraphs[0]?.runs[0]?.format).toMatchObject({
      fontFamily: 'Noto Sans',
      fontReference: replacementReference,
    });
    expect(updated.fontManifest?.replacements).toEqual([
      expect.objectContaining({
        original: 'Inter',
        replacement: 'Noto Sans',
        originalReference,
        replacementReference,
      }),
    ]);
  });

  it('keeps provenance for distinct replacement faces of the same family', () => {
    const doc = createDocument('font-replacement-faces');
    const first = {
      original: 'Inter',
      replacement: 'Noto Sans',
      originalReference: { artifactHash: 'a'.repeat(64), collectionIndex: 0 },
      replacementReference: { artifactHash: 'b'.repeat(64), collectionIndex: 0 },
      applyToAll: true,
      preserveOriginalReference: true,
    };
    const second = {
      ...first,
      replacementReference: { artifactHash: 'c'.repeat(64), collectionIndex: 0 },
    };

    const firstUpdated = applyFontReplacement(doc, new FontCatalog(), first);
    const secondUpdated = applyFontReplacement(firstUpdated, new FontCatalog(), second);

    expect(secondUpdated.fontManifest?.replacements).toHaveLength(2);
    expect(
      secondUpdated.fontManifest?.replacements?.map((entry) => entry.replacementReference),
    ).toEqual([first.replacementReference, second.replacementReference]);
  });

  it('restores an exact replacement and removes only its provenance entry', () => {
    let doc = createDocument('font-restore');
    const rootId = doc.pages?.[0]?.contentRoot;
    if (!rootId) throw new Error('fixture page root missing');
    const originalReference = {
      artifactHash: 'a'.repeat(64),
      postScriptName: 'Inter-Bold',
    };
    const replacementReference = {
      artifactHash: 'b'.repeat(64),
      postScriptName: 'NotoSans-Bold',
    };
    const node = makeTextNode('text', 'Hello', {
      fontFamily: 'Noto Sans',
      fontWeight: 700,
      fontReference: replacementReference,
    });
    doc = addChild(doc, rootId, node);
    doc = {
      ...doc,
      fontManifest: {
        version: 2,
        fonts: [],
        replacements: [
          {
            original: 'Inter',
            replacement: 'Noto Sans',
            originalReference,
            replacementReference,
            applyToAll: true,
            preserveOriginalReference: true,
          },
        ],
      },
    };

    const replacement = findRestorableFontReplacement(doc, 'Noto Sans', replacementReference);
    expect(replacement?.original).toBe('Inter');

    const restored = restoreFontReplacement(
      doc,
      new FontCatalog(),
      replacement!,
      replacementReference,
    );
    const restoredNode = restored.nodes.text;
    if (restoredNode?.kind !== 'text') throw new Error('text node missing');
    expect(restoredNode.fontFamily).toBe('Inter');
    expect(restoredNode.fontReference).toEqual(originalReference);
    expect(restored.fontManifest?.replacements ?? []).toEqual([]);
  });

  it('does not guess when family-only replacement history is ambiguous', () => {
    const doc = {
      ...createDocument('font-restore-ambiguous'),
      fontManifest: {
        version: 2 as const,
        fonts: [],
        replacements: [
          {
            original: 'Inter',
            replacement: 'Noto Sans',
            applyToAll: true,
            preserveOriginalReference: true,
          },
          {
            original: 'Arial',
            replacement: 'Noto Sans',
            applyToAll: true,
            preserveOriginalReference: true,
          },
        ],
      },
    };

    expect(findRestorableFontReplacement(doc, 'Noto Sans')).toBeUndefined();
  });
});
