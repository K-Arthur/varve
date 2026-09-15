import { describe, expect, it } from 'vitest';
import {
  appendFrame,
  createChain,
  detectOverset,
  insertFrame,
  isChainHead,
  isChainTail,
  nextFrame,
  previousFrame,
  removeFrame,
  reorderFrame,
  splitRichTextByCharLimit,
} from './textFlow';
import { plainTextToRichText } from './typography';

describe('createChain', () => {
  it('creates a chain with given id and name', () => {
    const chain = createChain('c1', 'Story 1');
    expect(chain.id).toBe('c1');
    expect(chain.name).toBe('Story 1');
    expect(chain.frameIds).toEqual([]);
  });

  it('creates a chain with initial frame ids', () => {
    const chain = createChain('c1', 'Story', ['f1', 'f2']);
    expect(chain.frameIds).toEqual(['f1', 'f2']);
  });
});

describe('appendFrame', () => {
  it('appends a frame to the end', () => {
    const chain = createChain('c1', 'S', ['f1']);
    const updated = appendFrame(chain, 'f2');
    expect(updated.frameIds).toEqual(['f1', 'f2']);
  });

  it('does not duplicate existing frames', () => {
    const chain = createChain('c1', 'S', ['f1', 'f2']);
    const updated = appendFrame(chain, 'f1');
    expect(updated.frameIds).toEqual(['f1', 'f2']);
  });
});

describe('insertFrame', () => {
  it('inserts at the beginning when no afterFrameId', () => {
    const chain = createChain('c1', 'S', ['f2', 'f3']);
    const updated = insertFrame(chain, 'f1');
    expect(updated.frameIds).toEqual(['f1', 'f2', 'f3']);
  });

  it('inserts after the specified frame', () => {
    const chain = createChain('c1', 'S', ['f1', 'f3']);
    const updated = insertFrame(chain, 'f2', 'f1');
    expect(updated.frameIds).toEqual(['f1', 'f2', 'f3']);
  });

  it('appends if afterFrameId not found', () => {
    const chain = createChain('c1', 'S', ['f1']);
    const updated = insertFrame(chain, 'f2', 'nonexistent');
    expect(updated.frameIds).toEqual(['f1', 'f2']);
  });
});

describe('removeFrame', () => {
  it('removes a frame from the chain', () => {
    const chain = createChain('c1', 'S', ['f1', 'f2', 'f3']);
    const updated = removeFrame(chain, 'f2');
    expect(updated.frameIds).toEqual(['f1', 'f3']);
  });
});

describe('reorderFrame', () => {
  it('moves a frame to a new position', () => {
    const chain = createChain('c1', 'S', ['f1', 'f2', 'f3']);
    const updated = reorderFrame(chain, 'f3', 0);
    expect(updated.frameIds).toEqual(['f3', 'f1', 'f2']);
  });

  it('clamps index to valid range', () => {
    const chain = createChain('c1', 'S', ['f1', 'f2']);
    const updated = reorderFrame(chain, 'f1', 99);
    expect(updated.frameIds).toEqual(['f2', 'f1']);
  });
});

describe('isChainHead / isChainTail', () => {
  it('identifies head and tail', () => {
    const chain = createChain('c1', 'S', ['f1', 'f2', 'f3']);
    expect(isChainHead(chain, 'f1')).toBe(true);
    expect(isChainHead(chain, 'f2')).toBe(false);
    expect(isChainTail(chain, 'f3')).toBe(true);
    expect(isChainTail(chain, 'f2')).toBe(false);
  });
});

describe('nextFrame / previousFrame', () => {
  it('returns next frame in chain', () => {
    const chain = createChain('c1', 'S', ['f1', 'f2', 'f3']);
    expect(nextFrame(chain, 'f1')).toBe('f2');
    expect(nextFrame(chain, 'f3')).toBeUndefined();
  });

  it('returns previous frame in chain', () => {
    const chain = createChain('c1', 'S', ['f1', 'f2', 'f3']);
    expect(previousFrame(chain, 'f2')).toBe('f1');
    expect(previousFrame(chain, 'f1')).toBeUndefined();
  });
});

describe('detectOverset', () => {
  it('returns undefined when text fits', () => {
    const chain = createChain('c1', 'S', ['f1']);
    expect(detectOverset(chain, 'f1', 100, 50)).toBeUndefined();
  });

  it('returns undefined when not last frame', () => {
    const chain = createChain('c1', 'S', ['f1', 'f2']);
    expect(detectOverset(chain, 'f1', 50, 100)).toBeUndefined();
  });

  it('returns overset info when last frame overflows', () => {
    const chain = createChain('c1', 'S', ['f1', 'f2']);
    const info = detectOverset(chain, 'f2', 50, 100);
    expect(info).toBeDefined();
    expect(info?.oversetChars).toBe(50);
    expect(info?.isLastFrame).toBe(true);
  });
});

describe('splitRichTextByCharLimit', () => {
  it('returns all fitted when under limit', () => {
    const rich = plainTextToRichText('Hello\nWorld');
    const { fitted, overset } = splitRichTextByCharLimit(rich, 100);
    expect(fitted.paragraphs).toHaveLength(2);
    expect(overset.paragraphs).toHaveLength(0);
  });

  it('splits at paragraph boundary', () => {
    const rich = plainTextToRichText('Hello\nWorld');
    const { fitted, overset } = splitRichTextByCharLimit(rich, 5);
    expect(fitted.paragraphs).toHaveLength(1);
    expect(overset.paragraphs).toHaveLength(1);
    expect(overset.paragraphs[0]?.runs[0]?.text).toBe('World');
  });

  it('splits within a paragraph at run boundary', () => {
    const rich = {
      paragraphs: [{ runs: [{ text: 'Hel' }, { text: 'lo' }, { text: 'World' }] }],
    };
    const { fitted, overset } = splitRichTextByCharLimit(rich, 5);
    expect(fitted.paragraphs[0]?.runs.map((r) => r.text).join('')).toBe('Hello');
    expect(overset.paragraphs[0]?.runs.map((r) => r.text).join('')).toBe('World');
  });

  it('splits within a run when needed', () => {
    const rich = plainTextToRichText('HelloWorld');
    const { fitted, overset } = splitRichTextByCharLimit(rich, 5);
    expect(fitted.paragraphs[0]?.runs[0]?.text).toBe('Hello');
    expect(overset.paragraphs[0]?.runs[0]?.text).toBe('World');
  });
});
