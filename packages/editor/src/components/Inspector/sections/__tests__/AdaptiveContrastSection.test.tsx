import type { TextNode } from '@strata/scene';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdaptiveContrastSection } from '../AdaptiveContrastSection';

vi.mock('../../../../context', () => ({
  useEditor: () => {
    const mockSetTextAdaptiveContrast = vi.fn();
    return {
      state: {
        document: { nodes: {} },
        sectionVisibility: {},
      },
      setTextAdaptiveContrast: mockSetTextAdaptiveContrast,
      toggleSectionCollapse: vi.fn(),
      toggleSubSectionCollapse: vi.fn(),
    };
  },
}));

function makeTextNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: 'text1',
    kind: 'text',
    name: 'My Text',
    text: 'Hello',
    transform: [1, 0, 0, 1, 0, 0] as TextNode['transform'],
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 1.2,
    letterSpacing: 0,
    textAlign: 'left',
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    layerColor: null,
    order: 'a0',
    ...overrides,
  };
}

describe('AdaptiveContrastSection', () => {
  it('renders nothing for non-text nodes', () => {
    const { container } = render(
      <AdaptiveContrastSection nodes={[{ kind: 'shape', id: 's1', name: 'Shape' } as never]} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders a section for text nodes', () => {
    const { container } = render(<AdaptiveContrastSection nodes={[makeTextNode()]} />);
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it('handles MIXED state when nodes differ', () => {
    const t1 = makeTextNode({
      id: 't1',
      adaptiveContrast: { enabled: true, policy: 'wcag-aa' },
    });
    const t2 = makeTextNode({
      id: 't2',
      adaptiveContrast: { enabled: false, policy: 'wcag-aaa' },
    });
    const { container } = render(<AdaptiveContrastSection nodes={[t1, t2]} />);
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
});
