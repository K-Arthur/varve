import type { NodeId, RichSelection, SceneNode, TextNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  applyTypographyChanges,
  hasSelectedCharacters,
  type TypographyCommandSurface,
  toCharacterFormat,
  typographyDisplayValues,
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
        lineHeight: 1.35,
        tracking: 18,
        fill,
        variableAxes: { wdth: 90 },
      }),
    ).toEqual({
      fontFamily: 'Inter',
      fontReference: { artifactHash: 'a'.repeat(64), collectionIndex: 1 },
      fontWeight: 700,
      fontSize: 24,
      lineHeight: 1.35,
      tracking: 18,
      color: fill,
      variableFontSettings: { wdth: 90 },
    });
    expect(toCharacterFormat({})).toBeNull();
  });

  it('routes inspector spacing changes through a selected rich range', () => {
    const current = surface();
    applyTypographyChanges(current, 'text-1', { lineHeight: 1.4, tracking: 24 });

    expect(current.applyFormatToSelection).toHaveBeenCalledWith({
      lineHeight: 1.4,
      tracking: 24,
    });
    expect(current.updateNode).not.toHaveBeenCalled();
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

  it('carries family replacement through as an explicit axis reset', () => {
    const current = surface();
    applyTypographyChanges(current, 'text-1', {
      fontFamily: 'Inter',
      fontReference: undefined,
      variableAxes: undefined,
    });

    expect(current.applyFormatToSelection).toHaveBeenCalledWith({
      fontFamily: 'Inter',
      fontReference: undefined,
      variableFontSettings: undefined,
    });
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

  it('shows effective mixed values from the active rich-text range', () => {
    const node = {
      fontFamily: 'Inter',
      fontWeight: 400,
      fontStyle: 'normal' as const,
      fontSize: 16,
      variableAxes: { opsz: 14 },
      richText: {
        paragraphs: [
          {
            runs: [
              { text: 'ab', format: { fontFamily: 'Inter', fontWeight: 400 } },
              { text: 'cd', format: { fontFamily: 'Georgia', fontWeight: 700 } },
            ],
          },
        ],
      },
    } as unknown as TextNode;

    const display = typographyDisplayValues(node, range(1, 4));

    expect(display.values.fontFamily).toBe('Inter');
    expect(display.values.fontWeight).toBe(400);
    expect(display.mixed.fontFamily).toBe(true);
    expect(display.mixed.fontWeight).toBe(true);
    expect(display.effectiveNodes).toEqual([
      {
        fontFamily: 'Inter',
        fontReference: undefined,
        fontWeight: 400,
        fontStyle: 'normal',
        variableAxes: { opsz: 14 },
      },
      {
        fontFamily: 'Georgia',
        fontReference: undefined,
        fontWeight: 700,
        fontStyle: 'normal',
        variableAxes: { opsz: 14 },
      },
    ]);
  });

  it('uses pending insertion formatting at a collapsed caret', () => {
    const node = {
      fontFamily: 'Inter',
      fontWeight: 400,
      fontStyle: 'normal' as const,
      fontSize: 16,
      richText: { paragraphs: [{ runs: [{ text: 'abc' }] }] },
    } as unknown as TextNode;

    const display = typographyDisplayValues(node, range(3, 3), {
      fontFamily: 'Georgia',
      fontWeight: 700,
      variableFontSettings: { wdth: 90 },
    });

    expect(display.values).toMatchObject({
      fontFamily: 'Georgia',
      fontWeight: 700,
      variableAxes: { wdth: 90 },
    });
    expect(display.mixed).toEqual({});
    expect(display.effectiveNodes).toEqual([
      {
        fontFamily: 'Georgia',
        fontReference: undefined,
        fontWeight: 700,
        fontStyle: 'normal',
        variableAxes: { wdth: 90 },
      },
    ]);
  });
});
