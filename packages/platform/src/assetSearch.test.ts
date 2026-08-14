import { describe, expect, it } from 'vitest';
import { searchAssets } from './assetSearch';
import type { Asset } from './types';

const asset = (id: string, name: string, extra: Partial<Asset> = {}): Asset => ({
  id,
  workspaceId: 'workspace',
  name,
  kind: 'image',
  mimeType: 'image/jpeg',
  size: 1,
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

describe('asset search ranking', () => {
  it('keeps an exact filename ahead of a semantic-only match', () => {
    const results = searchAssets(
      [asset('semantic', 'mountain-sunset.jpg'), asset('exact', 'IMG_4821.jpg')],
      'IMG_4821',
      { semanticRanks: new Map([['semantic', 1]]) },
    );
    expect(results[0]?.asset.id).toBe('exact');
    expect(results[0]?.reasons[0]).toEqual({ lane: 'name', label: 'Exact filename match' });
  });

  it('uses OCR and metadata lanes without summing raw score scales', () => {
    const results = searchAssets(
      [
        asset('ocr', 'scan.png', { ocrText: 'Invoice 8472 customer copy' }),
        asset('tag', 'paper.png', { tags: ['invoice'] }),
      ],
      'invoice 8472',
    );
    expect(results.map((result) => result.asset.id)).toEqual(['ocr', 'tag']);
    expect(results[0]?.reasons.map((reason) => reason.lane)).toContain('ocr');
  });

  it('can add a semantic rank without making it a prerequisite', () => {
    const results = searchAssets(
      [asset('one', 'blue-shape.png'), asset('two', 'texture.png')],
      'orange sunset over mountains',
      {
        semanticRanks: new Map([
          ['two', 1],
          ['one', 2],
        ]),
      },
    );
    expect(results[0]?.asset.id).toBe('two');
    expect(results[0]?.reasons.map((reason) => reason.lane)).toContain('semantic');
  });
});
