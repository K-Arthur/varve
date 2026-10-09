import type { Document } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  generateAiDisclosureSvgMetadata,
  generateAiDisclosureXmp,
  getDocumentAiDisclosure,
} from './aiDisclosure';

describe('getDocumentAiDisclosure', () => {
  it('returns null for documents without generative edits', () => {
    const doc: Partial<Document> = {
      version: 226,
      name: 'Test',
      generativeEdits: undefined,
    };
    expect(getDocumentAiDisclosure(doc as Document)).toBeNull();
  });

  it('returns null for documents with empty generative edits', () => {
    const doc: Partial<Document> = {
      version: 226,
      name: 'Test',
      generativeEdits: {},
    };
    expect(getDocumentAiDisclosure(doc as Document)).toBeNull();
  });

  it('extracts AI disclosure for document with generative edits', () => {
    const doc: Partial<Document> = {
      version: 226,
      name: 'Test',
      generativeEdits: {
        'edit-1': {
          mode: 'fill',
          sourceNodeId: 'node-1',
          resultNodeId: 'node-2',
          provider: {
            runtime: 'onnx',
            modelId: 'lama',
          },
          updatedAt: Date.now(),
        } as any,
        'edit-2': {
          mode: 'remove',
          sourceNodeId: 'node-3',
          resultNodeId: 'node-4',
          provider: {
            runtime: 'patchmatch',
            modelId: null,
          },
          updatedAt: Date.now(),
        } as any,
      },
    };

    const disclosure = getDocumentAiDisclosure(doc as Document);
    expect(disclosure).not.toBeNull();
    expect(disclosure!.digitalSourceType).toBe(
      'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
    );
    expect(disclosure!.tools).toContain('AI Fill');
    expect(disclosure!.tools).toContain('AI Remove');
    expect(disclosure!.description).toContain('AI Fill');
    expect(disclosure!.description).toContain('lama');
    expect(disclosure!.description).toContain('PatchMatch');
  });

  it('filters tools by provided node IDs', () => {
    const doc: Partial<Document> = {
      version: 226,
      name: 'Test',
      generativeEdits: {
        'edit-1': {
          mode: 'fill',
          sourceNodeId: 'node-1',
          resultNodeId: 'node-2',
          provider: { runtime: 'onnx', modelId: 'lama' },
          updatedAt: Date.now(),
        } as any,
        'edit-2': {
          mode: 'remove',
          sourceNodeId: 'node-3',
          resultNodeId: 'node-4',
          provider: { runtime: 'patchmatch', modelId: null },
          updatedAt: Date.now(),
        } as any,
      },
    };

    // Only check node-2 (result of fill operation)
    const disclosure = getDocumentAiDisclosure(doc as Document, ['node-2']);
    expect(disclosure).not.toBeNull();
    expect(disclosure!.tools).toEqual(['AI Fill']);
    expect(disclosure!.tools).not.toContain('AI Remove');
  });
});

describe('generateAiDisclosureXmp', () => {
  it('generates valid XMP with IPTC DigitalSourceType', () => {
    const disclosure = {
      digitalSourceType:
        'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
      description: 'AI tools used: AI Fill (models: lama)',
      tools: ['AI Fill'],
    };

    const xmp = generateAiDisclosureXmp(disclosure);
    expect(xmp).toContain('<?xpacket begin');
    expect(xmp).toContain('<?xpacket end="w"?>');
    expect(xmp).toContain('Iptc4xmpExt:DigitalSourceType');
    expect(xmp).toContain(disclosure.digitalSourceType);
    expect(xmp).toContain('dc:description');
    expect(xmp).toContain('AI Fill');
    expect(xmp).toContain('lama');
  });

  it('escapes XML special characters in description', () => {
    const disclosure = {
      digitalSourceType:
        'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
      description: 'Tools: <AI> & "Generative Edit"',
      tools: ['AI Fill'],
    };

    const xmp = generateAiDisclosureXmp(disclosure);
    expect(xmp).toContain('&lt;AI&gt;');
    expect(xmp).toContain('&amp;');
    expect(xmp).toContain('&quot;');
    expect(xmp).not.toContain('<AI>');
  });
});

describe('generateAiDisclosureSvgMetadata', () => {
  it('generates valid SVG metadata element', () => {
    const disclosure = {
      digitalSourceType:
        'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
      description: 'AI tools used: AI Fill (models: lama)',
      tools: ['AI Fill'],
    };

    const metadata = generateAiDisclosureSvgMetadata(disclosure);
    expect(metadata).toContain('<metadata>');
    expect(metadata).toContain('</metadata>');
    expect(metadata).toContain('rdf:RDF');
    expect(metadata).toContain('Iptc4xmpExt:DigitalSourceType');
    expect(metadata).toContain(disclosure.digitalSourceType);
    expect(metadata).toContain('dc:description');
    expect(metadata).toContain('AI Fill');
  });

  it('escapes XML special characters', () => {
    const disclosure = {
      digitalSourceType:
        'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
      description: 'Tools: <AI> & "Generative Edit"',
      tools: ['AI Fill'],
    };

    const metadata = generateAiDisclosureSvgMetadata(disclosure);
    expect(metadata).toContain('&lt;AI&gt;');
    expect(metadata).toContain('&amp;');
    expect(metadata).toContain('&quot;');
  });
});
