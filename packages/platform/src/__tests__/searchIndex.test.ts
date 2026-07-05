import { describe, expect, it } from 'vitest';
import {
  type ContentSearchMatch,
  indexDocumentContent,
  searchAllContent,
  searchContentIndex,
} from '../searchIndex';

const SAMPLE_DOC = JSON.stringify({
  id: 'doc1',
  name: 'Test Design',
  nodes: {
    n1: { id: 'n1', name: 'Header', kind: 'frame', children: ['n2'] },
    n2: { id: 'n2', name: 'Title', kind: 'text', text: 'Welcome to Strata' },
    n3: { id: 'n3', name: 'Button', kind: 'rect', text: 'Click Me' },
    n4: { id: 'n4', name: 'Icon placeholder', kind: 'rect' },
  },
  components: {
    c1: { id: 'c1', name: 'PrimaryButton' },
  },
  nextId: 5,
});

describe('searchIndex', () => {
  it('indexes node names', () => {
    const idx = indexDocumentContent('f1', SAMPLE_DOC);
    const results = searchContentIndex(idx, 'Header');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.nodeName === 'Header')).toBe(true);
  });

  it('indexes text content', () => {
    const idx = indexDocumentContent('f1', SAMPLE_DOC);
    const results = searchContentIndex(idx, 'Welcome');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.matchType === 'text')).toBe(true);
  });

  it('indexes component names', () => {
    const idx = indexDocumentContent('f1', SAMPLE_DOC);
    const results = searchContentIndex(idx, 'PrimaryButton');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.matchType === 'component')).toBe(true);
  });

  it('returns empty for no match', () => {
    const idx = indexDocumentContent('f1', SAMPLE_DOC);
    const results = searchContentIndex(idx, 'NonExistentTerm');
    expect(results.length).toBe(0);
  });

  it('returns empty for empty query', () => {
    const idx = indexDocumentContent('f1', SAMPLE_DOC);
    const results = searchContentIndex(idx, '');
    expect(results.length).toBe(0);
  });

  it('handles invalid JSON gracefully', () => {
    const idx = indexDocumentContent('f1', 'not valid json');
    expect(idx.size).toBe(0);
  });

  it('handles empty document', () => {
    const idx = indexDocumentContent('f1', '{}');
    expect(idx.size).toBe(0);
  });

  it('searches across multiple files', () => {
    const indexes = new Map<string, Map<string, ContentSearchMatch>>();
    indexes.set('f1', indexDocumentContent('f1', SAMPLE_DOC));

    const doc2 = JSON.stringify({
      id: 'doc2',
      nodes: {
        n1: { id: 'n1', name: 'Footer', kind: 'frame' },
      },
    });
    indexes.set('f2', indexDocumentContent('f2', doc2));

    const results = searchAllContent(indexes, 'Footer');
    expect(results.length).toBe(1);
    expect(results[0]!.nodeName).toBe('Footer');
  });

  it('deduplicates results across files', () => {
    const indexes = new Map<string, Map<string, ContentSearchMatch>>();
    indexes.set('f1', indexDocumentContent('f1', SAMPLE_DOC));
    indexes.set('f2', indexDocumentContent('f2', SAMPLE_DOC)); // same content

    const results = searchAllContent(indexes, 'Header');
    // Should have 2 results (one per file) but not duplicated within a file
    expect(results.length).toBe(2);
  });
});
