import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDocument, type TextNode } from '@varve/scene';
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../../context';
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

function ActivateRange({ id }: { id: string }) {
  const { setSelection, setSelectionRange } = useEditor();
  const activated = useRef(false);
  useEffect(() => {
    if (activated.current) return;
    activated.current = true;
    setSelection(id);
    setSelectionRange({
      start: { paragraphIndex: 0, offset: 0 },
      end: { paragraphIndex: 0, offset: 2 },
    });
  }, [id, setSelection, setSelectionRange]);
  return null;
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

  it('uses the shared switch for rich text editing', () => {
    const node = makeTextNode('t1', 'auto');
    renderSection(<TypographySection nodes={[node]} />);
    const richTextSwitch = screen.getByRole('switch', { name: 'Enable rich text editing' });

    expect(richTextSwitch).not.toBeChecked();
    fireEvent.click(richTextSwitch);
    expect(richTextSwitch).toBeChecked();
  });

  it('formats only the active range from inspector character controls', async () => {
    const node = makeTextNode('t1', 'auto');
    node.richText = {
      paragraphs: [
        {
          runs: [
            { text: 'He', format: { fontWeight: 400 } },
            { text: 'llo', format: { fontWeight: 700 } },
          ],
        },
      ],
    };
    const doc = createDocument('range-inspector', true);
    doc.nodes[node.id] = node;
    doc.rootChildren.push(node.id);
    let latest: TextNode | undefined;
    function LiveSection() {
      const { state } = useEditor();
      latest = state.document.nodes[node.id] as TextNode | undefined;
      return latest ? (
        <>
          <ActivateRange id={node.id} />
          <TypographySection nodes={[latest]} />
        </>
      ) : null;
    }

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <LiveSection />
      </EditorProvider>,
    );

    const size = await screen.findByRole('spinbutton', { name: 'Size (px)' });
    fireEvent.change(size, { target: { value: '24' } });
    fireEvent.blur(size);

    expect(latest?.richText?.paragraphs[0]?.runs).toEqual([
      { text: 'He', format: { fontWeight: 400, fontSize: 24 } },
      { text: 'llo', format: { fontWeight: 700 } },
    ]);
    expect(latest?.fontSize).toBe(16);
  });
});
