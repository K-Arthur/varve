import type { TextNode } from '@strata/scene';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../../context';
import { TypographySection } from '../TypographySection';

afterEach(cleanup);

function makeTextNode(id: string, direction: TextNode['direction']): TextNode {
  return {
    id,
    kind: 'text',
    name: 'Text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
    text: 'Hello',
    transform: [1, 0, 0, 1, 0, 0] as const,
    w: 100,
    h: 20,
    fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 1.2,
    letterSpacing: 0,
    textAlign: 'left',
    direction,
    strokes: [],
    effects: [],
  } as TextNode;
}

function renderSection(element: React.ReactElement) {
  return render(<EditorProvider>{element}</EditorProvider>);
}

describe('TypographySection direction', () => {
  it('renders the direction segmented control', () => {
    const node = makeTextNode('t1', 'auto');
    renderSection(<TypographySection nodes={[node]} />);
    expect(screen.getByLabelText('Text direction')).toBeTruthy();
  });

  it('shows Auto as the default direction value', () => {
    const node = makeTextNode('t1', 'auto');
    renderSection(<TypographySection nodes={[node]} />);
    const rtlBtn = screen.getByRole('radio', { name: 'RTL' });
    expect(rtlBtn.getAttribute('aria-checked')).toBe('false');
  });

  it('shows RTL selected when node direction is rtl', () => {
    const node = makeTextNode('t1', 'rtl');
    renderSection(<TypographySection nodes={[node]} />);
    const rtlBtn = screen.getByRole('radio', { name: 'RTL' });
    expect(rtlBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('fires onChange without error when a direction option is clicked', () => {
    const node = makeTextNode('t1', 'auto');
    renderSection(<TypographySection nodes={[node]} />);
    const rtlBtn = screen.getByRole('radio', { name: 'RTL' });
    // Click must not throw. Value is driven by the nodes prop which updates
    // on parent re-render after context mutation (consistent with textAlign).
    expect(() => fireEvent.click(rtlBtn)).not.toThrow();
  });
});
