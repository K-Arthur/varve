import type { NodeId, RichSelection, SceneNode, TextNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  applyTypographyChanges,
  hasSelectedCharacters,
  type TypographyCommandSurface,
  toCharacterFormat,
} from './typographyCommand';

const range = (start: number, end: number): RichSelection => ({
  start: { paragraphIndex: 0, offset: start },
  end: { paragraphIndex: 0, offset: end },
});

function surface(overrides: Partial<TypographyCommandSurface> = {}): TypographyCommandSurface {
  return {
    selectedIds: ['text-1'],
    selectionRange: range(1, 4),
    pendingFormat: null,
    updateNode: vi.fn(),
    applyFormatToSelection: vi.fn(),
    setPendingFormat: vi.fn(),
    groupCompoundOperation: vi.fn((_label, action) => action()),
    ...overrides,
  };
}

describe('typography command adapter', () => {
  it('recognizes expanded and collapsed ranges', () => {
    expect(hasSelectedCharacters(range(1, 4))).toBe(true);
    expect(hasSelectedCharacters(range(2, 2))).toBe(false);
    expect(hasSelectedCharacters(null)).toBe(false);
  });

  it('maps text-node changes to character-format fields', () => {
    const fill = { space: 'rgb' as const, r: 1, g: 2, b: 3, a: 255 };
    expect(
      toCharacterFormat({
        fontFamily: 'Inter',
        fontReference: { artifactHash: 'a'.repeat(64), collectionIndex: 1 },
        fontWeight: 700,
        fontSize: 24,
        fill,
        variableAxes: { wdth: 90 },
      }),
    ).toEqual({
      fontFamily: 'Inter',
      fontReference: { artifactHash: 'a'.repeat(64), collectionIndex: 1 },
      fontWeight: 700,
      fontSize: 24,
      color: fill,
      variableFontSettings: { wdth: 90 },
    });
    expect(toCharacterFormat({})).toBeNull();
  });

  it('formats only the selected characters in one history transaction', () => {
    const current = surface();
    applyTypographyChanges(current, 'text-1', { fontWeight: 700, fontFamily: 'Inter' });

    expect(current.applyFormatToSelection).toHaveBeenCalledWith({
      fontWeight: 700,
      fontFamily: 'Inter',
    });
    expect(current.groupCompoundOperation).toHaveBeenCalledWith('Typography', expect.any(Function));
    expect(current.updateNode).not.toHaveBeenCalled();
  });

  it('stores collapsed-caret formatting without dirtying the document', () => {
    const current = surface({
      selectionRange: range(4, 4),
      pendingFormat: { fontStyle: 'italic' },
    });
    applyTypographyChanges(current, 'text-1', {
      fontWeight: 700,
      fontReference: undefined,
    });

    expect(current.setPendingFormat).toHaveBeenCalledWith({
      fontStyle: 'italic',
      fontWeight: 700,
      fontReference: undefined,
    });
    expect(current.groupCompoundOperation).not.toHaveBeenCalled();
    expect(current.updateNode).not.toHaveBeenCalled();
  });

  it('falls back to a node edit when no text range owns the target', () => {
    const updateNode = vi.fn((_id: NodeId, updater: (node: SceneNode) => SceneNode) => {
      const node = { kind: 'text', id: 'text-1' } as TextNode;
      expect(updater(node)).toMatchObject({ fontSize: 20 });
    });
    const current = surface({ selectionRange: null, updateNode });
    applyTypographyChanges(current, 'text-1', { fontSize: 20 });
    expect(updateNode).toHaveBeenCalledWith('text-1', expect.any(Function));
  });
});
