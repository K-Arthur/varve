import { FontCatalog } from '@varve/engine/font';
import { addChild, createDocument, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyFontReplacement,
  findRestorableFontReplacement,
  restoreFontReplacement,
} from './applyFontReplacement';

describe('applyFontReplacement', () => {
  it('limits a page-scoped replacement to the usage row node ids', () => {
    let doc = createDocument('font-replacement-scope');
    const rootId = doc.pages?.[0]?.contentRoot;
    if (!rootId) throw new Error('fixture page root missing');
    const first = makeTextNode('first', 'First', { fontFamily: 'Inter' });
    const second = makeTextNode('second', 'Second', { fontFamily: 'Inter' });
    doc = addChild(addChild(doc, rootId, first), rootId, second);

    const updated = applyFontReplacement(
      doc,
      new FontCatalog(),
      {
        original: 'Inter',
        replacement: 'Noto Sans',
        applyToAll: true,
        preserveOriginalReference: true,
      },
      { nodeIds: ['first'] },
    );

    expect(updated.nodes.first?.kind).toBe('text');
    expect(
      updated.nodes.first && 'fontFamily' in updated.nodes.first
        ? updated.nodes.first.fontFamily
        : undefined,
    ).toBe('Noto Sans');
    expect(
      updated.nodes.second && 'fontFamily' in updated.nodes.second
        ? updated.nodes.second.fontFamily
        : undefined,
    ).toBe('Inter');
  });

  it('materializes a linked text style only on a scoped node', () => {
    let doc = createDocument('font-replacement-style-scope');
    const rootId = doc.pages?.[0]?.contentRoot;
    if (!rootId) throw new Error('fixture page root missing');
    const styled = makeTextNode('styled', 'Styled', { styleId: 'style-1' });
    const other = makeTextNode('other', 'Other', { styleId: 'style-1' });
    delete styled.fontFamily;
    delete styled.fontReference;
    delete other.fontFamily;
    delete other.fontReference;
    doc = addChild(addChild(doc, rootId, styled), rootId, other);
    doc = {
      ...doc,
      styles: {
        'style-1': {
          id: 'style-1',
          type: 'text',
          name: 'Body',
          fontFamily: 'Inter',
          fontSize: 16,
        },
      },
    };

    const updated = applyFontReplacement(
      doc,
      new FontCatalog(),
      {
        original: 'Inter',
        replacement: 'Noto Sans',
        applyToAll: true,
        preserveOriginalReference: true,
      },
      { nodeIds: ['styled'] },
    );
    const updatedStyled = updated.nodes.styled;
    const updatedOther = updated.nodes.other;

    expect(updatedStyled?.kind).toBe('text');
    expect(
      updatedStyled && 'fontFamily' in updatedStyled ? updatedStyled.fontFamily : undefined,
    ).toBe('Noto Sans');
    expect(
      updatedStyled && 'styleOverrides' in updatedStyled ? updatedStyled.styleOverrides : undefined,
    ).toMatchObject({
      fontFamily: 'Noto Sans',
    });
    expect(updatedOther && 'fontFamily' in updatedOther ? updatedOther.fontFamily : undefined).toBe(
      undefined,
    );
    expect(updated.styles?.['style-1']).toMatchObject({ fontFamily: 'Inter' });
  });

  it('restores a scoped style override without changing its other consumers', () => {
    let doc = createDocument('font-restore-style-scope');
    const rootId = doc.pages?.[0]?.contentRoot;
    if (!rootId) throw new Error('fixture page root missing');
    const styled = makeTextNode('styled', 'Styled', { styleId: 'style-1' });
    const other = makeTextNode('other', 'Other', { styleId: 'style-1' });
    delete styled.fontFamily;
    delete styled.fontReference;
    delete other.fontFamily;
    delete other.fontReference;
    doc = addChild(addChild(doc, rootId, styled), rootId, other);
    doc = {
      ...doc,
      styles: {
        'style-1': {
          id: 'style-1',
          type: 'text',
          name: 'Body',
          fontFamily: 'Inter',
          fontSize: 16,
        },
      },
    };
    const replacement = {
      original: 'Inter',
      replacement: 'Noto Sans',
      applyToAll: true,
      preserveOriginalReference: true,
    };
    const replaced = applyFontReplacement(doc, new FontCatalog(), replacement, {
      nodeIds: ['styled'],
    });
    const restored = restoreFontReplacement(replaced, new FontCatalog(), replacement, undefined, {
      nodeIds: ['styled'],
    });

    expect(
      restored.nodes.styled && 'styleOverrides' in restored.nodes.styled
        ? restored.nodes.styled.styleOverrides
        : undefined,
    ).toMatchObject({ fontFamily: 'Inter' });
    expect(
      restored.nodes.other && 'styleOverrides' in restored.nodes.other
        ? restored.nodes.other.styleOverrides
        : undefined,
    ).toBeUndefined();
    expect(restored.styles?.['style-1']).toMatchObject({ fontFamily: 'Inter' });
  });

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

  it('updates the authoritative linked story for a scoped frame', () => {
    let doc = createDocument('font-replacement-story');
    const rootId = doc.pages?.[0]?.contentRoot;
    if (!rootId) throw new Error('fixture page root missing');
    const first = makeTextNode('story-frame-a', 'Frame A', { fontFamily: 'Old Story' });
    const second = makeTextNode('story-frame-b', 'Frame B', { fontFamily: 'Old Story' });
    doc = addChild(addChild(doc, rootId, first), rootId, second);
    const firstNode = doc.nodes['story-frame-a'];
    const secondNode = doc.nodes['story-frame-b'];
    if (firstNode?.kind !== 'text' || secondNode?.kind !== 'text') {
      throw new Error('story frame nodes missing');
    }
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        'story-frame-a': {
          ...firstNode,
          storyBinding: { storyId: 'story-1', threadIndex: 0 },
        },
        'story-frame-b': {
          ...secondNode,
          storyBinding: { storyId: 'story-1', threadIndex: 1 },
        },
      },
      stories: {
        'story-1': {
          id: 'story-1',
          name: 'Linked story',
          thread: ['story-frame-a', 'story-frame-b'],
          content: {
            paragraphs: [
              {
                runs: [
                  { text: 'Linked copy', format: { fontFamily: 'Old Story', fontWeight: 600 } },
                ],
              },
            ],
          },
        },
      },
    };

    const updated = applyFontReplacement(
      doc,
      new FontCatalog(),
      {
        original: 'Old Story',
        replacement: 'New Story',
        applyToAll: true,
        preserveOriginalReference: false,
      },
      { nodeIds: ['story-frame-a'] },
    );

    expect(updated.stories?.['story-1']?.content.paragraphs[0]?.runs[0]?.format).toMatchObject({
      fontFamily: 'New Story',
      fontWeight: 600,
    });
    expect(updated.stories?.['story-1']?.thread).toEqual(['story-frame-a', 'story-frame-b']);

    const restored = restoreFontReplacement(
      updated,
      new FontCatalog(),
      {
        original: 'Old Story',
        replacement: 'New Story',
        applyToAll: true,
        preserveOriginalReference: false,
      },
      undefined,
      { nodeIds: ['story-frame-a'] },
    );
    expect(restored.stories?.['story-1']?.content.paragraphs[0]?.runs[0]?.format?.fontFamily).toBe(
      'Old Story',
    );
    expect(restored.stories?.['story-1']?.thread).toEqual(['story-frame-a', 'story-frame-b']);
    expect(restored.fontManifest?.replacements ?? []).toEqual([]);
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
