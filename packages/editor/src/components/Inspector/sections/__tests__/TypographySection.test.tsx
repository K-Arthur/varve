import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDocument, type TextNode } from '@varve/scene';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../../context';
import { TypographySection } from '../TypographySection';

afterEach(cleanup);

// Section collapse state persists into localStorage; start each test from the
// registry defaults so the progressive-disclosure contract is what is tested.
beforeEach(() => {
  localStorage.clear();
});

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

/**
 * Direction, writing mode, case, and the other uncommon controls now live in
 * the collapsed "Advanced typography" subsection so the default panel stays
 * scannable. Tests that exercise them open the subsection first.
 */
function expandAdvancedTypography() {
  const trigger = screen.getByRole('button', { name: /advanced typography/i });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
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
    expandAdvancedTypography();
    expect(screen.getByLabelText('Text direction')).toBeTruthy();
  });

  it('shows Auto as the default direction value', () => {
    const node = makeTextNode('t1', 'auto');
    renderSection(<TypographySection nodes={[node]} />);
    expandAdvancedTypography();
    const rtlBtn = screen.getByRole('radio', { name: 'RTL' });
    expect(rtlBtn.getAttribute('aria-checked')).toBe('false');
  });

  it('shows RTL selected when node direction is rtl', () => {
    const node = makeTextNode('t1', 'rtl');
    renderSection(<TypographySection nodes={[node]} />);
    expandAdvancedTypography();
    const rtlBtn = screen.getByRole('radio', { name: 'RTL' });
    expect(rtlBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('fires onChange without error when a direction option is clicked', () => {
    const node = makeTextNode('t1', 'auto');
    renderSection(<TypographySection nodes={[node]} />);
    expandAdvancedTypography();
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

describe('TypographySection progressive disclosure', () => {
  it('pairs common typography controls without changing their semantics', () => {
    const node = makeTextNode('t1', 'auto');
    const { container } = renderSection(<TypographySection nodes={[node]} />);

    expect(container.querySelectorAll('.typography__paired-fields')).toHaveLength(2);
    expect(screen.getByRole('combobox', { name: 'Font weight' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Size (px)' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Line height (%)' })).toBeInTheDocument();
  });

  it('keeps uncommon controls collapsed behind "Advanced typography"', () => {
    const node = makeTextNode('t1', 'auto');
    renderSection(<TypographySection nodes={[node]} />);

    // Primary spine is visible.
    expect(screen.getByLabelText('Text content')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Horizontal align' })).toBeTruthy();
    // Advanced rows are not mounted until asked for.
    expect(screen.queryByText('Paragraph spacing')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Text case')).not.toBeInTheDocument();

    expandAdvancedTypography();

    expect(screen.getByRole('spinbutton', { name: 'Paragraph spacing (px)' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Text case' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Text direction' })).toBeTruthy();
  });

  it('names each alignment option instead of a single letter', () => {
    const node = makeTextNode('t1', 'auto');
    renderSection(<TypographySection nodes={[node]} />);

    for (const name of ['Align left', 'Align center', 'Align right', 'Justify']) {
      expect(screen.getByRole('radio', { name })).toBeTruthy();
    }
    // The old single-letter labels are gone.
    expect(screen.queryByRole('radio', { name: 'L' })).not.toBeInTheDocument();
  });

  it('hides vertical align for point text and shows it for area text', () => {
    const point = makeTextNode('t1', 'auto');
    point.textResizing = 'autoWidth';
    const { unmount } = renderSection(<TypographySection nodes={[point]} />);
    expandAdvancedTypography();
    expect(
      screen.queryByRole('radiogroup', { name: 'Text vertical align' }),
    ).not.toBeInTheDocument();
    unmount();

    const area = makeTextNode('t2', 'auto');
    area.textResizing = 'fixed';
    renderSection(<TypographySection nodes={[area]} />);
    expandAdvancedTypography();
    expect(screen.getByRole('radiogroup', { name: 'Text vertical align' })).toBeTruthy();
  });

  it('only offers vertical orientation when the text is written vertically', () => {
    const horizontal = makeTextNode('t1', 'auto');
    const { unmount } = renderSection(<TypographySection nodes={[horizontal]} />);
    expandAdvancedTypography();
    expect(
      screen.queryByRole('combobox', { name: 'Vertical text orientation' }),
    ).not.toBeInTheDocument();
    unmount();

    const vertical = makeTextNode('t2', 'auto');
    vertical.writingMode = 'vertical-rl';
    renderSection(<TypographySection nodes={[vertical]} />);
    expandAdvancedTypography();
    expect(screen.getByRole('combobox', { name: 'Vertical text orientation' })).toBeTruthy();
  });

  it('shows a count badge when the layer already uses advanced properties', () => {
    const node = makeTextNode('t1', 'auto');
    node.textCase = 'uppercase';
    node.tracking = 50;
    renderSection(<TypographySection nodes={[node]} />);

    expect(screen.getByText('2 set')).toBeInTheDocument();
  });
});

describe('TypographySection colour entry point', () => {
  it('shows the text fill colour as a view of the Fill model', () => {
    const node = makeTextNode('t1', 'auto');
    renderSection(<TypographySection nodes={[node]} />);

    expect(screen.getByText('Colour')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text colour' })).toBeInTheDocument();
    // rgb(16, 21, 31) from the fixture, formatted the way paint rows format it.
    expect(screen.getByText(/#10151f/i)).toBeInTheDocument();
  });

  it('keeps the row visible but routes non-solid text fills to the Fill section', () => {
    const node = makeTextNode('t1', 'auto');
    node.fills = [
      {
        type: 'gradient',
        visible: true,
        gradient: {
          type: 'linear',
          angle: 0,
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        },
      },
    ] as unknown as TextNode['fills'];
    renderSection(<TypographySection nodes={[node]} />);

    expect(screen.getByText('Colour')).toBeInTheDocument();
    expect(screen.getByText('Gradient')).toBeInTheDocument();
  });
});
